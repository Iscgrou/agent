// src/core/learning-system.js
// Basic Learning System: Collects experiences, provides framework for analysis.

import { v4 as uuidv4 } from 'uuid';
import { PlatformError } from './error-utils.js';
// Assuming interfaces are in a .ts file and used for JSDoc/guidance in JS:
/** @typedef {import('./interfaces/learning-system').ExperienceData} ExperienceData */
/** @typedef {import('./interfaces/learning-system').LearnedInsight} LearnedInsight */
/** @typedef {import('./interfaces/learning-system').ExperienceStore} IExperienceStore */
/** @typedef {import('./interfaces/learning-system').InsightStore} IInsightStore */
/** @typedef {import('./interfaces/learning-system').AnalysisQueue} IAnalysisQueue */
/** @typedef {import('./interfaces/learning-system').LearningSystemConfig} LearningSystemConfig */
/** @typedef {import('./interfaces/learning-system').InsightFilter} InsightFilter */
/** @typedef {import('./interfaces/learning-system').ExperienceFilter} ExperienceFilter */

class LearningSystemError extends PlatformError {
    constructor(message, code = 'LEARNING_SYSTEM_ERROR', context = {}, originalError = null, severity = 'WARNING') {
        super(message, code, context, originalError, severity);
    }
}

/** @implements {IExperienceStore} */
class InMemoryExperienceStore {
    constructor() {
        /** @type {Map<string, ExperienceData>} */
        this.experiences = new Map();
        console.log('[LearningSystem] InMemoryExperienceStore initialized.');
    }

    async logExperience(experience) {
        this.experiences.set(experience.id, experience);
        return experience.id;
    }

    async getExperienceById(id) { return this.experiences.get(id) || null; }

    async findExperiences(filter = {}, limit = 1000, offset = 0) {
        let results = Array.from(this.experiences.values());
        if (filter.ids && filter.ids.length > 0) {
            const idSet = new Set(filter.ids);
            results = results.filter(e => idSet.has(e.id));
        }
        if (filter.type) results = results.filter(e => e.type === filter.type);
        if (filter.projectName) results = results.filter(e => e.context.projectName === filter.projectName);
        if (filter.outcomeStatus) results = results.filter(e => e.outcome.status === filter.outcomeStatus);
        if (filter.promptId) results = results.filter(e => e.context.promptId === filter.promptId);
        if (filter.errorCode) results = results.filter(e => e.outcome.error?.code === filter.errorCode);
        if (filter.startDate) results = results.filter(e => new Date(e.timestamp) >= new Date(filter.startDate));
        if (filter.endDate) results = results.filter(e => new Date(e.timestamp) <= new Date(filter.endDate));
        if (filter.tags && filter.tags.length > 0) {
            results = results.filter(e => e.metadata?.tags?.some(tag => filter.tags.includes(tag)));
        }
        if (filter.minExecutionDurationMs) {
            results = results.filter(e => (e.outcome.durationMs || 0) >= filter.minExecutionDurationMs);
        }

        return results.sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                     .slice(offset, offset + limit);
    }

    async countExperiences(filter) {
        const filtered = await this.findExperiences(filter, Infinity);
        return filtered.length;
    }

    async pruneOldExperiences(olderThanISOString) {
        const olderThanDate = new Date(olderThanISOString);
        let prunedCount = 0;
        for (const [id, exp] of this.experiences) {
            if (new Date(exp.timestamp) < olderThanDate) {
                this.experiences.delete(id);
                prunedCount++;
            }
        }
        if (prunedCount > 0) console.log(`[InMemoryExperienceStore] Pruned ${prunedCount} old experiences (older than ${olderThanISOString}).`);
        return prunedCount;
    }
}

/** @implements {IInsightStore} */
class InMemoryInsightStore {
    constructor() { 
        this.insights = new Map(); 
        console.log('[LearningSystem] InMemoryInsightStore initialized.'); 
    }

    async saveInsight(insight) {
        const id = insight.id || uuidv4();
        const newInsight = {
            status: 'NEW',
            discoveredAt: new Date().toISOString(),
            confidence: 0.5,
            evaluation: { timesApplied: 0, successfulApplications: 0, timesAppliedFailed: 0 },
            validationHistory: [],
            ...insight,
            id,
        };
        this.insights.set(id, newInsight);
        console.log(`[InMemoryInsightStore] Saved insight: ${id}, Type: ${newInsight.type}`);
        return id;
    }

    async getInsightById(id) { return this.insights.get(id) || null; }

    async findInsights(filter = {}, limit = 100, offset = 0) {
        let results = Array.from(this.insights.values());
        if(filter.type) results = results.filter(i => i.type === filter.type);
        if(filter.status) results = results.filter(i => i.status === filter.status);
        if(filter.minConfidence !== undefined) results = results.filter(i => i.confidence >= filter.minConfidence);
        if(filter.relatedToPromptId) results = results.filter(i => i.patternDetails?.promptId === filter.relatedToPromptId);
        if(filter.relatedToErrorPattern) results = results.filter(i => i.patternDetails?.errorCode === filter.relatedToErrorPattern);

        if (filter.sortBy) {
            results.sort((a, b) => {
                let valA, valB;
                if (filter.sortBy === 'evaluation.effectivenessScore') {
                    valA = a.evaluation?.effectivenessScore || 0;
                    valB = b.evaluation?.effectivenessScore || 0;
                } else {
                    valA = new Date(a[filter.sortBy] || 0).getTime();
                    valB = new Date(b[filter.sortBy] || 0).getTime();
                }
                return filter.sortOrder === 'asc' ? valA - valB : valB - valA;
            });
        } else {
             results.sort((a,b) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime());
        }
        return results.slice(offset, offset + limit);
    }

    async updateInsight(id, updates) {
        const insight = this.insights.get(id);
        if (!insight) {
            console.warn(`[InMemoryInsightStore] Insight ID ${id} not found for update.`);
            return null;
        }
        const updatedInsight = { ...insight, ...updates };
        if (updates.status || updates.confidence) {
            updatedInsight.lastValidatedAt = new Date().toISOString();
        }
        this.insights.set(id, updatedInsight);
        return updatedInsight;
    }

    async deleteInsight(id) { return this.insights.delete(id); }

    async incrementInsightUsage(insightId, applicationSucceeded) {
        const insight = await this.getInsightById(insightId);
        if (insight) {
            const evalStats = insight.evaluation || { timesApplied: 0, successfulApplications: 0, timesAppliedFailed: 0 };
            evalStats.timesApplied = (evalStats.timesApplied || 0) + 1;
            if (applicationSucceeded) {
                evalStats.successfulApplications = (evalStats.successfulApplications || 0) + 1;
            } else {
                evalStats.timesAppliedFailed = (evalStats.timesAppliedFailed || 0) + 1;
            }
            evalStats.lastAppliedAt = new Date().toISOString();
            
            if (evalStats.timesApplied > 0) {
                evalStats.effectivenessScore = evalStats.successfulApplications / evalStats.timesApplied;
            } else {
                evalStats.effectivenessScore = 0;
            }
            await this.updateInsight(insightId, { evaluation: evalStats, status: 'APPLIED' });
            console.log(`[InMemoryInsightStore] Usage incremented for insight ${insightId}. Success: ${applicationSucceeded}. New Score: ${evalStats.effectivenessScore?.toFixed(2)}`);
        } else {
            console.warn(`[InMemoryInsightStore] Attempted to increment usage for non-existent insight: ${insightId}`);
        }
    }
}

/** @implements {IAnalysisQueue} */
class InMemoryAnalysisQueue {
    constructor() { 
        this.queue = []; 
        console.log('[LearningSystem] InMemoryAnalysisQueue initialized.'); 
    }
    
    async enqueue(experienceId) { this.queue.push(experienceId); }
    async enqueueBatch(experienceIds) { this.queue.push(...experienceIds); }
    async dequeue(batchSize = 1) { return this.queue.splice(0, batchSize); }
    async isEmpty() { return this.queue.length === 0; }
    async size() { return this.queue.length; }
}

class LearningSystem {
    constructor(config = {}, projectPersistence, configManager) {
        this.configManager = configManager;
        this.config = {
            experienceRetentionDays: this.configManager?.get('learningSystem.experienceRetentionDays', 30) || 30,
            minConfidenceForInsightAction: this.configManager?.get('learningSystem.minConfidenceForInsightAction', 0.7) || 0.7,
            periodicAnalysisIntervalMs: this.configManager?.get('learningSystem.periodicAnalysisIntervalMs', 60 * 60 * 1000) || (60 * 60 * 1000),
            maxExperiencesPerAnalysisBatch: this.configManager?.get('learningSystem.maxExperiencesPerAnalysisBatch', 100) || 100,
            staleInsightThresholdDays: this.configManager?.get('learningSystem.staleInsightThresholdDays', 90) || 90,
            systemVersion: this.configManager?.get('system.version', '0.1.0-dev') || '0.1.0-dev',
            ...config
        };

        this.experienceStore = new InMemoryExperienceStore();
        this.insightStore = new InMemoryInsightStore();
        this.analysisQueue = new InMemoryAnalysisQueue();

        this.projectPersistence = projectPersistence;
        this.isInitialized = false;
        this.analysisTimer = null;
        this.eventHandlers = { onInsightDiscovered: [], onAnalysisCompleted: [] };
        console.log('[LearningSystem] Instance created.');
    }

    async initialize() {
        if (this.isInitialized) {
            console.warn('[LearningSystem] System is already initialized.');
            return;
        }
        try {
            this.startPeriodicAnalysis();
            this.isInitialized = true;
            console.log('[LearningSystem] Initialized and periodic analysis started.');
        } catch (error) {
            throw new LearningSystemError('Failed to initialize learning system', 'INITIALIZATION_ERROR', { config: this.config }, error, 'FATAL');
        }
    }

    async logExperience(experienceInput) {
        if (!this.isInitialized) {
            throw new LearningSystemError('Learning system not initialized', 'NOT_INITIALIZED');
        }
        try {
            const experience = {
                id: uuidv4(),
                timestamp: new Date().toISOString(),
                type: experienceInput.type,
                context: experienceInput.context || {},
                outcome: experienceInput.outcome || {},
                metadata: {
                    systemVersion: this.config.systemVersion,
                    ...(experienceInput.metadata || {})
                }
            };
            const loggedId = await this.experienceStore.logExperience(experience);
            await this.analysisQueue.enqueue(loggedId);
            return loggedId;
        } catch (error) {
            throw new LearningSystemError('Failed to log experience', 'LOGGING_ERROR', { inputType: experienceInput.type }, error);
        }
    }

    async processExperiences() {
        if (!this.isInitialized || !(await this.analysisQueue.size())) {
            if(!this.isInitialized) console.warn('[LearningSystem] ProcessExperiences called before init or queue unavailable.');
            return { experiencesProcessed: 0, insightsGenerated: 0, executionTimeMs: 0 };
        }
        const startTime = Date.now();
        let totalProcessed = 0;
        let totalInsightsGenerated = 0;

        console.log(`[LearningSystem] Starting experience processing. Queue size: ${await this.analysisQueue.size()}`);

        while (!(await this.analysisQueue.isEmpty()) && totalProcessed < this.config.maxExperiencesPerAnalysisBatch) {
            const batchSizeToDequeue = Math.min(
                this.config.maxExperiencesPerAnalysisBatch - totalProcessed,
                await this.analysisQueue.size(),
                100
            );
            if (batchSizeToDequeue === 0) break;

            const experienceIdsInBatch = await this.analysisQueue.dequeue(batchSizeToDequeue);
            if (!experienceIdsInBatch || experienceIdsInBatch.length === 0) break;

            const experiencesInBatch = await this.experienceStore.findExperiences({ ids: experienceIdsInBatch }, experienceIdsInBatch.length);
            if (!experiencesInBatch || experiencesInBatch.length === 0) {
                console.warn(`[LearningSystem] Could not retrieve experiences for IDs: ${experienceIdsInBatch.join(', ')}`);
                continue;
            }

            console.log(`[LearningSystem] Analyzing batch of ${experiencesInBatch.length} experiences...`);
            try {
                const promptPerfInsights = await this._analyzePromptPerformance(experiencesInBatch);
                const errorPatternInsights = await this._detectErrorPatterns(experiencesInBatch);
                const taskEffInsights = await this._evaluateTaskEfficiency(experiencesInBatch);

                const allNewInsights = [...promptPerfInsights, ...errorPatternInsights, ...taskEffInsights];
                for (const insight of allNewInsights) {
                    const confidence = insight.confidence !== undefined ? insight.confidence : this.configManager?.get('learningSystem.defaultInsightConfidence', 0.5);
                    if (confidence >= this.config.minConfidenceForInsightAction) {
                        const savedInsightId = await this.insightStore.saveInsight(insight);
                        const savedInsight = await this.insightStore.getInsightById(savedInsightId);
                        if (savedInsight) {
                            totalInsightsGenerated++;
                            this.eventHandlers.onInsightDiscovered.forEach(cb => cb(savedInsight).catch(e => console.error("[LearningSystem] Error in onInsightDiscovered callback:", e)));
                        }
                    }
                }
                totalProcessed += experiencesInBatch.length;
            } catch (batchProcessingError) {
                console.error('[LearningSystem] Error processing an experience batch:', batchProcessingError);
            }
        }
        const durationMs = Date.now() - startTime;
        const stats = { experiencesProcessed: totalProcessed, insightsGenerated: totalInsightsGenerated, executionTimeMs: durationMs, timestamp: new Date() };
        this.eventHandlers.onAnalysisCompleted.forEach(cb => cb(stats).catch(e => console.error("[LearningSystem] Error in onAnalysisCompleted callback:", e)));
        console.log(`[LearningSystem] Batch processing finished. Processed: ${totalProcessed}, New Insights Generated: ${totalInsightsGenerated}, Duration: ${durationMs}ms.`);
        return stats;
    }

    async getLearnedInsights(filter = {}) {
        if (!this.isInitialized || !this.insightStore) {
            throw new LearningSystemError('Not initialized.', 'NOT_INITIALIZED');
        }
        return this.insightStore.findInsights(filter);
    }

    startPeriodicAnalysis() {
        if (this.analysisTimer) clearInterval(this.analysisTimer);
        this.analysisTimer = setInterval(async () => {
            console.log(`[LearningSystem] Triggering periodic analysis (Interval: ${this.config.periodicAnalysisIntervalMs / 1000}s)...`);
            try {
                await this.processExperiences();
            } catch (error) {
                console.error('[LearningSystem] Error in periodic analysis:', error.message);
            }
        }, this.config.periodicAnalysisIntervalMs);
        console.log(`[LearningSystem] Periodic analysis started successfully.`);
    }

    stopPeriodicAnalysis() {
        if (this.analysisTimer) {
            clearInterval(this.analysisTimer);
            this.analysisTimer = null;
            console.log('[LearningSystem] Periodic analysis stopped.');
        }
    }

    async _analyzePromptPerformance(experiences) {
        const promptExecutions = experiences.filter(exp => exp.type === 'AI_PROMPT_EXECUTION');
        if (promptExecutions.length === 0) return [];

        // Group experiences by promptId
        const promptGroups = new Map();
        for (const exp of promptExecutions) {
            const key = `${exp.context.promptId}:${exp.context.modelName || 'default'}`;
            if (!promptGroups.has(key)) {
                promptGroups.set(key, []);
            }
            promptGroups.get(key).push(exp);
        }

        const insights = [];
        const successRateThreshold = this.configManager?.get('learningSystem.thresholds.promptSuccessRate', 0.7);
        const tokenThreshold = this.configManager?.get('learningSystem.thresholds.maxTokensPerPrompt', 4000);
        const durationThreshold = this.configManager?.get('learningSystem.thresholds.maxPromptDurationMs', 10000);

        for (const [key, group] of promptGroups) {
            const [promptId, modelName] = key.split(':');
            const totalCount = group.length;
            const successCount = group.filter(exp => exp.outcome.status === 'SUCCESS').length;
            const successRate = successCount / totalCount;
            
            const avgDurationMs = group.reduce((sum, exp) => sum + (exp.outcome.durationMs || 0), 0) / totalCount;
            const avgTokensTotal = group.reduce((sum, exp) => 
                sum + ((exp.outcome.metrics?.tokensUsed?.total || 0)), 0) / totalCount;

            // Collect error codes and their frequencies
            const errorCodes = group
                .filter(exp => exp.outcome.error?.code)
                .reduce((acc, exp) => {
                    const code = exp.outcome.error.code;
                    acc[code] = (acc[code] || 0) + 1;
                    return acc;
                }, {});

            // Generate insights based on metrics
            if (successRate < successRateThreshold && totalCount >= 5) {
                insights.push({
                    id: uuidv4(),
                    type: 'PROMPT_EFFECTIVENESS',
                    description: `Prompt template '${promptId}' has a low success rate of ${(successRate * 100).toFixed(1)}% after ${totalCount} executions.`,
                    confidence: Math.min(0.5 + (totalCount / 20), 0.95), // Increases with more data points
                    patternDetails: {
                        promptId,
                        modelName,
                        observedMetrics: {
                            successRate,
                            avgDurationMs,
                            avgTokensTotal,
                            totalExecutions: totalCount,
                            commonErrors: Object.entries(errorCodes)
                                .sort(([,a], [,b]) => b - a)
                                .slice(0, 3)
                        }
                    },
                    recommendation: {
                        action: 'FLAG_PROMPT_FOR_REVIEW',
                        details: `Consider reviewing and potentially modifying the prompt template. Common errors: ${
                            Object.entries(errorCodes)
                                .map(([code, count]) => `${code} (${count} times)`)
                                .join(', ')
                        }`
                    }
                });
            }

            if (avgTokensTotal > tokenThreshold) {
                insights.push({
                    id: uuidv4(),
                    type: 'PROMPT_EFFICIENCY',
                    description: `Prompt '${promptId}' consistently uses high token count (avg: ${Math.round(avgTokensTotal)}).`,
                    confidence: 0.8,
                    patternDetails: {
                        promptId,
                        modelName,
                        observedMetrics: { avgTokensTotal, totalExecutions: totalCount }
                    },
                    recommendation: {
                        action: 'OPTIMIZE_PROMPT_LENGTH',
                        details: 'Consider optimizing prompt length to reduce token usage and potential costs.'
                    }
                });
            }

            if (avgDurationMs > durationThreshold) {
                insights.push({
                    id: uuidv4(),
                    type: 'PROMPT_PERFORMANCE',
                    description: `Prompt '${promptId}' has high average execution time (${Math.round(avgDurationMs)}ms).`,
                    confidence: 0.7,
                    patternDetails: {
                        promptId,
                        modelName,
                        observedMetrics: { avgDurationMs, totalExecutions: totalCount }
                    },
                    recommendation: {
                        action: 'OPTIMIZE_PROMPT_EXECUTION',
                        details: 'Consider optimizing prompt complexity or reviewing model configuration.'
                    }
                });
            }
        }

        return insights;
    }

    async _detectErrorPatterns(experiences) {
        const failedExperiences = experiences.filter(exp => 
            exp.outcome.status === 'FAILURE' && 
            (exp.type === 'SUBTASK_EXECUTION' || exp.type === 'PROJECT_ANALYSIS_ORCHESTRATION')
        );
        if (failedExperiences.length === 0) return [];

        const insights = [];
        const errorGroups = new Map();

        // Group errors by their characteristics
        for (const exp of failedExperiences) {
            const errorCode = exp.outcome.error?.code || 'UNKNOWN_ERROR';
            const context = {
                type: exp.type,
                subtaskType: exp.context.subtaskType,
                agentPersona: exp.context.agentPersona
            };
            const key = `${errorCode}:${context.subtaskType || 'any'}:${context.agentPersona || 'any'}`;
            
            if (!errorGroups.has(key)) {
                errorGroups.set(key, { count: 0, experiences: [], context });
            }
            const group = errorGroups.get(key);
            group.count++;
            group.experiences.push(exp);
        }

        for (const [key, group] of errorGroups) {
            const [errorCode, subtaskType, agentPersona] = key.split(':');
            const errorFrequency = group.count / failedExperiences.length;
            const totalOccurrences = group.count;

            if (totalOccurrences >= 3 || errorFrequency >= 0.3) {
                const contextDescription = [
                    subtaskType !== 'any' ? `subtask type '${subtaskType}'` : 'various subtask types',
                    agentPersona !== 'any' ? `persona '${agentPersona}'` : 'various personas'
                ].join(' with ');

                insights.push({
                    id: uuidv4(),
                    type: 'ERROR_FREQUENCY_PATTERN',
                    description: `Error '${errorCode}' frequently occurs in ${contextDescription} (${totalOccurrences} times).`,
                    confidence: Math.min(0.5 + (totalOccurrences / 10), 0.9),
                    patternDetails: {
                        errorCode,
                        triggeringContext: {
                            subtaskType: subtaskType !== 'any' ? subtaskType : null,
                            agentPersona: agentPersona !== 'any' ? agentPersona : null,
                            frequency: errorFrequency,
                            totalOccurrences
                        },
                        sampleErrors: group.experiences
                            .slice(0, 3)
                            .map(exp => ({
                                timestamp: exp.timestamp,
                                errorMessage: exp.outcome.error?.message,
                                projectName: exp.context.projectName
                            }))
                    },
                    recommendation: {
                        action: errorFrequency >= 0.5 ? 'FLAG_TASK_TYPE_FOR_REVIEW' : 'ADJUST_RECOVERY_STRATEGY_WEIGHT',
                        details: `Consider ${
                            errorFrequency >= 0.5 
                                ? 'reviewing task type implementation and error handling'
                                : 'adjusting recovery strategies for this error type'
                        }`
                    }
                });
            }
        }

        return insights;
    }

    async _evaluateTaskEfficiency(experiences) {
        const successfulTasks = experiences.filter(exp => 
            exp.type === 'SUBTASK_EXECUTION' && 
            exp.outcome.status === 'SUCCESS'
        );
        if (successfulTasks.length === 0) return [];

        const insights = [];
        const taskGroups = new Map();

        // Group tasks by type and signature
        for (const exp of successfulTasks) {
            const taskType = exp.context.subtaskType || 'unknown';
            const taskSignature = JSON.stringify({
                type: taskType,
                artifacts: exp.context.subtask?.expected_artifacts || []
            });

            if (!taskGroups.has(taskSignature)) {
                taskGroups.set(taskSignature, []);
            }
            taskGroups.get(taskSignature).push(exp);
        }

        for (const [signature, group] of taskGroups) {
            const { type: taskType } = JSON.parse(signature);
            const totalTasks = group.length;
            if (totalTasks < 3) continue; // Need minimum sample size

            // Calculate metrics
            const durations = group.map(exp => exp.outcome.durationMs || 0);
            const avgDuration = durations.reduce((a, b) => a + b, 0) / totalTasks;
            const retryAttempts = group.map(exp => exp.outcome.metrics?.retryAttempts || 0);
            const avgRetries = retryAttempts.reduce((a, b) => a + b, 0) / totalTasks;

            // Calculate standard deviation for duration
            const durationVariance = durations.reduce((sum, duration) => 
                sum + Math.pow(duration - avgDuration, 2), 0) / totalTasks;
            const durationStdDev = Math.sqrt(durationVariance);

            const durationThreshold = this.configManager?.get(
                `learningSystem.thresholds.taskDuration.${taskType}`, 
                avgDuration * 1.5
            );

            // Check for duration anomalies
            if (avgDuration > durationThreshold || durationStdDev > avgDuration) {
                insights.push({
                    id: uuidv4(),
                    type: 'TASK_DURATION_ANOMALY',
                    description: `Tasks of type '${taskType}' show ${
                        durationStdDev > avgDuration ? 'high variability' : 'consistently long duration'
                    } (avg: ${Math.round(avgDuration)}ms ± ${Math.round(durationStdDev)}ms).`,
                    confidence: Math.min(0.5 + (totalTasks / 20), 0.9),
                    patternDetails: {
                        taskType,
                        metrics: {
                            avgDurationMs: avgDuration,
                            durationStdDev,
                            totalTasks,
                            avgRetryAttempts: avgRetries
                        }
                    },
                    recommendation: {
                        action: 'RECOMMEND_PARAMETER_TUNING',
                        details: durationStdDev > avgDuration
                            ? 'High duration variability suggests inconsistent performance. Consider investigating task complexity factors.'
                            : 'Consider optimizing task implementation or adjusting resource allocation.'
                    }
                });
            }

            // Check for high retry rates
            if (avgRetries > 1) {
                insights.push({
                    id: uuidv4(),
                    type: 'TASK_COMPLEXITY_ISSUE',
                    description: `Tasks of type '${taskType}' frequently require retries (avg: ${avgRetries.toFixed(1)} attempts).`,
                    confidence: Math.min(0.6 + (totalTasks / 15), 0.9),
                    patternDetails: {
                        taskType,
                        metrics: {
                            avgRetryAttempts: avgRetries,
                            totalTasks,
                            avgDurationMs: avgDuration
                        }
                    },
                    recommendation: {
                        action: 'FLAG_TASK_TYPE_FOR_REVIEW',
                        details: 'High retry rate suggests potential issues with task implementation or requirements clarity.'
                    }
                });
            }
        }

        return insights;
    }

    async shutdown() {
        this.stopPeriodicAnalysis();
        this.isInitialized = false;
        console.log('[LearningSystem] Shut down successfully.');
    }
}

export {
    LearningSystem,
    LearningSystemError
};
