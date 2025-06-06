import logger from '../utils/logger.js';
import config from '../config/index.js';

// Custom error classes
export class AppError extends Error {
    constructor(message, statusCode, code = 'INTERNAL_ERROR', data = {}) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.data = data;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

export class ValidationError extends AppError {
    constructor(message, data = {}) {
        super(message, 400, 'VALIDATION_ERROR', data);
    }
}

export class AuthenticationError extends AppError {
    constructor(message = 'Authentication failed') {
        super(message, 401, 'AUTHENTICATION_ERROR');
    }
}

export class AuthorizationError extends AppError {
    constructor(message = 'Not authorized') {
        super(message, 403, 'AUTHORIZATION_ERROR');
    }
}

export class NotFoundError extends AppError {
    constructor(message = 'Resource not found') {
        super(message, 404, 'NOT_FOUND_ERROR');
    }
}

// Error handling middleware
export const errorHandler = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    // Log error
    if (err.statusCode === 500) {
        logger.error('Internal Server Error', {
            error: err,
            stack: err.stack,
            path: req.path,
            method: req.method,
            requestId: req.id
        });
    } else {
        logger.warn('Request Error', {
            error: err,
            path: req.path,
            method: req.method,
            requestId: req.id
        });
    }

    // Prepare error response
    const errorResponse = {
        status: err.status,
        code: err.code || 'INTERNAL_ERROR',
        message: err.message,
        requestId: req.id
    };

    // Add stack trace in development
    if (config.server.env === 'development') {
        errorResponse.stack = err.stack;
        errorResponse.data = err.data;
    }

    // Handle specific error types
    if (err.name === 'ValidationError') {
        errorResponse.code = 'VALIDATION_ERROR';
        errorResponse.statusCode = 400;
        errorResponse.details = err.details;
    }

    if (err.name === 'JsonWebTokenError') {
        errorResponse.code = 'INVALID_TOKEN';
        errorResponse.statusCode = 401;
    }

    if (err.name === 'TokenExpiredError') {
        errorResponse.code = 'TOKEN_EXPIRED';
        errorResponse.statusCode = 401;
    }

    // Send error response
    res.status(err.statusCode).json(errorResponse);
};

// 404 handler
export const notFoundHandler = (req, res, next) => {
    next(new NotFoundError(`Route ${req.originalUrl} not found`));
};

// Async handler wrapper
export const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// Request validation middleware
export const validateRequest = (schema) => (req, res, next) => {
    try {
        const validatedData = schema.parse({
            body: req.body,
            query: req.query,
            params: req.params
        });

        // Replace request data with validated data
        req.body = validatedData.body;
        req.query = validatedData.query;
        req.params = validatedData.params;

        next();
    } catch (error) {
        next(new ValidationError('Invalid request data', error.errors));
    }
};

// Rate limiting error handler
export const rateLimitHandler = (req, res) => {
    throw new AppError('Too many requests', 429, 'RATE_LIMIT_EXCEEDED');
};

// Global error handler setup
export const setupErrorHandling = (app) => {
    // Handle 404
    app.use(notFoundHandler);

    // Handle all errors
    app.use(errorHandler);

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
        logger.error('Uncaught Exception', { error: err });
        process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (err) => {
        logger.error('Unhandled Rejection', { error: err });
        process.exit(1);
    });
};
