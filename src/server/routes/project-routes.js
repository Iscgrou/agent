// src/server/routes/project-routes.js
import express from 'express';

// Helper for async route handlers
const asyncHandler = fn => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export default function projectRoutes(systemManager, configManager) {
    const router = express.Router();

    // POST /api/projects - Submit New Project
    router.post('/', asyncHandler(async (req, res) => {
        const { userInput, projectName, options } = req.body;

        if (!userInput || !projectName) {
            return res.status(400).json({
                error: { code: 'BAD_REQUEST', message: 'userInput and projectName are required.' }
            });
        }

        // TODO: Add input validation schema here (e.g., using Zod from your dependencies)

        const submissionResult = systemManager.submitNewRequest(userInput, projectName, options);

        if (submissionResult.success) {
            // The actual project ID might be the projectName itself or generated later.
            // For now, assume projectName is the key identifier used by SystemManager.
            res.status(202).json({ // 202 Accepted: request is accepted for processing
                projectId: projectName, // Using projectName as ID for now
                projectName: projectName,
                status: 'submitted',
                timestamp: new Date().toISOString(),
                message: submissionResult.message
            });
        } else {
            // SystemManager.submitNewRequest might return specific error codes/messages
            res.status(503).json({ // Service Unavailable or other relevant code
                error: {
                    code: submissionResult.code || 'SUBMISSION_FAILED',
                    message: submissionResult.message || 'Failed to submit project request.'
                }
            });
        }
    }));

    // GET /api/projects/{projectName}/status - Get Project Status
    router.get('/:projectName/status', asyncHandler(async (req, res) => {
        const { projectName } = req.params;
        const projectState = systemManager.activeProjects.get(projectName); // Accessing activeProjects directly for simplicity

        if (!projectState) {
            // Attempt to load from persistence if not in active memory (optional, depends on strategy)
            // const persistedState = await systemManager.projectPersistence.loadProject(projectName);
            // if(!persistedState) {
            return res.status(404).json({
                error: { code: 'PROJECT_NOT_FOUND', message: `Project '${projectName}' not found.` }
            });
            // }
            // projectState = persistedState;
        }
        
        // Construct status response based on projectState
        // This is a simplified version; more details from checklist needed
        const statusResponse = {
            projectName: projectState.metadata.projectName,
            status: projectState.metadata.status,
            currentPhase: {
                name: projectState.execution?.currentPlanTitle || (projectState.metadata.status === 'analysis_complete' ? 'Planning Complete' : 'Analysis'),
                progress: 0, // Placeholder - need logic to calculate this
                currentTask: projectState.execution?.currentSubtaskId ? {
                    id: projectState.execution.currentSubtaskId,
                    title: projectState.execution.subtasksFull?.find(t => t.id === projectState.execution.currentSubtaskId)?.title || 'Unknown Task',
                    status: 'in_progress' // Placeholder
                } : null
            },
            recentLogs: [ /* TODO: Implement log retrieval if SystemManager/components log to a central place */ ],
            error: projectState.execution?.lastError ? {
                code: projectState.execution.lastError.code || 'UNKNOWN_ERROR',
                message: projectState.execution.lastError.message,
                // recoveryAttempts: projectState.execution.lastError.recoveryAttempted // TODO: Add this to error state
            } : null
        };
        res.status(200).json(statusResponse);
    }));

    // GET /api/projects/{projectName}/results - Get Project Results
    // TODO: Implement by AI Assistant based on checklist schema
    router.get('/:projectName/results', asyncHandler(async (req, res) => {
        const { projectName } = req.params;
        const projectState = systemManager.activeProjects.get(projectName);

        if (!projectState || (projectState.metadata.status !== 'completed_successfully' && projectState.metadata.status !== 'failed' && !projectState.metadata.status.startsWith('failed_'))) {
             // Also check persistence if not active but completed/failed
            const persisted = await systemManager.projectPersistence.loadProject(projectName);
            if (persisted && (persisted.metadata.status === 'completed_successfully' || persisted.metadata.status === 'failed' || persisted.metadata.status.startsWith('failed_'))){
                 // Use persisted data to construct response
                 console.log(`[API] Serving results for ${projectName} from persistence.`);
                 // ... (construct response using 'persisted' object according to schema)
                 return res.status(200).json({
                    projectName: persisted.metadata.projectName,
                    status: persisted.metadata.status,
                    artifacts: Object.entries(persisted.context?.files || {}).map(([p,c]) => ({path:p, type: 'file', content: c.substring(0, 200) + (c.length > 200 ? '...' : ''), size: c.length })), // Simplified
                    executionSummary: { /* ... extract from persisted.execution ... */},
                    logs: { path: 'project_logs.txt', downloadUrl: `/api/projects/${projectName}/logs/download`} // Placeholder
                 });
            }

            return res.status(404).json({
                error: { code: 'RESULTS_NOT_READY_OR_NOT_FOUND', message: `Results for project '${projectName}' are not yet available or project not found.` }
            });
        }
        // Construct response from projectState according to checklist schema
        const resultsResponse = {
            projectName: projectState.metadata.projectName,
            status: projectState.metadata.status,
            artifacts: Object.entries(projectState.context?.files || {}).map(([p,c]) => ({path:p, type: 'file', content: c.substring(0, 200) + (c.length > 200 ? '...' : ''), size:c.length })), // Simplified artifact representation
            executionSummary: { /* ... extract from projectState.execution ... */},
            logs: { path: 'project_logs.txt', downloadUrl: `/api/projects/${projectName}/logs/download`} // Placeholder
        };
        res.status(200).json(resultsResponse);
    }));

    // GET /api/projects - List Projects
    // TODO: Implement by AI Assistant based on checklist schema (with pagination and filtering)
    router.get('/', asyncHandler(async (req, res) => {
        const projectNames = await systemManager.projectPersistence.listProjects();
        const projects = [];
        for (const name of projectNames) {
            const meta = await systemManager.projectPersistence.getProjectMetadata(name.replace(/ /g, '_')); // Assuming listProjects desanitizes
            if (meta) {
                projects.push({
                    projectName: meta.projectName,
                    status: meta.status,
                    createdAt: meta.created,
                    lastUpdated: meta.lastModified,
                    type: meta.projectType || "Unknown" // Assuming projectType in metadata from understanding
                });
            }
        }
        res.status(200).json({
            projects,
            pagination: { total: projects.length, limit: projects.length, offset: 0 } // Basic pagination
        });
    }));

    return router;
}
