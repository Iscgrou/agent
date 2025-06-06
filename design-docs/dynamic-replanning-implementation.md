# Dynamic Re-planning Implementation Plan

## 1. AgentCoordinator Modifications

### A. New Method: `orchestrateReplanningAnalysis`
```typescript
async orchestrateReplanningAnalysis(
  projectName: string,
  failureContext: {
    errorClassification: string,
    failedSubtaskId: string,
    replanReason: string,
    previousPlan: object,
    previousUnderstanding: object,
    checkpointId: string
  },
  options: {
    forceFullReplan?: boolean,
    preserveSuccessfulTasks?: boolean
  }
): Promise<{
  understanding: object,
  plan: object,
  subtasks: Array<object>
}>
```

- Will be called by SystemManager when REPLAN_FROM_CHECKPOINT strategy is determined
- Receives rich failure context to inform re-planning decisions
- Can either perform full replan or targeted replan based on failure severity
- Returns new plan and subtasks while preserving successful work

### B. Enhancements to `orchestrateFullAnalysis`
- Add support for replan-specific options in initialProjectContextData:
```typescript
{
  isReplanAttempt?: boolean,
  failureContext?: {
    errorClassification: string,
    failedSubtaskId: string,
    replanReason: string,
    previousAttempts?: Array<{
      plan: object,
      failureReason: string
    }>
  }
}
```

## 2. Prompt Template Enhancements

### A. Request Understanding Phase
Add to generateRequestUnderstandingPrompt:
```json
{
  "replan_context": {
    "previous_failure": {
      "error_type": "string",
      "failed_task": "string",
      "failure_reason": "string"
    },
    "successful_tasks": ["array of task IDs that succeeded"],
    "suggested_adjustments": ["array of suggested modifications to requirements/approach"]
  }
}
```

### B. Project Planning Phase
Add to generateProjectPlanningPrompt:
```json
{
  "replan_strategy": {
    "previous_plan_analysis": {
      "failed_aspects": ["what went wrong"],
      "successful_aspects": ["what worked"],
      "risk_areas_identified": ["potential future issues"]
    },
    "modification_approach": {
      "scope_adjustments": ["any scope changes needed"],
      "alternative_technologies": ["different tech choices if needed"],
      "risk_mitigation_strategies": ["how to avoid previous failure"]
    }
  }
}
```

### C. Task Breakdown Phase
Add to generateTaskBreakdownPrompt:
```json
{
  "replan_considerations": {
    "preserved_tasks": ["tasks from previous plan to keep"],
    "modified_tasks": [{
      "original_task_id": "string",
      "modifications": ["changes needed"],
      "modification_reasoning": "string"
    }],
    "new_tasks": ["completely new tasks added"],
    "removed_tasks": [{
      "task_id": "string",
      "removal_reason": "string"
    }]
  }
}
```

## 3. ProjectPersistence Integration

### A. Checkpoint Management
- Store replan attempts with metadata:
```typescript
interface ReplanAttempt {
  attempt_number: number;
  timestamp: string;
  failure_context: {
    error_classification: string;
    failed_subtask_id: string;
    replan_reason: string;
  };
  previous_plan_checkpoint: string;
  new_plan: object;
  replan_strategy_used: string;
}
```

### B. Version Control of Plans
- Maintain history of plans with their outcomes:
```typescript
interface PlanVersion {
  version_number: number;
  plan: object;
  subtasks: Array<object>;
  status: 'failed' | 'in_progress' | 'succeeded';
  failure_context?: object;
  timestamp: string;
}
```

## 4. State Management in AgentCoordinator

### A. Replan History Tracking
```typescript
interface ReplanHistory {
  projectName: string;
  attempts: Array<{
    timestamp: string;
    failure_context: object;
    strategy_used: string;
    outcome: 'success' | 'failure';
  }>;
  successful_strategies: Array<string>;
  failed_strategies: Array<string>;
}
```

### B. Learning from Failures
- Track patterns in failed approaches
- Store successful recovery strategies
- Use this information to inform future replanning decisions

## 5. Error Handling During Re-planning

### A. Replan Failure Scenarios
1. AI fails to generate a new plan
2. New plan is invalid or incomplete
3. New plan conflicts with preserved work
4. Maximum replan attempts reached

### B. Recovery Strategies
1. Attempt with different prompt/approach
2. Fall back to simpler scope
3. Request human intervention
4. Preserve partial success and isolate failing components

## Implementation Phases

1. **Phase 1: Core Re-planning**
   - Implement orchestrateReplanningAnalysis
   - Add replan context to prompts
   - Basic checkpoint management

2. **Phase 2: Enhanced State Management**
   - Implement plan versioning
   - Add replan history tracking
   - Develop learning mechanisms

3. **Phase 3: Advanced Recovery**
   - Implement sophisticated error handling
   - Add multiple recovery strategies
   - Develop human intervention points

4. **Phase 4: Optimization**
   - Fine-tune prompts based on success rates
   - Optimize checkpoint management
   - Add performance monitoring

## Testing Strategy

1. **Unit Tests**
   - Test replan context generation
   - Test checkpoint management
   - Test state tracking

2. **Integration Tests**
   - Test full replan flow
   - Test recovery from various failure types
   - Test checkpoint restoration

3. **Scenario Tests**
   - Test complex replan scenarios
   - Test multiple replan attempts
   - Test preservation of successful work
