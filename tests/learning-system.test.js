import { jest } from '@jest/globals';
import { LearningSystem } from '../src/core/learning-system.js';

describe('LearningSystem', () => {
    let learningSystem;
    let mockConfigManager;

    beforeEach(async () => {
        mockConfigManager = {
            get: jest.fn((key, defaultValue) => defaultValue)
        };
        learningSystem = new LearningSystem({}, null, mockConfigManager);
        await learningSystem.initialize();
    });

    afterEach(async () => {
        if (learningSystem.isInitialized) {
            await learningSystem.shutdown();
        }
    });

    describe('Experience Store Management', () => {
        it('should prune old experiences', async () => {
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - 31); // 31 days old
            const recentDate = new Date();
            
            // Add old and recent experiences
            // Add old and recent experiences directly to store
            await learningSystem.experienceStore.addExperience({
                type: 'AI_PROMPT_EXECUTION',
                context: { projectName: 'test' },
                outcome: { status: 'SUCCESS' },
                timestamp: oldDate.toISOString()
            });
            
            await learningSystem.experienceStore.addExperience({
                type: 'AI_PROMPT_EXECUTION',
                context: { projectName: 'test' },
                outcome: { status: 'SUCCESS' },
                timestamp: recentDate.toISOString()
            });

            const prunedCount = await learningSystem.experienceStore.pruneOldExperiences(
                new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
            );

            expect(prunedCount).toBe(1);
            const remaining = await learningSystem.experienceStore.findExperiences({});
            expect(remaining.length).toBe(1);
        });
    });

    describe('Insight Store Management', () => {
        it('should track insight usage with effectiveness score', async () => {
            const insightId = await learningSystem.insightStore.saveInsight({
                type: 'PROMPT_EFFECTIVENESS',
                description: 'Test insight'
            });

            // Apply insight successfully twice and fail once
            await learningSystem.insightStore.incrementInsightUsage(insightId, true);
            await learningSystem.insightStore.incrementInsightUsage(insightId, true);
            await learningSystem.insightStore.incrementInsightUsage(insightId, false);

            const insight = await learningSystem.insightStore.getInsightById(insightId);
            expect(insight.evaluation.effectivenessScore).toBe(2/3);
            expect(insight.status).toBe('APPLIED');
        });

        it('should support advanced filtering in findInsights', async () => {
            // Create test insights
            await learningSystem.insightStore.saveInsight({
                type: 'PROMPT_EFFECTIVENESS',
                patternDetails: { promptId: 'test1' },
                evaluation: { effectivenessScore: 0.8 }
            });

            await learningSystem.insightStore.saveInsight({
                type: 'ERROR_PATTERN',
                patternDetails: { errorCode: 'TEST_ERROR' },
                evaluation: { effectivenessScore: 0.4 }
            });

            // Test filtering by promptId
            const promptInsights = await learningSystem.insightStore.findInsights({
                relatedToPromptId: 'test1'
            });
            expect(promptInsights.length).toBe(1);
            expect(promptInsights[0].patternDetails.promptId).toBe('test1');

            // Test filtering by error pattern
            const errorInsights = await learningSystem.insightStore.findInsights({
                relatedToErrorPattern: 'TEST_ERROR'
            });
            expect(errorInsights.length).toBe(1);
            expect(errorInsights[0].patternDetails.errorCode).toBe('TEST_ERROR');

            // Test sorting by effectiveness score
            const sortedInsights = await learningSystem.insightStore.findInsights({
                sortBy: 'evaluation.effectivenessScore',
                sortOrder: 'desc'
            });
            expect(sortedInsights[0].evaluation.effectivenessScore).toBe(0.8);
        });
    });

    describe('_analyzePromptPerformance', () => {
        it('should identify low success rate patterns', async () => {
            const experiences = [
                {
                    type: 'AI_PROMPT_EXECUTION',
                    context: { promptId: 'test_prompt', modelName: 'test-model' },
                    outcome: { status: 'SUCCESS', durationMs: 1000, metrics: { tokensUsed: { total: 100 } } }
                },
                {
                    type: 'AI_PROMPT_EXECUTION',
                    context: { promptId: 'test_prompt', modelName: 'test-model' },
                    outcome: { 
                        status: 'FAILURE', 
                        error: { code: 'AI_ERROR', message: 'Failed' },
                        durationMs: 1200,
                        metrics: { tokensUsed: { total: 120 } }
                    }
                },
                {
                    type: 'AI_PROMPT_EXECUTION',
                    context: { promptId: 'test_prompt', modelName: 'test-model' },
                    outcome: { 
                        status: 'FAILURE',
                        error: { code: 'AI_ERROR', message: 'Failed again' },
                        durationMs: 900,
                        metrics: { tokensUsed: { total: 90 } }
                    }
                }
            ];

            const insights = await learningSystem._analyzePromptPerformance(experiences);
            
            expect(insights).toHaveLength(1);
            expect(insights[0]).toMatchObject({
                type: 'PROMPT_EFFECTIVENESS',
                patternDetails: {
                    promptId: 'test_prompt',
                    modelName: 'test-model',
                    observedMetrics: {
                        successRate: 1/3,
                        totalExecutions: 3
                    }
                }
            });
        });

        it('should identify high token usage patterns', async () => {
            const experiences = Array(5).fill(null).map(() => ({
                type: 'AI_PROMPT_EXECUTION',
                context: { promptId: 'large_prompt', modelName: 'test-model' },
                outcome: {
                    status: 'SUCCESS',
                    durationMs: 1000,
                    metrics: { tokensUsed: { total: 5000 } }
                }
            }));

            const insights = await learningSystem._analyzePromptPerformance(experiences);
            
            expect(insights.some(i => i.type === 'PROMPT_EFFICIENCY')).toBe(true);
        });
    });

    describe('_detectErrorPatterns', () => {
        it('should identify recurring error patterns in specific contexts', async () => {
            const experiences = Array(5).fill(null).map(() => ({
                type: 'SUBTASK_EXECUTION',
                context: {
                    subtaskType: 'code_generation',
                    agentPersona: 'PythonDeveloper',
                    projectName: 'test-project'
                },
                outcome: {
                    status: 'FAILURE',
                    error: {
                        code: 'SYNTAX_ERROR',
                        message: 'Invalid Python syntax'
                    }
                }
            }));

            const insights = await learningSystem._detectErrorPatterns(experiences);
            
            expect(insights).toHaveLength(1);
            expect(insights[0]).toMatchObject({
                type: 'ERROR_FREQUENCY_PATTERN',
                patternDetails: {
                    errorCode: 'SYNTAX_ERROR',
                    triggeringContext: {
                        subtaskType: 'code_generation',
                        agentPersona: 'PythonDeveloper'
                    }
                }
            });
        });

        it('should not generate insights for infrequent errors', async () => {
            const experiences = [
                {
                    type: 'SUBTASK_EXECUTION',
                    context: { subtaskType: 'code_generation' },
                    outcome: {
                        status: 'FAILURE',
                        error: { code: 'RARE_ERROR' }
                    }
                }
            ];

            const insights = await learningSystem._detectErrorPatterns(experiences);
            expect(insights).toHaveLength(0);
        });
    });

    describe('_evaluateTaskEfficiency', () => {
        it('should identify tasks with high duration variability', async () => {
            const experiences = [
                {
                    type: 'SUBTASK_EXECUTION',
                    context: {
                        subtaskType: 'code_generation',
                        subtask: { expected_artifacts: ['src/main.py'] }
                    },
                    outcome: {
                        status: 'SUCCESS',
                        durationMs: 1000,
                        metrics: { retryAttempts: 0 }
                    }
                },
                {
                    type: 'SUBTASK_EXECUTION',
                    context: {
                        subtaskType: 'code_generation',
                        subtask: { expected_artifacts: ['src/main.py'] }
                    },
                    outcome: {
                        status: 'SUCCESS',
                        durationMs: 5000,
                        metrics: { retryAttempts: 0 }
                    }
                },
                {
                    type: 'SUBTASK_EXECUTION',
                    context: {
                        subtaskType: 'code_generation',
                        subtask: { expected_artifacts: ['src/main.py'] }
                    },
                    outcome: {
                        status: 'SUCCESS',
                        durationMs: 2000,
                        metrics: { retryAttempts: 0 }
                    }
                }
            ];

            const insights = await learningSystem._evaluateTaskEfficiency(experiences);
            expect(insights.length).toBeGreaterThan(0);
            const anomalyInsight = insights.find(i => i.type === 'TASK_DURATION_ANOMALY');
            expect(anomalyInsight).toBeDefined();
            expect(anomalyInsight.patternDetails.varianceMetrics.durationVariance).toBeGreaterThan(1000);
        });

        it('should identify tasks with high retry rates', async () => {
            const experiences = Array(3).fill(null).map(() => ({
                type: 'SUBTASK_EXECUTION',
                context: {
                    subtaskType: 'api_integration',
                    subtask: { expected_artifacts: ['api_client.js'] }
                },
                outcome: {
                    status: 'SUCCESS',
                    durationMs: 1000,
                    metrics: { retryAttempts: 3 }
                }
            }));

            const insights = await learningSystem._evaluateTaskEfficiency(experiences);
            
            expect(insights.some(i => i.type === 'TASK_COMPLEXITY_ISSUE')).toBe(true);
        });

        it('should not generate insights for tasks with insufficient data', async () => {
            const experiences = [
                {
                    type: 'SUBTASK_EXECUTION',
                    context: { subtaskType: 'rare_task' },
                    outcome: {
                        status: 'SUCCESS',
                        durationMs: 1000,
                        metrics: { retryAttempts: 0 }
                    }
                }
            ];

            const insights = await learningSystem._evaluateTaskEfficiency(experiences);
            expect(insights).toHaveLength(0);
        });
    });

    describe('Integration with processExperiences', () => {
        it('should process experiences and generate insights across all analyzers', async () => {
            const experiences = [
                // Prompt performance experience
                {
                    type: 'AI_PROMPT_EXECUTION',
                    context: { promptId: 'test_prompt' },
                    outcome: { status: 'FAILURE', error: { code: 'AI_ERROR' } }
                },
                // Error pattern experience
                {
                    type: 'SUBTASK_EXECUTION',
                    context: { subtaskType: 'code_generation' },
                    outcome: { status: 'FAILURE', error: { code: 'SYNTAX_ERROR' } }
                },
                // Task efficiency experience
                {
                    type: 'SUBTASK_EXECUTION',
                    context: { subtaskType: 'api_integration' },
                    outcome: { status: 'SUCCESS', durationMs: 5000, metrics: { retryAttempts: 2 } }
                }
            ];

            // Mock the insight store
            learningSystem.insightStore = {
                saveInsight: jest.fn().mockImplementation(insight => Promise.resolve(insight.id))
            };

            // Add experiences to the store
            for (const exp of experiences) {
                await learningSystem.logExperience(exp);
            }

            const stats = await learningSystem.processExperiences();
            
            expect(stats.experiencesProcessed).toBeGreaterThan(0);
            expect(stats.experiencesProcessed).toBe(3);
            expect(stats.insightsGenerated).toBe(1);
            expect(learningSystem.insightStore.saveInsight).toHaveBeenCalled();
        });
    });
});
