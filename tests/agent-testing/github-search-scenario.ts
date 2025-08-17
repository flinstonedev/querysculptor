/**
 * GitHub Search Scenario - Reproduces the exact agent workflow that failed
 * 
 * This scenario reproduces the "TrendingAIRepositories" workflow where agents
 * experienced session not found errors when applying inline fragments.
 */

import { AgentTestScenario } from './mcp-client-harness.js';

/**
 * GitHub Search with Inline Fragments Scenario
 * This reproduces the exact workflow that failed with session issues
 */
export const githubSearchScenario: AgentTestScenario = {
    name: 'GitHub Search with Inline Fragments',
    description: 'Reproduces the TrendingAIRepositories workflow that failed with session issues',
    steps: [
        {
            action: 'call_tool',
            toolName: 'start-query-session',
            parameters: {
                operationType: 'query',
                operationName: 'TrendingAIRepositories'
            },
            expectedResponse: {
                success: true,
                fields: ['sessionId']
            },
            description: 'Initiated a query session with operation name "TrendingAIRepositories"'
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
            description: 'Attempted to retrieve the schema'
        },
        {
            action: 'call_tool',
            toolName: 'get-root-operation-types',
            parameters: {
                sessionId: '{{sessionId}}'
            },
            expectedResponse: {
                success: true
            },
            description: 'Retrieved the root operation types'
        },
        {
            action: 'call_tool',
            toolName: 'get-selections',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: ''
            },
            expectedResponse: {
                success: true
            },
            description: 'Retrieved available fields at the root path'
        },
        {
            action: 'call_tool',
            toolName: 'select-field',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: '',
                fieldName: 'search'
            },
            expectedResponse: {
                success: true
            },
            description: 'Selected the "search" field'
        },
        {
            action: 'call_tool',
            toolName: 'get-field-info',
            parameters: {
                sessionId: '{{sessionId}}',
                fieldPath: 'search'
            },
            expectedResponse: {
                success: true
            },
            description: 'Retrieved information about the "search" field'
        },
        {
            action: 'call_tool',
            toolName: 'set-string-argument',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'search',
                argumentName: 'query',
                value: 'AI'
            },
            expectedResponse: {
                success: true
            },
            description: 'Set the "query" argument to "AI" for the "search" field'
        },
        {
            action: 'call_tool',
            toolName: 'set-string-argument',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'search',
                argumentName: 'type',
                value: 'REPOSITORY'
            },
            expectedResponse: {
                success: true
            },
            description: 'Set the "type" argument to "REPOSITORY" for the "search" field'
        },
        {
            action: 'call_tool',
            toolName: 'set-typed-argument',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'search',
                argumentName: 'first',
                value: 5,
                valueType: 'Int'
            },
            expectedResponse: {
                success: true
            },
            description: 'Set the "first" argument to 5 for the "search" field'
        },
        {
            action: 'call_tool',
            toolName: 'get-selections',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'search'
            },
            expectedResponse: {
                success: true
            },
            description: 'Retrieved available fields at the "search" path'
        },
        {
            action: 'call_tool',
            toolName: 'select-field',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'search',
                fieldName: 'edges'
            },
            expectedResponse: {
                success: true
            },
            description: 'Selected the "edges" field under "search"'
        },
        {
            action: 'call_tool',
            toolName: 'get-selections',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'search.edges'
            },
            expectedResponse: {
                success: true
            },
            description: 'Retrieved available fields at the "search.edges" path'
        },
        {
            action: 'call_tool',
            toolName: 'select-field',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'search.edges',
                fieldName: 'node'
            },
            expectedResponse: {
                success: true
            },
            description: 'Selected the "node" field under "search.edges"'
        },
        {
            action: 'call_tool',
            toolName: 'get-selections',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'search.edges.node'
            },
            expectedResponse: {
                success: true
            },
            description: 'Retrieved available fields at the "search.edges.node" path'
        },
        {
            action: 'call_tool',
            toolName: 'apply-inline-frag',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'search.edges.node',
                typeName: 'Repository',
                fieldNames: ['name', 'owner { login }', 'stargazers { totalCount }', 'url']
            },
            expectedResponse: {
                success: true
            },
            description: 'Applied inline fragment for Repository type with common fields'
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
            description: 'Retrieved the current query structure'
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
            description: 'Validated the complete query'
        }
    ],
    expectedOutcome: 'success'
};

/**
 * Session Recovery Scenario - Tests the recovery pattern when session is lost
 */
export const sessionRecoveryScenario: AgentTestScenario = {
    name: 'Session Recovery with Inline Fragments',
    description: 'Tests recovery when session is lost during inline fragment application',
    steps: [
        {
            action: 'call_tool',
            toolName: 'start-query-session',
            parameters: {
                operationType: 'query',
                operationName: 'TestQuery'
            },
            expectedResponse: {
                success: true
            },
            description: 'Start initial session'
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
            description: 'Select a field'
        },
        {
            action: 'call_tool',
            toolName: 'apply-inline-frag',
            parameters: {
                sessionId: 'deliberately-invalid-session-id',
                currentPath: 'abilities',
                typeName: 'SomeType',
                fieldNames: ['field1', 'field2']
            },
            expectedResponse: {
                error: /Session.*not found/
            },
            description: 'Try to apply inline fragment with invalid session (should fail)'
        },
        {
            action: 'call_tool',
            toolName: 'start-query-session',
            parameters: {
                operationType: 'query',
                operationName: 'RecoveredQuery'
            },
            expectedResponse: {
                success: true
            },
            description: 'Start new session for recovery'
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
            description: 'Rebuild query after recovery'
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
            description: 'Verify recovered session works'
        }
    ],
    expectedOutcome: 'success'
};

/**
 * Parallel Operations Scenario - Tests concurrent field selection and argument setting
 */
export const parallelOperationsScenario: AgentTestScenario = {
    name: 'Parallel Operations Test',
    description: 'Tests setting up multiple fields and arguments in quick succession',
    steps: [
        {
            action: 'call_tool',
            toolName: 'start-query-session',
            parameters: {},
            expectedResponse: {
                success: true
            },
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
            expectedResponse: {
                success: true
            },
            description: 'Select root field'
        },
        // Simulate parallel argument setting that the agent mentioned
        {
            action: 'call_tool',
            toolName: 'set-string-argument',
            parameters: {
                sessionId: '{{sessionId}}',
                currentPath: 'abilities',
                argumentName: 'limit',
                value: '10'
            },
            expectedResponse: {
                success: true
            },
            description: 'Set limit argument'
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
            description: 'Select nested field'
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
            description: 'Verify state after parallel operations'
        }
    ],
    expectedOutcome: 'success'
};

// Export all GitHub-related scenarios
export const githubScenarios: AgentTestScenario[] = [
    githubSearchScenario,
    sessionRecoveryScenario,
    parallelOperationsScenario
];

// Add to scenario groups
export const extendedScenarioGroups = {
    github: githubScenarios,
    sessionIssues: [sessionRecoveryScenario],
    advanced: [githubSearchScenario, parallelOperationsScenario]
};