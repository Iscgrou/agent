// tests/system-integration.test.js
import { jest } from '@jest/globals';
import SystemManager from '../src/core/system-manager.js';
import { LearningSystem } from '../src/core/learning-system.js';

jest.mock('../src/core/vertexAI-client.js');
jest.mock('../src/core/sandbox-manager.js');
jest.mock('../src/core/project-persistence.js');

describe('SystemManager with LearningSystem Integration', () => {
    let systemManager;
    let logExperienceSpy;

    beforeEach(async () => {
        systemManager = new SystemManager();
        await systemManager.initialize();
        logExperienceSpy = jest.spyOn(systemManager.learningSystem, 'logExperience');
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('should log PROJECT_ANALYSIS_ORCHESTRATION experience', async () => {
        const projectName = 'test-project';
        const userInput = 'Create a simple web app';

        await systemManager.submitNewRequest(userInput, projectName);
        await new Promise(resolve => setTimeout(resolve, 100)); // Allow operational loop to run

        expect(logExperienceSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'PROJECT_ANALYSIS_ORCHESTRATION',
            context: expect.objectContaining({
                projectName,
                userInput
            })
        }));
    });

    test('should log SUBTASK_EXECUTION experience', async () => {
        const projectName = 'test-project';
        const mockSubtask = {
            id: 'subtask-1',
            title: 'Create index.html',
            type: 'code_generation'
        };

        // Mock successful subtask execution
        systemManager.taskExecutor.executeSubtask.mockResolvedValueOnce({
            success: true,
            artifacts: { 'index.html': 'content' }
        });

        await systemManager._processProjectSubtasks(projectName, {
            execution: {
                subtasksRemainingIds: [mockSubtask.id],
                subtasksFull: [mockSubtask],
                subtaskAttempts: {}
            },
            metadata: { status: 'processing_tasks' }
        });

        expect(logExperienceSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'SUBTASK_EXECUTION',
            context: expect.objectContaining({
                projectName,
                subtaskId: mockSubtask.id,
                subtaskType: mockSubtask.type
            }),
            outcome: expect.objectContaining({
                status: 'SUCCESS'
            })
        }));
    });

    test('should log ERROR_RECOVERY_ATTEMPT experience', async () => {
        const projectName = 'test-project';
        const mockError = new Error('Test error');
        const mockSubtask = {
            id: 'subtask-1',
            title: 'Create index.html'
        };

        // Mock failed subtask execution
        systemManager.taskExecutor.executeSubtask.mockRejectedValueOnce(mockError);

        await systemManager._processProjectSubtasks(projectName, {
            execution: {
                subtasksRemainingIds: [mockSubtask.id],
                subtasksFull: [mockSubtask],
                subtaskAttempts: {}
            },
            metadata: { status: 'processing_tasks' }
        }).catch(() => {}); // Catch the error to continue test

        expect(logExperienceSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'ERROR_RECOVERY_ATTEMPT',
            context: expect.objectContaining({
                projectName,
                subtaskId: mockSubtask.id
            }),
            outcome: expect.objectContaining({
                status: 'IN_PROGRESS'
            })
        }));
    });

    test('should log AI_PROMPT_EXECUTION experience', async () => {
        const projectName = 'test-project';
        const mockPrompt = 'Generate code for index.html';

        // Trigger an AI call through AgentCoordinator
        await systemManager.agentCoordinator._callAIWithRetry(mockPrompt, {
            projectName,
            promptId: 'generate_code'
        });

        expect(logExperienceSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'AI_PROMPT_EXECUTION',
            context: expect.objectContaining({
                projectName,
                promptId: 'generate_code'
            })
        }));
    });

    describe('Re-planning Integration', () => {
        test('should log experiences for re-planning after subtask failure', async () => {
            const projectName = 'replan-test';
            const userInput = 'Create a web application';
            const mockFailedSubtask = {
                id: 'task1',
                title: 'Setup database'
            };

            // Mock initial analysis
            systemManager.agentCoordinator.orchestrateFullAnalysis.mockResolvedValueOnce({
                understanding: { goals: ['Create web app'] },
                plan: { project_title: 'Web Application' },
                subtasks: [mockFailedSubtask]
            });

            // Mock subtask failure
            systemManager.taskExecutor.executeSubtask.mockRejectedValueOnce(
                new Error('Database connection failed')
            );

            // Mock successful re-planning
            systemManager.agentCoordinator.orchestrateReplanningAnalysis.mockResolvedValueOnce({
                understanding: { revised_understanding: { modified_requirements: ['Use local storage instead of database'] } },
                plan: { project_title: 'Web Application (Revised)' },
                subtasks: [{ id: 'task1_revised', title: 'Setup local storage' }]
            });

            // Submit request and let it process
            await systemManager.submitNewRequest(userInput, projectName);
            await new Promise(resolve => setTimeout(resolve, 200));

            // Verify re-planning experience logs
            expect(logExperienceSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'ERROR_RECOVERY_ATTEMPT',
                    context: expect.objectContaining({
                        projectName,
                        subtaskId: mockFailedSubtask.id,
                        recoveryStrategy: 'SCHEDULE_REPLAN'
                    })
                })
            );

            expect(logExperienceSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'PROJECT_ANALYSIS_ORCHESTRATION',
                    context: expect.objectContaining({
                        projectName,
                        isReplanAttempt: true
                    })
                })
            );

            // Verify the sequence of events
            const calls = logExperienceSpy.mock.calls;
            const types = calls.map(call => call[0].type);
            
            expect(types).toContain('PROJECT_ANALYSIS_ORCHESTRATION');
            expect(types).toContain('SUBTASK_EXECUTION');
            expect(types).toContain('ERROR_RECOVERY_ATTEMPT');
            expect(types).toContain('PROJECT_ANALYSIS_ORCHESTRATION'); // Re-planning
        });

        test('should handle multiple re-planning attempts', async () => {
            const projectName = 'multiple-replan-test';
            const userInput = 'Create a complex application';

            // Mock initial analysis
            systemManager.agentCoordinator.orchestrateFullAnalysis.mockResolvedValueOnce({
                understanding: { goals: ['Create complex app'] },
                plan: { project_title: 'Complex Application' },
                subtasks: [{ id: 'task1', title: 'Initial implementation' }]
            });

            // Mock first failure and re-planning
            systemManager.taskExecutor.executeSubtask
                .mockRejectedValueOnce(new Error('First failure'))
                .mockRejectedValueOnce(new Error('Second failure'))
                .mockResolvedValueOnce({ success: true }); // Third attempt succeeds

            // Mock re-planning attempts
            systemManager.agentCoordinator.orchestrateReplanningAnalysis
                .mockResolvedValueOnce({
                    understanding: { revised_understanding: { attempt: 1 } },
                    plan: { project_title: 'Complex Application (Revision 1)' },
                    subtasks: [{ id: 'task1_rev1', title: 'First revision' }]
                })
                .mockResolvedValueOnce({
                    understanding: { revised_understanding: { attempt: 2 } },
                    plan: { project_title: 'Complex Application (Revision 2)' },
                    subtasks: [{ id: 'task1_rev2', title: 'Second revision' }]
                });

            // Submit request and let it process
            await systemManager.submitNewRequest(userInput, projectName);
            await new Promise(resolve => setTimeout(resolve, 300));

            // Verify multiple re-planning attempts were logged
            const replanningAttempts = logExperienceSpy.mock.calls
                .filter(call => 
                    call[0].type === 'PROJECT_ANALYSIS_ORCHESTRATION' && 
                    call[0].context.isReplanAttempt
                );

            expect(replanningAttempts.length).toBeGreaterThanOrEqual(2);

            // Verify final success was logged
            expect(logExperienceSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'SUBTASK_EXECUTION',
                    outcome: expect.objectContaining({
                        status: 'SUCCESS'
                    })
                })
            );
        });
    });

    test('should log experiences for complete project lifecycle', async () => {
        const projectName = 'lifecycle-test';
        const userInput = 'Create a hello world webpage';

        // Mock successful analysis
        systemManager.agentCoordinator.orchestrateFullAnalysis.mockResolvedValueOnce({
            understanding: { goals: ['Create webpage'] },
            plan: { project_title: 'Hello World Webpage' },
            subtasks: [
                { id: 'task1', title: 'Create HTML file' }
            ]
        });

        // Mock successful subtask execution
        systemManager.taskExecutor.executeSubtask.mockResolvedValueOnce({
            success: true,
            artifacts: { 'index.html': '<h1>Hello World</h1>' }
        });

        // Submit request and let it process
        await systemManager.submitNewRequest(userInput, projectName);
        await new Promise(resolve => setTimeout(resolve, 200));

        // Verify all expected experience logs
        expect(logExperienceSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'PROJECT_ANALYSIS_ORCHESTRATION',
                context: expect.objectContaining({ projectName })
            })
        );

        expect(logExperienceSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SUBTASK_EXECUTION',
                context: expect.objectContaining({
                    projectName,
                    subtaskId: 'task1'
                })
            })
        );

        // Verify experience logging order and completeness
        const calls = logExperienceSpy.mock.calls;
        expect(calls.length).toBeGreaterThanOrEqual(2); // At least analysis and subtask
        
        // First call should be project analysis
        expect(calls[0][0].type).toBe('PROJECT_ANALYSIS_ORCHESTRATION');
        
        // Last call should be subtask execution
        const lastCall = calls[calls.length - 1][0];
        expect(lastCall.type).toBe('SUBTASK_EXECUTION');
        expect(lastCall.outcome.status).toBe('SUCCESS');
    });
});
