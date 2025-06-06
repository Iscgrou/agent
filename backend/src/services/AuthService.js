import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { AuthenticationError, ValidationError } from '../middleware/errorHandler.js';
import database from '../database/index.js';

class AuthService {
    constructor() {
        this.tokenBlacklist = new Set();
    }

    generateTokens(user) {
        const accessToken = jwt.sign(
            {
                userId: user.id,
                email: user.email,
                role: user.role
            },
            config.jwt.secret,
            { expiresIn: config.jwt.expiresIn }
        );

        const refreshToken = jwt.sign(
            {
                userId: user.id,
                tokenVersion: crypto.randomBytes(8).toString('hex')
            },
            config.jwt.secret,
            { expiresIn: config.jwt.refreshExpiresIn }
        );

        return { accessToken, refreshToken };
    }

    async login(email, password) {
        // Find user
        const user = await User.findByEmail(email);
        if (!user) {
            throw new AuthenticationError('Invalid email or password');
        }

        // Check if account is locked
        if (await user.isLocked()) {
            throw new AuthenticationError('Account is temporarily locked. Please try again later.');
        }

        // Verify password
        const isValid = await user.verifyPassword(password);
        await user.updateLoginAttempts(isValid);

        if (!isValid) {
            throw new AuthenticationError('Invalid email or password');
        }

        // Check user status
        if (user.status !== 'active') {
            throw new AuthenticationError('Account is not active');
        }

        // Generate tokens
        const tokens = this.generateTokens(user);

        // Log successful login
        logger.info('User logged in successfully', { userId: user.id });

        return {
            user: user.toJSON(),
            ...tokens
        };
    }

    async refreshToken(refreshToken) {
        try {
            // Verify refresh token
            const decoded = jwt.verify(refreshToken, config.jwt.secret);

            // Check if token is blacklisted
            if (this.tokenBlacklist.has(refreshToken)) {
                throw new AuthenticationError('Token has been revoked');
            }

            // Find user
            const user = await User.findById(decoded.userId);
            if (!user || user.status !== 'active') {
                throw new AuthenticationError('User not found or inactive');
            }

            // Generate new tokens
            const tokens = this.generateTokens(user);

            // Blacklist old refresh token
            this.tokenBlacklist.add(refreshToken);

            return {
                user: user.toJSON(),
                ...tokens
            };
        } catch (error) {
            if (error instanceof jwt.JsonWebTokenError) {
                throw new AuthenticationError('Invalid refresh token');
            }
            throw error;
        }
    }

    async register(userData) {
        const { email, password, fullName } = userData;

        // Additional password validation
        if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
            throw new ValidationError(
                'Password must contain at least one uppercase letter, one lowercase letter, and one number'
            );
        }

        // Create user
        const user = await User.create({
            email,
            password,
            fullName
        });

        // Generate tokens
        const tokens = this.generateTokens(user);

        // Log registration
        logger.info('New user registered', { userId: user.id });

        return {
            user: user.toJSON(),
            ...tokens
        };
    }

    async logout(refreshToken) {
        if (refreshToken) {
            this.tokenBlacklist.add(refreshToken);
        }
    }

    async validateToken(token) {
        try {
            // Verify token
            const decoded = jwt.verify(token, config.jwt.secret);

            // Check if token is blacklisted
            if (this.tokenBlacklist.has(token)) {
                throw new AuthenticationError('Token has been revoked');
            }

            // Find and validate user
            const user = await User.findById(decoded.userId);
            if (!user || user.status !== 'active') {
                throw new AuthenticationError('User not found or inactive');
            }

            return {
                user: user.toJSON(),
                tokenData: decoded
            };
        } catch (error) {
            if (error instanceof jwt.JsonWebTokenError) {
                throw new AuthenticationError('Invalid token');
            }
            throw error;
        }
    }

    async changePassword(userId, currentPassword, newPassword) {
        const user = await User.findById(userId);
        if (!user) {
            throw new AuthenticationError('User not found');
        }

        await user.changePassword(currentPassword, newPassword);

        // Invalidate all existing tokens for this user
        // In a production environment, you might want to store tokens in Redis
        // and implement more sophisticated token invalidation
        this.tokenBlacklist.add(userId);
    }

    // Cleanup expired blacklisted tokens periodically
    startTokenCleanup() {
        setInterval(() => {
            for (const token of this.tokenBlacklist) {
                try {
                    jwt.verify(token, config.jwt.secret);
                } catch (error) {
                    if (error instanceof jwt.TokenExpiredError) {
                        this.tokenBlacklist.delete(token);
                    }
                }
            }
        }, 3600000); // Clean up every hour
    }
}

// Create and export a singleton instance
const authService = new AuthService();
authService.startTokenCleanup();

export default authService;
