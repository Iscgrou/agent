// src/core/system-manager.js
// Orchestrates the entire AI development platform, managing the lifecycle,
// coordinating between high-level components, and ensuring continuous, resilient operation.

import AgentCoordinator from './agent-coordination.js';
import TaskExecutionSystem from './task-execution.js';
import LearningSystem from './learning-system.js';
import { SandboxManager, SandboxError /* Import specific error if needed */ } from './sandbox-manager.js';
import { ProjectPersistence, ProjectNotFoundError, PersistenceError } from './project-persistence.js';
import { ConfigurationManager } from './configuration-manager.js';
import { PlatformError, classifyError, determineRecoveryStrategy, CoordinationError } from './error-utils.js'; // Import new error utilities
import { VertexAIError } from './vertexAI-client.js'; // Assuming VertexAIError is exported and inherits PlatformError

// SimpleQueue definition (as before)
class SimpleQueue {
    constructor() { this.items = []; }
    enqueue(item) { this.items.push(item); }
    dequeue() { return this.items.shift(); }
    isEmpty() { return this.items.length === 0; }
    peek() { return this.items[0]; }
    size() { return this.items.length; }
}

const MAIN_LOOP_INTERVAL_MS = 1000; // Default, can be overridden by config

class SystemManager {
    constructor(initialConfig = {}) {
        this.configManager = new ConfigurationManager(initialConfig.configurationManager || {
            defaultConfigPath: './config/default.config.json',
            envSpecificConfigPath: './config/config.{NODE_ENV}.json',
        });
        console.log('[SystemManager] ConfigurationManager bootstrapped.');

        const persistenceConfig = this.configManager.get('persistence', { projectsBasePath: './ai_projects_data' });
        const sandboxConfig = this.configManager.get('sandbox', {});
        const vertexAIConf = this.configManager.get('vertexAI', {});
        const learningSystemConfig = this.configManager.get('learningSystem', {});

        this.projectPersistence = new ProjectPersistence(persistenceConfig);
        this.sandboxManager = new SandboxManager(sandboxConfig);

        this.agentCoordinator = new AgentCoordinator(
            vertexAIConf.chat || vertexAIConf,
            this.projectPersistence,
            this.sandboxManager,
            this.configManager,
            this.learningSystem
        );

        this.learningSystem = new LearningSystem(learningSystemConfig);

        this.taskExecutor = new TaskExecutionSystem(
            vertexAIConf.code || vertexAIConf,
            vertexAIConf.codeChat || vertexAIConf,
            this.sandboxManager,
            this.projectPersistence,
            this.configManager,
            this.learningSystem
        );

        this.state = {
            isRunning: false,
            systemHealth: 'INITIALIZING',
            lastGlobalError: null,
        };
        this.mainTaskQueue = new SimpleQueue();
        this.activeProjects = new Map();
        this.operationalLoopIntervalId = null;
        this.projectRetryAttempts = new Map(); // projectName -> attemptCount for main request retries
        console.log('[SystemManager] Core components initialized.');
    }

    async initialize() {
        console.log('[SystemManager] Initializing System Manager subsystems...');
        try {
            await this.sandboxManager.initialize();
            this.state.systemHealth = 'READY';
            console.log('[SystemManager] System Manager initialized and ready.');
            return true;
        } catch (error) {
            this.state.systemHealth = 'ERROR_INITIALIZATION';
            this.state.lastGlobalError = this._wrapAsPlatformError(error, {operation: 'initialize'}, 'FATAL');
            console.error('[SystemManager] System initialization failed:', this.state.lastGlobalError);
            throw this.state.lastGlobalError;
        }
    }

    start() {
        if (this.state.isRunning) {
            console.warn('[SystemManager] System is already running.');
            return;
        }
        if (this.state.systemHealth !== 'READY') {
            const msg = '[SystemManager] System not ready. Please initialize first.';
            console.error(msg);
            throw new PlatformError(msg, 'SYSTEM_NOT_READY', {}, null, 'FATAL');
        }

        this.state.isRunning = true;
        console.log('[SystemManager] System Manager started. Operational loop initiated.');
        this.operationalLoopIntervalId = setInterval(
            () => this._runOperationalLoop().catch(err => this._handleLoopError(err)),
            this.configManager.get('system.mainLoopIntervalMs', MAIN_LOOP_INTERVAL_MS)
        );
    }

    async stop() {
        if (!this.state.isRunning) {
            console.warn('[SystemManager] System is not running.');
            return;
        }
        this.state.isRunning = false;
        if (this.operationalLoopIntervalId) {
            clearInterval(this.operationalLoopIntervalId);
            this.operationalLoopIntervalId = null;
        }
        if (this.sandboxManager) {
             await this.sandboxManager.cleanupAllContainers();
        }
        console.log('[SystemManager] System Manager stopped and resources potentially cleaned.');
    }

    _wrapAsPlatformError(error, context = {}, defaultSeverity = 'UNKNOWN', operationName = 'unspecified_operation') {
        if (error instanceof PlatformError) return error;
        return new PlatformError(
            error.message,
            'UNHANDLED_SYSTEM_ERROR',
            { ...context, operation: operationName, originalName: error.name },
            error,
            defaultSeverity
        );
    }

    _handleLoopError(error) {
        const platformError = this._wrapAsPlatformError(error, { operation: '_runOperationalLoop'}, 'FATAL');
        console.error('[SystemManager] CRITICAL ERROR IN OPERATIONAL LOOP:', platformError);
        this.state.systemHealth = 'ERROR_LOOP_FAILURE';
        this.state.lastGlobalError = platformError;
        if (this.state.isRunning) {
            this.stop().catch(stopErr => console.error("[SystemManager] Error during emergency stop:", stopErr));
        }
    }

async _runOperationalLoop() {
        if (!this.state.isRunning || this.mainTaskQueue.isEmpty()) {
            return;
        }

        // Ensure LearningSystem is initialized
        if (!this.learningSystem.isInitialized) {
            await this.learningSystem.initialize();
        }
        if (this.state.systemHealth.startsWith('ERROR_')) { // More specific check
            console.error(`[SystemManager] System in error state: ${this.state.systemHealth}. Halting further operations.`);
            return;
        }

        const request = this.mainTaskQueue.peek();
        console.log(`[SystemManager] Attempting to process request for project: ${request.projectName}`);

        let projectState = this.activeProjects.get(request.projectName);
        if (!projectState || request.options?.forceReloadState) {
            projectState = await this._loadOrInitializeProject(request.projectName, request.userInput, request.projectContext);
            if (!projectState) {
                this.mainTaskQueue.dequeue();
                return;
            }
        }
        
        // Reset project-level retry attempts if this is a "fresh" run of the request (not a SystemManager-level retry)
        if (!request.isRetry) {
            this.projectRetryAttempts.set(request.projectName, 0);
        }

        try {
            if (projectState.metadata.status?.startsWith('failed')) {
                console.warn(`[SystemManager] Project ${request.projectName} is in a failed state (${projectState.metadata.status}). Re-evaluation needed if it's to be retried.`);
                // Depending on policy, might try to recover or just leave it. For now, loop will skip it if not dequeued.
                // If we implement retry at this level, this is where we check.
            }

            if (!projectState.plan || request.options?.forceReprocessAnalysis || projectState.metadata.status === 'failed_needs_replan') {
                console.log(`[SystemManager] Orchestrating full analysis for ${request.projectName}. Status: ${projectState.metadata.status}`);
                projectState.metadata.status = 'processing_analysis'; // Update status
                this.activeProjects.set(request.projectName, projectState); // Save updated status
                
                const startTime = Date.now();
                let analysisResult;
                try {
                    analysisResult = await this.agentCoordinator.orchestrateFullAnalysis(
                        projectState.conversation.originalRequest,
                        request.projectName,
                        {
                            context: projectState.context,
                            forceReprocessUnderstanding: request.options?.forceReprocessUnderstanding || projectState.metadata.status === 'failed_needs_replan',
                            forceReprocessPlan: request.options?.forceReprocessPlan || projectState.metadata.status === 'failed_needs_replan',
                            forceReprocessTasks: request.options?.forceReprocessTasks || projectState.metadata.status === 'failed_needs_replan',
                        }
                    );

                    // Log successful analysis experience
                    await this.learningSystem.logExperience({
                        type: 'PROJECT_ANALYSIS_ORCHESTRATION',
                        context: {
                            projectName: request.projectName,
                            requestId: request.requestId,
                            userInput: projectState.conversation.originalRequest
                        },
                        outcome: {
                            status: 'SUCCESS',
                            durationMs: Date.now() - startTime,
                            artifacts: [
                                {
                                    type: 'project_understanding',
                                    validationStatus: 'passed'
                                },
                                {
                                    type: 'project_plan',
                                    validationStatus: 'passed'
                                }
                            ]
                        }
                    });
                } catch (analysisError) {
                    // Log failed analysis experience
                    await this.learningSystem.logExperience({
                        type: 'PROJECT_ANALYSIS_ORCHESTRATION',
                        context: {
                            projectName: request.projectName,
                            requestId: request.requestId,
                            userInput: projectState.conversation.originalRequest
                        },
                        outcome: {
                            status: 'FAILURE',
                            durationMs: Date.now() - startTime,
                            error: {
                                code: analysisError.code || 'UNKNOWN_ERROR',
                                message: analysisError.message,
                                severity: analysisError.severity || 'CRITICAL',
                                stackPreview: analysisError.stack?.split('\n').slice(0, 3).join('\n')
                            }
                        }
                    });
                    throw analysisError;
                }
                projectState.understanding = analysisResult.understanding;
                projectState.plan = analysisResult.plan;
                projectState.execution = {
                    currentPlanTitle: analysisResult.plan.project_title,
                    subtasksFull: analysisResult.subtasks,
                    subtasksRemainingIds: analysisResult.subtasks.map(st => st.id),
                    subtasksCompletedIds: [],
                    currentSubtaskAttemptNumber: 0,
                };
                projectState.metadata.status = 'analysis_complete';
                await this._saveProjectCheckpoint(request.projectName, projectState, 'analysis_complete_stage');
            }

            if (projectState.execution.subtasksRemainingIds && projectState.execution.subtasksRemainingIds.length > 0) {
                 projectState.metadata.status = 'processing_tasks';
                 this.activeProjects.set(request.projectName, projectState); // Update status
                await this._processProjectSubtasks(request.projectName, projectState); // Pass the whole state
            } else if (projectState.metadata.status !== 'completed_no_tasks' && !projectState.metadata.status?.startsWith('failed')) {
                 console.warn(`[SystemManager] No subtasks to process for project: ${request.projectName} after analysis, but status was ${projectState.metadata.status}.`);
                 projectState.metadata.status = (projectState.execution.subtasksFull && projectState.execution.subtasksFull.length > 0) ? 'all_tasks_processed_vacuously' : 'completed_no_tasks';
            }

            if (projectState.execution.subtasksRemainingIds && projectState.execution.subtasksRemainingIds.length === 0 &&
                !projectState.metadata.status?.startsWith('failed_')) {
                projectState.metadata.status = 'completed_successfully';
                console.log(`[SystemManager] Successfully processed all tasks for project: ${request.projectName}`);
            }
            await this._saveProjectCheckpoint(request.projectName, projectState, 'main_request_iteration_complete');

            if (projectState.metadata.status === 'completed_successfully' || 
                projectState.metadata.status === 'failed' /* unrecoverable overall fail */) {
                this.mainTaskQueue.dequeue();
                this.projectRetryAttempts.delete(request.projectName); // Clear retry count
            }

        } catch (projectLevelError) { // Errors from AgentCoordinator or unhandled from _processProjectSubtasks
            const wrappedError = this._wrapAsPlatformError(projectLevelError, { operation:'_runOperationalLoop', projectName: request.projectName }, 'CRITICAL');
            console.error(`[SystemManager] Project-level error for "${request.projectName}":`, wrappedError);
            await this._handleProjectLevelError(request.projectName, wrappedError, projectState, request);
        }
    }

    async _loadOrInitializeProject(projectName, userInput, initialRequestContext) {
        let projectState = this.activeProjects.get(projectName);
        if (projectState && !initialRequestContext?.forceReloadState) return projectState;

        if (this.projectPersistence) {
            try {
                const loadedState = await this.projectPersistence.loadProject(projectName);
                if (loadedState) {
                    console.log(`[SystemManager] Loaded existing project: ${projectName} from persistence.`);
                    projectState = loadedState;
                    // Merge or update with current request if it's a continuation
                    projectState.conversation.currentRequest = userInput;
                    if (initialRequestContext?.options) projectState.currentRequestOptions = initialRequestContext.options;
                    this.activeProjects.set(projectName, projectState);
                    return projectState;
                }
            } catch (error) {
                console.warn(`[SystemManager] Failed to load project ${projectName} from persistence, treating as new: ${error.message}`);
            }
        }
        projectState = {
            metadata: { projectName, created: new Date(), lastModified: new Date(), version: '1.0.0', status: 'new' },
            context: initialRequestContext?.files ? { files: { ...initialRequestContext.files } } : { files: {} },
            execution: { subtasksRemainingIds: [], subtasksCompletedIds: [], subtasksFull: [], currentSubtaskAttemptNumber: 0 },
            conversation: { originalRequest: userInput, relevantHistory: [] }
        };
        this.activeProjects.set(projectName, projectState);
        await this._saveProjectCheckpoint(projectName, projectState, 'initialization');
        return projectState;
    }

    async _processProjectSubtasks(projectName, projectState) {
        const remainingSubtaskIdsThisIteration = [...projectState.execution.subtasksRemainingIds];

        for (const subtaskId of remainingSubtaskIdsThisIteration) {
            if (!this.state.isRunning)  throw new PlatformError("System stop requested", "SYSTEM_STOP_REQUESTED", {projectName, subtaskId},null,"CRITICAL");

            const subtask = projectState.execution.subtasksFull.find(st => st.id === subtaskId);
            if (!subtask) {
                console.error(`[SystemManager] Subtask ID ${subtaskId} not found in full list for project ${projectName}. Removing from remaining.`);
                projectState.execution.subtasksRemainingIds = projectState.execution.subtasksRemainingIds.filter(id => id !== subtaskId);
                continue;
            }

            console.log(`[SystemManager] --> Processing subtask ${subtask.id}: ${subtask.title}`);
            projectState.execution.currentSubtaskId = subtask.id;
            if (this.notificationService) this.notificationService.broadcastTaskUpdate(projectName, subtask, 'started');

            let systemLevelSubtaskAttempt = (projectState.execution.subtaskAttempts[subtaskId] || 0) + 1;
            projectState.execution.subtaskAttempts[subtaskId] = systemLevelSubtaskAttempt;

            try {
                const startTime = Date.now();
                const result = await this.taskExecutor.executeSubtask(
                    subtask, projectName, projectState.context.files || {}
                );

                // Log subtask execution experience
                await this.learningSystem.logExperience({
                    type: 'SUBTASK_EXECUTION',
                    context: {
                        projectName,
                        requestId: projectState.requestId,
                        subtaskId: subtask.id,
                        subtaskTitle: subtask.title,
                        subtaskType: subtask.type,
                        agentPersona: subtask.assigned_persona
                    },
                    outcome: {
                        status: result.success ? 'SUCCESS' : 'FAILURE',
                        durationMs: Date.now() - startTime,
                        artifacts: result.artifacts ? Object.entries(result.artifacts).map(([path, _]) => ({
                            type: 'code_file',
                            path,
                            validationStatus: 'passed'
                        })) : []
                    }
                });

                if (result.success) {
                    projectState.context.files = { ...(projectState.context.files || {}), ...result.artifacts };
                    projectState.execution.subtasksCompletedIds.push(subtask.id);
                    projectState.execution.subtasksRemainingIds = projectState.execution.subtasksRemainingIds.filter(id => id !== subtaskId);
                    delete projectState.execution.subtaskAttempts[subtaskId];
                    projectState.execution.lastError = null;
                    projectState.metadata.status = 'processing_tasks'; // Keep this status until all done
                    await this._saveProjectCheckpoint(projectName, projectState, `subtask_${subtask.id}_success`);
                    if (this.notificationService) this.notificationService.broadcastTaskUpdate(projectName, subtask, 'completed', { artifacts: Object.keys(result.artifacts || {}).length });
                } else {
                    const errorFromExecutor = this._wrapAsPlatformError(
                        result.error || new Error(`Subtask ${subtask.id} failed in TaskExecutor without specific error.`),
                        {operation: 'TaskExecutor.executeSubtask', projectName, subtaskId, taskTitle: subtask.title},
                        result.error instanceof PlatformError ? result.error.severity : 'RECOVERABLE_WITH_MODIFICATION'
                    );
                    throw errorFromExecutor; // Throw to outer catch in this function for centralized recovery decision
                }
            } catch (errorCaught) { // Catches errors from taskExecutor.executeSubtask OR re-thrown errorFromExecutor
                const subtaskProcessingError = this._wrapAsPlatformError(errorCaught, { operation:'_processSubtasks_catch_block', projectName, subtaskId, attempt: systemLevelSubtaskAttempt });
                console.error(`[SystemManager] <|> Error during subtask ${subtask.id} (SysAttempt ${systemLevelSubtaskAttempt}):`, subtaskProcessingError.message);
                
                const operationContext = {
                    projectName, subtaskId, currentSubtask: subtask,
                    isOptionalTask: subtask.isOptional || this.configManager.get(`subtaskConfiguration.${subtask.type}.isOptional`, false)
                };
                const errorClassification = classifyError(subtaskProcessingError, operationContext);
                const recovery = determineRecoveryStrategy(
                    errorClassification,
                    { projectName, currentSubtask: subtask, attemptNumber: systemLevelSubtaskAttempt, projectState },
                    this.configManager
                );

                console.log(`[SystemManager] <|> For subtask ${subtask.id}, Error: ${errorClassification.classifiedType} (${errorClassification.severity}), Suggested: ${errorClassification.suggestedAction}, Determined Recovery: ${recovery.type}`);
                projectState.execution.lastError = { ...errorClassification, recoveryAttempted: recovery.type, details: subtaskProcessingError.message, originalErrorStack: subtaskProcessingError.originalError?.stack };
                if (this.notificationService) this.notificationService.broadcastTaskUpdate(projectName, subtask, 'failed', { error: projectState.execution.lastError });

                if (recovery.type === 'RETRY_AS_IS' || recovery.type === 'RETRY_WITH_PARAMS') {
                    projectState.metadata.status = 'subtask_pending_retry';
                    console.log(`[SystemManager] <|> Subtask ${subtask.id} (attempt ${systemLevelSubtaskAttempt}) marked for retry. Next SystemManager loop will re-attempt. Delay: ${recovery.delayMs || 0}ms.`);
                    // Subtask remains in `subtasksRemainingIds`. Increment its attempt count.
                    await this._saveProjectCheckpoint(projectName, projectState, `subtask_${subtask.id}_attempt_${systemLevelSubtaskAttempt}_pending_retry`);
                    // This 'return' exits _processProjectSubtasks. The main loop will decide if it re-runs _processProjectSubtasks for this project.
                    if(recovery.delayMs) await new Promise(r => setTimeout(r, recovery.delayMs));
                    return; // Signal to _runOperationalLoop that this project's subtask processing for *this cycle* is pausing for retry.
                } else if (recovery.type === 'SCHEDULE_REPLAN') { // Changed from REPLAN_FROM_CHECKPOINT
                    console.log(`[SystemManager] <|> Triggering project re-plan for ${projectName} due to unrecoverable subtask ${subtask.id}.`);
                    projectState.metadata.status = 'failed_needs_replan';
                    projectState.execution.replanReason = recovery.params?.replanReason || `Unrecoverable failure in subtask ${subtask.id}`;
                    projectState.execution.subtasksRemainingIds = []; // New plan will be generated
                    await this._saveProjectCheckpoint(projectName, projectState, `subtask_${subtask.id}_failed_triggering_replan`);
                    // Let _runOperationalLoop handle the 'failed_needs_replan' status to initiate replan via AgentCoordinator
                    throw new CoordinationError( // Throw to signal _runOperationalLoop to handle project-level replan
                        projectState.execution.replanReason,
                        "REPLAN_REQUIRED_BY_SUBTASK_FAILURE",
                        { projectName, subtaskId, failedSubtaskTitle: subtask.title, recoveryParams: recovery.params },
                        subtaskProcessingError,
                        "CRITICAL"
                    );
                } else if (recovery.type === 'SKIP_OPTIONAL_TASK') {
                    console.warn(`[SystemManager] <|> Skipping optional FAILED subtask ${subtask.id}.`);
                    projectState.execution.subtasksCompletedIds.push(`${subtask.id} (skipped_after_error)`);
                    projectState.execution.subtasksRemainingIds = projectState.execution.subtasksRemainingIds.filter(id => id !== subtaskId);
                    delete projectState.execution.subtaskAttempts[subtaskId]; // Reset attempts as it's skipped
                    projectState.metadata.status = 'processing_tasks'; // Continue with other tasks
                    await this._saveProjectCheckpoint(projectName, projectState, `subtask_${subtask.id}_skipped_on_error`);
                    // Continue to the next subtask in this 'for...of' loop
                } else { // HALT_PROJECT_PROCESSING
                    projectState.metadata.status = `failed_subtask_unrecoverable_halt_${subtaskId}`;
                    await this._saveProjectCheckpoint(projectName, projectState, `subtask_${subtask.id}_halted`);
                    throw new TaskOrchestrationError( // Throw to signal _runOperationalLoop
                        `Unrecoverable failure processing subtask ${subtask.id} after ${systemLevelSubtaskAttempt} attempts. Project processing for this request will halt.`,
                        'SUBTASK_PROCESSING_HALTED',
                        { projectName, subtaskId, underlyingErrorMsg: subtaskProcessingError.message },
                        subtaskProcessingError,
                        'CRITICAL'
                    );
                }
            } finally {
                if (projectState.execution.currentSubtaskId === subtaskId &&
                   (!projectState.execution.subtasksRemainingIds.includes(subtaskId) || projectState.metadata.status?.startsWith('failed_') || projectState.metadata.status === 'subtask_pending_retry')) {
                    projectState.execution.currentSubtaskId = null;
                }
            }
        } // End for...of subtasks loop

        if (projectState.execution.subtasksRemainingIds && projectState.execution.subtasksRemainingIds.length === 0 && !projectState.metadata.status?.startsWith('failed_')) {
             projectState.metadata.status = 'all_tasks_processed_successfully';
             console.log(`[SystemManager] All subtasks for project ${projectName} successfully processed or skipped in this iteration.`);
        } else if (projectState.execution.subtasksRemainingIds?.length > 0 && !projectState.metadata.status?.startsWith('failed_') && projectState.metadata.status !== 'subtask_pending_retry') {
            // Still tasks remaining, but no immediate retry scheduled for the one just processed.
            projectState.metadata.status = 'processing_tasks';
        }
    }

    submitNewRequest(userInput, projectName, options = {}) {
        if (!this.state.isRunning || this.state.systemHealth !== 'READY') {
            this.state.systemHealth = this.state.systemHealth === 'READY' ? 'WARNING_NOT_RUNNING' : this.state.systemHealth;
            const msg ="[SystemManager] System not running or not fully ready. Cannot submit request.";
            console.error(msg, {isRunning: this.state.isRunning, health: this.state.systemHealth});
            return { success: false, message: msg, code: 'SYSTEM_NOT_OPERATIONAL' };
        }
        if (!projectName || typeof projectName !== 'string' || projectName.trim() === "") {
             const errMsg = "[SystemManager] Invalid or empty projectName provided.";
             console.error(errMsg);
             return { success: false, message: errMsg, code: 'INVALID_PROJECT_NAME' };
        }

        console.log(`[SystemManager] New request submitted for project "${projectName}": "${userInput.substring(0,100)}..."`);
        // Forcing reprocess options from the request into the project state if it's a new request or a retry of the main request
        const requestItem = {
            userInput,
            projectName,
            options: options || {},
            projectContext: { files: options?.initialFileContext || {} },
            isRetry: options?.isRetry || false // Flag for SystemManager retries
        };
        this.mainTaskQueue.enqueue(requestItem);

        // Initialize project state if it doesn't exist, to ensure it's in activeProjects
        if (!this.activeProjects.has(projectName)) {
            this._loadOrInitializeProject(projectName, userInput, requestItem.projectContext)
                .catch(err => console.error(`[SystemManager] Error initializing project state for ${projectName} during submission: ${err.message}`));
        } else { // If project exists, update relevant parts for the new request
            const existingState = this.activeProjects.get(projectName);
            existingState.conversation.currentRequest = userInput;
            existingState.currentRequestOptions = options || {};
            // If this new submission implies a full restart of the project, reset its status
            if (options?.forceReprocessAnalysis || options?.forceReloadState) {
                existingState.metadata.status = 'new'; // Reset status for reprocessing
                existingState.execution = { subtasksRemainingIds: [], subtasksCompletedIds: [], subtasksFull: [], currentSubtaskAttemptNumber: 0 };
            }
        }
        return { success: true, message: "Request submitted successfully.", projectName };
    }

   async _saveProjectCheckpoint(projectName, projectState, stageName) { // Pass projectState
        if (this.projectPersistence) {
            // const projectState = this.activeProjects.get(projectName); // Already passed
            if (projectState) {
                try {
                    projectState.metadata.lastModified = new Date();
                    // Use a consistent checkpoint ID format if createCheckpoint expects it
                    const checkpointId = `${stageName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`;
                    // Update the main project state with the new checkpoint ID
                    projectState.execution.lastCheckpointId = checkpointId;

                    // We need to ensure that projectPersistence.createCheckpoint internally saves
                    // the *current* state of the project it's checkpointing.
                    // One way is to pass the projectState to it.
                    // Assuming ProjectPersistence.createCheckpoint might look like:
                    // async createCheckpoint(projectName, checkpointId, dataToSave = null)
                    // if dataToSave is null, it loads project 'projectName', else it saves dataToSave as checkpoint.
                    // This requires modification in ProjectPersistence or a different method like saveProjectAsCheckpoint.

                    // For current ProjectPersistence:
                    // 1. Save the current state of the main project (with updated lastCheckpointId)
                    await this.projectPersistence.saveProject(projectName, projectState);
                    // 2. Then create a "checkpoint" which is a copy of this saved state under a new name
                    await this.projectPersistence.createCheckpoint(projectName, checkpointId); // This implies it copies from the main project file.
                    console.log(`[SystemManager] Project ${projectName} state saved & checkpoint created for stage: ${stageName} (CP ID: ${checkpointId})`);
                } catch (error) {
                    const wrappedError = this._wrapAsPlatformError(error, {operation: '_saveProjectCheckpoint', projectName, stageName }, 'CRITICAL');
                    console.error(`[SystemManager] Failed to save project/checkpoint for ${projectName} at stage ${stageName}:`, wrappedError);
                }
            } else {
                console.warn(`[SystemManager] Attempted to save checkpoint for project not in active map: ${projectName}`);
            }
        }
    }

    async _handleProjectLevelError(projectName, error, projectState, request) {
    if (!projectState) {
        const defaultInput = request?.userInput || "Unknown initial request";
        projectState = this.activeProjects.get(projectName) || {
            metadata: { projectName, status: 'failed_unknown_state', created: new Date(), lastModified: new Date() },
            execution: {}, context: {}, conversation: { originalRequest: defaultInput }
        };
        this.activeProjects.set(projectName, projectState);
    }

    const errorClassification = classifyError(error, { projectName, isProjectLevelError: true });
    
    // Log project-level error recovery attempt
    await this.learningSystem.logExperience({
        type: 'ERROR_RECOVERY_ATTEMPT',
        context: {
            projectName,
            requestId: request?.requestId,
            errorClassification
        },
        outcome: {
            status: 'IN_PROGRESS',
            error: {
                code: error.code || 'UNKNOWN_ERROR',
                message: error.message,
                severity: error.severity || 'CRITICAL',
                stackPreview: error.stack?.split('\n').slice(0, 3).join('\n')
            }
        }
    });
    let projectSystemRetries = this.projectRetryAttempts.get(projectName) || 0;

    const recoveryContext = { projectName, attemptNumber: projectSystemRetries, projectState };
    let recoveryStrategy = determineRecoveryStrategy(errorClassification, recoveryContext, this.configManager);

    console.error(`[SystemManager] Handling PROJECT-LEVEL error for ${projectName}. Type: ${errorClassification.classifiedType}, Severity: ${errorClassification.severity}, Suggested: ${errorClassification.suggestedAction}, Determined Recovery: ${recoveryStrategy.type}, Project ReplanRetries: ${projectSystemRetries}`);

    projectState.metadata.status = 'failed'; // Default, specific status if recovery applies
    projectState.execution.lastError = {
        message: error.message, code: error.code, context: error.context,
        stack: error.stack, timestamp: new Date().toISOString(),
        classification: errorClassification, recoveryAttempted: recoveryStrategy.type
    };
    this.activeProjects.set(projectName, projectState);

    // If the error itself was a trigger for replan (e.g. from _processSubtasks), it's already set
    if (error.code === 'REPLAN_REQUIRED_BY_SUBTASK_FAILURE') {
        recoveryStrategy.type = 'SCHEDULE_REPLAN'; // Force this strategy
    }

    if (recoveryStrategy.type === 'SCHEDULE_REPLAN') {
        const maxProjectReplanRetries = this.configManager.get('errorHandling.maxProjectRetries.replan', 1);
        if (projectSystemRetries < maxProjectReplanRetries) {
            this.projectRetryAttempts.set(projectName, projectSystemRetries + 1);

            projectState.metadata.status = 'failed_needs_replan';
            console.log(`[SystemManager] Project ${projectName} requires re-planning. This request will be re-evaluated with re-plan flags (Attempt ${projectSystemRetries + 1}/${maxProjectReplanRetries}).`);
            // The original request object (peeked from queue) 'request' will be processed again in the next loop.
            // Its options need to be updated to reflect that it's a replan.
            if (request) {
                request.options = {
                    ...(request.options || {}),
                    forceReprocessAnalysis: true, // This is the key for AgentCoordinator
                    forceReloadState: true,       // Load from the last good checkpoint
                    isSystemRetryAttempt: true,    // Indicate SystemManager is retrying the whole request
                    failureContextForReplan: projectState.execution.lastError, // Pass failure context
                    replanOptions: { preserveSuccessfulTasks: true, ...(recoveryStrategy.params || {}) } // Example replan option from strategy
                };
            } else {
                console.error("[SystemManager] CRITICAL: Cannot set retry options as original request object from queue is unavailable in _handleProjectLevelError.");
                projectState.metadata.status = 'failed_terminal_internal_error'; // Prevent infinite loop
            }
        } else {
            console.error(`[SystemManager] Max project re-plan retries (${maxProjectReplanRetries}) reached for ${projectName}. Marking as terminally failed.`);
            projectState.metadata.status = 'failed_terminal_replan_exhausted';
            this.projectRetryAttempts.delete(projectName);
            if (this.mainTaskQueue.peek()?.projectName === projectName) this.mainTaskQueue.dequeue();
        }
    } else { // Includes HALT_PROJECT_PROCESSING or other unhandled project-level recoveries
        console.error(`[SystemManager] Unrecoverable project-level error for project ${projectName}, or recovery strategy leads to HALT. Project processing terminated for this request.`);
        projectState.metadata.status = 'failed_terminal_unrecoverable';
        this.projectRetryAttempts.delete(projectName);
        if (this.mainTaskQueue.peek()?.projectName === projectName) this.mainTaskQueue.dequeue();
    }

    await this._saveProjectCheckpoint(projectName, projectState, `project_error_final_state_${projectState.metadata.status}`);
    if (this.notificationService) this.notificationService.broadcastProjectStatus(projectState);
   }

    /**
     * Sets the notification service for SystemManager to use for broadcasting updates.
     * @param {NotificationService} service - Instance of NotificationService.
     */
    setNotificationService(service) {
        this.notificationService = service;
        console.log('[SystemManager] NotificationService registered.');
    }
} // End of SystemManager class

export default SystemManager;
