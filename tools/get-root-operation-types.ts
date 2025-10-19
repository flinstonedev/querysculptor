import { z } from "zod";
import { GraphQLSchema } from 'graphql';
import {
    resolveEndpointAndHeaders,
    fetchAndCacheSchema,
    createSuccessResponse,
    createErrorResponse,
    ErrorCode
} from "./shared-utils.js";

// Core business logic - testable function
export async function getRootOperationTypes() {
    const startTime = Date.now();
    const { url: resolvedUrl, headers, error } = resolveEndpointAndHeaders();

    if (!resolvedUrl || error) {
        return createErrorResponse(
            error || "No GraphQL endpoint available",
            {
                errorCode: ErrorCode.SCHEMA_ERROR,
                suggestion: 'Set DEFAULT_GRAPHQL_ENDPOINT environment variable'
            }
        );
    }

    try {
        const schema = await fetchAndCacheSchema();
        return createSuccessResponse(
            {
                query_type: schema.getQueryType()?.name || null,
                mutation_type: schema.getMutationType()?.name || null,
                subscription_type: schema.getSubscriptionType()?.name || null
            },
            {
                executionTime: Date.now() - startTime
            }
        );
    } catch (error) {
        return createErrorResponse(
            error instanceof Error ? error.message : String(error),
            {
                errorCode: ErrorCode.SCHEMA_ERROR
            }
        );
    }
}

export const getRootOperationTypesTool = {
    name: "get-root-ops",
    description: "Discover the available root operation types (Query, Mutation, Subscription) and their entry points.",
    schema: {
        includeFieldCounts: z.boolean().default(false).describe('Include count of available fields for each root operation type.')
    },
    handler: async ({ includeFieldCounts = false }: {
        includeFieldCounts?: boolean;
    }) => {
        const result = await getRootOperationTypes();
        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
}; 