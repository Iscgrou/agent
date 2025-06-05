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
        const id = experience.id || uuidv4();
        const newExperience = { ...experience, id, timestamp: new Date().toISOString() };
        this.experiences.set(id, newExperience);
        return id;
    }

    async getExperienceById(id) { return this.experiences.get(id) || null; }

    async findExperiences(filter = {}, limit = 100, offset = 0) {
        let results = Array.from(this.experiences.values());
        if (filter.ids && filter.ids.length > 0) {
            const idSet = new Set(filter.ids);
            results = results.filter(e => idSet.has(e.id));
        }
        if (filter.type) results = results.filter(e => e.type === filter.type);
        if (filter.projectName) results = results.filter(e => e.context.projectName === filter.projectName);
        if (filter.outcomeStatus) results = results.filter(e => e.outcome.status === filter.outcomeStatus);
        if (filter.startDate) results = results.filter(e => new Date(e.timestamp) >= new Date(filter.startDate));
        if (filter.endDate) results = results.filter(e => new Date(e.timestamp) <= new Date(filter.endDate));
        if (filter.tags && filter.tags.length > 0) {
            results = results.filter(e => e.metadata?.tags?.some(tag => filter.tags.includes(tag)));
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
        const newInsight = { ...insight, id, discoveredAt: insight.discoveredAt || new Date().toISOString() };
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
        return results.sort((a,b) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime())
                     .slice(offset, offset + limit);
    }

    async updateInsight(id, updates) {
        const insight = this.insights.get(id);
        if (!insight) return null;
        const updatedInsight = { ...insight, ...updates, lastValidatedAt: new Date().toISOString() };
        this.insights.set(id, updatedInsight);
        return updatedInsight;
    }

    async deleteInsight(id) { return this.insights.delete(id); }

    async incrementInsightUsage(id, successfulApplication) {
        const insight = this.insights.get(id);
        if (insight) {
            insight.usageStats = insight.usageStats || { 
                timesConsidered: 0, 
                successfulApplications: 0, 
                timesAppliedFailed: 0 
            };
            insight.usageStats.timesConsidered++;
            if (successfulApplication) {
                insight.usageStats.successfulApplications++;
            } else {
                insight.usageStats.timesAppliedFailed++;
            }
            insight.usageStats.lastAppliedAt = new Date().toISOString();
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
        let totalInsights = 0;

        console.log(`[LearningSystem] Starting experience processing. Queue size: ${await this.analysisQueue.size()}`);
        
        while (!(await this.analysisQueue.isEmpty()) && totalProcessed < this.config.maxExperiencesPerAnalysisBatch) {
            const batchSizeForDequeue = Math.min(
                this.config.maxExperiencesPerAnalysisBatch - totalProcessed,
                await this.analysisQueue.size(),
                100
            );
            if (batchSizeForDequeue === 0) break;

            const experienceIdsBatch = await this.analysisQueue.dequeue(batchSizeForDequeue);
            if (!experienceIdsBatch || experienceIdsBatch.length === 0) break;

            const experiencesToAnalyze = await this.experienceStore.findExperiences({ ids: experienceIdsBatch });
            if (!experiencesToAnalyze || experiencesToAnalyze.length === 0) {
                console.warn(`[LearningSystem] Could not retrieve experiences for IDs: ${experienceIdsBatch.join(', ')}`);
                continue;
            }
            
            console.log(`[LearningSystem] Analyzing batch of ${experiencesToAnalyze.length} experiences...`);
            try {
                const promptPerfInsights = await this._analyzePromptPerformance(experiencesToAnalyze);
                const errorPatternInsights = await this._detectErrorPatterns(experiencesToAnalyze);
                const taskEffInsights = await this._evaluateTaskEfficiency(experiencesToAnalyze);

                const allNewInsights = [...promptPerfInsights, ...errorPatternInsights, ...taskEffInsights];
                for (const insight of allNewInsights) {
                    if (insight.confidence >= this.config.minConfidenceForInsightAction) {
                        await this.insightStore.saveInsight(insight);
                        totalInsights++;
                        this.eventHandlers.onInsightDiscovered.forEach(cb => cb(insight).catch(e => 
                            console.error("[LearningSystem] Error in onInsightDiscovered callback:", e)));
                    }
                }
                totalProcessed += experiencesToAnalyze.length;
            } catch (batchError) {
                console.error('[LearningSystem] Error processing an experience batch:', batchError);
            }
        }
        const durationMs = Date.now() - startTime;
        const stats = { 
            experiencesProcessed: totalProcessed, 
            insightsGenerated: totalInsights, 
            executionTimeMs: durationMs, 
            timestamp: new Date() 
        };
        this.eventHandlers.onAnalysisCompleted.forEach(cb => cb(stats).catch(e => 
            console.error("[LearningSystem] Error in onAnalysisCompleted callback:", e)));
        console.log(`[LearningSystem] Batch processing finished. Processed: ${totalProcessed}, New Insights: ${totalInsights}, Duration: ${durationMs}ms.`);
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
        console.log(`[LearningSystem_STUB] Analyzing prompt performance for ${experiences.length} experiences.`);
        return [];
    }

    async _detectErrorPatterns(experiences) {
        console.log(`[LearningSystem_STUB] Detecting error patterns for ${experiences.length} experiences.`);
        return [];
    }

    async _evaluateTaskEfficiency(experiences) {
        console.log(`[LearningSystem_STUB] Evaluating task efficiency for ${experiences.length} experiences.`);
        return [];
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
