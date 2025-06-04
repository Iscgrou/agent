// src/core/configuration-manager.js
// Manages system-wide configurations from various sources like environment variables
// and configuration files (JSON/YAML). Prioritizes security for sensitive data.

import fs from 'fs-extra';
import path from 'path';
import yaml from 'js-yaml'; // For YAML support

// --- Custom Error Class for Configuration ---
class ConfigurationError extends Error {
    constructor(message, code, context = {}, originalError = null) {
        super(message);
        this.name = this.constructor.name;
        this.code = code; // e.g., 'FILE_NOT_FOUND', 'PARSE_ERROR', 'MISSING_KEY'
        this.context = context;
        this.originalError = originalError;
        this.timestamp = new Date().toISOString();
    }
}

/**
 * @typedef {object} ConfigurationManagerOptions
 * @property {string} [defaultConfigPath] - Path to the default JSON/YAML config file.
 * @property {string} [envSpecificConfigPath] - Path to environment-specific JSON/YAML config file (e.g., 'config/config.{NODE_ENV}.json'). NODE_ENV will be substituted.
 * @property {string} [envPrefix='APP_'] - Prefix for environment variables to be loaded.
 * @property {boolean} [envVarOverridesFile=true] - Whether environment variables should override file configurations.
 * @property {'json' | 'yaml'} [configFileFormat='json'] - Default format if extension is missing or for parsing.
 */

class ConfigurationManager {
    /**
     * @param {ConfigurationManagerOptions} options
     */
    constructor(options = {}) {
        this.options = {
            envPrefix: 'APP_',
            envVarOverridesFile: true,
            configFileFormat: 'json',
            ...options,
        };
        this.config = {};
        this._loadAndMergeConfigurations();
    }

    _loadAndMergeConfigurations() {
        let defaultConfig = {};
        let envSpecificConfig = {};
        let envConfig = {};

        // 1. Load default configuration file
        if (this.options.defaultConfigPath) {
            defaultConfig = this._loadConfigFromFile(this.options.defaultConfigPath, 'Default');
        }

        // 2. Load environment-specific configuration file
        const nodeEnv = process.env.NODE_ENV || 'development';
        if (this.options.envSpecificConfigPath) {
            const specificPath = this.options.envSpecificConfigPath.replace('{NODE_ENV}', nodeEnv);
            envSpecificConfig = this._loadConfigFromFile(specificPath, `${nodeEnv} Specific`, true); // true to allow missing
        }

        // 3. Load configuration from environment variables
        envConfig = this._loadConfigFromEnv();

        // 4. Merge configurations with precedence
        // Order: Default -> Env-Specific File -> Environment Variables (if overrides enabled)
        this.config = this._deepMerge({}, defaultConfig);
        this.config = this._deepMerge(this.config, envSpecificConfig);

        if (this.options.envVarOverridesFile) {
            this.config = this._deepMerge(this.config, envConfig);
        } else {
            // If file overrides env, merge env first, then files. More complex, usually env wins.
            // For simplicity, sticking to env winning or being merged based on option.
            // This scenario (file overriding env) is less common for sensitive data.
            const tempConfig = this._deepMerge({}, envConfig);
            this.config = this._deepMerge(tempConfig, this.config); // Default + EnvSpecific already merged into this.config
        }
        console.log('[ConfigManager] Configurations loaded and merged.');
        // console.log('[ConfigManager] Final effective config:', JSON.stringify(this.config, null, 2)); // For debugging
    }

    _loadConfigFromFile(filePath, type = 'Configuration', allowMissing = false) {
        const resolvedPath = path.resolve(filePath);
        console.log(`[ConfigManager] Attempting to load ${type} file: ${resolvedPath}`);
        try {
            if (!fs.existsSync(resolvedPath)) {
                if (allowMissing) {
                    console.warn(`[ConfigManager] Optional ${type} file not found: ${resolvedPath}`);
                    return {};
                }
                throw new ConfigurationError(`${type} file not found`, "FILE_NOT_FOUND", { path: resolvedPath });
            }
            const fileContent = fs.readFileSync(resolvedPath, 'utf8');
            const ext = path.extname(resolvedPath).toLowerCase();

            if (ext === '.json' || (ext === '' && this.options.configFileFormat === 'json')) {
                return JSON.parse(fileContent);
            } else if (ext === '.yaml' || ext === '.yml' || (ext === '' && this.options.configFileFormat === 'yaml')) {
                return yaml.load(fileContent);
            } else {
                throw new ConfigurationError(`Unsupported config file format: ${ext || 'unknown'}`, "UNSUPPORTED_FORMAT", { path: resolvedPath });
            }
        } catch (err) {
            if (err instanceof ConfigurationError) throw err;
            throw new ConfigurationError(`Failed to load or parse ${type} file: ${resolvedPath}`, "PARSE_ERROR", { path: resolvedPath }, err);
        }
    }

    _loadConfigFromEnv() {
        const envConfig = {};
        const prefix = this.options.envPrefix;
        for (const envKey in process.env) {
            if (envKey.startsWith(prefix)) {
                const keyPath = envKey
                    .substring(prefix.length)
                    .toLowerCase()
                    .split('__'); // Double underscore for nesting, e.g., APP_VERTEXAI__CHATMODEL__TEMPERATURE

                let currentLevel = envConfig;
                keyPath.forEach((part, index) => {
                    if (index === keyPath.length - 1) {
                        currentLevel[part] = this._parseEnvValue(process.env[envKey]);
                    } else {
                        currentLevel[part] = currentLevel[part] || {};
                        currentLevel = currentLevel[part];
                    }
                });
            }
        }
        return envConfig;
    }

    _parseEnvValue(value) {
        if (value === undefined || value === null) return value;
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;
        if (!isNaN(value) && value.trim() !== '') { // Check for empty string as well
             const num = Number(value);
             if (String(num) === value) return num; // Ensure it wasn't something like "1.2.3"
        }
        try {
            // Attempt to parse as JSON if it's an array or object string
            if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
                return JSON.parse(value);
            }
        } catch (e) { /* Not a JSON string, return as is */ }
        return value; // Return as string by default
    }

    _isObject(item) {
        return (item && typeof item === 'object' && !Array.isArray(item));
    }

    _deepMerge(target, ...sources) {
        if (!sources.length) return target;
        const source = sources.shift();

        if (this._isObject(target) && this._isObject(source)) {
            for (const key in source) {
                if (this._isObject(source[key])) {
                    if (!target[key]) Object.assign(target, { [key]: {} });
                    this._deepMerge(target[key], source[key]);
                } else {
                    Object.assign(target, { [key]: source[key] });
                }
            }
        }
        return this._deepMerge(target, ...sources);
    }

    /**
     * Gets a configuration value.
     * @param {string} key - The configuration key (e.g., 'database.host', 'port').
     * @param {any} [defaultValue] - Value to return if key is not found.
     * @returns {any} The configuration value or defaultValue.
     */
    get(key, defaultValue = undefined) {
        const keys = key.split('.');
        let current = this.config;
        for (const k of keys) {
            if (current && typeof current === 'object' && k in current) {
                current = current[k];
            } else {
                return defaultValue;
            }
        }
        return current;
    }

    /**
     * Checks if a configuration key exists.
     * @param {string} key - The configuration key.
     * @returns {boolean}
     */
    has(key) {
        return this.get(key, undefined) !== undefined;
    }

    /**
     * Returns the entire merged configuration object.
     * Use with caution, especially if it contains sensitive data. Consider a method
     * that returns a sanitized version if needed for debugging/display.
     * @returns {object}
     */
    getAll() {
        // Deep clone to prevent external modification of the internal config object
        return JSON.parse(JSON.stringify(this.config));
    }

    /**
     * Checks if a feature flag is enabled.
     * Assumes feature flags are stored under a 'featureFlags' key in the config.
     * e.g., config: { featureFlags: { newSearch: true } }
     * @param {string} flagName - The name of the feature flag.
     * @returns {boolean}
     */
    isFeatureEnabled(flagName) {
        return !!this.get(`featureFlags.${flagName}`, false); // Default to false if not found
    }

    // --- Secure Data Handling ---
    // Logging of sensitive data should be avoided. The 'getAll' method is a potential risk point.
    // If this class were to log, it should have a sanitization mechanism.
    // Example: (not fully implemented, for illustration)
    // getSanitizedConfig(keysToOmitOrMask = ['apiKey', 'password', 'secret']) { ... }

    // --- Hot Reloading (Conceptual Hook) ---
    // This would require watching files and re-running _loadAndMergeConfigurations,
    // and potentially an event emitter to notify other parts of the application.
    // onConfigChange(callback) { /* ... add to list of callbacks ... */ }
    // _notifyConfigChange() { /* ... iterate and call callbacks ... */ }

} // End of ConfigurationManager class

export { ConfigurationManager, ConfigurationError };
