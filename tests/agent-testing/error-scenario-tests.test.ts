/**
 * Error Scenario Tests - Tests specific error conditions that agents might encounter
 * 
 * This test suite focuses on:
 * - Session not found errors (the main issue we just fixed)
 * - Invalid parameter handling
 * - Network/timeout scenarios
 * - Recovery patterns
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentTestClient } from './mcp-client-harness.js';
import { AgentDebugHelper, formatDebugReport } from './agent-debug-utils.js';

describe('Error Scenario Tests', () => {
    let agentClient: AgentTestClient;
    let debugHelper: AgentDebugHelper;

    beforeEach(async () => {
        agentClient = new AgentTestClient();
        debugHelper = new AgentDebugHelper(agentClient);
        await agentClient.connect();
    });

    afterEach(async () => {
        await agentClient.disconnect();
    });

    describe('Session Not Found Errors', () => {
        it('should handle completely invalid session IDs', async () => {
            const invalidSessionIds = [
                'non-existent-session',
                'integration-test-session-that-does-not-exist',
                'my-custom-session-123',
                'user-query-session-456',
                '', // empty string
                '   ', // just whitespace
                'session with spaces',
                'session-with-special-chars!@#$%',
                '123e4567-e89b-12d3-a456-426614174000' // UUID format
            ];

            const results = [];
            for (const sessionId of invalidSessionIds) {
                const response = await agentClient.callTool('get-current-query', {
                    sessionId
                });

                results.push({
                    sessionId,
                    response
                });

                // All should fail with session not found
                expect(response.error).toBeDefined();
                expect(response.error).toMatch(/Invalid sessionId|session.*not found/i);
            }

            // Debug output for manual inspection
            console.log('\nSession ID Error Test Results:');
            for (const { sessionId, response } of results) {
                console.log(`  "${sessionId}" -> ${response.error}`);
            }
        });

        it('should demonstrate the session normalization fix', async () => {
            // Start a session with a generated ID
            const sessionResponse = await agentClient.callTool('start-query-session');
            expect(sessionResponse.error).toBeUndefined();

            const sessionId = sessionResponse.sessionId;
            console.log(`\nGenerated session ID: "${sessionId}"`);

            // Build some query state
            const buildResponse = await agentClient.callTool('select-field', {
                sessionId,
                currentPath: '',
                fieldName: 'abilities'
            });
            expect(buildResponse.error).toBeUndefined();

            // Verify the exact session ID works
            const queryResponse = await agentClient.callTool('get-current-query', {
                sessionId
            });
            expect(queryResponse.error).toBeUndefined();
            const queryString = queryResponse.data.queryString;
            expect(queryString).toBeDefined();
            expect(queryString).toContain('abilities');

            // Test with slightly modified session ID (this would have failed before the fix)
            const modifiedSessionId = `  ${sessionId}  `; // with whitespace
            const modifiedResponse = await agentClient.callTool('get-current-query', {
                sessionId: modifiedSessionId
            });
            expect(modifiedResponse.error).toBeUndefined(); // Should work due to trimming
        });

        it('should handle agent-style session IDs', async () => {
            // Test the exact scenario from the system prompt and tests
            const agentStyleSessionIds = [
                'integration-test-session',
                'agent-session-001',
                'my-query-builder-session',
                'test-session-12345',
                'workflow-session-abc123'
            ];

            for (const sessionId of agentStyleSessionIds) {
                // These should fail because the session doesn't exist
                const response = await agentClient.callTool('get-current-query', {
                    sessionId
                });

                expect(response.error).toBeDefined();
                expect(response.error).toMatch(/Invalid sessionId|session.*not found/i);
                
                // But the error should be about the session not existing,
                // not about the session ID being malformed
                expect(response.error).not.toMatch(/invalid.*session.*id/i);
            }
        });
    });

    describe('Parameter Validation Errors', () => {
        it('should handle missing required parameters', async () => {
            const sessionId = await agentClient.startSession();

            // Missing fieldName
            const missingFieldName = await agentClient.callTool('select-field', {
                sessionId,
                currentPath: ''
                // fieldName is missing
            } as any);

            expect(missingFieldName.error).toBeDefined();
            expect(missingFieldName.error).toBeTruthy();

            // Missing sessionId
            const missingSessionId = await agentClient.callTool('select-field', {
                // sessionId is missing
                currentPath: '',
                fieldName: 'abilities'
            } as any);

            expect(missingSessionId.error).toBeDefined();
            expect(missingSessionId.error).toBeTruthy();
        });

        it('should handle invalid parameter types', async () => {
            const sessionId = await agentClient.startSession();

            // Non-string fieldName
            const invalidFieldName = await agentClient.callTool('select-field', {
                sessionId,
                currentPath: '',
                fieldName: 123 as any
            });

            expect(invalidFieldName.error).toBeDefined();

            // Invalid fieldName type (number instead of string)
            const invalidCurrentPath = await agentClient.callTool('select-field', {
                sessionId,
                currentPath: '',
                fieldName: 123 as any
            });

            expect(invalidCurrentPath.error).toBeDefined();
        });
    });

    describe('Schema Validation Errors', () => {
        it('should handle field not found errors', async () => {
            const sessionId = await agentClient.startSession();

            // Try to select non-existent field
            const response = await agentClient.callTool('select-field', {
                sessionId,
                currentPath: '',
                fieldName: 'nonExistentField'
            });

            expect(response.error).toBeDefined();
            expect(response.error).toMatch(/field.*not found/i);
        });

        it('should handle invalid path errors', async () => {
            const sessionId = await agentClient.startSession();

            // First add a valid field
            await agentClient.callTool('select-field', {
                sessionId,
                currentPath: '',
                fieldName: 'abilities'
            });

            // Try to select on an invalid path
            const response = await agentClient.callTool('select-field', {
                sessionId,
                currentPath: 'invalid.path',
                fieldName: 'someField'
            });

            expect(response.error).toBeDefined();
            expect(response.error).toBeTruthy();
        });
    });

    describe('Recovery Scenarios', () => {
        it('should recover from session not found by creating new session', async () => {
            // Start with invalid session
            const invalidResponse = await agentClient.callTool('get-current-query', {
                sessionId: 'invalid-session'
            });
            expect(invalidResponse.error).toBeDefined();

            // Create new session
            const newSessionId = await agentClient.startSession();
            expect(newSessionId).toBeTruthy();

            // Continue with valid workflow
            const buildResponse = await agentClient.callTool('select-field', {
                sessionId: newSessionId,
                currentPath: '',
                fieldName: 'abilities'
            });
            expect(buildResponse.error).toBeUndefined();

            const finalResponse = await agentClient.callTool('get-current-query', {
                sessionId: newSessionId
            });
            expect(finalResponse.error).toBeUndefined();
        });

        it('should recover from field errors by checking schema', async () => {
            const sessionId = await agentClient.startSession();

            // Try invalid field first
            const invalidFieldResponse = await agentClient.callTool('select-field', {
                sessionId,
                currentPath: '',
                fieldName: 'invalidField'
            });
            expect(invalidFieldResponse.error).toBeDefined();

            // Check schema to find valid fields
            const schemaResponse = await agentClient.callTool('introspect-schema', {
                sessionId
            });
            expect(schemaResponse.error).toBeUndefined();

            // Use a valid field instead
            const validFieldResponse = await agentClient.callTool('select-field', {
                sessionId,
                currentPath: '',
                fieldName: 'abilities'
            });
            expect(validFieldResponse.error).toBeUndefined();
        });
    });

    describe('Edge Case Scenarios', () => {
        it('should handle rapid session creation and deletion', async () => {
            const sessions = [];

            // Create multiple sessions rapidly
            for (let i = 0; i < 5; i++) {
                const sessionId = await agentClient.startSession();
                sessions.push(sessionId);
            }

            // Verify all sessions exist
            for (const sessionId of sessions) {
                const response = await agentClient.callTool('get-current-query', {
                    sessionId
                });
                expect(response.error).toBeUndefined();
            }

            // Delete all sessions
            for (const sessionId of sessions) {
                const response = await agentClient.callTool('end-query-session', {
                    sessionId
                });
                expect(response.error).toBeUndefined();
            }

            // Verify all sessions are gone
            for (const sessionId of sessions) {
                const response = await agentClient.callTool('get-current-query', {
                    sessionId
                });
                expect(response.error).toBeDefined();
            }
        });

        it('should handle concurrent operations on same session', async () => {
            const sessionId = await agentClient.startSession();

            // Make concurrent calls to the same session
            const promises = [
                agentClient.callTool('select-field', {
                    sessionId,
                    currentPath: '',
                    fieldName: 'abilities'
                }),
                agentClient.callTool('get-current-query', {
                    sessionId
                }),
                agentClient.callTool('select-field', {
                    sessionId,
                    currentPath: '',
                    fieldName: 'abilities'
                })
            ];

            const results = await Promise.allSettled(promises);

            // At least some should succeed (order may vary due to concurrency)
            const successCount = results.filter(r => 
                r.status === 'fulfilled' && !r.value.error
            ).length;

            expect(successCount).toBeGreaterThan(0);
        });
    });

    describe('Debug Utility Tests', () => {
        it('should analyze session persistence issues', async () => {
            // Test with non-existent session
            const analysis1 = await debugHelper.analyzeSessionPersistence('non-existent');
            expect(analysis1.exists).toBe(false);
            expect(analysis1.issues).toContain('Session not found');

            // Test with valid session that has a query
            const sessionId = await agentClient.startSession();
            
            // Add a field to make the query non-empty
            await agentClient.callTool('select-field', {
                sessionId,
                currentPath: '',
                fieldName: 'abilities'
            });
            
            const analysis2 = await debugHelper.analyzeSessionPersistence(sessionId);
            expect(analysis2.exists).toBe(true);
            expect(analysis2.issues).toEqual([]);
        });

        it('should run comprehensive error scenario tests', async () => {
            const errorScenarios = await debugHelper.runErrorScenarioTests();
            
            expect(errorScenarios).toHaveLength(5);
            
            // All should have errors
            for (const scenario of errorScenarios) {
                expect(scenario.result.error).toBeDefined();
                expect(scenario.result.error).toBeTruthy();
            }

            console.log('\nError Scenario Test Results:');
            for (const scenario of errorScenarios) {
                console.log(`  ${scenario.scenario}: ${scenario.result.error}`);
            }
        });
    });
});