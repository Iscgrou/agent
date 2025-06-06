// src/core/error-utils.js
// Utility functions and classes for advanced error handling and classification.

// --- Base Custom Error ---
export class PlatformError extends Error {
    constructor(message, code, context = {}, originalError = null, severity = 'UNKNOWN') {
        super(message);
        this.name = this.constructor.name;
        this.code = code; // e.g., 'VERTEX_API_ERROR', 'SANDBOX_EXEC_TIMEOUT'
        this.context = context; // { component: 'AgentCoordinator', operation: 'understandRequest', ... }
        this.originalError = originalError;
        this.timestamp = new Date().toISOString();
        this.severity = severity; // 'FATAL', 'CRITICAL', 'RECOVERABLE_WITH_REPLAN', 'RECOVERABLE_WITH_MODIFICATION', 'RETRYABLE_TRANSIENT', 'WARNING'
        this.isOperational = true; // Default for operational errors, can be overridden
    }
}

// --- Specific Error Types (examples, to be fully defined in their respective modules and extend PlatformError) ---
export class CoordinationError extends PlatformError {
    constructor(message, code = 'COORDINATION_ERROR', context = {}, originalError = null, severity = 'CRITICAL') {
        super(message, code, context, originalError, severity);
        // PlatformError constructor handles setting this.name to 'CoordinationError'
    }
}
export class PlanningError extends CoordinationError {
    constructor(message, context = {}, originalError = null, severity = 'CRITICAL') { // Default code for PlanningError
        super(message, 'PLANNING_ERROR', context, originalError, severity);
    }
}
export class TaskOrchestrationError extends CoordinationError {
    constructor(message, code = 'TASK_ORCHESTRATION_ERROR', context = {}, originalError = null, severity = 'CRITICAL') {
        super(message, code, context, originalError, severity);
    }
}

// --- Error Classification Logic ---
/**
 * @typedef {'FATAL' | 'CRITICAL' | 'RECOVERABLE_WITH_REPLAN' | 'RECOVERABLE_WITH_MODIFICATION' | 'RETRYABLE_TRANSIENT' | 'WARNING' | 'UNKNOWN'} ErrorSeverityClassification
 */

/**
 * Classifies an error and determines its severity and potential recoverability.
 * @param {Error | PlatformError} error - The error object.
 * @param {object} [operationContext] - Context of the operation where error occurred. e.g. { isOptionalTask: boolean }
 * @returns {{
 *  classifiedType: string,
 *  severity: ErrorSeverityClassification,
 *  isRetryable: boolean,
 *  suggestedAction: 'HALT' | 'REPLAN_PROJECT' | 'RETRY_SUBTASK_MODIFIED' | 'RETRY_SUBTASK_AS_IS' | 'LOG_AND_CONTINUE' | 'UNKNOWN',
 *  details: string
 * }}
 */
export function classifyError(error, operationContext = {}) {
    let classifiedType = error.name || 'GenericError';
    let severity = 'UNKNOWN';
    let isRetryable = false;
    let suggestedAction = 'UNKNOWN';
    let details = error.message;

    if (error instanceof PlatformError) {
        classifiedType = error.constructor.name; // Use specific constructor name if PlatformError
        if (error.code) classifiedType = error.code; // Prefer specific code if available
        severity = error.severity || 'CRITICAL'; // Use error's severity, default to CRITICAL for unknown PlatformErrors

        // Specific logic based on error codes (assuming codes are UPPER_SNAKE_CASE)
        switch (error.code) {
            // Vertex AI Errors
            case 'VERTEX_RESOURCE_EXHAUSTED':
            case 'VERTEX_UNAVAILABLE':
            case 'VERTEX_RATE_LIMIT':
                severity = 'RETRYABLE_TRANSIENT';
                isRetryable = true;
                suggestedAction = 'RETRY_SUBTASK_AS_IS';
                break;
            case 'VERTEX_TOKEN_LIMIT_ERROR':
                severity = 'RECOVERABLE_WITH_MODIFICATION';
                isRetryable = true; // With modification
                suggestedAction = 'RETRY_SUBTASK_MODIFIED';
                details = `Vertex AI token limit exceeded. Context: ${JSON.stringify(error.context)}. Consider summarizing or reducing input.`;
                break;
            case 'VERTEX_API_ERROR':
            case 'MODEL_ERROR_INVALID_RESPONSE':
                severity = 'CRITICAL';
                isRetryable = false;
                suggestedAction = 'REPLAN_PROJECT'; // Or ESCALATE_TO_USER
                details = `Critical Vertex AI API/Model error: ${error.message}. Context: ${JSON.stringify(error.context)}. Original: ${error.originalError?.message}`;
                break;
            // Sandbox Errors
            case 'SANDBOX_COMMAND_TIMEOUT_ERROR':
                severity = 'RECOVERABLE_WITH_MODIFICATION'; // e.g., increase timeout
                isRetryable = true;
                suggestedAction = 'RETRY_SUBTASK_MODIFIED';
                break;
            case 'SANDBOX_RESOURCE_LIMIT_ERROR':
                severity = 'CRITICAL'; // May need replan with smaller tasks
                isRetryable = false;
                suggestedAction = 'REPLAN_PROJECT';
                break;
            case 'SANDBOX_EXECUTION_ERROR': // Non-zero exit code from user code
                severity = 'RECOVERABLE_WITH_MODIFICATION'; // Should trigger self-debugging in TaskExecutor
                isRetryable = true; // Via self-debugging
                suggestedAction = 'RETRY_SUBTASK_MODIFIED';
                break;
            // Persistence Errors
            case 'PERSISTENCE_PROJECT_NOT_FOUND':
                severity = 'CRITICAL'; // Or 'WARNING' if creating new is acceptable
                isRetryable = false;
                suggestedAction = 'HALT'; // Or 'CREATE_NEW_PROJECT'
                break;
            case 'PERSISTENCE_STORAGE_ACCESS_ERROR':
                severity = 'FATAL'; // Disk full, dire permissions issues
                isRetryable = false;
                suggestedAction = 'HALT';
                break;
            case 'SERIALIZATION_ERROR': // From ProjectPersistence
                 severity = 'CRITICAL';
                 isRetryable = false; // Unlikely to be fixed by simple retry
                 suggestedAction = 'HALT'; // Or specific recovery if possible
                 details = `Serialization error: ${error.message}`;
                 break;
            // Coordination Errors
            case 'PLANNING_ERROR':
            case 'TASK_ORCHESTRATION_ERROR':
            case 'COORDINATION_ERROR': // Generic coordination
                severity = error.severity || 'CRITICAL';
                isRetryable = false;
                suggestedAction = 'REPLAN_PROJECT';
                break;
            case 'REPLAN_TRIGGERED': // Specific code used by SystemManager
                 severity = 'CRITICAL';
                 isRetryable = false; // The replan IS the recovery
                 suggestedAction = 'REPLAN_PROJECT';
                 break;
            default:
                // For other PlatformErrors not specifically handled by code, rely on their inherent severity
                if (severity === 'TRANSIENT') {
                    isRetryable = true; suggestedAction = 'RETRY_SUBTASK_AS_IS';
                } else if (severity === 'RECOVERABLE' || severity === 'RECOVERABLE_WITH_MODIFICATION') {
                    isRetryable = true; suggestedAction = 'RETRY_SUBTASK_MODIFIED';
                } else if (severity === 'CRITICAL' && isRetryable === false) { // If not already retryable
                    suggestedAction = 'REPLAN_PROJECT';
                } else if (severity === 'FATAL') {
                    suggestedAction = 'HALT';
                } else if (severity === 'WARNING') {
                    suggestedAction = 'LOG_AND_CONTINUE';
                } else { // UNKNOWN severity or unhandled PlatformError
                   severity = 'CRITICAL'; // Default unhandled PlatformErrors to CRITICAL
                   suggestedAction = 'HALT';
                }
        }
    } else { // Native JS Error or other unclassified error
        if (error.message?.includes('Network timeout') || error.message?.includes('ECONNRESET') || error.message?.includes('socket hang up')) {
            severity = 'RETRYABLE_TRANSIENT';
            isRetryable = true;
            suggestedAction = 'RETRY_SUBTASK_AS_IS';
        } else if (error.name === 'SyntaxError' && error.message?.includes('JSON')) { // SyntaxError specifically from JSON parsing
            severity = 'CRITICAL';
            isRetryable = true; // With prompt modification by AI to fix JSON output
            suggestedAction = 'RETRY_SUBTASK_MODIFIED';
            details = `SyntaxError during JSON parsing: ${error.message}. An AI model likely returned malformed JSON.`;
        } else { // Other native errors
            severity = 'FATAL'; // Unknown native error, potentially serious
            isRetryable = false;
            suggestedAction = 'HALT';
        }
    }

    // Final override for optional tasks
    if (operationContext.isOptionalTask &&
       (severity === 'CRITICAL' || severity === 'RECOVERABLE_WITH_REPLAN' || severity === 'FATAL' || 
        (severity === 'RECOVERABLE_WITH_MODIFICATION' && !isRetryable) )) { // If modification means human intervention
        severity = 'WARNING';
        suggestedAction = 'LOG_AND_CONTINUE';
        isRetryable = false; // Do not retry optional failed task unless specifically configured for it
    }

    return { classifiedType, severity, isRetryable, suggestedAction, details };
}

/**
 * @typedef {object} RecoveryStrategy
 * @property {'RETRY_AS_IS' | 'RETRY_WITH_PARAMS' | 'SCHEDULE_REPLAN' | 'SKIP_OPTIONAL_TASK' | 'HALT_PROJECT_PROCESSING' | 'ESCALATE_FOR_MANUAL_REVIEW'} type
 * @property {object} [params] - New parameters for retry or replan
 * @property {number} [delayMs] - Delay before retry
 */

/**
 * Determines a recovery strategy based on error classification and context.
 * @param {object} errorClassification - Output from classifyError.
 * @param {object} currentContext - { projectName, currentSubtask?, attemptNumber, projectState }
 * @param {ConfigurationManager} configManager - To get strategy configurations.
 * @returns {RecoveryStrategy}
 */
export function determineRecoveryStrategy(errorClassification, currentContext, configManager) {
    const { suggestedAction, severity } = errorClassification;
    const { attemptNumber = 0, currentSubtask } = currentContext;

    const baseRetryDelay = configManager.get('errorHandling.retryDelay.baseMs', 1000);
    const modifiedRetryDelay = configManager.get('errorHandling.retryDelay.modifiedMs', 2000);
    
    // Max attempts for subtask-level retries handled by SystemManager/TaskExecutor error loop:
    const maxSubtaskRetriesSimple = configManager.get('errorHandling.maxSubtaskRetries.simple', 2);
    const maxSubtaskRetriesModified = configManager.get('errorHandling.maxSubtaskRetries.modified', 1);


    switch (suggestedAction) {
        case 'RETRY_SUBTASK_AS_IS':
            if (attemptNumber < maxSubtaskRetriesSimple) {
                return { type: 'RETRY_AS_IS', delayMs: (attemptNumber + 1) * baseRetryDelay };
            }
            // If retries exhausted, it might become critical for the project
            console.warn(`[ErrorUtils] Max simple retries (${maxSubtaskRetriesSimple}) reached for action RETRY_SUBTASK_AS_IS.`);
            return { type: 'HALT_PROJECT_PROCESSING' }; // Or escalate to REPLAN_PROJECT for project-level decision

        case 'RETRY_SUBTASK_MODIFIED':
            // This action implies that TaskExecutionSystem's self-debugging might have failed,
            // or the issue is something like a token limit needing context summarization by AgentCoordinator,
            // or a sandbox timeout needing parameter adjustment by SystemManager for the next attempt at this subtask.
            if (attemptNumber < maxSubtaskRetriesModified) {
                return {
                    type: 'RETRY_WITH_PARAMS',
                    params: {
                        // Caller (SystemManager) needs to decide what params to modify.
                        // e.g., if errorClassification.classifiedType === 'VERTEX_TOKEN_LIMIT_ERROR',
                        // params could instruct AgentCoord to summarize context before next TaskExec call.
                        // if === 'SANDBOX_COMMAND_TIMEOUT_ERROR', params could be { newTimeout: oldTimeout * 1.5 }
                        modificationHint: errorClassification.classifiedType // Pass hint for modification
                    },
                    delayMs: modifiedRetryDelay
                };
            }
            console.warn(`[ErrorUtils] Max modified retries (${maxSubtaskRetriesModified}) reached for action RETRY_SUBTASK_MODIFIED.`);
            return { type: 'REPLAN_PROJECT' }; // If modified retries fail, escalate to full re-plan

        case 'REPLAN_PROJECT':
            return {
                type: 'SCHEDULE_REPLAN', // Changed for clarity: SystemManager schedules this
                params: {
                    checkpointId: currentContext.projectState?.execution?.lastCheckpointId,
                    replanReason: errorClassification.details || errorClassification.classifiedType,
                    failedSubtaskId: currentSubtask?.id
                }
            };
        case 'LOG_AND_CONTINUE':
            return { type: 'SKIP_OPTIONAL_TASK' };

        case 'HALT':
        case 'UNKNOWN':
        default:
            return { type: 'HALT_PROJECT_PROCESSING' };
    }
}

// Helper for development
function _ensureCustomErrors() {
    const errors = [new CoordinationError("test"), new PlanningError("test"), new TaskOrchestrationError("test")];
    errors.forEach(e => {
        if (!(e instanceof Error && e instanceof PlatformError && e instanceof CoordinationError)) {
            // console.warn(`Error class ${e.constructor.name} inheritance/setup might be incorrect.`);
        }
    });
}
_ensureCustomErrors();
