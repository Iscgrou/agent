import { google } from '@google-cloud/aiplatform';
import database from '../database/index.js';
import logger from '../utils/logger.js';
import { ValidationError } from '../middleware/errorHandler.js';

class SettingsService {
    constructor() {
        this.settings = null;
    }

    async getSettings() {
        try {
            const query = 'SELECT * FROM settings WHERE id = 1';
            const result = await database.query(query);
            
            if (result.rows.length === 0) {
                // Initialize default settings if none exist
                const defaultSettings = {
                    vertex_ai_key: null,
                    created_at: new Date(),
                    updated_at: new Date()
                };
                
                await database.query(
                    'INSERT INTO settings (vertex_ai_key, created_at, updated_at) VALUES ($1, $2, $3)',
                    [defaultSettings.vertex_ai_key, defaultSettings.created_at, defaultSettings.updated_at]
                );
                
                return defaultSettings;
            }
            
            return result.rows[0];
        } catch (error) {
            logger.error('Failed to fetch settings:', error);
            throw error;
        }
    }

    async updateVertexAIKey(apiKey) {
        try {
            // Validate API key format
            if (!this.isValidApiKey(apiKey)) {
                throw new ValidationError('Invalid API key format');
            }

            const query = `
                INSERT INTO settings (id, vertex_ai_key, updated_at)
                VALUES (1, $1, NOW())
                ON CONFLICT (id) DO UPDATE
                SET vertex_ai_key = $1, updated_at = NOW()
                RETURNING *
            `;
            
            const result = await database.query(query, [apiKey]);
            logger.info('Vertex AI API key updated successfully');
            
            return result.rows[0];
        } catch (error) {
            logger.error('Failed to update Vertex AI API key:', error);
            throw error;
        }
    }

    async testVertexAIConnection() {
        try {
            const settings = await this.getSettings();
            if (!settings.vertex_ai_key) {
                throw new ValidationError('Vertex AI API key not configured');
            }

            // Initialize the Vertex AI client
            const client = new google.cloud.aiplatform.v1.PredictionServiceClient({
                credentials: {
                    client_email: 'vertex-ai@project.iam.gserviceaccount.com',
                    private_key: settings.vertex_ai_key
                }
            });

            // Test connection by listing available models
            const [models] = await client.listModels({
                parent: 'projects/your-project/locations/us-central1'
            });

            logger.info('Vertex AI connection test successful');
            return {
                success: true,
                message: 'Connection successful',
                modelsAvailable: models.length
            };
        } catch (error) {
            logger.error('Vertex AI connection test failed:', error);
            throw new ValidationError('Failed to connect to Vertex AI: ' + error.message);
        }
    }

    isValidApiKey(apiKey) {
        // Basic validation for API key format
        // Modify this according to Vertex AI's actual key format
        return typeof apiKey === 'string' && 
               apiKey.length >= 32 && 
               apiKey.startsWith('AI');
    }
}

// Create and export a singleton instance
const settingsService = new SettingsService();
export default settingsService;
