// src/core/learning-system.js
// Manages knowledge accumulation and learning from task executions.
// Integrates with Vertex AI to improve prompt engineering and code generation over time.

import { VertexAIChatModel } from './vertexAI-client.js';
import { generateSelfReflectionPrompt } from './prompt-templates.js';

class LearningSystem {
    constructor(config) {
        this.config = config;
        this.chatModel = new VertexAIChatModel(config.vertexAIChatConfig);
        this.knowledgeBase = new Map();
        this.learningState = {
            initialized: false,
            lastUpdate: null,
            metrics: {
                tasksProcessed: 0,
                successfulLearnings: 0,
                failedLearnings: 0,
                knowledgeBaseSize: 0
            }
        };
    }

    async initialize() {
        console.log('[Learning] Initializing learning system...');
        try {
            // Load any existing knowledge base
            await this.loadKnowledgeBase();
            this.learningState.initialized = true;
            this.learningState.lastUpdate = new Date();
            console.log('[Learning] Initialization complete');
        } catch (error) {
            console.error('[Learning] Initialization failed:', error);
            throw error;
        }
    }

    async processTaskResult(subtask, result) {
        console.log(`[Learning] Processing task result for ${subtask.id}`);
        try {
            // Generate reflection prompt
            const reflectionContext = {
                subtask,
                result,
                currentKnowledge: this.getRelevantKnowledge(subtask)
            };
            const reflectionPrompt = generateSelfReflectionPrompt(reflectionContext);

            // Get insights from Vertex AI
            const reflection = await this.chatModel.generateText(reflectionPrompt, {
                temperature: 0.2,
                maxOutputTokens: 1024
            });

            // Parse and store learnings
            const learnings = this.parseLearnings(reflection);
            await this.integrateNewKnowledge(subtask, result, learnings);

            this.updateMetrics(true);
            console.log(`[Learning] Successfully processed task ${subtask.id}`);
            return learnings;
        } catch (error) {
            console.error(`[Learning] Failed to process task ${subtask.id}:`, error);
            this.updateMetrics(false);
            throw error;
        }
    }

    getRelevantKnowledge(subtask) {
        const relevantPatterns = [];
        for (const [key, knowledge] of this.knowledgeBase) {
            if (this.isKnowledgeRelevant(knowledge, subtask)) {
                relevantPatterns.push(knowledge);
            }
        }
        return relevantPatterns;
    }

    async integrateNewKnowledge(subtask, result, learnings) {
        const knowledgeKey = this.generateKnowledgeKey(subtask, learnings);
        
        if (this.knowledgeBase.has(knowledgeKey)) {
            // Update existing knowledge
            const existingKnowledge = this.knowledgeBase.get(knowledgeKey);
            existingKnowledge.occurrences++;
            existingKnowledge.lastSeen = new Date();
            existingKnowledge.examples.push({
                subtask: subtask.id,
                result: result.success,
                timestamp: new Date()
            });
            
            if (result.success) {
                existingKnowledge.successCount++;
                existingKnowledge.patterns = this.mergePatterns(
                    existingKnowledge.patterns,
                    learnings.patterns
                );
            } else {
                existingKnowledge.failureCount++;
                existingKnowledge.antiPatterns = this.mergePatterns(
                    existingKnowledge.antiPatterns,
                    learnings.antiPatterns
                );
            }
        } else {
            // Create new knowledge entry
            this.knowledgeBase.set(knowledgeKey, {
                id: knowledgeKey,
                type: subtask.type,
                context: subtask.context,
                patterns: result.success ? learnings.patterns : [],
                antiPatterns: !result.success ? learnings.antiPatterns : [],
                occurrences: 1,
                successCount: result.success ? 1 : 0,
                failureCount: result.success ? 0 : 1,
                firstSeen: new Date(),
                lastSeen: new Date(),
                examples: [{
                    subtask: subtask.id,
                    result: result.success,
                    timestamp: new Date()
                }]
            });
        }

        await this.persistKnowledgeBase();
    }

    parseLearnings(reflectionText) {
        try {
            const reflection = JSON.parse(reflectionText);
            return {
                patterns: reflection.learnings?.patterns || [],
                antiPatterns: reflection.learnings?.antiPatterns || [],
                recommendations: reflection.recommendations || [],
                knowledgeUpdates: reflection.knowledgeBase?.updates || []
            };
        } catch (error) {
            console.error('[Learning] Failed to parse reflection:', error);
            return {
                patterns: [],
                antiPatterns: [],
                recommendations: [],
                knowledgeUpdates: []
            };
        }
    }

    isKnowledgeRelevant(knowledge, subtask) {
        // Check type match
        if (knowledge.type === subtask.type) return true;

        // Check context overlap
        if (knowledge.context && subtask.context) {
            const contextOverlap = Object.keys(knowledge.context)
                .some(key => subtask.context[key] === knowledge.context[key]);
            if (contextOverlap) return true;
        }

        // Check technology match
        if (knowledge.technologies && subtask.technologies) {
            const techOverlap = knowledge.technologies
                .some(tech => subtask.technologies.includes(tech));
            if (techOverlap) return true;
        }

        return false;
    }

    generateKnowledgeKey(subtask, learnings) {
        const components = [
            subtask.type,
            subtask.technologies?.sort().join(','),
            learnings.patterns?.map(p => p.id).sort().join(',')
        ].filter(Boolean);
        
        return `knowledge_${components.join('_')}`;
    }

    mergePatterns(existing = [], newPatterns = []) {
        const merged = [...existing];
        for (const newPattern of newPatterns) {
            const existingIndex = merged.findIndex(p => p.id === newPattern.id);
            if (existingIndex >= 0) {
                merged[existingIndex] = {
                    ...merged[existingIndex],
                    ...newPattern,
                    occurrences: (merged[existingIndex].occurrences || 0) + 1
                };
            } else {
                merged.push({ ...newPattern, occurrences: 1 });
            }
        }
        return merged;
    }

    updateMetrics(success) {
        const metrics = this.learningState.metrics;
        metrics.tasksProcessed++;
        if (success) {
            metrics.successfulLearnings++;
        } else {
            metrics.failedLearnings++;
        }
        metrics.knowledgeBaseSize = this.knowledgeBase.size;
        this.learningState.lastUpdate = new Date();
    }

    async loadKnowledgeBase() {
        // Implement loading from persistent storage
        console.log('[Learning] Loading knowledge base...');
    }

    async persistKnowledgeBase() {
        // Implement saving to persistent storage
        console.log('[Learning] Persisting knowledge base updates...');
    }
}

// Export the Learning System
export default LearningSystem;
