/**
 * Agent Debug Utilities - Tools for debugging agent-tool interactions
 * 
 * Provides utilities to help debug issues when agents interact with QuerySculptor:
 * - Session state inspection
 * - Call trace analysis
 * - Error pattern detection
 * - Performance monitoring
 */

import { AgentTestClient, AgentTestResult, AgentStepResult } from './mcp-client-harness.js';

export interface DebugReport {
    sessionId: string | null;
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    callBreakdown: Record<string, number>;
    errorPatterns: ErrorPattern[];
    performanceMetrics: PerformanceMetrics;
    sessionStateHistory: SessionStateSnapshot[];
    recommendations: string[];
}

export interface ErrorPattern {
    pattern: string;
    occurrences: number;
    tools: string[];
    examples: string[];
}

export interface PerformanceMetrics {
    averageCallDuration: number;
    slowestCall: { tool: string; duration: number };
    fastestCall: { tool: string; duration: number };
    totalTestDuration: number;
}

export interface SessionStateSnapshot {
    timestamp: number;
    tool: string;
    queryStructure?: any;
    variables?: any;
    fragments?: any;
}

/**
 * Agent Debug Helper - Provides debugging capabilities for agent tests
 */
export class AgentDebugHelper {
    private client: AgentTestClient;
    private sessionSnapshots: SessionStateSnapshot[] = [];

    constructor(client: AgentTestClient) {
        this.client = client;
    }

    /**
     * Generate a comprehensive debug report from test results
     */
    generateDebugReport(testResults: AgentTestResult[]): DebugReport {
        const allSteps = testResults.flatMap(r => r.steps);
        const callHistory = this.client.getCallHistory();

        return {
            sessionId: this.client.getCurrentSession(),
            totalCalls: callHistory.length,
            successfulCalls: allSteps.filter(s => s.success).length,
            failedCalls: allSteps.filter(s => !s.success).length,
            callBreakdown: this.getCallBreakdown(allSteps),
            errorPatterns: this.analyzeErrorPatterns(allSteps),
            performanceMetrics: this.calculatePerformanceMetrics(allSteps, testResults),
            sessionStateHistory: this.sessionSnapshots,
            recommendations: this.generateRecommendations(allSteps, callHistory)
        };
    }

    /**
     * Capture current session state for debugging
     */
    async captureSessionState(toolName: string): Promise<void> {
        const sessionId = this.client.getCurrentSession();
        if (!sessionId) return;

        try {
            const queryResponse = await this.client.callTool('get-current-query', {
                sessionId
            });

            this.sessionSnapshots.push({
                timestamp: Date.now(),
                tool: toolName,
                queryStructure: queryResponse.queryStructure,
                variables: queryResponse.variables,
                fragments: queryResponse.fragments
            });
        } catch (error) {
            // Ignore errors during state capture
        }
    }

    /**
     * Analyze session persistence issues
     */
    async analyzeSessionPersistence(sessionId: string): Promise<{
        exists: boolean;
        lastModified?: number;
        stateSize?: number;
        issues: string[];
    }> {
        const issues: string[] = [];

        try {
            const response = await this.client.callTool('get-current-query', {
                sessionId
            });

            if (response.error) {
                return {
                    exists: false,
                    issues: [response.error]
                };
            }

            // Analyze session state
            const queryString = response.data?.queryString || response.queryString || '';
            const variables = response.data?.variables || response.variables || {};
            const stateSize = JSON.stringify(response).length;

            if (queryString.trim() === '') {
                issues.push('Session exists but query is empty');
            }

            if (Object.keys(variables).length > 0) {
                for (const [varName, varValue] of Object.entries(variables)) {
                    if (varValue === undefined || varValue === null) {
                        issues.push(`Variable ${varName} has null/undefined value`);
                    }
                }
            }

            return {
                exists: true,
                stateSize,
                issues
            };

        } catch (error) {
            return {
                exists: false,
                issues: [`Session analysis failed: ${error instanceof Error ? error.message : String(error)}`]
            };
        }
    }

    /**
     * Test tool behavior under various error conditions
     */
    async runErrorScenarioTests(): Promise<{ scenario: string; result: any }[]> {
        const scenarios = [
            {
                name: 'Empty Session ID',
                test: () => this.client.callTool('get-current-query', { sessionId: '' })
            },
            {
                name: 'Null Session ID',
                test: () => this.client.callTool('get-current-query', { sessionId: null as any })
            },
            {
                name: 'Invalid Session Format',
                test: () => this.client.callTool('get-current-query', { sessionId: 'inv@lid-sess!on' })
            },
            {
                name: 'Missing Required Parameter',
                test: () => this.client.callTool('select-field', { sessionId: 'test' } as any)
            },
            {
                name: 'Invalid Field Path',
                test: () => this.client.callTool('select-field', {
                    sessionId: 'test',
                    currentPath: 'invalid.deep.path',
                    fieldName: 'field'
                })
            }
        ];

        const results = [];
        for (const scenario of scenarios) {
            try {
                const result = await scenario.test();
                results.push({
                    scenario: scenario.name,
                    result
                });
            } catch (error) {
                results.push({
                    scenario: scenario.name,
                    result: { error: error instanceof Error ? error.message : String(error) }
                });
            }
        }

        return results;
    }

    /**
     * Validate tool response format consistency
     */
    validateResponseFormat(response: any, toolName: string): string[] {
        const issues: string[] = [];

        // Check basic response structure
        if (typeof response !== 'object' || response === null) {
            issues.push(`${toolName}: Response is not an object`);
            return issues;
        }

        // Check success/error pattern
        if (response.success === true && response.error) {
            issues.push(`${toolName}: Response has success=true but also has error field`);
        }

        if (response.success === false && !response.error) {
            issues.push(`${toolName}: Response has success=false but no error message`);
        }

        if (response.success === undefined && !response.error) {
            issues.push(`${toolName}: Response has neither success field nor error field`);
        }

        // Check for expected fields based on tool type
        if (toolName === 'start-query-session' && response.success && !response.sessionId) {
            issues.push(`${toolName}: Successful response missing sessionId`);
        }

        if (toolName === 'get-current-query' && response.success && !response.queryString) {
            issues.push(`${toolName}: Successful response missing queryString`);
        }

        if (toolName === 'validate-query' && response.success && response.valid === undefined) {
            issues.push(`${toolName}: Successful response missing valid field`);
        }

        return issues;
    }

    /**
     * Generate debugging recommendations based on observed patterns
     */
    private generateRecommendations(steps: AgentStepResult[], callHistory: any[]): string[] {
        const recommendations: string[] = [];

        // Check for session not found errors
        const sessionErrors = steps.filter(s => 
            s.error && s.error.toLowerCase().includes('session')
        );
        if (sessionErrors.length > 0) {
            recommendations.push('Consider validating session ID format and persistence');
        }

        // Check for field not found errors
        const fieldErrors = steps.filter(s => 
            s.error && s.error.toLowerCase().includes('field')
        );
        if (fieldErrors.length > 0) {
            recommendations.push('Use introspect-schema and get-type-info to verify field availability');
        }

        // Check for missing introspection
        const hasIntrospection = callHistory.some(call => 
            call.tool === 'introspect-schema'
        );
        if (!hasIntrospection && steps.length > 2) {
            recommendations.push('Always call introspect-schema early in the workflow');
        }

        // Check for validation patterns
        const hasValidation = callHistory.some(call => 
            call.tool === 'validate-query'
        );
        if (!hasValidation && steps.length > 3) {
            recommendations.push('Consider validating queries before execution');
        }

        // Check for performance issues
        const slowSteps = steps.filter(s => s.duration > 1000);
        if (slowSteps.length > 0) {
            recommendations.push('Some tool calls are taking over 1 second - check Redis connectivity');
        }

        return recommendations;
    }

    private getCallBreakdown(steps: AgentStepResult[]): Record<string, number> {
        const breakdown: Record<string, number> = {};
        
        for (const step of steps) {
            if (step.toolName) {
                breakdown[step.toolName] = (breakdown[step.toolName] || 0) + 1;
            }
        }

        return breakdown;
    }

    private analyzeErrorPatterns(steps: AgentStepResult[]): ErrorPattern[] {
        const errorMap: Map<string, { tools: Set<string>; examples: string[] }> = new Map();

        for (const step of steps) {
            if (step.error) {
                // Extract error pattern (remove specific details)
                const pattern = step.error
                    .replace(/['"]/g, '')
                    .replace(/\d+/g, 'N')
                    .replace(/session-\w+/g, 'SESSION_ID');

                if (!errorMap.has(pattern)) {
                    errorMap.set(pattern, { tools: new Set(), examples: [] });
                }

                const entry = errorMap.get(pattern)!;
                if (step.toolName) {
                    entry.tools.add(step.toolName);
                }
                if (entry.examples.length < 3) {
                    entry.examples.push(step.error);
                }
            }
        }

        return Array.from(errorMap.entries()).map(([pattern, data]) => ({
            pattern,
            occurrences: data.examples.length,
            tools: Array.from(data.tools),
            examples: data.examples
        }));
    }

    private calculatePerformanceMetrics(steps: AgentStepResult[], testResults: AgentTestResult[]): PerformanceMetrics {
        const durations = steps.map(s => s.duration);
        const totalTestDuration = testResults.reduce((sum, r) => sum + r.totalTime, 0);

        const averageCallDuration = durations.length > 0 
            ? durations.reduce((sum, d) => sum + d, 0) / durations.length 
            : 0;

        let slowestCall = { tool: 'none', duration: 0 };
        let fastestCall = { tool: 'none', duration: Infinity };

        for (const step of steps) {
            if (step.duration > slowestCall.duration) {
                slowestCall = { tool: step.toolName || 'unknown', duration: step.duration };
            }
            if (step.duration < fastestCall.duration) {
                fastestCall = { tool: step.toolName || 'unknown', duration: step.duration };
            }
        }

        if (fastestCall.duration === Infinity) {
            fastestCall = { tool: 'none', duration: 0 };
        }

        return {
            averageCallDuration,
            slowestCall,
            fastestCall,
            totalTestDuration
        };
    }
}

/**
 * Pretty print debug report for console output
 */
export function formatDebugReport(report: DebugReport): string {
    const lines: string[] = [];

    lines.push('='.repeat(60));
    lines.push('AGENT DEBUG REPORT');
    lines.push('='.repeat(60));
    lines.push('');

    lines.push(`Session ID: ${report.sessionId || 'None'}`);
    lines.push(`Total Calls: ${report.totalCalls}`);
    lines.push(`Successful: ${report.successfulCalls} (${(report.successfulCalls / report.totalCalls * 100).toFixed(1)}%)`);
    lines.push(`Failed: ${report.failedCalls} (${(report.failedCalls / report.totalCalls * 100).toFixed(1)}%)`);
    lines.push('');

    lines.push('CALL BREAKDOWN:');
    for (const [tool, count] of Object.entries(report.callBreakdown)) {
        lines.push(`  ${tool}: ${count}`);
    }
    lines.push('');

    if (report.errorPatterns.length > 0) {
        lines.push('ERROR PATTERNS:');
        for (const pattern of report.errorPatterns) {
            lines.push(`  Pattern: ${pattern.pattern}`);
            lines.push(`  Occurrences: ${pattern.occurrences}`);
            lines.push(`  Tools: ${pattern.tools.join(', ')}`);
            lines.push(`  Example: ${pattern.examples[0]}`);
            lines.push('');
        }
    }

    lines.push('PERFORMANCE:');
    lines.push(`  Average call duration: ${report.performanceMetrics.averageCallDuration.toFixed(2)}ms`);
    lines.push(`  Slowest call: ${report.performanceMetrics.slowestCall.tool} (${report.performanceMetrics.slowestCall.duration}ms)`);
    lines.push(`  Fastest call: ${report.performanceMetrics.fastestCall.tool} (${report.performanceMetrics.fastestCall.duration}ms)`);
    lines.push(`  Total test duration: ${report.performanceMetrics.totalTestDuration}ms`);
    lines.push('');

    if (report.recommendations.length > 0) {
        lines.push('RECOMMENDATIONS:');
        for (const rec of report.recommendations) {
            lines.push(`  • ${rec}`);
        }
        lines.push('');
    }

    lines.push('='.repeat(60));

    return lines.join('\n');
}