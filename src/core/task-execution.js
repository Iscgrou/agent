// Task Execution System
// Manages the actual implementation of tasks by leveraging AI Agents (Vertex AI models).
// Includes code generation, execution in sandbox, result validation, and self-debugging.

import { VertexAICodeModel, VertexAICodeChatModel } from './vertexAI-client.js';
import { SandboxManager } from './sandbox-manager.js';
import { 
    generateCodeGenerationPrompt,
    generateCodeDebuggingPrompt,
    generateSelfReflectionPrompt,
    generateTestGenerationPrompt
} from './prompt-templates.js';

const MAX_DEBUG_ATTEMPTS = 3;

class TaskExecutionSystem {
    constructor(vertexAICodeConfig, vertexAICodeChatConfig, sandboxManagerConfig) {
        this.codeModel = new VertexAICodeModel(vertexAICodeConfig);
        this.codeChatModel = new VertexAICodeChatModel(vertexAICodeChatConfig);
        this.sandboxManager = new SandboxManager(sandboxManagerConfig);
        this.activeExecutions = new Map();
    }

    async executeSubtask(subtask, projectContext) {
        console.log(`[TaskEx] Executing subtask: ${subtask.id} - ${subtask.description}`);
        this.activeExecutions.set(subtask.id, { status: 'starting', subtask });
        let currentCodeArtifacts = projectContext.currentCode || {};
        let attempt = 0;
        let lastError = null;

        while (attempt <= MAX_DEBUG_ATTEMPTS) {
            try {
                // 1. Code Generation (or modification)
                const codeGenPromptContext = {
                    ...subtask,
                    existingCode: currentCodeArtifacts,
                    errorContext: attempt > 0 ? lastError : null
                };
                const codeGenPrompt = generateCodeGenerationPrompt(codeGenPromptContext);
                
                console.log(`[TaskEx] Attempt ${attempt}: Generating code for ${subtask.id}`);
                const llmResponse = (attempt > 0 && lastError) || subtask.isModification
                    ? await this.codeChatModel.generateText(codeGenPrompt)
                    : await this.codeModel.generateCode(codeGenPrompt);

                const newOrModifiedCode = this.parseCodeFromLLMResponse(llmResponse, subtask);
                let attemptArtifacts = { ...currentCodeArtifacts, ...newOrModifiedCode };

                // 2. Test Generation
                let testsToRun = subtask.acceptanceCriteriaTests || [];
                if (subtask.generateTests && !testsToRun.length) {
                     const testGenPrompt = generateTestGenerationPrompt(subtask, attemptArtifacts);
                     const testGenResponse = await this.codeChatModel.generateText(testGenPrompt);
                     testsToRun = this.parseTestsFromLLMResponse(testGenResponse, subtask.language);
                }

                // 3. Execution and Testing
                console.log(`[TaskEx] Attempt ${attempt}: Executing/testing code for ${subtask.id}`);
                const executionOptions = {
                    language: subtask.language,
                    entryPoint: subtask.entryPoint,
                    timeoutMs: subtask.timeoutMs || 60000,
                    tests: testsToRun
                };
                const sandboxResult = await this.sandboxManager.executeCode(attemptArtifacts, executionOptions);

                if (sandboxResult.success && (!sandboxResult.testResults || sandboxResult.testResults.every(t => t.passed))) {
                    console.log(`[TaskEx] Subtask ${subtask.id} completed successfully on attempt ${attempt}`);
                    this.activeExecutions.set(subtask.id, { 
                        status: 'success', 
                        result: sandboxResult, 
                        artifacts: attemptArtifacts 
                    });
                    
                    return { 
                        success: true, 
                        artifacts: attemptArtifacts, 
                        logs: sandboxResult.output, 
                        testResults: sandboxResult.testResults 
                    };
                } else {
                    lastError = {
                        message: sandboxResult.error || "Test failures occurred.",
                        output: sandboxResult.output,
                        failedTests: sandboxResult.testResults?.filter(t => !t.passed) || []
                    };
                    console.warn(`[TaskEx] Attempt ${attempt} for ${subtask.id} failed:`, lastError.message);
                    if (attempt === MAX_DEBUG_ATTEMPTS) {
                        throw new Error(`Max debug attempts reached for subtask ${subtask.id}. Last error: ${lastError.message}`);
                    }
                }
            } catch (error) {
                console.error(`[TaskEx] Critical error during attempt ${attempt} for ${subtask.id}:`, error);
                lastError = { 
                    message: error.message, 
                    stack: error.stack, 
                    type: "critical_execution_error" 
                };
                if (attempt === MAX_DEBUG_ATTEMPTS) {
                    this.activeExecutions.set(subtask.id, { status: 'failed', error: lastError });
                    throw error;
                }
            }
            attempt++;
            console.log(`[TaskEx] Retrying subtask ${subtask.id} (Attempt ${attempt})...`);
        }
        throw new Error(`Execution loop error for subtask ${subtask.id}`);
    }

    parseCodeFromLLMResponse(llmResponseText, subtask) {
        console.log("[TaskEx] Parsing code from LLM response...");
        const files = {};
        
        try {
            if (llmResponseText.trim().startsWith('{') || llmResponseText.trim().startsWith('[')) {
                const parsed = JSON.parse(llmResponseText);
                if (parsed.files && Array.isArray(parsed.files)) {
                    for (const file of parsed.files) {
                        if (file.path && typeof file.content === 'string') {
                            files[file.path] = file.content;
                        }
                    }
                    if (Object.keys(files).length > 0) return files;
                }
            }
        } catch (e) { /* Fallback to Markdown parsing */ }

        const regex = /```(?:[\w.-]+)?(?:[:\s]([\w./-]+))?\s*([\s\S]*?)\s*```/g;
        let match;
        let fileCount = 0;
        while ((match = regex.exec(llmResponseText)) !== null) {
            const path = match[1] || `generated_file_${fileCount++}.${subtask.languageExtension || 'txt'}`;
            files[path] = match[2].trim();
        }

        if (Object.keys(files).length === 0 && llmResponseText.trim() !== "") {
            const primaryFileName = subtask.primaryFile || `main.${subtask.languageExtension || 'txt'}`;
            files[primaryFileName] = llmResponseText.trim();
        }
        
        if (Object.keys(files).length === 0) {
           console.warn("[TaskEx] Could not parse any code files from LLM response:", llmResponseText);
        }
        console.log(`[TaskEx] Parsed ${Object.keys(files).length} file(s)`);
        return files;
    }

    parseTestsFromLLMResponse(llmResponseText, language) {
        console.log("[TaskEx] Parsing tests from LLM response...");
        try {
            if (llmResponseText.trim().startsWith('{')) {
                const parsed = JSON.parse(llmResponseText);
                if (parsed.tests && Array.isArray(parsed.tests)) {
                    return parsed.tests;
                }
            }
            return [];
        } catch (e) {
            console.warn("[TaskEx] Failed to parse tests from LLM response:", e);
            return [];
        }
    }
}

// Export the Task Execution System
export default TaskExecutionSystem;
