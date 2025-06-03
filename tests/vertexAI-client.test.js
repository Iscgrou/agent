import { jest } from '@jest/globals';
import {
    VertexAIError,
    VertexAIBaseModel,
    VertexAIChatModel,
    VertexAICodeModel,
    VertexAICodeChatModel
} from '../src/core/vertexAI-client.js';

// Mock VertexAI SDK
jest.mock('@google-cloud/vertexai', () => ({
    VertexAI: jest.fn().mockImplementation(() => ({
        preview: {
            getGenerativeModel: jest.fn().mockImplementation(() => ({
                generateContent: jest.fn(),
                generateContentStream: jest.fn()
            }))
        }
    }))
}));

describe('VertexAIBaseModel', () => {
    let baseModel;
    const mockConfig = {
        projectId: 'test-project',
        credentials: { key: 'test-key' }
    };

    beforeEach(() => {
        baseModel = new VertexAIBaseModel(mockConfig);
    });

    describe('constructor', () => {
        test('should initialize with valid config', () => {
            expect(baseModel.projectId).toBe(mockConfig.projectId);
            expect(baseModel.credentials).toEqual(mockConfig.credentials);
        });

        test('should throw error for missing projectId', () => {
            expect(() => new VertexAIBaseModel({}))
                .toThrow(VertexAIError);
        });
    });

    describe('error handling', () => {
        test('should implement exponential backoff', async () => {
            const operation = jest.fn()
                .mockRejectedValueOnce(new Error('Rate limit'))
                .mockResolvedValueOnce('success');

            const result = await baseModel.withRetry(operation, 'test');
            expect(result).toBe('success');
            expect(operation).toHaveBeenCalledTimes(2);
        });

        test('should properly wrap errors', () => {
            const error = new Error('Test error');
            const wrapped = baseModel.wrapError(error, 'test context');
            expect(wrapped).toBeInstanceOf(VertexAIError);
            expect(wrapped.context).toBeDefined();
        });
    });
});

describe('VertexAIChatModel', () => {
    let chatModel;
    const mockConfig = {
        projectId: 'test-project',
        credentials: { key: 'test-key' },
        temperature: 0.7
    };

    beforeEach(() => {
        chatModel = new VertexAIChatModel(mockConfig);
    });

    describe('generateText', () => {
        test('should handle simple text generation', async () => {
            const mockResponse = {
                response: {
                    candidates: [{
                        content: {
                            parts: [{ text: 'Generated text' }]
                        }
                    }]
                }
            };

            chatModel.model.generateContent.mockResolvedValue(mockResponse);

            const result = await chatModel.generateText('Test prompt');
            expect(result).toBe('Generated text');
        });

        test('should maintain conversation history', async () => {
            const mockResponse = {
                response: {
                    candidates: [{
                        content: {
                            parts: [{ text: 'Response' }]
                        }
                    }]
                }
            };

            chatModel.model.generateContent.mockResolvedValue(mockResponse);

            await chatModel.generateText('Test prompt');
            expect(chatModel.conversationHistory.length).toBe(2); // prompt + response
        });
    });
});

describe('VertexAICodeModel', () => {
    let codeModel;
    const mockConfig = {
        projectId: 'test-project',
        credentials: { key: 'test-key' },
        defaultLanguage: 'javascript'
    };

    beforeEach(() => {
        codeModel = new VertexAICodeModel(mockConfig);
    });

    describe('generateCode', () => {
        test('should generate code with proper formatting', async () => {
            const mockResponse = {
                response: {
                    candidates: [{
                        content: {
                            parts: [{
                                text: '```javascript\nconst test = "hello";\n```'
                            }]
                        }
                    }]
                }
            };

            codeModel.model.generateContent.mockResolvedValue(mockResponse);

            const result = await codeModel.generateCode('Create a test variable');
            expect(result).toBe('const test = "hello";');
        });

        test('should handle different programming languages', async () => {
            const mockResponse = {
                response: {
                    candidates: [{
                        content: {
                            parts: [{
                                text: '```python\ntest = "hello"\n```'
                            }]
                        }
                    }]
                }
            };

            codeModel.model.generateContent.mockResolvedValue(mockResponse);

            const result = await codeModel.generateCode('Create a test variable', { language: 'python' });
            expect(result).toBe('test = "hello"');
        });
    });
});

describe('VertexAICodeChatModel', () => {
    let codeChatModel;
    const mockConfig = {
        projectId: 'test-project',
        credentials: { key: 'test-key' }
    };

    beforeEach(() => {
        codeChatModel = new VertexAICodeChatModel(mockConfig);
    });

    describe('code review', () => {
        test('should provide structured review feedback', async () => {
            const mockResponse = {
                response: {
                    candidates: [{
                        content: {
                            parts: [{
                                text: 'Code review feedback: Good structure'
                            }]
                        }
                    }]
                }
            };

            codeChatModel.model.generateContent.mockResolvedValue(mockResponse);

            const result = await codeChatModel.reviewCode('const test = "hello";');
            expect(result.type).toBe('review');
            expect(result.review).toBeDefined();
            expect(result.timestamp).toBeDefined();
        });
    });

    describe('code debugging', () => {
        test('should analyze and suggest fixes', async () => {
            const mockResponse = {
                response: {
                    candidates: [{
                        content: {
                            parts: [{
                                text: 'Debug suggestion: Add error handling'
                            }]
                        }
                    }]
                }
            };

            codeChatModel.model.generateContent.mockResolvedValue(mockResponse);

            const result = await codeChatModel.debugCode(
                'function test() { throw "error"; }',
                'Uncaught error'
            );
            expect(result.type).toBe('debug');
            expect(result.debug).toBeDefined();
        });
    });

    describe('context management', () => {
        test('should maintain conversation context within limits', async () => {
            const mockResponse = {
                response: {
                    candidates: [{
                        content: {
                            parts: [{ text: 'Response' }]
                        }
                    }]
                }
            };

            codeChatModel.model.generateContent.mockResolvedValue(mockResponse);

            // Simulate multiple interactions
            for (let i = 0; i < 5; i++) {
                await codeChatModel.generateText(`Prompt ${i}`);
            }

            // Context should be trimmed to respect token limits
            expect(codeChatModel.conversationContext.length).toBeLessThanOrEqual(
                Math.floor(codeChatModel.maxContextTokens / 100) * 2
            );
        });
    });
});

// Integration Tests
describe('Vertex AI Client Integration', () => {
    const config = {
        projectId: process.env.VERTEX_AI_PROJECT_ID,
        credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS
            ? require(process.env.GOOGLE_APPLICATION_CREDENTIALS)
            : undefined
    };

    // Skip integration tests if credentials are not available
    const testIfCredentials = config.credentials ? test : test.skip;

    describe('Chat Integration', () => {
        testIfCredentials('should generate chat response', async () => {
            const chatModel = new VertexAIChatModel(config);
            const response = await chatModel.generateText('Hello, how are you?');
            expect(response).toBeTruthy();
            expect(typeof response).toBe('string');
        });
    });

    describe('Code Generation Integration', () => {
        testIfCredentials('should generate code', async () => {
            const codeModel = new VertexAICodeModel(config);
            const response = await codeModel.generateCode(
                'Create a function that adds two numbers'
            );
            expect(response).toBeTruthy();
            expect(response).toContain('function');
        });
    });

    describe('Code Chat Integration', () => {
        testIfCredentials('should review code', async () => {
            const codeChatModel = new VertexAICodeChatModel(config);
            const response = await codeChatModel.reviewCode(
                'function add(a,b) { return a + b; }'
            );
            expect(response.type).toBe('review');
            expect(response.review).toBeTruthy();
        });
    });
});
