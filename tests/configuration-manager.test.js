// tests/configuration-manager.test.js

import { jest } from '@jest/globals';
import path from 'path';
import { ConfigurationManager, ConfigurationError } from '../src/core/configuration-manager.js';

// Mock fs-extra
jest.mock('fs-extra', () => ({
    existsSync: jest.fn(),
    readFileSync: jest.fn()
}));

// Mock js-yaml
jest.mock('js-yaml', () => ({
    load: jest.fn()
}));

// Import mocked modules
import fs from 'fs-extra';
import yaml from 'js-yaml';

describe('ConfigurationManager', () => {
    // Store original process.env
    const originalEnv = process.env;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        // Reset process.env before each test
        process.env = { ...originalEnv };
        // Default successful behaviors
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue('{}');
    });

    afterEach(() => {
        // Restore original process.env
        process.env = originalEnv;
    });

    describe('constructor and initialization', () => {
        it('should initialize with default options', () => {
            const config = new ConfigurationManager();
            expect(config.options.envPrefix).toBe('APP_');
            expect(config.options.envVarOverridesFile).toBe(true);
            expect(config.options.configFileFormat).toBe('json');
        });

        it('should initialize with custom options', () => {
            const config = new ConfigurationManager({
                envPrefix: 'TEST_',
                envVarOverridesFile: false,
                configFileFormat: 'yaml'
            });
            expect(config.options.envPrefix).toBe('TEST_');
            expect(config.options.envVarOverridesFile).toBe(false);
            expect(config.options.configFileFormat).toBe('yaml');
        });
    });

    describe('loading from files', () => {
        const defaultConfig = {
            appName: 'Test App',
            port: 3000,
            featureFlags: {
                newDashboard: false
            }
        };

        const devConfig = {
            port: 3001,
            featureFlags: {
                newDashboard: true
            }
        };

        beforeEach(() => {
            fs.readFileSync
                .mockReturnValueOnce(JSON.stringify(defaultConfig))
                .mockReturnValueOnce(JSON.stringify(devConfig));
        });

        it('should load and merge JSON configuration files', () => {
            const config = new ConfigurationManager({
                defaultConfigPath: 'config/default.config.json',
                envSpecificConfigPath: 'config/config.{NODE_ENV}.json'
            });

            expect(config.get('appName')).toBe('Test App');
            expect(config.get('port')).toBe(3001); // Overridden by dev config
            expect(config.get('featureFlags.newDashboard')).toBe(true); // Overridden by dev config
        });

        it('should handle missing optional environment-specific config', () => {
            fs.existsSync
                .mockReturnValueOnce(true) // default config exists
                .mockReturnValueOnce(false); // env-specific config doesn't exist

            const config = new ConfigurationManager({
                defaultConfigPath: 'config/default.config.json',
                envSpecificConfigPath: 'config/config.{NODE_ENV}.json'
            });

            expect(config.get('appName')).toBe('Test App');
            expect(config.get('port')).toBe(3000); // Not overridden
        });

        it('should throw ConfigurationError for missing required config', () => {
            fs.existsSync.mockReturnValue(false);

            expect(() => new ConfigurationManager({
                defaultConfigPath: 'config/default.config.json'
            })).toThrow(ConfigurationError);
        });

        it('should handle YAML configuration files', () => {
            const yamlConfig = {
                appName: 'YAML App',
                database: { host: 'localhost' }
            };
            yaml.load.mockReturnValue(yamlConfig);

            const config = new ConfigurationManager({
                defaultConfigPath: 'config/default.config.yaml',
                configFileFormat: 'yaml'
            });

            expect(config.get('appName')).toBe('YAML App');
            expect(config.get('database.host')).toBe('localhost');
        });
    });

    describe('environment variables', () => {
        beforeEach(() => {
            process.env.APP_PORT = '4000';
            process.env.APP_DATABASE__HOST = 'env-db-host';
            process.env.APP_FEATUREFLAGS__NEWFEATURE = 'true';
            process.env.APP_COMPLEX__SETTING = '{"key": "value"}';
        });

        it('should load configuration from environment variables', () => {
            const config = new ConfigurationManager();

            expect(config.get('port')).toBe(4000); // Number parsing
            expect(config.get('database.host')).toBe('env-db-host'); // Nested key
            expect(config.get('featureflags.newfeature')).toBe(true); // Boolean parsing
            expect(config.get('complex.setting')).toEqual({ key: 'value' }); // JSON parsing
        });

        it('should respect environment variable prefix', () => {
            process.env.TEST_PORT = '5000';
            const config = new ConfigurationManager({ envPrefix: 'TEST_' });

            expect(config.get('port')).toBe(5000);
        });

        it('should handle environment variable precedence correctly', () => {
            fs.readFileSync.mockReturnValue(JSON.stringify({ port: 3000 }));

            const config = new ConfigurationManager({
                defaultConfigPath: 'config/default.config.json',
                envVarOverridesFile: true
            });

            expect(config.get('port')).toBe(4000); // Env var should override file
        });
    });

    describe('accessing configuration values', () => {
        let config;
        const testConfig = {
            string: 'value',
            number: 42,
            nested: {
                key: 'nested-value',
                deep: {
                    key: 'deep-value'
                }
            },
            array: [1, 2, 3]
        };

        beforeEach(() => {
            fs.readFileSync.mockReturnValue(JSON.stringify(testConfig));
            config = new ConfigurationManager({
                defaultConfigPath: 'config/default.config.json'
            });
        });

        it('should get values using dot notation', () => {
            expect(config.get('string')).toBe('value');
            expect(config.get('nested.key')).toBe('nested-value');
            expect(config.get('nested.deep.key')).toBe('deep-value');
        });

        it('should return default value for missing keys', () => {
            expect(config.get('missing', 'default')).toBe('default');
            expect(config.get('missing.nested', 'default')).toBe('default');
        });

        it('should check existence of keys', () => {
            expect(config.has('string')).toBe(true);
            expect(config.has('nested.key')).toBe(true);
            expect(config.has('missing')).toBe(false);
            expect(config.has('missing.nested')).toBe(false);
        });

        it('should return entire configuration with getAll', () => {
            const allConfig = config.getAll();
            expect(allConfig).toEqual(testConfig);
            // Verify it's a deep clone
            allConfig.nested.key = 'modified';
            expect(config.get('nested.key')).toBe('nested-value');
        });
    });

    describe('feature flags', () => {
        let config;
        const testConfig = {
            featureFlags: {
                enabled: true,
                disabled: false,
                withValue: 'yes'
            }
        };

        beforeEach(() => {
            fs.readFileSync.mockReturnValue(JSON.stringify(testConfig));
            config = new ConfigurationManager({
                defaultConfigPath: 'config/default.config.json'
            });
        });

        it('should check if features are enabled', () => {
            expect(config.isFeatureEnabled('enabled')).toBe(true);
            expect(config.isFeatureEnabled('disabled')).toBe(false);
            expect(config.isFeatureEnabled('withValue')).toBe(true);
            expect(config.isFeatureEnabled('nonexistent')).toBe(false);
        });

        it('should handle environment variable overrides for feature flags', () => {
            process.env.APP_FEATUREFLAGS__ENABLED = 'false';
            process.env.APP_FEATUREFLAGS__DISABLED = 'true';

            config = new ConfigurationManager({
                defaultConfigPath: 'config/default.config.json'
            });

            expect(config.isFeatureEnabled('enabled')).toBe(false);
            expect(config.isFeatureEnabled('disabled')).toBe(true);
        });
    });

    describe('error handling', () => {
        it('should handle malformed JSON', () => {
            fs.readFileSync.mockReturnValue('invalid json');

            expect(() => new ConfigurationManager({
                defaultConfigPath: 'config/default.config.json'
            })).toThrow(ConfigurationError);
        });

        it('should handle malformed YAML', () => {
            yaml.load.mockImplementation(() => {
                throw new Error('YAML parsing error');
            });

            expect(() => new ConfigurationManager({
                defaultConfigPath: 'config/default.config.yaml',
                configFileFormat: 'yaml'
            })).toThrow(ConfigurationError);
        });

        it('should handle file read errors', () => {
            fs.readFileSync.mockImplementation(() => {
                throw new Error('File read error');
            });

            expect(() => new ConfigurationManager({
                defaultConfigPath: 'config/default.config.json'
            })).toThrow(ConfigurationError);
        });

        it('should handle invalid environment variable values', () => {
            process.env.APP_INVALID_JSON = '{invalid json}';
            const config = new ConfigurationManager();
            
            // Should not throw, should keep original string
            expect(config.get('invalid_json')).toBe('{invalid json}');
        });
    });
});
