import { z } from "zod";
import {
    QueryState,
    loadQueryState,
    saveQueryState,
    GraphQLValidationUtils,
    fetchAndCacheSchema,
    validateInputComplexity,
    createSuccessResponse,
    createErrorResponse,
    ErrorCode
} from "./shared-utils.js";
import { typeFromAST, GraphQLType } from "graphql";
import { parseType } from "graphql/language/parser.js";

// Core business logic - testable function
export async function setQueryVariable(
    sessionId: string,
    variableName: string,
    variableType: string,
    defaultValue?: string | number | boolean | null
) {
    const startTime = Date.now();

    try {
        // --- Input Validation ---
        const complexityError = validateInputComplexity(defaultValue, `default value for variable "${variableName}"`);
        if (complexityError) {
            return createErrorResponse(complexityError, {
                errorCode: ErrorCode.VALIDATION_ERROR,
                sessionId,
                suggestion: 'Reduce the complexity of the default value'
            });
        }
        // --- End Input Validation ---

        // Validate variable name
        const variableValidation = GraphQLValidationUtils.validateVariableName(variableName);
        if (!variableValidation.valid) {
            return createErrorResponse(variableValidation.error || 'Invalid variable name.', {
                errorCode: ErrorCode.VALIDATION_ERROR,
                sessionId,
                suggestion: 'Variable name must start with $ and follow GraphQL naming rules (e.g., "$userId")'
            });
        }

        // Validate variable type syntax
        const typeValidation = GraphQLValidationUtils.validateVariableType(variableType);
        if (!typeValidation.valid) {
            return createErrorResponse(typeValidation.error || 'Invalid variable type.', {
                errorCode: ErrorCode.VALIDATION_ERROR,
                sessionId,
                suggestion: 'Use valid GraphQL type syntax (e.g., "ID!", "String", "[Int]")'
            });
        }

        // Validate variable type exists in schema
        const schema = await fetchAndCacheSchema();
        if (schema) {
            try {
                const typeNode = parseType(variableType);
                const gqlType = typeFromAST(schema, typeNode as any);

                if (!gqlType) {
                    return createErrorResponse(`Type '${variableType}' does not exist in the GraphQL schema.`, {
                        errorCode: ErrorCode.VALIDATION_ERROR,
                        sessionId,
                        suggestion: 'Use introspect-schema to see available types'
                    });
                }
            } catch (parseError: any) {
                return createErrorResponse(`Invalid variable type syntax: ${parseError.message}`, {
                    errorCode: ErrorCode.VALIDATION_ERROR,
                    sessionId,
                    suggestion: 'Check the GraphQL type syntax'
                });
            }
        }

        // Load query state
        const queryState = await loadQueryState(sessionId);
        if (!queryState) {
            return createErrorResponse('Session not found.', {
                errorCode: ErrorCode.SESSION_NOT_FOUND,
                sessionId,
                suggestion: 'Start a new session with start-query-session'
            });
        }

        // Legacy validation for backward compatibility
        if (!variableName.startsWith('$')) {
            return createErrorResponse(`Variable name must start with '$'. Provided: '${variableName}'.`, {
                errorCode: ErrorCode.VALIDATION_ERROR,
                sessionId,
                suggestion: 'Add $ prefix to the variable name (e.g., "$userId")'
            });
        }

        // Update variables schema
        queryState.variablesSchema[variableName] = variableType;

        // Set default value if provided
        if (defaultValue !== undefined) {
            try {
                const schema = await fetchAndCacheSchema(queryState.headers);
                const typeNode = parseType(variableType);
                const gqlType = typeFromAST(schema, typeNode as any);

                if (!gqlType) {
                    return createErrorResponse(`Could not determine GraphQL type for '${variableType}'.`, {
                        errorCode: ErrorCode.VARIABLE_ERROR,
                        sessionId,
                        suggestion: 'Use a valid GraphQL type'
                    });
                }

                // Apply coercion for string values
                let processedValue = defaultValue;
                if (typeof defaultValue === 'string') {
                    const coercedValue = GraphQLValidationUtils.coerceStringValue(defaultValue);
                    if (coercedValue.coerced) {
                        processedValue = coercedValue.value;
                    }
                }

                const validationError = GraphQLValidationUtils.validateValueAgainstType(processedValue, gqlType);
                if (validationError) {
                    return createErrorResponse(`For default value of variable '${variableName}': ${validationError}`, {
                        errorCode: ErrorCode.VARIABLE_ERROR,
                        sessionId,
                        suggestion: 'Ensure the default value matches the variable type'
                    });
                }

                queryState.variablesDefaults[variableName] = processedValue;
            } catch (e: any) {
                return createErrorResponse(`Type validation for default value failed: ${e.message}`, {
                    errorCode: ErrorCode.VARIABLE_ERROR,
                    sessionId,
                    suggestion: 'Check that the default value is valid for the specified type'
                });
            }
        }

        // Save the updated query state
        await saveQueryState(sessionId, queryState);

        return createSuccessResponse(
            {
                message: `Variable '${variableName}' set to type '${variableType}'${defaultValue !== undefined ? ` with default value ${JSON.stringify(defaultValue)}` : ''}.`,
                variablesSchema: queryState.variablesSchema,
                variablesDefaults: queryState.variablesDefaults
            },
            {
                sessionId,
                stateVersion: queryState.stateVersion,
                executionTime: Date.now() - startTime
            }
        );
    } catch (error) {
        return createErrorResponse(error instanceof Error ? error.message : String(error), {
            errorCode: ErrorCode.INTERNAL_ERROR,
            sessionId,
            suggestion: 'Check the error message for details'
        });
    }
}

export const setQueryVariableTool = {
    name: "set-query-variable",
    description: "Define a GraphQL variable with its type and optional default value for use in the query",
    schema: {
        sessionId: z.string().describe('The session ID from start-query-session.'),
        variableName: z.string().describe('The variable name (must start with $, e.g., "$userId").'),
        variableType: z.string().describe('The GraphQL variable type (e.g., "ID!", "String", "Int").'),
        defaultValue: z.string().optional().describe('Optional default value for the variable.'),
    },
    handler: async ({ sessionId, variableName, variableType, defaultValue }: {
        sessionId: string,
        variableName: string,
        variableType: string,
        defaultValue?: string | number | boolean | null
    }) => {
        const result = await setQueryVariable(sessionId, variableName, variableType, defaultValue);

        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
}; 