/**
 * Inline Fragment Session Bug Reproduction
 * 
 * This test reproduces the specific session bug where apply-inline-frag
 * fails to find sessions that should exist.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentTestClient } from './mcp-client-harness.js';

describe('Inline Fragment Session Bug', () => {
    let agentClient: AgentTestClient;

    beforeEach(async () => {
        // Set the correct GraphQL endpoint for testing
        process.env.DEFAULT_GRAPHQL_ENDPOINT = 'https://graphql-pokeapi.graphcdn.app';
        
        agentClient = new AgentTestClient();
        await agentClient.connect();
    });

    afterEach(async () => {
        await agentClient.disconnect();
    });

    it('should reproduce session not found issue in apply-inline-frag', async () => {
        console.log('\n🔍 Testing apply-inline-frag session handling...');

        // Step 1: Create a session and verify it works
        const sessionResponse = await agentClient.callTool('start-query-session', {
            operationType: 'query',
            operationName: 'TestQuery'
        });
        
        console.log('Session creation response:', JSON.stringify(sessionResponse, null, 2));
        expect(sessionResponse.error).toBeUndefined();
        expect(sessionResponse.sessionId).toBeDefined();
        
        const sessionId = sessionResponse.sessionId;

        // Step 2: Verify session exists by using it in another tool
        const verifyResponse = await agentClient.callTool('get-current-query', {
            sessionId
        });
        
        console.log('Session verification response:', JSON.stringify(verifyResponse, null, 2));
        expect(verifyResponse.error).toBeUndefined();

        // Step 3: Build a minimal query structure for inline fragment test
        const selectResponse = await agentClient.callTool('select-field', {
            sessionId,
            currentPath: '',
            fieldName: 'abilities'
        });
        
        console.log('Select field response:', JSON.stringify(selectResponse, null, 2));
        expect(selectResponse.error).toBeUndefined();

        // Step 4: Try to apply inline fragment - this is where the bug occurs
        const inlineFragResponse = await agentClient.callTool('apply-inline-frag', {
            sessionId,
            currentPath: 'abilities',
            typeName: 'TestType',
            fieldNames: ['testField']
        });
        
        console.log('Inline fragment response:', JSON.stringify(inlineFragResponse, null, 2));
        
        // Analyze the response to understand the session issue
        if (inlineFragResponse.error) {
            if (inlineFragResponse.error.includes('Session') || inlineFragResponse.error.includes('session')) {
                console.log('❌ CONFIRMED: Session not found error in apply-inline-frag');
                console.log(`Error: ${inlineFragResponse.error}`);
                
                // This is the bug we need to fix!
                // The session should exist but apply-inline-frag can't find it
                
                // Let's verify the session still exists with other tools
                const sessionCheckResponse = await agentClient.callTool('get-current-query', {
                    sessionId
                });
                
                if (sessionCheckResponse.error) {
                    console.log('❌ Session is genuinely lost');
                    expect.fail('Session was lost during apply-inline-frag call');
                } else {
                    console.log('✅ Session still exists - this is a bug in apply-inline-frag');
                    expect.fail(`apply-inline-frag has a session handling bug: ${inlineFragResponse.error}`);
                }
            } else {
                console.log('✅ Error is not session-related, likely schema validation');
                console.log(`Error: ${inlineFragResponse.error}`);
                // This is expected - the error should be about schema/field validation, not sessions
            }
        } else {
            console.log('✅ apply-inline-frag succeeded');
            expect(inlineFragResponse.error).toBeUndefined();
        }
    });

    it('should test session ID handling in apply-inline-frag specifically', async () => {
        console.log('\n🔍 Testing session ID handling edge cases...');

        // Create session
        const sessionResponse = await agentClient.callTool('start-query-session');
        const sessionId = sessionResponse.sessionId;
        
        // Test with various session ID formats to see if normalization is the issue
        const sessionIdVariants = [
            sessionId,                    // Original
            sessionId.toUpperCase(),      // Uppercase
            ` ${sessionId} `,            // With whitespace
            sessionId.toLowerCase(),      // Lowercase
        ];

        for (const testSessionId of sessionIdVariants) {
            console.log(`\nTesting with session ID: "${testSessionId}"`);
            
            const response = await agentClient.callTool('apply-inline-frag', {
                sessionId: testSessionId,
                currentPath: '',
                typeName: 'TestType',
                fieldNames: ['testField']
            });
            
            console.log(`Response: ${response.error || 'success'}`);
            
            if (response.error && response.error.includes('session')) {
                console.log(`❌ Session issue with variant: "${testSessionId}"`);
            }
        }
    });

    it('should compare apply-inline-frag session handling with other tools', async () => {
        console.log('\n🔍 Comparing session handling across tools...');

        const sessionResponse = await agentClient.callTool('start-query-session');
        const sessionId = sessionResponse.sessionId;

        // Test the same session ID with different tools
        const tools = [
            { name: 'get-current-query', params: { sessionId } },
            { name: 'select-field', params: { sessionId, currentPath: '', fieldName: 'abilities' } },
            { name: 'get-current-query', params: { sessionId } }, // Check again after select-field
            { name: 'apply-inline-frag', params: { sessionId, currentPath: '', typeName: 'TestType', fieldNames: ['testField'] } },
            { name: 'get-current-query', params: { sessionId } }, // Check again after apply-inline-frag
        ];

        for (const tool of tools) {
            console.log(`\nTesting ${tool.name}...`);
            
            const response = await agentClient.callTool(tool.name, tool.params);
            
            if (response.error) {
                if (response.error.includes('session') || response.error.includes('Session')) {
                    console.log(`❌ ${tool.name}: SESSION ERROR - ${response.error}`);
                } else {
                    console.log(`⚠️  ${tool.name}: Other error - ${response.error}`);
                }
            } else {
                console.log(`✅ ${tool.name}: Success`);
            }
        }
    });
});