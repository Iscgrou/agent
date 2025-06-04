import { jest } from '@jest/globals';
import {
    PlatformError,
    CoordinationError,
    PlanningError,
    TaskOrchestrationError,
    classifyError,
    determineRecoveryStrategy
} from '../src/core/error-utils.js';
import { ConfigurationManager } from '../src/core/configuration-manager.js';
import { VertexAIError } from '../src/core/vertexAI-client.js';
import { SandboxError, CommandTimeoutError, SecurityViolationError } from '../src/core/sandbox-manager.js';
import { PersistenceError, ProjectNotFoundError, StorageAccessError } from '../src/core/project-persistence.js';

// Mock ConfigurationManager for determineRecoveryStrategy
jest.mock('../src/core/configuration-manager.js');
// Mock other error classes if their constructors are complex or have side effects not needed for these tests
// For simplicity, we'll assume they can be instantiated directly if they correctly call super(message, code, ..., severity)

describe('Error Utilities', () => {
    let mockConfigManagerInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        mockConfigManagerInstance = {
            get: jest.fn((key, defaultValue) => {
                switch (key) {
                    case 'errorHandling.maxRetries.simple': return 2;
                    case 'errorHandling.maxRetries.modified': return 1;
                    case 'errorHandling.retryDelay.baseMs': return 100;
                    case 'errorHandling.retryDelay.modifiedMs': return 200;
                    case 'errorHandling.maxProjectRetries.replan': return 2;
                    default: return defaultValue;
                }
            })
        };
        ConfigurationManager.mockImplementation(() => mockConfigManagerInstance);
    });

    describe('Error Class Hierarchy and Properties', () => {
        it('PlatformError should store properties correctly', () => {
            const originalError = new Error("Original underlying issue");
            const context = { component: 'TestComponent', operationId: 'op123' };
            const err = new PlatformError(
                "A platform error occurred",
                "TEST_PLATFORM_CODE",
                context,
                originalError,
                "CRITICAL"
            );

            expect(err).toBeInstanceOf(Error);
            expect(err).toBeInstanceOf(PlatformError);
            expect(err.message).toBe("A platform error occurred");
            expect(err.name).toBe("PlatformError");
            expect(err.code).toBe("TEST_PLATFORM_CODE");
            expect(err.context).toEqual(context);
            expect(err.originalError).toBe(originalError);
            expect(err.severity).toBe("CRITICAL");
            expect(err.isOperational).toBe(true);
        });

        describe('VertexAI Error Classes', () => {
            it('VertexAIError should inherit correctly and set defaults', () => {
                const vertexError = new VertexAIError("API quota exceeded");
                expect(vertexError).toBeInstanceOf(PlatformError);
                expect(vertexError.code).toBe('VERTEX_AI_GENERIC');
                expect(vertexError.severity).toBe('CRITICAL');
                expect(vertexError.timestamp).toBeDefined();
            });

            it('VertexAIError should handle custom parameters', () => {
                const context = { quotaLimit: 1000, currentUsage: 999 };
                const originalError = new Error("Quota limit reached");
                const vertexError = new VertexAIError(
                    "API quota exceeded",
                    "VERTEX_RATE_LIMIT",
                    context,
                    originalError,
                    "TRANSIENT"
                );
                expect(vertexError.code).toBe('VERTEX_RATE_LIMIT');
                expect(vertexError.context).toEqual(context);
                expect(vertexError.severity).toBe('TRANSIENT');
            });
        });

        describe('Sandbox Error Classes', () => {
            it('SandboxError should inherit correctly and set defaults', () => {
                const sandboxError = new SandboxError("Generic sandbox error");
                expect(sandboxError).toBeInstanceOf(PlatformError);
                expect(sandboxError.code).toBe('SANDBOX_GENERIC');
                expect(sandboxError.severity).toBe('CRITICAL');
            });

            it('CommandTimeoutError should set appropriate severity', () => {
                const timeoutError = new CommandTimeoutError("Command execution timed out");
                expect(timeoutError).toBeInstanceOf(SandboxError);
                expect(timeoutError).toBeInstanceOf(PlatformError);
                expect(timeoutError.code).toBe('COMMAND_TIMEOUT_ERROR');
                expect(timeoutError.severity).toBe('RECOVERABLE_WITH_MODIFICATION');
            });

            it('SecurityViolationError should set FATAL severity', () => {
                const securityError = new SecurityViolationError("Security breach attempt");
                expect(securityError).toBeInstanceOf(SandboxError);
                expect(securityError.code).toBe('SECURITY_VIOLATION_ERROR');
                expect(securityError.severity).toBe('FATAL');
            });
        });

        describe('Persistence Error Classes', () => {
            it('PersistenceError should inherit correctly and set defaults', () => {
                const persistenceError = new PersistenceError("Generic persistence error");
                expect(persistenceError).toBeInstanceOf(PlatformError);
                expect(persistenceError.code).toBe('PERSISTENCE_GENERIC');
                expect(persistenceError.severity).toBe('CRITICAL');
            });

            it('ProjectNotFoundError should set appropriate severity', () => {
                const notFoundError = new ProjectNotFoundError("Project does not exist");
                expect(notFoundError).toBeInstanceOf(PersistenceError);
                expect(notFoundError.code).toBe('PROJECT_NOT_FOUND');
                expect(notFoundError.severity).toBe('RECOVERABLE_WITH_MODIFICATION');
            });

            it('StorageAccessError should maintain CRITICAL severity', () => {
                const storageError = new StorageAccessError("Failed to write to disk");
                expect(storageError).toBeInstanceOf(PersistenceError);
                expect(storageError.code).toBe('STORAGE_ACCESS_ERROR');
                expect(storageError.severity).toBe('CRITICAL');
            });
        });

        describe('Core Platform Error Classes', () => {
            it('CoordinationError should set defaults', () => {
                const err = new CoordinationError("Coordination issue");
                expect(err).toBeInstanceOf(PlatformError);
                expect(err.name).toBe("CoordinationError");
                expect(err.code).toBe("COORDINATION_ERROR");
                expect(err.severity).toBe("CRITICAL");
            });

            it('PlanningError should set appropriate defaults', () => {
                const err = new PlanningError("Invalid plan structure");
                expect(err).toBeInstanceOf(PlatformError);
                expect(err.code).toBe("PLANNING_ERROR");
                expect(err.severity).toBe("CRITICAL");
            });

            it('TaskOrchestrationError should handle context', () => {
                const context = { taskId: 'task-123', stage: 'execution' };
                const err = new TaskOrchestrationError("Task orchestration failed", context);
                expect(err).toBeInstanceOf(PlatformError);
                expect(err.context).toEqual(context);
                expect(err.code).toBe("TASK_ORCHESTRATION_ERROR");
            });
        });
    });

    describe('classifyError', () => {
        describe('VertexAI Errors', () => {
            it('should classify rate limit errors as RETRYABLE_TRANSIENT', () => {
                const err = new VertexAIError("Rate limit exceeded", "VERTEX_RATE_LIMIT", {}, null, "TRANSIENT");
                const classification = classifyError(err);
                expect(classification.severity).toBe('RETRYABLE_TRANSIENT');
                expect(classification.isRetryable).toBe(true);
                expect(classification.suggestedAction).toBe('RETRY_SUBTASK_AS_IS');
                expect(classification.details).toContain('Rate limit exceeded');
            });

            it('should classify token limit errors as RECOVERABLE_WITH_MODIFICATION', () => {
                const context = { maxTokens: 4096, usedTokens: 4000 };
                const err = new VertexAIError(
                    "Token limit exceeded",
                    "VERTEX_TOKEN_LIMIT",
                    context,
                    null,
                    "RECOVERABLE"
                );
                const classification = classifyError(err);
                expect(classification.severity).toBe('RECOVERABLE_WITH_MODIFICATION');
                expect(classification.suggestedAction).toBe('RETRY_SUBTASK_MODIFIED');
                expect(classification.details).toContain('Token limit exceeded');
                expect(classification.context).toEqual(context);
            });

            it('should classify model unavailable as RETRYABLE_TRANSIENT', () => {
                const err = new VertexAIError(
                    "Model temporarily unavailable",
                    "VERTEX_MODEL_UNAVAILABLE",
                    {},
                    null,
                    "TRANSIENT"
                );
                const classification = classifyError(err);
                expect(classification.severity).toBe('RETRYABLE_TRANSIENT');
                expect(classification.suggestedAction).toBe('RETRY_SUBTASK_AS_IS');
            });
        });

        describe('Sandbox Errors', () => {
            it('should classify command timeout as RECOVERABLE_WITH_MODIFICATION', () => {
                const context = { command: 'npm install', timeout: 30000 };
                const err = new CommandTimeoutError("Command execution timed out", context);
                const classification = classifyError(err);
                expect(classification.severity).toBe('RECOVERABLE_WITH_MODIFICATION');
                expect(classification.suggestedAction).toBe('RETRY_SUBTASK_MODIFIED');
                expect(classification.context).toEqual(context);
            });

            it('should classify security violations as FATAL', () => {
                const context = { attemptedPath: '/etc/passwd' };
                const err = new SecurityViolationError("Attempted to access restricted path", context);
                const classification = classifyError(err);
                expect(classification.severity).toBe('FATAL');
                expect(classification.suggestedAction).toBe('HALT');
                expect(classification.details).toContain('Security violation');
            });
        });

        describe('Persistence Errors', () => {
            it('should classify storage access errors as CRITICAL', () => {
                const context = { operation: 'write', path: '/data/project.json' };
                const err = new StorageAccessError("Failed to write to disk", context);
                const classification = classifyError(err);
                expect(classification.severity).toBe('CRITICAL');
                expect(classification.suggestedAction).toBe('HALT');
                expect(classification.context).toEqual(context);
            });

            it('should classify project not found as RECOVERABLE_WITH_MODIFICATION', () => {
                const context = { projectId: 'missing-project' };
                const err = new ProjectNotFoundError("Project does not exist", context);
                const classification = classifyError(err);
                expect(classification.severity).toBe('RECOVERABLE_WITH_MODIFICATION');
                expect(classification.suggestedAction).toBe('RETRY_SUBTASK_MODIFIED');
            });
        });

        describe('Native JavaScript Errors', () => {
            it('should classify TypeError appropriately', () => {
                const err = new TypeError("Cannot read property 'x' of undefined");
                const classification = classifyError(err);
                expect(classification.severity).toBe('CRITICAL');
                expect(classification.suggestedAction).toBe('RETRY_SUBTASK_MODIFIED');
                expect(classification.details).toContain('TypeError');
            });

            it('should classify ReferenceError appropriately', () => {
                const err = new ReferenceError("x is not defined");
                const classification = classifyError(err);
                expect(classification.severity).toBe('CRITICAL');
                expect(classification.suggestedAction).toBe('RETRY_SUBTASK_MODIFIED');
                expect(classification.details).toContain('ReferenceError');
            });

            it('should handle errors with circular references', () => {
                const err = new Error("Circular reference");
                const circular = { ref: err };
                err.circular = circular;
                const classification = classifyError(err);
                expect(classification.severity).toBe('CRITICAL');
                expect(classification.details).toBeDefined();
            });
        });

        describe('Optional Task Handling', () => {
            it('should downgrade severity for optional tasks if CRITICAL', () => {
                const err = new PlatformError(
                    "Critical but optional",
                    "SOME_CODE",
                    {},
                    null,
                    "CRITICAL"
                );
                const classification = classifyError(err, { isOptionalTask: true });
                expect(classification.severity).toBe('WARNING');
                expect(classification.suggestedAction).toBe('LOG_AND_CONTINUE');
            });

            it('should not downgrade RETRYABLE_TRANSIENT for optional tasks', () => {
                const err = new VertexAIError(
                    "Transient issue",
                    "VERTEX_RATE_LIMIT",
                    {},
                    null,
                    "TRANSIENT"
                );
                const classification = classifyError(err, { isOptionalTask: true });
                expect(classification.severity).toBe('RETRYABLE_TRANSIENT');
                expect(classification.suggestedAction).toBe('RETRY_SUBTASK_AS_IS');
            });

            it('should handle optional tasks with context', () => {
                const context = { taskId: 'optional-123', importance: 'low' };
                const err = new PlatformError(
                    "Non-critical failure",
                    "TASK_FAILED",
                    context,
                    null,
                    "CRITICAL"
                );
                const classification = classifyError(err, { isOptionalTask: true });
                expect(classification.severity).toBe('WARNING');
                expect(classification.context).toEqual(context);
                expect(classification.suggestedAction).toBe('LOG_AND_CONTINUE');
            });
        });

        describe('Error Classification Details', () => {
            it('should include stack trace in details for development environment', () => {
                const err = new Error("Test error with stack");
                const classification = classifyError(err, { environment: 'development' });
                expect(classification.details).toContain('stack trace');
            });

            it('should handle errors with additional properties', () => {
                const err = new Error("Complex error");
                err.additionalInfo = { key: 'value' };
                const classification = classifyError(err);
                expect(classification.details).toContain('additionalInfo');
            });
        });
    });

    describe('determineRecoveryStrategy', () => {
        const dummyProjectState = { execution: { lastCheckpointId: 'cp-123' } };

        describe('RETRY_AS_IS Strategy', () => {
            it('should return RETRY_AS_IS with increasing delay if attempts < max', () => {
                const classification = { suggestedAction: 'RETRY_SUBTASK_AS_IS' };
                
                const strategy1 = determineRecoveryStrategy(classification, { attemptNumber: 0 }, mockConfigManagerInstance);
                expect(strategy1.type).toBe('RETRY_AS_IS');
                expect(strategy1.delayMs).toBe(100); // baseDelay

                const strategy2 = determineRecoveryStrategy(classification, { attemptNumber: 1 }, mockConfigManagerInstance);
                expect(strategy2.type).toBe('RETRY_AS_IS');
                expect(strategy2.delayMs).toBe(200); // 2 * baseDelay
            });

            it('should HALT if attempts exhausted', () => {
                const classification = { suggestedAction: 'RETRY_SUBTASK_AS_IS' };
                const strategy = determineRecoveryStrategy(classification, { attemptNumber: 2 }, mockConfigManagerInstance);
                expect(strategy.type).toBe('HALT_PROJECT');
                expect(strategy.reason).toContain('Maximum retry attempts');
            });

            it('should handle custom retry parameters', () => {
                const classification = {
                    suggestedAction: 'RETRY_SUBTASK_AS_IS',
                    retryParams: { minDelay: 50, maxDelay: 500 }
                };
                const strategy = determineRecoveryStrategy(classification, { attemptNumber: 0 }, mockConfigManagerInstance);
                expect(strategy.type).toBe('RETRY_AS_IS');
                expect(strategy.delayMs).toBeGreaterThanOrEqual(50);
                expect(strategy.delayMs).toBeLessThanOrEqual(500);
            });
        });

        describe('RETRY_WITH_PARAMS Strategy', () => {
            it('should return RETRY_WITH_PARAMS with modified delay if attempts < max', () => {
                const classification = {
                    suggestedAction: 'RETRY_SUBTASK_MODIFIED',
                    modificationParams: { timeout: 60000 }
                };
                const strategy = determineRecoveryStrategy(classification, { attemptNumber: 0 }, mockConfigManagerInstance);
                expect(strategy.type).toBe('RETRY_WITH_PARAMS');
                expect(strategy.delayMs).toBe(200); // modifiedDelayMs
                expect(strategy.params).toEqual({ timeout: 60000 });
            });

            it('should HALT if modified attempts exhausted', () => {
                const classification = { suggestedAction: 'RETRY_SUBTASK_MODIFIED' };
                const strategy = determineRecoveryStrategy(classification, { attemptNumber: 1 }, mockConfigManagerInstance);
                expect(strategy.type).toBe('HALT_PROJECT');
                expect(strategy.reason).toContain('Maximum modified retry attempts');
            });

            it('should preserve modification context in params', () => {
                const classification = {
                    suggestedAction: 'RETRY_SUBTASK_MODIFIED',
                    modificationContext: { 
                        originalParams: { timeout: 30000 },
                        failureReason: 'TIMEOUT'
                    }
                };
                const strategy = determineRecoveryStrategy(classification, { attemptNumber: 0 }, mockConfigManagerInstance);
                expect(strategy.params.originalParams).toBeDefined();
                expect(strategy.params.failureReason).toBe('TIMEOUT');
            });
        });

        describe('REPLAN_PROJECT Strategy', () => {
            it('should return REPLAN_FROM_CHECKPOINT with checkpoint info', () => {
                const classification = { 
                    suggestedAction: 'REPLAN_PROJECT',
                    details: "Plan invalidated by dependency changes",
                    classifiedType: "PLAN_INVALID"
                };
                const strategy = determineRecoveryStrategy(
                    classification,
                    { projectState: dummyProjectState },
                    mockConfigManagerInstance
                );
                expect(strategy.type).toBe('REPLAN_FROM_CHECKPOINT');
                expect(strategy.params.checkpointId).toBe('cp-123');
                expect(strategy.params.replanReason).toBe("Plan invalidated by dependency changes");
                expect(strategy.params.classifiedType).toBe("PLAN_INVALID");
            });

            it('should handle missing checkpoint gracefully', () => {
                const classification = { suggestedAction: 'REPLAN_PROJECT' };
                const strategy = determineRecoveryStrategy(
                    classification,
                    { projectState: { execution: {} } },
                    mockConfigManagerInstance
                );
                expect(strategy.type).toBe('REPLAN_FROM_CHECKPOINT');
                expect(strategy.params.checkpointId).toBeUndefined();
                expect(strategy.params.replanFromStart).toBe(true);
            });

            it('should include relevant context in replan params', () => {
                const classification = {
                    suggestedAction: 'REPLAN_PROJECT',
                    planningContext: {
                        failedTaskId: 'task-123',
                        affectedDependencies: ['dep1', 'dep2']
                    }
                };
                const strategy = determineRecoveryStrategy(
                    classification,
                    { projectState: dummyProjectState },
                    mockConfigManagerInstance
                );
                expect(strategy.params.planningContext).toBeDefined();
                expect(strategy.params.planningContext.failedTaskId).toBe('task-123');
            });
        });

        describe('Other Strategies', () => {
            it('should handle LOG_AND_CONTINUE for optional tasks', () => {
                const classification = {
                    suggestedAction: 'LOG_AND_CONTINUE',
                    details: 'Optional task failed but can be skipped'
                };
                const strategy = determineRecoveryStrategy(classification, {}, mockConfigManagerInstance);
                expect(strategy.type).toBe('SKIP_OPTIONAL');
                expect(strategy.reason).toContain('Optional task');
            });

            it('should handle HALT appropriately', () => {
                const classification = {
                    suggestedAction: 'HALT',
                    severity: 'FATAL',
                    details: 'Unrecoverable security violation'
                };
                const strategy = determineRecoveryStrategy(classification, {}, mockConfigManagerInstance);
                expect(strategy.type).toBe('HALT_PROJECT');
                expect(strategy.reason).toContain('Unrecoverable');
                expect(strategy.severity).toBe('FATAL');
            });

            it('should handle unknown suggested actions', () => {
                const classification = { suggestedAction: 'UNKNOWN_ACTION' };
                const strategy = determineRecoveryStrategy(classification, {}, mockConfigManagerInstance);
                expect(strategy.type).toBe('HALT_PROJECT');
                expect(strategy.reason).toContain('Unknown recovery action');
            });
        });
    });
});
