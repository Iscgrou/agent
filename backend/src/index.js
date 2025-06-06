import app from './app.js';
import logger from './utils/logger.js';

// Start the application
app.start().catch(error => {
    logger.error('Failed to start application', error);
    process.exit(1);
});

// Handle global promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', {
        promise,
        reason,
        stack: reason.stack
    });
});

// Handle global exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', {
        error,
        stack: error.stack
    });
    // Exit on uncaught exception as the application state might be corrupted
    process.exit(1);
});

// Log Node.js warnings
process.on('warning', (warning) => {
    logger.warn('Node.js Warning:', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack
    });
});
