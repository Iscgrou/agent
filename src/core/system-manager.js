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
            this.sandboxManager
        );

        this.taskExecutor = new TaskExecutionSystem(
            vertexAIConf.code || vertexAIConf,
            vertexAIConf.codeChat || vertexAIConf,
            this.sandboxManager,
            this.projectPersistence,
            this.configManager
        );
        this.learningSystem = new LearningSystem(learningSystemConfig);

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
                
                const analysisResult = await this.agentCoordinator.orchestrateFullAnalysis(
                    projectState.conversation.originalRequest,
                    request.projectName,
                    {
                        context: projectState.context,
                        forceReprocessUnderstanding: request.options?.forceReprocessUnderstanding || projectState.metadata.status === 'failed_needs_replan',
                        forceReprocessPlan: request.options?.forceReprocessPlan || projectState.metadata.status === 'failed_needs_replan',
                        forceReprocessTasks: request.options?.forceReprocessTasks || projectState.metadata.status === 'failed_needs_replan',
                    }
                );
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

    async _processProjectSubtasks(projectName, projectState) { // Pass projectState directly
        const subtasksToAttemptIds = [...projectState.execution.subtasksRemainingIds];

        for (const subtaskId of subtasksToAttemptIds) {
            if (!this.state.isRunning) { console.log("[SystemManager] System stop requested during subtask processing."); return; }

            const subtask = projectState.execution.subtasksFull.find(st => st.id === subtaskId);
            if (!subtask) {
                console.error(`[SystemManager] Subtask ID ${subtaskId} not found in full list for project ${projectName}. Removing from remaining.`);
                projectState.execution.subtasksRemainingIds = projectState.execution.subtasksRemainingIds.filter(id => id !== subtaskId);
                continue;
            }

            console.log(`[SystemManager] Starting subtask ${subtask.id}: ${subtask.title}`);
            projectState.execution.currentSubtaskId = subtask.id;
            // Ensure attempt number is reset for a new subtask, or incremented for retry of *this* subtask
            // This attempt refers to SystemManager level retries for the subtask, not TaskExecutor's internal debug attempts
            let systemManagerSubtaskAttempt = projectState.execution.subtaskAttempts?.[subtaskId] || 0;
            systemManagerSubtaskAttempt++;
            projectState.execution.subtaskAttempts = { ...(projectState.execution.subtaskAttempts || {}), [subtaskId]: systemManagerSubtaskAttempt };


            try {
                const result = await this.taskExecutor.executeSubtask(
                    subtask,
                    projectName,
                    projectState.context.files || {}
                );

                if (result.success) {
                    console.log(`[SystemManager] Subtask ${subtask.id} completed successfully.`);
                    projectState.context.files = { ...(projectState.context.files || {}), ...result.artifacts };
                    projectState.execution.subtasksCompletedIds.push(subtask.id);
                    projectState.execution.subtasksRemainingIds = projectState.execution.subtasksRemainingIds.filter(id => id !== subtask.id);
                    delete projectState.execution.subtaskAttempts?.[subtaskId]; // Clear attempts on success
                    projectState.metadata.status = 'processing_tasks'; // Still processing if more tasks
                    await this._saveProjectCheckpoint(projectName, projectState, `subtask_${subtask.id}_complete`);
                } else {
                    const subtaskError = this._wrapAsPlatformError(result.error || new Error(`Subtask ${subtask.id} failed: No specific error details.`), {operation: 'executeSubtask', projectName, subtaskId:subtask.id}, 'RECOVERABLE_WITH_MODIFICATION');
                    throw subtaskError; // Throw to trigger recovery logic below
                }
            } catch (errorFromExecutorOrAbove) { // Catch errors from taskExecutor or if it re-threw a wrapped error
                const wrappedSubtaskError = this._wrapAsPlatformError(errorFromExecutorOrAbove, {operation:'_processProjectSubtasks_inner_catch', projectName, subtaskId: subtask.id});
                console.error(`[SystemManager] Error during execution of subtask ${subtask.id} (attempt ${systemManagerSubtaskAttempt}):`, wrappedSubtaskError);
                
                const operationContextForClassification = {
                    projectName,
                    subtaskId: subtask.id,
                    currentSubtask: subtask,
                    isOptionalTask: subtask.isOptional || false // Assume subtask might have this property
                };
                const errorClassification = classifyError(wrappedSubtaskError, operationContextForClassification);
                const recovery = determineRecoveryStrategy(
                    errorClassification,
                    { projectName, currentSubtask: subtask, attemptNumber: systemManagerSubtaskAttempt, projectState },
                    this.configManager
                );

                console.log(`[SystemManager] For subtask ${subtask.id}, determined recovery: ${recovery.type}`);
                projectState.execution.lastError = { ...errorClassification, recoveryAttempted: recovery.type };

                if (recovery.type === 'RETRY_AS_IS' || recovery.type === 'RETRY_WITH_PARAMS') {
                    // Parameters for retry might be set in recovery.params (e.g., for TaskExecutor)
                    // The subtask remains in subtasksRemainingIds. The current iteration of _processProjectSubtasks for *this* subtask ends.
                    // The outer _runOperationalLoop will call _processProjectSubtasks again, which will re-attempt it.
                    console.log(`[SystemManager] Subtask ${subtask.id} will be retried (attempt ${systemManagerSubtaskAttempt +1}) in next cycle. Delay: ${recovery.delayMs || 0}ms`);
                    await this._saveProjectCheckpoint(projectName, projectState, `subtask_${subtask.id}_pending_retry`);
                    if(recovery.delayMs) await new Promise(r => setTimeout(r, recovery.delayMs));
                    return; // Exit _processProjectSubtasks, main loop will recall it. This leads to one subtask retry per main loop.
                            // For multiple retries within one main loop pass, this needs a nested while loop for the current subtask.
                } else if (recovery.type === 'REPLAN_FROM_CHECKPOINT') {
                    console.log(`[SystemManager] Triggering re-plan for project ${projectName} due to subtask ${subtask.id} failure.`);
                    projectState.metadata.status = 'failed_needs_replan';
                    projectState.execution.replanReason = recovery.params?.replanReason || `Failure in subtask ${subtask.id}`;
                    this.projectRetryAttempts.delete(projectName); // Reset project level retries for fresh plan
                    // Clear remaining tasks as a new plan will come
                    projectState.execution.subtasksRemainingIds = [];
                    await this._saveProjectCheckpoint(projectName, projectState, `subtask_${subtask.id}_failed_replan`);
                    // Signal the main loop that a replan is needed
                    throw new CoordinationError("Re-plan required", "REPLAN_TRIGGERED", {projectName, subtaskId: subtask.id}, null, "CRITICAL");
                } else if (recovery.type === 'SKIP_OPTIONAL') {
                    console.warn(`[SystemManager] Skipping optional failed subtask ${subtask.id}.`);
                    projectState.execution.subtasksCompletedIds.push(`${subtask.id} (skipped due to error)`);
                    projectState.execution.subtasksRemainingIds = projectState.execution.subtasksRemainingIds.filter(id => id !== subtask.id);
                    delete projectState.execution.subtaskAttempts?.[subtaskId];
                    await this._saveProjectCheckpoint(projectName, projectState, `subtask_${subtask.id}_skipped`);
                    // Continue to the next subtask in this loop
                } else { // HALT_PROJECT
                    projectState.metadata.status = 'failed_subtask_unrecoverable';
                    await this._saveProjectCheckpoint(projectName, projectState, `subtask_${subtask.id}_failed_halt`);
                    throw wrappedSubtaskError; // Propagate to halt processing for this project
                }
            } finally {
                // projectState.execution.currentSubtaskId = null; // Reset after subtask processing block
            }
        } // End for...of subtask loop

        if (projectState.execution.subtasksRemainingIds && projectState.execution.subtasksRemainingIds.length === 0) {
             console.log(`[SystemManager] All subtasks processed for project ${projectName} in this iteration.`);
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
    const classification = classifyError(error, { projectName });
    const currentProjectAttempts = this.projectRetryAttempts.get(projectName) || 0;

    // Use a more generic context for determineRecoveryStrategy for project-level errors
    const recoveryContext = {
        projectName,
        attemptNumber: currentProjectAttempts,
        projectState // Pass the actual project state
    };
    const recovery = determineRecoveryStrategy(classification, recoveryContext, this.configManager);

    console.error(`[SystemManager] Handling project-level error for ${projectName}. Classification: ${classification.severity}, Suggested: ${classification.suggestedAction}, Determined Recovery: ${recovery.type}`);

    projectState.metadata.status = 'failed';
    projectState.execution.lastError = {
        message: error.message, code: error.code, details: error.context,
        stack: error.stack, timestamp: new Date().toISOString(),
        classification: errorClassification, recoveryAttempted: recovery.type
    };
    this.activeProjects.set(projectName, projectState);

    if (recovery.type === 'REPLAN_FROM_CHECKPOINT' || (recovery.type === 'RETRY_AS_IS' && classification.severity === 'CRITICAL')) { // Treat critical retry as replan for safety
        const maxProjectRetries = this.configManager.get('errorHandling.maxRetries.simple', 2);
        if (currentProjectAttempts < maxProjectRetries) {
            this.projectRetryAttempts.set(projectName, currentProjectAttempts + 1);
            console.log(`[SystemManager] Project ${projectName} failed critically, attempting full re-plan (attempt ${currentProjectAttempts + 1}/${maxProjectRetries}).`);
            // Re-enqueue the original request with flags to force full reprocessing
            const retryOptions = {
                ...(request.options || {}),
                forceReprocessAnalysis: true,
                forceReloadState: true, // Ensure it reloads from persistence to get checkpointed state if any
                isRetry: true, // Mark as a system manager retry
                originatingError: error.message
            };
             this.mainTaskQueue.enqueue({ ...request, options: retryOptions }); // Re-queue at the end
             console.log(`[SystemManager] Re-queued request for ${projectName} for re-planning.`);
        } else {
            console.error(`[SystemManager] Max project retries (${maxProjectRetries}) reached for ${projectName}. Marking as terminally failed.`);
            projectState.metadata.status = 'failed_terminal';
             this.projectRetryAttempts.delete(projectName);
        }
    } else if (recovery.type === 'HALT_PROJECT') {
        console.error(`[SystemManager] Unrecoverable error for project ${projectName}. Project processing halted.`);
        projectState.metadata.status = 'failed_terminal';
        this.projectRetryAttempts.delete(projectName);
    }
    // Always save the error state
    await this._saveProjectCheckpoint(projectName, projectState, `project_error_state_${projectState.metadata.status}`);
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
