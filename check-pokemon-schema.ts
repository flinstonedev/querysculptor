#!/usr/bin/env tsx
/**
 * Check Pokemon API schema structure
 */

import { AgentTestClient } from './tests/agent-testing/mcp-client-harness.js';

async function checkSchema() {
    console.log('🔍 Checking Pokemon API Schema...');
    
    process.env.DEFAULT_GRAPHQL_ENDPOINT = 'https://graphql-pokeapi.graphcdn.app';
    
    const client = new AgentTestClient();
    
    try {
        await client.connect();
        console.log('✅ Connected to MCP server');
        
        // Start session and introspect schema
        const sessionResponse = await client.callTool('start-query-session');
        const sessionId = sessionResponse.sessionId;
        console.log(`📋 Session: ${sessionId}`);
        
        // Get root types
        const rootTypes = await client.callTool('get-root-operation-types', { sessionId });
        console.log('📚 Root operation types:', JSON.stringify(rootTypes, null, 2));
        
        // Get Query type info
        const queryInfo = await client.callTool('get-type-info', { 
            sessionId, 
            typeName: 'Query' 
        });
        console.log('🔍 Query type fields:', JSON.stringify(queryInfo.fields?.slice(0, 10), null, 2));
        
        // Check if abilities field exists
        const abilitiesInfo = await client.callTool('get-field-info', {
            sessionId,
            fieldName: 'abilities',
            parentType: 'Query'
        });
        console.log('🎯 Abilities field info:', JSON.stringify(abilitiesInfo, null, 2));
        
    } catch (error) {
        console.log(`💥 Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        await client.disconnect();
    }
}

if (import.meta.url.endsWith(process.argv[1])) {
    checkSchema();
}