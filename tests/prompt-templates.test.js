import {
    generateRequestUnderstandingPrompt,
    generateProjectPlanningPrompt,
    generateTaskBreakdownPrompt,
    generateCodeGenerationPrompt,
    generateCodeDebuggingPrompt,
    generateSelfReflectionPrompt,
    generateTestGenerationPrompt,
    generateCodeAnalysisPrompt,
    injectContext
} from '../src/core/prompt-templates.js';

describe('Prompt Template Utilities', () => {
    describe('injectContext', () => {
        test('should inject context into string template', () => {
            const template = 'Hello {{name}}, welcome to {{place}}!';
            const context = { name: 'John', place: 'Earth' };
            const result = injectContext(template, context);
            expect(result).toBe('Hello John, welcome to Earth!');
        });

        test('should handle missing context values', () => {
            const template = 'Hello {{name}}, welcome to {{place}}!';
            const context = { name: 'John' };
            const result = injectContext(template, context);
            expect(result).toBe('Hello John, welcome to {{place}}!');
        });

        test('should handle object templates', () => {
            const template = {
                parts: [{ text: 'Analyze {{CODE_SNIPPET}}' }]
            };
            const context = { CODE_SNIPPET: 'const x = 1;' };
            const result = injectContext(template, context);
            expect(result.parts[0].text).toBe('Analyze const x = 1;');
        });
    });
});

describe('Request Understanding Prompt', () => {
    const mockContext = {
        userInput: 'Create a React website with user authentication',
        projectContext: {
            repositoryUrl: 'https://github.com/user/project',
            currentBranch_or_commit: 'main'
        }
    };

    test('should generate valid prompt with all context', () => {
        const prompt = generateRequestUnderstandingPrompt(mockContext);
        expect(prompt).toContain(mockContext.userInput);
        expect(prompt).toContain('JSON');
        expect(prompt).toContain('Schema for your JSON response');
        expect(prompt).toContain(mockContext.projectContext.repositoryUrl);
    });

    test('should handle minimal context', () => {
        const prompt = generateRequestUnderstandingPrompt({ userInput: 'Create a website' });
        expect(prompt).toContain('Create a website');
        expect(prompt).toContain('JSON');
        expect(prompt).not.toContain('Repository URL');
    });

    test('should include few-shot examples when provided', () => {
        const contextWithExamples = {
            ...mockContext,
            fewShotExamples: [{
                input: 'Build a todo app',
                output: { parsed_intent: 'create_new_webapp' }
            }]
        };
        const prompt = generateRequestUnderstandingPrompt(contextWithExamples);
        expect(prompt).toContain('Here are some examples');
        expect(prompt).toContain('todo app');
    });
});

describe('Project Planning Prompt', () => {
    const mockStructuredUnderstanding = {
        parsed_intent: 'create_new_webapp',
        project_type: 'WebApp',
        key_entities_and_requirements: [
            { entity_type: 'technology_stack', value: 'React', confidence: 'High' }
        ]
    };

    test('should generate valid prompt with structured understanding', () => {
        const prompt = generateProjectPlanningPrompt({ structuredUnderstanding: mockStructuredUnderstanding });
        expect(prompt).toContain('create_new_webapp');
        expect(prompt).toContain('React');
        expect(prompt).toContain('JSON');
        expect(prompt).toContain('project_title');
    });

    test('should include few-shot examples when provided', () => {
        const mockExample = {
            inputUnderstanding: { parsed_intent: 'create_mobile_app' },
            outputPlan: { project_title: 'Mobile App MVP' }
        };
        const prompt = generateProjectPlanningPrompt({
            structuredUnderstanding: mockStructuredUnderstanding,
            fewShotExamples: [mockExample]
        });
        expect(prompt).toContain('Mobile App MVP');
    });
});

describe('Task Breakdown Prompt', () => {
    const mockProjectPlan = {
        project_title: 'React Auth Website',
        major_milestones_or_phases: [
            {
                milestone_id: 'M1',
                title: 'Setup & Core Backend APIs',
                description: 'Initial project setup and core API implementation'
            }
        ]
    };

    test('should generate valid prompt for entire project', () => {
        const prompt = generateTaskBreakdownPrompt({
            projectPlan: mockProjectPlan,
            structuredUnderstanding: { parsed_intent: 'create_new_webapp' }
        });
        expect(prompt).toContain('React Auth Website');
        expect(prompt).toContain('JSON');
        expect(prompt).toContain('subtask_id');
    });

    test('should generate valid prompt for specific milestone', () => {
        const prompt = generateTaskBreakdownPrompt({
            projectPlan: mockProjectPlan,
            milestoneToBreakdown: mockProjectPlan.major_milestones_or_phases[0],
            structuredUnderstanding: { parsed_intent: 'create_new_webapp' }
        });
        expect(prompt).toContain('Setup & Core Backend APIs');
        expect(prompt).toContain('M1');
    });
});

describe('Code Generation Prompt', () => {
    const mockSubtask = {
        title: 'Implement user authentication',
        description: 'Create login functionality with JWT',
        required_skills: ['React', 'JWT'],
        output_artifacts_expected: ['src/auth/login.js']
    };

    test('should generate valid prompt with complete context', () => {
        const prompt = generateCodeGenerationPrompt({
            subtask: mockSubtask,
            agentPersonaInstructions: 'You are a React expert',
            language: 'javascript',
            styleGuide: 'Airbnb'
        });
        expect(prompt).toContain('Implement user authentication');
        expect(prompt).toContain('React expert');
        expect(prompt).toContain('JWT');
        expect(prompt).toContain('Airbnb');
    });

    test('should include existing code context when provided', () => {
        const prompt = generateCodeGenerationPrompt({
            subtask: mockSubtask,
            agentPersonaInstructions: 'You are a React expert',
            language: 'javascript',
            existingCodeSnippets: {
                'src/auth/types.js': 'export type User = { id: string; };'
            }
        });
        expect(prompt).toContain('src/auth/types.js');
        expect(prompt).toContain('export type User');
    });

    test('should handle error context for retries', () => {
        const prompt = generateCodeGenerationPrompt({
            subtask: mockSubtask,
            agentPersonaInstructions: 'You are a React expert',
            language: 'javascript',
            errorContext: {
                message: 'Invalid JWT token format',
                location: 'src/auth/login.js:25'
            }
        });
        expect(prompt).toContain('Invalid JWT token format');
        expect(prompt).toContain('retrying this task');
    });
});

describe('Code Debugging Prompt', () => {
    const mockContext = {
        codeToDebug: 'function login() { /* code */ }',
        errorMessage: 'TypeError: Cannot read property "token" of undefined',
        language: 'javascript',
        agentPersonaInstructions: 'You are a debugging expert'
    };

    test('should generate valid prompt with error details', () => {
        const prompt = generateCodeDebuggingPrompt(mockContext);
        expect(prompt).toContain('TypeError');
        expect(prompt).toContain('debugging expert');
        expect(prompt).toContain('JSON');
    });

    test('should handle multiple file debugging context', () => {
        const prompt = generateCodeDebuggingPrompt({
            ...mockContext,
            codeToDebug: {
                'auth.js': 'function login() {}',
                'utils.js': 'function getToken() {}'
            }
        });
        expect(prompt).toContain('auth.js');
        expect(prompt).toContain('utils.js');
    });
});

describe('Self Reflection Prompt', () => {
    const mockContext = {
        subtask: {
            title: 'Implement login',
            description: 'Create user login functionality'
        },
        generatedArtifacts: {
            'login.js': 'function login() {}'
        },
        executionLog: {
            success: true,
            duration: '5m'
        },
        agentPersona: 'ReactDeveloper'
    };

    test('should generate valid reflection prompt', () => {
        const prompt = generateSelfReflectionPrompt(mockContext);
        expect(prompt).toContain('Implement login');
        expect(prompt).toContain('ReactDeveloper');
        expect(prompt).toContain('JSON');
        expect(prompt).toContain('self_critique_solution_quality');
    });

    test('should handle failed execution context', () => {
        const prompt = generateSelfReflectionPrompt({
            ...mockContext,
            executionLog: {
                success: false,
                error: { message: 'Test failed' }
            }
        });
        expect(prompt).toContain('Failed');
        expect(prompt).toContain('Test failed');
    });
});

describe('Test Generation Prompt', () => {
    const mockContext = {
        subtask: {
            title: 'Test login functionality',
            description: 'Create comprehensive tests for login'
        },
        codeToTest: {
            'src/auth/login.js': 'export function login() { /* code */ }'
        },
        language: 'javascript',
        agentPersonaInstructions: 'You are a testing expert',
        coverageRequirements: '80% coverage required'
    };

    test('should generate valid test generation prompt', () => {
        const prompt = generateTestGenerationPrompt(mockContext);
        expect(prompt).toContain('Test login functionality');
        expect(prompt).toContain('testing expert');
        expect(prompt).toContain('80% coverage');
        expect(prompt).toContain('JSON');
    });

    test('should handle multiple files to test', () => {
        const prompt = generateTestGenerationPrompt({
            ...mockContext,
            codeToTest: {
                'login.js': 'function login() {}',
                'validation.js': 'function validate() {}'
            }
        });
        expect(prompt).toContain('login.js');
        expect(prompt).toContain('validation.js');
    });
});

describe('Code Analysis Prompt', () => {
    describe('Repository Level Analysis', () => {
        const mockContext = {
            analysisLevel: 'repository',
            repositoryContext: {
                url: 'https://github.com/user/project',
                branch: 'main',
                mainLanguage: 'JavaScript',
                fileStructureSnapshot: {
                    src: { auth: ['login.js'], utils: ['helpers.js'] }
                }
            },
            analysisFocus: 'Identify main architectural patterns',
            agentPersonaInstructions: 'You are an architecture expert'
        };

        test('should generate valid repository analysis prompt', () => {
            const prompt = generateCodeAnalysisPrompt(mockContext);
            expect(prompt).toContain('repository-level');
            expect(prompt).toContain('architectural patterns');
            expect(prompt).toContain('https://github.com/user/project');
            expect(prompt).toContain('JSON');
        });
    });

    describe('File Level Analysis', () => {
        const mockContext = {
            analysisLevel: 'file',
            fileContext: {
                filePath: 'src/auth/login.js',
                fileContent: 'function login() { /* code */ }',
                language: 'javascript'
            },
            analysisFocus: 'Check for security vulnerabilities',
            agentPersonaInstructions: 'You are a security expert'
        };

        test('should generate valid file analysis prompt', () => {
            const prompt = generateCodeAnalysisPrompt(mockContext);
            expect(prompt).toContain('file-level');
            expect(prompt).toContain('security vulnerabilities');
            expect(prompt).toContain('src/auth/login.js');
            expect(prompt).toContain('JSON');
        });
    });
});
