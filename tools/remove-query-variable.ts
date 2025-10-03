import { z } from "zod";
import { QueryState, loadQueryState, saveQueryState, GraphQLValidationUtils ,
    createSuccessResponse,
    createErrorResponse,
    ErrorCode
} from "./shared-utils.js";

// Core business logic - testable function
export async function removeQueryVariable(
    sessionId: string,
    variableName: string
) {
    const startTime = Date.now();

    try {
        // Validate variable name syntax
        const variableValidation = GraphQLValidationUtils.validateVariableName(variableName);
        if (!variableValidation.valid) {
            return createErrorResponse(variableValidation.error || 'Invalid variable name.', {
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

        // Check if variable exists
        if (!queryState.variablesSchema[variableName]) {
            return createErrorResponse(`Variable '${variableName}' not defined.`, {
                errorCode: ErrorCode.VARIABLE_ERROR,
                sessionId,
                suggestion: 'Check that the variable name is correct'
            });
        }

        // Remove from all variable-related objects
        delete queryState.variablesSchema[variableName];
        delete queryState.variablesDefaults[variableName];
        delete queryState.variablesValues[variableName];

        // Clean up directives and field arguments that reference this variable
        const cleanupWarnings: string[] = [];

        // Function to clean field arguments that reference the removed variable
        const cleanFieldArguments = (field: any, fieldPath: string) => {
            if (field.args && Object.keys(field.args).length > 0) {
                const argsToRemove: string[] = [];

                Object.entries(field.args).forEach(([argName, argValue]: [string, any]) => {
                    let shouldRemove = false;

                    // Check different argument value formats
                    if (typeof argValue === 'string' && argValue === variableName) {
                        // Simple variable reference: argValue = "$variableName"
                        shouldRemove = true;
                    } else if (typeof argValue === 'object' && argValue !== null) {
                        // Object format: argValue = { value: "$variableName", is_variable: true }
                        if (argValue.value === variableName) {
                            shouldRemove = true;
                        }
                    }

                    if (shouldRemove) {
                        argsToRemove.push(argName);
                        cleanupWarnings.push(`Removed field argument '${argName}' from '${fieldPath}' (referenced deleted variable ${variableName})`);
                    }
                });

                // Remove the arguments that reference the deleted variable
                argsToRemove.forEach(argName => {
                    delete field.args[argName];
                });
            }
        };

        // Function to clean directives from a field node
        const cleanFieldDirectives = (field: any, fieldPath: string) => {
            if (field.directives && field.directives.length > 0) {
                const originalDirectiveCount = field.directives.length;
                field.directives = field.directives.filter((directive: any) => {
                    // Check if directive has arguments that reference the removed variable
                    if (directive.arguments) {
                        const hasReferencedVariable = directive.arguments.some((arg: any) =>
                            arg.value === variableName
                        );
                        if (hasReferencedVariable) {
                            cleanupWarnings.push(`Removed directive '@${directive.name}' from '${fieldPath}' (referenced deleted variable ${variableName})`);
                            return false; // Remove this directive
                        }
                    }
                    return true; // Keep this directive
                });

                // Also check directive args object format
                field.directives = field.directives.filter((directive: any) => {
                    if (directive.args) {
                        const hasReferencedVariable = Object.values(directive.args).some((argValue: any) =>
                            argValue === variableName || (typeof argValue === 'object' && argValue?.value === variableName)
                        );
                        if (hasReferencedVariable) {
                            cleanupWarnings.push(`Removed directive '@${directive.name}' from '${fieldPath}' (referenced deleted variable ${variableName})`);
                            return false; // Remove this directive
                        }
                    }
                    return true; // Keep this directive
                });
            }
        };

        // Recursively clean directives and field arguments from all fields
        const cleanFieldsRecursively = (node: any, path: string = '') => {
            if (node.fields) {
                Object.entries(node.fields).forEach(([fieldName, field]: [string, any]) => {
                    const fieldPath = path ? `${path}.${fieldName}` : fieldName;

                    // Clean both field arguments and directives
                    cleanFieldArguments(field, fieldPath);
                    cleanFieldDirectives(field, fieldPath);

                    // Recurse into nested fields
                    if (field.fields) {
                        cleanFieldsRecursively(field, fieldPath);
                    }
                });
            }
        };

        // Clean field arguments and directives from query structure
        cleanFieldsRecursively(queryState.queryStructure);

        // Clean operation-level directives
        if (queryState.operationDirectives && queryState.operationDirectives.length > 0) {
            const originalOpDirectiveCount = queryState.operationDirectives.length;
            queryState.operationDirectives = queryState.operationDirectives.filter((directive: any) => {
                if (directive.arguments) {
                    const hasReferencedVariable = directive.arguments.some((arg: any) =>
                        arg.value === variableName
                    );
                    if (hasReferencedVariable) {
                        cleanupWarnings.push(`Removed operation directive '@${directive.name}' (referenced deleted variable ${variableName})`);
                        return false;
                    }
                }
                return true;
            });
        }

        // Save the updated query state
        await saveQueryState(sessionId, queryState);

        let message = `Variable '${variableName}' removed from query.`;
        if (cleanupWarnings.length > 0) {
            message += ` Also cleaned up ${cleanupWarnings.length} dependent directive(s): ${cleanupWarnings.join(', ')}`;
        }

        return createSuccessResponse(
            {
                message,
                variablesSchema: queryState.variablesSchema
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

export const removeQueryVariableTool = {
    name: "rm-var",
    description: "Remove a previously defined GraphQL variable from the query structure",
    schema: {
        sessionId: z.string().describe('The session ID from start-query-session.'),
        variableName: z.string().describe('The variable name to remove (must start with $, e.g., "$userId").'),
    },
    handler: async ({ sessionId, variableName }: {
        sessionId: string,
        variableName: string
    }) => {
        const result = await removeQueryVariable(sessionId, variableName);

        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
}; 