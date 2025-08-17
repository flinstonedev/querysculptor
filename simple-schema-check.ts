#!/usr/bin/env tsx
/**
 * Simple Pokemon API schema check
 */

import { AgentTestClient } from './tests/agent-testing/mcp-client-harness.js';

async function checkSchema() {
    console.log('🔍 Checking Pokemon API Schema...');
    
    process.env.DEFAULT_GRAPHQL_ENDPOINT = 'https://graphql-pokeapi.graphcdn.app';
    
    const client = new AgentTestClient();
    
    try {
        await client.connect();
        
        // Start session and introspect schema
        const sessionResponse = await client.callTool('start-query-session');
        const sessionId = sessionResponse.sessionId;
        
        // Introspect the schema to see what's available
        const schemaResponse = await client.callTool('introspect-schema', { sessionId });
        console.log('Schema introspection successful:', !schemaResponse.error);
        
        // Check Query type
        const queryInfo = await client.callTool('get-type-info', { 
            sessionId, 
            typeName: 'Query' 
        });
        
        if (queryInfo.fields) {
            console.log('Available Query fields:');
            queryInfo.fields.forEach((field, index) => {
                if (index < 15) { // Show first 15 fields
                    console.log(`  - ${field.name}: ${field.type}`);
                }
            });
        }
        
    } catch (error) {
        console.log(`💥 Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        await client.disconnect();
    }
}

if (import.meta.url.endsWith(process.argv[1])) {
    checkSchema();
}