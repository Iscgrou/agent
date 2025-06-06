import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

const config = {
    // Server configuration
    server: {
        port: process.env.PORT || 3000,
        env: process.env.NODE_ENV || 'development',
        corsOrigin: process.env.CORS_ORIGIN || '*',
        rateLimitWindow: 15 * 60 * 1000, // 15 minutes
        rateLimitMax: 100 // requests per window
    },

    // Database configuration
    database: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        name: process.env.DB_NAME || 'aiagent_db',
        user: process.env.DB_USER || 'aiagent',
        password: process.env.DB_PASSWORD,
        ssl: process.env.DB_SSL === 'true',
        maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20'),
        idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000')
    },

    // Redis configuration
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0')
    },

    // JWT configuration
    jwt: {
        secret: process.env.JWT_SECRET || 'your-secret-key',
        expiresIn: process.env.JWT_EXPIRES_IN || '24h',
        refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
    },

    // AI Service configuration
    ai: {
        model: process.env.AI_MODEL || 'gpt-4',
        apiKey: process.env.AI_API_KEY,
        maxTokens: parseInt(process.env.AI_MAX_TOKENS || '4000'),
        temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7')
    },

    // File storage configuration
    storage: {
        type: process.env.STORAGE_TYPE || 'local',
        basePath: process.env.STORAGE_PATH || path.join(process.cwd(), 'uploads'),
        maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880') // 5MB
    },

    // Logging configuration
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        format: process.env.LOG_FORMAT || 'json'
    },

    // Security configuration
    security: {
        bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12'),
        sessionTimeout: parseInt(process.env.SESSION_TIMEOUT || '3600000'), // 1 hour
        maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5'),
        lockoutDuration: parseInt(process.env.LOCKOUT_DURATION || '900000') // 15 minutes
    },

    // Monitoring configuration
    monitoring: {
        enabled: process.env.MONITORING_ENABLED === 'true',
        interval: parseInt(process.env.MONITORING_INTERVAL || '60000') // 1 minute
    },

    // Validation function to ensure all required environment variables are set
    validate() {
        const required = [
            'DB_PASSWORD',
            'JWT_SECRET',
            'AI_API_KEY'
        ];

        const missing = required.filter(key => !process.env[key]);
        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }

        return true;
    }
};

// Validate configuration
config.validate();

export default config;
