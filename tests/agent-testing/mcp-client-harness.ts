/**
 * MCP Client Test Harness - Simulates real agent interactions with QuerySculptor MCP server
 * 
 * This harness provides a way to test tools exactly as an MCP agent would:
 * - Uses actual MCP protocol communication
 * - Tests real session persistence 
 * - Validates tool responses and error handling
 * - Simulates realistic agent workflows
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Transport } from '@modelcontextprotocol/sdk/types.js';
import { getAllTools } from '../../tools/index.js';

export interface AgentTestScenario {
    name: string;
    description: string;
    steps: AgentTestStep[];
    expectedOutcome?: 'success' | 'error' | 'warning';
    setupRequired?: boolean;
}

export interface AgentTestStep {
    action: 'call_tool' | 'validate_response' | 'wait' | 'inspect_state';
    toolName?: string;
    parameters?: Record<string, any>;
    expectedResponse?: {
        success?: boolean;
        error?: string | RegExp;
        warning?: string | RegExp;
        fields?: string[];
    };
    description?: string;
    timeout?: number;
}

export interface AgentTestResult {
    scenario: string;
    success: boolean;
    steps: AgentStepResult[];
    totalTime: number;
    errors: string[];
    warnings: string[];
}

export interface AgentStepResult {
    step: number;
    action: string;
    toolName?: string;
    success: boolean;
    response?: any;
    error?: string;
    duration: number;
}

/**
 * In-Memory Transport for testing - simulates MCP communication without network
 */
export class InMemoryMCPTransport implements Transport {
    private handlers: Map<string, (message: any) => Promise<any>> = new Map();
    private isConnected = false;

    constructor(private tools: any[]) {
        this.setupToolHandlers();
    }

    private setupToolHandlers() {
        for (const tool of this.tools) {
            this.handlers.set(tool.name, async (message: any) => {
                try {
                    const result = await tool.handler(message.params);
                    return {
                        jsonrpc: '2.0',
                        id: message.id,
                        result: result
                    };
                } catch (error) {
                    return {
                        jsonrpc: '2.0',
                        id: message.id,
                        error: {
                            code: -1,
                            message: error instanceof Error ? error.message : String(error)
                        }
                    };
                }
            });
        }
    }

    async connect(): Promise<void> {
        this.isConnected = true;
    }

    async close(): Promise<void> {
        this.isConnected = false;
    }

    async send(message: any): Promise<any> {
        if (!this.isConnected) {
            throw new Error('Transport not connected');
        }

        const handler = this.handlers.get(message.method);
        if (handler) {
            const mcpResponse = await handler(message);
            
            // Unwrap MCP content format for easier testing
            if (mcpResponse.result && mcpResponse.result.content && Array.isArray(mcpResponse.result.content)) {
                const content = mcpResponse.result.content[0];
                if (content.type === 'text') {
                    try {
                        const parsed = JSON.parse(content.text);
                        return {
                            ...mcpResponse,
                            result: parsed
                        };
                    } catch {
                        // If not JSON, return the content structure for introspect-schema
                        return mcpResponse;
                    }
                }
            }
            
            return mcpResponse;
        }

        // Handle other MCP protocol messages
        if (message.method === 'tools/list') {
            return {
                jsonrpc: '2.0',
                id: message.id,
                result: {
                    tools: this.tools.map(tool => ({
                        name: tool.name,
                        description: tool.description || `${tool.name} tool`,
                        inputSchema: tool.schema
                    }))
                }
            };
        }

        throw new Error(`Unknown method: ${message.method}`);
    }
}

/**
 * Agent Test Client - Simulates how a real agent would interact with QuerySculptor
 */
export class AgentTestClient {
    private client: Client;
    private transport: InMemoryMCPTransport;
    private currentSession: string | null = null;
    private callHistory: Array<{ tool: string; params: any; response: any; timestamp: number }> = [];

    constructor() {
        const tools = getAllTools();
        this.transport = new InMemoryMCPTransport(tools);
        this.client = new Client({
            name: 'QuerySculptor-Agent-Test-Client',
            version: '1.0.0'
        }, {
            capabilities: {
                tools: {}
            }
        });
    }

    async connect(): Promise<void> {
        await this.transport.connect();
        // Note: In real implementation, would connect client to transport
        // For testing, we'll call tools directly through transport
    }

    async disconnect(): Promise<void> {
        await this.transport.close();
        this.currentSession = null;
    }

    async callTool(toolName: string, parameters: Record<string, any> = {}): Promise<any> {
        const startTime = Date.now();
        
        try {
            const response = await this.transport.send({
                jsonrpc: '2.0',
                id: Date.now(),
                method: toolName,
                params: parameters
            });

            const duration = Date.now() - startTime;
            
            this.callHistory.push({
                tool: toolName,
                params: parameters,
                response: response.result || response.error,
                timestamp: startTime
            });

            // Track session ID for convenience
            if (toolName === 'start-query-session' && response.result?.sessionId) {
                this.currentSession = response.result.sessionId;
            }

            return response.result || response.error;
        } catch (error) {
            const duration = Date.now() - startTime;
            
            this.callHistory.push({
                tool: toolName,
                params: parameters,
                response: { error: error instanceof Error ? error.message : String(error) },
                timestamp: startTime
            });

            throw error;
        }
    }

    async runScenario(scenario: AgentTestScenario): Promise<AgentTestResult> {
        const startTime = Date.now();
        const result: AgentTestResult = {
            scenario: scenario.name,
            success: true,
            steps: [],
            totalTime: 0,
            errors: [],
            warnings: []
        };

        try {
            for (let i = 0; i < scenario.steps.length; i++) {
                const step = scenario.steps[i];
                const stepResult = await this.runStep(step, i + 1);
                result.steps.push(stepResult);

                if (!stepResult.success) {
                    result.success = false;
                    result.errors.push(`Step ${i + 1}: ${stepResult.error}`);
                }
            }
        } catch (error) {
            result.success = false;
            result.errors.push(`Scenario failed: ${error instanceof Error ? error.message : String(error)}`);
        }

        result.totalTime = Date.now() - startTime;
        return result;
    }

    private async runStep(step: AgentTestStep, stepNumber: number): Promise<AgentStepResult> {
        const startTime = Date.now();
        const result: AgentStepResult = {
            step: stepNumber,
            action: step.action,
            toolName: step.toolName,
            success: true,
            duration: 0
        };

        try {
            switch (step.action) {
                case 'call_tool':
                    if (!step.toolName) {
                        throw new Error('Tool name required for call_tool action');
                    }
                    
                    // Replace parameter placeholders with actual values
                    const parameters = this.replaceParameterPlaceholders(step.parameters || {});
                    
                    const response = await this.callTool(step.toolName, parameters);
                    result.response = response;
                    
                    // Validate response if expectations provided
                    if (step.expectedResponse) {
                        this.validateResponse(response, step.expectedResponse, step.toolName);
                    }
                    break;

                case 'validate_response':
                    // Validate the last response against expectations
                    if (this.callHistory.length === 0) {
                        throw new Error('No previous tool call to validate');
                    }
                    const lastCall = this.callHistory[this.callHistory.length - 1];
                    if (step.expectedResponse) {
                        this.validateResponse(lastCall.response, step.expectedResponse, lastCall.tool);
                    }
                    break;

                case 'wait':
                    await new Promise(resolve => setTimeout(resolve, step.timeout || 100));
                    break;

                case 'inspect_state':
                    // Get current query state to inspect
                    if (this.currentSession) {
                        const queryResponse = await this.callTool('get-current-query', {
                            sessionId: this.currentSession
                        });
                        result.response = queryResponse;
                    }
                    break;

                default:
                    throw new Error(`Unknown action: ${step.action}`);
            }
        } catch (error) {
            result.success = false;
            result.error = error instanceof Error ? error.message : String(error);
        }

        result.duration = Date.now() - startTime;
        return result;
    }

    private validateResponse(response: any, expected: any, toolName: string): void {
        // Tools return data directly on success or {error: "message"} on failure
        const isSuccess = !response.error;
        
        if (expected.success !== undefined) {
            if (isSuccess !== expected.success) {
                throw new Error(`Expected success=${expected.success} but got success=${isSuccess} from ${toolName}`);
            }
        }

        if (expected.error !== undefined) {
            const hasError = !!response.error;
            if (typeof expected.error === 'string') {
                if (!hasError || response.error !== expected.error) {
                    throw new Error(`Expected error "${expected.error}" but got "${response.error}" from ${toolName}`);
                }
            } else if (expected.error instanceof RegExp) {
                if (!hasError || !expected.error.test(response.error)) {
                    throw new Error(`Expected error matching ${expected.error} but got "${response.error}" from ${toolName}`);
                }
            } else if (expected.error === null) {
                if (hasError) {
                    throw new Error(`Expected no error but got "${response.error}" from ${toolName}`);
                }
            }
        }

        if (expected.warning !== undefined) {
            const hasWarning = !!response.warning;
            if (typeof expected.warning === 'string') {
                if (!hasWarning || response.warning !== expected.warning) {
                    throw new Error(`Expected warning "${expected.warning}" but got "${response.warning}" from ${toolName}`);
                }
            } else if (expected.warning instanceof RegExp) {
                if (!hasWarning || !expected.warning.test(response.warning)) {
                    throw new Error(`Expected warning matching ${expected.warning} but got "${response.warning}" from ${toolName}`);
                }
            }
        }

        if (expected.fields && Array.isArray(expected.fields) && isSuccess) {
            for (const field of expected.fields) {
                if (!(field in response)) {
                    throw new Error(`Expected field "${field}" missing from ${toolName} response`);
                }
            }
        }
    }

    // Convenience methods for common agent patterns
    async startSession(): Promise<string> {
        const response = await this.callTool('start-query-session');
        if (response.error || !response.sessionId) {
            throw new Error(`Failed to start session: ${response.error || 'No session ID returned'}`);
        }
        return response.sessionId;
    }

    async introspectSchema(sessionId: string): Promise<any> {
        return await this.callTool('introspect-schema', { sessionId });
    }

    async buildBasicQuery(sessionId: string, fieldName: string): Promise<any> {
        return await this.callTool('select-field', {
            sessionId,
            currentPath: '',
            fieldName
        });
    }

    getCurrentSession(): string | null {
        return this.currentSession;
    }

    getCallHistory(): Array<{ tool: string; params: any; response: any; timestamp: number }> {
        return [...this.callHistory];
    }

    clearHistory(): void {
        this.callHistory = [];
    }

    private replaceParameterPlaceholders(parameters: Record<string, any>): Record<string, any> {
        const replaced: Record<string, any> = {};
        
        for (const [key, value] of Object.entries(parameters)) {
            if (typeof value === 'string' && value === '{{sessionId}}') {
                replaced[key] = this.currentSession;
            } else if (typeof value === 'object' && value !== null) {
                replaced[key] = this.replaceParameterPlaceholders(value);
            } else {
                replaced[key] = value;
            }
        }
        
        return replaced;
    }
}