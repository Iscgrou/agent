// src/core/sandbox-manager.js
// Manages isolated Docker-based environments for secure code execution,
// file operations, and command running.
// Security and isolation are paramount in this module.

import Docker from 'dockerode'; // Standard Docker SDK for Node.js
import fs from 'fs-extra'; // For file system operations, provides more than native fs
import path from 'path';
import { PassThrough } from 'stream'; // For capturing stdout/stderr

// --- Custom Error Classes for Sandbox Operations ---
class SandboxError extends Error {
    constructor(message, code, context = {}, originalError = null) {
        super(message);
        this.name = this.constructor.name; // More specific error names are better
        this.code = code; // e.g., 'CONTAINER_CREATE_FAILED', 'COMMAND_TIMEOUT'
        this.context = context;
        this.originalError = originalError;
        this.timestamp = new Date().toISOString();
    }
}

class ContainerCreationError extends SandboxError { constructor(m,c,o) { super(m, 'CONTAINER_CREATE_FAILED',c,o); this.name = 'ContainerCreationError';} }
class CommandExecutionError extends SandboxError { constructor(m,c,o) { super(m, 'COMMAND_EXECUTION_ERROR',c,o); this.name = 'CommandExecutionError';} }
class CommandTimeoutError extends SandboxError { constructor(m,c,o) { super(m, 'COMMAND_TIMEOUT_ERROR',c,o); this.name = 'CommandTimeoutError';} }
class FileSystemError extends SandboxError { constructor(m,c,o) { super(m, 'FILESYSTEM_ERROR',c,o); this.name = 'FileSystemError';} }
class SecurityViolationError extends SandboxError { constructor(m,c,o) { super(m, 'SECURITY_VIOLATION_ERROR',c,o); this.name = 'SecurityViolationError';} }


// --- SandboxManager Implementation ---

class SandboxManager {
    /**
     * @param {object} config
     * @param {string} config.socketPath - Path to Docker socket (e.g., '/var/run/docker.sock') or Docker Host options
     * @param {string} config.baseImage - Default base Docker image (e.g., 'ubuntu:latest', 'node:18-alpine')
     * @param {string} config.tempHostDir - Host directory for temporary sandbox files and mounts
     * @param {object} [config.defaultResourceLimits] - Default limits for containers
     * @param {number} [config.defaultResourceLimits.cpus] - e.g., 0.5 (half a CPU)
     * @param {string} [config.defaultResourceLimits.memory] - e.g., '512m'
     * @param {string} [config.defaultNetworkMode] - e.g., 'none', 'bridge'
     * @param {string} [config.containerUser] - User to run commands as inside container (e.g., 'sandboxuser')
     */
    constructor(config = {}) {
        this.validateConfig(config);

        this.docker = new Docker({ socketPath: config.socketPath || '/var/run/docker.sock' });
        this.baseImage = config.baseImage || 'ubuntu:latest'; // A minimal, secure base is recommended
        this.tempHostDir = path.resolve(config.tempHostDir || './sandbox_temp');
        this.defaultResourceLimits = {
            Cpus: config.defaultResourceLimits?.cpus || 0.5, // Docker SDK uses 'Cpus' (fractional)
            Memory: this.parseMemoryLimit(config.defaultResourceLimits?.memory || '256m'), // In bytes
            // PidsLimit: config.defaultResourceLimits?.pidsLimit || 100, // Example
        };
        this.defaultNetworkMode = config.defaultNetworkMode || 'none'; // 'none' is most secure
        this.containerUser = config.containerUser || 'sandbox_user'; // Ensure this user exists in the base image or is created

        this.activeContainers = new Map(); // Map<containerId, containerObject>
        fs.ensureDirSync(this.tempHostDir); // Create temp dir if it doesn't exist
        console.log(`[Sandbox] Initialized. Temp host directory: ${this.tempHostDir}`);
    }

    validateConfig(config) {
        if (!config.tempHostDir) {
            console.warn("[Sandbox] tempHostDir not provided, defaulting to './sandbox_temp'. Ensure this path is secure and writable.");
        }
        // Add more validation as needed
    }

    parseMemoryLimit(memoryStr) {
        if (typeof memoryStr === 'number') return memoryStr;
        const unit = memoryStr.slice(-1).toLowerCase();
        const value = parseInt(memoryStr.slice(0, -1), 10);
        if (isNaN(value)) throw new SandboxError("Invalid memory limit format", "CONFIG_ERROR", { memoryStr });
        switch (unit) {
            case 'g': return value * 1024 * 1024 * 1024;
            case 'm': return value * 1024 * 1024;
            case 'k': return value * 1024;
            default: return parseInt(memoryStr, 10); // Assume bytes if no unit
        }
    }

    /**
     * Creates and starts a new sandboxed container.
     * @param {string} [imageId] - Specific Docker image to use, defaults to this.baseImage
     * @param {object} [options] - Container creation options
     * @param {Array<string>} [options.volumeMounts] - e.g., ["/host/path:/container/path:ro"]
     * @param {object} [options.resourceLimits] - Override default resource limits
     * @param {string} [options.networkMode] - Override default network mode
     * @param {Array<string>} [options.envVars] - e.g., ["NODE_ENV=development"]
     * @returns {Promise<string>} - The ID of the created and started container.
     */
    async createAndStartContainer(imageId = this.baseImage, options = {}) {
        const containerName = `sandbox-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const hostConfig = {
            Binds: options.volumeMounts || [],
            NetworkMode: options.networkMode || this.defaultNetworkMode,
            Resources: {
                ...this.defaultResourceLimits,
                ...(options.resourceLimits ? {
                    Cpus: options.resourceLimits.cpus || this.defaultResourceLimits.Cpus,
                    Memory: this.parseMemoryLimit(options.resourceLimits.memory || this.defaultResourceLimits.Memory)
                } : {}),
            },
            ReadonlyRootfs: options.readonlyRootfs === undefined ? true : options.readonlyRootfs, // Secure default
             // SecurityOpt: ['no-new-privileges', `seccomp=${path.resolve('./default-seccomp.json')}`] // Example
        };

        // Ensure image exists locally or pull it
        try {
            await this.docker.getImage(imageId).inspect();
        } catch (err) {
            if (err.statusCode === 404) {
                console.log(`[Sandbox] Image ${imageId} not found locally. Pulling...`);
                const stream = await this.docker.pull(imageId, {});
                await new Promise((resolve, reject) => {
                    this.docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
                });
                console.log(`[Sandbox] Image ${imageId} pulled successfully.`);
            } else {
                throw new ContainerCreationError(`Failed to inspect image ${imageId}`, { imageId }, err);
            }
        }
        
        console.log(`[Sandbox] Creating container ${containerName} from image ${imageId} with user ${this.containerUser}`);
        try {
            const container = await this.docker.createContainer({
                Image: imageId,
                name: containerName,
                User: this.containerUser, // Critical for security
                Tty: false, // Usually false for non-interactive command execution
                OpenStdin: false,
                StdinOnce: false,
                AttachStdin: false,
                AttachStdout: true,
                AttachStderr: true,
                Env: options.envVars || [],
                HostConfig: hostConfig,
                WorkingDir: options.workingDir || '/sandbox_project', // Ensure this exists or is created by mounts
                StopTimeout: options.stopTimeoutSeconds || 10,
            });

            await container.start();
            this.activeContainers.set(container.id, container);
            console.log(`[Sandbox] Container ${container.id} (${containerName}) started.`);
            return container.id;
        } catch (err) {
            throw new ContainerCreationError(`Failed to create or start container ${containerName}`, { imageId, hostConfig }, err);
        }
    }

    /**
     * Executes a command inside a specified container.
     * @param {string} containerId - The ID of the container.
     * @param {string | Array<string>} command - The command to execute (string or array of command and args).
     * @param {object} [options] - Execution options.
     * @param {number} [options.timeoutMs] - Command execution timeout in milliseconds.
     * @param {string} [options.workingDir] - Override container's working directory for this command.
     * @param {Array<string>} [options.envVars] - Environment variables for this specific command.
     * @returns {Promise<{output: string, errorOutput: string, exitCode: number}>}
     */
    async executeCommand(containerId, command, options = {}) {
        const container = this.activeContainers.get(containerId);
        if (!container) {
            throw new CommandExecutionError(`Container ${containerId} not found or not active.`, { containerId });
        }

        const cmdArray = Array.isArray(command) ? command : command.split(' ');
        console.log(`[Sandbox] Executing in ${containerId}: ${cmdArray.join(' ')}`);

        let exec;
        try {
            exec = await container.exec({
                Cmd: cmdArray,
                AttachStdout: true,
                AttachStderr: true,
                User: this.containerUser, // Re-affirm user if possible/necessary
                WorkingDir: options.workingDir,
                Env: options.envVars,
            });
        } catch (err) {
            throw new CommandExecutionError(`Failed to create exec instance in ${containerId}`, { containerId, command }, err);
        }

        const stream = await exec.start({ hijack: true, stdin: false });

        let output = '';
        let errorOutput = '';
        const outputStream = new PassThrough();
        const errorStream = new PassThrough();

        // Demultiplex the stream from Docker
        this.docker.modem.demuxStream(stream, outputStream, errorStream);

        outputStream.on('data', chunk => output += chunk.toString('utf8'));
        errorStream.on('data', chunk => errorOutput += chunk.toString('utf8'));

        const timeoutPromise = new Promise((_, reject) => {
            if (options.timeoutMs && options.timeoutMs > 0) {
                setTimeout(() => {
                    // Attempt to stop the exec instance if possible (Docker API for exec stop is tricky)
                    // For now, we rely on the container possibly being stopped or the exec just timing out on our side.
                    console.warn(`[Sandbox] Command in ${containerId} timed out after ${options.timeoutMs}ms.`);
                    reject(new CommandTimeoutError(`Command timed out after ${options.timeoutMs}ms`, { containerId, command }));
                }, options.timeoutMs);
            }
        });
        
        const executionPromise = new Promise((resolve, reject) => {
            stream.on('end', async () => {
                try {
                    const inspectData = await exec.inspect();
                    console.log(`[Sandbox] Command in ${containerId} finished. Exit code: ${inspectData.ExitCode}`);
                    resolve({ output: output.trim(), errorOutput: errorOutput.trim(), exitCode: inspectData.ExitCode });
                } catch (err) {
                    reject(new CommandExecutionError(`Failed to inspect exec result in ${containerId}`, { containerId, command }, err));
                }
            });
            stream.on('error', err => {
                 reject(new CommandExecutionError(`Stream error during exec in ${containerId}`, {containerId, command}, err));
            });
        });

        try {
            return await Promise.race([executionPromise, timeoutPromise]);
        } catch (err) {
            // If timeoutPromise rejected, err is CommandTimeoutError.
            // If executionPromise rejected, it's some other CommandExecutionError.
            // Ensure the container is handled reasonably if a command fails catastrophically.
            // Depending on the error, consider stopping the container.
            throw err;
        }
    }


    /**
     * Copies files/directories from host to a path inside the container.
     * This is more robust if done via volume mounts during container creation.
     * For direct copy, Docker's putArchive can be used.
     * @param {string} containerId
     * @param {string} hostPath - Path on the host.
     * @param {string} containerPath - Path in the container.
     * @returns {Promise<void>}
     */
    async copyToContainer(containerId, hostPath, containerPath) {
        const container = this.activeContainers.get(containerId);
        if (!container) {
            throw new FileSystemError(`Container ${containerId} not found for copy.`, { containerId });
        }
        if (!await fs.pathExists(hostPath)) {
            throw new FileSystemError(`Host path does not exist: ${hostPath}`, { hostPath });
        }
        console.log(`[Sandbox] Copying from host:${hostPath} to ${containerId}:${containerPath}`);
        // Docker's putArchive is for TAR streams. Simpler for single files/dirs might be to mount.
        // For now, assume mounting is preferred, this is a placeholder for more complex scenarios.
        // If using putArchive, one would need to tar the hostPath first.
        // This is highly simplified as direct file copy is best done via mounts.
        // A more robust implementation would use `container.putArchive`.
        throw new SandboxError("Direct copyToContainer is complex; prefer volume mounts.", "NOT_IMPLEMENTED_ROBUSTLY");
    }

    /**
     * Copies files/directories from a path inside the container to the host.
     * @param {string} containerId
     * @param {string} containerPath - Path in the container.
     * @param {string} hostPath - Path on the host.
     * @returns {Promise<void>}
     */
    async copyFromContainer(containerId, containerPath, hostPath) {
        const container = this.activeContainers.get(containerId);
        if (!container) {
            throw new FileSystemError(`Container ${containerId} not found for copy.`, { containerId });
        }
        console.log(`[Sandbox] Copying from ${containerId}:${containerPath} to host:${hostPath}`);
        try {
            const stream = await container.getArchive({ path: containerPath });
            // Ensure hostPath directory exists
            const hostDir = path.dirname(hostPath);
            await fs.ensureDir(hostDir);

            // Pipe stream to a tar extractor. 'tar-fs' or 'tar-stream' could be used.
            // This is a simplified placeholder. A robust implementation needs a tar stream parser.
            // For example, using 'tar-fs':
            // const extractor = tar.extract(hostPath); // or to a specific directory if containerPath is a dir
            // stream.pipe(extractor);
            // await new Promise((resolve, reject) => {
            //     extractor.on('finish', resolve);
            //     extractor.on('error', reject);
            // });
            // For now, logging that the raw stream would be handled here:
            console.warn("[Sandbox] copyFromContainer received tar stream, robust extraction needed.");
            // A very naive approach for a single file (NOT FOR PRODUCTION):
            // const chunks = [];
            // for await (const chunk of stream) { chunks.push(chunk); }
            // await fs.writeFile(hostPath, Buffer.concat(chunks)); // This is wrong, it's a tar archive stream

            throw new SandboxError("Robust tar extraction for copyFromContainer is required.", "NOT_IMPLEMENTED_ROBUSTLY");

        } catch (err) {
            throw new FileSystemError(`Failed to copy from ${containerId}:${containerPath}`, { containerId, containerPath }, err);
        }
    }


    /**
     * Stops and removes a specific container.
     * @param {string} containerId
     * @param {object} [options]
     * @param {boolean} [options.force=false]
     * @param {boolean} [options.removeVolumes=false]
     * @returns {Promise<void>}
     */
    async cleanupContainer(containerId, options = {}) {
        const container = this.activeContainers.get(containerId);
        if (!container) {
            console.warn(`[Sandbox] Container ${containerId} not found for cleanup or already cleaned.`);
            return;
        }
        console.log(`[Sandbox] Cleaning up container ${containerId}...`);
        try {
            try {
                // Check if container is running before trying to stop
                const inspectData = await container.inspect();
                if (inspectData.State.Running) {
                    await container.stop({ t: options.stopTimeoutSeconds || 10 });
                     console.log(`[Sandbox] Container ${containerId} stopped.`);
                }
            } catch (err) {
                 // If inspect fails (e.g. container already removed) or stop fails, proceed to remove
                console.warn(`[Sandbox] Error stopping container ${containerId} (may already be stopped/removed): ${err.message}`);
            }
            await container.remove({ force: options.force || false, v: options.removeVolumes || false });
            this.activeContainers.delete(containerId);
            console.log(`[Sandbox] Container ${containerId} removed.`);
        } catch (err) {
            // If removal fails, it might be an operational issue or the container is already gone.
            // Log it but don't necessarily throw if the intent is just to ensure it's gone.
            console.error(`[Sandbox] Failed to remove container ${containerId}: ${err.message}. It might require manual cleanup or was already removed.`);
             this.activeContainers.delete(containerId); // Still remove from active list
            // Consider re-throwing if strict cleanup is required:
            // throw new SandboxError(`Failed to fully cleanup container ${containerId}`, { containerId }, err);
        }
    }

    /**
     * Cleans up all active containers managed by this instance.
     * @returns {Promise<void>}
     */
    async cleanupAllContainers() {
        console.log(`[Sandbox] Cleaning up all ${this.activeContainers.size} active containers...`);
        const cleanupPromises = [];
        for (const containerId of this.activeContainers.keys()) {
            cleanupPromises.push(this.cleanupContainer(containerId, { force: true })); // Force cleanup on shutdown
        }
        await Promise.allSettled(cleanupPromises); // Use allSettled to ensure all attempts are made
        this.activeContainers.clear();
        console.log("[Sandbox] All active containers processed for cleanup.");
    }


    // --- Utility for creating a unique temporary directory on the host for a sandbox session ---
    /**
     * Creates a unique temporary directory on the host for a sandbox session.
     * This directory can be mounted into the container.
     * @param {string} [prefix='session-']
     * @returns {Promise<string>} Path to the created temporary directory.
     */
    async createSessionHostDir(prefix = 'session-') {
        const sessionDirName = `${prefix}${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const sessionDirPath = path.join(this.tempHostDir, sessionDirName);
        try {
            await fs.ensureDir(sessionDirPath);
            console.log(`[Sandbox] Created session host directory: ${sessionDirPath}`);
            return sessionDirPath;
        } catch (err) {
            throw new FileSystemError(`Failed to create session host directory: ${sessionDirPath}`, {}, err);
        }
    }

    /**
     * Removes a session host directory.
     * @param {string} sessionDirPath
     * @returns {Promise<void>}
     */
    async cleanupSessionHostDir(sessionDirPath) {
        // Basic safety check to prevent accidental deletion outside tempHostDir
        if (!sessionDirPath || !sessionDirPath.startsWith(path.resolve(this.tempHostDir))) {
            throw new SecurityViolationError(
                `Attempt to cleanup directory outside designated temp scope: ${sessionDirPath}`,
                { sessionDirPath, tempHostDir: this.tempHostDir }
            );
        }
        try {
            if (await fs.pathExists(sessionDirPath)) {
                await fs.remove(sessionDirPath);
                console.log(`[Sandbox] Cleaned up session host directory: ${sessionDirPath}`);
            }
        } catch (err) {
            throw new FileSystemError(`Failed to cleanup session host directory: ${sessionDirPath}`, {}, err);
        }
    }


    /**
     * Prepares project files on the host for mounting into a container.
     * @param {string} sessionHostDir - The unique host directory for this session.
     * @param {object} projectFiles - e.g., { "src/main.js": "content", "data/input.txt": "content" }
     * @returns {Promise<Array<string>>} Array of Docker volume mount strings (e.g., "/path/to/host/src/main.js:/sandbox_project/src/main.js:ro")
     */
    async prepareProjectFilesForMount(sessionHostDir, projectFiles) {
        const mountStrings = [];
        const projectRootInHost = path.join(sessionHostDir, 'project_src');
        await fs.ensureDir(projectRootInHost);

        for (const relativeFilePath in projectFiles) {
            if (Object.hasOwnProperty.call(projectFiles, relativeFilePath)) {
                const fileContent = projectFiles[relativeFilePath];
                // Ensure paths are not attempting to escape the sessionHostDir (basic check)
                const hostFilePath = path.resolve(projectRootInHost, relativeFilePath);
                if (!hostFilePath.startsWith(projectRootInHost)) {
                    throw new SecurityViolationError(`Invalid relative file path: ${relativeFilePath}`, { relativeFilePath });
                }
                
                await fs.ensureDir(path.dirname(hostFilePath));
                await fs.writeFile(hostFilePath, fileContent);

                // Mount point inside the container, e.g., /sandbox_project/src/main.js
                // Using path.posix.join for consistent container paths
                const containerFilePath = path.posix.join('/sandbox_project', relativeFilePath);
                mountStrings.push(`${hostFilePath}:${containerFilePath}:ro`); // Default to read-only
            }
        }
        return mountStrings;
    }
}

export {
    SandboxManager,
    SandboxError,
    ContainerCreationError,
    CommandExecutionError,
    CommandTimeoutError,
    FileSystemError,
    SecurityViolationError
};
