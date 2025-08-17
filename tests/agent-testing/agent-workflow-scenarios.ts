/**
 * Agent Workflow Test Scenarios - Real-world agent interaction patterns
 * 
 * These scenarios simulate how actual AI agents would use QuerySculptor tools
 * following the patterns described in AGENT_SYSTEM_PROMPT.md
 */

import { AgentTestScenario } from './mcp-client-harness.js';

/**
 * Basic Query Building Workflow
 * Tests the fundamental start → introspect → build → validate → execute pattern
 */
export const basicQueryWorkflow: AgentTestScenario = {
    name: 'Basic Query Building Workflow',
    description: 'Agent builds a simple query following the standard workflow',
    steps: [
        {
            action: 'call_tool',
            toolName: 'start-query-session',
            parameters: {},
            expectedResponse: {
                success: true,
                fields: ['sessionId']
            },
            description: 'Start a new query session'
        },
        {
            action: 'call_tool',
            toolName: 'introspect-schema',
            parameters: {
                format: 'both'
            },
            expectedResponse: {
                success: true
            },
            description: 'Introspect the GraphQL schema'
        },
        {
            action: 'call_tool',
            toolName: 'select-field',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: '',
                fieldName: 'abilities'
            },
            expectedResponse: {
                success: true
            },
            description: 'Select the abilities field'
        },
        {
            action: 'call_tool',
            toolName: 'select-field',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'abilities',
                fieldName: 'count'
            },
            expectedResponse: {
                success: true
            },
            description: 'Select abilities count field'
        },
        {
            action: 'call_tool',
            toolName: 'select-field',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'abilities',
                fieldName: 'results'
            },
            expectedResponse: {
                success: true
            },
            description: 'Select abilities results field'
        },
        {
            action: 'call_tool',
            toolName: 'validate-query',
            parameters: {
                sessionId: '{{sessionId}}'
            },
            expectedResponse: {
                success: true,
                fields: ['valid', 'query']
            },
            description: 'Validate the built query'
        },
        {
            action: 'call_tool',
            toolName: 'get-current-query',
            parameters: {
                sessionId: '{{sessionId}}'
            },
            expectedResponse: {
                success: true,
                fields: ['queryString']
            },
            description: 'Get the final query string'
        }
    ],
    expectedOutcome: 'success'
};

/**
 * Session Persistence Test
 * Tests that session state persists correctly between multiple tool calls
 */
export const sessionPersistenceTest: AgentTestScenario = {
    name: 'Session Persistence Test',
    description: 'Verify that session state persists correctly across tool calls',
    steps: [
        {
            action: 'call_tool',
            toolName: 'start-query-session',
            parameters: {},
            expectedResponse: { success: true },
            description: 'Start session'
        },
        {
            action: 'call_tool',
            toolName: 'select-field',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: '',
                fieldName: 'abilities'
            },
            expectedResponse: { success: true },
            description: 'Add first field'
        },
        {
            action: 'call_tool',
            toolName: 'get-current-query',
            parameters: {
                sessionId: '{{sessionId}}'
            },
            expectedResponse: {
                success: true,
                fields: ['queryString']
            },
            description: 'Verify first field was saved'
        },
        {
            action: 'call_tool',
            toolName: 'select-field',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'abilities',
                fieldName: 'count'
            },
            expectedResponse: { success: true },
            description: 'Add nested field'
        },
        {
            action: 'call_tool',
            toolName: 'get-current-query',
            parameters: {
                sessionId: '{{sessionId}}'
            },
            expectedResponse: {
                success: true
            },
            description: 'Verify both fields are present'
        },
        {
            action: 'wait',
            timeout: 100,
            description: 'Wait to test persistence over time'
        },
        {
            action: 'call_tool',
            toolName: 'get-current-query',
            parameters: {
                sessionId: '{{sessionId}}'
            },
            expectedResponse: {
                success: true
            },
            description: 'Verify session still exists after wait'
        }
    ],
    expectedOutcome: 'success'
};

/**
 * Variable Management Workflow
 * Tests the complete variable definition and usage workflow
 */
export const variableManagementWorkflow: AgentTestScenario = {
    name: 'Variable Management Workflow',
    description: 'Agent defines variables, sets values, and uses them in arguments',
    steps: [
        {
            action: 'call_tool',
            toolName: 'start-query-session',
            parameters: {},
            expectedResponse: { success: true },
            description: 'Start session'
        },
        {
            action: 'call_tool',
            toolName: 'set-query-variable',
            parameters: {
                sessionId: '{{sessionId}}',
                variableName: '$userId',
                variableType: 'ID!'
            },
            expectedResponse: { success: true },
            description: 'Define userId variable'
        },
        {
            action: 'call_tool',
            toolName: 'set-variable-value',
            parameters: {
                sessionId: '{{sessionId}}',
                variableName: '$userId',
                value: '123'
            },
            expectedResponse: { success: true },
            description: 'Set variable value'
        },
        {
            action: 'call_tool',
            toolName: 'select-field',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: '',
                fieldName: 'user'
            },
            expectedResponse: { success: true },
            description: 'Select user field'
        },
        {
            action: 'call_tool',
            toolName: 'set-variable-argument',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'user',
                argumentName: 'id',
                variableName: '$userId'
            },
            expectedResponse: { success: true },
            description: 'Use variable in argument'
        },
        {
            action: 'call_tool',
            toolName: 'validate-query',
            parameters: {
                sessionId: '{{sessionId}}'
            },
            expectedResponse: { success: true },
            description: 'Validate query with variables'
        }
    ],
    expectedOutcome: 'success'
};

/**
 * Error Recovery Scenario
 * Tests how agent handles and recovers from common errors
 */
export const errorRecoveryScenario: AgentTestScenario = {
    name: 'Error Recovery Scenario',
    description: 'Agent encounters errors and recovers appropriately',
    steps: [
        {
            action: 'call_tool',
            toolName: 'start-query-session',
            parameters: {},
            expectedResponse: { success: true },
            description: 'Start session'
        },
        {
            action: 'call_tool',
            toolName: 'select-field',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: '',
                fieldName: 'nonExistentField'
            },
            expectedResponse: {
                error: /Field.*not found/
            },
            description: 'Try to select non-existent field (should fail)'
        },
        {
            action: 'call_tool',
            toolName: 'get-type-info',
            parameters: {
                sessionId: '{{sessionId}}',
                typeName: 'Query'
            },
            expectedResponse: { success: true },
            description: 'Check available fields on Query type'
        },
        {
            action: 'call_tool',
            toolName: 'select-field',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: '',
                fieldName: 'pokemon'
            },
            expectedResponse: { success: true },
            description: 'Select valid field instead'
        },
        {
            action: 'call_tool',
            toolName: 'validate-query',
            parameters: {
                sessionId: '{{sessionId}}'
            },
            expectedResponse: { success: true },
            description: 'Validate recovered query'
        }
    ],
    expectedOutcome: 'success'
};

/**
 * Invalid Session ID Test
 * Tests handling of session not found errors
 */
export const invalidSessionTest: AgentTestScenario = {
    name: 'Invalid Session ID Test',
    description: 'Test behavior with invalid or non-existent session IDs',
    steps: [
        {
            action: 'call_tool',
            toolName: 'get-current-query',
            parameters: {
                sessionId: 'non-existent-session'
            },
            expectedResponse: {
                error: /Session.*not found/
            },
            description: 'Try to use non-existent session'
        },
        {
            action: 'call_tool',
            toolName: 'select-field',
            parameters: {
                sessionId: 'invalid-session-123',
                currentPath: '',
                fieldName: 'pokemon'
            },
            expectedResponse: {
                error: /Session.*not found/
            },
            description: 'Try to build query with invalid session'
        }
    ],
    expectedOutcome: 'error'
};

/**
 * Complex Query Building Scenario
 * Tests building a complex query with arguments, nested fields, and fragments
 */
export const complexQueryScenario: AgentTestScenario = {
    name: 'Complex Query Building',
    description: 'Build a complex query with multiple features',
    steps: [
        {
            action: 'call_tool',
            toolName: 'start-query-session',
            parameters: {},
            expectedResponse: { success: true },
            description: 'Start session'
        },
        {
            action: 'call_tool',
            toolName: 'introspect-schema',
            parameters: {
                sessionId: '{{sessionId}}'
            },
            expectedResponse: { success: true },
            description: 'Introspect schema'
        },
        {
            action: 'call_tool',
            toolName: 'set-query-variable',
            parameters: {
                sessionId: '{{sessionId}}',
                variableName: '$limit',
                variableType: 'Int',
                defaultValue: 10
            },
            expectedResponse: { success: true },
            description: 'Define limit variable with default'
        },
        {
            action: 'call_tool',
            toolName: 'select-field',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: '',
                fieldName: 'pokemon'
            },
            expectedResponse: { success: true },
            description: 'Select users field'
        },
        {
            action: 'call_tool',
            toolName: 'set-variable-argument',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'pokemon',
                argumentName: 'limit',
                variableName: '$limit'
            },
            expectedResponse: { success: true },
            description: 'Set limit argument using variable'
        },
        {
            action: 'call_tool',
            toolName: 'select-multi-fields',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'pokemon',
                fieldNames: ['id', 'name', 'email']
            },
            expectedResponse: { success: true },
            description: 'Select multiple user fields at once'
        },
        {
            action: 'call_tool',
            toolName: 'select-field',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'pokemon',
                fieldName: 'results'
            },
            expectedResponse: { success: true },
            description: 'Select nested posts field'
        },
        {
            action: 'call_tool',
            toolName: 'select-multi-fields',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'pokemon.results',
                fieldNames: ['name', 'url']
            },
            expectedResponse: { success: true },
            description: 'Select post fields'
        },
        {
            action: 'call_tool',
            toolName: 'validate-query',
            parameters: {
                sessionId: '{{sessionId}}'
            },
            expectedResponse: {
                success: true,
                fields: ['valid', 'query']
            },
            description: 'Validate complex query'
        }
    ],
    expectedOutcome: 'success'
};

/**
 * Session ID Format Test
 * Tests various session ID formats that agents might use
 */
export const sessionIdFormatTest: AgentTestScenario = {
    name: 'Session ID Format Test',
    description: 'Test that various session ID formats work correctly',
    steps: [
        {
            action: 'call_tool',
            toolName: 'start-query-session',
            parameters: {},
            expectedResponse: { success: true },
            description: 'Start session with generated ID'
        },
        {
            action: 'call_tool',
            toolName: 'select-field',
            parameters: {
                sessionId: 'my-custom-session-123',
                currentPath: '',
                fieldName: 'pokemon'
            },
            expectedResponse: {
                error: /Session.*not found/
            },
            description: 'Try custom session ID (should fail - session not created)'
        },
        {
            action: 'call_tool',
            toolName: 'select-field',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: '',
                fieldName: 'pokemon'
            },
            expectedResponse: { success: true },
            description: 'Use proper session ID'
        }
    ],
    expectedOutcome: 'success'
};

// Export all scenarios
export const allScenarios: AgentTestScenario[] = [
    basicQueryWorkflow,
    sessionPersistenceTest,
    variableManagementWorkflow,
    errorRecoveryScenario,
    invalidSessionTest,
    complexQueryScenario,
    sessionIdFormatTest
];

// Scenario groups for different testing purposes
export const scenarioGroups = {
    basic: [basicQueryWorkflow, sessionPersistenceTest],
    advanced: [variableManagementWorkflow, complexQueryScenario],
    errorHandling: [errorRecoveryScenario, invalidSessionTest, sessionIdFormatTest],
    all: allScenarios
};