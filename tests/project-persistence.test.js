// tests/project-persistence.test.js

import { jest } from '@jest/globals';
import path from 'path';
import {
    ProjectPersistence,
    PersistenceError,
    ProjectNotFoundError,
    StorageAccessError,
    SerializationError,
    ConcurrencyIOError
} from '../src/core/project-persistence.js';

// Mock fs-extra
jest.mock('fs-extra', () => ({
    ensureDirSync: jest.fn(),
    ensureDir: jest.fn(),
    writeFile: jest.fn(),
    readFile: jest.fn(),
    rename: jest.fn(),
    remove: jest.fn(),
    pathExists: jest.fn(),
    readdir: jest.fn(),
    open: jest.fn()
}));

// Mock uuid
jest.mock('uuid', () => ({
    v4: jest.fn(() => 'mock-uuid')
}));

// Import mocked modules
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';

describe('ProjectPersistence', () => {
    let persistence;
    const testConfig = {
        storageType: 'filesystem',
        projectsBasePath: '/test/projects'
    };

    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();
        // Setup default successful behaviors
        fs.ensureDirSync.mockImplementation(() => {});
        fs.pathExists.mockResolvedValue(false);
        fs.open.mockResolvedValue({});
        persistence = new ProjectPersistence(testConfig);
    });

    describe('constructor', () => {
        it('should initialize with valid config', () => {
            expect(persistence.projectsBasePath).toBe('/test/projects');
            expect(persistence.projectFileSuffix).toBe('.project.json');
            expect(fs.ensureDirSync).toHaveBeenCalledWith('/test/projects');
        });

        it('should throw error with invalid config', () => {
            expect(() => new ProjectPersistence({}))
                .toThrow(PersistenceError);
            expect(() => new ProjectPersistence({ projectsBasePath: '/test' }))
                .toThrow(PersistenceError);
        });

        it('should throw StorageAccessError if directory creation fails', () => {
            fs.ensureDirSync.mockImplementation(() => {
                throw new Error('Permission denied');
            });
            expect(() => new ProjectPersistence(testConfig))
                .toThrow(StorageAccessError);
        });
    });

    describe('saveProject', () => {
        const testProject = {
            metadata: {
                projectName: 'test-project',
                version: '1.0.0'
            },
            context: {
                files: {},
                dependencies: []
            },
            execution: {
                completedTasks: [],
                remainingTasks: []
            },
            conversation: {
                originalRequest: 'test request',
                relevantHistory: []
            }
        };

        beforeEach(() => {
            fs.writeFile.mockResolvedValue(undefined);
            fs.rename.mockResolvedValue(undefined);
            fs.pathExists.mockResolvedValue(false);
            fs.remove.mockResolvedValue(undefined);
        });

        it('should successfully save a project', async () => {
            await persistence.saveProject('test-project', testProject);
            
            expect(fs.writeFile).toHaveBeenCalledWith(
                expect.stringContaining('test-project'),
                expect.stringContaining('"projectName":"test-project"'),
                'utf8'
            );
            expect(fs.rename).toHaveBeenCalled();
        });

        it('should handle circular references', async () => {
            const circularProject = { ...testProject };
            circularProject.circular = circularProject;

            const stringifyMock = jest.spyOn(JSON, 'stringify');
            stringifyMock.mockImplementation(() => {
                throw new TypeError('Converting circular structure to JSON');
            });

            await expect(persistence.saveProject('test-project', circularProject))
                .rejects
                .toThrow(SerializationError);

            stringifyMock.mockRestore();
        });

        it('should clean up temp file if rename fails', async () => {
            fs.rename.mockRejectedValue(new Error('Rename failed'));
            fs.pathExists.mockResolvedValue(true);

            await expect(persistence.saveProject('test-project', testProject))
                .rejects
                .toThrow(StorageAccessError);

            expect(fs.remove).toHaveBeenCalled();
        });

        it('should throw error for invalid project name', async () => {
            await expect(persistence.saveProject('', testProject))
                .rejects
                .toThrow(PersistenceError);
        });
    });

    describe('loadProject', () => {
        const testProjectData = {
            metadata: {
                projectName: 'test-project',
                created: '2024-01-01T00:00:00.000Z',
                lastModified: '2024-01-02T00:00:00.000Z'
            }
        };

        beforeEach(() => {
            fs.readFile.mockResolvedValue(JSON.stringify(testProjectData));
        });

        it('should successfully load a project', async () => {
            fs.pathExists.mockResolvedValue(true);
            
            const project = await persistence.loadProject('test-project');
            
            expect(project).toBeDefined();
            expect(project.metadata.projectName).toBe('test-project');
            expect(project.metadata.created instanceof Date).toBe(true);
            expect(project.metadata.lastModified instanceof Date).toBe(true);
        });

        it('should return null for non-existent project', async () => {
            fs.pathExists.mockResolvedValue(false);
            
            const project = await persistence.loadProject('non-existent');
            
            expect(project).toBeNull();
        });

        it('should handle corrupted JSON', async () => {
            fs.pathExists.mockResolvedValue(true);
            fs.readFile.mockResolvedValue('invalid json');

            await expect(persistence.loadProject('test-project'))
                .rejects
                .toThrow(SerializationError);
        });
    });

    describe('deleteProject', () => {
        it('should successfully delete an existing project', async () => {
            fs.pathExists.mockResolvedValue(true);
            
            await persistence.deleteProject('test-project');
            
            expect(fs.remove).toHaveBeenCalled();
        });

        it('should handle non-existent project gracefully', async () => {
            fs.pathExists.mockResolvedValue(false);
            
            await persistence.deleteProject('non-existent');
            
            expect(fs.remove).not.toHaveBeenCalled();
        });

        it('should handle deletion errors', async () => {
            fs.pathExists.mockResolvedValue(true);
            fs.remove.mockRejectedValue(new Error('Delete failed'));

            await expect(persistence.deleteProject('test-project'))
                .rejects
                .toThrow(StorageAccessError);
        });
    });

    describe('listProjects', () => {
        it('should list all projects', async () => {
            fs.readdir.mockResolvedValue([
                'project1.project.json',
                'project2.project.json',
                'other.file'
            ]);

            const projects = await persistence.listProjects();

            expect(projects).toEqual(['project1', 'project2']);
        });

        it('should handle empty directory', async () => {
            fs.readdir.mockResolvedValue([]);

            const projects = await persistence.listProjects();

            expect(projects).toEqual([]);
        });

        it('should handle directory read errors', async () => {
            fs.readdir.mockRejectedValue(new Error('Read failed'));

            await expect(persistence.listProjects())
                .rejects
                .toThrow(StorageAccessError);
        });
    });

    describe('checkpointing', () => {
        const testProject = {
            metadata: { projectName: 'test-project' },
            execution: {}
        };

        beforeEach(() => {
            fs.pathExists.mockResolvedValue(true);
            fs.readFile.mockResolvedValue(JSON.stringify(testProject));
        });

        it('should create checkpoint successfully', async () => {
            await persistence.createCheckpoint('test-project', 'test-checkpoint');

            expect(fs.writeFile).toHaveBeenCalledWith(
                expect.stringContaining('test-project_checkpoint_test-checkpoint'),
                expect.any(String),
                'utf8'
            );
        });

        it('should restore from checkpoint successfully', async () => {
            const checkpointData = {
                ...testProject,
                metadata: {
                    ...testProject.metadata,
                    checkpointId: 'test-checkpoint'
                }
            };
            fs.readFile.mockResolvedValueOnce(JSON.stringify(checkpointData));

            await persistence.restoreFromCheckpoint('test-project', 'test-checkpoint');

            expect(fs.writeFile).toHaveBeenCalled();
        });

        it('should list checkpoints', async () => {
            fs.readdir.mockResolvedValue([
                'test-project_checkpoint_cp1.project.json',
                'test-project_checkpoint_cp2.project.json',
                'other.file'
            ]);

            const checkpoints = await persistence.listCheckpoints('test-project');

            expect(checkpoints).toEqual(['cp1', 'cp2']);
        });

        it('should handle checkpoint not found', async () => {
            fs.pathExists.mockResolvedValue(false);

            await expect(persistence.restoreFromCheckpoint('test-project', 'non-existent'))
                .rejects
                .toThrow(PersistenceError);
        });
    });

    describe('locking mechanism', () => {
        it('should acquire lock successfully', async () => {
            fs.open.mockResolvedValue({});

            await expect(persistence._acquireLock('test-project'))
                .resolves
                .toBe(true);
        });

        it('should timeout when lock cannot be acquired', async () => {
            fs.open.mockRejectedValue({ code: 'EEXIST' });

            await expect(persistence._acquireLock('test-project', 100))
                .rejects
                .toThrow(ConcurrencyIOError);
        });

        it('should release lock successfully', async () => {
            fs.pathExists.mockResolvedValue(true);

            await persistence._releaseLock('test-project');

            expect(fs.remove).toHaveBeenCalled();
        });

        it('should handle lock release errors gracefully', async () => {
            fs.pathExists.mockResolvedValue(true);
            fs.remove.mockRejectedValue(new Error('Remove failed'));

            // Should not throw
            await persistence._releaseLock('test-project');
        });
    });

    describe('metadata operations', () => {
        const testProject = {
            metadata: {
                projectName: 'test-project',
                status: 'active'
            }
        };

        beforeEach(() => {
            fs.pathExists.mockResolvedValue(true);
            fs.readFile.mockResolvedValue(JSON.stringify(testProject));
        });

        it('should get project metadata', async () => {
            const metadata = await persistence.getProjectMetadata('test-project');

            expect(metadata).toEqual(testProject.metadata);
        });

        it('should return null metadata for non-existent project', async () => {
            fs.pathExists.mockResolvedValue(false);

            const metadata = await persistence.getProjectMetadata('non-existent');

            expect(metadata).toBeNull();
        });

        it('should update project status', async () => {
            await persistence.updateProjectStatus('test-project', 'completed');

            expect(fs.writeFile).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('"status":"completed"'),
                'utf8'
            );
        });

        it('should handle status update for non-existent project', async () => {
            fs.pathExists.mockResolvedValue(false);

            await expect(persistence.updateProjectStatus('non-existent', 'completed'))
                .rejects
                .toThrow(ProjectNotFoundError);
        });
    });
});
