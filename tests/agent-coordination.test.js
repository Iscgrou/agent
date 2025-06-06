// tests/agent-coordination.test.js

import { jest } from '@jest/globals';
import AgentCoordinator from '../src/core/agent-coordination.js';
import { VertexAIChatModel, VertexAIError } from '../src/core/vertexAI-client.js';
import * as promptTemplates from '../src/core/prompt-templates.js';
import { PlatformError } from '../src/core/error-utils.js';
import path from 'path';

// Mock dependencies
jest.mock('../src/core/vertexAI-client.js');
jest.mock('../src/core/prompt-templates.js');
jest.mock('../src/core/configuration-manager.js');

describe('AgentCoordinator', () => {
    let agentCoordinator;
    let mockVertexAIChatConfig;
    let mockProjectPersistence;
    let mockSandboxManager;
    let mockConfigManager;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Mock configurations and dependencies
        mockVertexAIChatConfig = {
            model: 'gemini-pro',
            temperature: 0.7
        };

        mockProjectPersistence = {
            projectExists: jest.fn(),
            loadProject: jest.fn(),
            saveProject: jest.fn(),
            updateProjectPart: jest.fn()
        };

        mockSandboxManager = {
            createSessionHostDir: jest.fn(),
            cleanupSessionHostDir: jest.fn(),
            cloneRepository: jest.fn(),
            readRepositoryFile: jest.fn(),
            listRepositoryFiles: jest.fn(),
            cleanupContainer: jest.fn()
        };

        mockConfigManager = {
            get: jest.fn().mockReturnValue(3) // Default maxFilesToAnalyzeDeeply
        };

        // Initialize AgentCoordinator with mocked dependencies
        agentCoordinator = new AgentCoordinator(
            mockVertexAIChatConfig,
            mockProjectPersistence,
            mockSandboxManager,
            mockConfigManager
        );
    });

    describe('constructor', () => {
        it('should initialize with provided configurations', () => {
            expect(agentCoordinator.chatModel).toBeInstanceOf(VertexAIChatModel);
            expect(agentCoordinator.projectPersistence).toBe(mockProjectPersistence);
            expect(agentCoordinator.sandboxManager).toBe(mockSandboxManager);
        });
    });

    describe('Repository Analysis', () => {
        describe('_analyzeClonedRepository', () => {
            const testSetup = {
                projectName: 'test-project',
                userModificationRequest: 'Add authentication feature',
                clonedRepoContainerPath: '/repo/path',
                repoContainerId: 'container-123',
                manifestFilePathsToAnalyze: ['package.json']
            };

            beforeEach(() => {
                // Reset specific mocks for repository analysis
                mockSandboxManager.readRepositoryFile.mockReset();
                mockSandboxManager.listRepositoryFiles.mockReset();
                promptTemplates.generateDependencyAnalysisPrompt.mockReturnValue('mocked dependency prompt');
                promptTemplates.generateRepoLevelAnalysisPrompt.mockReturnValue('mocked repo analysis prompt');
                promptTemplates.generateFileLevelAnalysisPrompt.mockReturnValue('mocked file analysis prompt');
            });

            it('should analyze repository with specified manifest files', async () => {
                // Setup mock responses
                mockSandboxManager.readRepositoryFile.mockResolvedValue('{"name": "test-project"}');
                mockSandboxManager.listRepositoryFiles.mockResolvedValue(['src/index.js', 'package.json']);
                agentCoordinator.chatModel.generateText
                    .mockResolvedValueOnce(JSON.stringify({ mainLanguageOrPlatform: "Node.js" }))
                    .mockResolvedValueOnce(JSON.stringify({ 
                        mainLanguages: ["JavaScript"],
                        initialAnalysisForModification: {
                            suggestedFilesToInspectFurtherForModification: ["src/index.js"]
                        }
                    }))
                    .mockResolvedValueOnce(JSON.stringify({ primaryPurposeSummary: "Main entry file" }));

                const result = await agentCoordinator._analyzeClonedRepository(
                    testSetup.projectName,
                    testSetup.userModificationRequest,
                    testSetup.clonedRepoContainerPath,
                    testSetup.repoContainerId,
                    testSetup.manifestFilePathsToAnalyze
                );

                expect(result).toHaveProperty('repositoryOverview');
                expect(result).toHaveProperty('modificationContext');
                expect(mockSandboxManager.readRepositoryFile).toHaveBeenCalled();
                expect(agentCoordinator.chatModel.generateText).toHaveBeenCalledTimes(3);
            });

            it('should handle manifest file read errors gracefully', async () => {
                mockSandboxManager.readRepositoryFile.mockRejectedValue(new Error('File not found'));
                mockSandboxManager.listRepositoryFiles.mockResolvedValue(['src/index.js']);
                agentCoordinator.chatModel.generateText
                    .mockResolvedValueOnce(JSON.stringify({ mainLanguages: ["JavaScript"] }))
                    .mockResolvedValueOnce(JSON.stringify({ primaryPurposeSummary: "Main entry file" }));

                const result = await agentCoordinator._analyzeClonedRepository(
                    testSetup.projectName,
                    testSetup.userModificationRequest,
                    testSetup.clonedRepoContainerPath,
                    testSetup.repoContainerId,
                    testSetup.manifestFilePathsToAnalyze
                );

                expect(result.repositoryOverview.mainLanguages).toContain("Error in dep analysis");
            });

            it('should respect maxFilesToAnalyzeDeeply configuration', async () => {
                mockConfigManager.get.mockReturnValue(2); // Set max files to 2
                mockSandboxManager.readRepositoryFile.mockResolvedValue('{"name": "test-project"}');
                mockSandboxManager.listRepositoryFiles.mockResolvedValue(['src/index.js', 'src/auth.js', 'src/utils.js']);
                agentCoordinator.chatModel.generateText
                    .mockResolvedValueOnce(JSON.stringify({ mainLanguageOrPlatform: "Node.js" }))
                    .mockResolvedValueOnce(JSON.stringify({
                        mainLanguages: ["JavaScript"],
                        initialAnalysisForModification: {
                            suggestedFilesToInspectFurtherForModification: ["src/index.js", "src/auth.js", "src/utils.js"]
                        }
                    }))
                    .mockResolvedValueOnce(JSON.stringify({ primaryPurposeSummary: "File 1" }))
                    .mockResolvedValueOnce(JSON.stringify({ primaryPurposeSummary: "File 2" }));

                const result = await agentCoordinator._analyzeClonedRepository(
                    testSetup.projectName,
                    testSetup.userModificationRequest,
                    testSetup.clonedRepoContainerPath,
                    testSetup.repoContainerId
                );

                expect(result.modificationContext.relevantFiles).toHaveLength(2);
            });
        });
    });

    describe('understandRequest', () => {
        const mockUserInput = "Create a React component for user profile";
        const mockProjectName = "test-project";
        const mockExistingContext = { 
            existingFiles: ['src/App.js'],
            repositoryUrl: 'https://github.com/test/repo',
            performRepoAnalysis: true
        };

        beforeEach(() => {
            promptTemplates.generateRequestUnderstandingPrompt.mockReturnValue('mocked prompt');
            agentCoordinator.chatModel.generateText.mockResolvedValue(JSON.stringify({
                parsed_intent: 'Create React component',
                required_skills: ['React', 'JavaScript'],
                complexity_assessment: 'medium'
            }));
        });

        it('should analyze user request with repository context when provided', async () => {
            mockSandboxManager.cloneRepository.mockResolvedValue({
                containerId: 'container-123',
                repoContainerPath: '/repo/path',
                newContainerCreated: true,
                newSessionDirCreated: true
            });

            // Mock responses for repository analysis
            agentCoordinator.chatModel.generateText
                .mockResolvedValueOnce(JSON.stringify({ mainLanguageOrPlatform: "Node.js" }))
                .mockResolvedValueOnce(JSON.stringify({ mainLanguages: ["JavaScript"] }))
                .mockResolvedValueOnce(JSON.stringify({ primaryPurposeSummary: "Main entry file" }))
                .mockResolvedValueOnce(JSON.stringify({
                    parsed_intent: 'Create React component',
                    required_skills: ['React', 'JavaScript'],
                    complexity_assessment: 'medium'
                }));
            const understanding = await agentCoordinator.understandRequest(
                mockUserInput,
                mockProjectName,
                mockExistingContext
            );

            expect(promptTemplates.generateRequestUnderstandingPrompt).toHaveBeenCalledWith({
                userInput: mockUserInput,
                projectContext: mockExistingContext
            });

            expect(understanding).toHaveProperty('repositoryAnalysisData');
            expect(understanding.parsed_intent).toBe('Create React component');
            expect(mockSandboxManager.cloneRepository).toHaveBeenCalled();
        });

        it('should handle AI response errors', async () => {
            agentCoordinator.chatModel.generateText.mockResolvedValue(JSON.stringify({
                error: 'Invalid request',
                clarification_needed: ['Please specify component requirements']
            }));

            await expect(agentCoordinator.understandRequest(mockUserInput))
                .rejects
                .toThrow('AI understanding failed: Invalid request');
        });

        it('should handle invalid JSON responses', async () => {
            agentCoordinator.chatModel.generateText.mockResolvedValue('invalid json');

            await expect(agentCoordinator.understandRequest(mockUserInput))
                .rejects
                .toThrow('LLM response for request_understanding was not valid JSON');
        });
    });

    describe('developStrategicPlan', () => {
        const mockUnderstanding = {
            parsed_intent: 'Create React component',
            required_skills: ['React', 'JavaScript']
        };

        beforeEach(() => {
            promptTemplates.generateProjectPlanningPrompt.mockReturnValue('mocked planning prompt');
            agentCoordinator.chatModel.generateText.mockResolvedValue(JSON.stringify({
                project_title: 'User Profile Component',
                high_level_steps: [
                    'Setup component structure',
                    'Implement UI',
                    'Add state management'
                ],
                estimated_time: '2 hours'
            }));
        });

        it('should generate a strategic plan based on understanding', async () => {
            const plan = await agentCoordinator.developStrategicPlan(mockUnderstanding, 'test-project');

            expect(promptTemplates.generateProjectPlanningPrompt).toHaveBeenCalledWith({
                structuredUnderstanding: mockUnderstanding
            });

            expect(plan).toEqual({
                project_title: 'User Profile Component',
                high_level_steps: [
                    'Setup component structure',
                    'Implement UI',
                    'Add state management'
                ],
                estimated_time: '2 hours'
            });
        });

        it('should handle AI planning errors', async () => {
            agentCoordinator.chatModel.generateText.mockResolvedValue(JSON.stringify({
                error: 'Insufficient context',
                clarification_needed: ['Need more details about component requirements']
            }));

            await expect(agentCoordinator.developStrategicPlan(mockUnderstanding))
                .rejects
                .toThrow('AI planning failed: Insufficient context');
        });
    });

    describe('breakdownPlanIntoSubtasks', () => {
        const mockPlan = {
            project_title: 'User Profile Component',
            high_level_steps: ['Setup', 'Implementation', 'Testing']
        };
        const mockUnderstanding = {
            parsed_intent: 'Create React component'
        };

        beforeEach(() => {
            promptTemplates.generateTaskBreakdownPrompt.mockReturnValue('mocked breakdown prompt');
            agentCoordinator.chatModel.generateText.mockResolvedValue(JSON.stringify([
                {
                    subtask_id: 'T001',
                    title: 'Setup component files',
                    description: 'Create initial component structure',
                    dependencies: [],
                    assigned_persona: 'React Developer',
                    expected_artifacts: [
                        {
                            type: 'code',
                            path: 'src/components/UserProfile.js',
                            description: 'Main component file'
                        }
                    ],
                    success_criteria: ['File exists', 'Valid React component structure'],
                    estimated_complexity: 'low'
                }
            ]));
        });

        it('should break down plan into detailed subtasks', async () => {
            const subtasks = await agentCoordinator.breakdownPlanIntoSubtasks(
                mockPlan,
                mockUnderstanding,
                'test-project'
            );

            expect(promptTemplates.generateTaskBreakdownPrompt).toHaveBeenCalledWith({
                projectPlan: mockPlan,
                structuredUnderstanding: mockUnderstanding
            });

            expect(subtasks).toHaveLength(1);
            expect(subtasks[0]).toMatchObject({
                subtask_id: 'T001',
                title: 'Setup component files',
                assigned_persona: 'React Developer'
            });
        });

        it('should validate subtask structure', async () => {
            agentCoordinator.chatModel.generateText.mockResolvedValue(JSON.stringify([
                { title: 'Invalid subtask' } // Missing required fields
            ]));

            await expect(agentCoordinator.breakdownPlanIntoSubtasks(mockPlan, mockUnderstanding))
                .rejects
                .toThrow('AI failed to generate a valid list of subtasks');
        });
    });

    describe('Re-planning', () => {
        const mockFailureContext = {
            errorClassification: 'EXECUTION_ERROR',
            failedSubtaskId: 'TASK_123',
            replanReason: 'Task execution failed',
            previousPlan: {
                project_title: 'Original Project',
                subtasks: [
                    { id: 'TASK_123', title: 'Failed Task', status: 'failed' },
                    { id: 'TASK_124', title: 'Successful Task', status: 'completed' }
                ]
            },
            previousUnderstanding: {
                original_request: 'Create a web app',
                parsed_intent: 'create_webapp'
            },
            checkpointId: 'checkpoint_123'
        };

        beforeEach(() => {
            mockProjectPersistence.loadProjectCheckpoint = jest.fn();
            mockProjectPersistence.storeReplanAttempt = jest.fn();
            agentCoordinator.chatModel.generateText
                .mockReset()
                .mockResolvedValueOnce(JSON.stringify({ // Re-understanding phase
                    revised_understanding: {
                        modified_requirements: ['Updated requirement'],
                        new_constraints_identified: ['New constraint']
                    }
                }))
                .mockResolvedValueOnce(JSON.stringify({ // Re-planning phase
                    revised_plan: {
                        project_title: 'Revised Project',
                        modified_tech_stack: []
                    }
                }))
                .mockResolvedValueOnce(JSON.stringify([ // Re-task breakdown phase
                    {
                        subtask_id: 'NEW_TASK_1',
                        title: 'New Task 1',
                        replan_notes: {
                            is_modified: true,
                            modification_reason: 'Added based on failure'
                        }
                    }
                ]));
        });

        it('should successfully generate a new plan through orchestrateReplanningAnalysis', async () => {
            mockProjectPersistence.loadProjectCheckpoint.mockResolvedValue({
                successfulTasks: ['TASK_124']
            });

            const result = await agentCoordinator.orchestrateReplanningAnalysis(
                'test-project',
                mockFailureContext
            );

            expect(result).toHaveProperty('understanding');
            expect(result).toHaveProperty('plan');
            expect(result).toHaveProperty('subtasks');
            expect(Array.isArray(result.subtasks)).toBe(true);

            expect(mockProjectPersistence.loadProjectCheckpoint)
                .toHaveBeenCalledWith('test-project', 'checkpoint_123');
            expect(mockProjectPersistence.storeReplanAttempt)
                .toHaveBeenCalledWith('test-project', expect.any(Object));
        });

        it('should handle checkpoint loading failure in orchestrateReplanningAnalysis', async () => {
            mockProjectPersistence.loadProjectCheckpoint
                .mockRejectedValue(new Error('Checkpoint not found'));

            const result = await agentCoordinator.orchestrateReplanningAnalysis(
                'test-project',
                mockFailureContext
            );

            expect(result).toHaveProperty('subtasks');
            expect(result.subtasks[0].subtask_id).toBe('NEW_TASK_1');
        });

        it('should throw PlatformError if re-planning fails to generate valid subtasks', async () => {
            agentCoordinator.chatModel.generateText
                .mockReset()
                .mockResolvedValueOnce(JSON.stringify({ revised_understanding: {} }))
                .mockResolvedValueOnce(JSON.stringify({ revised_plan: {} }))
                .mockResolvedValueOnce(JSON.stringify([])); // Empty subtasks array

            await expect(
                agentCoordinator.orchestrateReplanningAnalysis('test-project', mockFailureContext)
            ).rejects.toThrow(PlatformError);
        });

        it('should invoke re-planning through orchestrateFullAnalysis when isReplanAttempt is true', async () => {
            const result = await agentCoordinator.orchestrateFullAnalysis(
                'original request',
                'test-project',
                {
                    isReplanAttempt: true,
                    failureContext: mockFailureContext,
                    preserveSuccessfulTasks: true
                }
            );

            expect(result).toHaveProperty('understanding');
            expect(result).toHaveProperty('plan');
            expect(result).toHaveProperty('subtasks');
            expect(result.subtasks[0].subtask_id).toBe('NEW_TASK_1');
        });
    });

    describe('orchestrateFullAnalysis with Repository Analysis', () => {
        const mockUserInput = "Create a React component";
        const mockProjectName = "test-project";
        const mockInitialContext = {
            repositoryUrl: 'https://github.com/test/repo',
            performRepoAnalysis: true,
            branch: 'main',
            manifestFilePathsToAnalyze: ['package.json']
        };

        beforeEach(() => {
            // Mock successful responses for each stage
            agentCoordinator.understandRequest = jest.fn().mockResolvedValue({
                parsed_intent: 'Create React component'
            });
            agentCoordinator.developStrategicPlan = jest.fn().mockResolvedValue({
                project_title: 'User Profile Component'
            });
            agentCoordinator.breakdownPlanIntoSubtasks = jest.fn().mockResolvedValue([
                { subtask_id: 'T001', title: 'Setup' }
            ]);
        });

        it('should execute full analysis pipeline', async () => {
            const result = await agentCoordinator.orchestrateFullAnalysis(
                mockUserInput,
                mockProjectName,
                mockInitialContext
            );

            expect(result).toEqual({
                understanding: { 
                    parsed_intent: 'Create React component',
                    repositoryAnalysisData: {
                        repositoryOverview: {
                            mainLanguages: ['JavaScript'],
                            frameworksAndLibraries: ['React']
                        }
                    }
                },
                plan: { project_title: 'User Profile Component' },
                subtasks: [{ subtask_id: 'T001', title: 'Setup' }]
            });

            expect(agentCoordinator.understandRequest).toHaveBeenCalledWith(
                mockUserInput,
                mockProjectName,
                expect.objectContaining({
                    repositoryUrl: mockInitialContext.repositoryUrl,
                    performRepoAnalysis: true
                })
            );
            expect(agentCoordinator.developStrategicPlan).toHaveBeenCalled();
            expect(agentCoordinator.breakdownPlanIntoSubtasks).toHaveBeenCalled();
        });

        it('should handle existing project state', async () => {
            mockProjectPersistence.projectExists.mockResolvedValue(true);
            mockProjectPersistence.loadProject.mockResolvedValue({
                understanding: { parsed_intent: 'Existing understanding' },
                context: { existingFiles: ['App.js'] }
            });

            await agentCoordinator.orchestrateFullAnalysis(
                mockUserInput,
                mockProjectName
            );

            expect(mockProjectPersistence.loadProject).toHaveBeenCalledWith(mockProjectName);
        });

        it('should handle project persistence errors', async () => {
            mockProjectPersistence.projectExists.mockRejectedValue(new Error('Database error'));

            const result = await agentCoordinator.orchestrateFullAnalysis(
                mockUserInput,
                mockProjectName
            );

            // Should continue with new project creation
            expect(result).toBeDefined();
            expect(result.understanding).toBeDefined();
            expect(result.plan).toBeDefined();
            expect(result.subtasks).toBeDefined();
        });

        it('should require project name when persistence is enabled', async () => {
            await expect(agentCoordinator.orchestrateFullAnalysis(mockUserInput))
                .rejects
                .toThrow('Project name is required for analysis when persistence is enabled');
        });
    });
});
