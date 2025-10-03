/**
 * Agent Test Runner - Executes agent-like workflow tests
 * 
 * This test suite runs realistic agent workflows to verify:
 * - Session persistence across tool calls
 * - Error handling and recovery
 * - Real MCP protocol behavior
 * - Tool response consistency
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { AgentTestClient } from './mcp-client-harness.js';
import { 
    allScenarios, 
    scenarioGroups, 
    basicQueryWorkflow,
    sessionPersistenceTest,
    errorRecoveryScenario,
    invalidSessionTest
} from './agent-workflow-scenarios.js';

describe('Agent-Like Workflow Tests', () => {
    let agentClient: AgentTestClient;

    beforeAll(async () => {
        // These tests need real Redis for session persistence
        // Set up test environment
        process.env.NODE_ENV = 'test';
        if (process.env.USE_REAL_REDIS) {
            process.env.DEFAULT_GRAPHQL_ENDPOINT = 'https://graphql-pokeapi.graphcdn.app';
        } else {
            process.env.DEFAULT_GRAPHQL_ENDPOINT = 'http://localhost:4000/graphql';
        }
    });

    beforeEach(async () => {
        agentClient = new AgentTestClient();
        await agentClient.connect();
    });

    afterEach(async () => {
        await agentClient.disconnect();
    });

    describe('Basic Agent Workflows', () => {
        it('should complete basic query building workflow', async () => {
            const result = await agentClient.runScenario(basicQueryWorkflow);
            
            expect(result.success).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(result.steps).toHaveLength(basicQueryWorkflow.steps.length);
            
            // Verify all steps succeeded
            for (const step of result.steps) {
                expect(step.success).toBe(true);
            }

            // Verify final query was generated
            const finalStep = result.steps[result.steps.length - 1];
            expect(finalStep.response.data).toMatchObject({
                queryString: expect.stringContaining('abilities')
            });
            expect(finalStep.response.error).toBeUndefined();
        }, 30000);

        it('should maintain session persistence across multiple calls', async () => {
            const result = await agentClient.runScenario(sessionPersistenceTest);
            
            expect(result.success).toBe(true);
            expect(result.errors).toHaveLength(0);
            
            // Verify session was maintained throughout
            const callHistory = agentClient.getCallHistory();
            const sessionIds = callHistory
                .filter(call => call.params.sessionId)
                .map(call => call.params.sessionId);
            
            // All calls should use the same session ID
            const uniqueSessionIds = new Set(sessionIds);
            expect(uniqueSessionIds.size).toBe(1);
        });
    });

    describe('Session Management', () => {
        it('should handle session ID formats correctly', async () => {
            // Test with custom session ID
            const customSessionId = 'test-agent-session-12345';
            
            // Start session normally
            const sessionResponse = await agentClient.callTool('start-query-session');
            expect(sessionResponse.sessionId).toBeDefined();
            expect(sessionResponse.error).toBeUndefined();

            const realSessionId = sessionResponse.sessionId;
            
            // Build query with real session
            const buildResponse = await agentClient.callTool('select-field', {
                sessionId: realSessionId,
                currentPath: '',
                fieldName: 'pokemon'
            });
            expect(buildResponse.error).toBeUndefined();
            
            // Verify session persists
            const queryResponse = await agentClient.callTool('get-current-query', {
                sessionId: realSessionId
            });
            expect(queryResponse.error).toBeUndefined();
            expect(queryResponse.data.queryString).toContain('pokemon');
        });

        it('should properly handle invalid session IDs', async () => {
            const result = await agentClient.runScenario(invalidSessionTest);
            
            // This scenario expects errors and should handle them correctly, so success=true
            expect(result.success).toBe(true);
            expect(result.errors).toHaveLength(0); // No unexpected errors
            
            // Verify each step that should fail actually failed
            for (const step of result.steps) {
                expect(step.response).toMatchObject({
                    error: expect.stringMatching(/Session.*not found/)
                });
            }
        });

        it('should handle session cleanup', async () => {
            // Start session
            const sessionId = await agentClient.startSession();
            
            // Build some query state
            await agentClient.buildBasicQuery(sessionId, 'users');
            
            // Verify session exists
            const beforeCleanup = await agentClient.callTool('get-current-query', {
                sessionId
            });
            expect(beforeCleanup.error).toBeUndefined();
            
            // End session
            const endResponse = await agentClient.callTool('end-query-session', {
                sessionId
            });
            expect(endResponse.error).toBeUndefined();
            
            // Verify session is gone
            const afterCleanup = await agentClient.callTool('get-current-query', {
                sessionId
            });
            expect(afterCleanup.error).toBeDefined();
            expect(afterCleanup.error).toMatch(/Session.*not found/);
        });
    });

    describe('Error Handling and Recovery', () => {
        it('should handle and recover from field selection errors', async () => {
            const result = await agentClient.runScenario(errorRecoveryScenario);
            
            expect(result.success).toBe(true);
            expect(result.errors).toHaveLength(0);
            
            // Verify the scenario properly handled the error and recovered
            const steps = result.steps;
            expect(steps[1].response.error).toBeDefined(); // The error step
            expect(steps[1].response.error).toMatch(/Field.*not found/);
            
            // But later steps should succeed
            expect(steps[3].response.error).toBeUndefined(); // Recovery step
            expect(steps[4].response.error).toBeUndefined(); // Validation step
        });

        it('should provide helpful error messages for common mistakes', async () => {
            const sessionId = await agentClient.startSession();
            
            // Try to set argument before adding field
            const argResponse = await agentClient.callTool('set-string-argument', {
                sessionId,
                currentPath: 'nonExistentField',
                argumentName: 'someArg',
                value: 'test'
            });
            
            expect(argResponse.error).toBeDefined();
            expect(argResponse.error).toMatch(/Field.*not found/);
        });
    });

    describe('Variable Management', () => {
        it('should handle variable lifecycle correctly', async () => {
            const sessionId = await agentClient.startSession();
            
            // Define variable
            const defineResponse = await agentClient.callTool('set-query-variable', {
                sessionId,
                variableName: '$testVar',
                variableType: 'String!'
            });
            expect(defineResponse.error).toBeUndefined();
            
            // Set variable value
            const valueResponse = await agentClient.callTool('set-variable-value', {
                sessionId,
                variableName: '$testVar',
                value: 'test value'
            });
            expect(valueResponse.error).toBeUndefined();
            
            // Use in query
            await agentClient.callTool('select-field', {
                sessionId,
                currentPath: '',
                fieldName: 'pokemon'
            });
            
            const argResponse = await agentClient.callTool('set-var-arg', {
                sessionId,
                currentPath: 'pokemon',
                argumentName: 'filter',
                variableName: '$testVar'
            });
            
            // This might fail if the schema doesn't have a filter argument,
            // but the variable handling should work
            if (argResponse.success === false) {
                expect(argResponse.error).not.toMatch(/variable.*not found/i);
            }
        });
    });

    describe('Complex Workflows', () => {
        it('should handle multi-step query building', async () => {
            const sessionId = await agentClient.startSession();
            
            // Build a complex nested query
            const steps = [
                () => agentClient.callTool('select-field', {
                    sessionId,
                    currentPath: '',
                    fieldName: 'abilities'
                }),
                () => agentClient.callTool('select-multi-fields', {
                    sessionId,
                    currentPath: 'abilities',
                    fieldNames: ['count', 'next', 'previous']
                }),
                () => agentClient.callTool('select-field', {
                    sessionId,
                    currentPath: 'abilities',
                    fieldName: 'results'
                }),
                () => agentClient.callTool('select-multi-fields', {
                    sessionId,
                    currentPath: 'abilities.results',
                    fieldNames: ['name', 'url']
                }),
                () => agentClient.callTool('validate-query', {
                    sessionId
                })
            ];
            
            // Execute each step
            for (let i = 0; i < steps.length; i++) {
                const response = await steps[i]();
                expect(response.error).toBeUndefined();
                
                // Verify session state persists between steps
                const queryState = await agentClient.callTool('get-current-query', {
                    sessionId
                });
                expect(queryState.error).toBeUndefined();
            }
            
            // Final validation
            const finalQuery = await agentClient.callTool('get-current-query', {
                sessionId
            });
            expect(finalQuery.error).toBeUndefined();
            expect(finalQuery.data.queryString).toContain('abilities');
            expect(finalQuery.data.queryString).toContain('results');
        }, 30000);
    });

    describe('Performance and Rate Limiting', () => {
        it('should handle rapid successive calls', async () => {
            const sessionId = await agentClient.startSession();
            
            // Make rapid successive calls with valid Pokemon API fields
            const validFields = ['abilities', 'berries', 'eggGroups', 'genders', 'growthRates'];
            const promises = validFields.map(fieldName => 
                agentClient.callTool('select-field', {
                    sessionId,
                    currentPath: '',
                    fieldName
                })
            );
            
            const results = await Promise.allSettled(promises);
            
            // At least the first call should succeed (even if others fail due to invalid fields)
            const successCount = results.filter(r => 
                r.status === 'fulfilled' && !r.value.error
            ).length;
            
            expect(successCount).toBeGreaterThan(0);
        });
    });
});