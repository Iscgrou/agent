// tests/learning-system.test.js
import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { LearningSystem, LearningSystemError } from '../src/core/learning-system.js';

// Mock uuid
jest.mock('uuid', () => ({
    v4: jest.fn(() => 'mock-uuid')
}));

describe('LearningSystem', () => {
    let learningSystem;
    const mockConfig = {
        experienceRetentionDays: 30,
        minConfidenceForInsightAction: 0.7,
        periodicAnalysisIntervalMs: 1000,
        maxExperiencesPerAnalysisBatch: 10,
        staleInsightThresholdDays: 90,
        systemVersion: '1.0.0'
    };

    beforeEach(() => {
        learningSystem = new LearningSystem(mockConfig);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Initialization', () => {
        test('should initialize with default config values', () => {
            const ls = new LearningSystem();
            expect(ls.config.experienceRetentionDays).toBe(30);
            expect(ls.config.minConfidenceForInsightAction).toBe(0.7);
            expect(ls.isInitialized).toBe(false);
        });

        test('should initialize with provided config values', () => {
            expect(learningSystem.config).toEqual(mockConfig);
        });

        test('should initialize stores and queue', async () => {
            await learningSystem.initialize();
            expect(learningSystem.isInitialized).toBe(true);
            expect(learningSystem.experienceStore).toBeTruthy();
            expect(learningSystem.insightStore).toBeTruthy();
            expect(learningSystem.analysisQueue).toBeTruthy();
        });
    });

    describe('Experience Logging', () => {
        beforeEach(async () => {
            await learningSystem.initialize();
        });

        test('should log experience with correct structure', async () => {
            const experienceInput = {
                type: 'SUBTASK_EXECUTION',
                context: {
                    projectName: 'test-project',
                    subtaskId: '123'
                },
                outcome: {
                    status: 'SUCCESS',
                    durationMs: 1000
                }
            };

            const logSpy = jest.spyOn(learningSystem.experienceStore, 'logExperience');
            const enqueueSpy = jest.spyOn(learningSystem.analysisQueue, 'enqueue');

            const loggedId = await learningSystem.logExperience(experienceInput);

            expect(loggedId).toBe('mock-uuid');
            expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
                id: 'mock-uuid',
                type: 'SUBTASK_EXECUTION',
                context: expect.objectContaining({
                    projectName: 'test-project',
                    subtaskId: '123'
                }),
                metadata: expect.objectContaining({
                    systemVersion: mockConfig.systemVersion
                })
            }));
            expect(enqueueSpy).toHaveBeenCalledWith('mock-uuid');
        });

        test('should throw if not initialized', async () => {
            const uninitializedSystem = new LearningSystem(mockConfig);
            await expect(uninitializedSystem.logExperience({}))
                .rejects
                .toThrow(LearningSystemError);
        });
    });

    describe('Experience Processing', () => {
        beforeEach(async () => {
            await learningSystem.initialize();
        });

        test('should process experiences and generate insights', async () => {
            // Mock experience data
            const mockExperience = {
                id: 'exp-1',
                type: 'SUBTASK_EXECUTION',
                context: { projectName: 'test' },
                outcome: { status: 'SUCCESS' }
            };

            // Setup spies
            const findExperiencesSpy = jest.spyOn(learningSystem.experienceStore, 'findExperiences')
                .mockResolvedValue([mockExperience]);
            const saveInsightSpy = jest.spyOn(learningSystem.insightStore, 'saveInsight')
                .mockResolvedValue('insight-1');

            // Mock analysis methods to return some insights
            jest.spyOn(learningSystem, '_analyzePromptPerformance')
                .mockResolvedValue([{
                    id: 'insight-1',
                    type: 'PROMPT_EFFECTIVENESS',
                    confidence: 0.8,
                    description: 'Test insight'
                }]);

            // Add experience to queue
            await learningSystem.analysisQueue.enqueue('exp-1');

            // Process experiences
            const result = await learningSystem.processExperiences();

            expect(result.experiencesProcessed).toBe(1);
            expect(result.insightsGenerated).toBe(1);
            expect(findExperiencesSpy).toHaveBeenCalled();
            expect(saveInsightSpy).toHaveBeenCalled();
        });
    });

    describe('Insight Retrieval', () => {
        beforeEach(async () => {
            await learningSystem.initialize();
        });

        test('should retrieve insights with filtering', async () => {
            const mockInsights = [{
                id: 'insight-1',
                type: 'PROMPT_EFFECTIVENESS',
                confidence: 0.8
            }];

            jest.spyOn(learningSystem.insightStore, 'findInsights')
                .mockResolvedValue(mockInsights);

            const filter = { type: 'PROMPT_EFFECTIVENESS', minConfidence: 0.7 };
            const insights = await learningSystem.getLearnedInsights(filter);

            expect(insights).toEqual(mockInsights);
        });
    });

    describe('Periodic Analysis', () => {
        beforeEach(async () => {
            await learningSystem.initialize();
        });

        test('should start and stop periodic analysis', async () => {
            const processSpy = jest.spyOn(learningSystem, 'processExperiences')
                .mockResolvedValue({ experiencesProcessed: 0, insightsGenerated: 0 });

            learningSystem.startPeriodicAnalysis();
            expect(learningSystem.analysisTimer).toBeTruthy();

            // Wait for one interval
            await new Promise(resolve => setTimeout(resolve, mockConfig.periodicAnalysisIntervalMs + 100));

            learningSystem.stopPeriodicAnalysis();
            expect(learningSystem.analysisTimer).toBeNull();
            expect(processSpy).toHaveBeenCalled();
        });
    });

    describe('Shutdown', () => {
        beforeEach(async () => {
            await learningSystem.initialize();
        });

        test('should properly shutdown the system', async () => {
            learningSystem.startPeriodicAnalysis();
            await learningSystem.shutdown();

            expect(learningSystem.isInitialized).toBe(false);
            expect(learningSystem.analysisTimer).toBeNull();
        });
    });
});
