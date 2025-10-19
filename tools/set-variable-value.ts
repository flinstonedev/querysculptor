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
import { typeFromAST } from "graphql";
import { parseType } from "graphql/language/parser.js";

// Core business logic - testable function
export async function setVariableValue(
    sessionId: string,
    variableName: string,
    value: string | number | boolean | null
) {
    const startTime = Date.now();

    try {
        // Input validation for size and control characters
        const complexityError = validateInputComplexity(value, `variable "${variableName}"`);
        if (complexityError) {
            return createErrorResponse(complexityError, {
                errorCode: ErrorCode.VALIDATION_ERROR,
                sessionId,
                suggestion: 'Reduce the complexity of the value'
            });
        }
        if (typeof value === 'string') {
            const MAX_STRING_LENGTH = 8192;
            if (value.length > MAX_STRING_LENGTH) {
                return createErrorResponse(`Input string for variable "${variableName}" exceeds maximum allowed length of ${MAX_STRING_LENGTH} characters.`, {
                    errorCode: ErrorCode.VALIDATION_ERROR,
                    sessionId,
                    suggestion: 'Reduce the string length or split into multiple variables'
                });
            }

            // Reject strings containing control characters (e.g., null bytes)
            // eslint-disable-next-line no-control-regex
            const controlCharRegex = /[\u0000-\u001F\u007F-\u009F]/;
            if (controlCharRegex.test(value)) {
                return createErrorResponse(`Input string for variable "${variableName}" contains disallowed control characters.`, {
                    errorCode: ErrorCode.VALIDATION_ERROR,
                    sessionId,
                    suggestion: 'Remove control characters from the string value'
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

        // Check if variable is defined in schema
        if (!queryState.variablesSchema[variableName]) {
            return createErrorResponse(`Variable '${variableName}' is not defined in the query schema. Use set-query-variable first.`, {
                errorCode: ErrorCode.VARIABLE_ERROR,
                sessionId,
                suggestion: 'Define the variable using set-query-variable before setting its value'
            });
        }

        const variableType = queryState.variablesSchema[variableName];

        try {
            const schema = await fetchAndCacheSchema();
            const typeNode = parseType(variableType);
            const gqlType = typeFromAST(schema, typeNode as any);

            if (!gqlType) {
                return createErrorResponse(`Could not determine GraphQL type for '${variableType}'.`, {
                    errorCode: ErrorCode.VARIABLE_ERROR,
                    sessionId,
                    suggestion: 'Check that the variable type is valid'
                });
            }

            // Apply coercion for string values
            let processedValue = value;
            if (typeof value === 'string') {
                const coercedValue = GraphQLValidationUtils.coerceStringValue(value);
                if (coercedValue.coerced) {
                    processedValue = coercedValue.value;
                }
            }

            const validationError = GraphQLValidationUtils.validateValueAgainstType(processedValue, gqlType);
            if (validationError) {
                return createErrorResponse(`For variable '${variableName}': ${validationError}`, {
                    errorCode: ErrorCode.VARIABLE_ERROR,
                    sessionId,
                    suggestion: 'Ensure the value matches the variable type'
                });
            }

            // Set the variable value
            queryState.variablesValues[variableName] = processedValue;
        } catch (e: any) {
            return createErrorResponse(`Type validation failed: ${e.message}`, {
                errorCode: ErrorCode.VARIABLE_ERROR,
                sessionId,
                suggestion: 'Check that the value is compatible with the variable type'
            });
        }

        // Save the updated query state
        await saveQueryState(sessionId, queryState);

        return createSuccessResponse(
            {
                message: `Variable '${variableName}' value set to ${JSON.stringify(value)}.`,
                variablesValues: queryState.variablesValues
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

export const setVariableValueTool = {
    name: "set-variable-value",
    description: "Assign a runtime value to a previously defined GraphQL variable for query execution",
    schema: {
        sessionId: z.string().describe('The session ID from start-query-session.'),
        variableName: z.string().describe('The variable name (e.g., "$userId").'),
        value: z.string().describe('The value to assign to the variable.'),
    },
    handler: async ({ sessionId, variableName, value }: {
        sessionId: string,
        variableName: string,
        value: string | number | boolean | null
    }) => {
        const result = await setVariableValue(sessionId, variableName, value);

        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
}; 