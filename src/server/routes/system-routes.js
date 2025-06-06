// src/server/routes/system-routes.js
import express from 'express';

const asyncHandler = fn => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export default function systemRoutes(systemManager, configManager) {
    const router = express.Router();

    // GET /api/system/health - Get System Health
    router.get('/health', asyncHandler(async (req, res) => {
        // This is a more comprehensive health check that should query SystemManager
        // about the status of its components (VertexAI, Sandbox, etc.)
        // SystemManager would need a method like `getSystemComponentHealth()`
        const healthStatus = {
            status: systemManager.state.systemHealth === 'READY' ? 'healthy' : (systemManager.state.systemHealth.startsWith('ERROR_') ? 'degraded' : 'unavailable'),
            components: [ // Placeholder - SystemManager should provide this data
                { name: "SystemManagerLoop", status: systemManager.state.isRunning ? "running" : "stopped" },
                { name: "Configuration", status: "loaded" },
                { name: "Persistence", status: systemManager.projectPersistence ? "available" : "unavailable" },
                { name: "Sandbox", status: systemManager.sandboxManager ? "available" : "unavailable" /* TODO: add real health check */ },
                { name: "VertexAI", status: systemManager.agentCoordinator?.chatModel ? "configured" : "unconfigured" /* TODO: add ping to AI */ },
            ],
            metrics: {
                activeProjects: systemManager.activeProjects.size,
                queuedRequests: systemManager.mainTaskQueue.size(),
                // resourceUtilization: await systemManager.getResourceUtilization() // Placeholder
            }
        };
        res.status(200).json(healthStatus);
    }));

    return router;
}
