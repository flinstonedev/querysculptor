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
import { isTypeSubTypeOf, typeFromAST } from "graphql";
import { parseType } from "graphql/language/parser.js";

// Core business logic - testable function
export async function setFieldDirective(
    sessionId: string,
    currentPath: string,
    directiveName: string,
    argumentName?: string,
    argumentValue?: string | number | boolean | null
) {
    const startTime = Date.now();

    // --- Input Validation ---
    const complexityError = validateInputComplexity(argumentValue, `directive argument "${argumentName}"`);
    if (complexityError) {
        return createErrorResponse(complexityError, {
            errorCode: ErrorCode.VALIDATION_ERROR,
            sessionId,
            path: currentPath,
            suggestion: 'Reduce the complexity of the directive argument value'
        });
    }
    // --- End Input Validation ---

    try {
        if (!GraphQLValidationUtils.isValidGraphQLName(directiveName.replace('@', ''))) {
            return createErrorResponse(
                `Invalid directive name "${directiveName}".`,
                {
                    errorCode: ErrorCode.VALIDATION_ERROR,
                    sessionId,
                    path: currentPath,
                    suggestion: 'Use a valid GraphQL name format for the directive'
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

        try {
            const schema = await fetchAndCacheSchema();
            const directive = schema.getDirective(directiveName);

            if (!directive) {
                return createErrorResponse(
                    `Directive '@${directiveName}' not found in the schema.`,
                    {
                        errorCode: ErrorCode.DIRECTIVE_ERROR,
                        sessionId,
                        path: currentPath,
                        suggestion: 'Verify the directive name using introspect-schema'
                    }
                );
            }

            if (argumentName) {
                const argDef = directive.args.find(a => a.name === argumentName);
                if (!argDef) {
                    return createErrorResponse(
                        `Argument '${argumentName}' not found on directive '@${directiveName}'.`,
                        {
                            errorCode: ErrorCode.DIRECTIVE_ERROR,
                            sessionId,
                            path: currentPath,
                            suggestion: 'Check the directive definition for available arguments'
                        }
                    );
                }

                if (typeof argumentValue === 'string' && argumentValue.startsWith('$')) {
                    // It's a variable
                    const variableName = argumentValue;
                    const variableTypeStr = queryState.variablesSchema[variableName];
                    if (!variableTypeStr) {
                        return createErrorResponse(
                            `Variable '${variableName}' is not defined.`,
                            {
                                errorCode: ErrorCode.VALIDATION_ERROR,
                                sessionId,
                                path: currentPath,
                                suggestion: 'Define the variable using declare-variable first'
                            }
                        );
                    }
                    const varTypeNode = parseType(variableTypeStr);
                    const varGqlType = typeFromAST(schema, varTypeNode as any);
                    if (!varGqlType) {
                        return createErrorResponse(
                            `Could not determine type for variable '${variableName}'.`,
                            {
                                errorCode: ErrorCode.VALIDATION_ERROR,
                                sessionId,
                                path: currentPath,
                                suggestion: 'Verify the variable type is valid'
                            }
                        );
                    }

                    if (!isTypeSubTypeOf(schema, varGqlType, argDef.type)) {
                        return createErrorResponse(
                            `Variable '${variableName}' of type '${variableTypeStr}' cannot be used for argument '${argumentName}' of type '${argDef.type.toString()}'.`,
                            {
                                errorCode: ErrorCode.VALIDATION_ERROR,
                                sessionId,
                                path: currentPath,
                                suggestion: 'Ensure the variable type matches the argument type'
                            }
                        );
                    }
                } else if (argumentValue !== undefined) {
                    // It's a literal value
                    const validationError = GraphQLValidationUtils.validateValueAgainstType(argumentValue, argDef.type);
                    if (validationError) {
                        return createErrorResponse(
                            `For argument '${argumentName}' on directive '@${directiveName}': ${validationError}`,
                            {
                                errorCode: ErrorCode.VALIDATION_ERROR,
                                sessionId,
                                path: currentPath,
                                suggestion: 'Ensure the argument value matches the expected type'
                            }
                        );
                    }
                }
            }
        } catch (e: any) {
            return createErrorResponse(
                `Directive argument validation failed: ${e.message}`,
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

        // Add directive to field
        if (!(currentNode as any).directives) {
            (currentNode as any).directives = [];
        }

        let existingDirective = (currentNode as any).directives.find((d: any) => d.name === directiveName);

        // Handle type coercion for string arguments
        let processedArgumentValue = argumentValue;
        if (argumentName && argumentValue !== undefined && typeof argumentValue === 'string') {
            const coercedResult = GraphQLValidationUtils.coerceStringValue(argumentValue);
            if (coercedResult.coerced) {
                processedArgumentValue = coercedResult.value;
            }
        }

        if (existingDirective) {
            if (argumentName && argumentValue !== undefined) {
                if (!existingDirective.arguments) {
                    existingDirective.arguments = [];
                }
                existingDirective.arguments.push({ name: argumentName, value: processedArgumentValue });
            }
        } else {
            const newDirective: any = { name: directiveName };
            if (argumentName && argumentValue !== undefined) {
                newDirective.arguments = [{ name: argumentName, value: processedArgumentValue }];
            }
            (currentNode as any).directives.push(newDirective);
        }

        // Save updated query state
        await saveQueryState(sessionId, queryState);

        let message = `Directive '@${directiveName}' applied to field at path '${currentPath}'.`;
        let warning = undefined;

        // Add type coercion feedback
        if (argumentName && argumentValue !== undefined && typeof argumentValue === 'string') {
            const coercedResult = GraphQLValidationUtils.coerceStringValue(argumentValue);
            if (coercedResult.coerced && coercedResult.warning) {
                warning = coercedResult.warning;
                message += ` Auto-coerced argument to ${coercedResult.type}.`;
            }
        }

        return createSuccessResponse(
            {
                message,
                warning,
                currentPath,
                directiveName,
                argumentName,
                argumentValue
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

export const setFieldDirectiveTool = {
    name: "set-field-directive",
    description: "Add GraphQL directives like @include or @skip to fields for conditional selection",
    schema: {
        sessionId: z.string().describe('The session ID from start-query-session.'),
        currentPath: z.string().describe('Dot-notation path to the field (e.g., "user.profile").'),
        directiveName: z.string().describe('The name of the directive (e.g., "include", "skip").'),
        argumentName: z.string().optional().describe('Optional argument name for the directive.'),
        argumentValue: z.string().optional().describe('Optional argument value.'),
    },
    handler: async ({ sessionId, currentPath, directiveName, argumentName, argumentValue }: {
        sessionId: string,
        currentPath: string,
        directiveName: string,
        argumentName?: string,
        argumentValue?: string | number | boolean | null
    }) => {
        const result = await setFieldDirective(sessionId, currentPath, directiveName, argumentName, argumentValue);

        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
}; 