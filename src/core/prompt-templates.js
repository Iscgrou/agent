/**
 * @fileoverview Handles the generation of sophisticated, structured, and context-aware prompts
 * for interaction with Vertex AI models. This module is CRITICAL for guiding the AI's
 * reasoning and output quality.
 * @module prompt-templates
 */

// --- Constants and Configuration ---

/**
 * Standard instruction for ensuring responses are formatted as JSON.
 * This is crucial for maintaining structured communication with the AI.
 * @constant {string}
 */
const JSON_OUTPUT_INSTRUCTION = `
IMPORTANT: Your entire response MUST be a single, valid JSON object. Do not include any text outside of this JSON structure, including explanations or conversational filler.
The JSON object should conform to the schema described below or implied by the request.
If you are unsure about a field or it's not applicable, use 'null' or omit the field if appropriate for the schema.
Ensure all strings are properly escaped within the JSON.
`;

/**
 * Standard instruction for handling ambiguous or unclear requests.
 * Ensures consistent error reporting and clarification requests.
 * @constant {string}
 */
const COMMON_ERROR_HANDLING_INSTRUCTION = `
If the request is ambiguous, unclear, or lacks necessary information for a high-quality response,
your JSON response should include an 'error' field detailing the ambiguity or missing information,
and a 'clarification_needed' field with specific questions to resolve the ambiguity.
Example: { "error": "The project scope is too vague.", "clarification_needed": ["What are the primary features of the website?", "What is the target audience?"] }
`;

// --- Base Prompt Template Utilities ---

/**
 * Safely injects context into a prompt template string or object.
 * Handles basic sanitization and supports both string templates and structured objects.
 * 
 * @param {string|object} template - The prompt template to hydrate.
 * @param {object} context - Key-value pairs for injection.
 * @returns {string|object} The hydrated prompt.
 * 
 * @example
 * // String template
 * const template = 'Hello {{name}}, welcome to {{place}}!';
 * const context = { name: 'John', place: 'Earth' };
 * const result = injectContext(template, context);
 * // Returns: 'Hello John, welcome to Earth!'
 * 
 * @example
 * // Object template
 * const template = { parts: [{ text: 'Analyze {{CODE_SNIPPET}}' }] };
 * const context = { CODE_SNIPPET: 'const x = 1;' };
 * const result = injectContext(template, context);
 * // Returns: { parts: [{ text: 'Analyze const x = 1;' }] }
 */
function injectContext(template, context) {
    if (typeof template === 'string') {
        let hydratedTemplate = template;
        for (const key in context) {
            const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            hydratedTemplate = hydratedTemplate.replace(placeholder, String(context[key]));
        }
        return hydratedTemplate;
    } else if (typeof template === 'object') {
        let hydratedTemplate = JSON.parse(JSON.stringify(template));
        if (hydratedTemplate.parts && Array.isArray(hydratedTemplate.parts)) {
             hydratedTemplate.parts = hydratedTemplate.parts.map(part => {
                if (part.text && typeof part.text === 'string') {
                    let newText = part.text;
                    for (const key in context) {
                        const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                        newText = newText.replace(placeholder, String(context[key]));
                    }
                    return { ...part, text: newText };
                }
                return part;
            });
        }
        return hydratedTemplate;
    }
    return template;
}

// --- Core Prompt Generation Functions ---

/**
 * Generates a prompt for Vertex AI to understand a user's request.
 * Produces a structured JSON output detailing intent, entities, scope, and potential ambiguities.
 * 
 * @param {Object} context - The context for request understanding
 * @param {string} context.userInput - The original user request text
 * @param {Object} [context.projectContext] - Optional project-specific context
 * @param {string} [context.projectContext.repositoryUrl] - Repository URL if applicable
 * @param {string} [context.projectContext.currentBranch_or_commit] - Current branch or commit
 * @param {string} [context.projectContext.preliminaryCodeUnderstanding] - Initial code analysis
 * @param {Array<Object>} [context.fewShotExamples] - Optional examples for few-shot learning
 * @returns {string} A formatted prompt string
 * 
 * @example
 * const prompt = generateRequestUnderstandingPrompt({
 *   userInput: 'Create a React website with user authentication',
 *   projectContext: {
 *     repositoryUrl: 'https://github.com/user/project',
 *     currentBranch_or_commit: 'main'
 *   }
 * });
 */
export function generateRequestUnderstandingPrompt(context) {
    const { userInput, projectContext = {}, fewShotExamples = [] } = context;

    let examplesString = "";
    if (fewShotExamples.length > 0) {
        examplesString = "Here are some examples of how to analyze requests:\n";
        fewShotExamples.forEach(ex => {
            examplesString += `User Request: "${ex.input}"\nAnalysis (JSON):\n${JSON.stringify(ex.output, null, 2)}\n---\n`;
        });
    }

    const outputSchemaDescription = `
Schema for your JSON response:
{
  "original_request": "The user's original verbatim request string.",
  "parsed_intent": "A concise statement of the primary goal the user wants to achieve (e.g., 'create_new_website', 'modify_existing_android_app', 'debug_python_script').",
  "project_type": "Categorize the project (e.g., 'WebApp', 'MobileApp-Android', 'PythonScript', 'DataAnalysis', 'CodeModification', 'Undetermined').",
  "key_entities_and_requirements": [
    { "entity_type": "technology_stack (e.g., React, Node.js, Kotlin, Python)", "value": "User-specified or inferred technology", "confidence": "High/Medium/Low" },
    { "entity_type": "primary_feature", "value": "Description of a key feature mentioned", "confidence": "..." },
    { "entity_type": "target_platform", "value": "e.g., Web, Android, iOS, Desktop", "confidence": "..." },
    { "entity_type": "data_persistence", "value": "e.g., Database type, local storage", "confidence": "..." },
    { "entity_type": "constraint", "value": "Any constraints mentioned by the user", "confidence": "..."}
  ],
  "initial_complexity_assessment": "A string value: 'Low', 'Medium', 'High', 'Very High', or 'Requires_More_Info'.",
  "potential_ambiguities": ["List any parts of the request that are unclear or could have multiple interpretations."],
  "suggested_clarifying_questions": ["If ambiguities exist, list specific questions to ask for clarification (max 3)."],
  "inferred_goal_summary": "A brief summary of what you understand the user ultimately wants to build or achieve.",
  "source_code_analysis_needed": "Boolean: true if the request involves an existing codebase (e.g., from a Git repo) that needs to be analyzed for modification."
}
`;

    let projectContextString = "";
    if (projectContext.repositoryUrl) {
        projectContextString += `The user might be referring to an existing project. Context:\nRepository URL: ${projectContext.repositoryUrl}\n`;
        if (projectContext.currentBranch_or_commit) projectContextString += `Current Branch/Commit: ${projectContext.currentBranch_or_commit}\n`;
        if (projectContext.preliminaryCodeUnderstanding) projectContextString += `Preliminary Code Understanding: ${projectContext.preliminaryCodeUnderstanding}\n`;
    }

    return `
You are an expert AI system designed to understand software development requests.
Analyze the following user request meticulously.
Your goal is to extract all relevant information and structure it as a JSON object.

User Request:
"${userInput}"

${projectContextString}

${examplesString}

${outputSchemaDescription}

${JSON_OUTPUT_INSTRUCTION}
${COMMON_ERROR_HANDLING_INSTRUCTION}
`;
}

/**
 * Generates a prompt for Vertex AI to create a high-level project plan.
 * Uses the structured understanding to produce a detailed project outline.
 * 
 * @param {Object} context - The context for project planning
 * @param {Object} context.structuredUnderstanding - Output from generateRequestUnderstandingPrompt
 * @param {Array<Object>} [context.fewShotExamples] - Optional examples for few-shot learning
 * @returns {string} A formatted prompt string
 * 
 * @example
 * const prompt = generateProjectPlanningPrompt({
 *   structuredUnderstanding: {
 *     parsed_intent: 'create_new_webapp',
 *     project_type: 'WebApp',
 *     key_entities_and_requirements: [
 *       { entity_type: 'technology_stack', value: 'React', confidence: 'High' }
 *     ]
 *   }
 * });
 */
export function generateProjectPlanningPrompt(context) {
    const { structuredUnderstanding, fewShotExamples = [] } = context;

    let examplesString = "";
    if (fewShotExamples.length > 0) {
        examplesString = "Here are some examples of project plans:\n";
        fewShotExamples.forEach(ex => {
            examplesString += `Based on understanding:\n${JSON.stringify(ex.inputUnderstanding, null, 2)}\nProject Plan (JSON):\n${JSON.stringify(ex.outputPlan, null, 2)}\n---\n`;
        });
    }

    const outputSchemaDescription = `
Schema for your JSON response:
{
  "project_title": "A concise, descriptive title for the project.",
  "project_summary": "A brief overview of the project's goals and deliverables, based on the understanding.",
  "proposed_tech_stack": [
    { "type": "Frontend", "technology": "e.g., React, Vue, Angular, Android XML/Jetpack Compose", "reasoning": "Brief justification" },
    { "type": "Backend", "technology": "e.g., Node.js/Express, Python/Django, Java/Spring", "reasoning": "..." },
    { "type": "Database", "technology": "e.g., PostgreSQL, MongoDB, SQLite, Firebase", "reasoning": "..." },
    { "type": "Deployment", "technology": "e.g., Docker, Kubernetes, Cloud Run, Vercel", "reasoning": "..." }
  ],
  "major_milestones_or_phases": [
    {
      "milestone_id": "M1",
      "title": "e.g., Setup & Core Backend APIs",
      "description": "Detailed description of this milestone.",
      "estimated_subtasks_count": "Approximate number of sub-tasks for this milestone.",
      "key_deliverables": ["List of key outputs for this milestone."]
    }
  ],
  "dependency_map_overview": "A high-level description of dependencies between major milestones or components.",
  "potential_risks_and_mitigations": [
    { "risk": "Description of a potential risk.", "mitigation": "Suggested mitigation strategy." }
  ],
  "estimated_overall_complexity": "Re-evaluate: 'Low', 'Medium', 'High', 'Very High'.",
  "preliminary_effort_estimate_range": "e.g., 'Small (days)', 'Medium (weeks)', 'Large (1-2 months)', 'Very Large (2+ months)'"
}
`;

    return `
You are an expert AI Project Planner and Software Architect.
Based on the structured understanding of the user's request (provided below), create a comprehensive high-level project plan.
The plan should outline the technology stack, major milestones, potential risks, and an overall complexity/effort estimate.

Structured Request Understanding:
${JSON.stringify(structuredUnderstanding, null, 2)}

${examplesString}

${outputSchemaDescription}

${JSON_OUTPUT_INSTRUCTION}
${COMMON_ERROR_HANDLING_INSTRUCTION}
`;
}

/**
 * Generates a prompt for Vertex AI to break down a project plan/milestone into detailed tasks.
 * 
 * @param {Object} context - The context for task breakdown
 * @param {Object} context.projectPlan - The complete project plan
 * @param {Object} [context.milestoneToBreakdown] - Optional specific milestone to break down
 * @param {Object} context.structuredUnderstanding - Original request understanding
 * @param {Array<Object>} [context.fewShotExamples] - Optional examples for few-shot learning
 * @returns {string} A formatted prompt string
 * 
 * @example
 * const prompt = generateTaskBreakdownPrompt({
 *   projectPlan: {
 *     project_title: 'React Auth Website',
 *     major_milestones_or_phases: [{
 *       milestone_id: 'M1',
 *       title: 'Setup & Core Backend APIs'
 *     }]
 *   },
 *   structuredUnderstanding: { parsed_intent: 'create_new_webapp' }
 * });
 */
export function generateTaskBreakdownPrompt(context) {
    const { projectPlan, milestoneToBreakdown, structuredUnderstanding, fewShotExamples = [] } = context;

    let examplesString = "";
    if (fewShotExamples.length > 0) {
        examplesString = "Here are some examples of task breakdowns:\n";
        fewShotExamples.forEach(ex => {
            examplesString += `Based on plan:\n${JSON.stringify(ex.inputPlan, null, 2)}\nTask Breakdown (JSON):\n${JSON.stringify(ex.outputTasks, null, 2)}\n---\n`;
        });
    }

    const outputSchemaDescription = `
Schema for your JSON array response (each element in the array is a sub-task):
[
  {
    "subtask_id": "A unique identifier (e.g., 'M1_T001').",
    "title": "A concise, actionable title for the sub-task.",
    "description": "A detailed description of what needs to be done for this sub-task. Be specific.",
    "parent_milestone_id": "ID of the milestone this sub-task belongs to.",
    "assigned_persona": "The most suitable AI agent persona for this task (e.g., 'FrontendDev_React', 'BackendDev_Node', 'DatabaseAdmin_Postgres', 'DevOps_Docker', 'QA_Tester', 'TechnicalWriter_Docs', 'CodeAnalyzer_Android'). Choose from a predefined list or suggest a new specific one if needed.",
    "required_skills": ["List specific technical skills needed, e.g., 'React Hooks', 'Express.js routing', 'SQL query optimization', 'Kotlin Coroutines', 'Git conflict resolution'],
    "input_artifacts_needed": ["List specific files, data, or outputs from previous tasks required as input."],
    "output_artifacts_expected": ["Describe the primary deliverables of this sub-task, e.g., 'User authentication module (user.js, auth.js)', 'API endpoint /users implemented', 'Database schema migration script', 'JUnit test cases for X', 'Updated README.md section Y'."],
    "dependencies_subtask_ids": ["An array of subtask_ids that must be completed before this one can start."],
    "estimated_effort_hours": "A numerical estimate of hours (e.g., 2, 8, 16). Use 0 if it's a very quick configuration task.",
    "priority": "'High', 'Medium', 'Low'.",
    "acceptance_criteria": [
        "A list of clear, testable criteria to confirm this sub-task is complete and correct. e.g., 'User can register successfully.', '/api/data returns 200 with expected JSON structure.', 'Code passes all linting rules.', 'Unit tests cover 80% of the new module.'"
    ],
    "potential_blockers_or_questions": ["Any known blockers or specific questions the AI agent might need to resolve *before* starting this sub-task, possibly requiring input from a CodeAnalyzer persona if it involves understanding existing complex code."]
  }
]
`;

    let focusArea = "the entire project plan";
    if (milestoneToBreakdown) {
        focusArea = `the milestone titled '${milestoneToBreakdown.title}' (ID: ${milestoneToBreakdown.milestone_id})`;
    }

    return `
You are an expert AI Task Decomposer and Project Manager.
Based on the overall project plan and the initial request understanding (both provided below), break down ${focusArea} into a list of detailed, actionable, and granular sub-tasks.
Each sub-task should be small enough to be handled by a specialized AI agent and should have clear inputs, outputs, and acceptance criteria.
Assign an appropriate 'assigned_persona' for each task, reflecting the expertise needed.
If breaking down a specific milestone, ensure sub-tasks align with its deliverables. If breaking down the whole plan, create sub-tasks for each milestone.

Project Plan:
${JSON.stringify(projectPlan, null, 2)}

${milestoneToBreakdown ? `\nFocus Milestone Details:\n${JSON.stringify(milestoneToBreakdown, null, 2)}` : ""}

Initial Request Understanding (for context):
${JSON.stringify(structuredUnderstanding, null, 2)}

${examplesString}

${outputSchemaDescription}

${JSON_OUTPUT_INSTRUCTION}
Provide the response as a JSON array of sub-task objects.
${COMMON_ERROR_HANDLING_INSTRUCTION}
`;
}

/**
 * Generates a prompt for Vertex AI to write or modify code for a specific task.
 * 
 * @param {Object} context - The context for code generation
 * @param {Object} context.subtask - The subtask details
 * @param {string} context.agentPersonaInstructions - Instructions for the AI's persona
 * @param {Object} [context.existingCodeSnippets] - Relevant existing code
 * @param {Object} [context.projectFileStructure] - Project file structure
 * @param {string} context.language - Programming language
 * @param {string} [context.styleGuide] - Optional style guide to follow
 * @param {Object} [context.errorContext] - Context if retrying after failure
 * @param {Array<Object>} [context.fewShotExamples] - Optional examples
 * @returns {string|Object} A formatted prompt
 * 
 * @example
 * const prompt = generateCodeGenerationPrompt({
 *   subtask: {
 *     title: 'Implement user authentication',
 *     description: 'Create login functionality with JWT'
 *   },
 *   agentPersonaInstructions: 'You are a React expert',
 *   language: 'javascript',
 *   styleGuide: 'Airbnb'
 * });
 */
export function generateCodeGenerationPrompt(context) {
    const {
        subtask,
        agentPersonaInstructions,
        existingCodeSnippets = {},
        projectFileStructure,
        language,
        styleGuide,
        errorContext,
        fewShotExamples = []
    } = context;

    let promptString = `${agentPersonaInstructions}\n`;
    promptString += `Your current task is: "${subtask.title}"\nDescription: ${subtask.description}\n`;
    promptString += `Required Skills: ${subtask.required_skills.join(', ')}\n`;
    promptString += `Expected Output Artifacts: ${subtask.output_artifacts_expected.join(', ')}\n`;
    promptString += `Programming Language: ${language}\n`;

    if (styleGuide) {
        promptString += `Adhere to the following style guide: ${styleGuide}\n`;
    }
    if (subtask.documentation_requirements) {
         promptString += `Include comprehensive documentation (e.g., JSDoc, Python docstrings) as per these requirements: ${subtask.documentation_requirements}\n`;
    }
    if (subtask.test_requirements) {
         promptString += `You might also need to generate unit tests as per these requirements: ${subtask.test_requirements}\n`;
    }

    if (Object.keys(existingCodeSnippets).length > 0) {
        promptString += "\nYou will be working with or referencing the following existing code:\n";
        for (const filePath in existingCodeSnippets) {
            promptString += `--- File: ${filePath} ---\n\`\`\`${language}\n${existingCodeSnippets[filePath]}\n\`\`\`\n\n`;
        }
    }

    if (projectFileStructure) {
        promptString +=`Consider the existing project file structure: \n${JSON.stringify(projectFileStructure, null, 2)}\n\n`;
    }

    if (errorContext) {
        promptString += `You are retrying this task due to a previous error.\nError Context: ${JSON.stringify(errorContext, null, 2)}\nPlease analyze the error and provide a corrected and complete solution.\n\n`;
    }

    if (fewShotExamples.length > 0) {
        promptString += "Here are some examples relevant to this task:\n";
        fewShotExamples.forEach(ex => {
            promptString += `Instruction: ${ex.instruction}\n`;
            if(ex.code_input) promptString += `Input Code Context:\n\`\`\`${language}\n${ex.code_input}\n\`\`\`\n`;
            promptString += `Output Code:\n\`\`\`${language}\n${ex.code_output}\n\`\`\`\n---\n`;
        });
    }

    const multiFileOutputSchema = `
If you need to generate or modify multiple files, provide your response as a single JSON object with a "files" key.
The "files" key should have an array of objects, where each object has "path" (string, e.g., "src/components/MyComponent.js") and "content" (string, the code for that file).
Example:
{
  "files": [
    { "path": "src/utils/helper.js", "content": "// Helper code..." },
    { "path": "src/main.js", "content": "// Main application logic..." }
  ],
  "explanation": "Optional: A brief explanation of the changes or new code."
}
If generating only a single file's content, you can provide just the raw code, but the JSON format is preferred for consistency.
Ensure the generated code is complete and runnable for each file.
`;

    promptString += `\n${multiFileOutputSchema}\n`;
    promptString += `Generate the required code for language "${language}".\n`;
    promptString += `${JSON_OUTPUT_INSTRUCTION}`;

    return promptString;
}

/**
 * Generates a prompt for Vertex AI to debug code.
 * 
 * @param {Object} context - The context for debugging
 * @param {string|Object} context.codeToDebug - Code to debug
 * @param {string} context.errorMessage - Error message
 * @param {string} [context.stackTrace] - Optional stack trace
 * @param {string} context.language - Programming language
 * @param {string} context.agentPersonaInstructions - Instructions for the AI's persona
 * @param {Object} [context.subtaskContext] - Original subtask context
 * @returns {string} A formatted prompt string
 * 
 * @example
 * const prompt = generateCodeDebuggingPrompt({
 *   codeToDebug: 'function login() { /* code */ }',
 *   errorMessage: 'TypeError: Cannot read property "token" of undefined',
 *   language: 'javascript',
 *   agentPersonaInstructions: 'You are a debugging expert'
 * });
 */
export function generateCodeDebuggingPrompt(context) {
    const { codeToDebug, errorMessage, stackTrace, language, agentPersonaInstructions, subtaskContext } = context;

    let codeString = "";
    if (typeof codeToDebug === 'string') {
        codeString = `\`\`\`${language}\n${codeToDebug}\n\`\`\``;
    } else if (typeof codeToDebug === 'object') {
        for (const filePath in codeToDebug) {
            codeString += `--- File: ${filePath} ---\n\`\`\`${language}\n${codeToDebug[filePath]}\n\`\`\`\n\n`;
        }
    }

    const outputSchema = `
Your response MUST be a JSON object with the following schema:
{
  "error_analysis": "A detailed explanation of the root cause of the error.",
  "suggested_fix_description": "A step-by-step explanation of how to fix the bug.",
  "fixed_code_snippets": [
    {
      "file_path": "The path of the file to be modified (e.g., 'src/utils.js'). If only one snippet and path isn't clear, use 'main_code_snippet'.",
      "original_code_context": "Optional: The relevant snippet of the original code around the change.",
      "corrected_code": "The complete, corrected code for the relevant section or file. Provide the full function/class if a small change, or the full file if extensive changes are needed."
    }
  ],
  "alternative_solutions_or_considerations": ["Optional: Any alternative fixes or important considerations related to the bug or fix."],
  "preventative_measures": ["Optional: Suggestions to prevent similar bugs in the future."]
}
`;

    let prompt = `${agentPersonaInstructions}\n`;
    prompt += `You are an expert Code Debugger. Analyze the following code which produced an error.\n`;
    if (subtaskContext) {
        prompt += `This code was intended for the sub-task: "${subtaskContext.title}" - ${subtaskContext.description}\n`;
    }
    prompt += `Programming Language: ${language}\n\n`;
    prompt += `Code with the issue:\n${codeString}\n\n`;
    prompt += `Error Observed:\n${errorMessage}\n`;
    if (stackTrace) {
        prompt += `Stack Trace:\n${stackTrace}\n`;
    }
    prompt += `\nPlease provide a detailed analysis, the root cause, and the corrected code.\n`;
    prompt += `\n${outputSchema}\n`;
    prompt += `${JSON_OUTPUT_INSTRUCTION}`;

    return prompt;
}

/**
 * Generates a prompt for AI to review its own work process.
 * 
 * @param {Object} context - The context for self-reflection
 * @param {Object} context.subtask - The completed subtask
 * @param {Object} context.generatedArtifacts - Generated outputs
 * @param {Object} context.executionLog - Execution details
 * @param {string} context.agentPersona - AI's persona
 * @returns {string} A formatted prompt string
 * 
 * @example
 * const prompt = generateSelfReflectionPrompt({
 *   subtask: {
 *     title: 'Implement login',
 *     description: 'Create user login functionality'
 *   },
 *   generatedArtifacts: { 'login.js': 'function login() {}' },
 *   executionLog: { success: true, duration: '5m' },
 *   agentPersona: 'ReactDeveloper'
 * });
 */
export function generateSelfReflectionPrompt(context) {
    const { subtask, generatedArtifacts, executionLog, agentPersona } = context;

    const outputSchema = `
Schema for your JSON response:
{
  "task_summary_recap": "Briefly restate the original goal of the sub-task.",
  "solution_approach_taken": "Describe the approach you took to solve the sub-task.",
  "decision_points_and_reasoning": [
    { "decision_point": "e.g., Choice of algorithm, library, data structure", "reasoning": "Why this choice was made." }
  ],
  "challenges_encountered": ["Any difficulties or ambiguities faced during implementation."],
  "self_critique_solution_quality": {
    "correctness": "Rating (Excellent/Good/Fair/Poor) and brief justification.",
    "efficiency": "Rating and justification.",
    "readability_maintainability": "Rating and justification.",
    "adherence_to_requirements": "Rating and justification."
  },
  "areas_for_improvement_in_process": ["What could you (the AI agent) do differently next time for a similar task?"],
  "key_learnings_or_patterns_identified": ["Any new patterns or insights gained that could be useful for the future."]
}
`;

    return `
You are an AI agent (${agentPersona}) reflecting on a completed task.
The sub-task was: "${subtask.title}" - ${subtask.description}
Generated Artifacts: ${Object.keys(generatedArtifacts).join(', ') || 'None'}
Execution Log Summary: ${executionLog.success ? 'Successful.' : `Failed: ${executionLog.error?.message || 'Unknown error'}`}

Please provide a self-reflection on your process and the outcome.

${outputSchema}
${JSON_OUTPUT_INSTRUCTION}
`;
}

/**
 * Generates a prompt for test generation.
 * 
 * @param {Object} context - The context for test generation
 * @param {Object} context.subtask - The subtask to test
 * @param {Object} context.codeToTest - Code to generate tests for
 * @param {string} context.language - Programming language
 * @param {string} context.agentPersonaInstructions - Instructions for the AI's persona
 * @param {string} [context.coverageRequirements] - Optional coverage requirements
 * @returns {string} A formatted prompt string
 * 
 * @example
 * const prompt = generateTestGenerationPrompt({
 *   subtask: {
 *     title: 'Test login functionality',
 *     description: 'Create comprehensive tests for login'
 *   },
 *   codeToTest: { 'src/auth/login.js': 'export function login() {}' },
 *   language: 'javascript',
 *   agentPersonaInstructions: 'You are a testing expert',
 *   coverageRequirements: '80% coverage required'
 * });
 */
export function generateTestGenerationPrompt(context) {
    const { subtask, codeToTest, language, agentPersonaInstructions, coverageRequirements } = context;

    let codeString = "";
    for (const filePath in codeToTest) {
        codeString += `--- File: ${filePath} ---\n\`\`\`${language}\n${codeToTest[filePath]}\n\`\`\`\n\n`;
    }

    const outputSchema = `
Schema for your JSON response:
{
  "test_strategy_summary": "Briefly describe the overall testing approach (e.g., unit tests for core logic, integration tests for API interaction).",
  "test_cases": [
    {
      "test_case_id": "e.g., TC001_valid_input",
      "description": "What this test case aims to verify.",
      "type": "'unit', 'integration', 'e2e', 'performance', 'security'",
      "file_path_for_test": "Suggested file path for this test code (e.g., 'tests/test_utils.js').",
      "test_code": "The actual test code in the specified language (e.g., using Jest, PyTest, JUnit).",
      "expected_outcome": "What the test should assert or verify.",
      "setup_instructions": "Optional: Any specific setup needed to run this test."
    }
  ],
  "overall_coverage_notes": "Comments on how well the generated tests cover the requirements or the provided code."
}
`;

    return `
${agentPersonaInstructions} You are also an expert QA Engineer and Test Developer.
Your task is to generate comprehensive test cases for the following code, which was developed for the sub-task: "${subtask.title}" (${subtask.description}).
Programming Language: ${language}.

Code to be tested:
${codeString}

${coverageRequirements ? `Please aim for a test coverage of: ${coverageRequirements}\n` : ""}
Consider various scenarios: valid inputs, invalid inputs, edge cases, error conditions.
Generate a mix of test types if appropriate, but prioritize unit tests for core logic.
Provide the test code and a description for each test case.

${outputSchema}
${JSON_OUTPUT_INSTRUCTION}
`;
}

/**
 * Generates a prompt for code analysis at repository or file level.
 * 
 * @param {Object} context - The context for code analysis
 * @param {'repository'|'file'} context.analysisLevel - Level of analysis
 * @param {Object} [context.repositoryContext] - Repository context if applicable
 * @param {Object} [context.fileContext] - File context if applicable
 * @param {string} [context.analysisFocus] - Specific focus of analysis
 * @param {string} context.agentPersonaInstructions - Instructions for the AI's persona
 * @returns {string} A formatted prompt string
 * 
 * @example
 * const prompt = generateCodeAnalysisPrompt({
 *   analysisLevel: 'file',
 *   fileContext: {
 *     filePath: 'src/auth/login.js',
 *     fileContent: 'function login() {}',
 *     language: 'javascript'
 *   },
 *   analysisFocus: 'Check for security vulnerabilities',
 *   agentPersonaInstructions: 'You are a security expert'
 * });
 */
export function generateCodeAnalysisPrompt(context) {
    const { analysisLevel, repositoryContext, fileContext, analysisFocus, agentPersonaInstructions } = context;

    let prompt = `${agentPersonaInstructions}\n`;
    prompt += `You are an expert Code Analyzer. Your task is to perform a ${analysisLevel}-level analysis.\n`;

    if (analysisFocus) {
        prompt += `Specific focus of this analysis: ${analysisFocus}\n\n`;
    }

    let codeContextString = "";
    if (analysisLevel === 'repository' && repositoryContext) {
        codeContextString = `Repository Context:\nURL: ${repositoryContext.url}\n`;
        if (repositoryContext.branch) codeContextString += `Branch: ${repositoryContext.branch}\n`;
        if (repositoryContext.mainLanguage) codeContextString += `Assumed Main Language: ${repositoryContext.mainLanguage}\n`;
        if (repositoryContext.fileStructureSnapshot) {
            codeContextString += `Snapshot of File Structure (partial or full):\n${JSON.stringify(repositoryContext.fileStructureSnapshot, null, 2)}\n`;
        }
        prompt += `Analyze the overall repository structure and (if provided) key code snippets.\n${codeContextString}`;

    } else if (analysisLevel === 'file' && fileContext) {
        codeContextString = `File Context:\nPath: ${fileContext.filePath}\nLanguage: ${fileContext.language || 'auto-detect'}\n\`\`\`${fileContext.language || ''}\n${fileContext.fileContent}\n\`\`\`\n`;
        prompt += `Analyze the following code file:\n${codeContextString}`;
    } else {
        return `{"error": "Insufficient context for code analysis.", "clarification_needed": ["Please provide repository or file context."]}${JSON_OUTPUT_INSTRUCTION}`;
    }

    const outputSchema = `
Schema for your JSON response:
{
  "analysis_level": "${analysisLevel}",
  "analysis_focus": "${analysisFocus || 'General Analysis'}",
  "summary": "A high-level summary of your findings.",
  "detailed_findings": [
    {
      "finding_type": "e.g., 'ArchitecturalPattern', 'CodeSmell', 'SecurityVulnerability', 'PerformanceConcern', 'BestPracticeViolation', 'KeyModuleIdentification', 'DependencyIssue'",
      "description": "Detailed description of the finding.",
      "severity": "'Critical', 'High', 'Medium', 'Low', 'Informational' (if applicable).",
      "location_references": ["e.g., File paths, function names, line numbers, module names involved."],
      "recommendation_or_implication": "Suggested action, or implication of the finding."
    }
  ],
  "overall_assessment": "Your overall assessment of the code/repository based on the focus.",
  "confidence_score": "A score from 0.0 to 1.0 indicating your confidence in this analysis."
}
`;
    prompt += `\n${outputSchema}\n`;
    prompt += `${JSON_OUTPUT_INSTRUCTION}`;
    return prompt;
}
