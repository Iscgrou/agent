import { AuthenticationError } from './errorHandler.js';

export const validateAdmin = (req, res, next) => {
    try {
        // Check if user exists and has admin role
        if (!req.user || req.user.role !== 'admin') {
            throw new AuthenticationError('Admin access required');
        }

        next();
    } catch (error) {
        next(error);
    }
};
