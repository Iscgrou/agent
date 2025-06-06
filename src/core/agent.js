// src/core/agent.js
// Represents a specialized AI persona or configuration profile.
// It doesn't execute tasks directly but provides context, specialized prompts,
// and potentially learned knowledge relevant to its role for the TaskExecutionSystem.

class Agent {
    constructor(agentId, agentConfig) {
        this.id = agentId;
        this.role = agentConfig.role; // e.g., "AndroidKotlinExpert", "ReactFrontendDev", "PythonDataScientist"
        this.capabilities = new Set(agentConfig.capabilities || []);
        this.specializedPrompts = agentConfig.specializedPrompts || {};
        this.knowledgeBase = agentConfig.knowledgeBaseRef || new Map();
        
        this.state = {
            status: 'IDLE', // IDLE, CONFIGURING_TASK, AWAITING_EXECUTION_RESULT
            performanceMetrics: {
                tasksCompleted: 0,
                successRate: 0,
                averageExecutionTime: 0,
                lastActivity: null
            }
        };
    }

    async prepareTaskContext(subtask, projectContext) {
        this.state.status = 'CONFIGURING_TASK';
        console.log(`[Agent ${this.id} (${this.role})] Preparing context for task: ${subtask.id}`);

        let personaInstructions = `You are an AI assistant acting as a ${this.role}. `;
        
        // Add role-specific instructions from specialized prompts or learned knowledge
        if (this.specializedPrompts[subtask.type]) {
            personaInstructions += this.specializedPrompts[subtask.type];
        }

        const enrichedContext = {
            ...subtask,
            agentPersona: this.role,
            personaInstructions,
            relevantKnowledge: this.retrieveRelevantKnowledge(subtask),
            roleSpecificPreferences: this.getRolePreferences()
        };

        this.state.status = 'AWAITING_EXECUTION_RESULT';
        return enrichedContext;
    }

    async processTaskResult(subtask, executionResult) {
        console.log(`[Agent ${this.id} (${this.role})] Processing result for task: ${subtask.id}. Success: ${executionResult.success}`);
        
        // Update performance metrics
        this.updatePerformanceMetrics(executionResult);

        if (executionResult.success) {
            await this.learnFromSuccess(subtask, executionResult);
        } else {
            await this.learnFromFailure(subtask, executionResult.error);
        }

        this.state.status = 'IDLE';
        this.state.performanceMetrics.lastActivity = new Date();
    }

    retrieveRelevantKnowledge(subtask) {
        const relevantPatterns = [];
        
        // Search knowledge base for relevant patterns
        for (const [pattern, knowledge] of this.knowledgeBase) {
            if (this.isPatternRelevant(pattern, subtask)) {
                relevantPatterns.push(knowledge);
            }
        }

        return relevantPatterns.length > 0 
            ? { patterns: relevantPatterns } 
            : { message: "No specific prior knowledge found for this task type." };
    }

    getRolePreferences() {
        // Return role-specific preferences for code style, libraries, patterns, etc.
        switch (this.role) {
            case 'ReactFrontendDev':
                return {
                    codeStyle: {
                        useTypeScript: true,
                        preferFunctionalComponents: true,
                        stateManagement: 'hooks',
                    },
                    preferredLibraries: ['react-query', 'styled-components', 'jest'],
                    bestPractices: [
                        'Component composition over inheritance',
                        'Custom hooks for reusable logic',
                        'Proper error boundaries'
                    ]
                };
            case 'AndroidKotlinExpert':
                return {
                    codeStyle: {
                        useCoroutines: true,
                        preferCompose: true,
                        architecturePattern: 'MVVM'
                    },
                    preferredLibraries: ['Jetpack Compose', 'Kotlin Flow', 'Hilt'],
                    bestPractices: [
                        'Clean Architecture principles',
                        'Repository pattern',
                        'Dependency injection'
                    ]
                };
            // Add more role-specific preferences as needed
            default:
                return {
                    codeStyle: {},
                    preferredLibraries: [],
                    bestPractices: []
                };
        }
    }

    async learnFromSuccess(subtask, result) {
        // Extract successful patterns and update knowledge base
        const patterns = this.extractPatterns(subtask, result);
        
        for (const pattern of patterns) {
            const existingKnowledge = this.knowledgeBase.get(pattern.id);
            if (existingKnowledge) {
                existingKnowledge.successCount++;
                existingKnowledge.lastSuccess = new Date();
                existingKnowledge.examples.push({
                    subtask: subtask.id,
                    solution: result.artifacts
                });
            } else {
                this.knowledgeBase.set(pattern.id, {
                    ...pattern,
                    successCount: 1,
                    failureCount: 0,
                    lastSuccess: new Date(),
                    examples: [{
                        subtask: subtask.id,
                        solution: result.artifacts
                    }]
                });
            }
        }
    }

    async learnFromFailure(subtask, error) {
        // Update knowledge base with failure patterns
        const failurePattern = this.createFailurePattern(subtask, error);
        const existingPattern = this.knowledgeBase.get(failurePattern.id);

        if (existingPattern) {
            existingPattern.failureCount++;
            existingPattern.lastFailure = new Date();
            existingPattern.errors.push({
                subtask: subtask.id,
                error: error
            });
        } else {
            this.knowledgeBase.set(failurePattern.id, {
                ...failurePattern,
                successCount: 0,
                failureCount: 1,
                lastFailure: new Date(),
                errors: [{
                    subtask: subtask.id,
                    error: error
                }]
            });
        }
    }

    updatePerformanceMetrics(executionResult) {
        const metrics = this.state.performanceMetrics;
        metrics.tasksCompleted++;
        
        // Update success rate
        const successCount = metrics.tasksCompleted * metrics.successRate;
        metrics.successRate = executionResult.success 
            ? (successCount + 1) / metrics.tasksCompleted
            : successCount / metrics.tasksCompleted;

        // Update average execution time
        if (executionResult.executionTime) {
            metrics.averageExecutionTime = 
                (metrics.averageExecutionTime * (metrics.tasksCompleted - 1) + 
                 executionResult.executionTime) / metrics.tasksCompleted;
        }
    }

    isPatternRelevant(pattern, subtask) {
        // Implement pattern matching logic
        return pattern.type === subtask.type || 
               pattern.technologies?.some(tech => subtask.technologies?.includes(tech));
    }

    extractPatterns(subtask, result) {
        // Extract patterns from successful execution
        return [{
            id: `pattern_${Date.now()}`,
            type: subtask.type,
            technologies: subtask.technologies,
            complexity: subtask.complexity,
            solution: result.artifacts
        }];
    }

    createFailurePattern(subtask, error) {
        return {
            id: `failure_pattern_${Date.now()}`,
            type: subtask.type,
            technologies: subtask.technologies,
            errorType: error.type || 'unknown',
            errorMessage: error.message
        };
    }
}

// Export the Agent class
export default Agent;
