import { z } from "zod";
import { GraphQLSchema, printSchema } from 'graphql';
import {
    resolveEndpointAndHeaders,
    fetchAndCacheSchema,
    rawSchemaJsonCache,
    createSuccessResponse,
    createErrorResponse,
    ErrorCode
} from "./shared-utils.js";

// Core business logic - testable function
export async function introspectGraphQLSchema() {
    const startTime = Date.now();
    const { url: resolvedUrl, headers } = resolveEndpointAndHeaders();

    if (!resolvedUrl) {
        return createErrorResponse(
            "No default GraphQL endpoint configured in environment variables (DEFAULT_GRAPHQL_ENDPOINT)",
            {
                errorCode: ErrorCode.SCHEMA_ERROR,
                suggestion: 'Set DEFAULT_GRAPHQL_ENDPOINT in your .env file'
            }
        );
    }

    try {
        const schema = await fetchAndCacheSchema(headers);
        const rawJson = rawSchemaJsonCache.get(resolvedUrl) || {};
        const schemaSdl = printSchema(schema);

        // Define a size limit (e.g., 800KB) for the response payload
        const MAX_SCHEMA_SIZE_BYTES = 800 * 1024;
        const rawJsonString = JSON.stringify(rawJson);
        const estimatedSizeBytes = schemaSdl.length + rawJsonString.length;

        if (estimatedSizeBytes > MAX_SCHEMA_SIZE_BYTES) {
            return createErrorResponse(
                `Schema is too large to return directly (estimated ${Math.round(estimatedSizeBytes / 1024)}KB)`,
                {
                    errorCode: ErrorCode.SCHEMA_ERROR,
                    suggestion: 'Use get-root-operation-types and get-type-info for schema exploration instead',
                    details: {
                        character_count_sdl: schemaSdl.length,
                        character_count_json_string: rawJsonString.length,
                        estimated_total_kb: Math.round(estimatedSizeBytes / 1024),
                        limit_kb: MAX_SCHEMA_SIZE_BYTES / 1024
                    }
                }
            );
        }

        return createSuccessResponse(
            {
                schemaSdl,
                fullSchemaJson: rawJson,
                endpoint: resolvedUrl
            },
            {
                executionTime: Date.now() - startTime
            }
        );
    } catch (error) {
        return createErrorResponse(
            error instanceof Error ? `Failed to introspect schema: ${error.message}` : String(error),
            {
                errorCode: ErrorCode.SCHEMA_ERROR
            }
        );
    }
}

export const introspectSchemaTool = {
    name: "introspect-schema",
    description: "Retrieve the complete GraphQL schema definition for API understanding and exploration",
    schema: {
        format: z.enum(['sdl', 'json', 'both']).default('both').describe('Format to return schema in: SDL text, JSON object, or both.'),
    },
    handler: async ({ format = 'both' }: { format?: 'sdl' | 'json' | 'both' }) => {
        const result = await introspectGraphQLSchema();

        // Import wrapToolResponse at runtime to avoid circular dependencies
        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
}; 