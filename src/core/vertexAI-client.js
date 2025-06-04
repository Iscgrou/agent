// Vertex AI Client Implementation
// Handles interaction with Google Cloud's Vertex AI APIs for Chat and Code models

import { VertexAI } from '@google-cloud/vertexai';

import { PlatformError } from './error-utils.js';

/**
 * Custom error class for Vertex AI related errors
 * Extends PlatformError to integrate with the platform's error handling system
 */
class VertexAIError extends PlatformError {
    constructor(message, code = 'VERTEX_AI_GENERIC', context = {}, originalError = null, severity = 'CRITICAL') {
        super(message, code, context, originalError, severity);
        // PlatformError constructor handles name setting via this.constructor.name
        this.timestamp = new Date().toISOString();
    }
}

/**
 * Base class for Vertex AI model interactions
 * Handles common functionality like authentication, error handling, and logging
 */
class VertexAIBaseModel {
    constructor(config) {
        this.validateConfig(config);
        
        this.projectId = config.projectId;
        this.location = config.location || 'us-central1';
        this.credentials = this.loadCredentials(config);
        
        this.retryConfig = {
            maxRetries: config.maxRetries || 3,
            initialDelayMs: config.initialDelayMs || 1000,
            maxDelayMs: config.maxDelayMs || 10000
        };
        
        this.vertexai = new VertexAI({
            project: this.projectId,
            location: this.location,
            credentials: this.credentials
        });

        this.requestCount = 0;
        this.lastRequestTime = null;
    }

    /**
     * Validates the configuration object
     * @param {Object} config - Configuration object
     * @throws {VertexAIError} If configuration is invalid
     */
    validateConfig(config) {
        if (!config) {
            throw new VertexAIError(
                'Configuration object is required',
                'INVALID_CONFIG'
            );
        }

        if (!config.projectId) {
            throw new VertexAIError(
                'Project ID is required',
                'INVALID_CONFIG'
            );
        }

        // Validate credentials are provided either directly or via environment
        if (!config.credentials && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            throw new VertexAIError(
                'Credentials must be provided either in config or via GOOGLE_APPLICATION_CREDENTIALS',
                'MISSING_CREDENTIALS'
            );
        }
    }

    /**
     * Loads and validates credentials
     * @param {Object} config - Configuration object
     * @returns {Object} Credentials object
     * @throws {VertexAIError} If credentials are invalid
     */
    loadCredentials(config) {
        try {
            if (config.credentials) {
                return config.credentials;
            }
            
            // If no direct credentials, rely on environment variable
            if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
                return require(process.env.GOOGLE_APPLICATION_CREDENTIALS);
            }
            
            throw new VertexAIError(
                'No valid credentials found',
                'INVALID_CREDENTIALS'
            );
        } catch (error) {
            throw new VertexAIError(
                'Failed to load credentials',
                'CREDENTIAL_LOAD_ERROR',
                {},
                error
            );
        }
    }

    /**
     * Implements exponential backoff retry logic
     * @param {Function} operation - Async operation to retry
     * @param {string} context - Operation context for error handling
     * @returns {Promise} Operation result
     * @throws {VertexAIError} If all retries fail
     */
    async withRetry(operation, context) {
        let lastError = null;
        let delay = this.retryConfig.initialDelayMs;

        for (let attempt = 1; attempt <= this.retryConfig.maxRetries; attempt++) {
            try {
                this.logRequest(context, attempt);
                const result = await operation();
                this.logSuccess(context, attempt);
                return result;
            } catch (error) {
                lastError = error;
                if (!this.isRetryableError(error)) {
                    throw this.wrapError(error, context);
                }
                if (attempt < this.retryConfig.maxRetries) {
                    await this.delay(delay);
                    delay = Math.min(delay * 2, this.retryConfig.maxDelayMs);
                }
            }
        }

        throw this.wrapError(lastError, context, this.retryConfig.maxRetries);
    }

    /**
     * Determines if an error should trigger a retry
     * @param {Error} error - The error to check
     * @returns {boolean} True if the error is retryable
     */
    isRetryableError(error) {
        const retryableCodes = [
            'RESOURCE_EXHAUSTED',
            'UNAVAILABLE',
            'DEADLINE_EXCEEDED',
            'INTERNAL'
        ];

        return (
            error.code && retryableCodes.includes(error.code) ||
            error.message && error.message.toLowerCase().includes('timeout')
        );
    }

    /**
     * Wraps API errors in VertexAIError
     * @param {Error} error - Original error
     * @param {string} context - Error context
     * @param {number} attempts - Number of attempts made
     * @returns {VertexAIError} Wrapped error
     */
    wrapError(error, context, attempts = 1) {
        return new VertexAIError(
            `VertexAI ${context} failed after ${attempts} attempt(s): ${error.message}`,
            error.code || 'UNKNOWN_ERROR',
            { context, attempts },
            error
        );
    }

    /**
     * Implements delay with promise
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise} Delay promise
     */
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Logs API request details
     * @param {string} context - Request context
     * @param {number} attempt - Attempt number
     */
    logRequest(context, attempt) {
        this.requestCount++;
        this.lastRequestTime = new Date();
        console.log(`[VertexAI] ${context} request (attempt ${attempt}):`, {
            timestamp: this.lastRequestTime,
            requestCount: this.requestCount
        });
    }

    /**
     * Logs successful API response
     * @param {string} context - Request context
     * @param {number} attempt - Attempt number
     */
    logSuccess(context, attempt) {
        const duration = new Date() - this.lastRequestTime;
        console.log(`[VertexAI] ${context} success (attempt ${attempt}):`, {
            duration,
            timestamp: new Date()
        });
    }
}

/**
 * Implements chat functionality using Vertex AI's chat models
 */
class VertexAIChatModel extends VertexAIBaseModel {
    constructor(config) {
        super(config);
        
        // Validate and set model configuration
        this.validateModelConfig(config);
        
        this.modelName = config.modelName || 'gemini-pro';
        this.defaultGenerationConfig = {
            temperature: config.temperature || 0.7,
            topP: config.topP || 0.8,
            topK: config.topK || 40,
            maxOutputTokens: config.maxOutputTokens || 1024,
            stopSequences: config.stopSequences || []
        };

        // Initialize the model
        this.model = this.vertexai.preview.getGenerativeModel({
            model: this.modelName,
            generation_config: this.defaultGenerationConfig
        });

        // Initialize conversation history if enabled
        this.enableHistory = config.enableHistory || false;
        this.maxHistoryTokens = config.maxHistoryTokens || 2048;
        this.conversationHistory = [];
    }

    /**
     * Validates chat model specific configuration
     * @param {Object} config - Model configuration
     * @throws {VertexAIError} If configuration is invalid
     */
    validateModelConfig(config) {
        if (config.temperature && (config.temperature < 0 || config.temperature > 1)) {
            throw new VertexAIError(
                'Temperature must be between 0 and 1',
                'INVALID_CONFIG'
            );
        }

        if (config.topP && (config.topP < 0 || config.topP > 1)) {
            throw new VertexAIError(
                'Top P must be between 0 and 1',
                'INVALID_CONFIG'
            );
        }

        if (config.maxHistoryTokens && config.maxHistoryTokens < 0) {
            throw new VertexAIError(
                'Max history tokens must be positive',
                'INVALID_CONFIG'
            );
        }
    }

    /**
     * Generates text response for a given prompt
     * @param {string|Object} prompt - Text prompt or structured prompt object
     * @param {Object} options - Generation options
     * @returns {Promise<string>} Generated text
     */
    async generateText(prompt, options = {}) {
        const context = 'chat generation';
        
        return this.withRetry(async () => {
            const request = this.buildRequest(prompt, options);
            const response = await this.model.generateContent(request);
            
            const result = this.processResponse(response);
            
            if (this.enableHistory) {
                this.updateHistory(prompt, result);
            }
            
            return result;
        }, context);
    }

    /**
     * Generates streaming text response
     * @param {string|Object} prompt - Text prompt or structured prompt object
     * @param {Object} options - Generation options
     * @returns {Promise<ReadableStream>} Stream of generated text
     */
    async streamGenerateText(prompt, options = {}) {
        const context = 'chat stream generation';
        
        return this.withRetry(async () => {
            const request = this.buildRequest(prompt, options);
            const responseStream = await this.model.generateContentStream(request);
            
            if (this.enableHistory) {
                // We'll need to accumulate the streamed response to add to history
                this.accumulateStreamForHistory(responseStream, prompt);
            }
            
            return responseStream;
        }, context);
    }

    /**
     * Builds request object for the API
     * @param {string|Object} prompt - Input prompt
     * @param {Object} options - Generation options
     * @returns {Object} Formatted request object
     */
    buildRequest(prompt, options = {}) {
        const contents = [];

        // Add conversation history if enabled
        if (this.enableHistory && this.conversationHistory.length > 0) {
            contents.push(...this.conversationHistory);
        }

        // Add the new prompt
        if (typeof prompt === 'string') {
            contents.push({
                role: 'user',
                parts: [{ text: prompt }]
            });
        } else if (typeof prompt === 'object') {
            contents.push(prompt);
        } else {
            throw new VertexAIError(
                'Invalid prompt format',
                'INVALID_INPUT'
            );
        }

        return {
            contents,
            generation_config: {
                ...this.defaultGenerationConfig,
                ...options
            }
        };
    }

    /**
     * Processes API response
     * @param {Object} response - API response object
     * @returns {string} Processed response text
     */
    processResponse(response) {
        if (!response?.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new VertexAIError(
                'Invalid response format from API',
                'INVALID_RESPONSE'
            );
        }

        return response.response.candidates[0].content.parts[0].text;
    }

    /**
     * Updates conversation history
     * @param {string|Object} prompt - Input prompt
     * @param {string} response - Generated response
     */
    updateHistory(prompt, response) {
        const promptEntry = typeof prompt === 'string'
            ? { role: 'user', parts: [{ text: prompt }] }
            : prompt;
            
        const responseEntry = {
            role: 'assistant',
            parts: [{ text: response }]
        };

        this.conversationHistory.push(promptEntry, responseEntry);

        // Simple token count estimation (can be replaced with actual tokenizer)
        const estimatedTokens = this.conversationHistory
            .reduce((acc, entry) => {
                return acc + JSON.stringify(entry).length / 4;
            }, 0);

        // Trim history if it exceeds the token limit
        while (estimatedTokens > this.maxHistoryTokens && this.conversationHistory.length > 2) {
            this.conversationHistory.splice(0, 2);
        }
    }

    /**
     * Accumulates streamed response for history
     * @param {ReadableStream} stream - Response stream
     * @param {string|Object} prompt - Original prompt
     */
    async accumulateStreamForHistory(stream, prompt) {
        let accumulatedResponse = '';
        
        for await (const chunk of stream) {
            accumulatedResponse += chunk.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }
        
        this.updateHistory(prompt, accumulatedResponse);
    }

    /**
     * Clears conversation history
     */
    clearHistory() {
        this.conversationHistory = [];
    }
}

/**
 * Implements code generation functionality using Vertex AI's code models
 */
class VertexAICodeModel extends VertexAIBaseModel {
    constructor(config) {
        super(config);
        
        // Validate and set model configuration
        this.validateModelConfig(config);
        
        this.modelName = config.modelName || 'code-bison';
        this.defaultGenerationConfig = {
            temperature: config.temperature || 0.2,  // Lower temperature for more focused code generation
            topP: config.topP || 0.95,
            topK: config.topK || 40,
            maxOutputTokens: config.maxOutputTokens || 2048,
            stopSequences: config.stopSequences || ['```']  // Default stop sequence for code blocks
        };

        // Initialize the model
        this.model = this.vertexai.preview.getGenerativeModel({
            model: this.modelName,
            generation_config: this.defaultGenerationConfig
        });

        // Language-specific configurations
        this.languageConfigs = {
            javascript: {
                prefix: '```javascript\n',
                suffix: '\n```',
                commentPrefix: '//',
                docstringStart: '/**',
                docstringEnd: ' */'
            },
            python: {
                prefix: '```python\n',
                suffix: '\n```',
                commentPrefix: '#',
                docstringStart: '"""',
                docstringEnd: '"""'
            },
            // Add more language configs as needed
        };

        this.defaultLanguage = config.defaultLanguage || 'javascript';
    }

    /**
     * Validates code model specific configuration
     * @param {Object} config - Model configuration
     * @throws {VertexAIError} If configuration is invalid
     */
    validateModelConfig(config) {
        if (config.temperature && (config.temperature < 0 || config.temperature > 1)) {
            throw new VertexAIError(
                'Temperature must be between 0 and 1',
                'INVALID_CONFIG'
            );
        }

        if (config.defaultLanguage && !this.languageConfigs[config.defaultLanguage]) {
            throw new VertexAIError(
                `Unsupported language: ${config.defaultLanguage}`,
                'INVALID_CONFIG'
            );
        }
    }

    /**
     * Generates code based on the prompt
     * @param {string|Object} prompt - Code generation prompt
     * @param {Object} options - Generation options
     * @returns {Promise<string>} Generated code
     */
    async generateCode(prompt, options = {}) {
        const context = 'code generation';
        
        return this.withRetry(async () => {
            const request = this.buildCodeRequest(prompt, options);
            const response = await this.model.generateContent(request);
            return this.processCodeResponse(response, options.language || this.defaultLanguage);
        }, context);
    }

    /**
     * Generates code with explanation
     * @param {string|Object} prompt - Code generation prompt
     * @param {Object} options - Generation options
     * @returns {Promise<Object>} Generated code and explanation
     */
    async generateCodeWithExplanation(prompt, options = {}) {
        const context = 'code generation with explanation';
        
        return this.withRetry(async () => {
            const enhancedPrompt = this.buildExplanationPrompt(prompt);
            const request = this.buildCodeRequest(enhancedPrompt, options);
            const response = await this.model.generateContent(request);
            return this.processCodeWithExplanation(response, options.language || this.defaultLanguage);
        }, context);
    }

    /**
     * Builds code generation request
     * @param {string|Object} prompt - Input prompt
     * @param {Object} options - Generation options
     * @returns {Object} Formatted request object
     */
    buildCodeRequest(prompt, options = {}) {
        const language = options.language || this.defaultLanguage;
        const langConfig = this.languageConfigs[language];

        if (!langConfig) {
            throw new VertexAIError(
                `Unsupported language: ${language}`,
                'INVALID_INPUT'
            );
        }

        const formattedPrompt = typeof prompt === 'string'
            ? this.formatCodePrompt(prompt, language)
            : prompt;

        return {
            contents: [{ role: 'user', parts: [{ text: formattedPrompt }] }],
            generation_config: {
                ...this.defaultGenerationConfig,
                ...options
            }
        };
    }

    /**
     * Formats code generation prompt
     * @param {string} prompt - Raw prompt
     * @param {string} language - Target programming language
     * @returns {string} Formatted prompt
     */
    formatCodePrompt(prompt, language) {
        const langConfig = this.languageConfigs[language];
        return `Generate ${language} code for the following:
${prompt}

Please provide well-structured, efficient, and documented code.
Include error handling and follow best practices.
Use ${langConfig.commentPrefix} for inline comments and ${langConfig.docstringStart} for documentation.

Response format:
${langConfig.prefix}
// Your code here
${langConfig.suffix}`;
    }

    /**
     * Builds prompt for code with explanation
     * @param {string} prompt - Original prompt
     * @returns {string} Enhanced prompt requesting explanation
     */
    buildExplanationPrompt(prompt) {
        return `${prompt}

Please provide:
1. Implementation code
2. Brief explanation of the approach
3. Key considerations and best practices followed
4. Any important notes about usage or limitations`;
    }

    /**
     * Processes code generation response
     * @param {Object} response - API response
     * @param {string} language - Target programming language
     * @returns {string} Processed code
     */
    processCodeResponse(response, language) {
        if (!response?.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new VertexAIError(
                'Invalid response format from API',
                'INVALID_RESPONSE'
            );
        }

        const text = response.response.candidates[0].content.parts[0].text;
        return this.extractCode(text, language);
    }

    /**
     * Processes response containing code and explanation
     * @param {Object} response - API response
     * @param {string} language - Target programming language
     * @returns {Object} Processed code and explanation
     */
    processCodeWithExplanation(response, language) {
        if (!response?.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new VertexAIError(
                'Invalid response format from API',
                'INVALID_RESPONSE'
            );
        }

        const text = response.response.candidates[0].content.parts[0].text;
        const code = this.extractCode(text, language);
        const explanation = this.extractExplanation(text);

        return {
            code,
            explanation,
            language
        };
    }

    /**
     * Extracts code from response text
     * @param {string} text - Response text
     * @param {string} language - Target programming language
     * @returns {string} Extracted code
     */
    extractCode(text, language) {
        const langConfig = this.languageConfigs[language];
        const codeBlockRegex = new RegExp(
            `\`\`\`(?:${language})?\n([\\s\\S]*?)\n\`\`\``,
            'g'
        );
        
        const matches = text.match(codeBlockRegex);
        if (!matches) {
            // If no code blocks found, assume entire response is code
            return text.trim();
        }

        return matches
            .map(block => block
                .replace(/^```(?:\w+)?\n/, '')
                .replace(/\n```$/, '')
                .trim()
            )
            .join('\n\n');
    }

    /**
     * Extracts explanation from response text
     * @param {string} text - Response text
     * @returns {string} Extracted explanation
     */
    extractExplanation(text) {
        // Remove code blocks to get explanation
        const explanation = text.replace(/```[\s\S]*?```/g, '').trim();
        return explanation || 'No explanation provided.';
    }
}

/**
 * Implements interactive code discussions and reviews using Vertex AI's code chat model
 */
class VertexAICodeChatModel extends VertexAIBaseModel {
    constructor(config) {
        super(config);
        
        // Validate and set model configuration
        this.validateModelConfig(config);
        
        this.modelName = config.modelName || 'codechat-bison';
        this.defaultGenerationConfig = {
            temperature: config.temperature || 0.3,  // Balanced between creativity and precision
            topP: config.topP || 0.95,
            topK: config.topK || 40,
            maxOutputTokens: config.maxOutputTokens || 2048
        };

        // Initialize the model
        this.model = this.vertexai.preview.getGenerativeModel({
            model: this.modelName,
            generation_config: this.defaultGenerationConfig
        });

        // Initialize conversation context
        this.enableContext = config.enableContext || true;
        this.maxContextTokens = config.maxContextTokens || 4096;
        this.conversationContext = [];
        
        // Code analysis configurations
        this.analysisTypes = {
            review: {
                prompt: this.buildReviewPrompt.bind(this),
                process: this.processReviewResponse.bind(this)
            },
            debug: {
                prompt: this.buildDebugPrompt.bind(this),
                process: this.processDebugResponse.bind(this)
            },
            explain: {
                prompt: this.buildExplanationPrompt.bind(this),
                process: this.processExplanationResponse.bind(this)
            },
            improve: {
                prompt: this.buildImprovementPrompt.bind(this),
                process: this.processImprovementResponse.bind(this)
            }
        };
    }

    /**
     * Validates code chat model specific configuration
     * @param {Object} config - Model configuration
     * @throws {VertexAIError} If configuration is invalid
     */
    validateModelConfig(config) {
        if (config.temperature && (config.temperature < 0 || config.temperature > 1)) {
            throw new VertexAIError(
                'Temperature must be between 0 and 1',
                'INVALID_CONFIG'
            );
        }

        if (config.maxContextTokens && config.maxContextTokens < 0) {
            throw new VertexAIError(
                'Max context tokens must be positive',
                'INVALID_CONFIG'
            );
        }
    }

    /**
     * Generates response for code-related discussions
     * @param {string|Object} prompt - Input prompt or structured request
     * @param {Object} options - Generation options
     * @returns {Promise<string>} Generated response
     */
    async generateText(prompt, options = {}) {
        const context = 'code chat generation';
        
        return this.withRetry(async () => {
            const request = this.buildRequest(prompt, options);
            const response = await this.model.generateContent(request);
            
            const result = this.processResponse(response);
            
            if (this.enableContext) {
                this.updateContext(prompt, result);
            }
            
            return result;
        }, context);
    }

    /**
     * Performs code review
     * @param {string} code - Code to review
     * @param {Object} options - Review options
     * @returns {Promise<Object>} Review results
     */
    async reviewCode(code, options = {}) {
        const context = 'code review';
        
        return this.withRetry(async () => {
            const prompt = this.analysisTypes.review.prompt(code, options);
            const request = this.buildRequest(prompt, options);
            const response = await this.model.generateContent(request);
            return this.analysisTypes.review.process(response);
        }, context);
    }

    /**
     * Assists with code debugging
     * @param {string} code - Code to debug
     * @param {string} error - Error message or description
     * @param {Object} options - Debug options
     * @returns {Promise<Object>} Debug results
     */
    async debugCode(code, error, options = {}) {
        const context = 'code debugging';
        
        return this.withRetry(async () => {
            const prompt = this.analysisTypes.debug.prompt(code, error, options);
            const request = this.buildRequest(prompt, options);
            const response = await this.model.generateContent(request);
            return this.analysisTypes.debug.process(response);
        }, context);
    }

    /**
     * Explains code functionality
     * @param {string} code - Code to explain
     * @param {Object} options - Explanation options
     * @returns {Promise<Object>} Explanation results
     */
    async explainCode(code, options = {}) {
        const context = 'code explanation';
        
        return this.withRetry(async () => {
            const prompt = this.analysisTypes.explain.prompt(code, options);
            const request = this.buildRequest(prompt, options);
            const response = await this.model.generateContent(request);
            return this.analysisTypes.explain.process(response);
        }, context);
    }

    /**
     * Suggests code improvements
     * @param {string} code - Code to improve
     * @param {Object} options - Improvement options
     * @returns {Promise<Object>} Improvement suggestions
     */
    async improveCode(code, options = {}) {
        const context = 'code improvement';
        
        return this.withRetry(async () => {
            const prompt = this.analysisTypes.improve.prompt(code, options);
            const request = this.buildRequest(prompt, options);
            const response = await this.model.generateContent(request);
            return this.analysisTypes.improve.process(response);
        }, context);
    }

    /**
     * Builds code review prompt
     * @param {string} code - Code to review
     * @param {Object} options - Review options
     * @returns {string} Formatted prompt
     */
    buildReviewPrompt(code, options = {}) {
        return `Please review the following code:

\`\`\`
${code}
\`\`\`

Focus on:
1. Code quality and best practices
2. Potential bugs or issues
3. Performance considerations
4. Security implications
5. Maintainability and readability

${options.additionalFocus || ''}`;
    }

    /**
     * Builds debug prompt
     * @param {string} code - Code to debug
     * @param {string} error - Error message
     * @param {Object} options - Debug options
     * @returns {string} Formatted prompt
     */
    buildDebugPrompt(code, error, options = {}) {
        return `Debug the following code:

\`\`\`
${code}
\`\`\`

Error/Issue:
${error}

Please:
1. Identify the root cause
2. Suggest fixes
3. Explain the solution
4. Provide prevention tips

${options.additionalContext || ''}`;
    }

    /**
     * Builds code explanation prompt
     * @param {string} code - Code to explain
     * @param {Object} options - Explanation options
     * @returns {string} Formatted prompt
     */
    buildExplanationPrompt(code, options = {}) {
        return `Explain the following code:

\`\`\`
${code}
\`\`\`

Please provide:
1. High-level overview
2. Detailed explanation of key components
3. Important patterns or techniques used
4. Potential use cases and limitations

${options.focusAreas || ''}`;
    }

    /**
     * Builds code improvement prompt
     * @param {string} code - Code to improve
     * @param {Object} options - Improvement options
     * @returns {string} Formatted prompt
     */
    buildImprovementPrompt(code, options = {}) {
        return `Suggest improvements for the following code:

\`\`\`
${code}
\`\`\`

Focus on:
1. Code optimization
2. Better patterns or approaches
3. Modern best practices
4. Readability and maintainability

${options.improvementAreas || ''}`;
    }

    /**
     * Processes code review response
     * @param {Object} response - API response
     * @returns {Object} Structured review results
     */
    processReviewResponse(response) {
        const text = this.extractResponseText(response);
        return {
            review: text,
            type: 'review',
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Processes debug response
     * @param {Object} response - API response
     * @returns {Object} Structured debug results
     */
    processDebugResponse(response) {
        const text = this.extractResponseText(response);
        return {
            debug: text,
            type: 'debug',
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Processes explanation response
     * @param {Object} response - API response
     * @returns {Object} Structured explanation
     */
    processExplanationResponse(response) {
        const text = this.extractResponseText(response);
        return {
            explanation: text,
            type: 'explain',
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Processes improvement response
     * @param {Object} response - API response
     * @returns {Object} Structured improvement suggestions
     */
    processImprovementResponse(response) {
        const text = this.extractResponseText(response);
        return {
            improvements: text,
            type: 'improve',
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Extracts text from API response
     * @param {Object} response - API response
     * @returns {string} Response text
     */
    extractResponseText(response) {
        if (!response?.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new VertexAIError(
                'Invalid response format from API',
                'INVALID_RESPONSE'
            );
        }
        return response.response.candidates[0].content.parts[0].text;
    }

    /**
     * Updates conversation context
     * @param {string|Object} prompt - Input prompt
     * @param {string} response - Generated response
     */
    updateContext(prompt, response) {
        const promptEntry = typeof prompt === 'string'
            ? { role: 'user', parts: [{ text: prompt }] }
            : prompt;
            
        const responseEntry = {
            role: 'assistant',
            parts: [{ text: response }]
        };

        this.conversationContext.push(promptEntry, responseEntry);

        // Simple token count estimation
        const estimatedTokens = this.conversationContext
            .reduce((acc, entry) => {
                return acc + JSON.stringify(entry).length / 4;
            }, 0);

        // Trim context if it exceeds the token limit
        while (estimatedTokens > this.maxContextTokens && this.conversationContext.length > 2) {
            this.conversationContext.splice(0, 2);
        }
    }

    /**
     * Builds request object
     * @param {string|Object} prompt - Input prompt
     * @param {Object} options - Generation options
     * @returns {Object} Formatted request object
     */
    buildRequest(prompt, options = {}) {
        const contents = [];

        if (this.enableContext && this.conversationContext.length > 0) {
            contents.push(...this.conversationContext);
        }

        contents.push(
            typeof prompt === 'string'
                ? { role: 'user', parts: [{ text: prompt }] }
                : prompt
        );

        return {
            contents,
            generation_config: {
                ...this.defaultGenerationConfig,
                ...options
            }
        };
    }

    /**
     * Processes API response
     * @param {Object} response - API response
     * @returns {string} Processed response text
     */
    processResponse(response) {
        return this.extractResponseText(response);
    }

    /**
     * Clears conversation context
     */
    clearContext() {
        this.conversationContext = [];
    }
}

/**
 * @typedef {Object} VertexAIConfig
 * @property {string} projectId - Google Cloud project ID
 * @property {string} [location] - Google Cloud region (default: 'us-central1')
 * @property {Object} [credentials] - Service account credentials
 * @property {number} [maxRetries] - Maximum number of retry attempts
 * @property {number} [initialDelayMs] - Initial retry delay in milliseconds
 * @property {number} [maxDelayMs] - Maximum retry delay in milliseconds
 */

/**
 * @typedef {Object} GenerationConfig
 * @property {number} [temperature] - Sampling temperature (0.0 to 1.0)
 * @property {number} [topP] - Nucleus sampling parameter
 * @property {number} [topK] - Top-k sampling parameter
 * @property {number} [maxOutputTokens] - Maximum output length
 * @property {string[]} [stopSequences] - Sequences that stop generation
 */

/**
 * @typedef {Object} CodeAnalysisResult
 * @property {string} type - Analysis type (review|debug|explain|improve)
 * @property {string} [review] - Code review feedback
 * @property {string} [debug] - Debugging information
 * @property {string} [explanation] - Code explanation
 * @property {string} [improvements] - Suggested improvements
 * @property {string} timestamp - Analysis timestamp
 */

export {
    VertexAIError,
    VertexAIBaseModel,
    VertexAIChatModel,
    VertexAICodeModel,
    VertexAICodeChatModel
};
