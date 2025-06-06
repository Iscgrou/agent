// src/core/task-execution.js
// Manages the actual implementation of subtasks by leveraging AI Agents (Vertex AI models),
// Sandbox for execution, and Persistence for state/artifacts.

import { VertexAICodeModel, VertexAICodeChatModel, VertexAIError } from './vertexAI-client.js';
import { SandboxManager, SandboxError } from './sandbox-manager.js';
import path from 'path';
import {
    generateCodeGenerationPrompt,
    generateCodeDebuggingPrompt,
    // generateSelfReflectionPrompt, // For future enhancement
    // generateTestGenerationPrompt  // For future enhancement
} from './prompt-templates.js';
// import { ProjectPersistence, PersistenceError } from './project-persistence.js';
// import { ConfigurationManager } from './configuration-manager.js';

const MAX_DEBUG_ATTEMPTS = 3;

class TaskExecutionSystem {
    /**
     * @param {object} vertexAICodeConfig
     * @param {object} vertexAICodeChatConfig
     * @param {SandboxManager} sandboxManager
     * @param {ProjectPersistence} [projectPersistence]
     * @param {ConfigurationManager} [configManager]
     * @param {LearningSystem} [learningSystem] - Learning system for experience logging
     */
    constructor(vertexAICodeConfig, vertexAICodeChatConfig, sandboxManager, projectPersistence, configManager, learningSystem) {
        this.codeModel = new VertexAICodeModel(vertexAICodeConfig);
        this.codeChatModel = new VertexAICodeChatModel(vertexAICodeChatConfig);
        this.sandboxManager = sandboxManager;
        this.projectPersistence = projectPersistence;
        this.configManager = configManager; // For accessing global configs like MAX_DEBUG_ATTEMPTS
        this.learningSystem = learningSystem;

        this.activeExecutions = new Map(); // subtaskId -> { status, attempts, ... }
        console.log('[TaskExecutionSystem] Initialized with LearningSystem.');
    }

    _parseLLMJsonResponse(llmResponseText, operationName) {
        try {
            const cleanedResponse = llmResponseText.match(/```json\s*([\s\S]*?)\s*```/)?.[1] || llmResponseText;
            const parsed = JSON.parse(cleanedResponse);
            if (parsed.error && operationName !== 'code_debugging') {
                console.warn(`[TaskExecutionSystem] AI returned an error for ${operationName}:`, parsed.error);
            }
            return parsed;
        } catch (e) {
            console.error(`[TaskExecutionSystem] Failed to parse LLM JSON for ${operationName}:`, e, "\nResponse text:", llmResponseText);
            throw new Error(`LLM response for ${operationName} was not valid JSON. Original error: ${e.message}`);
        }
    }

    _parseCodeFilesFromLLMResponse(llmResponseText, subtask) {
        const parsed = this._parseLLMJsonResponse(llmResponseText, "code_generation_output");
        if (parsed.files && Array.isArray(parsed.files)) {
            const codeArtifacts = {};
            parsed.files.forEach(file => {
                if (file.path && typeof file.content === 'string') {
                    codeArtifacts[file.path] = file.content;
                } else {
                    console.warn(`[TaskExecutionSystem] Invalid file structure in LLM code response for subtask ${subtask.id}:`, file);
                }
            });
            if (Object.keys(codeArtifacts).length === 0 && parsed.files.length > 0) {
                console.warn(`[TaskExecutionSystem] LLM specified files but no valid path/content pairs found for subtask ${subtask.id}.`);
            }
            return { codeArtifacts, explanation: parsed.explanation };
        } else if (typeof parsed.code === 'string' && typeof parsed.file_path === 'string') {
            return { codeArtifacts: { [parsed.file_path]: parsed.code }, explanation: parsed.explanation };
        }
        console.warn(`[TaskExecutionSystem] Could not parse code files from LLM response for subtask ${subtask.id}. Response:`, llmResponseText.substring(0, 500));
        return { codeArtifacts: {}, explanation: "Failed to parse code output." };
    }

    async executeSubtask(subtask, projectName, currentProjectFileContext) {
        console.log(`[TaskExecutionSystem] Executing subtask: ${subtask.id} - ${subtask.title} for project ${projectName}`);
        this.activeExecutions.set(subtask.id, { status: 'starting', attempts: 0, subtask });

        let attemptArtifacts = { ...currentProjectFileContext };
        let debugAttempt = 0;
        const maxDebugAttempts = this.configManager?.get('sandbox.maxDebugAttempts', MAX_DEBUG_ATTEMPTS) || MAX_DEBUG_ATTEMPTS;
        let lastSandboxError = null;
        let sessionHostDir = null;
        let sandboxContainerId = null;

        try {
            sessionHostDir = await this.sandboxManager.createSessionHostDir(`subtask-${subtask.id}-`);

            while (debugAttempt <= maxDebugAttempts) {
                try {
                    this.activeExecutions.get(subtask.id).attempts = debugAttempt;
                    console.log(`[TaskExecutionSystem] Subtask ${subtask.id}, Attempt ${debugAttempt + 1}/${maxDebugAttempts + 1}`);

                    const codeGenPromptContext = {
                        subtask,
                        agentPersonaInstructions: `You are an AI assistant acting as a ${subtask.assigned_persona}.`,
                        existingCodeSnippets: this._getRelevantCodeSnippets(subtask, attemptArtifacts),
                        language: subtask.language || this._inferLanguage(subtask, attemptArtifacts),
                        errorContext: debugAttempt > 0 ? lastSandboxError : null,
                    };

                    const codeGenPrompt = generateCodeGenerationPrompt(codeGenPromptContext);
                    const modelToUseForCodeGen = (debugAttempt > 0 && lastSandboxError) || subtask.type === 'modification'
                        ? this.codeChatModel
                        : this.codeModel;

                    const startTime = Date.now();
                    const modelOptions = {
                        temperature: this.configManager?.get(`vertexAI.code.${modelToUseForCodeGen === this.codeChatModel ? 'chat' : 'gen'}.temperature`, 0.2),
                        maxOutputTokens: this.configManager?.get(`vertexAI.code.maxOutputTokens`, 4096),
                    };
                    const codeGenResponseText = await modelToUseForCodeGen.generateText(codeGenPrompt, modelOptions);

                    // Log AI prompt execution
                    if (this.learningSystem) {
                        await this.learningSystem.logExperience({
                            type: 'AI_PROMPT_EXECUTION',
                            context: {
                                projectName: subtask.projectName,
                                subtaskId: subtask.id,
                                promptId: `code_generation_${debugAttempt > 0 ? 'debug_attempt_' + debugAttempt : 'initial'}`,
                                promptHash: codeGenPrompt.substring(0, 100),
                                modelName: modelToUseForCodeGen === this.codeChatModel ? 'vertex-ai-code-chat' : 'vertex-ai-code',
                                modelParametersUsed: modelOptions
                            },
                            outcome: {
                                status: 'SUCCESS',
                                durationMs: Date.now() - startTime,
                                metrics: {
                                    tokensUsed: {
                                        input: codeGenPrompt.length / 4,
                                        output: codeGenResponseText.length / 4,
                                        total: (codeGenPrompt.length + codeGenResponseText.length) / 4
                                    }
                                }
                            }
                        }).catch(err => console.warn('[TaskExecutionSystem] Failed to log AI experience:', err));
                    }

                    const { codeArtifacts: newOrModifiedCode, explanation: genExplanation } =
                        this._parseCodeFilesFromLLMResponse(codeGenResponseText, subtask);

                    console.log(`[TaskExecutionSystem] AI Explanation for code generation: ${genExplanation || 'None'}`);

                    if (Object.keys(newOrModifiedCode).length === 0 && debugAttempt === 0) {
                        if (subtask.expected_artifacts?.some(a => a.type === 'code')) {
                            lastSandboxError = { message: "AI failed to generate any code artifacts.", step: "code_generation" };
                            debugAttempt++;
                            continue;
                        }
                    }

                    attemptArtifacts = { ...attemptArtifacts, ...newOrModifiedCode };

                    const mountStrings = await this.sandboxManager.prepareProjectFilesForMount(sessionHostDir, attemptArtifacts);

                    sandboxContainerId = await this.sandboxManager.createAndStartContainer(
                        subtask.sandboxImage || this.configManager?.get('sandbox.defaultImage', 'ubuntu:latest'),
                        {
                            volumeMounts: mountStrings,
                            networkMode: subtask.requiresNetwork ? 'bridge' : this.configManager?.get('sandbox.defaultNetworkMode', 'none'),
                            envVars: subtask.envVars || [],
                            resourceLimits: subtask.resourceLimits
                        }
                    );

                    const executionCommand = this._determineExecutionCommand(subtask, attemptArtifacts);
                    if (!executionCommand) {
                        if (Object.keys(newOrModifiedCode).length > 0) {
                            this.activeExecutions.set(subtask.id, { status: 'success', artifacts: attemptArtifacts });
                            return { success: true, artifacts: attemptArtifacts, logs: "No execution command defined, code generated." };
                        } else {
                            throw new Error(`No execution command for subtask ${subtask.id} and no code was generated.`);
                        }
                    }

                    console.log(`[TaskExecutionSystem] Executing command in sandbox for ${subtask.id}: ${executionCommand.join(' ')}`);
                    const sandboxResult = await this.sandboxManager.executeCommand(
                        sandboxContainerId,
                        executionCommand,
                        {
                            timeoutMs: subtask.timeoutMs || this.configManager?.get('sandbox.defaultCommandTimeoutMs', 120000),
                            workingDir: path.posix.join('/sandbox_project', subtask.workingDir || '.')
                        }
                    );

                    const { meetsCriteria, evaluationError } = this._evaluateAcceptanceCriteria(subtask, sandboxResult, attemptArtifacts);

                    if (meetsCriteria) {
                        console.log(`[TaskExecutionSystem] Subtask ${subtask.id} completed successfully and met acceptance criteria on attempt ${debugAttempt}.`);
                        this.activeExecutions.set(subtask.id, { status: 'success', result: sandboxResult, artifacts: attemptArtifacts });
                        return { success: true, artifacts: attemptArtifacts, logs: sandboxResult.output, errorOutput: sandboxResult.errorOutput };
                    }

                    lastSandboxError = evaluationError || {
                        message: `Execution failed or did not meet acceptance criteria. Exit Code: ${sandboxResult.exitCode}.`,
                        step: "sandbox_execution/validation",
                        stdout: sandboxResult.output,
                        stderr: sandboxResult.errorOutput,
                    };
                    console.warn(`[TaskExecutionSystem] Attempt ${debugAttempt + 1} for ${subtask.id} failed. Error: ${lastSandboxError.message}`);

                } catch (error) {
                    console.error(`[TaskExecutionSystem] Error during attempt ${debugAttempt + 1} for ${subtask.id}:`, error);
                    lastSandboxError = { message: error.message, stack: error.stack, type: "critical_subtask_error", step: error.step || "unknown_step" };
                } finally {
                    if (sandboxContainerId) {
                        await this.sandboxManager.cleanupContainer(sandboxContainerId, { force: true });
                        sandboxContainerId = null;
                    }
                }

                debugAttempt++;
                if (debugAttempt <= maxDebugAttempts) {
                    console.log(`[TaskExecutionSystem] Retrying subtask ${subtask.id} (Attempt ${debugAttempt + 1})...`);
                }
            }

            const finalError = new Error(`Max debug attempts (${maxDebugAttempts}) reached for subtask ${subtask.id}. Last error: ${lastSandboxError?.message || 'Unknown failure'}`);
            this.activeExecutions.set(subtask.id, { status: 'failed', error: lastSandboxError, finalError });
            throw finalError;

        } finally {
            if (sessionHostDir) {
                await this.sandboxManager.cleanupSessionHostDir(sessionHostDir)
                    .catch(e => console.error(`[TaskExecutionSystem] Error cleaning subtask session dir ${sessionHostDir}: ${e.message}`));
            }
        }
    }

    _getRelevantCodeSnippets(subtask, currentProjectFiles) {
        const relevantSnippets = {};
        (subtask.input_artifacts_needed || []).forEach(artifactPath => {
            if (currentProjectFiles[artifactPath]) {
                relevantSnippets[artifactPath] = currentProjectFiles[artifactPath];
            } else if (typeof artifactPath === 'object' && artifactPath.path && currentProjectFiles[artifactPath.path]) {
                relevantSnippets[artifactPath.path] = currentProjectFiles[artifactPath.path];
            }
        });
        return relevantSnippets;
    }

    _inferLanguage(subtask, currentProjectFiles) {
        if (subtask.expected_artifacts && subtask.expected_artifacts.length > 0) {
            const firstCodeArtifact = subtask.expected_artifacts.find(a => a.type === 'code');
            if (firstCodeArtifact && firstCodeArtifact.path) {
                const ext = path.extname(firstCodeArtifact.path).toLowerCase();
                if (ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx') return 'javascript';
                if (ext === '.py') return 'python';
                if (ext === '.java') return 'java';
                if (ext === '.kt') return 'kotlin';
            }
        }
        return this.configManager?.get('sandbox.defaultLanguage', 'javascript');
    }

    _determineExecutionCommand(subtask, currentArtifacts) {
        if (subtask.execution_command && Array.isArray(subtask.execution_command) && subtask.execution_command.length > 0) {
            return subtask.execution_command;
        }
        if (subtask.type === 'unit_test' && subtask.language === 'javascript') return ['npm', 'test'];
        if (subtask.type === 'lint_code') return ['npx', 'eslint', '.'];

        console.warn(`[TaskExecutionSystem] Could not determine execution command for subtask ${subtask.id}`);
        return null;
    }

    _evaluateAcceptanceCriteria(subtask, sandboxResult, generatedArtifacts) {
        let allCriteriaMet = true;
        let evaluationError = null;

        if (!subtask.success_criteria || subtask.success_criteria.length === 0) {
            if (sandboxResult.exitCode !== 0) {
                allCriteriaMet = false;
                evaluationError = { message: `Default Check: Command failed with exit code ${sandboxResult.exitCode}.`, stderr: sandboxResult.errorOutput };
            }
            return { meetsCriteria: allCriteriaMet, evaluationError };
        }
        
        for (const criterion of subtask.success_criteria) {
            let criterionMet = false;
            if (criterion.toLowerCase().startsWith("exit_code_is_0")) {
                criterionMet = (sandboxResult.exitCode === 0);
                if (!criterionMet) evaluationError = { message: `Criterion '${criterion}' failed. Exit code: ${sandboxResult.exitCode}`, stderr: sandboxResult.errorOutput};
            } else if (criterion.toLowerCase().startsWith("stdout_contains_")) {
                const searchText = criterion.substring("stdout_contains_".length).trim();
                criterionMet = sandboxResult.output.includes(searchText);
                if (!criterionMet) evaluationError = { message: `Criterion '${criterion}' failed. Stdout did not contain '${searchText}'.`, stdout: sandboxResult.output.substring(0,500) };
            } else if (criterion.toLowerCase().startsWith("stderr_is_empty")) {
                criterionMet = (sandboxResult.errorOutput === "");
                if (!criterionMet) evaluationError = { message: `Criterion '${criterion}' failed. Stderr was not empty.`, stderr: sandboxResult.errorOutput.substring(0,500) };
            } else {
                console.warn(`[TaskExecutionSystem] Unknown acceptance criterion: '${criterion}'. Assuming it's met for now.`);
                criterionMet = true;
            }

            if (!criterionMet) {
                allCriteriaMet = false;
                break;
            }
        }
        return { meetsCriteria: allCriteriaMet, evaluationError };
    }
}

export default TaskExecutionSystem;
