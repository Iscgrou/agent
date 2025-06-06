# UI Integration Checklist - API Layer and WebSocket Integration

## Overview
This document outlines the design and implementation requirements for integrating a user interface with the AI Platform's SystemManager through REST APIs and WebSocket connections.

## 1. REST API Endpoints

### 1.1 Project Management Endpoints

#### Submit New Project
- **Endpoint**: `POST /api/projects`
- **Request Schema**:
  ```typescript
  {
    userInput: string;          // The natural language request
    projectName: string;        // Unique project identifier
    options?: {
      initialFileContext?: {    // Any existing files to consider
        path: string;
        content: string;
      }[];
      forceReprocessFlags?: {   // Override default processing behavior
        skipAnalysis?: boolean;
        reuseExistingPlan?: boolean;
      }
    }
  }
  ```
- **Response Schema**:
  ```typescript
  {
    projectId: string;          // Server-generated unique ID
    projectName: string;        // User-provided name
    status: 'submitted';        // Initial status
    timestamp: string;          // ISO timestamp
    estimatedDuration?: number; // Optional estimate in seconds
  }
  ```
- **Error Responses**:
  - 400: Invalid request (malformed JSON, missing required fields)
  - 409: Project name already exists
  - 503: System not ready for new requests

#### Get Project Status
- **Endpoint**: `GET /api/projects/{projectName}/status`
- **Response Schema**:
  ```typescript
  {
    projectName: string;
    status: ProjectStatus;      // enum of possible states
    currentPhase?: {
      name: string;            // e.g., "analysis", "planning", "execution"
      progress: number;        // 0-100
      currentTask?: {
        id: string;
        title: string;
        status: string;
      }
    };
    recentLogs: {
      timestamp: string;
      level: string;
      message: string;
    }[];
    error?: {
      code: string;
      message: string;
      recoveryAttempts?: number;
    }
  }
  ```

#### Get Project Results
- **Endpoint**: `GET /api/projects/{projectName}/results`
- **Response Schema**:
  ```typescript
  {
    projectName: string;
    status: 'completed' | 'failed';
    artifacts: {
      path: string;
      type: string;           // "file" | "directory"
      content?: string;       // For text files
      downloadUrl?: string;   // For binary files
      size: number;
    }[];
    executionSummary: {
      startTime: string;
      endTime: string;
      totalTasks: number;
      completedTasks: number;
      errorCount: number;
    };
    logs: {
      path: string;
      downloadUrl: string;
    }
  }
  ```

#### List Projects
- **Endpoint**: `GET /api/projects`
- **Query Parameters**:
  - status?: string (filter by status)
  - limit?: number (pagination)
  - offset?: number (pagination)
- **Response Schema**:
  ```typescript
  {
    projects: {
      projectName: string;
      status: ProjectStatus;
      createdAt: string;
      lastUpdated: string;
      type: string;           // Project type (e.g., "WebApp", "Script")
    }[];
    pagination: {
      total: number;
      limit: number;
      offset: number;
    }
  }
  ```

### 1.2 System Management Endpoints

#### Get System Health
- **Endpoint**: `GET /api/system/health`
- **Response Schema**:
  ```typescript
  {
    status: 'healthy' | 'degraded' | 'unavailable';
    components: {
      name: string;          // e.g., "VertexAI", "Sandbox"
      status: string;
      latency?: number;
      message?: string;
    }[];
    metrics: {
      activeProjects: number;
      queuedRequests: number;
      resourceUtilization: {
        cpu: number;
        memory: number;
        disk: number;
      }
    }
  }
  ```

## 2. WebSocket Events

### 2.1 Connection Management
- **Connection URL**: `ws://host/api/ws`
- **Connection Parameters**:
  - Authentication token (same as REST API)
  - Optional project subscription list

### 2.2 Server -> Client Events

#### Project Status Updates
```typescript
{
  type: 'project_status_update';
  payload: {
    projectName: string;
    timestamp: string;
    status: ProjectStatus;
    details?: string;
    progress?: number;
  }
}
```

#### Task Execution Updates
```typescript
{
  type: 'task_update';
  payload: {
    projectName: string;
    taskId: string;
    status: 'started' | 'completed' | 'failed';
    timestamp: string;
    details?: {
      title: string;
      progress?: number;
      error?: string;
    }
  }
}
```

#### Sandbox Output Stream
```typescript
{
  type: 'sandbox_output';
  payload: {
    projectName: string;
    taskId: string;
    stream: 'stdout' | 'stderr';
    content: string;
    timestamp: string;
  }
}
```

#### System Notifications
```typescript
{
  type: 'system_notification';
  payload: {
    level: 'info' | 'warning' | 'error';
    message: string;
    timestamp: string;
    details?: object;
  }
}
```

### 2.3 Client -> Server Events

#### Subscribe to Project Updates
```typescript
{
  type: 'subscribe_project';
  payload: {
    projectName: string;
    events?: string[];  // Optional specific events to subscribe to
  }
}
```

#### Unsubscribe from Project Updates
```typescript
{
  type: 'unsubscribe_project';
  payload: {
    projectName: string;
  }
}
```

## 3. SystemManager Integration Points

### 3.1 Event Emission
SystemManager needs to emit events for:
- [ ] Project state changes
- [ ] Task status updates
- [ ] Error occurrences
- [ ] Recovery attempts
- [ ] Completion notifications

### 3.2 Data Access Methods
Required methods in SystemManager:
- [ ] getProjectStatus(projectName: string)
- [ ] getProjectResults(projectName: string)
- [ ] listProjects(filters: object)
- [ ] getSystemHealth()

### 3.3 Command Reception
Methods to handle incoming commands:
- [ ] submitNewRequest(input: string, projectName: string, options: object)
- [ ] cancelProject(projectName: string)
- [ ] pauseProject(projectName: string)
- [ ] resumeProject(projectName: string)

## 4. Security Considerations

### 4.1 Authentication
- [ ] Implement JWT-based authentication
- [ ] Define token structure and claims
- [ ] Implement token validation middleware

### 4.2 Authorization
- [ ] Define role-based access control (RBAC)
- [ ] Implement project-level access control
- [ ] Add authorization middleware

### 4.3 Rate Limiting
- [ ] Implement rate limiting per client
- [ ] Define rate limit policies
- [ ] Add rate limiting middleware

## 5. Error Handling

### 5.1 HTTP Error Responses
Standard error response structure:
```typescript
{
  error: {
    code: string;        // Machine-readable error code
    message: string;     // Human-readable message
    details?: object;    // Additional error context
    requestId?: string;  // For error tracking
  }
}
```

### 5.2 WebSocket Error Events
```typescript
{
  type: 'error';
  payload: {
    code: string;
    message: string;
    details?: object;
  }
}
```

## 6. Implementation Phases

### Phase 1: Core API Implementation
- [ ] Set up Express.js server
- [ ] Implement basic CRUD endpoints
- [ ] Add error handling middleware
- [ ] Implement basic authentication

### Phase 2: WebSocket Integration
- [ ] Set up WebSocket server
- [ ] Implement event handlers
- [ ] Add connection management
- [ ] Implement real-time updates

### Phase 3: SystemManager Integration
- [ ] Add event emitters to SystemManager
- [ ] Implement data access methods
- [ ] Add command handlers
- [ ] Test integration points

### Phase 4: Security & Optimization
- [ ] Implement full authentication/authorization
- [ ] Add rate limiting
- [ ] Optimize performance
- [ ] Add monitoring and logging
