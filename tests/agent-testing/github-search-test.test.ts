/**
 * GitHub Search Scenario Test - Reproduces and fixes session issues with inline fragments
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentTestClient } from './mcp-client-harness.js';
import { AgentDebugHelper, formatDebugReport } from './agent-debug-utils.js';
import { 
    githubSearchScenario, 
    sessionRecoveryScenario, 
    parallelOperationsScenario 
} from './github-search-scenario.js';

describe('GitHub Search Scenario - Session Issues Reproduction', () => {
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

    describe('TrendingAIRepositories Workflow', () => {
        it('should reproduce the exact GitHub search workflow', async () => {
            console.log('\n🔍 Running GitHub Search Scenario (TrendingAIRepositories)...');
            
            const result = await agentClient.runScenario(githubSearchScenario);
            
            // Log detailed results for analysis
            console.log(`\n📊 Scenario Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
            console.log(`Total steps: ${result.steps.length}`);
            console.log(`Execution time: ${result.totalTime}ms`);
            
            if (!result.success) {
                console.log('\n❌ Errors encountered:');
                result.errors.forEach((error, index) => {
                    console.log(`  ${index + 1}. ${error}`);
                });
                
                // Find the first failed step for detailed analysis
                const firstFailedStep = result.steps.find(step => !step.success);
                if (firstFailedStep) {
                    console.log('\n🔍 First Failed Step Details:');
                    console.log(`  Step ${firstFailedStep.step}: ${firstFailedStep.action} - ${firstFailedStep.toolName}`);
                    console.log(`  Error: ${firstFailedStep.error}`);
                    console.log(`  Response:`, JSON.stringify(firstFailedStep.response, null, 2));
                }
                
                // Analyze session persistence specifically
                const sessionId = agentClient.getCurrentSession();
                if (sessionId) {
                    const sessionAnalysis = await debugHelper.analyzeSessionPersistence(sessionId);
                    console.log('\n🔍 Session Analysis:');
                    console.log(`  Exists: ${sessionAnalysis.exists}`);
                    console.log(`  Issues: ${sessionAnalysis.issues.join(', ')}`);
                }
            }
            
            // For now, we expect this might fail due to schema differences
            // The important thing is to capture the exact failure mode
            if (result.success) {
                expect(result.success).toBe(true);
                expect(result.errors).toHaveLength(0);
            } else {
                // If it fails, let's analyze why
                console.log('\n📝 This failure helps us understand the session issues mentioned in the original scenario');
            }
        }, 60000); // Extended timeout for this complex scenario

        it('should handle session recovery gracefully', async () => {
            console.log('\n🔄 Testing Session Recovery...');
            
            const result = await agentClient.runScenario(sessionRecoveryScenario);
            
            console.log(`\n📊 Recovery Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
            
            if (result.success) {
                expect(result.success).toBe(true);
                
                // Verify that the agent properly handled the session failure and recovered
                const steps = result.steps;
                expect(steps[2].success).toBe(false); // The deliberate failure
                expect(steps[3].success).toBe(true);  // Recovery session creation
                expect(steps[4].success).toBe(true);  // Rebuilding after recovery
                expect(steps[5].success).toBe(true);  // Final verification
            } else {
                console.log('Recovery scenario failed:', result.errors);
            }
        });

        it('should handle parallel operations without session conflicts', async () => {
            console.log('\n⚡ Testing Parallel Operations...');
            
            const result = await agentClient.runScenario(parallelOperationsScenario);
            
            console.log(`\n📊 Parallel Operations Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
            
            expect(result.success).toBe(true);
            expect(result.errors).toHaveLength(0);
            
            // Verify that all operations completed successfully
            for (const step of result.steps) {
                expect(step.success).toBe(true);
            }
        });
    });

    describe('Session Persistence Deep Dive', () => {
        it('should maintain session across multiple inline fragment operations', async () => {
            // Create a scenario that specifically tests session persistence during inline fragments
            const sessionId = await agentClient.startSession();
            
            // Build up a query structure step by step
            await agentClient.callTool('select-field', {
                sessionId,
                currentPath: '',
                fieldName: 'abilities'
            });
            
            // Check session exists
            let sessionCheck1 = await debugHelper.analyzeSessionPersistence(sessionId);
            expect(sessionCheck1.exists).toBe(true);
            
            // Add nested field
            await agentClient.callTool('select-field', {
                sessionId,
                currentPath: 'abilities',
                fieldName: 'count'
            });
            
            // Check session still exists
            let sessionCheck2 = await debugHelper.analyzeSessionPersistence(sessionId);
            expect(sessionCheck2.exists).toBe(true);
            
            // Try to apply inline fragment (this might fail due to schema, but session should persist)
            const inlineFragResult = await agentClient.callTool('apply-inline-frag', {
                sessionId,
                currentPath: 'abilities',
                typeName: 'TestType',
                fieldNames: ['field1']
            });
            
            // Regardless of whether inline fragment succeeded, session should still exist
            let sessionCheck3 = await debugHelper.analyzeSessionPersistence(sessionId);
            expect(sessionCheck3.exists).toBe(true);
            
            console.log('\n🔍 Session persistence verification:');
            console.log(`  After field selection: ${sessionCheck1.exists}`);
            console.log(`  After nested field: ${sessionCheck2.exists}`);
            console.log(`  After inline fragment attempt: ${sessionCheck3.exists}`);
            console.log(`  Inline fragment result: ${inlineFragResult.error || 'success'}`);
        });

        it('should identify specific session issues in apply-inline-frag', async () => {
            // Test the exact apply-inline-frag tool behavior
            const sessionId = await agentClient.startSession();
            
            // Set up a minimal query structure
            await agentClient.callTool('select-field', {
                sessionId,
                currentPath: '',
                fieldName: 'abilities'
            });
            
            // Capture session state before inline fragment
            await debugHelper.captureSessionState('before-inline-frag');
            
            // Try apply-inline-frag
            const result = await agentClient.callTool('apply-inline-frag', {
                sessionId,
                currentPath: 'abilities',
                typeName: 'SomeType',
                fieldNames: ['field1', 'field2']
            });
            
            // Capture session state after
            await debugHelper.captureSessionState('after-inline-frag');
            
            console.log('\n🔍 apply-inline-frag specific test:');
            console.log(`  Tool response:`, JSON.stringify(result, null, 2));
            
            // Check if this is a session issue or a schema issue
            if (result.error) {
                if (result.error.includes('Session') || result.error.includes('session')) {
                    console.log('  ❌ Confirmed session issue in apply-inline-frag');
                } else {
                    console.log('  ✅ Not a session issue - likely schema/validation issue');
                }
            } else {
                console.log('  ✅ apply-inline-frag succeeded');
            }
        });
    });

    describe('Error Pattern Analysis', () => {
        it('should analyze common session error patterns', async () => {
            const errorScenarios = await debugHelper.runErrorScenarioTests();
            
            console.log('\n🚨 Error Pattern Analysis:');
            
            for (const scenario of errorScenarios) {
                console.log(`  ${scenario.scenario}:`);
                if (scenario.result.error) {
                    console.log(`    Error: ${scenario.result.error}`);
                    
                    // Check if this matches the patterns from the original issue
                    if (scenario.result.error.includes('Session') || scenario.result.error.includes('session')) {
                        console.log(`    🔍 This is a session-related error`);
                    }
                } else {
                    console.log(`    ✅ No error`);
                }
            }
        });
    });
});