#!/usr/bin/env tsx
/**
 * Check BaseName type structure
 */

import { AgentTestClient } from './tests/agent-testing/mcp-client-harness.js';

async function checkBaseNameType() {
    console.log('🔍 Checking BaseName type...');
    
    process.env.DEFAULT_GRAPHQL_ENDPOINT = 'https://graphql-pokeapi.graphcdn.app';
    
    const client = new AgentTestClient();
    
    try {
        await client.connect();
        
        const sessionResponse = await client.callTool('start-query-session');
        const sessionId = sessionResponse.sessionId;
        
        // Check BaseName type
        const baseNameInfo = await client.callTool('get-type-info', { 
            sessionId, 
            typeName: 'BaseName' 
        });
        
        if (baseNameInfo.fields) {
            console.log('BaseName fields:');
            baseNameInfo.fields.forEach(field => {
                console.log(`  - ${field.name}: ${field.type}`);
            });
        } else {
            console.log('BaseName info:', JSON.stringify(baseNameInfo, null, 2));
        }
        
    } catch (error) {
        console.log(`💥 Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        await client.disconnect();
    }
}

if (import.meta.url.endsWith(process.argv[1])) {
    checkBaseNameType();
}