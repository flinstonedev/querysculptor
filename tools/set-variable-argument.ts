import { z } from "zod";
import { QueryState, loadQueryState, saveQueryState, GraphQLValidationUtils, fetchAndCacheSchema ,
    createSuccessResponse,
    createErrorResponse,
    ErrorCode
} from "./shared-utils.js";
import { isTypeSubTypeOf, typeFromAST, getNamedType, isObjectType, isInterfaceType } from 'graphql';
import { parseType } from 'graphql/language/parser.js';

// Core business logic - testable function
export async function setVariableArgument(
    sessionId: string,
    currentPath: string,
    argumentName: string,
    variableName: string
) {
    const startTime = Date.now();

    try {
        // Validate argument name syntax
        if (!GraphQLValidationUtils.isValidGraphQLName(argumentName)) {
            return createErrorResponse(`Invalid argument name "${argumentName}". Must match /^[_A-Za-z][_0-9A-Za-z]*$/`, {
                errorCode: ErrorCode.VALIDATION_ERROR,
                sessionId,
                suggestion: 'Use a valid GraphQL name for the argument'
            });
        }

        // Validate variable name syntax
        const variableNameValidation = GraphQLValidationUtils.validateVariableName(variableName);
        if (!variableNameValidation.valid) {
            return createErrorResponse(variableNameValidation.error || 'Invalid variable name.', {
                errorCode: ErrorCode.VALIDATION_ERROR,
                sessionId,
                suggestion: 'Variable name must start with $ and follow GraphQL naming rules (e.g., "$userId")'
            });
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

        // Navigate to field in query structure
        let currentNode = queryState.queryStructure;
        if (currentPath) {
            const pathParts = currentPath.split('.');
            for (const part of pathParts) {
                if (!currentNode.fields || !currentNode.fields[part]) {
                    return createErrorResponse(`Field at path '${currentPath}' not found.`, {
                        errorCode: ErrorCode.VALIDATION_ERROR,
                        sessionId,
                        suggestion: 'Check that the field path is correct and fields have been added'
                    });
                }
                currentNode = currentNode.fields[part];
            }
        }

        // Schema-aware validation: ensure argument exists and variable type is compatible
        try {
            const schema = await fetchAndCacheSchema();

            const argType = GraphQLValidationUtils.getArgumentType(schema, currentPath, argumentName);
            if (!argType) {
                return createErrorResponse(`Argument '${argumentName}' not found on field '${currentPath}'.`, {
                    errorCode: ErrorCode.VALIDATION_ERROR,
                    sessionId,
                    suggestion: 'Use introspect-schema to see available arguments for this field'
                });
            }

            // Ensure variable exists and its type is compatible
            const variableTypeStr = queryState.variablesSchema[variableName];
            if (!variableTypeStr) {
                return createErrorResponse(`Variable '${variableName}' is not defined. Use set-query-variable first.`, {
                    errorCode: ErrorCode.VARIABLE_ERROR,
                    sessionId,
                    suggestion: 'Define the variable using set-query-variable before using it in arguments'
                });
            }
            const varTypeNode = parseType(variableTypeStr);
            const varGqlType = typeFromAST(schema, varTypeNode as any);
            if (!varGqlType) {
                return createErrorResponse(`Could not determine type for variable '${variableName}'.`, {
                    errorCode: ErrorCode.VARIABLE_ERROR,
                    sessionId,
                    suggestion: 'Check that the variable type is valid'
                });
            }

            if (!isTypeSubTypeOf(schema, varGqlType, argType as any)) {
                return createErrorResponse(`Variable '${variableName}' of type '${variableTypeStr}' cannot be used for argument '${argumentName}' of type '${argType.toString()}'.`, {
                    errorCode: ErrorCode.VARIABLE_ERROR,
                    sessionId,
                    suggestion: 'Ensure the variable type is compatible with the argument type'
                });
            }
        } catch (e: any) {
            return createErrorResponse(`Schema validation failed: ${e.message}`, {
                errorCode: ErrorCode.VALIDATION_ERROR,
                sessionId,
                suggestion: 'Check that the field and argument exist in the schema'
            });
        }

        // Set the argument value
        if (!(currentNode as any).args) {
            (currentNode as any).args = {};
        }
        (currentNode as any).args[argumentName] = variableName;

        // Save updated query state
        await saveQueryState(sessionId, queryState);

        return createSuccessResponse(
            {
                message: `Variable argument '${argumentName}' set to ${variableName} at path '${currentPath}'.`,
                queryStructure: queryState.queryStructure
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

export const setVariableArgumentTool = {
    name: "set-var-arg",
    description: "Set a field argument to reference a GraphQL variable instead of a literal value",
    schema: {
        sessionId: z.string().describe('The session ID from start-query-session.'),
        currentPath: z.string().describe('Dot-notation path to the field (e.g., "user.profile").'),
        argumentName: z.string().describe('The name of the argument to set.'),
        variableName: z.string().describe('The variable name (must start with $, e.g., "$userId").'),
    },
    handler: async ({ sessionId, currentPath, argumentName, variableName }: {
        sessionId: string,
        currentPath: string,
        argumentName: string,
        variableName: string
    }) => {
        const result = await setVariableArgument(sessionId, currentPath, argumentName, variableName);

        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
}; 