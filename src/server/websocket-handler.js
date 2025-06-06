// src/server/websocket-handler.js
import { WebSocketServer } from 'ws'; // Ensure 'ws' is installed

class NotificationService {
    constructor(wss, systemManager, configManager) {
        this.wss = wss;
        this.systemManager = systemManager; // To potentially query state or interact
        this.configManager = configManager;
        this.clients = new Map(); // clientId -> { ws, subscriptions: Set<projectName> }
        this.setupConnectionHandling();
        console.log('[WebSocketHandler] NotificationService initialized.');
    }

    setupConnectionHandling() {
        this.wss.on('connection', (ws, req) => {
            const clientId = req.headers['sec-websocket-key']; // Use this as a simple client ID
            console.log(`[WebSocketHandler] Client connected: ${clientId}`);
            this.clients.set(clientId, { ws, subscriptions: new Set() });

            ws.on('message', (message) => {
                this.handleClientMessage(clientId, ws, message);
            });

            ws.on('close', () => {
                console.log(`[WebSocketHandler] Client disconnected: ${clientId}`);
                this.clients.delete(clientId);
            });

            ws.on('error', (error) => {
                console.error(`[WebSocketHandler] Error for client ${clientId}:`, error);
                this.clients.delete(clientId); // Remove on error too
            });

            ws.send(JSON.stringify({ type: 'system_notification', payload: { level: 'info', message: 'Connected to AI Platform WebSocket.', timestamp: new Date().toISOString()}}));
        });
    }

    handleClientMessage(clientId, ws, rawMessage) {
        try {
            const message = JSON.parse(rawMessage.toString());
            console.log(`[WebSocketHandler] Received from ${clientId}:`, message);

            switch (message.type) {
                case 'subscribe_project':
                    if (message.payload?.projectName) {
                        this.clients.get(clientId)?.subscriptions.add(message.payload.projectName);
                        ws.send(JSON.stringify({ type: 'subscription_ack', payload: { projectName: message.payload.projectName, status: 'subscribed' } }));
                        // Optionally send current status immediately
                        // const projectState = this.systemManager.activeProjects.get(message.payload.projectName);
                        // if (projectState) this.broadcastProjectStatus(projectState);
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: { code: 'INVALID_PAYLOAD', message: 'projectName is required for subscription.' } }));
                    }
                    break;
                case 'unsubscribe_project':
                    if (message.payload?.projectName) {
                        this.clients.get(clientId)?.subscriptions.delete(message.payload.projectName);
                         ws.send(JSON.stringify({ type: 'subscription_ack', payload: { projectName: message.payload.projectName, status: 'unsubscribed' } }));
                    }
                    break;
                // Add other client->server message types if needed
                default:
                    console.warn(`[WebSocketHandler] Unknown message type from ${clientId}: ${message.type}`);
                    ws.send(JSON.stringify({ type: 'error', payload: { code: 'UNKNOWN_MESSAGE_TYPE', message: `Unknown message type: ${message.type}` } }));
            }
        } catch (error) {
            console.error(`[WebSocketHandler] Error processing message from ${clientId}:`, error);
            ws.send(JSON.stringify({ type: 'error', payload: { code: 'MESSAGE_PROCESSING_ERROR', message: 'Failed to process your message.' } }));
        }
    }

    // --- Methods to be called by SystemManager (or an event bus it emits to) ---

    broadcastProjectStatus(projectState) { // projectState should conform to what UI expects
        if (!projectState || !projectState.metadata) return;
        const projectName = projectState.metadata.projectName;
        const message = {
            type: 'project_status_update',
            payload: {
                projectName: projectName,
                timestamp: new Date().toISOString(),
                status: projectState.metadata.status,
                details: projectState.execution?.lastError?.message || projectState.execution?.currentSubtaskId || 'Processing...',
                progress: this._calculateProgress(projectState) // Placeholder
            }
        };
        this._broadcastToSubscribers(projectName, message);
    }

    broadcastTaskUpdate(projectName, subtask, status, details = {}) {
        const message = {
            type: 'task_update',
            payload: {
                projectName,
                taskId: subtask.id,
                status, // 'started', 'completed', 'failed'
                timestamp: new Date().toISOString(),
                details: {
                    title: subtask.title,
                    ...details // e.g., error message if failed
                }
            }
        };
        this._broadcastToSubscribers(projectName, message);
    }

    streamSandboxLog(projectName, taskId, streamType, content) {
        const message = {
            type: 'sandbox_output',
            payload: {
                projectName,
                taskId,
                stream: streamType, // 'stdout' | 'stderr'
                content,
                timestamp: new Date().toISOString()
            }
        };
        this._broadcastToSubscribers(projectName, message);
    }

    broadcastSystemNotification(level, message, details) {
        const systemMessage = {
            type: 'system_notification',
            payload: {
                level,
                message,
                timestamp: new Date().toISOString(),
                details
            }
        };
        // Broadcast to ALL connected clients for system-wide notifications
        this.wss.clients.forEach(client => {
            if (client.readyState === client.OPEN) { // ws library uses client.OPEN not ws.OPEN
                client.send(JSON.stringify(systemMessage));
            }
        });
    }

    _broadcastToSubscribers(projectName, message) {
        const messageString = JSON.stringify(message);
        this.clients.forEach(clientData => {
            if (clientData.subscriptions.has(projectName) && clientData.ws.readyState === clientData.ws.OPEN) {
                try {
                    clientData.ws.send(messageString);
                } catch (e) {
                    console.error(`[WebSocketHandler] Error sending message to client: `, e);
                    // Potentially remove client if send fails repeatedly
                }
            }
        });
    }

    _calculateProgress(projectState) {
        // Simple progress calculation based on completed vs total tasks
        if (!projectState?.execution?.subtasksFull?.length) return 0;
        const total = projectState.execution.subtasksFull.length;
        const completed = projectState.execution.subtasksCompletedIds?.length || 0;
        if (total === 0) return projectState.metadata.status === 'analysis_complete' ? 50 : 0; // arbitrary 50% for analysis
        return Math.round((completed / total) * 100);
    }
}

// Initialize and export a single instance (or a function that returns an instance)
export default function initializeWebSocketHandler(wss, systemManager, configManager) {
    return new NotificationService(wss, systemManager, configManager);
}
