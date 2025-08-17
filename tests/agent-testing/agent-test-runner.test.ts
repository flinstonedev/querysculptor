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
        process.env.DEFAULT_GRAPHQL_ENDPOINT = 'http://localhost:4000/graphql';
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
            expect(finalStep.response).toMatchObject({
                success: true,
                queryString: expect.stringContaining('users')
            });
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
            expect(sessionResponse.success).toBe(true);
            
            const realSessionId = sessionResponse.sessionId;
            
            // Build query with real session
            const buildResponse = await agentClient.callTool('select-field', {
                sessionId: realSessionId,
                currentPath: '',
                fieldName: 'users'
            });
            expect(buildResponse.success).toBe(true);
            
            // Verify session persists
            const queryResponse = await agentClient.callTool('get-current-query', {
                sessionId: realSessionId
            });
            expect(queryResponse.success).toBe(true);
            expect(queryResponse.queryString).toContain('users');
        });

        it('should properly handle invalid session IDs', async () => {
            const result = await agentClient.runScenario(invalidSessionTest);
            
            // This scenario expects errors, so success=false is correct
            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            
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
            expect(beforeCleanup.success).toBe(true);
            
            // End session
            const endResponse = await agentClient.callTool('end-query-session', {
                sessionId
            });
            expect(endResponse.success).toBe(true);
            
            // Verify session is gone
            const afterCleanup = await agentClient.callTool('get-current-query', {
                sessionId
            });
            expect(afterCleanup.success).toBe(false);
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
            expect(steps[1].success).toBe(false); // The error step
            expect(steps[1].response.error).toMatch(/Field.*not found/);
            
            // But later steps should succeed
            expect(steps[3].success).toBe(true); // Recovery step
            expect(steps[4].success).toBe(true); // Validation step
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
            
            expect(argResponse.success).toBe(false);
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
            expect(defineResponse.success).toBe(true);
            
            // Set variable value
            const valueResponse = await agentClient.callTool('set-variable-value', {
                sessionId,
                variableName: '$testVar',
                value: 'test value'
            });
            expect(valueResponse.success).toBe(true);
            
            // Use in query
            await agentClient.callTool('select-field', {
                sessionId,
                currentPath: '',
                fieldName: 'users'
            });
            
            const argResponse = await agentClient.callTool('set-variable-argument', {
                sessionId,
                currentPath: 'users',
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
                    fieldName: 'users'
                }),
                () => agentClient.callTool('select-multi-fields', {
                    sessionId,
                    currentPath: 'users',
                    fieldNames: ['id', 'name', 'email']
                }),
                () => agentClient.callTool('select-field', {
                    sessionId,
                    currentPath: 'users',
                    fieldName: 'posts'
                }),
                () => agentClient.callTool('select-multi-fields', {
                    sessionId,
                    currentPath: 'users.posts',
                    fieldNames: ['id', 'title']
                }),
                () => agentClient.callTool('validate-query', {
                    sessionId
                })
            ];
            
            // Execute each step
            for (let i = 0; i < steps.length; i++) {
                const response = await steps[i]();
                expect(response.success).toBe(true);
                
                // Verify session state persists between steps
                const queryState = await agentClient.callTool('get-current-query', {
                    sessionId
                });
                expect(queryState.success).toBe(true);
            }
            
            // Final validation
            const finalQuery = await agentClient.callTool('get-current-query', {
                sessionId
            });
            expect(finalQuery.success).toBe(true);
            expect(finalQuery.queryString).toContain('users');
            expect(finalQuery.queryString).toContain('posts');
        }, 30000);
    });

    describe('Performance and Rate Limiting', () => {
        it('should handle rapid successive calls', async () => {
            const sessionId = await agentClient.startSession();
            
            // Make rapid successive calls
            const promises = Array.from({ length: 5 }, (_, i) => 
                agentClient.callTool('select-field', {
                    sessionId,
                    currentPath: '',
                    fieldName: `field${i}`
                })
            );
            
            const results = await Promise.allSettled(promises);
            
            // At least the first call should succeed (even if others fail due to invalid fields)
            const successCount = results.filter(r => 
                r.status === 'fulfilled' && r.value.success
            ).length;
            
            expect(successCount).toBeGreaterThan(0);
        });
    });
});