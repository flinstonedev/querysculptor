#!/usr/bin/env tsx
/**
 * Agent Test Runner - Comprehensive testing of QuerySculptor from an agent's perspective
 * 
 * Usage:
 *   pnpm run test:agent          # Run all agent tests
 *   pnpm run test:agent --basic  # Run basic workflow tests only
 *   pnpm run test:agent --debug  # Run with detailed debugging output
 *   pnpm run test:agent --errors # Run error scenario tests only
 */

import { config } from 'dotenv';
import { AgentTestClient } from './mcp-client-harness.js';
import { AgentDebugHelper, formatDebugReport } from './agent-debug-utils.js';
import { allScenarios, scenarioGroups } from './agent-workflow-scenarios.js';

// Load environment variables
config({ path: '.env' });

interface TestRunOptions {
    scenarios: 'all' | 'basic' | 'advanced' | 'errorHandling';
    debug: boolean;
    verbose: boolean;
    outputFile?: string;
}

async function runAgentTests(options: TestRunOptions = { scenarios: 'all', debug: false, verbose: false }) {
    console.log('🤖 QuerySculptor Agent Testing Framework');
    console.log('=========================================\n');

    const client = new AgentTestClient();
    const debugHelper = new AgentDebugHelper(client);

    try {
        await client.connect();
        console.log('✅ Connected to QuerySculptor MCP server\n');

        // Select scenarios to run
        const scenariosToRun = scenarioGroups[options.scenarios] || allScenarios;
        console.log(`📋 Running ${scenariosToRun.length} scenarios (${options.scenarios} group)\n`);

        const results = [];
        let passCount = 0;
        let failCount = 0;

        // Run each scenario
        for (let i = 0; i < scenariosToRun.length; i++) {
            const scenario = scenariosToRun[i];
            console.log(`🔄 [${i + 1}/${scenariosToRun.length}] ${scenario.name}`);
            
            const startTime = Date.now();
            
            try {
                // Capture session state before scenario if debugging
                if (options.debug) {
                    await debugHelper.captureSessionState(`before-${scenario.name}`);
                }

                const result = await client.runScenario(scenario);
                results.push(result);

                const duration = Date.now() - startTime;
                
                if (result.success) {
                    console.log(`   ✅ PASSED (${duration}ms)`);
                    passCount++;
                } else {
                    console.log(`   ❌ FAILED (${duration}ms)`);
                    console.log(`      Errors: ${result.errors.join(', ')}`);
                    
                    // Debug output for first failed step
                    if (options.debug && result.steps.length > 0) {
                        const firstFailedStep = result.steps.find(s => !s.success);
                        if (firstFailedStep) {
                            console.log(`      Debug - Failed step response:`, JSON.stringify(firstFailedStep.response, null, 2));
                        }
                    }
                    
                    failCount++;
                }

                if (options.verbose && result.warnings.length > 0) {
                    console.log(`      Warnings: ${result.warnings.join(', ')}`);
                }

                // Capture session state after scenario if debugging
                if (options.debug) {
                    await debugHelper.captureSessionState(`after-${scenario.name}`);
                }

            } catch (error) {
                console.log(`   💥 ERROR: ${error instanceof Error ? error.message : String(error)}`);
                failCount++;
            }

            // Clear session state between scenarios
            client.clearHistory();
            console.log('');
        }

        // Generate summary
        console.log('📊 Test Summary');
        console.log('===============');
        console.log(`Total scenarios: ${scenariosToRun.length}`);
        console.log(`Passed: ${passCount} ✅`);
        console.log(`Failed: ${failCount} ❌`);
        console.log(`Success rate: ${(passCount / scenariosToRun.length * 100).toFixed(1)}%`);
        console.log('');

        // Generate debug report if requested
        if (options.debug && results.length > 0) {
            console.log('🔍 Debug Report');
            console.log('===============');
            
            const debugReport = debugHelper.generateDebugReport(results);
            const formattedReport = formatDebugReport(debugReport);
            console.log(formattedReport);

            // Save debug report to file if requested
            if (options.outputFile) {
                const fs = await import('fs');
                fs.writeFileSync(options.outputFile, formattedReport);
                console.log(`📁 Debug report saved to: ${options.outputFile}`);
            }
        }

        // Run error scenario tests if debugging
        if (options.debug) {
            console.log('🚨 Error Scenario Analysis');
            console.log('==========================');
            
            const errorScenarios = await debugHelper.runErrorScenarioTests();
            for (const scenario of errorScenarios) {
                console.log(`${scenario.scenario}: ${scenario.result.error || 'No error'}`);
            }
            console.log('');
        }

        // Exit with appropriate code
        process.exit(failCount > 0 ? 1 : 0);

    } catch (error) {
        console.error('💥 Fatal error during testing:', error);
        process.exit(1);
    } finally {
        await client.disconnect();
    }
}

// Parse command line arguments
function parseArgs(): TestRunOptions {
    const args = process.argv.slice(2);
    
    const options: TestRunOptions = {
        scenarios: 'all',
        debug: false,
        verbose: false
    };

    for (const arg of args) {
        switch (arg) {
            case '--basic':
                options.scenarios = 'basic';
                break;
            case '--advanced':
                options.scenarios = 'advanced';
                break;
            case '--errors':
                options.scenarios = 'errorHandling';
                break;
            case '--debug':
                options.debug = true;
                break;
            case '--verbose':
                options.verbose = true;
                break;
            default:
                if (arg.startsWith('--output=')) {
                    options.outputFile = arg.split('=')[1];
                }
                break;
        }
    }

    return options;
}

// Run if called directly
if (import.meta.url.endsWith(process.argv[1])) {
    const options = parseArgs();
    runAgentTests(options);
}

export { runAgentTests, parseArgs };