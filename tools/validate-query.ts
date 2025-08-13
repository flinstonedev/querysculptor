import { z } from "zod";
import { QueryState, loadQueryState, buildQueryFromStructure, GraphQLValidationUtils, fetchAndCacheSchema, analyzeQueryComplexity } from "./shared-utils.js";
import { parse, validate } from 'graphql';

// Core business logic - testable function
export async function validateGraphQLQuery(sessionId: string): Promise<{
    valid?: boolean;
    errors?: string[];
    warnings?: string[];
    query?: string;
    error?: string;
    complexity?: {
        depth: number;
        fieldCount: number;
        complexityScore: number;
        warnings: string[];
    };
}> {
    try {
        // Load query state
        const queryState = await loadQueryState(sessionId);
        if (!queryState) {
            return {
                error: 'Session not found.'
            };
        }

        // Use comprehensive query structure validation first
        try {
            const schema = await fetchAndCacheSchema(queryState.headers);
            const validation = GraphQLValidationUtils.validateQueryStructure(schema, queryState);

            // If query structure validation fails, return early
            if (!validation.valid) {
                return {
                    valid: false,
                    errors: validation.errors,
                    warnings: validation.warnings,
                    query: buildQueryFromStructure(
                        queryState.queryStructure,
                        queryState.operationType,
                        queryState.variablesSchema,
                        queryState.operationName,
                        queryState.fragments
                    )
                };
            }

            // Build query string for GraphQL validation
            const queryString = buildQueryFromStructure(
                queryState.queryStructure,
                queryState.operationType,
                queryState.variablesSchema,
                queryState.operationName,
                queryState.fragments
            );

            // Use GraphQL schema validation for detailed error reporting
            const graphqlValidation = GraphQLValidationUtils.validateAgainstSchema(queryString, schema);
            
            // Get complexity analysis
            const complexityAnalysis = analyzeQueryComplexity(
                queryState.queryStructure,
                queryState.operationType
            );

            const allWarnings = [...(validation.warnings || []), ...(complexityAnalysis.warnings || [])];

            if (!graphqlValidation.valid) {
                return {
                    valid: false,
                    errors: graphqlValidation.errors || ['Unknown validation error'],
                    warnings: allWarnings,
                    query: queryString,
                    complexity: {
                        depth: complexityAnalysis.depth,
                        fieldCount: complexityAnalysis.fieldCount,
                        complexityScore: complexityAnalysis.complexityScore,
                        warnings: complexityAnalysis.warnings,
                    }
                };
            }

            return {
                valid: true,
                errors: [],
                warnings: allWarnings,
                query: queryString,
                complexity: {
                    depth: complexityAnalysis.depth,
                    fieldCount: complexityAnalysis.fieldCount,
                    complexityScore: complexityAnalysis.complexityScore,
                    warnings: complexityAnalysis.warnings,
                }
            };
        } catch (schemaError) {
            return {
                valid: false,
                errors: [`Schema validation failed: ${schemaError instanceof Error ? schemaError.message : String(schemaError)}`],
                query: buildQueryFromStructure(
                    queryState.queryStructure,
                    queryState.operationType,
                    queryState.variablesSchema,
                    queryState.operationName,
                    queryState.fragments
                )
            };
        }
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

export const validateQueryTool = {
    name: "validate-query",
    description: "Validate the built GraphQL query against the schema for syntax and semantic correctness",
    schema: {
        sessionId: z.string().describe('The session ID from start-query-session.'),
    },
    handler: async ({ sessionId }: { sessionId: string }) => {
        const result = await validateGraphQLQuery(sessionId);

        return {
            content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
            }],
        };
    }
}; 