import { z } from "zod";
import { QueryState, loadQueryState, saveQueryState, GraphQLValidationUtils, fetchAndCacheSchema } from "./shared-utils.js";
import { isTypeSubTypeOf, typeFromAST } from "graphql";
import { parseType } from "graphql/language/parser.js";

// Core business logic - testable function
export async function setVariableArgument(
    sessionId: string,
    fieldPath: string,
    argumentName: string,
    variableName: string
): Promise<{
    success?: boolean;
    message?: string;
    queryStructure?: any;
    error?: string;
}> {
    try {
        // Validate argument name syntax
        if (!GraphQLValidationUtils.isValidGraphQLName(argumentName)) {
            return {
                error: `Invalid argument name "${argumentName}". Must match /^[_A-Za-z][_0-9A-Za-z]*$/`
            };
        }

        // Validate variable name syntax
        const variableNameValidation = GraphQLValidationUtils.validateVariableName(variableName);
        if (!variableNameValidation.valid) {
            return {
                error: variableNameValidation.error
            };
        }

        // Load query state
        const queryState = await loadQueryState(sessionId);
        if (!queryState) {
            return {
                error: 'Session not found.'
            };
        }

        // Legacy validation for backward compatibility
        if (!variableName.startsWith('$')) {
            return {
                error: `Variable name must start with '$'. Provided: '${variableName}'.`
            };
        }

        // Ensure variable is defined in the session
        const variableTypeStr = queryState.variablesSchema[variableName];
        if (!variableTypeStr) {
            return {
                error: `Variable '${variableName}' is not defined in the query schema. Use set-query-variable first.`
            };
        }

        // Navigate to field in query structure
        let currentNode = queryState.queryStructure;
        if (fieldPath) {
            const pathParts = fieldPath.split('.');
            for (const part of pathParts) {
                if (!currentNode.fields || !currentNode.fields[part]) {
                    return {
                        error: `Field at path '${fieldPath}' not found.`
                    };
                }
                currentNode = currentNode.fields[part];
            }
        }

        // Schema-aware validation: check that the field has the argument and that the variable type is compatible (best-effort)
        try {
            const schema = await fetchAndCacheSchema(queryState.headers);

            // Ensure argument exists
            const argType = GraphQLValidationUtils.getArgumentType(schema, fieldPath, argumentName);
            if (argType) {
                // Parse variable GraphQL type
                const varTypeNode = parseType(variableTypeStr);
                const varGqlType = typeFromAST(schema, varTypeNode as any);
                if (varGqlType && !isTypeSubTypeOf(schema as any, varGqlType as any, argType as any)) {
                    return { error: `Variable '${variableName}' of type '${variableTypeStr}' cannot be used for argument '${argumentName}' of type '${String(argType)}'.` };
                }
            }
        } catch (schemaError: any) {
            // If schema validation isn't available (e.g., in mocked envs), continue without blocking
            console.warn('Schema validation skipped for setVariableArgument:', schemaError?.message || schemaError);
        }

        // Set the argument value
        if (!(currentNode as any).args) {
            (currentNode as any).args = {};
        }
        (currentNode as any).args[argumentName] = variableName;

        // Save updated query state
        await saveQueryState(sessionId, queryState);

        return {
            success: true,
            message: `Variable argument '${argumentName}' set to ${variableName} at path '${fieldPath}'.`,
            queryStructure: queryState.queryStructure
        };
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

export const setVariableArgumentTool = {
    name: "set-var-arg",
    description: "Set a field argument to reference a GraphQL variable instead of a literal value",
    schema: {
        sessionId: z.string().describe('The session ID from start-query-session.'),
        fieldPath: z.string().describe('Dot-notation path to the field (e.g., "user.profile").'),
        argumentName: z.string().describe('The name of the argument to set.'),
        variableName: z.string().describe('The variable name (must start with $, e.g., "$userId").'),
    },
    handler: async ({ sessionId, fieldPath, argumentName, variableName }: {
        sessionId: string,
        fieldPath: string,
        argumentName: string,
        variableName: string
    }) => {
        const result = await setVariableArgument(sessionId, fieldPath, argumentName, variableName);

        return {
            content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
            }],
        };
    }
}; 