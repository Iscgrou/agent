# Prompt Templates Module Design Specification

## Overview

The prompt-templates.js module serves as the core prompt engineering and management system for the AI platform. It provides structured, maintainable, and version-controlled prompt templates with dynamic context injection capabilities.

## Core Architecture

### Base Classes

```typescript
interface PromptConfig {
    version: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    stopSequences?: string[];
}

interface PromptContext {
    projectContext?: any;
    userInput?: string;
    codeContext?: string;
    errorContext?: any;
    agentPersona?: string;
    conversationHistory?: any[];
}

class PromptTemplate {
    protected config: PromptConfig;
    protected template: string;
    protected schema: JSONSchema;
    protected examples: any[];
    
    constructor(config: PromptConfig);
    
    generate(context: PromptContext): string;
    validate(response: any): boolean;
    addExample(example: any): void;
}
```

### Template Registry

```typescript
class TemplateRegistry {
    private templates: Map<string, PromptTemplate>;
    private versions: Map<string, string[]>;
    
    register(name: string, template: PromptTemplate): void;
    get(name: string, version?: string): PromptTemplate;
    listVersions(name: string): string[];
}
```

## JSON Schema Definitions

### Project Planning Schema
```json
{
    "type": "object",
    "required": ["phases", "timeline", "resources"],
    "properties": {
        "phases": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["name", "tasks", "dependencies"],
                "properties": {
                    "name": { "type": "string" },
                    "tasks": { "type": "array" },
                    "dependencies": { "type": "array" }
                }
            }
        },
        "timeline": {
            "type": "object",
            "required": ["startDate", "endDate", "milestones"],
            "properties": {
                "startDate": { "type": "string" },
                "endDate": { "type": "string" },
                "milestones": { "type": "array" }
            }
        },
        "resources": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["type", "quantity"],
                "properties": {
                    "type": { "type": "string" },
                    "quantity": { "type": "number" }
                }
            }
        }
    }
}
```

### Code Generation Schema
```json
{
    "type": "object",
    "required": ["code", "documentation", "tests"],
    "properties": {
        "code": {
            "type": "object",
            "required": ["content", "language"],
            "properties": {
                "content": { "type": "string" },
                "language": { "type": "string" },
                "dependencies": { "type": "array" }
            }
        },
        "documentation": {
            "type": "object",
            "required": ["description", "usage"],
            "properties": {
                "description": { "type": "string" },
                "usage": { "type": "string" },
                "examples": { "type": "array" }
            }
        },
        "tests": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["name", "scenario"],
                "properties": {
                    "name": { "type": "string" },
                    "scenario": { "type": "string" },
                    "expectedResult": { "type": "string" }
                }
            }
        }
    }
}
```

## Few-Shot Examples Structure

```typescript
interface Example {
    id: string;
    category: string;
    input: any;
    output: any;
    performance: {
        successRate: number;
        averageTokens: number;
        lastUsed: Date;
    };
}

class ExampleManager {
    private examples: Map<string, Example[]>;
    
    add(category: string, example: Example): void;
    getBest(category: string, context: any, count: number): Example[];
    updatePerformance(id: string, success: boolean): void;
}
```

## Dynamic Context Management

### Context Priority Levels
1. Critical (must include)
   - Error messages
   - User requirements
   - Current code context

2. Important (include if space)
   - Related code snippets
   - Recent conversation history
   - Project constraints

3. Optional (include if relevant)
   - Similar examples
   - Style preferences
   - Performance requirements

### Token Management Strategy
```typescript
class TokenManager {
    private maxTokens: number;
    private reservedTokens: number;
    
    calculateTokens(text: string): number;
    prioritizeContent(contents: any[], priority: number[]): any[];
    truncateToFit(content: string, maxTokens: number): string;
}
```

## Security Measures

### Input Validation
- Regular expression patterns for code snippets
- Character encoding validation
- Length limits
- Content type verification

### Prompt Injection Prevention
- Context boundary markers
- Escape sequence handling
- Input sanitization rules
- Output validation

## Version Control

### Version Structure
```typescript
interface TemplateVersion {
    version: string;
    template: string;
    schema: JSONSchema;
    created: Date;
    performance: {
        successRate: number;
        averageTokens: number;
        usageCount: number;
    };
}
```

### A/B Testing Support
```typescript
class ABTestManager {
    private tests: Map<string, TemplateVersion[]>;
    
    createTest(name: string, versions: TemplateVersion[]): void;
    recordResult(name: string, version: string, success: boolean): void;
    getBestVersion(name: string): TemplateVersion;
}
```

## Integration Points

### VertexAI Client Integration
```typescript
class PromptExecutor {
    private client: VertexAIClient;
    private registry: TemplateRegistry;
    
    async execute(
        templateName: string,
        context: PromptContext,
        options?: any
    ): Promise<any>;
}
```

### System Manager Integration
```typescript
class PromptSystem {
    private executor: PromptExecutor;
    private exampleManager: ExampleManager;
    private abTestManager: ABTestManager;
    
    async handleRequest(
        type: string,
        context: any,
        options?: any
    ): Promise<any>;
}
```

## Performance Considerations

1. Caching Strategy
   - Template compilation
   - Few-shot examples
   - Token calculations

2. Optimization Techniques
   - Lazy loading of examples
   - Incremental context building
   - Response streaming support

## Error Handling

1. Template Errors
   - Invalid template syntax
   - Schema validation failures
   - Version conflicts

2. Context Errors
   - Missing required context
   - Invalid context format
   - Token limit exceeded

3. Response Errors
   - Invalid response format
   - Schema validation failures
   - Timeout handling

## Monitoring and Metrics

1. Performance Metrics
   - Template success rates
   - Token usage statistics
   - Response times
   - Error rates

2. Usage Metrics
   - Template popularity
   - Context size distribution
   - Example effectiveness
   - Version performance

## Future Considerations

1. Template Evolution
   - Automated template optimization
   - Performance-based template selection
   - Dynamic example generation

2. Advanced Features
   - Multi-step prompting
   - Context-aware template selection
   - Automated A/B testing
   - Self-improving templates
