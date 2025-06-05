// src/core/agent-coordination.js
import { VertexAIChatModel, VertexAIError } from './vertexAI-client.js';
import {
    generateRequestUnderstandingPrompt,
    generateProjectPlanningPrompt,
    generateTaskBreakdownPrompt,
    generateRepoLevelAnalysisPrompt,
    generateFileLevelAnalysisPrompt,
    generateDependencyAnalysisPrompt
} from './prompt-templates.js';
import {
    generateReplanUnderstandingPrompt,
    generateReplanningPrompt,
    generateReplanSubtasksPrompt
} from './prompt-templates-replan.js';
import { SandboxManager, SandboxError } from './sandbox-manager.js';
import { ProjectPersistence, ProjectNotFoundError } from './project-persistence.js';
import { PlatformError, CoordinationError } from './error-utils.js';
import path from 'path';

/**
 * Coordinates AI agent activities including repository analysis, request understanding, and task breakdown.
 */
class AgentCoordinator {
    /**
     * Creates a new AgentCoordinator instance.
     * @param {object} vertexAIChatConfig - Configuration for VertexAI chat model
     * @param {ProjectPersistence} projectPersistence - Project persistence manager
     * @param {SandboxManager} sandboxManager - Sandbox environment manager
     * @param {ConfigManager} configManager - Configuration manager
     * @param {LearningSystem} learningSystem - Learning system for experience logging
     */
    constructor(vertexAIChatConfig, projectPersistence, sandboxManager, configManager, learningSystem) {
        this.chatModel = new VertexAIChatModel(vertexAIChatConfig);
        this.projectPersistence = projectPersistence;
        this.sandboxManager = sandboxManager;
        this.configManager = configManager;
        this.learningSystem = learningSystem;
        this.systemState = {};
        console.log('[AgentCoordinator] Initialized with SandboxManager, ConfigManager and LearningSystem.');
    }

    /**
     * Parses and validates JSON responses from the LLM.
     * @param {string} llmResponseText - Raw response text from the LLM
     * @param {string} operationName - Name of the operation for error context
     * @returns {object} Parsed JSON object
     * @throws {PlatformError} When JSON parsing fails or response is invalid
     * @private
     */
    _parseLLMJsonResponse(llmResponseText, operationName) {
        try {
            const match = llmResponseText.match(/```json\s*([\s\S]*?)\s*```/);
            const jsonStringToParse = match ? match[1] : llmResponseText;
            const parsed = JSON.parse(jsonStringToParse);

            if (parsed.error && !operationName?.toLowerCase().includes('error_expected')) {
                console.warn(`[AgentCoordinator] AI returned an error object for ${operationName}:`, parsed.error);
            }
            return parsed;
        } catch (e) {
            const errDetail = `LLM response for ${operationName} was not valid JSON. Original error: ${e.message}. Response snippet: ${(llmResponseText || '').substring(0, 500)}...`;
            console.error(`[AgentCoordinator] ${errDetail}`);
            throw new PlatformError(errDetail, 'AI_RESPONSE_PARSE_ERROR', { operationName, responseText: llmResponseText }, e, 'CRITICAL');
        }
    }

    /**
     * Makes an AI call with retry logic and error handling.
     * @param {Function} promptGeneratorFunction - Function that generates the prompt
     * @param {object} context - Context data for prompt generation
     * @param {string} operationName - Name of the operation for logging and error handling
     * @param {object} [modelOptions={}] - Options for the AI model
     * @param {number} [maxRetries=2] - Maximum number of retry attempts
     * @returns {Promise<object>} Parsed response from the AI
     * @throws {PlatformError} When max retries are exceeded or critical errors occur
     * @private
     */
    async _callAIWithRetry(promptGeneratorFunction, context, operationName, modelOptions = {}, maxRetries = 2) {
        const prompt = promptGeneratorFunction(context);
        let attempts = 0;
        let lastError;

        while (attempts <= maxRetries) {
            const startTime = Date.now();
            try {
                console.log(`[AgentCoordinator] Calling AI for ${operationName}, attempt ${attempts + 1}`);
                const llmResponse = await this.chatModel.generateText(prompt, modelOptions);

                // Log AI prompt execution experience
                if (this.learningSystem) {
                    await this.learningSystem.logExperience({
                        type: 'AI_PROMPT_EXECUTION',
                        context: {
                            projectName: context.projectName,
                            requestId: context.requestId,
                            promptId: operationName,
                            promptHash: prompt.substring(0, 100), // Simple truncation as hash
                            modelName: this.chatModel.modelName || 'vertex-ai',
                            modelParametersUsed: modelOptions
                        },
                        outcome: {
                            status: 'SUCCESS',
                            durationMs: Date.now() - startTime,
                            metrics: {
                                tokensUsed: {
                                    input: prompt.length / 4, // Rough estimation
                                    output: llmResponse.length / 4,
                                    total: (prompt.length + llmResponse.length) / 4
                                }
                            }
                        }
                    }).catch(err => console.warn('[AgentCoordinator] Failed to log AI experience:', err));
                }
                const parsedResponse = this._parseLLMJsonResponse(llmResponse, operationName);

                if (parsedResponse.error && parsedResponse.clarification_needed && attempts < maxRetries) {
                    lastError = new PlatformError(`AI requires clarification for ${operationName}: ${parsedResponse.error}`, 'AI_CLARIFICATION_NEEDED', parsedResponse, null, 'RECOVERABLE_WITH_MODIFICATION');
                    console.warn(`[AgentCoordinator] ${lastError.message}`);
                    attempts++;
                    if (attempts > maxRetries) throw lastError;
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
                    continue;
                }
                return parsedResponse;
            } catch (error) {
                lastError = error;
                console.warn(`[AgentCoordinator] Attempt ${attempts + 1} for ${operationName} failed directly: ${error.message}`);

                // Log failed AI prompt execution
                if (this.learningSystem) {
                    await this.learningSystem.logExperience({
                        type: 'AI_PROMPT_EXECUTION',
                        context: {
                            projectName: context.projectName,
                            requestId: context.requestId,
                            promptId: operationName,
                            promptHash: prompt.substring(0, 100),
                            modelName: this.chatModel.modelName || 'vertex-ai',
                            modelParametersUsed: modelOptions
                        },
                        outcome: {
                            status: 'FAILURE',
                            durationMs: Date.now() - startTime,
                            error: {
                                code: error.code || 'UNKNOWN_ERROR',
                                message: error.message,
                                severity: error.severity || 'UNKNOWN',
                                stackPreview: error.stack?.split('\n').slice(0, 3).join('\n')
                            }
                        }
                    }).catch(err => console.warn('[AgentCoordinator] Failed to log AI error experience:', err));
                }

                attempts++;
                if (attempts > maxRetries || !(error instanceof PlatformError && error.severity === 'RETRYABLE_TRANSIENT')) {
                    throw lastError;
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * attempts * 2));
            }
        }
        throw lastError || new PlatformError(`Max retries reached for ${operationName} without specific error.`, 'MAX_RETRIES_EXCEEDED', {operationName}, null, 'CRITICAL');
    }

    /**
     * Analyzes a cloned repository to understand its structure, dependencies, and potential modification points.
     * @param {string} projectName - Name of the project being analyzed
     * @param {string} userModificationRequest - The user's original modification request to guide analysis
     * @param {string} clonedRepoContainerPath - Path to the cloned repository within the container
     * @param {string} repoContainerId - ID of the container holding the cloned repository
     * @param {string[]} [manifestFilePathsToAnalyze=[]] - Optional specific manifest files to analyze
     * @returns {Promise<{
     *   repositoryOverview: {
     *     mainLanguages: string[],
     *     frameworksAndLibraries: string[],
     *     buildSystemAndTools: string[],
     *     architecturalPatternGuess: string,
     *     potentialEntryPoints: string[],
     *     keyComponentsOrModules: string[]
     *   },
     *   modificationContext: {
     *     relevantFiles: Array<{
     *       path: string,
     *       purpose: string,
     *       suggestedModifications: string[]
     *     }>,
     *     dependencies: {
     *       runtime: string[],
     *       development: string[],
     *       peer: string[]
     *     },
     *     environmentSetup: {
     *       requiredTools: string[],
     *       buildCommands: string[],
     *       testCommands: string[]
     *     }
     *   },
     *   understandingSummaryForModification: string
     * }>}
     * @throws {PlatformError} When repository analysis fails
     * @private
     */
    async _analyzeClonedRepository(projectName, userModificationRequest, clonedRepoContainerPath, repoContainerId, manifestFilePathsToAnalyze = []) {
        console.log(`[AgentCoordinator] Starting repository analysis for ${projectName} in container ${repoContainerId} at ${clonedRepoContainerPath}`);
        const analysisResult = {
            repositoryOverview: { mainLanguages: [], frameworksAndLibraries:[], buildSystemAndTools:[], architecturalPatternGuess: 'Undetermined', potentialEntryPoints:[], keyComponentsOrModules:[] },
            modificationContext: { relevantFiles: [], dependencies: { runtime: [], development: [], peer: [] }, environmentSetup: { requiredTools: [], buildCommands: [], testCommands: [] } },
        };

        let identifiedManifests = [];
        if (manifestFilePathsToAnalyze.length > 0) {
            for (const mfRelativePath of manifestFilePathsToAnalyze) {
                try {
                    const fullPath = path.posix.join(clonedRepoContainerPath, mfRelativePath);
                    const content = await this.sandboxManager.readRepositoryFile(repoContainerId, fullPath);
                    identifiedManifests.push({ path: mfRelativePath, content, type: path.basename(mfRelativePath) });
                } catch (e) {
                    console.warn(`[AgentCoordinator] Could not read specified manifest ${mfRelativePath}: ${e.message}`);
                }
            }
        } else {
            const commonManifestNames = ['package.json', 'pom.xml', 'build.gradle', 'requirements.txt', 'Gemfile', 'composer.json', 'pyproject.toml'];
            const allFilesFlat = await this.sandboxManager.listRepositoryFiles(repoContainerId, clonedRepoContainerPath, { recursive: true })
                .catch(e => { console.warn(`[AgentCoordinator] Error listing files for manifest search: ${e.message}`); return []; });
            for (const mfName of commonManifestNames) {
                const found = allFilesFlat.find(f => f.endsWith(mfName) && !f.includes('node_modules') && !f.includes('vendor') && !f.includes('target') && !f.includes('build/'));
                if (found) {
                    try {
                        const content = await this.sandboxManager.readRepositoryFile(repoContainerId, path.posix.join(clonedRepoContainerPath, found));
                        identifiedManifests.push({ path: found, content, type: mfName });
                        console.log(`[AgentCoordinator] Automatically found and read manifest: ${found}`);
                        break;
                    } catch (e) {
                        console.warn(`[AgentCoordinator] Could not read automatically found manifest ${found}: ${e.message}`);
                    }
                }
            }
        }
        
        let dependencyAnalysis = { mainLanguageOrPlatform: null, buildConfiguration: { buildToolsAndPlugins: [], keyScriptsOrGoals: {}}, otherExtractedInfo: {}, dependencies: { runtime:[], development:[], peer:[] } };
        if (identifiedManifests.length > 0) {
            const primaryManifest = identifiedManifests[0];
            try {
                dependencyAnalysis = await this._callAIWithRetry(
                    generateDependencyAnalysisPrompt,
                    { manifestContent: primaryManifest.content, manifestType: primaryManifest.type },
                    `dependency_analysis_${primaryManifest.type.replace(/[^a-zA-Z0-9]/g, '_')}`
                );
                analysisResult.repositoryOverview.mainLanguages = [dependencyAnalysis.mainLanguageOrPlatform].filter(Boolean);
                analysisResult.repositoryOverview.buildSystemAndTools = dependencyAnalysis.buildConfiguration?.buildToolsAndPlugins || [];
                analysisResult.modificationContext.dependencies = dependencyAnalysis.dependencies || { runtime: [], development: [], peer: [] };
                const envSetup = analysisResult.modificationContext.environmentSetup;
                envSetup.requiredTools = dependencyAnalysis.buildConfiguration?.buildToolsAndPlugins || [];
                const scripts = dependencyAnalysis.buildConfiguration?.keyScriptsOrGoals || {};
                envSetup.buildCommands = scripts.build? [scripts.build] : [];
                envSetup.testCommands = scripts.test? [scripts.test] : [];
            } catch (depError) {
                console.error(`[AgentCoordinator] Dependency analysis for ${primaryManifest.path} failed: ${depError.message}`);
                analysisResult.repositoryOverview.mainLanguages = ["Error in dep analysis"];
            }
        } else {
            console.warn("[AgentCoordinator] No manifest files found or specified for dependency analysis.");
        }

        let dirStructureString = "Directory structure listing failed or not available.";
        try {
            const filesForStructure = await this.sandboxManager.listRepositoryFiles(repoContainerId, clonedRepoContainerPath, { recursive: true });
            const structureSample = filesForStructure.slice(0, 50);
            dirStructureString = `Sample of files/directories (up to 50):\n${structureSample.join('\n')}`;
        } catch(e) {
            console.warn(`[AgentCoordinator] Error getting detailed directory structure: ${e.message}`);
        }

        const repoLevelContext = {
            manifestFiles: identifiedManifests.map(mf => ({ path: mf.path, content: mf.content, type: mf.type })),
            directoryStructure: dirStructureString,
            userModificationRequest,
            entryPointHints: [dependencyAnalysis.otherExtractedInfo?.main_entry_file_guess].filter(Boolean)
        };
        
        let repoOverviewAI = {};
        try {
            repoOverviewAI = await this._callAIWithRetry(generateRepoLevelAnalysisPrompt, repoLevelContext, 'repo_level_analysis');
        } catch (repoLevelError) {
            console.error(`[AgentCoordinator] Repository level AI analysis failed: ${repoLevelError.message}`);
            repoOverviewAI = {
                mainLanguages: ["Analysis Failed"],
                frameworksAndLibraries: [],
                architecturalPatternGuess: "Undetermined",
                potentialEntryPoints: [],
                initialAnalysisForModification: { suggestedFilesToInspectFurtherForModification: [] }
            };
        }

        analysisResult.repositoryOverview = {
            ...analysisResult.repositoryOverview,
            mainLanguages: [...new Set([...(analysisResult.repositoryOverview.mainLanguages || []), ...(repoOverviewAI.mainLanguages || [])])].filter(Boolean),
            frameworksAndLibraries: repoOverviewAI.frameworksAndLibraries || [],
            buildSystemAndTools: [...new Set([...(analysisResult.repositoryOverview.buildSystemAndTools || []), ...(repoOverviewAI.buildSystemAndTools || [])])].filter(Boolean),
            architecture: repoOverviewAI.architecturalPatternGuess || 'Undetermined',
            potentialEntryPoints: repoOverviewAI.potentialEntryPoints || [],
            keyComponentsOrModules: repoOverviewAI.keyComponentsOrModules || [],
        };
        analysisResult.understandingSummaryForModification = repoOverviewAI.initialAnalysisForModification?.understandingOfUserRequest || "Could not determine user request understanding from repo analysis.";
        
        const filesToAnalyzeFurther = repoOverviewAI.initialAnalysisForModification?.suggestedFilesToInspectFurtherForModification || [];
        analysisResult.modificationContext.relevantFiles = [];
        const maxFilesToAnalyze = this.configManager?.get('repositoryAnalysis.maxFilesToAnalyzeDeeply', 3) || 3;

        for (const relFilePath of filesToAnalyzeFurther.slice(0, maxFilesToAnalyze)) {
            try {
                const fullFilePathInContainer = path.posix.join(clonedRepoContainerPath, relFilePath);
                if (!fullFilePathInContainer.startsWith(clonedRepoContainerPath)) {
                    console.warn(`[AgentCoordinator] AI suggested path '${relFilePath}' is outside repo bounds. Skipping.`);
                    continue;
                }
                const fileContent = await this.sandboxManager.readRepositoryFile(repoContainerId, fullFilePathInContainer);
                const fileAnalysis = await this._callAIWithRetry(
                    generateFileLevelAnalysisPrompt,
                    {
                        filePath: relFilePath,
                        fileContent,
                        fileType: path.extname(relFilePath).substring(1) || null,
                        modificationGoalFromUser: userModificationRequest,
                        repositoryContextOverview: analysisResult.repositoryOverview,
                        focusOnModificationPoints: true
                    },
                    `file_analysis_${relFilePath.replace(/[^a-zA-Z0-9]/g, '_')}`
                );

                analysisResult.modificationContext.relevantFiles.push({
                    path: relFilePath,
                    purpose: fileAnalysis.primaryPurposeSummary || "Purpose not determined.",
                    suggestedModifications: (fileAnalysis.relevanceToUserModificationGoal?.specificModificationSuggestions || [])
                        .map(s => `At "${s.locationInFile}": ${s.detailedChangeDescription} (Change type: ${s.suggestedChangeType})`)
                });
            } catch (fileAnalysisError) {
                console.warn(`[AgentCoordinator] Error analyzing file ${relFilePath}: ${fileAnalysisError.message}`);
                analysisResult.modificationContext.relevantFiles.push({
                    path: relFilePath,
                    purpose: "File analysis failed.",
                    suggestedModifications: [`Error during analysis: ${fileAnalysisError.message}`]
                });
            }
        }
        console.log(`[AgentCoordinator] Repository analysis for ${projectName} completed. Analyzed ${analysisResult.modificationContext.relevantFiles.length} files in detail.`);
        return analysisResult;
    }

    /**
     * Analyzes and understands a user's request, optionally incorporating repository analysis.
     * @param {string} userInput - The natural language request from the user
     * @param {string} projectName - Name of the project for context/persistence
     * @param {object} initialProjectContextData - Initial context data including repository information
     * @param {string} [initialProjectContextData.repositoryUrl] - URL of the repository to analyze
     * @param {boolean} [initialProjectContextData.performRepoAnalysis] - Whether to perform repository analysis
     * @param {string} [initialProjectContextData.branch] - Branch to analyze
     * @param {object} [initialProjectContextData.auth] - Authentication details for repository access
     * @param {string[]} [initialProjectContextData.manifestFilePathsToAnalyze] - Specific manifest files to analyze
     * @param {object} [initialProjectContextData.context] - Additional context data
     * @returns {Promise<{
     *   parsed_intent: string,
     *   required_skills: string[],
     *   complexity_assessment: string,
     *   repositoryAnalysisData?: object,
     *   error?: string,
     *   clarification_needed?: string[]
     * }>}
     * @throws {PlatformError} When request understanding fails
     */
    async understandRequest(userInput, projectName, initialProjectContextData = {}) {
        console.log(`[AgentCoordinator] understandRequest called for project "${projectName || 'new project'}"`);
        let enrichedRepositoryAnalysis = null;
        let repoAnalysisSessionInfo = null;

        const repoUrl = initialProjectContextData?.repositoryUrl;
        const performRepoAnalysis = initialProjectContextData?.performRepoAnalysis;

        if (repoUrl && performRepoAnalysis) {
            console.log(`[AgentCoordinator] Repository URL provided: ${repoUrl}. Initiating clone and analysis.`);
            try {
                repoAnalysisSessionInfo = await this.sandboxManager.cloneRepository(
                    repoUrl,
                    {
                        branch: initialProjectContextData.branch,
                        auth: initialProjectContextData.auth,
                        cloneDepth: '10'
                    }
                );

                enrichedRepositoryAnalysis = await this._analyzeClonedRepository(
                    projectName || path.basename(repoUrl, '.git'),
                    userInput,
                    repoAnalysisSessionInfo.repoContainerPath,
                    repoAnalysisSessionInfo.containerId,
                    initialProjectContextData.manifestFilePathsToAnalyze
                );
            } catch (repoError) {
                const wrappedError = (repoError instanceof PlatformError) ? repoError :
                    new PlatformError(
                        `Repository processing failed for ${repoUrl}: ${repoError.message}`,
                        'REPO_PROCESSING_FAILED',
                        { repositoryUrl: repoUrl, stage: 'clone_or_initial_analysis' },
                        repoError,
                        'CRITICAL'
                    );
                console.error(`[AgentCoordinator] ${wrappedError.message}`);
                enrichedRepositoryAnalysis = { error: wrappedError };
            } finally {
                if (repoAnalysisSessionInfo?.newContainerCreated && repoAnalysisSessionInfo.containerId) {
                    await this.sandboxManager.cleanupContainer(repoAnalysisSessionInfo.containerId, { force: true })
                        .catch(e => console.error(`[AgentCoordinator] Error cleaning analysis container ${repoAnalysisSessionInfo.containerId}: ${e.message}`));
                }
                if (repoAnalysisSessionInfo?.newSessionDirCreated && repoAnalysisSessionInfo.sessionHostDir) {
                    await this.sandboxManager.cleanupSessionHostDir(repoAnalysisSessionInfo.sessionHostDir)
                        .catch(e => console.error(`[AgentCoordinator] Error cleaning analysis session dir ${repoAnalysisSessionInfo.sessionHostDir}: ${e.message}`));
                }
            }
        }

        const standardUnderstandingContext = {
            userInput,
            projectContext: {
                ...(initialProjectContextData.context || {}),
                repositoryAnalysisSummary: enrichedRepositoryAnalysis && !enrichedRepositoryAnalysis.error ? {
                    overview: enrichedRepositoryAnalysis.repositoryOverview,
                    modificationFocus: (enrichedRepositoryAnalysis.modificationContext?.relevantFiles || []).map(f => f.path),
                    understandingSummaryForModification: enrichedRepositoryAnalysis.understandingSummaryForModification
                } : null,
                repositoryAnalysisError: enrichedRepositoryAnalysis?.error ? {
                    message: enrichedRepositoryAnalysis.error.message,
                    code: enrichedRepositoryAnalysis.error.code
                } : null
            },
        };

        const standardUnderstanding = await this._callAIWithRetry(
            generateRequestUnderstandingPrompt,
            standardUnderstandingContext,
            'request_understanding_phase'
        );
        
        const finalUnderstanding = {
            ...standardUnderstanding,
            repositoryAnalysisData: enrichedRepositoryAnalysis && !enrichedRepositoryAnalysis.error ? enrichedRepositoryAnalysis : null,
            error: standardUnderstanding.error || enrichedRepositoryAnalysis?.error?.message 
                ? (standardUnderstanding.error || `Repo Analysis: ${enrichedRepositoryAnalysis.error.message}`) 
                : null,
            clarification_needed: standardUnderstanding.clarification_needed || (enrichedRepositoryAnalysis?.error ? [`Failed to fully analyze repository: ${enrichedRepositoryAnalysis.error.message}`] : [])
        };
        
        if (finalUnderstanding.error && !finalUnderstanding.clarification_needed) {
            throw new PlatformError(
                `AI understanding failed: ${finalUnderstanding.error}`,
                'AI_UNDERSTANDING_ERROR',
                { ...finalUnderstanding, userInput },
                null,
                'CRITICAL'
            );
        }

        console.log(`[AgentCoordinator] Final understanding complete for "${projectName || 'new project'}". Intent: ${finalUnderstanding.parsed_intent}`);
        return finalUnderstanding;
    }

    /**
     * Develops a strategic plan based on the structured understanding of the request.
     * @param {object} structuredUnderstanding - The structured understanding from request analysis
     * @param {string} projectName - Name of the project for context
     * @returns {Promise<{
     *   project_title: string,
     *   high_level_steps: string[],
     *   estimated_time?: string,
     *   error?: string,
     *   clarification_needed?: string[]
     * }>}
     * @throws {PlatformError} When planning fails
     */
    async developStrategicPlan(structuredUnderstanding, projectName) {
        console.log(`[AgentCoordinator] Developing strategic plan for intent: ${structuredUnderstanding.parsed_intent}`);
        const context = { structuredUnderstanding };
        const strategicPlan = await this._callAIWithRetry(generateProjectPlanningPrompt, context, 'project_planning_phase');
        
        if (strategicPlan.error && !strategicPlan.clarification_needed) {
            throw new PlatformError(`AI planning failed: ${strategicPlan.error}`, 'AI_PLANNING_ERROR', strategicPlan, null, 'CRITICAL');
        }
        console.log(`[AgentCoordinator] Strategic plan developed: ${strategicPlan.project_title}`);
        return strategicPlan;
    }

    /**
     * Breaks down the strategic plan into detailed, actionable subtasks.
     * @param {object} strategicPlan - The strategic plan to break down
     * @param {object} structuredUnderstanding - Original request understanding for context
     * @param {string} projectName - Name of the project
     * @returns {Promise<Array<{
     *   id: string,
     *   title: string,
     *   description: string,
     *   dependencies: string[],
     *   assigned_persona: string,
     *   expected_artifacts: Array<{
     *     type: 'code' | 'config' | 'documentation',
     *     path: string,
     *     description: string
     *   }>,
     *   success_criteria: string[],
     *   estimated_complexity: 'low' | 'medium' | 'high'
     * }>>}
     * @throws {PlatformError} When task breakdown fails
     */
    async breakdownPlanIntoSubtasks(strategicPlan, structuredUnderstanding, projectName) {
        console.log(`[AgentCoordinator] Breaking down plan: ${strategicPlan.project_title}`);
        const context = { projectPlan: strategicPlan, structuredUnderstanding };
        const subtasks = await this._callAIWithRetry(generateTaskBreakdownPrompt, context, 'task_breakdown_phase');

        if (!Array.isArray(subtasks) || (subtasks.length > 0 && (!subtasks[0] || !subtasks[0].id || !subtasks[0].title))) {
            if (typeof subtasks === 'object' && subtasks !== null && subtasks.error) {
                throw new PlatformError(`AI failed to breakdown tasks: ${subtasks.error}`, 'AI_SUBTASK_ERROR_FROM_AI', {response: subtasks}, null, 'CRITICAL');
            }
            console.error("[AgentCoordinator] AI returned an invalid subtask list structure:", subtasks?.[0] || "Empty/Invalid Array");
            throw new PlatformError("AI failed to generate a valid list of subtasks.", 'AI_SUBTASK_FORMAT_ERROR', {response: (typeof subtasks === 'object' ? JSON.stringify(subtasks).substring(0,200) : String(subtasks).substring(0,200)) }, null, 'CRITICAL');
        }
        console.log(`[AgentCoordinator] Plan broken down into ${subtasks.length} sub-tasks.`);
        return subtasks;
    }

    /**
     * Orchestrates a re-planning analysis after a failure.
     * @param {string} projectName - Name of the project
     * @param {object} failureContext - Context about the failure
     * @param {string} failureContext.errorClassification - Type of error encountered
     * @param {string} failureContext.failedSubtaskId - ID of failed subtask
     * @param {string} failureContext.replanReason - Reason for re-planning
     * @param {object} failureContext.previousPlan - Previous project plan
     * @param {object} failureContext.previousUnderstanding - Previous understanding
     * @param {string} failureContext.checkpointId - ID of last good state
     * @param {object} options - Re-planning options
     * @param {boolean} [options.forceFullReplan=false] - Force a complete re-plan
     * @param {boolean} [options.preserveSuccessfulTasks=true] - Try to preserve successful work
     * @returns {Promise<{understanding: object, plan: object, subtasks: Array<object>}>}
     * @throws {PlatformError} When re-planning fails
     */
    async orchestrateReplanningAnalysis(projectName, failureContext, options = {}) {
        console.log(`[AgentCoordinator] Starting re-planning analysis for ${projectName} due to ${failureContext.errorClassification}`);

        const {
            previousPlan,
            previousUnderstanding,
            checkpointId
        } = failureContext;

        // Load project state from checkpoint if available
        let projectState = null;
        if (checkpointId && this.projectPersistence) {
            try {
                projectState = await this.projectPersistence.loadProjectCheckpoint(projectName, checkpointId);
                console.log(`[AgentCoordinator] Loaded project state from checkpoint ${checkpointId}`);
            } catch (error) {
                console.warn(`[AgentCoordinator] Failed to load checkpoint ${checkpointId}: ${error.message}`);
            }
        }

        // Get list of successful tasks
        const successfulTaskIds = projectState?.successfulTasks || 
            previousPlan?.subtasks?.filter(t => t.status === 'completed')?.map(t => t.id) || [];

        // Re-evaluate understanding with failure context
        const revisedUnderstanding = await this._callAIWithRetry(
            generateReplanUnderstandingPrompt,
            {
                userInput: previousUnderstanding.original_request,
                failureContext,
                previousUnderstanding,
                successfulTaskIds
            },
            'replan_understanding_phase'
        );

        // Generate new plan based on revised understanding
        const revisedPlan = await this._callAIWithRetry(
            generateReplanningPrompt,
            {
                revisedUnderstanding,
                previousPlan,
                failureContext,
                successfulTasks: projectState?.successfulTasks || []
            },
            'replan_planning_phase'
        );

        // Break down into new subtasks
        const revisedSubtasks = await this._callAIWithRetry(
            generateReplanSubtasksPrompt,
            {
                revisedPlan,
                failureContext,
                previousSubtasks: previousPlan.subtasks,
                successfulTaskIds
            },
            'replan_task_breakdown_phase'
        );

        // Validate the new plan
        if (!Array.isArray(revisedSubtasks) || revisedSubtasks.length === 0) {
            throw new PlatformError(
                'Re-planning failed to generate valid subtasks',
                'REPLAN_INVALID_SUBTASKS',
                { projectName, failureContext },
                null,
                'CRITICAL'
            );
        }

        // Store the re-plan attempt if persistence is available
        if (this.projectPersistence) {
            try {
                await this.projectPersistence.storeReplanAttempt(projectName, {
                    timestamp: new Date().toISOString(),
                    failureContext,
                    revisedUnderstanding,
                    revisedPlan,
                    revisedSubtasks
                });
            } catch (error) {
                console.warn(`[AgentCoordinator] Failed to store re-plan attempt: ${error.message}`);
            }
        }

        return {
            understanding: revisedUnderstanding,
            plan: revisedPlan,
            subtasks: revisedSubtasks
        };
    }

    async orchestrateFullAnalysis(userInput, projectName, initialProjectContextData = {}) {
        console.log(`[AgentCoordinator] Orchestrating full analysis for project: ${projectName}`);

        // Check if this is a re-planning attempt
        if (initialProjectContextData.isReplanAttempt && initialProjectContextData.failureContext) {
            console.log(`[AgentCoordinator] This is a re-planning attempt for ${projectName}`);
            return this.orchestrateReplanningAnalysis(
                projectName,
                initialProjectContextData.failureContext,
                {
                    forceFullReplan: initialProjectContextData.forceFullReplan,
                    preserveSuccessfulTasks: initialProjectContextData.preserveSuccessfulTasks !== false
                }
            );
        }

        const pState = {
            understanding: null,
            plan: null,
            subtasks: []
        };

        const repoRelatedOptions = {
            repositoryUrl: initialProjectContextData.repositoryUrl,
            performRepoAnalysis: initialProjectContextData.performRepoAnalysis,
            branch: initialProjectContextData.branch,
            auth: initialProjectContextData.auth,
            manifestFilePathsToAnalyze: initialProjectContextData.manifestFilePathsToAnalyze,
            context: initialProjectContextData.context,
            forceReprocessUnderstanding: initialProjectContextData.forceReprocessUnderstanding,
        };

        pState.understanding = await this.understandRequest(userInput, projectName, repoRelatedOptions);

        if (pState.understanding.clarification_needed && pState.understanding.clarification_needed.length > 0) {
            console.warn(`[AgentCoordinator] AI understanding for ${projectName} requires clarification: ${pState.understanding.clarification_needed.join('; ')}`);
        }

        pState.plan = await this.developStrategicPlan(pState.understanding, projectName);
        pState.subtasks = await this.breakdownPlanIntoSubtasks(pState.plan, pState.understanding, projectName);

        console.log(`[AgentCoordinator] Full analysis orchestration complete for ${projectName}. Understanding, Plan, and Subtasks generated.`);
        return pState;
    }
}

export default AgentCoordinator;
