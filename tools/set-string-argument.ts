import { z } from "zod";
import { QueryState, loadQueryState, saveQueryState, GraphQLValidationUtils ,
    createSuccessResponse,
    createErrorResponse,
    ErrorCode
} from "./shared-utils.js";

// Core business logic - testable function
export async function setStringArgument(
    sessionId: string,
    currentPath: string,
    argumentName: string,
    value: string,
    isEnum: boolean = false
) {
    const startTime = Date.now();
    try {
        // Input validation for size and control characters, skip for enums
        if (!isEnum) {
            if (value === '') {
                return createErrorResponse(
                    `Empty string not allowed for argument "${argumentName}". Use null for empty values or provide a non-empty string.`,
                    {
                        errorCode: ErrorCode.VALIDATION_ERROR,
                        sessionId,
                        path: currentPath,
                        suggestion: 'Use null for empty values or provide a non-empty string'
                    }
                );
            }
            const lengthValidation = GraphQLValidationUtils.validateStringLength(value, argumentName);
            if (!lengthValidation.valid) {
                return createErrorResponse(lengthValidation.error!, {
                    errorCode: ErrorCode.VALIDATION_ERROR,
                    sessionId,
                    path: currentPath,
                    suggestion: 'Ensure string value length is within allowed limits'
                });
            }

            const controlCharValidation = GraphQLValidationUtils.validateNoControlCharacters(value, argumentName);
            if (!controlCharValidation.valid) {
                return createErrorResponse(controlCharValidation.error!, {
                    errorCode: ErrorCode.VALIDATION_ERROR,
                    sessionId,
                    path: currentPath,
                    suggestion: 'Remove control characters from the string value'
                });
            }
        }

        const paginationValidation = GraphQLValidationUtils.validatePaginationValue(argumentName, value);
        if (!paginationValidation.valid) {
            return createErrorResponse(paginationValidation.error!, {
                errorCode: ErrorCode.VALIDATION_ERROR,
                sessionId,
                path: currentPath,
                suggestion: 'Verify pagination argument value is valid'
            });
        }

        // Validate argument name syntax
        if (!GraphQLValidationUtils.isValidGraphQLName(argumentName)) {
            return createErrorResponse(
                `Invalid argument name "${argumentName}". Must match /^[_A-Za-z][_0-9A-Za-z]*$/`,
                {
                    errorCode: ErrorCode.VALIDATION_ERROR,
                    sessionId,
                    path: currentPath,
                    suggestion: 'Use a valid GraphQL name format for the argument'
                }
            );
        }

        // Load query state
        const queryState = await loadQueryState(sessionId);
        if (!queryState) {
            return createErrorResponse('Session not found.', {
                errorCode: ErrorCode.SESSION_NOT_FOUND,
                sessionId,
                path: currentPath,
                suggestion: 'Start a new session with start-query-session'
            });
        }

        // Comprehensive incremental validation
        let validationWarning: string | undefined;
        try {
            const { fetchAndCacheSchema } = await import('./shared-utils.js');
            const schema = await fetchAndCacheSchema();
            
            const validation = GraphQLValidationUtils.validateArgumentAddition(
                schema,
                queryState,
                currentPath,
                argumentName,
                value,
                false // String arguments are not variables
            );

            if (!validation.valid) {
                return createErrorResponse(validation.error!, {
                    errorCode: ErrorCode.ARGUMENT_ERROR,
                    sessionId,
                    path: currentPath,
                    suggestion: 'Verify the argument exists and the value type is correct'
                });
            }

            validationWarning = validation.warning;

        } catch (error) {
            return createErrorResponse(
                `Schema validation failed: ${error instanceof Error ? error.message : String(error)}`,
                {
                    errorCode: ErrorCode.INTERNAL_ERROR,
                    sessionId,
                    path: currentPath,
                    suggestion: 'Verify the schema is accessible and valid'
                }
            );
        }

        // Navigate to field in query structure
        let currentNode = queryState.queryStructure;
        if (currentPath) {
            const pathParts = currentPath.split('.');
            for (const part of pathParts) {
                if (!currentNode.fields || !currentNode.fields[part]) {
                    return createErrorResponse(
                        `Field at path '${currentPath}' not found.`,
                        {
                            errorCode: ErrorCode.FIELD_ERROR,
                            sessionId,
                            path: currentPath,
                            suggestion: 'Verify the field exists using get-selections'
                        }
                    );
                }
                currentNode = currentNode.fields[part];
            }
        }

        // Set the argument value using secure serialization
        if (!(currentNode as any).args) {
            (currentNode as any).args = {};
        }

        // Enhanced type detection and coercion
        if (isEnum) {
            (currentNode as any).args[argumentName] = { value, is_enum: true }; // Store enum with proper flag
        } else {
            // Auto-detect numeric and boolean values for better GraphQL output
            const coercedResult = GraphQLValidationUtils.coerceStringValue(value);

            if (coercedResult.coerced) {
                // Store as typed value for proper rendering
                (currentNode as any).args[argumentName] = {
                    value: coercedResult.value,
                    is_typed: true,
                    original_string: value // Keep original for debugging
                };
            } else {
                // Store string with special marker to indicate it needs quoting during query building
                (currentNode as any).args[argumentName] = { __graphqlString: value };
            }
        }

        // Save updated query state
        await saveQueryState(sessionId, queryState);

        let message = `String argument '${argumentName}' set to "${value}" at path '${currentPath}'.`;
        let warning = validationWarning;

        // Add type coercion feedback and performance warnings
        if (!isEnum) {
            const coercedResult = GraphQLValidationUtils.coerceStringValue(value);
            if (coercedResult.coerced && coercedResult.warning) {
                warning = warning ? `${warning} ${coercedResult.warning}` : coercedResult.warning;
                message += ` Auto-coerced to ${coercedResult.type}.`;
            }

            // Add performance warning if applicable
            const performanceWarning = GraphQLValidationUtils.generatePerformanceWarning(argumentName, coercedResult.coerced ? coercedResult.value : value);
            if (performanceWarning) {
                warning = warning ? `${warning} ${performanceWarning}` : performanceWarning;
            }
        }

        return createSuccessResponse(
            {
                message,
                warning,
                queryStructure: queryState.queryStructure
            },
            {
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
                sessionId,
                path: currentPath,
                suggestion: 'Check the error message and verify all inputs are correct'
            }
        );
    }
}

export const setStringArgumentTool = {
    name: "set-string-argument",
    description: "Set string or enum arguments on GraphQL fields with automatic type detection and validation",
    schema: {
        sessionId: z.string().describe('The session ID from start-query-session.'),
        currentPath: z.string().describe('Dot-notation path to the field (e.g., "user.profile").'),
        argumentName: z.string().describe('The name of the argument to set.'),
        value: z.string().describe('The string value for the argument.'),
        isEnum: z.boolean().default(false).describe('If true, treat as enum value (unquoted).'),
    },
    handler: async ({ sessionId, currentPath, argumentName, value, isEnum = false }: {
        sessionId: string,
        currentPath: string,
        argumentName: string,
        value: string,
        isEnum?: boolean
    }) => {
        const result = await setStringArgument(sessionId, currentPath, argumentName, value, isEnum);

        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
}; 