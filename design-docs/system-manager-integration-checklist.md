# SystemManager Integration Checklist and Test Scenarios

## A. SystemManager.js Enhancements and Integration Logic

### 1. Core Dependencies and State Management
- [ ] Add new dependencies:
  ```javascript
  import AgentCoordinator from './agent-coordination.js';
  import TaskExecutionSystem from './task-execution.js';
  ```
- [ ] Enhanced state management:
  ```javascript
  class SystemManager {
    constructor() {
      this.mainTaskQueue = new Queue();
      this.activeProjects = new Map(); // projectName -> projectState
      this.projectFileContexts = new Map(); // projectName -> current files state
      this.agentCoordinator = null;
      this.taskExecutor = null;
    }
  }
  ```

### 2. Initialization and Configuration
- [ ] Initialize core components with proper configurations:
  ```javascript
  async initialize() {
    const vertexAIConfig = this.configManager.get('vertexAI');
    const sandboxConfig = this.configManager.get('sandbox');
    
    this.agentCoordinator = new AgentCoordinator(
      vertexAIConfig.chat,
      this.projectPersistence,
      this.sandboxManager
    );
    
    this.taskExecutor = new TaskExecutionSystem(
      vertexAIConfig.code,
      vertexAIConfig.codeChat,
      this.sandboxManager,
      this.projectPersistence,
      this.configManager
    );
  }
  ```

### 3. Project Context Management
- [ ] Methods for managing project state:
  - [ ] `initializeProjectContext(projectName)`
  - [ ] `loadExistingProject(projectName)`
  - [ ] `updateProjectContext(projectName, newArtifacts)`
  - [ ] `saveProjectCheckpoint(projectName, stage)`

### 4. Main Request Processing Pipeline
- [ ] Enhanced processMainRequest method:
  ```javascript
  async processMainRequest(request) {
    const projectName = this.generateProjectName(request);
    try {
      // 1. Initialize or load project context
      await this.initializeProjectContext(projectName);
      
      // 2. Orchestrate analysis
      const { understanding, plan, subtasks } = 
        await this.agentCoordinator.orchestrateFullAnalysis(
          request,
          projectName,
          this.getProjectContextData(projectName)
        );
      
      // 3. Save analysis results
      await this.saveProjectCheckpoint(projectName, 'analysis');
      
      // 4. Process subtasks
      await this.processSubtasks(projectName, subtasks);
      
      // 5. Final checkpoint
      await this.saveProjectCheckpoint(projectName, 'completion');
      
    } catch (error) {
      await this.handleRequestError(projectName, error);
    }
  }
  ```

### 5. Subtask Processing
- [ ] Implement subtask execution logic:
  ```javascript
  async processSubtasks(projectName, subtasks) {
    for (const subtask of subtasks) {
      try {
        const result = await this.taskExecutor.executeSubtask(
          subtask,
          projectName,
          this.projectFileContexts.get(projectName)
        );
        
        if (result.success) {
          await this.updateProjectContext(projectName, result.artifacts);
          await this.saveProjectCheckpoint(projectName, 'subtask');
        } else {
          throw new Error(`Subtask ${subtask.id} failed: ${result.error}`);
        }
        
      } catch (error) {
        if (this.isRecoverableError(error)) {
          await this.handleSubtaskError(projectName, subtask, error);
          continue;
        }
        throw error;
      }
    }
  }
  ```

### 6. Error Handling and Recovery
- [ ] Implement error classification:
  - [ ] `isRecoverableError(error)`
  - [ ] `isCriticalError(error)`
- [ ] Error handling strategies:
  - [ ] `handleRequestError(projectName, error)`
  - [ ] `handleSubtaskError(projectName, subtask, error)`
  - [ ] `attemptErrorRecovery(projectName, error)`

### 7. Progress Tracking and Reporting
- [ ] Implement progress tracking:
  - [ ] `updateRequestProgress(projectName, stage, details)`
  - [ ] `reportSubtaskProgress(projectName, subtask, status)`
  - [ ] `notifyCompletion(projectName, success, results)`

## B. Integration Test Scenarios

### Scenario 1: Simple Code Generation
**Title:** Create Hello World Python Script
- Initial Request: "Create a simple Python script that prints 'Hello, World!'"
- Expected Flow:
  1. AgentCoordinator:
     - Understanding: Single-file Python script creation
     - Plan: One-step plan for basic script
     - Subtasks: Single task for file creation
  2. TaskExecutionSystem:
     - Generate Python code
     - Execute in sandbox
     - Verify output contains "Hello, World!"
  3. Expected Output:
     - File: 'hello.py'
     - Content: Simple print statement
     - Successful execution in sandbox

### Scenario 2: Multi-File Project with Dependencies
**Title:** Create Basic React Component
- Initial Request: "Create a React counter component with increment/decrement buttons"
- Expected Flow:
  1. AgentCoordinator:
     - Understanding: React component creation
     - Plan: Multi-step (component, styles, tests)
     - Subtasks: 3-4 tasks (setup, implementation, styling, testing)
  2. TaskExecutionSystem:
     - Generate multiple files
     - Handle npm dependencies
     - Execute tests
  3. Expected Output:
     - Files: Counter.js, Counter.css, Counter.test.js
     - Successful test execution
     - Working component verification

### Scenario 3: Self-Debugging Scenario
**Title:** Fix Syntax Error in Generated Code
- Initial Request: "Create a JavaScript function to calculate factorial"
- Expected Flow:
  1. AgentCoordinator:
     - Understanding: Math function implementation
     - Plan: Implementation and testing
     - Subtasks: Implementation and test cases
  2. TaskExecutionSystem:
     - Generate initial code (with intentional error)
     - Detect syntax error
     - Enter debug loop
     - Fix and verify
  3. Expected Output:
     - Initial error detection
     - Successful debug iteration
     - Working factorial function

### Scenario 4: Project State Persistence
**Title:** Resume Interrupted Project
- Initial Request: "Create an Express.js API with three endpoints"
- Expected Flow:
  1. First Run:
     - Complete first two endpoints
     - Simulate interruption
     - Save state via project-persistence
  2. Resume:
     - Load saved state
     - Continue with third endpoint
     - Complete project
  3. Expected Output:
     - Correct state restoration
     - Completion of remaining tasks
     - Full API implementation

### Scenario 5: Complex Error Recovery
**Title:** Handle External Dependency Failure
- Initial Request: "Create a weather dashboard using OpenWeather API"
- Expected Flow:
  1. AgentCoordinator:
     - Understanding: Web app with API integration
     - Plan: Frontend + API integration
     - Subtasks: Setup, UI, API integration
  2. TaskExecutionSystem:
     - Successfully create UI
     - Encounter API integration issue
     - Implement fallback/mock data
  3. Expected Output:
     - Graceful error handling
     - Fallback implementation
     - Working dashboard with mock data

Each test scenario will need:
- Mock responses for AI models
- Sandbox execution results
- File system operations
- Configuration settings
- Project persistence data
