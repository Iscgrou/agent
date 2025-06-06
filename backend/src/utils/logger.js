import winston from 'winston';
import config from '../config/index.js';

// Define custom log levels and colors
const customLevels = {
    levels: {
        error: 0,
        warn: 1,
        info: 2,
        http: 3,
        debug: 4,
    },
    colors: {
        error: 'red',
        warn: 'yellow',
        info: 'green',
        http: 'magenta',
        debug: 'white',
    },
};

// Create custom format
const customFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.metadata(),
    winston.format.format((info) => {
        info.level = info.level.toUpperCase();
        return info;
    })(),
    config.logging.format === 'json'
        ? winston.format.json()
        : winston.format.printf(({ timestamp, level, message, metadata, stack }) => {
              const meta = metadata && Object.keys(metadata).length ? JSON.stringify(metadata) : '';
              const stackTrace = stack ? `\n${stack}` : '';
              return `${timestamp} [${level}]: ${message} ${meta}${stackTrace}`;
          })
);

// Create the logger
const logger = winston.createLogger({
    levels: customLevels.levels,
    level: config.logging.level,
    format: customFormat,
    transports: [
        // Write all logs to console
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize({ all: true }),
                customFormat
            ),
        }),
        // Write all error logs to error.log
        new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        // Write all logs to combined.log
        new winston.transports.File({
            filename: 'logs/combined.log',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
    ],
    // Handle exceptions and rejections
    exceptionHandlers: [
        new winston.transports.File({ filename: 'logs/exceptions.log' }),
    ],
    rejectionHandlers: [
        new winston.transports.File({ filename: 'logs/rejections.log' }),
    ],
});

// Add colors to winston
winston.addColors(customLevels.colors);

// Create a stream object for Morgan middleware
logger.stream = {
    write: (message) => logger.http(message.trim()),
};

// Add request context middleware
logger.middleware = (req, res, next) => {
    req.logger = logger.child({
        requestId: req.id,
        method: req.method,
        path: req.path,
        ip: req.ip,
    });
    next();
};

// Development logging helper
if (config.server.env !== 'production') {
    logger.debug('Logging initialized at debug level');
}

export default logger;
