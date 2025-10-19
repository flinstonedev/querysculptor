import { z } from "zod";
import {
    QueryState,
    loadQueryState,
    buildQueryFromStructure,
    createSuccessResponse,
    createErrorResponse,
    ErrorCode
} from "./shared-utils.js";

// Core business logic - testable function
export async function getCurrentQuery(sessionId: string, prettyPrint: boolean = false) {
    const startTime = Date.now();

    try {
        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
            return createErrorResponse('Invalid sessionId', {
                errorCode: ErrorCode.VALIDATION_ERROR,
                sessionId
            });
        }

        // Load query state
        const queryState = await loadQueryState(sessionId);
        if (!queryState) {
            return createErrorResponse('Session not found', {
                errorCode: ErrorCode.SESSION_NOT_FOUND,
                sessionId,
                suggestion: 'Start a new session with start-query-session'
            });
        }

        const queryString = buildQueryFromStructure(
            queryState.queryStructure,
            queryState.operationType,
            queryState.variablesSchema,
            queryState.operationName,
            queryState.fragments,
            queryState.operationDirectives,
            queryState.variablesDefaults
        );

        // Validate required arguments and provide warnings
        let warnings: string[] = [];
        try {
            const { fetchAndCacheSchema, GraphQLValidationUtils } = await import('./shared-utils.js');
            const schema = await fetchAndCacheSchema();
            if (schema && GraphQLValidationUtils.validateRequiredArguments) {
                const validation = GraphQLValidationUtils.validateRequiredArguments(
                    schema,
                    queryState.queryStructure,
                    queryState.operationType
                );
                warnings = validation.warnings;
            }
        } catch (error) {
            // Schema validation failed, but continue anyway to maintain backward compatibility
            console.warn('Required argument validation failed:', error);
        }

        return createSuccessResponse(
            {
                queryString,
                variables_schema: queryState.variablesSchema
            },
            {
                warnings: warnings.length > 0 ? warnings : undefined,
                sessionId,
                stateVersion: queryState.stateVersion,
                executionTime: Date.now() - startTime
            }
        );
    } catch (error) {
        return createErrorResponse(
            error instanceof Error ? error.message : String(error),
            {
                errorCode: ErrorCode.INTERNAL_ERROR,
                sessionId
            }
        );
    }
}



export const getCurrentQueryTool = {
    name: "get-current-query",
    description: "Visualize the current GraphQL query structure and generated query string for debugging and review",
    schema: {
        sessionId: z.string().describe('The session ID from start-query-session.'),
        prettyPrint: z.boolean().default(false).describe('Whether to format the output query string.'),
    },
    handler: async ({ sessionId, prettyPrint = false }: { sessionId: string, prettyPrint?: boolean }) => {
        const result = await getCurrentQuery(sessionId, prettyPrint);

        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
}; 