# Agent Testing Framework for QuerySculptor

This directory contains a comprehensive testing framework designed to test QuerySculptor tools exactly as AI agents would use them. The framework addresses the gap between unit tests and real-world agent interactions.

## Overview

The agent testing framework provides:

- **Real MCP Protocol Testing**: Tests tools through the actual MCP protocol layer
- **Session Persistence Verification**: Validates that sessions persist correctly across tool calls
- **Agent Workflow Simulation**: Executes realistic multi-step agent workflows
- **Error Scenario Testing**: Tests error handling and recovery patterns
- **Debug Utilities**: Provides detailed debugging and analysis capabilities

## Quick Start

```bash
# Run all agent tests
pnpm run test:agent

# Run basic workflow tests only
pnpm run test:agent:basic

# Run with detailed debugging
pnpm run test:agent:debug

# Run error scenario tests
pnpm run test:agent:errors
```

## Framework Components

### 1. MCP Client Harness (`mcp-client-harness.ts`)

Simulates how a real MCP agent would interact with QuerySculptor:

```typescript
import { AgentTestClient } from './mcp-client-harness.js';

const client = new AgentTestClient();
await client.connect();

// Start a session like an agent would
const sessionId = await client.startSession();

// Build a query step by step
await client.callTool('select-field', {
    sessionId,
    currentPath: '',
    fieldName: 'users'
});

// Check the result
const query = await client.callTool('get-current-query', { sessionId });
console.log(query.queryString);
```

### 2. Workflow Scenarios (`agent-workflow-scenarios.ts`)

Defines realistic agent interaction patterns:

- **Basic Query Workflow**: Standard start → introspect → build → validate pattern
- **Session Persistence Test**: Verifies session state across multiple calls
- **Variable Management**: Tests complete variable lifecycle
- **Error Recovery**: Tests how agents handle and recover from errors
- **Complex Query Building**: Multi-step queries with arguments and nesting

### 3. Debug Utilities (`agent-debug-utils.ts`)

Provides debugging capabilities for agent interactions:

```typescript
import { AgentDebugHelper, formatDebugReport } from './agent-debug-utils.js';

const debugHelper = new AgentDebugHelper(client);

// Analyze session persistence issues
const analysis = await debugHelper.analyzeSessionPersistence(sessionId);

// Run comprehensive error scenario tests
const errorTests = await debugHelper.runErrorScenarioTests();

// Generate debug report
const report = debugHelper.generateDebugReport(testResults);
console.log(formatDebugReport(report));
```

## Test Categories

### Basic Agent Workflows
Tests fundamental agent patterns following the AGENT_SYSTEM_PROMPT.md guidelines:

- Session creation and management
- Schema introspection
- Field selection
- Query validation and execution

### Session Management
Tests session persistence and ID handling:

- Various session ID formats (hex, descriptive, UUIDs)
- Session state persistence across calls
- Session cleanup and lifecycle
- Concurrent session operations

### Error Handling
Tests common error scenarios and recovery patterns:

- Session not found errors
- Invalid field names
- Missing required parameters
- Schema validation errors
- Network/timeout scenarios

### Complex Workflows
Tests advanced agent capabilities:

- Multi-step query building
- Variable definition and usage
- Fragment handling
- Directive application
- Nested field selection

## Debugging Agent Issues

When agents report issues with QuerySculptor tools, use this framework to debug:

### 1. Reproduce the Issue
```bash
# Create a custom scenario based on the agent's workflow
const customScenario = {
    name: 'Agent Issue Reproduction',
    steps: [
        // Copy the exact steps the agent was trying to perform
    ]
};

const result = await client.runScenario(customScenario);
```

### 2. Enable Debug Mode
```bash
pnpm run test:agent:debug --output=debug-report.txt
```

This generates a comprehensive debug report including:
- Call breakdown by tool
- Error patterns and frequencies
- Performance metrics
- Session state snapshots
- Recommendations for fixes

### 3. Test Session Persistence
```typescript
const sessionId = 'agent-reported-session-id';
const analysis = await debugHelper.analyzeSessionPersistence(sessionId);
console.log(analysis);
```

### 4. Validate Tool Responses
```typescript
const response = await client.callTool('problematic-tool', parameters);
const issues = debugHelper.validateResponseFormat(response, 'tool-name');
console.log('Response format issues:', issues);
```

## Common Issues and Solutions

### Session Not Found Errors
**Symptoms**: Agent reports "Session not found" even after creating session
**Debugging**:
```bash
pnpm run test:agent:errors
```
**Common Causes**:
- Session ID normalization issues (fixed in recent update)
- Redis connectivity problems
- Session TTL expiration
- Agent using different session ID format

### Field Selection Failures
**Symptoms**: Agent can't select fields that should exist
**Debugging**:
```typescript
// Check schema introspection
const schema = await client.callTool('introspect-schema', { sessionId });

// Verify field existence
const typeInfo = await client.callTool('get-type-info', { 
    sessionId, 
    typeName: 'Query' 
});
```

### Variable Management Issues
**Symptoms**: Variables not working in queries
**Debugging**:
```typescript
// Test variable lifecycle
const variableTest = {
    steps: [
        { action: 'call_tool', toolName: 'set-query-variable', ... },
        { action: 'call_tool', toolName: 'set-variable-value', ... },
        { action: 'call_tool', toolName: 'validate-query', ... }
    ]
};
```

## Adding New Test Scenarios

To add new test scenarios for specific agent workflows:

1. **Create the scenario** in `agent-workflow-scenarios.ts`:
```typescript
export const myCustomScenario: AgentTestScenario = {
    name: 'My Custom Workflow',
    description: 'Tests specific agent behavior',
    steps: [
        {
            action: 'call_tool',
            toolName: 'start-query-session',
            expectedResponse: { success: true }
        },
        // ... more steps
    ]
};
```

2. **Add to scenario groups**:
```typescript
export const scenarioGroups = {
    // ... existing groups
    custom: [myCustomScenario]
};
```

3. **Run the test**:
```bash
tsx tests/agent-testing/run-agent-tests.ts --custom
```

## Integration with CI/CD

Add agent tests to your CI pipeline:

```yaml
- name: Run Agent Tests
  run: pnpm run test:agent
  
- name: Run Agent Debug Tests
  run: pnpm run test:agent:debug --output=ci-debug-report.txt
  if: failure()
  
- name: Upload Debug Report
  uses: actions/upload-artifact@v3
  with:
    name: agent-debug-report
    path: ci-debug-report.txt
  if: failure()
```

## Best Practices

1. **Test Real Workflows**: Base scenarios on actual agent interaction patterns
2. **Include Error Cases**: Test both success and failure scenarios
3. **Verify Session Persistence**: Always test that session state persists correctly
4. **Use Debug Mode**: Run with `--debug` when investigating issues
5. **Validate Responses**: Check response format consistency across tools
6. **Monitor Performance**: Watch for slow tool calls that might timeout agents

## Files Structure

```
tests/agent-testing/
├── README.md                     # This documentation
├── mcp-client-harness.ts         # MCP client simulation
├── agent-workflow-scenarios.ts   # Test scenarios
├── agent-debug-utils.ts          # Debugging utilities
├── agent-test-runner.test.ts     # Main test suite
├── error-scenario-tests.test.ts  # Error-focused tests
└── run-agent-tests.ts            # CLI test runner
```

This framework ensures QuerySculptor tools work reliably for AI agents by testing them exactly as agents would use them, identifying issues before they impact agent workflows.