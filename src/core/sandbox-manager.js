// src/core/sandbox-manager.js
// Manages isolated Docker-based environments for secure code execution,
// file operations, and command running.
// Security and isolation are paramount in this module.

import Docker from 'dockerode'; // Standard Docker SDK for Node.js
import fs from 'fs-extra'; // For file system operations, provides more than native fs
import path from 'path';
import { PassThrough } from 'stream'; // For capturing stdout/stderr

import { PlatformError } from './error-utils.js';

// --- Custom Error Classes for Sandbox Operations ---
class SandboxError extends PlatformError {
    constructor(message, code = 'SANDBOX_GENERIC', context = {}, originalError = null, severity = 'CRITICAL') {
        super(message, code, context, originalError, severity);
        this.timestamp = new Date().toISOString();
    }
}

class ContainerCreationError extends SandboxError {
    constructor(message, context = {}, originalError = null) {
        super(message, 'CONTAINER_CREATE_FAILED', context, originalError, 'CRITICAL');
    }
}

class CommandExecutionError extends SandboxError {
    constructor(message, context = {}, originalError = null) {
        super(message, 'COMMAND_EXECUTION_ERROR', context, originalError, 'RECOVERABLE_WITH_MODIFICATION');
    }
}

class CommandTimeoutError extends SandboxError {
    constructor(message, context = {}, originalError = null) {
        super(message, 'COMMAND_TIMEOUT_ERROR', context, originalError, 'RECOVERABLE_WITH_MODIFICATION');
    }
}

class FileSystemError extends SandboxError {
    constructor(message, context = {}, originalError = null) {
        super(message, 'FILESYSTEM_ERROR', context, originalError, 'CRITICAL');
    }
}

class SecurityViolationError extends SandboxError {
    constructor(message, context = {}, originalError = null) {
        super(message, 'SECURITY_VIOLATION_ERROR', context, originalError, 'FATAL');
    }
}

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
                User: this.containerUser,
                Tty: false,
                OpenStdin: false,
                StdinOnce: false,
                AttachStdin: false,
                AttachStdout: true,
                AttachStderr: true,
                Env: options.envVars || [],
                HostConfig: hostConfig,
                WorkingDir: options.workingDir || '/sandbox_project',
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
                User: this.containerUser,
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

        this.docker.modem.demuxStream(stream, outputStream, errorStream);

        outputStream.on('data', chunk => output += chunk.toString('utf8'));
        errorStream.on('data', chunk => errorOutput += chunk.toString('utf8'));

        const timeoutPromise = new Promise((_, reject) => {
            if (options.timeoutMs && options.timeoutMs > 0) {
                setTimeout(() => {
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
            const hostDir = path.dirname(hostPath);
            await fs.ensureDir(hostDir);
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
                const inspectData = await container.inspect();
                if (inspectData.State.Running) {
                    await container.stop({ t: options.stopTimeoutSeconds || 10 });
                    console.log(`[Sandbox] Container ${containerId} stopped.`);
                }
            } catch (err) {
                console.warn(`[Sandbox] Error stopping container ${containerId} (may already be stopped/removed): ${err.message}`);
            }
            await container.remove({ force: options.force || false, v: options.removeVolumes || false });
            this.activeContainers.delete(containerId);
            console.log(`[Sandbox] Container ${containerId} removed.`);
        } catch (err) {
            console.error(`[Sandbox] Failed to remove container ${containerId}: ${err.message}. It might require manual cleanup or was already removed.`);
            this.activeContainers.delete(containerId);
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
            cleanupPromises.push(this.cleanupContainer(containerId, { force: true }));
        }
        await Promise.allSettled(cleanupPromises);
        this.activeContainers.clear();
        console.log("[Sandbox] All active containers processed for cleanup.");
    }

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
     * @returns {Promise<Array<string>>} Array of Docker volume mount strings
     */
    async prepareProjectFilesForMount(sessionHostDir, projectFiles) {
        const mountStrings = [];
        const projectRootInHost = path.join(sessionHostDir, 'project_src');
        await fs.ensureDir(projectRootInHost);

        for (const relativeFilePath in projectFiles) {
            if (Object.hasOwnProperty.call(projectFiles, relativeFilePath)) {
                const fileContent = projectFiles[relativeFilePath];
                const hostFilePath = path.resolve(projectRootInHost, relativeFilePath);
                if (!hostFilePath.startsWith(projectRootInHost)) {
                    throw new SecurityViolationError(`Invalid relative file path: ${relativeFilePath}`, { relativeFilePath });
                }
                
                await fs.ensureDir(path.dirname(hostFilePath));
                await fs.writeFile(hostFilePath, fileContent);

                const containerFilePath = path.posix.join('/sandbox_project', relativeFilePath);
                mountStrings.push(`${hostFilePath}:${containerFilePath}:ro`);
            }
        }
        return mountStrings;
    }

    /**
     * Clones a Git repository into a unique directory within a new or existing sandbox session.
     * All git operations are performed *inside* a container.
     * @param {string} repositoryUrl - The HTTPS URL of the repository.
     * @param {object} [options]
     * @param {string} [options.branch] - Specific branch to checkout after cloning.
     * @param {string} [options.commit] - Specific commit to checkout after cloning.
     * @param {string} [options.cloneDepth] - e.g., '1' for a shallow clone.
     * @param {string} [options.sessionHostDir] - Optional existing session host directory.
     * @param {string} [options.containerId] - Optional existing container ID to use.
     * @param {object} [options.auth] - Authentication options
     * @param {string} [options.auth.token] - Personal access token
     * @returns {Promise<{ sessionHostDir: string, repoHostPath: string, containerPath: string, containerId: string, newContainerCreated: boolean }>}
     */
    async cloneRepository(repositoryUrl, options = {}) {
        let { sessionHostDir, containerId, branch, commit, cloneDepth, auth } = options;
        const newContainerCreated = !containerId;
        const newSessionDirCreated = !sessionHostDir;

        if (!repositoryUrl || !repositoryUrl.startsWith('https://')) {
            throw new SecurityViolationError("Invalid or non-HTTPS repository URL provided.", { repositoryUrl });
        }

        console.log(`[Sandbox] Cloning repository: ${repositoryUrl}`);

        if (newSessionDirCreated) {
            sessionHostDir = await this.createSessionHostDir('repo-session-');
        }
        const repoName = path.basename(repositoryUrl, '.git');
        const repoHostPath = path.join(sessionHostDir, repoName);
        const repoContainerPath = path.posix.join('/sandbox_project/cloned_repo', repoName);

        await fs.ensureDir(repoHostPath);
        const volumeMounts = [`${repoHostPath}:${repoContainerPath}:rw`];

        if (newContainerCreated) {
            containerId = await this.createAndStartContainer('alpine/git', {
                volumeMounts,
                networkMode: 'bridge',
                envVars: auth?.token ? [`GIT_ASKPASS=true`, `GIT_USERNAME=x-access-token`, `GIT_PASSWORD=${auth.token}`] : []
            });
        } else {
            console.warn("[Sandbox] Reusing existing container for clone is complex and not fully supported.");
        }

        try {
            const gitCloneCommand = ['git', 'clone'];
            if (cloneDepth) gitCloneCommand.push('--depth', String(cloneDepth));
            if (branch && !commit) gitCloneCommand.push('--branch', branch);
            gitCloneCommand.push(repositoryUrl, '.');

            const cloneResult = await this.executeCommand(containerId, gitCloneCommand, {
                timeoutMs: 300000,
                workingDir: repoContainerPath
            });

            if (cloneResult.exitCode !== 0) {
                throw new CommandExecutionError(`Git clone failed for ${repositoryUrl}`, { exitCode: cloneResult.exitCode, errorOutput: cloneResult.errorOutput });
            }

            if (commit) {
                const checkoutResult = await this.executeCommand(containerId, ['git', 'checkout', commit], { workingDir: repoContainerPath });
                if (checkoutResult.exitCode !== 0) {
                    throw new CommandExecutionError(`Git checkout commit ${commit} failed`, { exitCode: checkoutResult.exitCode, errorOutput: checkoutResult.errorOutput });
                }
            }

            return {
                sessionHostDir,
                repoHostPath,
                repoContainerPath,
                containerId,
                newContainerCreated,
                newSessionDirCreated
            };
        } catch (error) {
            if (newContainerCreated && containerId) await this.cleanupContainer(containerId, { force: true });
            if (newSessionDirCreated && sessionHostDir) await this.cleanupSessionHostDir(sessionHostDir);
            throw error;
        }
    }

    /**
     * Lists files in a given path within a container (typically a cloned repository).
     * @param {string} containerId
     * @param {string} containerPath - Path inside the container.
     * @param {object} [options]
     * @param {boolean} [options.recursive=false]
     * @param {string} [options.pattern] - Glob pattern for filtering (e.g., '*.js')
     * @returns {Promise<Array<string>>} - List of file paths relative to containerPath.
     */
    async listRepositoryFiles(containerId, containerPath, options = {}) {
        console.log(`[Sandbox] Listing files in ${containerId}:${containerPath}`);
        let findCommand = ['find', '.'];
        if (!options.recursive) {
            findCommand.push('-maxdepth', '1');
        }
        findCommand.push('-type', 'f');
        if (options.pattern) {
            findCommand.push('-name', options.pattern);
        }
        findCommand.push('-printf', '%P\n');

        const result = await this.executeCommand(containerId, findCommand, { workingDir: containerPath });
        if (result.exitCode !== 0) {
            if (result.errorOutput.includes("No such file or directory")) {
                throw new FileSystemError(`Path not found in container: ${containerPath}`, { containerId, path: containerPath });
            }
            if (result.output === "") return [];
        }
        return result.output.split('\n').filter(Boolean);
    }

    /**
     * Reads the content of a file from a path inside a container.
     * @param {string} containerId
     * @param {string} containerFilePath - Full path to the file inside the container.
     * @returns {Promise<string>} - The content of the file.
     */
    async readRepositoryFile(containerId, containerFilePath) {
        console.log(`[Sandbox] Reading file ${containerId}:${containerFilePath}`);
        if (containerFilePath.includes('..') || !containerFilePath.startsWith('/sandbox_project/cloned_repo/')) {
            if (!containerFilePath.startsWith(path.posix.join('/sandbox_project', path.basename(containerFilePath))) && !containerFilePath.startsWith(path.posix.join('/tmp', path.basename(containerFilePath)))) {
                throw new SecurityViolationError("Attempt to read file outside allowed sandbox project path.", { path: containerFilePath });
            }
        }

        const result = await this.executeCommand(containerId, ['cat', containerFilePath]);
        if (result.exitCode !== 0) {
            throw new FileSystemError(`Failed to read file ${containerFilePath}`, { details: result.errorOutput });
        }
        return result.output;
    }

    /**
     * Installs NPM dependencies inside a container.
     * @param {string} containerId
     * @param {string} projectContainerPath - Path to the project root (containing package.json)
     * @param {object} [options]
     * @param {boolean} [options.production=false] - Install only production dependencies.
     * @param {number} [options.timeoutMs=600000] - Timeout for npm install (10 minutes).
     * @returns {Promise<{output: string, errorOutput: string, exitCode: number}>}
     */
    async installNpmDependencies(containerId, projectContainerPath, options = {}) {
        console.log(`[Sandbox] Installing NPM dependencies in ${containerId}:${projectContainerPath}`);
        const npmCommand = ['npm', 'install'];
        if (options.production) {
            npmCommand.push('--production');
        }

        const result = await this.executeCommand(containerId, npmCommand, {
            workingDir: projectContainerPath,
            timeoutMs: options.timeoutMs || 600000
        });

        if (result.exitCode !== 0) {
            console.error(`[Sandbox] NPM install failed in ${projectContainerPath}: ${result.errorOutput}`);
        }
        return result;
    }

    /**
     * Installs Python dependencies using pip inside a container.
     * @param {string} containerId
     * @param {string} projectContainerPath - Path to the project root
     * @param {object} [options]
     * @param {string} [options.requirementsFile='requirements.txt']
     * @param {boolean} [options.upgrade=false] - Add --upgrade flag.
     * @param {number} [options.timeoutMs=600000] - Timeout for pip install (10 minutes).
     * @returns {Promise<{output: string, errorOutput: string, exitCode: number}>}
     */
    async installPythonDependencies(containerId, projectContainerPath, options = {}) {
        console.log(`[Sandbox] Installing Python dependencies in ${containerId}:${projectContainerPath}`);
        const pipCommand = ['pip', 'install', '-r', options.requirementsFile || 'requirements.txt'];
        if (options.upgrade) {
            pipCommand.push('--upgrade');
        }

        const result = await this.executeCommand(containerId, pipCommand, {
            workingDir: projectContainerPath,
            timeoutMs: options.timeoutMs || 600000
        });

        if (result.exitCode !== 0) {
            console.error(`[Sandbox] Pip install failed in ${projectContainerPath}: ${result.errorOutput}`);
        }
        return result;
    }

    /**
     * Runs a linter on specified files/paths within the container.
     * @param {string} containerId
     * @param {string} projectContainerPath - Path to the project root.
     * @param {string|Array<string>} lintCommand - The full lint command
     * @param {object} [options]
     * @param {number} [options.timeoutMs=120000] - Timeout for linting (2 minutes).
     * @returns {Promise<{output: string, errorOutput: string, exitCode: number}>}
     */
    async runLinter(containerId, projectContainerPath, lintCommand, options = {}) {
        console.log(`[Sandbox] Running linter in ${containerId}:${projectContainerPath}`);
        const result = await this.executeCommand(containerId, lintCommand, {
            workingDir: projectContainerPath,
            timeoutMs: options.timeoutMs || 120000
        });

        console.log(`[Sandbox] Linter finished with exit code ${result.exitCode}`);
        return result;
    }

    /**
     * Runs tests within the container.
     * @param {string} containerId
     * @param {string} projectContainerPath - Path to the project root.
     * @param {string|Array<string>} testCommand - The full test command
     * @param {object} [options]
     * @param {number} [options.timeoutMs=600000] - Timeout for tests (10 minutes).
     * @param {Array<string>} [options.envVars] - Environment variables
     * @returns {Promise<{output: string, errorOutput: string, exitCode: number}>}
     */
    async runTests(containerId, projectContainerPath, testCommand, options = {}) {
        console.log(`[Sandbox] Running tests in ${containerId}:${projectContainerPath}`);
        const result = await this.executeCommand(containerId, testCommand, {
            workingDir: projectContainerPath,
            timeoutMs: options.timeoutMs || 600000,
            envVars: options.envVars
        });

        console.log(`[Sandbox] Tests finished with exit code ${result.exitCode}`);
        return result;
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
