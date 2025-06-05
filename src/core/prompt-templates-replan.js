/**
 * @fileoverview Enhanced prompt templates specifically for re-planning scenarios.
 * These templates extend the base templates with re-planning context.
 */

import {
    JSON_OUTPUT_INSTRUCTION,
    COMMON_ERROR_HANDLING_INSTRUCTION
} from './prompt-templates.js';

/**
 * Generates a prompt for re-evaluating request understanding in light of failures.
 * @param {object} context - The context for request re-understanding
 * @param {string} context.userInput - Original user request
 * @param {object} context.failureContext - Information about the failure
 * @param {string} context.failureContext.errorClassification - Type of error encountered
 * @param {string} context.failureContext.failedSubtaskId - ID of failed subtask
 * @param {string} context.failureContext.replanReason - Reason for re-planning
 * @param {object} context.previousUnderstanding - Previous understanding of the request
 * @param {string[]} context.successfulTaskIds - IDs of tasks completed successfully
 * @returns {string} A formatted prompt string
 */
export function generateReplanUnderstandingPrompt(context) {
    const { userInput, failureContext, previousUnderstanding, successfulTaskIds = [] } = context;

    const outputSchemaDescription = `
Schema for your JSON response:
{
  "original_request": "${userInput}",
  "previous_understanding": {
    "summary": "Brief summary of how the request was previously understood",
    "key_requirements": ["List of key requirements from previous understanding"]
  },
  "failure_analysis": {
    "error_type": "${failureContext.errorClassification}",
    "failed_task": "${failureContext.failedSubtaskId}",
    "failure_reason": "${failureContext.replanReason}",
    "impact_on_requirements": ["How this failure affects our understanding of requirements"]
  },
  "successful_aspects": {
    "completed_tasks": ${JSON.stringify(successfulTaskIds)},
    "validated_assumptions": ["Requirements or assumptions proven correct by successful tasks"]
  },
  "revised_understanding": {
    "modified_requirements": ["Requirements that need adjustment based on failure"],
    "new_constraints_identified": ["New constraints or limitations discovered"],
    "scope_adjustments": ["Necessary changes to project scope"]
  },
  "confidence_in_changes": "HIGH|MEDIUM|LOW"
}`;

    return `
You are an AI expert in analyzing software development failures and adjusting project understanding.
Review the original request and its previous understanding in light of encountered failures.
Your goal is to determine if and how our understanding of the requirements should change.

Original Request: "${userInput}"

Previous Understanding:
${JSON.stringify(previousUnderstanding, null, 2)}

Failure Context:
${JSON.stringify(failureContext, null, 2)}

Successfully Completed Tasks: ${successfulTaskIds.join(', ')}

${outputSchemaDescription}

${JSON_OUTPUT_INSTRUCTION}
${COMMON_ERROR_HANDLING_INSTRUCTION}
`;
}

/**
 * Generates a prompt for revising the project plan based on failures.
 * @param {object} context - The context for plan revision
 * @param {object} context.revisedUnderstanding - Updated understanding after failure
 * @param {object} context.previousPlan - The original project plan
 * @param {object} context.failureContext - Information about what failed
 * @param {object[]} context.successfulTasks - Tasks that were completed successfully
 * @returns {string} A formatted prompt string
 */
export function generateReplanningPrompt(context) {
    const { revisedUnderstanding, previousPlan, failureContext, successfulTasks = [] } = context;

    const outputSchemaDescription = `
Schema for your JSON response:
{
  "replan_analysis": {
    "previous_plan_evaluation": {
      "failed_aspects": ["What specifically failed in the previous plan"],
      "successful_aspects": ["What worked well and should be preserved"],
      "root_causes": ["Identified root causes of failure"]
    },
    "adaptation_strategy": {
      "scope_adjustments": ["Required changes to project scope"],
      "technical_approach_changes": ["Changes needed in technical approach"],
      "risk_mitigation_steps": ["Steps to prevent similar failures"]
    }
  },
  "revised_plan": {
    "project_title": "Possibly updated project title",
    "project_summary": "Updated summary reflecting new understanding",
    "modified_tech_stack": [
      {
        "type": "Frontend|Backend|Database|etc",
        "technology": "Name of technology",
        "reasoning": "Why this technology is still appropriate or needs change",
        "changes_from_previous": "What changed from the original plan"
      }
    ],
    "revised_milestones": [
      {
        "milestone_id": "Unique identifier",
        "title": "Milestone title",
        "description": "Detailed description",
        "changes_from_previous": "What changed from original plan",
        "preserved_work": ["Work from previous attempt to preserve"],
        "new_approaches": ["New approaches to implement"]
      }
    ]
  },
  "execution_recommendations": {
    "priority_changes": ["Changes in task priorities"],
    "additional_validation_steps": ["Extra validation needed"],
    "resource_adjustments": ["Changes in resource allocation"]
  }
}`;

    return `
You are an AI expert in project recovery and re-planning.
Review the previous plan and failure context to develop a revised plan that addresses the encountered issues while preserving successful work.

Revised Understanding:
${JSON.stringify(revisedUnderstanding, null, 2)}

Previous Plan:
${JSON.stringify(previousPlan, null, 2)}

Failure Context:
${JSON.stringify(failureContext, null, 2)}

Successfully Completed Tasks:
${JSON.stringify(successfulTasks, null, 2)}

${outputSchemaDescription}

${JSON_OUTPUT_INSTRUCTION}
${COMMON_ERROR_HANDLING_INSTRUCTION}
`;
}

/**
 * Generates a prompt for revising subtasks based on the new plan.
 * @param {object} context - The context for subtask revision
 * @param {object} context.revisedPlan - The new project plan
 * @param {object} context.failureContext - Information about what failed
 * @param {object[]} context.previousSubtasks - Original subtasks
 * @param {string[]} context.successfulTaskIds - IDs of successfully completed tasks
 * @returns {string} A formatted prompt string
 */
export function generateReplanSubtasksPrompt(context) {
    const { revisedPlan, failureContext, previousSubtasks, successfulTaskIds = [] } = context;

    const outputSchemaDescription = `
Schema for your JSON array response (each element is a sub-task):
[
  {
    "subtask_id": "Unique identifier (preserve IDs of unchanged tasks)",
    "title": "Concise, actionable title",
    "description": "Detailed description of what needs to be done",
    "replan_notes": {
      "is_modified": true|false,
      "modification_reason": "Why this task was added/modified/preserved",
      "previous_task_id": "ID of related task from previous plan if any",
      "risk_mitigation_steps": ["Steps to prevent previous failures"]
    },
    "dependencies": ["IDs of other subtasks this depends on"],
    "assigned_persona": "The most suitable AI agent persona",
    "estimated_complexity": "low|medium|high",
    "success_criteria": ["Clear, testable criteria"],
    "preserved_artifacts": ["Artifacts from previous attempt to reuse"]
  }
]`;

    return `
You are an AI expert in task decomposition and recovery planning.
Create a revised set of subtasks based on the new plan, preserving successful work where possible.

Revised Plan:
${JSON.stringify(revisedPlan, null, 2)}

Failure Context:
${JSON.stringify(failureContext, null, 2)}

Previous Subtasks:
${JSON.stringify(previousSubtasks, null, 2)}

Successfully Completed Tasks: ${successfulTaskIds.join(', ')}

${outputSchemaDescription}

${JSON_OUTPUT_INSTRUCTION}
${COMMON_ERROR_HANDLING_INSTRUCTION}

Important Guidelines:
1. Preserve IDs and work from successful tasks
2. Clearly mark modified or new tasks
3. Include specific risk mitigation steps based on previous failure
4. Ensure dependencies are updated to reflect the new plan
5. Add validation steps where the previous attempt failed
`;
}

export default {
    generateReplanUnderstandingPrompt,
    generateReplanningPrompt,
    generateReplanSubtasksPrompt
};
