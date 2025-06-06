/**
 * Core interfaces for the Learning System implementation
 */

export type ExperienceType =
    | 'SUBTASK_EXECUTION'
    | 'PROJECT_ANALYSIS_ORCHESTRATION'
    | 'AI_PROMPT_EXECUTION'
    | 'ERROR_RECOVERY_ATTEMPT'
    | 'REPOSITORY_ANALYSIS'
    | 'SYSTEM_HEALTH_EVENT';

export type InsightType =
    | 'PROMPT_EFFECTIVENESS'
    | 'ERROR_FREQUENCY_PATTERN'
    | 'TASK_DURATION_ANOMALY'
    | 'RECOVERY_STRATEGY_SUCCESS_RATE'
    | 'RESOURCE_USAGE_PATTERN';

export type OutcomeStatus = 'SUCCESS' | 'FAILURE' | 'PARTIAL_SUCCESS' | 'SKIPPED' | 'IN_PROGRESS' | 'TIMED_OUT';

export type RecoveryOutcome = 'SUCCESS' | 'FAILURE' | 'NOT_ATTEMPTED' | 'ESCALATED';

export type InsightAction =
    | 'SUGGEST_PROMPT_MODIFICATION'
    | 'FLAG_PROMPT_FOR_REVIEW'
    | 'ADJUST_RECOVERY_STRATEGY_WEIGHT'
    | 'FLAG_TASK_TYPE_FOR_REVIEW'
    | 'RECOMMEND_PARAMETER_TUNING'
    | 'IDENTIFY_BOTTLENECK'
    | 'UPDATE_INTERNAL_KNOWLEDGE_BASE';

export interface ExperienceContext {
    projectName?: string;
    requestId?: string;
    sessionId?: string;
    subtaskId?: string;
    subtaskTitle?: string;
    subtaskType?: string;
    agentPersona?: string;
    promptId?: string;
    promptHash?: string;
    modelName?: string;
    modelParametersUsed?: Record<string, any>;
    errorClassification?: {
        classifiedType: string;
        severity: string;
        originalErrorCode?: string;
    };
    [key: string]: any;
}

export interface ExperienceOutcome {
    status: OutcomeStatus;
    details?: string;
    durationMs?: number;
    error?: {
        code: string;
        message: string;
        severity?: string;
        stackPreview?: string;
        recoveryStrategyAttempted?: string;
        recoveryAttemptOutcome?: RecoveryOutcome;
    };
    artifacts?: Array<{
        type: string;
        path?: string;
        identifier?: string;
        sizeBytes?: number;
        validationStatus?: 'passed' | 'failed' | 'not_applicable';
    }>;
    metrics?: {
        tokensUsed?: { input: number; output: number; total: number };
        codeQualityScore?: number;
        testCoverageAchieved?: number;
        retryAttempts?: number;
    };
}

export interface ExperienceData {
    id: string;
    timestamp: string;
    type: ExperienceType;
    context: ExperienceContext;
    outcome: ExperienceOutcome;
    metadata: {
        sourceComponent: string;
        systemVersion: string;
        tags?: string[];
        notes?: string;
    };
}

export interface LearnedInsight {
    id: string;
    type: InsightType;
    description: string;
    confidence: number;
    discoveredAt: string;
    lastValidatedAt?: string;
    status: 'NEW' | 'VALIDATED' | 'ACTION_SUGGESTED' | 'APPLIED' | 'REJECTED' | 'STALE';
    patternDetails: {
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
    recommendation?: {
        action: InsightAction;
        parameters?: Record<string, any>;
        justification: string;
        expectedImpact?: string;
    };
    evaluation?: {
        timesApplied: number;
        successfulApplications: number;
        timesAppliedFailed: number;
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
    relatedToErrorPattern?: string;
    sortBy?: 'confidence' | 'discoveredAt' | 'lastValidatedAt' | 'evaluation.effectivenessScore';
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
    incrementInsightUsage(insightId: string, applicationSucceeded: boolean): Promise<void>;
}

export interface AnalysisQueue {
    initialize?(): Promise<void>;
    enqueue(experienceId: string): Promise<void>;
    enqueueBatch(experienceIds: string[]): Promise<void>;
    dequeue(batchSize: number): Promise<string[]>;
    isEmpty(): Promise<boolean>;
    size(): Promise<number>;
}
