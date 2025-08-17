#!/usr/bin/env tsx
/**
 * Test the improved session ID validation in normalizeSessionId
 */

import { AgentTestClient } from './mcp-client-harness.js';

async function testSessionValidation() {
    console.log('🔒 Testing Session ID Validation');
    console.log('================================\n');

    const client = new AgentTestClient();
    
    try {
        await client.connect();
        
        const testCases = [
            // Valid cases
            { id: 'valid-session-123', expected: 'success', description: 'Valid alphanumeric with dashes' },
            { id: 'abcdef1234567890', expected: 'success', description: 'Valid hex string' },
            { id: '  trimmed-session  ', expected: 'success', description: 'Valid with whitespace (trimmed)' },
            
            // Invalid cases that should be caught by validation
            { id: '', expected: 'error', description: 'Empty string' },
            { id: '   ', expected: 'error', description: 'Only whitespace' },
            { id: 'session:with:colons', expected: 'error', description: 'Contains colons (Redis injection)' },
            { id: 'session\nwith\nnewlines', expected: 'error', description: 'Contains newlines' },
            { id: 'session\rwith\rcarriage', expected: 'error', description: 'Contains carriage returns' },
        ];

        console.log('Testing session ID validation...\n');
        
        for (const testCase of testCases) {
            console.log(`Testing: "${testCase.id}" (${testCase.description})`);
            
            try {
                const response = await client.callTool('get-current-query', {
                    sessionId: testCase.id
                });
                
                if (testCase.expected === 'success') {
                    // For valid IDs, we expect a "Session not found" error (since we didn't create these sessions)
                    // but NOT a validation error
                    if (response.error && response.error.includes('Session') && response.error.includes('not found')) {
                        console.log('   ✅ Valid ID format (session not found as expected)');
                    } else if (response.error && (response.error.includes('invalid') || response.error.includes('empty') || response.error.includes('characters'))) {
                        console.log(`   ❌ Unexpected validation error: ${response.error}`);
                    } else {
                        console.log('   ✅ Valid ID accepted');
                    }
                } else {
                    // For invalid IDs, we expect validation errors
                    if (response.error && (response.error.includes('invalid') || response.error.includes('empty') || response.error.includes('characters'))) {
                        console.log(`   ✅ Correctly rejected: ${response.error}`);
                    } else {
                        console.log(`   ❌ Should have been rejected but got: ${response.error || 'success'}`);
                    }
                }
                
            } catch (error) {
                if (testCase.expected === 'error') {
                    console.log(`   ✅ Correctly threw error: ${error instanceof Error ? error.message : String(error)}`);
                } else {
                    console.log(`   ❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
        
        console.log('\n🎉 Session validation test completed');
        
    } catch (error) {
        console.log(`Test failed: ${error}`);
    } finally {
        await client.disconnect();
    }
}

if (import.meta.url.endsWith(process.argv[1])) {
    testSessionValidation();
}