// tests/system-integration-explanation.test.js

/**
 * This file provides a complete example of integration test structure and
 * detailed explanation for the "Scenario 3: Self-Debugging Loop" of the SystemManager.
 * 
 * It includes:
 * 1. Import and mock setup for all dependencies.
 * 2. beforeEach and afterEach hooks for test isolation.
 * 3. A fully implemented test case for the self-debugging scenario with detailed comments.
 * 4. Explanation of the rationale behind the mocking and assertions.
 */

import { jest } from '@jest/globals';
import fs from 'fs';

// Mock all direct external dependencies
jest.mock('../src/core/vertexAI-client.js');
jest.mock('../src/core/prompt-templates.js');
jest.mock('../src/core/sandbox-manager.js');
jest.mock('../src/core/project-persistence.js');
jest.mock('../src/core/configuration-manager.js');

// Import the actual SystemManager and core components
import SystemManager from '../src/core/system-manager.js';
import AgentCoordinator from '../src/core/agent-coordination.js';
import TaskExecutionSystem from '../src/core/task-execution.js';

// Import mocks to configure their behavior
import { VertexAIChatModel, VertexAICodeModel, VertexAICodeChatModel } from '../src/core/vertexAI-client.js';
import * as promptTemplates from '../src/core/prompt-templates.js';
import { SandboxManager } from '../src/core/sandbox-manager.js';
import { ProjectPersistence } from '../src/core/project-persistence.js';
import { ConfigurationManager } from '../src/core/configuration-manager.js';

describe('SystemManager Integration Test - Self-Debugging Scenario Explanation', () => {
    let systemManager;
    let mockConfigManagerInstance;
    let mockProjectPersistenceInstance;
    let mockSandboxManagerInstance;
    let mockVertexAIChatModelInstance;
    let mockVertexAICodeModelInstance;
    let mockVertexAICodeChatModelInstance;

    const MOCK_PROJECT_NAME_PREFIX = 'test-integration-project-';
    let testProjectCounter = 0;
    let currentTestProjectName;

    // Helper functions to format mock LLM responses
    const createLLMJsonResponse = (data) => JSON.stringify(data);
    const createCodeFilesResponse = (filesArray, explanation = "Generated files.") =>
        createLLMJsonResponse({ files: filesArray, explanation });

    beforeEach(async () => {
        // Clear mocks and increment project counter for isolation
        jest.clearAllMocks();
        testProjectCounter++;
        currentTestProjectName = `${MOCK_PROJECT_NAME_PREFIX}${testProjectCounter}`;

        // Mock ConfigurationManager with deterministic config values
        mockConfigManagerInstance = {
            get: jest.fn((key, defaultValue) => {
                if (key === 'system.mainLoopIntervalMs') return 10; // Fast loop for tests
                if (key === 'sandbox.maxDebugAttempts') return 1;
                if (key === 'vertexAI.chat') return { modelName: 'gemini-pro-mock-integration' };
                if (key === 'vertexAI.code') return { modelName: 'code-bison-mock-integration' };
                if (key === 'vertexAI.codeChat') return { modelName: 'codechat-bison-mock-integration' };
                if (key === 'persistence') return { projectsBasePath: `/tmp/ai_test_projects_integration_${testProjectCounter}` };
                if (key === 'sandbox') return { tempHostDir: `/tmp/ai_test_sandbox_integration_${testProjectCounter}`, baseImage: 'ubuntu-test-integration' };
                return defaultValue;
            })
        };
        ConfigurationManager.mockImplementation(() => mockConfigManagerInstance);

        // In-memory ProjectPersistence mock for state tracking
        let projectDataStore = {};
        mockProjectPersistenceInstance = {
            loadProject: jest.fn(async (projectName) => projectDataStore[projectName] || null),
            saveProject: jest.fn(async (projectName, data) => { projectDataStore[projectName] = JSON.parse(JSON.stringify(data)); }),
            deleteProject: jest.fn(async (projectName) => { delete projectDataStore[projectName]; }),
            listProjects: jest.fn(async () => Object.keys(projectDataStore)),
            projectExists: jest.fn(async (projectName) => !!projectDataStore[projectName]),
            createCheckpoint: jest.fn(async (projectName, checkpointId) => {
                const baseName = projectName.replace(/_checkpoint_.*$/, '');
                const dataToSave = projectDataStore[baseName] ? JSON.parse(JSON.stringify(projectDataStore[baseName])) : {};
                dataToSave.metadata = {...dataToSave.metadata, checkpointId, status: 'checkpoint'};
                projectDataStore[`${baseName}_checkpoint_${checkpointId}`] = dataToSave;
                return checkpointId;
            }),
            restoreFromCheckpoint: jest.fn().mockResolvedValue(undefined),
            listCheckpoints: jest.fn().mockResolvedValue([]),
            getProjectMetadata: jest.fn(async (projectName) => projectDataStore[projectName]?.metadata || null),
            updateProjectStatus: jest.fn(async (projectName, status) => {
                if(projectDataStore[projectName]) projectDataStore[projectName].metadata.status = status;
            })
        };
        ProjectPersistence.mockImplementation(() => mockProjectPersistenceInstance);

        // SandboxManager mock with default success responses
        mockSandboxManagerInstance = {
            initialize: jest.fn().mockResolvedValue(undefined),
            createSessionHostDir: jest.fn().mockImplementation(prefix => Promise.resolve(`/tmp/ai_test_sandbox_integration_${testProjectCounter}/${prefix || 'session'}${Date.now()}`)),
            cleanupSessionHostDir: jest.fn().mockResolvedValue(undefined),
            prepareProjectFilesForMount: jest.fn().mockResolvedValue(['/host/mock:/container/mock:ro']),
            createAndStartContainer: jest.fn().mockResolvedValue(`mock-container-${testProjectCounter}`),
            executeCommand: jest.fn().mockResolvedValue({ exitCode: 0, output: 'Sandbox Default Success', errorOutput: '' }),
            cleanupContainer: jest.fn().mockResolvedValue(undefined),
            cleanupAllContainers: jest.fn().mockResolvedValue(undefined),
            cloneRepository: jest.fn().mockResolvedValue({repoHostPath: `/tmp_host_repo`, repoContainerPath: '/sandbox_project/cloned_repo'}),
            listRepositoryFiles: jest.fn().mockResolvedValue(['file1.js', 'file2.js']),
            readRepositoryFile: jest.fn().mockResolvedValue('mock file content'),
            installNpmDependencies: jest.fn().mockResolvedValue({exitCode:0, output: 'npm install success'}),
            installPythonDependencies: jest.fn().mockResolvedValue({exitCode:0, output: 'pip install success'}),
            runLinter: jest.fn().mockResolvedValue({exitCode:0, output: 'linter success'}),
            runTests: jest.fn().mockResolvedValue({exitCode:0, output: 'tests success'})
        };
        SandboxManager.mockImplementation(() => mockSandboxManagerInstance);

        // VertexAI client mocks
        mockVertexAIChatModelInstance = { generateText: jest.fn() };
        VertexAIChatModel.mockImplementation(() => mockVertexAIChatModelInstance);

        mockVertexAICodeModelInstance = { generateText: jest.fn(), generateCode: jest.fn() };
        VertexAICodeModel.mockImplementation(() => mockVertexAICodeModelInstance);

        mockVertexAICodeChatModelInstance = { generateText: jest.fn() };
        VertexAICodeChatModel.mockImplementation(() => mockVertexAICodeChatModelInstance);

        // Prompt templates mocks with descriptive placeholders
        promptTemplates.generateRequestUnderstandingPrompt.mockImplementation(context => `[UnderstandingPrompt for: ${context.userInput}]`);
        promptTemplates.generateProjectPlanningPrompt.mockImplementation(context => `[PlanningPrompt for: ${context.structuredUnderstanding.parsed_intent}]`);
        promptTemplates.generateTaskBreakdownPrompt.mockImplementation(context => `[TaskBreakdownPrompt for: ${context.projectPlan.project_title}]`);
        promptTemplates.generateCodeGenerationPrompt.mockImplementation(context => `[CodeGenPrompt for task: ${context.subtask.title}]`);
        promptTemplates.generateCodeDebuggingPrompt.mockImplementation(context => `[DebugPrompt for error: ${context.errorMessage}]`);

        // Initialize SystemManager instance
        const systemManagerConfig = {
            configurationManager: {
                defaultConfigPath: 'dummy-path-default.json',
                envSpecificConfigPath: 'dummy-path-env.json'
            }
        };

        // Mock fs.existsSync to avoid config file issues
        const originalExistsSync = fs.existsSync;
        fs.existsSync = jest.fn().mockReturnValue(false);

        systemManager = new SystemManager(systemManagerConfig);
        await systemManager.initialize();

        fs.existsSync = originalExistsSync;
    });

    afterEach(async () => {
        if (systemManager && systemManager.state.isRunning) {
            await systemManager.stop();
        }
    });

    test('Scenario 3: Self-Debugging Loop - Fix Syntax Error in Generated Code', async () => {
        /**
         * This test simulates the full self-debugging loop:
         * 1. Initial code generation with a syntax error.
         * 2. Sandbox execution failure due to syntax error.
         * 3. AI debug prompt generation to fix the error.
         * 4. Fixed code generation.
         * 5. Successful sandbox execution.
         */

        // Step 1: Mock initial request understanding and planning responses
        mockVertexAIChatModelInstance.generateText
            .mockResolvedValueOnce(createLLMJsonResponse({
                parsed_intent: 'create_javascript_function',
                project_type: 'JavaScriptFunction',
                key_entities_and_requirements: [
                    { entity_type: 'function_name', value: 'factorial' },
                    { entity_type: 'input_type', value: 'number' },
                    { entity_type: 'output_type', value: 'number' }
                ]
            }))
            .mockResolvedValueOnce(createLLMJsonResponse({
                project_title: 'FactorialFunction',
                major_milestones_or_phases: [
                    { milestone_id: 'M1', title: 'Implementation' },
                    { milestone_id: 'M2', title: 'Testing' }
                ]
            }))
            .mockResolvedValueOnce(createLLMJsonResponse([{
                id: 'T1_Factorial',
                title: 'Implement Factorial Function',
                description: 'Create factorial.js with factorial calculation',
                assigned_persona: 'JavaScriptDeveloper',
                expected_artifacts: [{ type: 'code', path: 'factorial.js' }],
                success_criteria: ['tests_pass'],
                language: 'javascript',
                execution_command: ['node', 'factorial.js']
            }]));

        // Step 2: Mock initial buggy code generation with syntax error
        mockVertexAICodeModelInstance.generateText
            .mockResolvedValueOnce(createCodeFilesResponse([{
                path: 'factorial.js',
                content: `
function factorial(n) {
    if (n === 0 || n === 1
        return 1;
    return n * factorial(n - 1);
}
module.exports = factorial;`
            }]));

        // Step 3: Mock sandbox failure due to syntax error
        mockSandboxManagerInstance.executeCommand
            .mockResolvedValueOnce({
                exitCode: 1,
                output: '',
                errorOutput: 'SyntaxError: Unexpected token return'
            });

        // Step 4: Mock AI debug prompt response with fixed code
        mockVertexAICodeChatModelInstance.generateText
            .mockResolvedValueOnce(createLLMJsonResponse({
                fixed_code_snippets: [{
                    file_path: 'factorial.js',
                    corrected_code: `
function factorial(n) {
    if (n === 0 || n === 1) {
        return 1;
    }
    return n * factorial(n - 1);
}
module.exports = factorial;`
                }],
                error_analysis: "Missing closing parenthesis in if condition"
            }));

        // Step 5: Mock successful sandbox execution with fixed code
        mockSandboxManagerInstance.executeCommand
            .mockResolvedValueOnce({
                exitCode: 0,
                output: 'factorial(5) = 120',
                errorOutput: ''
            });

        // Trigger the system with the test request
        systemManager.submitNewRequest(
            "Create a JavaScript function to calculate factorial",
            currentTestProjectName
        );
        systemManager.start();

        // Await completion by monitoring checkpoint creation
        await new Promise(resolve => {
            const originalCheckpoint = mockProjectPersistenceInstance.createCheckpoint;
            mockProjectPersistenceInstance.createCheckpoint = jest.fn(async (projectName, stageName) => {
                await originalCheckpoint(projectName, stageName);
                const projectState = systemManager.activeProjects.get(projectName);
                if (projectState?.metadata?.status === 'completed_successfully') {
                    resolve();
                }
            });
            setTimeout(resolve, 1000); // Timeout fallback
        });

        await systemManager.stop();

        // Assertions verifying the self-debugging flow
        expect(mockVertexAIChatModelInstance.generateText).toHaveBeenCalledTimes(3);
        expect(mockVertexAICodeModelInstance.generateText).toHaveBeenCalledTimes(1);
        expect(mockVertexAICodeChatModelInstance.generateText).toHaveBeenCalledTimes(1);
        expect(mockSandboxManagerInstance.executeCommand).toHaveBeenCalledTimes(2);

        // Verify debug prompt was called with error context
        expect(promptTemplates.generateCodeDebuggingPrompt).toHaveBeenCalledWith(
            expect.objectContaining({
                errorMessage: expect.stringContaining('SyntaxError')
            })
        );

        // Verify final project state correctness
        const finalProjectState = systemManager.activeProjects.get(currentTestProjectName);
        expect(finalProjectState.metadata.status).toBe('completed_successfully');
        expect(finalProjectState.context.files['factorial.js']).toContain('if (n === 0 || n === 1) {');
    });
});
