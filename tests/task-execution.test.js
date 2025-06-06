// tests/task-execution.test.js

import { jest } from '@jest/globals';
import path from 'path';
import TaskExecutionSystem from '../src/core/task-execution.js';
import { VertexAICodeModel, VertexAICodeChatModel } from '../src/core/vertexAI-client.js';
import { SandboxManager } from '../src/core/sandbox-manager.js';
import * as promptTemplates from '../src/core/prompt-templates.js';

// Mock dependencies
jest.mock('../src/core/vertexAI-client.js');
jest.mock('../src/core/sandbox-manager.js');
jest.mock('../src/core/prompt-templates.js');

describe('TaskExecutionSystem', () => {
    let taskExecutionSystem;
    let mockVertexAICodeConfig;
    let mockVertexAICodeChatConfig;
    let mockSandboxManager;
    let mockProjectPersistence;
    let mockConfigManager;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Mock configurations
        mockVertexAICodeConfig = {
            model: 'code-bison',
            temperature: 0.2
        };

        mockVertexAICodeChatConfig = {
            model: 'code-chat-bison',
            temperature: 0.3
        };

        // Mock sandbox manager
        mockSandboxManager = {
            createSessionHostDir: jest.fn().mockResolvedValue('/tmp/sandbox-123'),
            cleanupSessionHostDir: jest.fn().mockResolvedValue(),
            prepareProjectFilesForMount: jest.fn().mockResolvedValue(['mount1', 'mount2']),
            createAndStartContainer: jest.fn().mockResolvedValue('container-123'),
            executeCommand: jest.fn(),
            cleanupContainer: jest.fn().mockResolvedValue()
        };

        // Mock project persistence
        mockProjectPersistence = {
            updateProjectFiles: jest.fn(),
            updateTaskStatus: jest.fn()
        };

        // Mock config manager
        mockConfigManager = {
            get: jest.fn((key, defaultValue) => defaultValue)
        };

        // Initialize TaskExecutionSystem with mocked dependencies
        taskExecutionSystem = new TaskExecutionSystem(
            mockVertexAICodeConfig,
            mockVertexAICodeChatConfig,
            mockSandboxManager,
            mockProjectPersistence,
            mockConfigManager
        );

        // Mock prompt templates
        promptTemplates.generateCodeGenerationPrompt.mockReturnValue('mocked code generation prompt');
        promptTemplates.generateCodeDebuggingPrompt.mockReturnValue('mocked debugging prompt');
    });

    describe('constructor', () => {
        it('should initialize with provided configurations', () => {
            expect(taskExecutionSystem.codeModel).toBeInstanceOf(VertexAICodeModel);
            expect(taskExecutionSystem.codeChatModel).toBeInstanceOf(VertexAICodeChatModel);
            expect(taskExecutionSystem.sandboxManager).toBe(mockSandboxManager);
            expect(taskExecutionSystem.projectPersistence).toBe(mockProjectPersistence);
            expect(taskExecutionSystem.configManager).toBe(mockConfigManager);
        });
    });

    describe('executeSubtask', () => {
        const mockSubtask = {
            id: 'T001',
            title: 'Create React Component',
            description: 'Create a basic React component',
            assigned_persona: 'React Developer',
            expected_artifacts: [
                {
                    type: 'code',
                    path: 'src/components/TestComponent.js',
                    description: 'React component file'
                }
            ],
            success_criteria: ['exit_code_is_0', 'stdout_contains_SUCCESS']
        };

        const mockProjectContext = {
            'src/App.js': 'console.log("Hello");'
        };

        describe('successful execution', () => {
            beforeEach(() => {
                // Mock successful code generation
                taskExecutionSystem.codeModel.generateText.mockResolvedValue(JSON.stringify({
                    files: [{
                        path: 'src/components/TestComponent.js',
                        content: 'const TestComponent = () => { return <div>Test</div> };'
                    }],
                    explanation: 'Created React component'
                }));

                // Mock successful sandbox execution
                mockSandboxManager.executeCommand.mockResolvedValue({
                    exitCode: 0,
                    output: 'SUCCESS: Component created',
                    errorOutput: ''
                });
            });

            it('should successfully execute a subtask', async () => {
                const result = await taskExecutionSystem.executeSubtask(
                    mockSubtask,
                    'test-project',
                    mockProjectContext
                );

                expect(result.success).toBe(true);
                expect(result.artifacts).toHaveProperty('src/components/TestComponent.js');
                expect(mockSandboxManager.createSessionHostDir).toHaveBeenCalled();
                expect(mockSandboxManager.executeCommand).toHaveBeenCalled();
                expect(mockSandboxManager.cleanupContainer).toHaveBeenCalled();
                expect(mockSandboxManager.cleanupSessionHostDir).toHaveBeenCalled();
            });

            it('should handle subtasks without execution commands', async () => {
                const codeOnlySubtask = {
                    ...mockSubtask,
                    type: 'code_generation_only'
                };

                const result = await taskExecutionSystem.executeSubtask(
                    codeOnlySubtask,
                    'test-project',
                    mockProjectContext
                );

                expect(result.success).toBe(true);
                expect(result.artifacts).toBeDefined();
                expect(mockSandboxManager.executeCommand).not.toHaveBeenCalled();
            });
        });

        describe('self-debugging loop', () => {
            beforeEach(() => {
                // First attempt fails, second succeeds
                taskExecutionSystem.codeModel.generateText
                    .mockResolvedValueOnce(JSON.stringify({
                        files: [{
                            path: 'src/components/TestComponent.js',
                            content: 'const TestComponent = () => { return <div>Bug</div> };'
                        }]
                    }))
                    .mockResolvedValueOnce(JSON.stringify({
                        files: [{
                            path: 'src/components/TestComponent.js',
                            content: 'const TestComponent = () => { return <div>Fixed</div> };'
                        }]
                    }));

                mockSandboxManager.executeCommand
                    .mockResolvedValueOnce({
                        exitCode: 1,
                        output: '',
                        errorOutput: 'Syntax error'
                    })
                    .mockResolvedValueOnce({
                        exitCode: 0,
                        output: 'SUCCESS: Component works',
                        errorOutput: ''
                    });
            });

            it('should attempt debugging and succeed', async () => {
                const result = await taskExecutionSystem.executeSubtask(
                    mockSubtask,
                    'test-project',
                    mockProjectContext
                );

                expect(result.success).toBe(true);
                expect(taskExecutionSystem.codeChatModel.generateText).toHaveBeenCalled();
                expect(mockSandboxManager.executeCommand).toHaveBeenCalledTimes(2);
            });

            it('should fail after max debug attempts', async () => {
                mockSandboxManager.executeCommand.mockReset();
                mockSandboxManager.executeCommand.mockResolvedValue({
                    exitCode: 1,
                    output: '',
                    errorOutput: 'Persistent error'
                });

                await expect(taskExecutionSystem.executeSubtask(
                    mockSubtask,
                    'test-project',
                    mockProjectContext
                )).rejects.toThrow('Max debug attempts');

                expect(mockSandboxManager.executeCommand).toHaveBeenCalledTimes(4); // Initial + 3 retries
            });
        });

        describe('acceptance criteria evaluation', () => {
            it('should evaluate multiple criteria types', async () => {
                const subtaskWithCriteria = {
                    ...mockSubtask,
                    success_criteria: [
                        'exit_code_is_0',
                        'stdout_contains_SUCCESS',
                        'stderr_is_empty'
                    ]
                };

                taskExecutionSystem.codeModel.generateText.mockResolvedValue(JSON.stringify({
                    files: [{
                        path: 'test.js',
                        content: 'console.log("test");'
                    }]
                }));

                mockSandboxManager.executeCommand.mockResolvedValue({
                    exitCode: 0,
                    output: 'SUCCESS: Test passed',
                    errorOutput: ''
                });

                const result = await taskExecutionSystem.executeSubtask(
                    subtaskWithCriteria,
                    'test-project',
                    mockProjectContext
                );

                expect(result.success).toBe(true);
            });

            it('should fail if any criterion is not met', async () => {
                const subtaskWithCriteria = {
                    ...mockSubtask,
                    success_criteria: [
                        'exit_code_is_0',
                        'stdout_contains_SPECIFIC_TEXT'
                    ]
                };

                taskExecutionSystem.codeModel.generateText.mockResolvedValue(JSON.stringify({
                    files: [{
                        path: 'test.js',
                        content: 'console.log("test");'
                    }]
                }));

                mockSandboxManager.executeCommand.mockResolvedValue({
                    exitCode: 0,
                    output: 'Different text',
                    errorOutput: ''
                });

                await expect(taskExecutionSystem.executeSubtask(
                    subtaskWithCriteria,
                    'test-project',
                    mockProjectContext
                )).rejects.toThrow();
            });
        });
    });

    describe('helper methods', () => {
        describe('_getRelevantCodeSnippets', () => {
            it('should extract relevant files based on input artifacts', () => {
                const subtask = {
                    input_artifacts_needed: ['src/App.js', { path: 'src/utils.js' }]
                };
                const files = {
                    'src/App.js': 'app code',
                    'src/utils.js': 'utils code',
                    'src/irrelevant.js': 'other code'
                };

                const snippets = taskExecutionSystem._getRelevantCodeSnippets(subtask, files);
                expect(snippets).toHaveProperty('src/App.js', 'app code');
                expect(snippets).toHaveProperty('src/utils.js', 'utils code');
                expect(snippets).not.toHaveProperty('src/irrelevant.js');
            });
        });

        describe('_inferLanguage', () => {
            it('should infer language from file extensions', () => {
                const subtask = {
                    expected_artifacts: [
                        { type: 'code', path: 'src/test.js' }
                    ]
                };

                expect(taskExecutionSystem._inferLanguage(subtask, {})).toBe('javascript');
            });

            it('should return default language if no artifacts', () => {
                expect(taskExecutionSystem._inferLanguage({}, {})).toBe('javascript');
            });
        });

        describe('_determineExecutionCommand', () => {
            it('should use explicit execution command if provided', () => {
                const subtask = {
                    execution_command: ['npm', 'test']
                };

                const command = taskExecutionSystem._determineExecutionCommand(subtask, {});
                expect(command).toEqual(['npm', 'test']);
            });

            it('should determine command based on subtask type', () => {
                const subtask = {
                    type: 'unit_test',
                    language: 'javascript'
                };

                const command = taskExecutionSystem._determineExecutionCommand(subtask, {});
                expect(command).toEqual(['npm', 'test']);
            });
        });
    });
});
