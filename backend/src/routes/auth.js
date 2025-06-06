import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import authService from '../services/AuthService.js';
import { asyncHandler, validateRequest } from '../middleware/errorHandler.js';
import { authenticate, rateLimitByUser } from '../middleware/auth.js';
import config from '../config/index.js';

const router = express.Router();

// Rate limiting configurations
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    message: 'Too many login attempts, please try again later'
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 attempts
    message: 'Too many registration attempts, please try again later'
});

// Validation schemas
const registerSchema = z.object({
    body: z.object({
        email: z.string().email('Invalid email format'),
        password: z.string()
            .min(8, 'Password must be at least 8 characters')
            .regex(/(?=.*[a-z])/, 'Password must contain at least one lowercase letter')
            .regex(/(?=.*[A-Z])/, 'Password must contain at least one uppercase letter')
            .regex(/(?=.*\d)/, 'Password must contain at least one number'),
        fullName: z.string().min(2, 'Full name must be at least 2 characters')
    })
});

const loginSchema = z.object({
    body: z.object({
        email: z.string().email('Invalid email format'),
        password: z.string().min(1, 'Password is required')
    })
});

const passwordChangeSchema = z.object({
    body: z.object({
        currentPassword: z.string().min(1, 'Current password is required'),
        newPassword: z.string()
            .min(8, 'Password must be at least 8 characters')
            .regex(/(?=.*[a-z])/, 'Password must contain at least one lowercase letter')
            .regex(/(?=.*[A-Z])/, 'Password must contain at least one uppercase letter')
            .regex(/(?=.*\d)/, 'Password must contain at least one number')
    })
});

// Routes
router.post('/register',
    registerLimiter,
    validateRequest(registerSchema),
    asyncHandler(async (req, res) => {
        const { email, password, fullName } = req.body;
        const result = await authService.register({ email, password, fullName });
        res.status(201).json(result);
    })
);

router.post('/login',
    loginLimiter,
    validateRequest(loginSchema),
    asyncHandler(async (req, res) => {
        const { email, password } = req.body;
        const result = await authService.login(email, password);
        res.json(result);
    })
);

router.post('/refresh-token',
    asyncHandler(async (req, res) => {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            res.status(400).json({ message: 'Refresh token is required' });
            return;
        }
        const result = await authService.refreshToken(refreshToken);
        res.json(result);
    })
);

router.post('/logout',
    authenticate,
    asyncHandler(async (req, res) => {
        const refreshToken = req.body.refreshToken;
        await authService.logout(refreshToken);
        res.json({ message: 'Logged out successfully' });
    })
);

router.post('/change-password',
    authenticate,
    validateRequest(passwordChangeSchema),
    asyncHandler(async (req, res) => {
        const { currentPassword, newPassword } = req.body;
        await authService.changePassword(req.user.id, currentPassword, newPassword);
        res.json({ message: 'Password changed successfully' });
    })
);

router.get('/me',
    authenticate,
    asyncHandler(async (req, res) => {
        res.json({ user: req.user });
    })
);

router.post('/verify-token',
    asyncHandler(async (req, res) => {
        const { token } = req.body;
        if (!token) {
            res.status(400).json({ message: 'Token is required' });
            return;
        }
        const result = await authService.validateToken(token);
        res.json(result);
    })
);

// Health check endpoint
router.get('/health',
    asyncHandler(async (req, res) => {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString()
        });
    })
);

export default router;
