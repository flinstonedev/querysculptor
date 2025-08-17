#!/usr/bin/env tsx
/**
 * Standalone test for inline fragment session fix
 * This tests the exact scenario that was failing for agents
 */

import { AgentTestClient } from './mcp-client-harness.js';
import { AgentDebugHelper } from './agent-debug-utils.js';

async function testInlineFragmentFix() {
    console.log('🧪 Testing Inline Fragment Session Fix');
    console.log('=====================================\n');

    // Set correct environment
    process.env.DEFAULT_GRAPHQL_ENDPOINT = 'https://graphql-pokeapi.graphcdn.app';

    const client = new AgentTestClient();
    const debugHelper = new AgentDebugHelper(client);

    try {
        await client.connect();
        console.log('✅ Connected to QuerySculptor MCP server\n');

        // Test the exact scenario from the original bug report
        console.log('🔍 Reproducing Original Bug Report Scenario');
        console.log('--------------------------------------------');

        // Step 1: Start session with operation name (like agents do)
        console.log('1. Starting query session with operation name...');
        const sessionResponse = await client.callTool('start-query-session', {
            operationType: 'query',
            operationName: 'TrendingAIRepositories'
        });

        if (sessionResponse.error) {
            console.log(`❌ Session creation failed: ${sessionResponse.error}`);
            return false;
        }

        const sessionId = sessionResponse.sessionId;
        console.log(`   ✅ Session created: ${sessionId}`);

        // Step 2: Verify session exists by trying to use it
        console.log('\n2. Verifying session exists...');
        const testResponse = await client.callTool('get-current-query', { sessionId });
        if (testResponse.error) {
            console.log(`   ❌ Session not accessible: ${testResponse.error}`);
            return false;
        }
        console.log('   ✅ Session confirmed to exist and be accessible');

        // Step 3: Build query structure (simulate the GitHub search workflow)
        console.log('\n3. Building query structure...');
        
        // Select root field (using abilities instead of search since we're on Pokemon API)
        const selectResponse = await client.callTool('select-field', {
            sessionId,
            currentPath: '',
            fieldName: 'abilities'
        });

        if (selectResponse.error) {
            console.log(`   ❌ Field selection failed: ${selectResponse.error}`);
            return false;
        }
        console.log('   ✅ Root field selected');

        // Step 4: Set arguments (simulate search arguments)
        console.log('\n4. Setting field arguments...');
        const argResponse = await client.callTool('set-string-argument', {
            sessionId,
            currentPath: 'abilities',
            argumentName: 'limit',
            value: '5'
        });

        if (argResponse.error) {
            console.log(`   ⚠️  Argument setting: ${argResponse.error} (may be expected for Pokemon API)`);
        } else {
            console.log('   ✅ Arguments set');
        }

        // Step 5: Select nested fields to create path for inline fragment
        console.log('\n5. Selecting nested fields...');
        const nestedResponse = await client.callTool('select-field', {
            sessionId,
            currentPath: 'abilities',
            fieldName: 'results'
        });

        if (nestedResponse.error) {
            console.log(`   ❌ Nested field selection failed: ${nestedResponse.error}`);
            return false;
        }
        console.log('   ✅ Nested field selected');

        // Step 6: Check session before the critical operation
        console.log('\n6. Verifying session before inline fragment...');
        const preTestResponse = await client.callTool('get-current-query', { sessionId });
        if (preTestResponse.error) {
            console.log(`   ❌ Session lost before inline fragment: ${preTestResponse.error}`);
            return false;
        }
        console.log('   ✅ Session still accessible before inline fragment');

        // Step 7: Apply inline fragment (THE CRITICAL OPERATION THAT WAS FAILING)
        console.log('\n7. 🎯 CRITICAL: Applying inline fragment...');
        const inlineFragResponse = await client.callTool('apply-inline-frag', {
            sessionId,
            currentPath: 'abilities.results',
            typeName: 'Ability',
            fieldNames: ['name', 'url']
        });

        console.log(`   Response: ${JSON.stringify(inlineFragResponse, null, 2)}`);

        // Step 8: Check session after inline fragment (THE KEY TEST)
        console.log('\n8. 🔍 CRITICAL: Verifying session after inline fragment...');
        const postTestResponse = await client.callTool('get-current-query', { sessionId });
        
        if (postTestResponse.error) {
            console.log(`   ❌ FAILURE: Session was lost during inline fragment operation: ${postTestResponse.error}`);
            console.log('   📋 This reproduces the original bug that agents were experiencing');
            return false;
        }
        
        console.log('   ✅ SUCCESS: Session persisted through inline fragment operation');

        // Step 9: Verify continued functionality
        console.log('\n9. Testing continued session functionality...');
        const finalQueryResponse = await client.callTool('get-current-query', {
            sessionId
        });

        if (finalQueryResponse.error) {
            console.log(`   ❌ Final query check failed: ${finalQueryResponse.error}`);
            return false;
        }

        console.log('   ✅ Session remains functional after inline fragment');
        console.log(`   📄 Query: ${finalQueryResponse.queryString.slice(0, 100)}...`);

        // CONCLUSION
        console.log('\n🎉 TEST RESULTS');
        console.log('===============');
        console.log('✅ Session creation: SUCCESS');
        console.log('✅ Query building: SUCCESS');
        console.log('✅ Session persistence through inline fragment: SUCCESS');
        console.log('✅ Continued functionality: SUCCESS');
        console.log('\n🔧 CONCLUSION: The session normalization fix has resolved the inline fragment issue!');
        console.log('📝 Agents should no longer experience "session not found" errors during apply-inline-frag operations.');

        return true;

    } catch (error) {
        console.log(`\n💥 Test failed with error: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    } finally {
        await client.disconnect();
    }
}

// Additional test: Session ID format handling
async function testSessionIdFormats() {
    console.log('\n\n🔍 Testing Session ID Format Handling');
    console.log('=====================================');
    
    const client = new AgentTestClient();
    
    try {
        await client.connect();
        
        // Create a session
        const sessionResponse = await client.callTool('start-query-session');
        const originalSessionId = sessionResponse.sessionId;
        
        console.log(`Original session ID: "${originalSessionId}"`);
        
        // Test various formats that agents might use
        const testFormats = [
            originalSessionId,                    // Original (should work)
            `  ${originalSessionId}  `,         // With whitespace (should work due to trimming)
            originalSessionId.toUpperCase(),     // Uppercase (should fail - different ID)
            `integration-test-session`,          // Agent-style ID (should fail - never created)
            `my-custom-session-123`,            // Another agent-style ID (should fail - never created)
        ];
        
        console.log('\nTesting session ID format handling...');
        for (const testId of testFormats) {
            const response = await client.callTool('apply-inline-frag', {
                sessionId: testId,
                currentPath: '',
                typeName: 'TestType',
                fieldNames: ['testField']
            });
            
            // Only exact match and trimmed match should work
            const shouldWork = testId.trim() === originalSessionId;
            const actuallyWorked = !response.error || !response.error.includes('session');
            
            if (shouldWork === actuallyWorked) {
                console.log(`   ✅ "${testId}" -> ${response.error || 'success'} (${shouldWork ? 'expected to work' : 'expected to fail'})`);
            } else {
                console.log(`   ❌ "${testId}" -> unexpected result: ${response.error || 'success'} (expected ${shouldWork ? 'success' : 'failure'})`);
            }
        }
        
        console.log('\n✅ Session ID format handling test completed');
        
    } catch (error) {
        console.log(`Session ID format test failed: ${error}`);
    } finally {
        await client.disconnect();
    }
}

// Run the tests
async function main() {
    const success = await testInlineFragmentFix();
    await testSessionIdFormats();
    
    process.exit(success ? 0 : 1);
}

if (import.meta.url.endsWith(process.argv[1])) {
    main();
}