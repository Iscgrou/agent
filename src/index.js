// Main System Initialization
// Brings together all components and starts autonomous operation

import SystemManager from './core/system-manager.js';
import { readFileSync } from 'fs';

// Load configuration
const config = JSON.parse(readFileSync('./config/platform-settings.json', 'utf8'));

// System initialization and startup
async function initializeSystem() {
    try {
        console.log('Initializing AI Development Platform...');

        // Create system manager
        const systemManager = new SystemManager(config);

        // Initialize core components
        await systemManager.initialize();
        console.log('Core components initialized successfully');

        // Start continuous operation
        console.log('Starting continuous operation...');
        await systemManager.startOperation();

        // Register global error handlers
        process.on('uncaughtException', async (error) => {
            console.error('Uncaught Exception:', error);
            await systemManager.handleSystemError(error);
        });

        process.on('unhandledRejection', async (reason, promise) => {
            console.error('Unhandled Rejection:', reason);
            await systemManager.handleSystemError(reason);
        });

        // Example: Problem Recognition and Task Distribution
        const exampleProblem = {
            type: 'development',
            description: 'Create a new React component with TypeScript',
            requirements: [
                'TypeScript support',
                'React best practices',
                'Component testing',
                'Documentation'
            ],
            priority: 'high'
        };

        // Demonstrate the system's capabilities
        async function demonstrateSystem() {
            try {
                // 1. Problem Analysis
                console.log('Analyzing problem...');
                const analysis = await systemManager.analyzeProblem(exampleProblem);
                console.log('Problem analysis complete:', analysis);

                // 2. Task Distribution
                console.log('Distributing task...');
                const task = await systemManager.distributeAndMonitorTask(exampleProblem);
                console.log('Task distributed:', task);

                // 3. Monitor Progress
                console.log('Monitoring task progress...');
                const result = await task;
                console.log('Task completed:', result);

                // 4. System Health Check
                console.log('Performing health check...');
                const health = await systemManager.verifySystemHealth();
                console.log('System health:', health);

                // 5. Performance Metrics
                console.log('Current system metrics:', systemManager.state.metrics);

            } catch (error) {
                console.error('Demonstration error:', error);
                await systemManager.handleSystemError(error);
            }
        }

        // Run demonstration
        await demonstrateSystem();

        return systemManager;
    } catch (error) {
        console.error('System initialization failed:', error);
        throw error;
    }
}

// Start the system
initializeSystem()
    .then((system) => {
        console.log('AI Development Platform is running');
        console.log('System State:', system.state);
    })
    .catch((error) => {
        console.error('Failed to start the system:', error);
        process.exit(1);
    });

// Export for testing and external access
export { initializeSystem };
