import express from 'express';
import { auth } from '../middleware/auth.js';
import SettingsService from '../services/SettingsService.js';
import { validateAdmin } from '../middleware/validateAdmin.js';

const router = express.Router();

// Get all settings (admin only)
router.get('/', auth, validateAdmin, async (req, res, next) => {
    try {
        const settings = await SettingsService.getSettings();
        res.json(settings);
    } catch (error) {
        next(error);
    }
});

// Update Vertex AI API key (admin only)
router.post('/vertex-ai-key', auth, validateAdmin, async (req, res, next) => {
    try {
        const { apiKey } = req.body;
        if (!apiKey) {
            return res.status(400).json({ message: 'API key is required' });
        }

        const settings = await SettingsService.updateVertexAIKey(apiKey);
        res.json(settings);
    } catch (error) {
        next(error);
    }
});

// Test Vertex AI connection (admin only)
router.post('/test-vertex-ai', auth, validateAdmin, async (req, res, next) => {
    try {
        const result = await SettingsService.testVertexAIConnection();
        res.json(result);
    } catch (error) {
        next(error);
    }
});

export default router;
