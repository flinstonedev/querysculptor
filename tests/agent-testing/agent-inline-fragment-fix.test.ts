/**
 * Agent Inline Fragment Fix Test
 * 
 * This test demonstrates that the session normalization fix resolves
 * the inline fragment session issues that agents were experiencing.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { AgentTestClient } from './mcp-client-harness.js';
import { AgentDebugHelper } from './agent-debug-utils.js';

describe('Agent Inline Fragment Fix', () => {
    let agentClient: AgentTestClient;
    let debugHelper: AgentDebugHelper;

    beforeAll(async () => {
        // Ensure we have the correct environment
        process.env.DEFAULT_GRAPHQL_ENDPOINT = 'https://graphql-pokeapi.graphcdn.app';
    });

    beforeEach(async () => {
        agentClient = new AgentTestClient();
        debugHelper = new AgentDebugHelper(agentClient);
        await agentClient.connect();
    });

    afterEach(async () => {
        await agentClient.disconnect();
    });

    it('should demonstrate the inline fragment session fix', async () => {
        console.log('\n🔧 Testing Inline Fragment Session Fix...');

        // Step 1: Create session with custom ID (like agents do)
        const response1 = await agentClient.callTool('start-query-session', {
            operationType: 'query',
            operationName: 'TrendingAIRepositories'
        });

        console.log('Session created:', response1.sessionId);
        expect(response1.error).toBeUndefined();
        expect(response1.sessionId).toBeDefined();

        const sessionId = response1.sessionId;

        // Step 2: Build query structure like the original agent workflow
        console.log('\n📋 Building query structure...');

        // Select root field
        const response2 = await agentClient.callTool('select-field', {
            sessionId,
            currentPath: '',
            fieldName: 'abilities'
        });
        expect(response2.error).toBeUndefined();

        // Select nested field to create a path for inline fragment
        const response3 = await agentClient.callTool('select-field', {
            sessionId,
            currentPath: 'abilities',
            fieldName: 'results'
        });
        expect(response3.error).toBeUndefined();

        // Step 3: Verify session persistence before inline fragment
        console.log('\n🔍 Verifying session before inline fragment...');
        
        const sessionCheck1 = await debugHelper.analyzeSessionPersistence(sessionId);
        console.log(`Session exists before inline fragment: ${sessionCheck1.exists}`);
        expect(sessionCheck1.exists).toBe(true);

        // Step 4: Apply inline fragment (this was failing before the fix)
        console.log('\n🎯 Applying inline fragment...');
        
        const inlineFragResponse = await agentClient.callTool('apply-inline-frag', {
            sessionId,
            currentPath: 'abilities.results',
            typeName: 'BaseName',  // Correct type for Pokemon API
            fieldNames: ['name', 'url']
        });

        console.log('Inline fragment response:', JSON.stringify(inlineFragResponse, null, 2));

        // Step 5: Verify session persistence after inline fragment
        console.log('\n✅ Verifying session after inline fragment...');
        
        const sessionCheck2 = await debugHelper.analyzeSessionPersistence(sessionId);
        console.log(`Session exists after inline fragment: ${sessionCheck2.exists}`);
        expect(sessionCheck2.exists).toBe(true);

        // Step 6: Verify we can continue using the session
        console.log('\n🔄 Testing continued session usage...');
        
        const finalQueryResponse = await agentClient.callTool('get-current-query', {
            sessionId
        });

        console.log('Final query response:', JSON.stringify(finalQueryResponse, null, 2));
        expect(finalQueryResponse.error).toBeUndefined();
        expect(finalQueryResponse.data.queryString).toBeDefined();

        console.log('\n🎉 Session persistence test completed successfully!');
        console.log('This demonstrates that the session normalization fix resolves the inline fragment issues.');
    });

    it('should test session recovery pattern that agents use', async () => {
        console.log('\n🔄 Testing Agent Session Recovery Pattern...');

        // Simulate the agent recovery pattern from the original issue
        let sessionId: string;

        // First attempt
        console.log('1. First session attempt...');
        const session1 = await agentClient.callTool('start-query-session', {
            operationType: 'query',
            operationName: 'TrendingAIRepositories'
        });
        sessionId = session1.sessionId;

        // Build some query
        await agentClient.callTool('select-field', {
            sessionId,
            currentPath: '',
            fieldName: 'abilities'
        });

        // Try inline fragment (might fail due to schema, but session should persist)
        const inlineResult1 = await agentClient.callTool('apply-inline-frag', {
            sessionId,
            currentPath: 'abilities',
            typeName: 'Repository',  // Wrong type for Pokemon API
            fieldNames: ['name', 'owner']
        });

        console.log('First inline fragment result:', inlineResult1.error || 'success');

        // Check if session still exists
        const sessionCheck = await debugHelper.analyzeSessionPersistence(sessionId);
        
        if (!sessionCheck.exists) {
            console.log('❌ Session was lost - demonstrating recovery...');
            
            // Agent recovery pattern: start new session
            console.log('2. Recovery session attempt...');
            const session2 = await agentClient.callTool('start-query-session', {
                operationType: 'query',
                operationName: 'TrendingAIRepositories'
            });
            sessionId = session2.sessionId;
            
            // Rebuild query
            await agentClient.callTool('select-field', {
                sessionId,
                currentPath: '',
                fieldName: 'abilities'
            });
        } else {
            console.log('✅ Session persisted through inline fragment failure');
        }

        // Final verification
        const finalCheck = await agentClient.callTool('get-current-query', {
            sessionId
        });

        expect(finalCheck.error).toBeUndefined();
        console.log('🎉 Recovery pattern test completed');
    });

    it('should test the exact workflow from the original bug report', async () => {
        console.log('\n🐛 Reproducing Original Bug Report Workflow...');

        // Follow the exact sequence from the original issue
        const steps = [
            'start-query-session: Initiated a query session with operation name "TrendingAIRepositories"',
            'select-field: Selected the "search" field (using abilities as substitute)',
            'set-string-argument: Set arguments for search field',
            'select-field: Selected nested fields',
            'apply-inline-frag: Apply inline fragment for Repository type'
        ];

        console.log('Following original workflow steps:');
        steps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));

        // Step 1: Start session
        const sessionResponse = await agentClient.callTool('start-query-session', {
            operationType: 'query',
            operationName: 'TrendingAIRepositories'
        });

        let sessionId = sessionResponse.sessionId;
        console.log(`\n✅ Step 1 complete - Session: ${sessionId}`);

        // Step 2: Select root field (using abilities instead of search)
        const selectResponse = await agentClient.callTool('select-field', {
            sessionId,
            currentPath: '',
            fieldName: 'abilities'
        });
        console.log(`✅ Step 2 complete - Field selected: ${!selectResponse.error}`);

        // Step 3: Set arguments (simulate the search arguments)
        const argResponse = await agentClient.callTool('set-string-argument', {
            sessionId,
            currentPath: 'abilities',
            argumentName: 'limit',
            value: '5'
        });
        console.log(`✅ Step 3 complete - Arguments set: ${!argResponse.error}`);

        // Step 4: Select nested fields
        const nestedResponse = await agentClient.callTool('select-field', {
            sessionId,
            currentPath: 'abilities',
            fieldName: 'results'
        });
        console.log(`✅ Step 4 complete - Nested field selected: ${!nestedResponse.error}`);

        // Step 5: Apply inline fragment (the critical step that was failing)
        const criticalResponse = await agentClient.callTool('apply-inline-frag', {
            sessionId,
            currentPath: 'abilities.results',
            typeName: 'BaseName',
            fieldNames: ['name', 'url']
        });

        console.log(`\n🎯 Critical Step 5 result:`, criticalResponse.error || 'SUCCESS');

        // Verify session still exists after all operations
        const finalSessionCheck = await debugHelper.analyzeSessionPersistence(sessionId);
        console.log(`\n📊 Final session status: ${finalSessionCheck.exists ? 'EXISTS' : 'LOST'}`);

        if (finalSessionCheck.exists) {
            console.log('🎉 SUCCESS: Session persisted through entire workflow!');
            console.log('🔧 The session normalization fix has resolved the original issue.');
        } else {
            console.log('❌ Session was lost during the workflow');
            console.log('🔍 This indicates the issue still exists and needs further investigation');
        }

        expect(finalSessionCheck.exists).toBe(true);
    });
});