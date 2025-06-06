// src/server/api-server.js
// Main entry point for the API and WebSocket server.

import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { ConfigurationManager } from '../core/configuration-manager.js'; // Assuming path
import SystemManager from '../core/system-manager.js'; // Assuming path

// Import route handlers and WebSocket handlers (to be created)
import projectRoutes from './routes/project-routes.js';
import systemRoutes from './routes/system-routes.js';
import initializeWebSocket from './websocket-handler.js';

// --- Configuration ---
// Initialize ConfigurationManager first to get server settings
const configManager = new ConfigurationManager({
    defaultConfigPath: './config/default.config.json',
    envSpecificConfigPath: './config/config.{NODE_ENV}.json',
});
const PORT = configManager.get('server.port', 8080);
const API_BASE_PATH = configManager.get('server.apiBasePath', '/api');

// --- SystemManager Initialization ---
// initialConfig for SystemManager should ideally come from configManager too.
// For now, this is a simplified setup.
const systemManagerInitialConfig = {
    configurationManager: { /* pass necessary paths or sub-configs */
        defaultConfigPath: configManager.get('systemManager.config.default', './config/default.config.json'),
        envSpecificConfigPath: configManager.get('systemManager.config.env_specific', './config/config.{NODE_ENV}.json'),
    },
    // Pass specific config sections to SystemManager's constructor if needed
    persistence: configManager.get('persistence'),
    sandbox: configManager.get('sandbox'),
    vertexAI: configManager.get('vertexAI'),
    learningSystem: configManager.get('learningSystem')
};
const systemManager = new SystemManager(systemManagerInitialConfig);

async function startServer() {
    try {
        await systemManager.initialize(); // Initialize SystemManager and its components
        systemManager.start(); // Start the operational loop

        const app = express();
        app.use(express.json()); // Middleware to parse JSON bodies

        // --- Health Check for the API server itself ---
        app.get(`${API_BASE_PATH}/health`, (req, res) => {
            res.status(200).json({ status: 'API Server Healthy', systemManagerStatus: systemManager.state.systemHealth });
        });

        // --- Mount Routes ---
        // Pass systemManager to routes so they can interact with it
        app.use(`${API_BASE_PATH}/projects`, projectRoutes(systemManager, configManager));
        app.use(`${API_BASE_PATH}/system`, systemRoutes(systemManager, configManager));

        // --- Global Error Handler for Express ---
        app.use((err, req, res, next) => {
            console.error("[API Server Error]", err);
            const statusCode = err.statusCode || 500;
            res.status(statusCode).json({
                error: {
                    code: err.code || 'INTERNAL_SERVER_ERROR',
                    message: err.message || 'An unexpected error occurred on the server.',
                    details: err.details || (process.env.NODE_ENV === 'development' ? err.stack : undefined)
                }
            });
        });

        const server = http.createServer(app);

        // --- WebSocket Server Setup ---
        const wss = new WebSocketServer({ server });
        const notificationService = initializeWebSocket(wss, systemManager, configManager);

        // Make notificationService available to SystemManager (e.g., by direct injection or an event bus)
        // For simplicity, we might pass it or register it if SystemManager supports a plugin/service model
        // This part requires SystemManager to have a way to emit events that notificationService can pick up.
        systemManager.setNotificationService(notificationService); // Assuming SystemManager has such a method

        server.listen(PORT, () => {
            console.log(`[APIServer] HTTP and WebSocket server running on http://localhost:${PORT}`);
            console.log(`[APIServer] API available at http://localhost:${PORT}${API_BASE_PATH}`);
        });

    } catch (error) {
        console.error("[APIServer] Failed to start server or initialize SystemManager:", error);
        process.exit(1); // Exit if critical components fail to initialize
    }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[APIServer] SIGTERM signal received: closing HTTP server');
    if (systemManager) await systemManager.stop();
    // server.close(() => { // server might not be defined if startServer failed
    //     console.log('[APIServer] HTTP server closed');
    // });
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[APIServer] SIGINT signal received: closing HTTP server');
    if (systemManager) await systemManager.stop();
    // server.close(() => {
    //     console.log('[APIServer] HTTP server closed');
    // });
    process.exit(0);
});
