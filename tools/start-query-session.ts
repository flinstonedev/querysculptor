import { z } from "zod";
import {
    resolveEndpointAndHeaders,
    fetchAndCacheSchema,
    saveQueryState,
    generateSessionId,
    GraphQLValidationUtils,
    QueryState,
    validateInputComplexity
} from "./shared-utils.js";

// Core business logic - testable function
export async function createQuerySession(
    operationType: string = "query",
    operationName?: string,
    sessionHeaders?: Record<string, string>
): Promise<{
    sessionId?: string;
    operationType?: string;
    operationName?: string;
    createdAt?: string;
    error?: string;
    warning?: string;
}> {
    // Validate operation name syntax
    const operationNameValidation = GraphQLValidationUtils.validateOperationName(operationName || null);
    if (!operationNameValidation.valid) {
        return {
            error: operationNameValidation.error
        };
    }

    // Resolve endpoint
    const { url: resolvedUrl, error } = resolveEndpointAndHeaders();

    if (!resolvedUrl || error) {
        return {
            error: error || "No GraphQL endpoint available"
        };
    }

    // --- Input Validation ---
    if (sessionHeaders) {
        const complexityError = validateInputComplexity(sessionHeaders, "headers");
        if (complexityError) {
            return { sessionId: '', error: complexityError };
        }
    }
    // --- End Input Validation ---

    // Warning if bearer token would be stored in session
    let warning: string | undefined;
    if (sessionHeaders && sessionHeaders['Authorization']?.includes('Bearer')) {
        warning = 'WARNING: Authorization header stored in session. Consider using environment variables for credentials instead.';
    }

    try {
        // Fetch schema
        const schema = await fetchAndCacheSchema();

        // Check if the operation type is supported by the schema
        let operationTypeName: string;
        if (operationType === "query" && schema.getQueryType()) {
            operationTypeName = schema.getQueryType()!.name;
        } else if (operationType === "mutation" && schema.getMutationType()) {
            operationTypeName = schema.getMutationType()!.name;
        } else if (operationType === "subscription" && schema.getSubscriptionType()) {
            operationTypeName = schema.getSubscriptionType()!.name;
        } else {
            return {
                error: `Operation type '${operationType}' not supported by schema or invalid`
            };
        }

        // Generate session ID and create initial query state
        const sessionId = generateSessionId();
        const now = new Date().toISOString();
        const queryState: QueryState = {
            stateVersion: 0,
            lastModified: now,
            headers: sessionHeaders || {}, // Only store session headers, NOT transient credentials
            operationType,
            operationTypeName,
            operationName: operationName || null,
            queryStructure: {
                fields: {},
                fragmentSpreads: [],
                inlineFragments: []
            },
            fragments: {},
            variablesSchema: {},
            variablesDefaults: {},
            variablesValues: {},
            operationDirectives: [],
            createdAt: now
        };

        // Save the query state
        await saveQueryState(sessionId, queryState);

        return {
            sessionId: sessionId,
            operationType: operationType,
            operationName: operationName,
            createdAt: queryState.createdAt,
            warning
        };
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

export const startQuerySessionTool = {
    name: "start-query-session",
    description: "Initialize a new GraphQL query building session with persistent state management.",
    schema: {
        operationType: z.enum(["query", "mutation", "subscription"]).default("query").describe('The type of GraphQL operation: query, mutation, or subscription.'),
        operationName: z.string().optional().describe('An optional name for the GraphQL operation (e.g., "MyQueryName").'),
        headers: z.record(z.string()).optional().describe('Optional: Custom HTTP headers stored in session state. WARNING: Avoid storing sensitive credentials here - use environment variables instead.')
    },
    handler: async ({ operationType = "query", operationName, headers: sessionHeaders }: {
        operationType?: string,
        operationName?: string,
        headers?: Record<string, string>
    }) => {
        const result = await createQuerySession(operationType, operationName, sessionHeaders);

        return {
            content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
            }],
        };
    }
}; 