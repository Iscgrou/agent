// src/core/interfaces/learning-system.ts
/**
 * Core interfaces for the Learning System implementation
 */

export type ExperienceType =
    | 'SUBTASK_EXECUTION'
    | 'PROJECT_ANALYSIS_ORCHESTRATION' // For overall analysis/planning by AgentCoordinator
    | 'AI_PROMPT_EXECUTION'       // For individual calls to VertexAIClient by any component
    | 'ERROR_RECOVERY_ATTEMPT'    // When SystemManager attempts a recovery strategy
    | 'REPOSITORY_ANALYSIS'       // Specific to repository understanding steps
    | 'SYSTEM_HEALTH_EVENT';      // For logging system-level events relevant to learning

export type InsightType =
    | 'PROMPT_EFFECTIVENESS'      // How well specific prompts perform
    | 'ERROR_FREQUENCY_PATTERN'   // Recurring errors in specific contexts
    | 'TASK_DURATION_ANOMALY'   // Tasks taking too long/short
    | 'RECOVERY_STRATEGY_SUCCESS_RATE'
    | 'RESOURCE_USAGE_PATTERN';   // e.g., high token usage for certain prompts

export type OutcomeStatus = 'SUCCESS' | 'FAILURE' | 'PARTIAL_SUCCESS' | 'SKIPPED' | 'IN_PROGRESS' | 'TIMED_OUT';

export type RecoveryOutcome = 'SUCCESS' | 'FAILURE' | 'NOT_ATTEMPTED' | 'ESCALATED';

export type InsightAction =
    | 'SUGGEST_PROMPT_MODIFICATION'
    | 'FLAG_PROMPT_FOR_REVIEW'
    | 'ADJUST_RECOVERY_STRATEGY_WEIGHT'
    | 'FLAG_TASK_TYPE_FOR_REVIEW'
    | 'RECOMMEND_PARAMETER_TUNING' // e.g., for sandbox timeouts or AI model params
    | 'IDENTIFY_BOTTLENECK'
    | 'UPDATE_INTERNAL_KNOWLEDGE_BASE';

export interface ExperienceContext {
    projectName?: string;
    requestId?: string;       // ID of the main user request being processed by SystemManager
    sessionId?: string;       // Broader session if applicable
    // For SUBTASK_EXECUTION or ERROR_RECOVERY related to a subtask
    subtaskId?: string;
    subtaskTitle?: string;
    subtaskType?: string;     // e.g., 'code_generation', 'file_analysis', 'repo_clone'
    agentPersona?: string;    // Persona active during this experience
    // For AI_PROMPT_EXECUTION
    promptId?: string;        // Your internal identifier for the prompt template used
    promptHash?: string;      // Hash of the actual prompt text (input + template)
    modelName?: string;       // e.g., 'gemini-pro', 'code-bison'
    modelParametersUsed?: Record<string, any>; // temperature, topK, etc.
    // For ERROR_RECOVERY or FAILURE outcomes
    errorClassification?: {
        classifiedType: string;
        severity: string;
        originalErrorCode?: string;
    };
    // Generic context for other types
    [key: string]: any; // Allow other contextual fields
}

export interface ExperienceOutcome {
    status: OutcomeStatus;
    details?: string;         // Human-readable summary/details of outcome
    durationMs?: number;      // Duration of the specific operation logged
    error?: {                 // Detailed error if status is FAILURE or PARTIAL_SUCCESS
        code: string;         // PlatformError code or classified native error code
        message: string;
        severity?: string;
        stackPreview?: string; // A snippet of the stack
        recoveryStrategyAttempted?: string; // From determineRecoveryStrategy
        recoveryAttemptOutcome?: RecoveryOutcome;
    };
    artifacts?: Array<{       // For operations that produce artifacts
        type: string;         // 'code_file', 'documentation_md', 'test_suite_results_json'
        path?: string;        // If applicable
        identifier?: string;  // e.g., a function name, an API endpoint
        sizeBytes?: number;
        validationStatus?: 'passed' | 'failed' | 'not_applicable';
    }>;
    metrics?: {               // Specific metrics relevant to the outcome
        tokensUsed?: { input: number; output: number; total: number };
        codeQualityScore?: number; // Hypothetical
        testCoverageAchieved?: number; // Hypothetical
        retryAttempts?: number; // For self-debugging or retry loops
    };
}

export interface ExperienceData {
    id: string;               // uuidv4()
    timestamp: string;        // ISO Date string
    type: ExperienceType;
    context: ExperienceContext;
    outcome: ExperienceOutcome;
    metadata: {
        sourceComponent: string; // 'SystemManager', 'AgentCoordinator', 'TaskExecutionSystem', 'VertexAIClient'
        systemVersion: string;   // Version of your AI platform
        tags?: string[];          // For easier filtering/categorization, e.g., ['critical_path', 'user_xyz']
        notes?: string;           // Any manual notes added during logging
    };
}

export interface LearnedInsight {
    id: string;               // uuidv4()
    type: InsightType;
    description: string;      // Human-readable description of the insight/pattern
    confidence: number;       // 0.0 to 1.0
    discoveredAt: string;     // ISO Date string
    lastValidatedAt?: string;  // ISO Date string
    status: 'NEW' | 'VALIDATED' | 'ACTION_SUGGESTED' | 'APPLIED' | 'REJECTED' | 'STALE';
    patternDetails: {         // Describes the pattern/conditions that led to this insight
        promptId?: string;
        modelName?: string;
        observedMetrics?: {
            successRate?: number;
            avgDurationMs?: number;
            avgTokensUsed?: number;
            commonFailureCodes?: Array<{ code: string, frequency: number }>;
        };
        errorCode?: string;
        errorSeverity?: string;
        triggeringContext?: Partial<ExperienceContext>;
        frequency?: number;
    };
    recommendation?: {        // Actionable recommendation
        action: InsightAction;
        parameters?: Record<string, any>;
        justification: string;
        expectedImpact?: string;
    };
    evaluation?: {            // Tracking the usefulness of this insight
        timesApplied: number;
        successfulApplications: number;
        effectivenessScore?: number;
        lastAppliedAt?: string;
    };
    validationHistory?: Array<{
        timestamp: string;
        method: 'AUTOMATED_STATISTICAL' | 'HEURISTIC_CHECK' | 'HUMAN_REVIEW';
        result: 'CONFIRMED_VALID' | 'POTENTIALLY_VALID' | 'REJECTED_INVALID' | 'NEEDS_MORE_DATA';
        notes?: string;
    }>;
}

export interface ExperienceFilter {
    type?: ExperienceType;
    startDate?: string;
    endDate?: string;
    projectName?: string;
    subtaskType?: string;
    outcomeStatus?: OutcomeStatus;
    tags?: string[];
    minExecutionDurationMs?: number;
    promptId?: string;
    errorCode?: string;
    ids?: string[];
}

export interface InsightFilter {
    type?: InsightType;
    minConfidence?: number;
    status?: 'NEW' | 'VALIDATED' | 'ACTION_SUGGESTED' | 'APPLIED';
    relatedToPromptId?: string;
    sortBy?: 'confidence' | 'discoveredAt' | 'lastValidatedAt';
    sortOrder?: 'asc' | 'desc';
}

export interface LearningSystemConfig {
    experienceRetentionDays?: number;
    minConfidenceForInsightAction?: number;
    periodicAnalysisIntervalMs?: number;
    maxExperiencesPerAnalysisBatch?: number;
    staleInsightThresholdDays?: number;
    systemVersion?: string;
}

export interface ExperienceStore {
    initialize?(): Promise<void>;
    logExperience(experience: ExperienceData): Promise<string>;
    getExperienceById(id: string): Promise<ExperienceData | null>;
    findExperiences(filter: ExperienceFilter, limit?: number, offset?: number): Promise<ExperienceData[]>;
    countExperiences(filter: ExperienceFilter): Promise<number>;
    pruneOldExperiences(olderThan: string): Promise<number>;
}

export interface InsightStore {
    initialize?(): Promise<void>;
    saveInsight(insight: LearnedInsight): Promise<string>;
    getInsightById(id: string): Promise<LearnedInsight | null>;
    findInsights(filter: InsightFilter, limit?: number, offset?: number): Promise<LearnedInsight[]>;
    updateInsight(id: string, updates: Partial<Omit<LearnedInsight, 'id' | 'discoveredAt'>>): Promise<LearnedInsight | null>;
    deleteInsight(id: string): Promise<boolean>;
    incrementInsightUsage(id: string, successfulApplication: boolean): Promise<void>;
}

export interface AnalysisQueue {
    initialize?(): Promise<void>;
    enqueue(experienceId: string): Promise<void>;
    enqueueBatch(experienceIds: string[]): Promise<void>;
    dequeue(batchSize: number): Promise<string[]>;
    isEmpty(): Promise<boolean>;
    size(): Promise<number>;
}
