import { z } from "zod";
import {
    QueryState,
    loadQueryState,
    resolveEndpointAndHeaders,
    buildQueryFromStructure,
    analyzeQueryComplexity,
    executeWithTimeout,
    QUERY_EXECUTION_TIMEOUT,
    MAX_QUERY_COMPLEXITY,
    createSuccessResponse,
    createErrorResponse,
    ErrorCode,
    validateGraphQLOperation,
    checkEndpointDiversity,
    logToolUsage
} from "./shared-utils.js";

// Maximum response size (1MB by default, configurable via env)
const MAX_RESPONSE_SIZE = parseInt(process.env.MAX_RESPONSE_SIZE_MB || '1', 10) * 1024 * 1024;

// Core business logic - testable function
export async function executeGraphQLQuery(
    sessionId: string
) {
    const startTime = Date.now();

    try {
        // Load the query state
        const queryState = await loadQueryState(sessionId);
        if (!queryState) {
            return createErrorResponse('Session not found', {
                errorCode: ErrorCode.SESSION_NOT_FOUND,
                sessionId,
                suggestion: 'Start a new session with start-query-session'
            });
        }

        // Build the query string
        let queryString: string;
        try {
            queryString = buildQueryFromStructure(
                queryState.queryStructure,
                queryState.operationType,
                queryState.variablesSchema,
                queryState.operationName,
                queryState.fragments || {},
                queryState.operationDirectives || [],
                queryState.variablesDefaults || {}
            );
        } catch (buildError: any) {
            return createErrorResponse(`Failed to build query: ${buildError.message}`, {
                errorCode: ErrorCode.VALIDATION_ERROR,
                sessionId
            });
        }

        // Perform complexity analysis (but don't fail for backward compatibility)
        let complexityAnalysis;
        const warnings: string[] = [];
        try {
            const analysis = analyzeQueryComplexity(queryState.queryStructure, queryState.operationType);

            complexityAnalysis = {
                depth: analysis.depth,
                fieldCount: analysis.fieldCount,
                complexityScore: analysis.complexityScore,
                warnings: analysis.warnings
            };

            if (analysis.warnings.length > 0) {
                warnings.push(...analysis.warnings);
            }

            // Only fail if complexity is critically high
            if (!analysis.valid && analysis.complexityScore > MAX_QUERY_COMPLEXITY.TOTAL_COMPLEXITY_SCORE) {
                return createErrorResponse(
                    `Query complexity too high: ${analysis.errors.join('; ')}`,
                    {
                        errorCode: ErrorCode.VALIDATION_ERROR,
                        sessionId,
                        details: { complexityAnalysis }
                    }
                );
            }
        } catch (complexityError: any) {
            // Don't fail on complexity analysis errors for backward compatibility
            console.warn('Complexity analysis failed:', complexityError.message);
        }

        // Validate GraphQL operation to prevent proxy abuse
        const operationValidation = validateGraphQLOperation(queryString);
        if (!operationValidation.valid) {
            return createErrorResponse(
                `Invalid operation: ${operationValidation.error}`,
                {
                    errorCode: ErrorCode.VALIDATION_ERROR,
                    sessionId,
                    details: { queryString }
                }
            );
        }

        // Determine timeout based on complexity
        const timeout = complexityAnalysis && complexityAnalysis.complexityScore > 1500
            ? QUERY_EXECUTION_TIMEOUT.EXPENSIVE
            : QUERY_EXECUTION_TIMEOUT.DEFAULT;

        // Resolve endpoint and headers
        const { url, headers, error: endpointError } = resolveEndpointAndHeaders();

        if (!url || endpointError) {
            return createErrorResponse(
                endpointError || 'No GraphQL endpoint configured',
                {
                    errorCode: ErrorCode.EXECUTION_ERROR,
                    sessionId,
                    suggestion: 'Set DEFAULT_GRAPHQL_ENDPOINT environment variable',
                    details: { queryString, complexityAnalysis }
                }
            );
        }

        // Check endpoint diversity to prevent proxy abuse
        const clientId = `session:${sessionId}`; // Use session as client identifier
        const diversityCheck = await checkEndpointDiversity(clientId, url);
        if (!diversityCheck.allowed) {
            return createErrorResponse(
                diversityCheck.error || 'Endpoint diversity check failed',
                {
                    errorCode: ErrorCode.VALIDATION_ERROR,
                    sessionId,
                    suggestion: 'This service is for query building, not general proxy usage'
                }
            );
        }

        // Prepare request body
        const requestBody = {
            query: queryString,
            variables: queryState.variablesValues || {},
            operationName: queryState.operationName
        };

        // Execute the GraphQL request with timeout
        try {
            const fetchPromise = fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody)
            });

            const response = await executeWithTimeout(
                fetchPromise,
                timeout,
                `Query execution timed out after ${timeout}ms`
            );

            if (!response.ok) {
                // Log failed execution
                await logToolUsage({
                    clientId,
                    sessionId,
                    toolName: 'execute-query',
                    endpoint: url,
                    queryComplexity: complexityAnalysis?.complexityScore,
                    executionTime: Date.now() - startTime
                });

                return createErrorResponse(
                    `HTTP ${response.status}: ${response.statusText}`,
                    {
                        errorCode: ErrorCode.EXECUTION_ERROR,
                        sessionId,
                        details: { queryString, complexityAnalysis }
                    }
                );
            }

            // Check response size before parsing (LAYER 5: Response size limits)
            const contentLength = response.headers.get('content-length');
            if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
                await logToolUsage({
                    clientId,
                    sessionId,
                    toolName: 'execute-query',
                    endpoint: url,
                    queryComplexity: complexityAnalysis?.complexityScore,
                    responseSize: parseInt(contentLength),
                    executionTime: Date.now() - startTime
                });

                return createErrorResponse(
                    `Response too large: ${contentLength} bytes (max ${MAX_RESPONSE_SIZE} bytes)`,
                    {
                        errorCode: ErrorCode.EXECUTION_ERROR,
                        sessionId,
                        suggestion: 'Reduce query complexity or use pagination to limit response size',
                        details: { queryString, complexityAnalysis }
                    }
                );
            }

            // Parse JSON response with timeout and size checking
            const jsonPromise = response.text().then(text => {
                // Check actual response size
                const responseSize = new Blob([text]).size;
                if (responseSize > MAX_RESPONSE_SIZE) {
                    throw new Error(`Response exceeded maximum size: ${responseSize} bytes (max ${MAX_RESPONSE_SIZE} bytes)`);
                }
                return JSON.parse(text);
            });

            const result = await executeWithTimeout(
                jsonPromise,
                5000,
                'Response parsing timed out'
            );

            const executionTime = Date.now() - startTime;

            // Calculate response size for logging
            const responseSize = new Blob([JSON.stringify(result)]).size;

            // Log successful execution (LAYER 7: Audit logging)
            await logToolUsage({
                clientId,
                sessionId,
                toolName: 'execute-query',
                endpoint: url,
                queryComplexity: complexityAnalysis?.complexityScore,
                responseSize,
                executionTime
            });

            // GraphQL can return errors alongside data
            if (result.errors && !result.data) {
                return createErrorResponse(
                    `GraphQL errors: ${result.errors.map((e: any) => e.message).join('; ')}`,
                    {
                        errorCode: ErrorCode.EXECUTION_ERROR,
                        sessionId,
                        details: {
                            queryString,
                            graphqlErrors: result.errors,
                            complexityAnalysis
                        }
                    }
                );
            }

            return createSuccessResponse(
                {
                    data: result.data,
                    errors: result.errors,
                    queryString,
                    complexityAnalysis
                },
                {
                    warnings: warnings.length > 0 ? warnings : undefined,
                    sessionId,
                    stateVersion: queryState.stateVersion,
                    executionTime
                }
            );

        } catch (error: any) {
            return createErrorResponse(
                error.message,
                {
                    errorCode: ErrorCode.EXECUTION_ERROR,
                    sessionId,
                    details: { queryString, complexityAnalysis }
                }
            );
        }

    } catch (error: any) {
        return createErrorResponse(
            `Execution failed: ${error.message}`,
            {
                errorCode: ErrorCode.INTERNAL_ERROR,
                sessionId
            }
        );
    }
}

export const executeQueryTool = {
    name: "execute-query",
    description: "Execute the built GraphQL query against the configured endpoint and return results.",
    schema: {
        sessionId: z.string().describe('The session ID from start-query-session.')
    },
    handler: async ({ sessionId }: {
        sessionId: string;
    }) => {
        const result = await executeGraphQLQuery(sessionId);

        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
}; 