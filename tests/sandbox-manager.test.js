import { jest } from '@jest/globals';
import Docker from 'dockerode';
import fs from 'fs-extra';
import path from 'path';
import {
    SandboxManager,
    SandboxError,
    ContainerCreationError,
    CommandExecutionError,
    CommandTimeoutError,
    FileSystemError,
    SecurityViolationError
} from '../src/core/sandbox-manager.js';

// Mock Docker and fs-extra
jest.mock('dockerode');
jest.mock('fs-extra', () => ({
    ensureDirSync: jest.fn(),
    pathExists: jest.fn(),
    ensureDir: jest.fn(),
    remove: jest.fn(),
    writeFile: jest.fn()
}));

describe('SandboxManager', () => {
    let sandboxManager;
    const mockConfig = {
        socketPath: '/var/run/docker.sock',
        baseImage: 'node:18-alpine',
        tempHostDir: '/tmp/sandbox',
        defaultResourceLimits: {
            cpus: 0.5,
            memory: '256m'
        }
    };

    beforeEach(() => {
        // Clear all mocks before each test
        jest.clearAllMocks();
        
        // Setup fs-extra mocks
        fs.ensureDirSync.mockImplementation(() => {});
        fs.pathExists.mockResolvedValue(true);
        fs.ensureDir.mockResolvedValue();
        fs.remove.mockResolvedValue();
        fs.writeFile.mockResolvedValue();

        // Setup Docker mocks
        const mockContainer = {
            id: 'mock-container-id',
            start: jest.fn().mockResolvedValue({}),
            stop: jest.fn().mockResolvedValue({}),
            remove: jest.fn().mockResolvedValue({}),
            inspect: jest.fn().mockResolvedValue({ State: { Running: true } }),
            exec: jest.fn().mockResolvedValue({
                start: jest.fn().mockResolvedValue({
                    on: jest.fn(),
                    modem: { demuxStream: jest.fn() }
                }),
                inspect: jest.fn().mockResolvedValue({ ExitCode: 0 })
            })
        };

        Docker.mockImplementation(() => ({
            createContainer: jest.fn().mockResolvedValue(mockContainer),
            getImage: jest.fn().mockReturnValue({
                inspect: jest.fn().mockResolvedValue({}),
            }),
            pull: jest.fn().mockResolvedValue({}),
            modem: {
                followProgress: jest.fn((stream, onFinished) => onFinished(null, []))
            }
        }));

        sandboxManager = new SandboxManager(mockConfig);
    });

    describe('Constructor and Configuration', () => {
        test('should initialize with default configuration', () => {
            const defaultManager = new SandboxManager();
            expect(defaultManager.baseImage).toBe('ubuntu:latest');
            expect(defaultManager.defaultNetworkMode).toBe('none');
            expect(defaultManager.containerUser).toBe('sandbox_user');
        });

        test('should initialize with custom configuration', () => {
            expect(sandboxManager.baseImage).toBe('node:18-alpine');
            expect(sandboxManager.tempHostDir).toBe('/tmp/sandbox');
            expect(sandboxManager.defaultResourceLimits.Cpus).toBe(0.5);
        });

        test('should validate memory limit format', () => {
            expect(() => sandboxManager.parseMemoryLimit('invalid')).toThrow(SandboxError);
            expect(sandboxManager.parseMemoryLimit('512m')).toBe(512 * 1024 * 1024);
            expect(sandboxManager.parseMemoryLimit('1g')).toBe(1024 * 1024 * 1024);
        });
    });

    describe('Container Management', () => {
        test('should create and start container successfully', async () => {
            const containerId = await sandboxManager.createAndStartContainer();
            expect(containerId).toBe('mock-container-id');
            expect(Docker.mock.instances[0].createContainer).toHaveBeenCalled();
        });

        test('should handle container creation failure', async () => {
            Docker.mock.instances[0].createContainer.mockRejectedValue(new Error('Creation failed'));
            await expect(sandboxManager.createAndStartContainer()).rejects.toThrow(ContainerCreationError);
        });

        test('should cleanup container successfully', async () => {
            const containerId = await sandboxManager.createAndStartContainer();
            await sandboxManager.cleanupContainer(containerId);
            expect(sandboxManager.activeContainers.size).toBe(0);
        });

        test('should handle container cleanup when container is not found', async () => {
            await expect(sandboxManager.cleanupContainer('non-existent-id')).resolves.not.toThrow();
        });
    });

    describe('Command Execution', () => {
        let containerId;

        beforeEach(async () => {
            containerId = await sandboxManager.createAndStartContainer();
        });

        test('should execute command successfully', async () => {
            const result = await sandboxManager.executeCommand(containerId, 'echo "test"');
            expect(result.exitCode).toBe(0);
        });

        test('should handle command execution timeout', async () => {
            const mockExec = {
                start: jest.fn().mockImplementation(() => {
                    return new Promise(resolve => setTimeout(resolve, 1000));
                })
            };
            Docker.mock.instances[0].createContainer.mockResolvedValue({
                ...Docker.mock.instances[0].createContainer(),
                exec: jest.fn().mockResolvedValue(mockExec)
            });

            await expect(
                sandboxManager.executeCommand(containerId, 'sleep 10', { timeoutMs: 100 })
            ).rejects.toThrow(CommandTimeoutError);
        });

        test('should handle non-existent container', async () => {
            await expect(
                sandboxManager.executeCommand('non-existent-id', 'echo "test"')
            ).rejects.toThrow(CommandExecutionError);
        });
    });

    describe('File System Operations', () => {
        test('should create session directory successfully', async () => {
            const sessionDir = await sandboxManager.createSessionHostDir('test-');
            expect(sessionDir).toContain('test-');
            expect(fs.ensureDir).toHaveBeenCalled();
        });

        test('should handle session directory creation failure', async () => {
            fs.ensureDir.mockRejectedValue(new Error('Creation failed'));
            await expect(sandboxManager.createSessionHostDir()).rejects.toThrow(FileSystemError);
        });

        test('should prevent cleanup outside temp directory', async () => {
            await expect(
                sandboxManager.cleanupSessionHostDir('/etc/sensitive')
            ).rejects.toThrow(SecurityViolationError);
        });

        test('should prepare project files for mounting', async () => {
            const sessionDir = await sandboxManager.createSessionHostDir();
            const projectFiles = {
                'src/main.js': 'console.log("test");',
                'package.json': '{"name": "test"}'
            };

            const mountStrings = await sandboxManager.prepareProjectFilesForMount(sessionDir, projectFiles);
            expect(mountStrings).toHaveLength(2);
            expect(mountStrings[0]).toContain(':ro'); // Should be read-only
            expect(fs.writeFile).toHaveBeenCalledTimes(2);
        });

        test('should prevent path traversal in project files', async () => {
            const sessionDir = await sandboxManager.createSessionHostDir();
            const projectFiles = {
                '../../../etc/passwd': 'malicious content'
            };

            await expect(
                sandboxManager.prepareProjectFilesForMount(sessionDir, projectFiles)
            ).rejects.toThrow(SecurityViolationError);
        });
    });

    describe('Cleanup Operations', () => {
        test('should cleanup all containers', async () => {
            await sandboxManager.createAndStartContainer();
            await sandboxManager.createAndStartContainer();
            expect(sandboxManager.activeContainers.size).toBe(2);

            await sandboxManager.cleanupAllContainers();
            expect(sandboxManager.activeContainers.size).toBe(0);
        });

        test('should handle cleanup failures gracefully', async () => {
            const containerId = await sandboxManager.createAndStartContainer();
            const mockContainer = sandboxManager.activeContainers.get(containerId);
            mockContainer.remove.mockRejectedValue(new Error('Removal failed'));

            await expect(sandboxManager.cleanupContainer(containerId)).resolves.not.toThrow();
            expect(sandboxManager.activeContainers.size).toBe(0);
        });
    });
});
