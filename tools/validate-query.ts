import { z } from "zod";
import { QueryState, loadQueryState, buildQueryFromStructure, GraphQLValidationUtils, fetchAndCacheSchema, analyzeQueryComplexity ,
    createSuccessResponse,
    createErrorResponse,
    ErrorCode
} from "./shared-utils.js";
import { parse } from 'graphql';

// Core business logic - testable function
export async function validateGraphQLQuery(sessionId: string) {
    const startTime = Date.now();
    try {
        // Load query state
        const queryState = await loadQueryState(sessionId);
        if (!queryState) {
            return createErrorResponse('Session not found.', {
                errorCode: ErrorCode.SESSION_NOT_FOUND,
                sessionId,
                suggestion: 'Use start-query-session to create a new session'
            });
        }

        // Use comprehensive query structure validation first
        try {
            const schema = await fetchAndCacheSchema(queryState.headers);
            const validation = GraphQLValidationUtils.validateQueryStructure(schema, queryState);

            // If query structure validation fails, return early
            if (!validation.valid) {
                const query = buildQueryFromStructure(
                    queryState.queryStructure,
                    queryState.operationType,
                    queryState.variablesSchema,
                    queryState.operationName,
                    queryState.fragments
                );
                return createSuccessResponse(
                    {
                        valid: false,
                        errors: validation.errors,
                        query
                    },
                    {
                        warnings: validation.warnings && validation.warnings.length > 0 ? validation.warnings : undefined,
                        sessionId,
                        stateVersion: queryState.stateVersion,
                        executionTime: Date.now() - startTime
                    }
                );
            }

            // Build query string for GraphQL validation (include operation directives and variable defaults)
            const queryString = buildQueryFromStructure(
                queryState.queryStructure,
                queryState.operationType,
                queryState.variablesSchema,
                queryState.operationName,
                queryState.fragments,
                queryState.operationDirectives,
                queryState.variablesDefaults
            );

            // Validate with actual variable values if they exist
            const variablesToValidate = queryState.variablesValues || queryState.variablesDefaults || {};
            
            // Get complexity analysis first 
            const complexityAnalysis = analyzeQueryComplexity(
                queryState.queryStructure,
                queryState.operationType
            );

            const allWarnings = [...(validation.warnings || []), ...(complexityAnalysis.warnings || [])];
            
            // Use GraphQL schema validation for detailed error reporting
            const graphqlValidation = GraphQLValidationUtils.validateAgainstSchema(queryString, schema);
            
            // Additionally validate variable values if they exist (this fixes the core issue)
            if (Object.keys(variablesToValidate).length > 0 && graphqlValidation.valid) {
                try {
                    const documentNode = parse(queryString);
                    const variableValidation = GraphQLValidationUtils.validateVariableValues(
                        schema, 
                        documentNode, 
                        variablesToValidate
                    );
                    
                    if (!variableValidation.valid) {
                        return createSuccessResponse(
                            {
                                valid: false,
                                errors: variableValidation.errors || ['Variable validation failed'],
                                query: queryString,
                                complexity: {
                                    depth: complexityAnalysis.depth,
                                    fieldCount: complexityAnalysis.fieldCount,
                                    complexityScore: complexityAnalysis.complexityScore,
                                    warnings: complexityAnalysis.warnings,
                                }
                            },
                            {
                                warnings: allWarnings.length > 0 ? allWarnings : undefined,
                                sessionId,
                                stateVersion: queryState.stateVersion,
                                executionTime: Date.now() - startTime
                            }
                        );
                    }
                } catch (parseError) {
                    // If parsing fails, the graphqlValidation above should have caught it
                    // This is a fallback for variable-specific parsing issues
                    return createSuccessResponse(
                        {
                            valid: false,
                            errors: [`Variable validation parsing failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`],
                            query: queryString,
                            complexity: {
                                depth: complexityAnalysis.depth,
                                fieldCount: complexityAnalysis.fieldCount,
                                complexityScore: complexityAnalysis.complexityScore,
                                warnings: complexityAnalysis.warnings,
                            }
                        },
                        {
                            warnings: allWarnings.length > 0 ? allWarnings : undefined,
                            sessionId,
                            stateVersion: queryState.stateVersion,
                            executionTime: Date.now() - startTime
                        }
                    );
                }
            }

            if (!graphqlValidation.valid) {
                return createSuccessResponse(
                    {
                        valid: false,
                        errors: graphqlValidation.errors || ['Unknown validation error'],
                        query: queryString,
                        complexity: {
                            depth: complexityAnalysis.depth,
                            fieldCount: complexityAnalysis.fieldCount,
                            complexityScore: complexityAnalysis.complexityScore,
                            warnings: complexityAnalysis.warnings,
                        }
                    },
                    {
                        warnings: allWarnings.length > 0 ? allWarnings : undefined,
                        sessionId,
                        stateVersion: queryState.stateVersion,
                        executionTime: Date.now() - startTime
                    }
                );
            }

            return createSuccessResponse(
                {
                    valid: true,
                    errors: [],
                    query: queryString,
                    complexity: {
                        depth: complexityAnalysis.depth,
                        fieldCount: complexityAnalysis.fieldCount,
                        complexityScore: complexityAnalysis.complexityScore,
                        warnings: complexityAnalysis.warnings,
                    }
                },
                {
                    warnings: allWarnings.length > 0 ? allWarnings : undefined,
                    sessionId,
                    stateVersion: queryState.stateVersion,
                    executionTime: Date.now() - startTime
                }
            );
        } catch (schemaError) {
            const query = buildQueryFromStructure(
                queryState.queryStructure,
                queryState.operationType,
                queryState.variablesSchema,
                queryState.operationName,
                queryState.fragments,
                queryState.operationDirectives,
                queryState.variablesDefaults
            );
            return createErrorResponse(
                `Schema validation failed: ${schemaError instanceof Error ? schemaError.message : String(schemaError)}`,
                {
                    errorCode: ErrorCode.SCHEMA_ERROR,
                    sessionId,
                    suggestion: 'Check if the schema is accessible and the query structure is correct',
                    details: { query, valid: false }
                }
            );
        }
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

export const validateQueryTool = {
    name: "validate-query",
    description: "Validate the built GraphQL query against the schema for syntax and semantic correctness",
    schema: {
        sessionId: z.string().describe('The session ID from start-query-session.'),
    },
    handler: async ({ sessionId }: { sessionId: string }) => {
        const result = await validateGraphQLQuery(sessionId);

        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
}; 