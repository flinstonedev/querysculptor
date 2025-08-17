#!/usr/bin/env tsx
/**
 * Simple debug test for session persistence
 */

import { AgentTestClient } from './tests/agent-testing/mcp-client-harness.js';

async function debugSession() {
    console.log('🔍 Testing Session Persistence...');
    
    // Set environment to use real Redis and Pokemon API
    process.env.USE_REAL_REDIS = 'true';
    process.env.DEFAULT_GRAPHQL_ENDPOINT = 'https://graphql-pokeapi.graphcdn.app';
    
    const client = new AgentTestClient();
    
    try {
        await client.connect();
        console.log('✅ Connected to MCP server');
        
        // Step 1: Create session
        const sessionResponse = await client.callTool('start-query-session');
        if (sessionResponse.error) {
            console.log(`❌ Failed to create session: ${sessionResponse.error}`);
            return;
        }
        
        const sessionId = sessionResponse.sessionId;
        console.log(`📋 Session created: ${sessionId}`);
        
        // Step 2: Immediately check if session exists
        const checkResponse1 = await client.callTool('get-current-query', { sessionId });
        console.log(`🔍 Immediate check - Session exists: ${!checkResponse1.error}`);
        if (checkResponse1.error) {
            console.log(`❌ Error: ${checkResponse1.error}`);
        }
        
        // Step 3: Add a field to modify the session
        const fieldResponse = await client.callTool('select-field', {
            sessionId,
            currentPath: '',
            fieldName: 'pokemon'
        });
        console.log(`📝 Field added - Success: ${!fieldResponse.error}`);
        if (fieldResponse.error) {
            console.log(`❌ Error: ${fieldResponse.error}`);
        }
        
        // Step 4: Check session again
        const checkResponse2 = await client.callTool('get-current-query', { sessionId });
        console.log(`🔍 After field addition - Session exists: ${!checkResponse2.error}`);
        if (checkResponse2.error) {
            console.log(`❌ Error: ${checkResponse2.error}`);
        } else {
            console.log(`✅ Query: ${checkResponse2.queryString}`);
        }
        
    } catch (error) {
        console.log(`💥 Test failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        await client.disconnect();
    }
}

if (import.meta.url.endsWith(process.argv[1])) {
    debugSession();
}