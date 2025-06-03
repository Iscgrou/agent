// Core Strategies Test Suite
import SystemManager from '../src/core/system-manager.js';
import AgentCoordinator from '../src/core/agent-coordination.js';
import LearningSystem from '../src/core/learning-system.js';
import TaskExecutionSystem from '../src/core/task-execution.js';
import Agent from '../src/core/agent.js';

describe('Core Strategy Tests', () => {
    let systemManager;
    let coordinator;
    let learningSystem;
    let executionSystem;

    beforeEach(() => {
        systemManager = new SystemManager({});
        coordinator = new AgentCoordinator();
        learningSystem = new LearningSystem();
        executionSystem = new TaskExecutionSystem();
    });

    describe('Coordinating Agent Strategy', () => {
        test('Problem Recognition', async () => {
            const problem = {
                type: 'development',
                description: 'Create a new React component',
                requirements: ['TypeScript', 'Testing', 'Documentation']
            };

            const analysis = await coordinator.analyzeProblem(problem);

            expect(analysis).toHaveProperty('complexity');
            expect(analysis).toHaveProperty('requiredSkills');
            expect(analysis).toHaveProperty('dependencies');
            expect(analysis.requiredSkills).toContain('TypeScript');
        });

        test('Task Distribution', async () => {
            const analysis = {
                complexity: 0.7,
                requiredSkills: ['TypeScript', 'React'],
                dependencies: []
            };

            const distribution = await coordinator.distributeTask(analysis);

            expect(distribution).toHaveProperty('assignments');
            expect(distribution.assignments.size).toBeGreaterThan(0);
        });

        test('Resource Allocation', async () => {
            const task = {
                id: 'task-1',
                requirements: {
                    cpu: 0.5,
                    memory: 256,
                    storage: 100
                }
            };

            const allocation = await coordinator.allocateResources(task);

            expect(allocation).toHaveProperty('cpu');
            expect(allocation).toHaveProperty('memory');
            expect(allocation).toHaveProperty('storage');
            expect(allocation.cpu).toBeGreaterThanOrEqual(task.requirements.cpu);
        });
    });

    describe('Infinite Decision-Making Cycle', () => {
        test('Continuous Operation', async () => {
            const operationPromise = systemManager.startOperation();
            
            // Wait for a few cycles
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Check system state
            expect(systemManager.state.running).toBe(true);
            expect(systemManager.state.healthStatus).toBe('healthy');
            
            // Stop operation
            await systemManager.stopOperation();
            
            expect(systemManager.state.running).toBe(false);
        });

        test('Error Recovery', async () => {
            // Simulate error
            const error = new Error('Test error');
            await systemManager.handleSystemError(error);

            expect(systemManager.state.errorCount).toBe(1);
            expect(systemManager.state.recoveryRate).toBeGreaterThan(0);
        });

        test('State Preservation', async () => {
            // Create system state
            const initialState = {
                tasks: ['task1', 'task2'],
                resources: { cpu: 0.5, memory: 256 }
            };

            await systemManager.createCheckpoint();
            
            // Simulate state corruption
            systemManager.state = {};
            
            // Recover from checkpoint
            await systemManager.recoverFromLastCheckpoint();

            expect(systemManager.state).toMatchObject(initialState);
        });
    });

    describe('Learning System', () => {
        test('Pattern Recognition', async () => {
            const experiences = [
                { type: 'task', result: 'success', pattern: 'A' },
                { type: 'task', result: 'success', pattern: 'A' },
                { type: 'task', result: 'failure', pattern: 'B' }
            ];

            const patterns = learningSystem.identifyPatterns(experiences);

            expect(patterns).toContainEqual(
                expect.objectContaining({ pattern: 'A', confidence: expect.any(Number) })
            );
        });

        test('Knowledge Update', async () => {
            const pattern = {
                type: 'solution',
                context: 'React component',
                success: true
            };

            await learningSystem.updateKnowledge([pattern]);

            const knowledge = learningSystem.knowledgeBase.get('solution');
            expect(knowledge).toContainEqual(expect.objectContaining(pattern));
        });
    });

    describe('Task Execution', () => {
        test('Task Implementation', async () => {
            const task = {
                id: 'task-1',
                type: 'development',
                steps: ['setup', 'implement', 'test']
            };

            const result = await executionSystem.executeTask(task);

            expect(result).toHaveProperty('status', 'completed');
            expect(result).toHaveProperty('steps');
            expect(result.steps).toHaveLength(task.steps.length);
        });

        test('Progress Monitoring', async () => {
            const task = {
                id: 'task-1',
                steps: ['step1', 'step2']
            };

            const execution = executionSystem.setupExecution(task);
            const progress = await executionSystem.monitorProgress(execution);

            expect(progress).toHaveProperty('completed');
            expect(progress).toHaveProperty('total');
            expect(progress).toHaveProperty('percentage');
        });
    });

    describe('System Integration', () => {
        test('End-to-End Task Processing', async () => {
            const problem = {
                type: 'development',
                description: 'Create React component',
                requirements: ['TypeScript']
            };

            // Problem analysis
            const analysis = await systemManager.analyzeProblem(problem);
            expect(analysis).toHaveProperty('strategy');

            // Task distribution
            const task = await systemManager.distributeAndMonitorTask(problem);
            expect(task).toHaveProperty('id');

            // Execution
            const result = await task;
            expect(result).toHaveProperty('status', 'completed');
        });
    });
});
