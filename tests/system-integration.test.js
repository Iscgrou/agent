// tests/system-integration.test.js
import { jest } from '@jest/globals';
import fs from 'fs';

// Mock all core modules for controlled integration testing
jest.mock('../src/core/vertexAI-client.js');
jest.mock('../src/core/prompt-templates.js');
jest.mock('../src/core/sandbox-manager.js');
jest.mock('../src/core/project-persistence.js');
jest.mock('../src/core/configuration-manager.js');
jest.mock('../src/core/error-utils.js');

// Import the actual SystemManager and the classes it instantiates
import SystemManager from '../src/core/system-manager.js';
import AgentCoordinator from '../src/core/agent-coordination.js';
import TaskExecutionSystem from '../src/core/task-execution.js';

// Import mocks to setup their behavior
import { VertexAIChatModel, VertexAICodeModel, VertexAICodeChatModel, VertexAIError } from '../src/core/vertexAI-client.js';
import * as promptTemplates from '../src/core/prompt-templates.js';
import { SandboxManager, CommandTimeoutError } from '../src/core/sandbox-manager.js';
import { ProjectPersistence, StorageAccessError } from '../src/core/project-persistence.js';
import { ConfigurationManager } from '../src/core/configuration-manager.js';
import * as errorUtils from '../src/core/error-utils.js';

[Previous test scenarios 1-5 remain unchanged...]

    // --- Scenario 6: Project-Level Error Recovery and Replan ---
    test('Scenario 6: Test Project-Level Recovery with Replan', async () => {
        // Setup error utils spies
        const classifySpy = jest.spyOn(errorUtils, 'classifyError');
        const strategySpy = jest.spyOn(errorUtils, 'determineRecoveryStrategy');

        // Mock initial project understanding and planning
        mockVertexAIChatModelInstance.generateText
            .mockResolvedValueOnce(createLLMJsonResponse({
                parsed_intent: 'create_data_processing_pipeline',
                project_type: 'DataPipeline',
                key_requirements: ['File Processing', 'Data Transformation', 'Error Handling']
            }))
            // First planning attempt - will fail
            .mockResolvedValueOnce(createLLMJsonResponse({
                error: 'Invalid project structure',
                clarification_needed: ['Project requirements are incomplete']
            }))
            // Second planning attempt after replan - succeeds
            .mockResolvedValueOnce(createLLMJsonResponse({
                project_title: 'RobustDataPipeline',
                major_milestones_or_phases: [
                    { milestone_id: 'M1', title: 'Input Validation' },
                    { milestone_id: 'M2', title: 'Data Processing' }
                ],
                recovery_context: {
                    previous_failure: 'incomplete_requirements',
                    mitigation: 'simplified_scope'
                }
            }))
            // First subtask breakdown - will be part of failed plan
            .mockResolvedValueOnce(createLLMJsonResponse([
                {
                    id: 'T1_Invalid',
                    title: 'Invalid Task Structure',
                    description: 'This task will trigger a replan'
                }
            ]))
            // Second subtask breakdown after replan - succeeds
            .mockResolvedValueOnce(createLLMJsonResponse([
                {
                    id: 'T1_Validation',
                    title: 'Implement Input Validation',
                    description: 'Create input validation module',
                    assigned_persona: 'BackendDeveloper',
                    expected_artifacts: [{ type: 'code', path: 'validation.js' }],
                    success_criteria: ['tests_pass'],
                    language: 'javascript',
                    execution_command: ['node', 'validation.js']
                }
            ]));

        // Mock code generation - will succeed after replan
        mockVertexAICodeModelInstance.generateText
            .mockResolvedValueOnce(createCodeFilesResponse([{
                path: 'validation.js',
                content: `
const validateInput = (data) => {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid input format');
    }
    return true;
};
module.exports = { validateInput };`
            }]));

        // Mock sandbox execution - succeeds after replan
        mockSandboxManagerInstance.executeCommand
            .mockResolvedValueOnce({ exitCode: 0, output: 'Tests passed', errorOutput: '' });

        // Start the test
        systemManager.submitNewRequest("Create a data processing pipeline", currentTestProjectName);
        systemManager.start();

        // Wait for completion
        await new Promise(resolve => {
            const originalCheckpoint = mockProjectPersistenceInstance.createCheckpoint;
            mockProjectPersistenceInstance.createCheckpoint = jest.fn(async (projectName, stageName) => {
                await originalCheckpoint(projectName, stageName);
                const projectState = systemManager.activeProjects.get(projectName);
                if (projectState?.metadata?.status === 'completed_successfully') {
                    resolve();
                }
            });
            setTimeout(resolve, 1000);
        });
        await systemManager.stop();

        // Verify error classification and recovery strategy determination
        expect(classifySpy).toHaveBeenCalled();
        expect(strategySpy).toHaveBeenCalled();

        // Get the final project state
        const projectState = systemManager.activeProjects.get(currentTestProjectName);

        // Verify project-level recovery occurred
        expect(projectState.execution.projectRetryAttempts).toBeDefined();
        expect(projectState.execution.projectRetryAttempts.length).toBeGreaterThan(0);

        // Verify REPLAN_FROM_CHECKPOINT strategy was used
        const replanAttempt = projectState.execution.projectRetryAttempts.find(
            attempt => attempt.strategy.type === 'REPLAN_FROM_CHECKPOINT'
        );
        expect(replanAttempt).toBeDefined();
        expect(replanAttempt.strategy.params.replanReason).toContain('incomplete_requirements');

        // Verify checkpoints were created during recovery
        expect(mockProjectPersistenceInstance.createCheckpoint)
            .toHaveBeenCalledWith(currentTestProjectName, expect.stringMatching(/replan_attempt_\d+/));

        // Verify project status transitions
        expect(mockProjectPersistenceInstance.updateProjectStatus)
            .toHaveBeenCalledWith(currentTestProjectName, 'failed_needs_replan');
        expect(mockProjectPersistenceInstance.updateProjectStatus)
            .toHaveBeenCalledWith(currentTestProjectName, 'replan_in_progress');
        expect(mockProjectPersistenceInstance.updateProjectStatus)
            .toHaveBeenCalledWith(currentTestProjectName, 'completed_successfully');

        // Verify final state
        expect(projectState.metadata.status).toBe('completed_successfully');
        expect(projectState.context.files['validation.js']).toBeDefined();
        expect(projectState.execution.completedTasks).toContain('T1_Validation');
    });
});
