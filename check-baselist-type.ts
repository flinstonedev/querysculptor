#!/usr/bin/env tsx
/**
 * Check BaseList type structure
 */

import { AgentTestClient } from './tests/agent-testing/mcp-client-harness.js';

async function checkBaseListType() {
    console.log('🔍 Checking BaseList type...');
    
    process.env.DEFAULT_GRAPHQL_ENDPOINT = 'https://graphql-pokeapi.graphcdn.app';
    
    const client = new AgentTestClient();
    
    try {
        await client.connect();
        
        const sessionResponse = await client.callTool('start-query-session');
        const sessionId = sessionResponse.sessionId;
        
        // Check BaseList type
        const baseListInfo = await client.callTool('get-type-info', { 
            sessionId, 
            typeName: 'BaseList' 
        });
        
        if (baseListInfo.fields) {
            console.log('BaseList fields:');
            baseListInfo.fields.forEach(field => {
                console.log(`  - ${field.name}: ${field.type}`);
            });
        } else {
            console.log('BaseList info:', JSON.stringify(baseListInfo, null, 2));
        }
        
    } catch (error) {
        console.log(`💥 Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        await client.disconnect();
    }
}

if (import.meta.url.endsWith(process.argv[1])) {
    checkBaseListType();
}