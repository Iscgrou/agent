// tests/sandbox-manager.test.js

import { SandboxManager, SecurityViolationError, CommandExecutionError, FileSystemError } from '../src/core/sandbox-manager';
import Docker from 'dockerode';
import fs from 'fs-extra';
import path from 'path';

// Mock Docker and fs-extra
jest.mock('dockerode');
jest.mock('fs-extra');

describe('SandboxManager Advanced Features', () => {
    let sandboxManager;
    const mockContainerId = 'mock-container-123';
    const mockExec = {
        start: jest.fn(),
        inspect: jest.fn()
    };
    const mockContainer = {
        exec: jest.fn(() => mockExec),
        inspect: jest.fn(),
        stop: jest.fn(),
        remove: jest.fn(),
        getArchive: jest.fn()
    };
    const mockStream = {
        on: jest.fn((event, callback) => {
            if (event === 'end') {
                // Simulate async stream end
                setTimeout(callback, 0);
            }
            return mockStream;
        })
    };

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Setup Docker mock
        Docker.mockImplementation(() => ({
            createContainer: jest.fn().mockResolvedValue(mockContainer),
            getImage: jest.fn().mockReturnValue({
                inspect: jest.fn().mockResolvedValue({})
            }),
            modem: {
                followProgress: jest.fn((stream, callback) => callback(null, [])),
                demuxStream: jest.fn()
            }
        }));

        // Setup fs mock
        fs.ensureDir.mockResolvedValue(undefined);
        fs.pathExists.mockResolvedValue(true);
        fs.remove.mockResolvedValue(undefined);

        sandboxManager = new SandboxManager({
            tempHostDir: '/tmp/sandbox'
        });
        sandboxManager.activeContainers.set(mockContainerId, mockContainer);
    });

    describe('cloneRepository', () => {
        const validRepoUrl = 'https://github.com/user/repo.git';
        
        it('should successfully clone a repository', async () => {
            mockExec.start.mockResolvedValue(mockStream);
            mockExec.inspect.mockResolvedValue({ ExitCode: 0 });

            const result = await sandboxManager.cloneRepository(validRepoUrl);

            expect(result).toHaveProperty('sessionHostDir');
            expect(result).toHaveProperty('repoHostPath');
            expect(result).toHaveProperty('containerId');
            expect(mockContainer.exec).toHaveBeenCalledWith(expect.objectContaining({
                Cmd: ['git', 'clone', validRepoUrl, '.']
            }));
        });

        it('should reject non-HTTPS repository URLs', async () => {
            await expect(sandboxManager.cloneRepository('git@github.com:user/repo.git'))
                .rejects
                .toThrow(SecurityViolationError);
        });

        it('should handle clone failures', async () => {
            mockExec.start.mockResolvedValue(mockStream);
            mockExec.inspect.mockResolvedValue({ ExitCode: 128 });

            await expect(sandboxManager.cloneRepository(validRepoUrl))
                .rejects
                .toThrow(CommandExecutionError);
        });

        it('should support branch checkout', async () => {
            mockExec.start.mockResolvedValue(mockStream);
            mockExec.inspect.mockResolvedValue({ ExitCode: 0 });

            await sandboxManager.cloneRepository(validRepoUrl, { branch: 'develop' });

            expect(mockContainer.exec).toHaveBeenCalledWith(expect.objectContaining({
                Cmd: ['git', 'clone', '--branch', 'develop', validRepoUrl, '.']
            }));
        });
    });

    describe('listRepositoryFiles', () => {
        it('should list files in container path', async () => {
            const mockOutput = 'file1.js\nfile2.js\nfile3.js\n';
            mockExec.start.mockResolvedValue(mockStream);
            mockExec.inspect.mockResolvedValue({ ExitCode: 0 });

            // Mock the output stream
            const mockPassThrough = {
                on: jest.fn((event, handler) => {
                    if (event === 'data') {
                        handler(Buffer.from(mockOutput));
                    }
                })
            };
            Docker.prototype.modem.demuxStream.mockImplementation((stream, stdout) => {
                stdout.on('data', () => {});
            });

            const files = await sandboxManager.listRepositoryFiles(mockContainerId, '/project');
            expect(files).toEqual(['file1.js', 'file2.js', 'file3.js']);
            expect(mockContainer.exec).toHaveBeenCalledWith(expect.objectContaining({
                Cmd: expect.arrayContaining(['find', '.'])
            }));
        });

        it('should handle no files found', async () => {
            mockExec.start.mockResolvedValue(mockStream);
            mockExec.inspect.mockResolvedValue({ ExitCode: 0 });

            const files = await sandboxManager.listRepositoryFiles(mockContainerId, '/project');
            expect(files).toEqual([]);
        });

        it('should throw error for invalid path', async () => {
            mockExec.start.mockResolvedValue(mockStream);
            mockExec.inspect.mockResolvedValue({ ExitCode: 1 });

            // Mock error output indicating no such directory
            const mockErrorStream = {
                on: jest.fn((event, handler) => {
                    if (event === 'data') {
                        handler(Buffer.from('No such file or directory'));
                    }
                })
            };
            Docker.prototype.modem.demuxStream.mockImplementation((stream, stdout, stderr) => {
                stderr.on('data', () => {});
            });

            await expect(sandboxManager.listRepositoryFiles(mockContainerId, '/nonexistent'))
                .rejects
                .toThrow(FileSystemError);
        });
    });

    describe('readRepositoryFile', () => {
        it('should read file content', async () => {
            const mockContent = 'file content';
            mockExec.start.mockResolvedValue(mockStream);
            mockExec.inspect.mockResolvedValue({ ExitCode: 0 });

            // Mock the output stream
            const mockPassThrough = {
                on: jest.fn((event, handler) => {
                    if (event === 'data') {
                        handler(Buffer.from(mockContent));
                    }
                })
            };
            Docker.prototype.modem.demuxStream.mockImplementation((stream, stdout) => {
                stdout.on('data', () => {});
            });

            const content = await sandboxManager.readRepositoryFile(
                mockContainerId,
                '/sandbox_project/cloned_repo/file.txt'
            );
            expect(content).toBe(mockContent);
        });

        it('should prevent path traversal', async () => {
            await expect(sandboxManager.readRepositoryFile(
                mockContainerId,
                '/sandbox_project/cloned_repo/../../../etc/passwd'
            )).rejects.toThrow(SecurityViolationError);
        });

        it('should handle file not found', async () => {
            mockExec.start.mockResolvedValue(mockStream);
            mockExec.inspect.mockResolvedValue({ ExitCode: 1 });

            await expect(sandboxManager.readRepositoryFile(
                mockContainerId,
                '/sandbox_project/cloned_repo/nonexistent.txt'
            )).rejects.toThrow(FileSystemError);
        });
    });

    describe('installNpmDependencies', () => {
        it('should execute npm install successfully', async () => {
            mockExec.start.mockResolvedValue(mockStream);
            mockExec.inspect.mockResolvedValue({ ExitCode: 0 });

            const result = await sandboxManager.installNpmDependencies(
                mockContainerId,
                '/project'
            );

            expect(result.exitCode).toBe(0);
            expect(mockContainer.exec).toHaveBeenCalledWith(expect.objectContaining({
                Cmd: ['npm', 'install']
            }));
        });

        it('should support production install', async () => {
            mockExec.start.mockResolvedValue(mockStream);
            mockExec.inspect.mockResolvedValue({ ExitCode: 0 });

            await sandboxManager.installNpmDependencies(
                mockContainerId,
                '/project',
                { production: true }
            );

            expect(mockContainer.exec).toHaveBeenCalledWith(expect.objectContaining({
                Cmd: ['npm', 'install', '--production']
            }));
        });
    });

    describe('installPythonDependencies', () => {
        it('should execute pip install successfully', async () => {
            mockExec.start.mockResolvedValue(mockStream);
            mockExec.inspect.mockResolvedValue({ ExitCode: 0 });

            const result = await sandboxManager.installPythonDependencies(
                mockContainerId,
                '/project'
            );

            expect(result.exitCode).toBe(0);
            expect(mockContainer.exec).toHaveBeenCalledWith(expect.objectContaining({
                Cmd: ['pip', 'install', '-r', 'requirements.txt']
            }));
        });

        it('should support custom requirements file', async () => {
            mockExec.start.mockResolvedValue(mockStream);
            mockExec.inspect.mockResolvedValue({ ExitCode: 0 });

            await sandboxManager.installPythonDependencies(
                mockContainerId,
                '/project',
                { requirementsFile: 'dev-requirements.txt' }
            );

            expect(mockContainer.exec).toHaveBeenCalledWith(expect.objectContaining({
                Cmd: ['pip', 'install', '-r', 'dev-requirements.txt']
            }));
        });
    });

    describe('runLinter', () => {
        it('should execute linter command successfully', async () => {
            mockExec.start.mockResolvedValue(mockStream);
            mockExec.inspect.mockResolvedValue({ ExitCode: 0 });

            const result = await sandboxManager.runLinter(
                mockContainerId,
                '/project',
                ['eslint', '.']
            );

            expect(result.exitCode).toBe(0);
            expect(mockContainer.exec).toHaveBeenCalledWith(expect.objectContaining({
                Cmd: ['eslint', '.']
            }));
        });

        it('should handle linter errors', async () => {
            mockExec.start.mockResolvedValue(mockStream);
            mockExec.inspect.mockResolvedValue({ ExitCode: 1 });

            const result = await sandboxManager.runLinter(
                mockContainerId,
                '/project',
                ['eslint', '.']
            );

            expect(result.exitCode).toBe(1);
        });
    });

    describe('runTests', () => {
        it('should execute test command successfully', async () => {
            mockExec.start.mockResolvedValue(mockStream);
            mockExec.inspect.mockResolvedValue({ ExitCode: 0 });

            const result = await sandboxManager.runTests(
                mockContainerId,
                '/project',
                ['npm', 'test']
            );

            expect(result.exitCode).toBe(0);
            expect(mockContainer.exec).toHaveBeenCalledWith(expect.objectContaining({
                Cmd: ['npm', 'test']
            }));
        });

        it('should support environment variables', async () => {
            mockExec.start.mockResolvedValue(mockStream);
            mockExec.inspect.mockResolvedValue({ ExitCode: 0 });

            await sandboxManager.runTests(
                mockContainerId,
                '/project',
                ['npm', 'test'],
                { envVars: ['CI=true'] }
            );

            expect(mockContainer.exec).toHaveBeenCalledWith(expect.objectContaining({
                Env: ['CI=true']
            }));
        });

        it('should handle test failures', async () => {
            mockExec.start.mockResolvedValue(mockStream);
            mockExec.inspect.mockResolvedValue({ ExitCode: 1 });

            const result = await sandboxManager.runTests(
                mockContainerId,
                '/project',
                ['npm', 'test']
            );

            expect(result.exitCode).toBe(1);
        });
    });
});
