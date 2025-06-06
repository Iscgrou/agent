// src/core/project-persistence.js
// Manages saving, loading, and querying project states.
// Initial implementation focuses on file system storage with JSON serialization.

import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid'; // For checkpoint IDs or unique temporary file names

import { PlatformError } from './error-utils.js';

// --- Custom Error Classes for Project Persistence ---
class PersistenceError extends PlatformError {
    constructor(message, code = 'PERSISTENCE_GENERIC', context = {}, originalError = null, severity = 'CRITICAL') {
        super(message, code, context, originalError, severity);
        this.timestamp = new Date().toISOString();
    }
}

class ProjectNotFoundError extends PersistenceError {
    constructor(message, context = {}, originalError = null) {
        super(message, 'PROJECT_NOT_FOUND', context, originalError, 'RECOVERABLE_WITH_MODIFICATION');
    }
}

class StorageAccessError extends PersistenceError {
    constructor(message, context = {}, originalError = null) {
        super(message, 'STORAGE_ACCESS_ERROR', context, originalError, 'CRITICAL');
    }
}

class SerializationError extends PersistenceError {
    constructor(message, context = {}, originalError = null) {
        super(message, 'SERIALIZATION_ERROR', context, originalError, 'RECOVERABLE_WITH_MODIFICATION');
    }
}

class ConcurrencyIOError extends PersistenceError {
    constructor(message, context = {}, originalError = null) {
        super(message, 'CONCURRENCY_IO_ERROR', context, originalError, 'RETRYABLE_TRANSIENT');
    }
}

/**
 * @typedef {object} ProjectState
 * @property {{projectName: string, created: Date, lastModified: Date, version: string, status: 'active' | 'completed' | 'failed'}} metadata
 * @property {{files: { [path: string]: string }, ast?: { [path: string]: object }, dependencies: string[]}} context
 * @property {{currentPlan: string | null, completedTasks: string[], remainingTasks: string[], lastCheckpointId?: string}} execution
 * @property {{originalRequest: string, relevantHistory: Array<{role: 'user' | 'assistant', content: string, timestamp: Date}>}} conversation
 */

/**
 * @typedef {object} ProjectPersistenceConfig
 * @property {'filesystem'} storageType - Currently only 'filesystem' is supported.
 * @property {string} projectsBasePath - Root directory path for storing all projects.
 * @property {string} [serializationFormat='json'] - Currently only 'json' is supported.
 * @property {string} [projectFileSuffix='.project.json'] - Suffix for project data files.
 * @property {string} [lockFileSuffix='.lock'] - Suffix for lock files.
 */

class ProjectPersistence {
    /**
     * @param {ProjectPersistenceConfig} config
     */
    constructor(config) {
        if (!config || !config.projectsBasePath || config.storageType !== 'filesystem') {
            throw new PersistenceError(
                "Invalid configuration: 'projectsBasePath' and 'storageType: filesystem' are required.",
                "INVALID_CONFIG",
                { config }
            );
        }
        this.projectsBasePath = path.resolve(config.projectsBasePath);
        this.projectFileSuffix = config.projectFileSuffix || '.project.json';
        this.lockFileSuffix = config.lockFileSuffix || '.lock';

        try {
            fs.ensureDirSync(this.projectsBasePath);
            console.log(`[Persistence] Initialized. Projects base path: ${this.projectsBasePath}`);
        } catch (err) {
            throw new StorageAccessError(
                `Failed to ensure projects base directory: ${this.projectsBasePath}`,
                { path: this.projectsBasePath },
                err
            );
        }
    }

    _getProjectPath(projectName) {
        // Basic sanitization to prevent path traversal with project name.
        // A more robust sanitization might involve checking for '..', '/', '\', etc.
        // or using a library specifically for sanitizing file/directory names.
        const sanitizedProjectName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
        if (!sanitizedProjectName) {
            throw new PersistenceError("Invalid project name provided.", "INVALID_PROJECT_NAME", { projectName });
        }
        return path.join(this.projectsBasePath, `${sanitizedProjectName}${this.projectFileSuffix}`);
    }

    _getLockFilePath(projectName) {
        const sanitizedProjectName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
        return path.join(this.projectsBasePath, `${sanitizedProjectName}${this.lockFileSuffix}`);
    }

    // Basic file-based lock mechanism (not suitable for highly concurrent distributed environments)
    async _acquireLock(projectName, timeout = 5000) {
        const lockFile = this._getLockFilePath(projectName);
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            try {
                // Attempt to create the lock file exclusively
                await fs.open(lockFile, 'wx'); // 'wx' fails if file exists
                console.log(`[Persistence] Lock acquired for project: ${projectName}`);
                return true;
            } catch (error) {
                if (error.code === 'EEXIST') {
                    // Lock file exists, wait and retry
                    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100)); // Small random delay
                } else {
                    throw new ConcurrencyIOError(`Failed to acquire lock for ${projectName} due to unexpected error.`, { projectName }, error);
                }
            }
        }
        throw new ConcurrencyIOError(`Timeout acquiring lock for project: ${projectName} after ${timeout}ms.`, { projectName });
    }

    async _releaseLock(projectName) {
        const lockFile = this._getLockFilePath(projectName);
        try {
            if (await fs.pathExists(lockFile)) {
                await fs.remove(lockFile);
                console.log(`[Persistence] Lock released for project: ${projectName}`);
            }
        } catch (error) {
            // Log error but don't necessarily throw, as main operation might have succeeded.
            // Stale locks are an issue, but failing to release shouldn't block everything if not critical path.
            console.error(`[Persistence] Failed to release lock for ${projectName}: ${error.message}`);
            // throw new ConcurrencyIOError(`Failed to release lock for ${projectName}`, { projectName }, error);
        }
    }

    /**
     * Saves project data. Uses a write-then-rename pattern for atomicity.
     * @param {string} projectName
     * @param {ProjectState} projectData
     * @returns {Promise<void>}
     */
    async saveProject(projectName, projectData) {
        if (!projectName || typeof projectName !== 'string') {
            throw new PersistenceError("Project name must be a non-empty string.", "INVALID_ARGUMENT", { projectName });
        }
        if (!projectData || typeof projectData !== 'object') {
            throw new PersistenceError("Project data must be an object.", "INVALID_ARGUMENT", { projectData });
        }

        const projectPath = this._getProjectPath(projectName);
        const tempProjectPath = `${projectPath}.${uuidv4()}.tmp`;

        console.log(`[Persistence] Attempting to save project: ${projectName} to ${projectPath}`);
        await this._acquireLock(projectName);

        try {
            projectData.metadata = {
                ...projectData.metadata,
                projectName: projectName, // Ensure it's set or updated
                lastModified: new Date(),
                version: projectData.metadata?.version || '1.0.0' // Basic versioning
            };
            if(!projectData.metadata.created) projectData.metadata.created = new Date();

            const serializedData = JSON.stringify(projectData, null, 2); // Pretty print JSON
            await fs.writeFile(tempProjectPath, serializedData, 'utf8');
            await fs.rename(tempProjectPath, projectPath); // Atomic rename
            console.log(`[Persistence] Project ${projectName} saved successfully.`);
        } catch (err) {
            // Attempt to clean up temp file if rename failed
            if (await fs.pathExists(tempProjectPath)) {
                await fs.remove(tempProjectPath).catch(cleanupErr =>
                    console.error(`[Persistence] Failed to cleanup temp file ${tempProjectPath}: ${cleanupErr.message}`)
                );
            }
            if (err instanceof TypeError && err.message.includes("circular structure")) {
                throw new SerializationError(`Circular reference detected in project data for ${projectName}.`, { projectName }, err);
            }
            throw new StorageAccessError(`Failed to save project ${projectName}.`, { projectPath }, err);
        } finally {
            await this._releaseLock(projectName);
        }
    }

    /**
     * Loads project data.
     * @param {string} projectName
     * @returns {Promise<ProjectState | null>}
     */
    async loadProject(projectName) {
        const projectPath = this._getProjectPath(projectName);
        console.log(`[Persistence] Attempting to load project: ${projectName} from ${projectPath}`);

        if (!await fs.pathExists(projectPath)) {
            console.warn(`[Persistence] Project file not found for ${projectName} at ${projectPath}.`);
            return null; // Or throw ProjectNotFoundError based on desired strictness
        }
        // No lock needed for read usually, but if consistency with writes is critical, a read lock could be used.
        // For simplicity, assuming reads are okay without explicit lock if writes are atomic.
        try {
            const fileContent = await fs.readFile(projectPath, 'utf8');
            const projectData = JSON.parse(fileContent, (key, value) => {
                // Reviver for Date objects
                if (key === 'created' || key === 'lastModified' || (key === 'timestamp' && typeof value === 'string' && /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value))) {
                    const date = new Date(value);
                    return isNaN(date.getTime()) ? value : date; // Return original if invalid date
                }
                return value;
            });
            console.log(`[Persistence] Project ${projectName} loaded successfully.`);
            return projectData;
        } catch (err) {
            if (err instanceof SyntaxError) {
                 throw new SerializationError(`Failed to parse project data for ${projectName}. File might be corrupted.`, { projectPath }, err);
            }
            throw new StorageAccessError(`Failed to load project ${projectName}.`, { projectPath }, err);
        }
    }

    /**
     * Deletes a project's data.
     * @param {string} projectName
     * @returns {Promise<void>}
     */
    async deleteProject(projectName) {
        const projectPath = this._getProjectPath(projectName);
        console.log(`[Persistence] Attempting to delete project: ${projectName} from ${projectPath}`);
        await this._acquireLock(projectName); // Lock to prevent race conditions with save/load
        try {
            if (await fs.pathExists(projectPath)) {
                await fs.remove(projectPath);
                console.log(`[Persistence] Project ${projectName} deleted successfully.`);
            } else {
                console.warn(`[Persistence] Project file not found for deletion: ${projectName}`);
                // Optionally throw ProjectNotFoundError if strict behavior is needed
            }
        } catch (err) {
            throw new StorageAccessError(`Failed to delete project ${projectName}.`, { projectPath }, err);
        } finally {
            await this._releaseLock(projectName); // Release lock even if project didn't exist
        }
    }

    /**
     * Lists all saved project names.
     * @returns {Promise<string[]>}
     */
    async listProjects() {
        console.log(`[Persistence] Listing all projects in ${this.projectsBasePath}`);
        try {
            const files = await fs.readdir(this.projectsBasePath);
            return files
                .filter(file => file.endsWith(this.projectFileSuffix))
                .map(file => file.replace(this.projectFileSuffix, '').replace(/_/g, ' ')); // Basic de-sanitization
        } catch (err) {
            throw new StorageAccessError(`Failed to list projects in ${this.projectsBasePath}.`, {}, err);
        }
    }

    /**
     * Checks if a project exists.
     * @param {string} projectName
     * @returns {Promise<boolean>}
     */
    async projectExists(projectName) {
        const projectPath = this._getProjectPath(projectName);
        return fs.pathExists(projectPath);
    }

    // --- Checkpoint Management (Basic - could be expanded) ---
    // Checkpoints would be specialized versions of ProjectState or diffs, stored separately.
    // For simplicity now, a checkpoint could just be a timestamped full save under a different name.

    /**
     * Creates a checkpoint (a named snapshot) of a project.
     * For this basic implementation, it's a full copy with a checkpoint ID in the name.
     * @param {string} projectName
     * @param {string} [checkpointId] - Optional ID, otherwise generated.
     * @returns {Promise<string>} - The checkpoint ID.
     */
    async createCheckpoint(projectName, checkpointId = uuidv4()) {
        const projectData = await this.loadProject(projectName);
        if (!projectData) {
            throw new ProjectNotFoundError(`Project ${projectName} not found to create checkpoint.`, { projectName });
        }
        
        const checkpointProjectName = `${projectName}_checkpoint_${checkpointId}`;
        // Modify metadata for checkpoint
        projectData.metadata.originalProjectName = projectName;
        projectData.metadata.checkpointId = checkpointId;
        projectData.metadata.status = 'checkpoint'; // Mark as a checkpoint
        
        console.log(`[Persistence] Creating checkpoint ${checkpointId} for project: ${projectName}`);
        await this.saveProject(checkpointProjectName, projectData); // Saves with the new name

        // Update original project's execution state to point to this checkpoint
        const originalProjectData = await this.loadProject(projectName); // Reload, could have changed
        if(originalProjectData){
             originalProjectData.execution.lastCheckpointId = checkpointId;
             await this.saveProject(projectName, originalProjectData);
        }
        return checkpointId;
    }

    /**
     * Restores a project from a checkpoint.
     * This means copying the checkpoint data over the main project data.
     * @param {string} projectName
     * @param {string} checkpointId
     * @returns {Promise<void>}
     */
    async restoreFromCheckpoint(projectName, checkpointId) {
        const checkpointProjectName = `${projectName}_checkpoint_${checkpointId}`;
        const checkpointData = await this.loadProject(checkpointProjectName);

        if (!checkpointData) {
            throw new PersistenceError(`Checkpoint ${checkpointId} for project ${projectName} not found.`, "CHECKPOINT_NOT_FOUND", { projectName, checkpointId });
        }
        
        console.log(`[Persistence] Restoring project ${projectName} from checkpoint ${checkpointId}`);
        // Remove original project name details from checkpoint metadata before restoring.
        const dataToRestore = { ...checkpointData };
        delete dataToRestore.metadata.originalProjectName;
        delete dataToRestore.metadata.checkpointId;
        dataToRestore.metadata.status = 'active'; // Or original status if stored
        dataToRestore.execution.lastCheckpointId = checkpointId; // Keep track of what was restored

        await this.saveProject(projectName, dataToRestore);
        console.log(`[Persistence] Project ${projectName} restored successfully from checkpoint ${checkpointId}.`);
    }

    /**
     * Lists checkpoint IDs for a project.
     * @param {string} projectName
     * @returns {Promise<string[]>}
     */
    async listCheckpoints(projectName) {
        const sanitizedBase = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const checkpointPrefix = `${sanitizedBase}_checkpoint_`;
        try {
            const files = await fs.readdir(this.projectsBasePath);
            return files
                .filter(file => file.startsWith(checkpointPrefix) && file.endsWith(this.projectFileSuffix))
                .map(file => file.substring(checkpointPrefix.length, file.length - this.projectFileSuffix.length));
        } catch (err) {
            throw new StorageAccessError(`Failed to list checkpoints for project ${projectName}.`, {projectName}, err);
        }
    }

    // --- Utility Methods for Project Metadata/Status (as per checklist) ---
    // These might require loading the project and just returning/updating parts of it.
    // Proper atomic updates would require careful implementation for a database backend.
    // For file system, it means load, modify, save.

    /**
     * Gets project metadata.
     * @param {string} projectName
     * @returns {Promise<object | null>} Project metadata or null if project not found.
     */
    async getProjectMetadata(projectName) {
        const projectData = await this.loadProject(projectName);
        return projectData ? projectData.metadata : null;
    }

    /**
     * Updates the status of a project.
     * @param {string} projectName
     * @param {'active' | 'completed' | 'failed'} status
     * @returns {Promise<void>}
     */
    async updateProjectStatus(projectName, status) {
        console.log(`[Persistence] Updating status of project ${projectName} to ${status}`);
        await this._acquireLock(projectName);
        try {
            const projectData = await this.loadProject(projectName); // Load within lock
            if (!projectData) {
                throw new ProjectNotFoundError(`Project ${projectName} not found to update status.`, { projectName});
            }
            projectData.metadata.status = status;
            projectData.metadata.lastModified = new Date();
            // Re-save the entire project data. For more granular updates, a database would be better.
            await this.saveProject(projectName, projectData); // saveProject handles its own lock internally, but outer lock ensures load-modify-save atomicity
            console.log(`[Persistence] Status for project ${projectName} updated successfully.`);
        } finally {
            await this._releaseLock(projectName);
        }
    }

} // End of ProjectPersistence class

export {
    ProjectPersistence,
    PersistenceError,
    ProjectNotFoundError,
    StorageAccessError,
    SerializationError,
    ConcurrencyIOError
};
