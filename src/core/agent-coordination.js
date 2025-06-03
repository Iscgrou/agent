// Agent Coordination System
// Implements the coordinating agent strategy with deep Vertex AI integration.
// This module is responsible for understanding user requests, planning, and task breakdown.

import { VertexAIChatModel, VertexAICodeChatModel } from './vertexAI-client.js';
import {
    generateRequestUnderstandingPrompt,
    generateProjectPlanningPrompt,
    generateTaskBreakdownPrompt,
    generateCodeAnalysisPrompt
} from './prompt-templates.js';
import { SandboxManager } from './sandbox-manager.js';

class AgentCoordinator {
    constructor(vertexAIChatConfig, vertexAICodeChatConfig, sandboxManagerConfig) {
        this.chatModel = new VertexAIChatModel(vertexAIChatConfig);
        this.codeChatModel = new VertexAICodeChatModel(vertexAICodeChatConfig);
        this.sandboxManager = new SandboxManager(sandboxManagerConfig);
        this.agents = new Map();
        this.taskQueue = [];
        this.systemState = {
            running: false,
            healthStatus: 'initializing',
            lastCheckpoint: null,
            metrics: {
                taskCount: 0,
                successRate: 0,
                errorRate: 0,
                recoveryRate: 0
            }
        };
    }

    async understandRequest(userInput, projectContext = {}) {
        console.log(`[Coordinator] Understanding request: "${userInput}"`);
        try {
            let initialAnalysisContext = { userInput, ...projectContext };

            if (projectContext.repositoryUrl && projectContext.analysisNeededForModification) {
                console.log(`[Coordinator] Analyzing repository: ${projectContext.repositoryUrl}`);
                initialAnalysisContext.preliminaryCodeUnderstanding = 
                    await this.analyzeRepositoryCode(projectContext.repositoryUrl);
            }
            
            const prompt = generateRequestUnderstandingPrompt(initialAnalysisContext);
            const llmResponse = await this.chatModel.generateText(prompt, {
                temperature: 0.3,
                maxOutputTokens: 1024
            });

            const structuredUnderstanding = this.parseLLMJsonResponse(llmResponse, "request_understanding");
            
            console.log(`[Coordinator] Request understood:`, structuredUnderstanding);
            return structuredUnderstanding;
        } catch (error) {
            console.error('[Coordinator] Error in understandRequest:', error);
            throw error;
        }
    }

    async developStrategicPlan(structuredUnderstanding) {
        console.log('[Coordinator] Developing strategic plan...');
        try {
            const prompt = generateProjectPlanningPrompt(structuredUnderstanding);
            const llmResponse = await this.chatModel.generateText(prompt, {
                temperature: 0.2,
                maxOutputTokens: 2048
            });
            const strategicPlan = this.parseLLMJsonResponse(llmResponse, "strategic_plan");
            
            console.log('[Coordinator] Strategic plan developed:', strategicPlan);
            return strategicPlan;
        } catch (error) {
            console.error('[Coordinator] Error in developStrategicPlan:', error);
            throw error;
        }
    }

    async breakdownPlanIntoSubtasks(strategicPlan, structuredUnderstanding) {
        console.log('[Coordinator] Breaking down plan into sub-tasks...');
        try {
            const prompt = generateTaskBreakdownPrompt(strategicPlan, structuredUnderstanding);
            const llmResponse = await this.chatModel.generateText(prompt, {
                temperature: 0.2,
                maxOutputTokens: 2048
            });
            const subtasksWithPersonas = this.parseLLMJsonResponse(llmResponse, "subtask_breakdown_list");

            console.log('[Coordinator] Sub-tasks generated:', subtasksWithPersonas);
            return subtasksWithPersonas;
        } catch (error) {
            console.error('[Coordinator] Error in breakdownPlanIntoSubtasks:', error);
            throw error;
        }
    }

    async processUserRequestToTasks(userInput, projectContext = {}) {
        const understanding = await this.understandRequest(userInput, projectContext);
        const plan = await this.developStrategicPlan(understanding);
        const subtasks = await this.breakdownPlanIntoSubtasks(plan, understanding);
        
        this.taskQueue.push(...subtasks);
        return subtasks;
    }

    async analyzeRepositoryCode(repositoryUrl) {
        try {
            const localRepoPath = await this.sandboxManager.cloneRepository(repositoryUrl);
            const fileStructure = await this.sandboxManager.listFiles(localRepoPath, { recursive: true });
            
            const analysisPromises = fileStructure.mainFiles.map(async file => {
                const content = await this.sandboxManager.readFile(file.path);
                const prompt = generateCodeAnalysisPrompt(content, file.path);
                return this.codeChatModel.generateText(prompt);
            });

            const analyses = await Promise.all(analysisPromises);
            
            return {
                repositoryUrl,
                fileStructure,
                analyses: analyses.map(analysis => this.parseLLMJsonResponse(analysis, "code_analysis"))
            };
        } catch (error) {
            console.error('[Coordinator] Error analyzing repository:', error);
            return {
                repositoryUrl,
                error: error.message,
                partialAnalysis: true
            };
        }
    }
    
    parseLLMJsonResponse(llmResponseText, operationName) {
        try {
            const jsonStart = llmResponseText.indexOf('{');
            const jsonArrayStart = llmResponseText.indexOf('[');
            let start = Math.min(
                jsonStart === -1 ? Infinity : jsonStart,
                jsonArrayStart === -1 ? Infinity : jsonArrayStart
            );

            if (start === Infinity) {
                throw new Error("No JSON object/array found in LLM response.");
            }

            const jsonEnd = llmResponseText.lastIndexOf('}');
            const jsonArrayEnd = llmResponseText.lastIndexOf(']');
            let end = Math.max(jsonEnd, jsonArrayEnd);
            
            if (end === -1 || end < start) {
                throw new Error("Valid JSON end not found or mismatched.");
            }

            const jsonString = llmResponseText.substring(start, end + 1);
            return JSON.parse(jsonString);
        } catch (e) {
            console.error(`[Coordinator] Failed to parse LLM JSON response for ${operationName}:`, e);
            console.error(`[Coordinator] LLM Response Text was:`, llmResponseText);
            throw new Error(`LLM response for ${operationName} was not valid JSON. Original error: ${e.message}`);
        }
    }

    getNextTask() {
        return this.taskQueue.shift();
    }
}

// Export the coordinator
export default AgentCoordinator;
