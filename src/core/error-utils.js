// src/core/error-utils.js
// Utility functions and classes for advanced error handling and classification.

// --- Base Custom Error (if not already defined elsewhere, or enhance it) ---
export class PlatformError extends Error {
    constructor(message, code, context = {}, originalError = null, severity = 'UNKNOWN') {
        super(message);
        this.name = this.constructor.name;
        this.code = code; // e.g., 'VERTEX_API_ERROR', 'SANDBOX_EXEC_TIMEOUT'
        this.context = context; // { component: 'AgentCoordinator', operation: 'understandRequest', ... }
        this.originalError = originalError;
        this.timestamp = new Date().toISOString();
        this.severity = severity; // 'FATAL', 'CRITICAL', 'RECOVERABLE', 'TRANSIENT', 'WARNING'
        this.isOperational = true; // Default for operational errors, can be overridden
    }
}

// --- Specific Error Types (examples based on checklist) ---
// You would have already defined these in their respective modules,
// but this util can help classify or wrap them if needed, or define new ones.

// AIError (from vertexAI-client.js - ensure it inherits from PlatformError or is compatible)
// export class AIError extends PlatformError { /* ... */ }
// export class ModelError extends AIError { /* ... */ }
// ... other AI errors

// SandboxError (from sandbox-manager.js - ensure it inherits from PlatformError or is compatible)
// export class SandboxError extends PlatformError { /* ... */ }
// export class ContainerError extends SandboxError { /* ... */ }
// ... other Sandbox errors

// PersistenceError (from project-persistence.js - ensure it inherits from PlatformError or is compatible)
// export class PersistenceError extends PlatformError { /* ... */ }
// export class StateError extends PersistenceError { /* ... */ }

// CoordinationError (can be defined here or in AgentCoordinator/SystemManager)
export class CoordinationError extends PlatformError {
    constructor(message, code = 'COORDINATION_ERROR', context = {}, originalError = null, severity = 'CRITICAL') {
        super(message, code, context, originalError, severity);
        this.name = 'CoordinationError';
    }
}
export class PlanningError extends CoordinationError { constructor(m,c,o,s) {super(m,'PLANNING_ERROR',c,o,s); this.name='PlanningError';}}
export class TaskOrchestrationError extends CoordinationError { constructor(m,c,o,s) {super(m,'TASK_ORCHESTRATION_ERROR',c,o,s); this.name='TaskOrchestrationError';}}


// --- Error Classification Logic ---
/**
 * @typedef {'FATAL' | 'CRITICAL' | 'RECOVERABLE_WITH_REPLAN' | 'RECOVERABLE_WITH_MODIFICATION' | 'RETRYABLE_TRANSIENT' | 'WARNING' | 'UNKNOWN'} ErrorSeverityClassification
 */

/**
 * Classifies an error and determines its severity and potential recoverability.
 * @param {Error | PlatformError} error - The error object.
 * @param {object} [operationContext] - Context of the operation where error occurred. // Corrected typo: operationContetxt -> operationContext
 * @returns {{
 *  classifiedType: string, // e.g., 'VertexAIError', 'SandboxTimeout', 'PersistenceFailure'
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
        classifiedType = error.constructor.name; // More specific, e.g., ModelError
        severity = error.severity || 'UNKNOWN'; // Use severity if set on the error

        // Vertex AI Errors (Example based on potential VertexAIError structure)
        if (error.code?.startsWith('VERTEX_')) {
            classifiedType = error.code;
            if (error.code === 'VERTEX_RESOURCE_EXHAUSTED' || error.code === 'VERTEX_UNAVAILABLE' || error.code === 'VERTEX_RATE_LIMIT') {
                severity = 'RETRYABLE_TRANSIENT';
                isRetryable = true;
                suggestedAction = 'RETRY_SUBTASK_AS_IS';
            } else if (error.code === 'VERTEX_TOKEN_LIMIT_ERROR') {
                severity = 'RECOVERABLE_WITH_MODIFICATION';
                isRetryable = true;
                suggestedAction = 'RETRY_SUBTASK_MODIFIED';
                details = `Vertex AI token limit exceeded. Context: ${JSON.stringify(error.context)}. Consider summarizing or reducing input.`;
            } else if (error.code === 'VERTEX_API_ERROR' || error.code === 'MODEL_ERROR_INVALID_RESPONSE') {
                severity = 'CRITICAL';
                isRetryable = false;
                suggestedAction = 'REPLAN_PROJECT';
                details = `Critical Vertex AI API/Model error: ${error.message}. Context: ${JSON.stringify(error.context)}. Original: ${error.originalError?.message}`;
            } else {
                severity = 'CRITICAL';
                suggestedAction = 'HALT';
            }
        }
        // Sandbox Errors
        else if (error.code?.startsWith('SANDBOX_')) {
            classifiedType = error.code;
            if (error.code === 'SANDBOX_COMMAND_TIMEOUT_ERROR') {
                severity = 'RECOVERABLE_WITH_MODIFICATION';
                isRetryable = true;
                suggestedAction = 'RETRY_SUBTASK_MODIFIED';
            } else if (error.code === 'SANDBOX_RESOURCE_LIMIT_ERROR') {
                severity = 'CRITICAL';
                suggestedAction = 'REPLAN_PROJECT';
            } else if (error.code === 'SANDBOX_EXECUTION_ERROR') {
                severity = 'RECOVERABLE_WITH_MODIFICATION';
                isRetryable = true;
                suggestedAction = 'RETRY_SUBTASK_MODIFIED'; // Implies self-debug will run
            } else {
                severity = 'CRITICAL';
                suggestedAction = 'HALT';
            }
        }
        // Persistence Errors
        else if (error.code?.startsWith('PERSISTENCE_')) {
            classifiedType = error.code;
            if (error.code === 'PERSISTENCE_PROJECT_NOT_FOUND') {
                severity = 'CRITICAL';
                suggestedAction = 'HALT';
            } else if (error.code === 'PERSISTENCE_STORAGE_ACCESS_ERROR') {
                severity = 'FATAL';
                suggestedAction = 'HALT';
            } else {
                severity = 'CRITICAL';
                suggestedAction = 'HALT';
            }
        }
        // Coordination Errors
        else if (error.code?.startsWith('COORDINATION_')) {
            classifiedType = error.code;
            severity = error.severity || 'CRITICAL';
            suggestedAction = 'REPLAN_PROJECT';
        }
        // Generic PlatformError (if severity was set but no specific code matched above)
        else if (error.severity && error.severity !== 'UNKNOWN') {
             // Use the pre-assigned severity
             if (error.severity === 'RECOVERABLE') {
                severity = 'RECOVERABLE_WITH_MODIFICATION'; isRetryable = true; suggestedAction = 'RETRY_SUBTASK_MODIFIED';
             } else if (error.severity === 'TRANSIENT') {
                severity = 'RETRYABLE_TRANSIENT'; isRetryable = true; suggestedAction = 'RETRY_SUBTASK_AS_IS';
             } else if (error.severity === 'CRITICAL') {
                severity = 'CRITICAL'; suggestedAction = 'REPLAN_PROJECT'; // Or HALT depending on recoverability
             } else if (error.severity === 'FATAL') {
                severity = 'FATAL'; suggestedAction = 'HALT';
             } else if (error.severity === 'WARNING') {
                 severity = 'WARNING'; suggestedAction = 'LOG_AND_CONTINUE';
             }
        } else { // Fallback for other PlatformErrors without specific code matched from above list
            severity = 'CRITICAL'; // Default to critical for unhandled platform errors
            suggestedAction = 'HALT';
        }

    } else { // Native JS Error or other unclassified error
        if (error.message.includes('Network timeout') || error.message.includes('ECONNRESET') || error.message.includes('socket hang up')) {
            severity = 'RETRYABLE_TRANSIENT';
            isRetryable = true;
            suggestedAction = 'RETRY_SUBTASK_AS_IS';
        } else if (error.name === 'SyntaxError') {
            severity = 'CRITICAL';
            suggestedAction = 'RETRY_SUBTASK_MODIFIED';
            details = `SyntaxError during parsing: ${error.message}. A malformed JSON or data was likely received.`;
        }
        else {
            severity = 'FATAL';
            suggestedAction = 'HALT';
        }
    }

    if (operationContext.isOptionalTask &&
       (severity === 'CRITICAL' || severity === 'RECOVERABLE_WITH_REPLAN' || severity === 'FATAL' )) {
        severity = 'WARNING';
        suggestedAction = 'LOG_AND_CONTINUE';
        isRetryable = false;
    }

    return { classifiedType, severity, isRetryable, suggestedAction, details };
}

/**
 * @typedef {object} RecoveryStrategy
 * @property {'RETRY_AS_IS' | 'RETRY_WITH_PARAMS' | 'RETRY_WITH_DECOMPOSED_TASK' | 'REPLAN_FROM_CHECKPOINT' | 'SKIP_OPTIONAL' | 'HALT_PROJECT' | 'ESCALATE_TO_USER'} type
 * @property {object} [params] - New parameters for retry or replan
 * @property {number} [delayMs] - Delay before retry
 */

/**
 * Determines a recovery strategy based on error classification and context.
 * @param {object} errorClassification - Output from classifyError.
 * @param {object} currentContext - { currentProjectName, currentSubtask, attemptNumber, projectState }
 * @param {ConfigurationManager} configManager - To get strategy configurations.
 * @returns {RecoveryStrategy}
 */
export function determineRecoveryStrategy(errorClassification, currentContext, configManager) {
    const { suggestedAction } = errorClassification; // isRetryable and severity are implicitly used by suggestedAction logic
    const { attemptNumber = 0 } = currentContext; // Ensure attemptNumber is defined
    const maxRetriesSimple = configManager.get('errorHandling.maxRetries.simple', 2);
    const maxRetriesModified = configManager.get('errorHandling.maxRetries.modified', 1);

    switch (suggestedAction) {
        case 'RETRY_SUBTASK_AS_IS':
            if (attemptNumber < maxRetriesSimple) {
                return { type: 'RETRY_AS_IS', delayMs: (attemptNumber + 1) * configManager.get('errorHandling.retryDelay.baseMs', 1000) };
            }
            break;
        case 'RETRY_SUBTASK_MODIFIED':
            // TaskExecutor's self-debug loop handles most RECOVERABLE_WITH_MODIFICATION for SANDBOX_EXECUTION_ERRORs.
            // This branch in SystemManager context might be for AI response format issues, token limits, or sandbox timeouts
            // where SystemManager itself needs to adjust parameters for the *next call* to TaskExecutor or AgentCoordinator.
            if (attemptNumber < maxRetriesModified) {
                // Params might include: { newTimeout: oldTimeout * 2, summarizedContext: true }
                // The component calling determineRecoveryStrategy would need to build these params.
                return { type: 'RETRY_WITH_PARAMS', params: { /* To be built by caller */ }, delayMs: configManager.get('errorHandling.retryDelay.modifiedMs', 2000) };
            }
            break;
        case 'REPLAN_PROJECT':
            return {
                type: 'REPLAN_FROM_CHECKPOINT',
                params: {
                    checkpointId: currentContext.projectState?.execution?.lastCheckpointId,
                    replanReason: errorClassification.details || errorClassification.classifiedType
                }
            };
        case 'LOG_AND_CONTINUE':
            return { type: 'SKIP_OPTIONAL' };
        case 'HALT':
        case 'UNKNOWN':
        default:
            break;
    }
    return { type: 'HALT_PROJECT' };
}

// Helper to ensure custom error classes are properly defined (for dev).
function _ensureCustomErrors() {
    const errors = [new CoordinationError("test"), new PlanningError("test"), new TaskOrchestrationError("test")];
    errors.forEach(e => {
        if (!(e instanceof Error && e instanceof PlatformError && e instanceof CoordinationError)) {
            // console.warn(`Error class ${e.constructor.name} inheritance/setup might be incorrect.`);
        }
    });
}
_ensureCustomErrors();
