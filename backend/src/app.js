import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server } from 'socket.io';
import morgan from 'morgan';
import crypto from 'crypto';

import config from './config/index.js';
import logger from './utils/logger.js';
import { setupErrorHandling, rateLimitHandler } from './middleware/errorHandler.js';
import database from './database/index.js';
import authRoutes from './routes/auth.js';
import settingsRoutes from './routes/settings.js';

class App {
    constructor() {
        this.app = express();
        this.server = createServer(this.app);
        this.io = new Server(this.server, {
            cors: {
                origin: config.server.corsOrigin,
                methods: ['GET', 'POST']
            }
        });

        this.setupMiddleware();
        this.setupWebSocket();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    setupMiddleware() {
        // Security middleware
        this.app.use(helmet());
        this.app.use(cors({
            origin: config.server.corsOrigin,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization']
        }));

        // Rate limiting
        const limiter = rateLimit({
            windowMs: config.server.rateLimitWindow,
            max: config.server.rateLimitMax,
            handler: rateLimitHandler
        });
        this.app.use(limiter);

        // Body parsing
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

        // Request logging
        if (config.server.env === 'development') {
            this.app.use(morgan('dev', { stream: logger.stream }));
        } else {
            this.app.use(morgan('combined', { stream: logger.stream }));
        }

        // Add request ID and logging context
        this.app.use((req, res, next) => {
            req.id = req.headers['x-request-id'] || crypto.randomUUID();
            res.setHeader('X-Request-ID', req.id);
            next();
        });
        this.app.use(logger.middleware);
    }

    setupWebSocket() {
        // WebSocket authentication middleware
        this.io.use((socket, next) => {
            const token = socket.handshake.auth.token;
            if (!token) {
                return next(new Error('Authentication error'));
            }
            // TODO: Implement token verification
            next();
        });

        // WebSocket connection handling
        this.io.on('connection', (socket) => {
            logger.info('Client connected', { socketId: socket.id });

            socket.on('disconnect', () => {
                logger.info('Client disconnected', { socketId: socket.id });
            });

            socket.on('error', (error) => {
                logger.error('Socket error', { error, socketId: socket.id });
            });
        });
    }

    setupRoutes() {
        const API_PREFIX = '/api/v1';

        // Health check endpoint
        this.app.get('/health', async (req, res) => {
            const dbHealth = await database.healthCheck();
            const redisHealth = true; // TODO: Implement Redis health check
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                version: '1.0.0',
                services: {
                    database: dbHealth ? 'up' : 'down',
                    redis: redisHealth ? 'up' : 'down',
                    websocket: this.io ? 'up' : 'down'
                }
            });
        });

        // Mount API routes
        this.app.use(`${API_PREFIX}/auth`, authRoutes);
        this.app.use(`${API_PREFIX}/settings`, settingsRoutes);

        // API documentation route
        this.app.get(`${API_PREFIX}/docs`, (req, res) => {
            res.json({
                version: '1.0.0',
                description: 'AI Agent Platform API',
                endpoints: {
                    auth: {
                        register: 'POST /auth/register',
                        login: 'POST /auth/login',
                        refreshToken: 'POST /auth/refresh-token',
                        logout: 'POST /auth/logout',
                        changePassword: 'POST /auth/change-password',
                        me: 'GET /auth/me',
                        verifyToken: 'POST /auth/verify-token'
                    },
                    settings: {
                        getSettings: 'GET /settings',
                        updateVertexAIKey: 'POST /settings/vertex-ai-key',
                        testVertexAIConnection: 'POST /settings/test-vertex-ai'
                    }
                }
            });
        });
    }

    setupErrorHandling() {
        setupErrorHandling(this.app);
    }

    async start() {
        try {
            await database.healthCheck();
            logger.info('Database connection established');

            const port = config.server.port;
            this.server.listen(port, () => {
                logger.info(`Server is running on port ${port}`);
            });

            const shutdown = async () => {
                logger.info('Shutting down server...');
                this.server.close(() => {
                    logger.info('HTTP server closed');
                });
                this.io.close(() => {
                    logger.info('WebSocket server closed');
                });
                await database.close();
                process.exit(0);
            };

            process.on('SIGTERM', shutdown);
            process.on('SIGINT', shutdown);

        } catch (error) {
            logger.error('Failed to start server', error);
            process.exit(1);
        }
    }
}

export default new App();
