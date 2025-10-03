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
    ErrorCode
} from "./shared-utils.js";

// Core business logic - testable function
export async function executeGraphQLQuery(sessionId: string) {
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

        // Determine timeout based on complexity
        const timeout = complexityAnalysis && complexityAnalysis.complexityScore > 1500
            ? QUERY_EXECUTION_TIMEOUT.EXPENSIVE
            : QUERY_EXECUTION_TIMEOUT.DEFAULT;

        // Resolve endpoint and headers
        const { url, headers: envHeaders } = resolveEndpointAndHeaders();
        const headers = { ...envHeaders, ...queryState.headers };

        if (!url) {
            return createErrorResponse('No GraphQL endpoint configured', {
                errorCode: ErrorCode.EXECUTION_ERROR,
                sessionId,
                suggestion: 'Set DEFAULT_GRAPHQL_ENDPOINT in your .env file',
                details: { queryString, complexityAnalysis }
            });
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
                return createErrorResponse(
                    `HTTP ${response.status}: ${response.statusText}`,
                    {
                        errorCode: ErrorCode.EXECUTION_ERROR,
                        sessionId,
                        details: { queryString, complexityAnalysis }
                    }
                );
            }

            // Parse JSON response with timeout
            const jsonPromise = response.json();
            const result = await executeWithTimeout(
                jsonPromise,
                5000,
                'Response parsing timed out'
            );

            const executionTime = Date.now() - startTime;

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
    description: "Execute the built GraphQL query against the configured endpoint and return results",
    schema: {
        sessionId: z.string().describe('The session ID from start-query-session.'),
    },
    handler: async ({ sessionId }: { sessionId: string }) => {
        const result = await executeGraphQLQuery(sessionId);

        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
}; 