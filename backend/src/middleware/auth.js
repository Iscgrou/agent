import authService from '../services/AuthService.js';
import { AuthenticationError, AuthorizationError } from './errorHandler.js';
import { asyncHandler } from './errorHandler.js';

export const authenticate = asyncHandler(async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new AuthenticationError('No token provided');
    }

    const token = authHeader.split(' ')[1];
    const { user, tokenData } = await authService.validateToken(token);

    // Attach user and token data to request
    req.user = user;
    req.tokenData = tokenData;
    next();
});

export const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            throw new AuthenticationError('User not authenticated');
        }

        if (!roles.includes(req.user.role)) {
            throw new AuthorizationError('Insufficient permissions');
        }

        next();
    };
};

export const requireSelfOrAdmin = (paramName = 'userId') => {
    return (req, res, next) => {
        if (!req.user) {
            throw new AuthenticationError('User not authenticated');
        }

        const resourceUserId = req.params[paramName];
        if (req.user.role !== 'admin' && req.user.id !== resourceUserId) {
            throw new AuthorizationError('Access denied');
        }

        next();
    };
};

export const requireActiveUser = (req, res, next) => {
    if (!req.user) {
        throw new AuthenticationError('User not authenticated');
    }

    if (req.user.status !== 'active') {
        throw new AuthorizationError('Account is not active');
    }

    next();
};

export const rateLimitByUser = (limiter) => {
    return (req, res, next) => {
        // Use user ID if authenticated, otherwise use IP
        const key = req.user ? req.user.id : req.ip;
        return limiter(key)(req, res, next);
    };
};
