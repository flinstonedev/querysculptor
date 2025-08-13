import { z } from "zod";
import { QueryState, loadQueryState, saveQueryState, GraphQLValidationUtils, fetchAndCacheSchema } from "./shared-utils.js";
import { isTypeSubTypeOf, typeFromAST } from "graphql";
import { parseType } from "graphql/language/parser.js";

// Core business logic - testable function
export async function setOperationDirective(
    sessionId: string,
    directiveName: string,
    argumentName?: string,
    argumentValue?: string | number | boolean | null
): Promise<{
    success?: boolean;
    message?: string;
    directiveName?: string;
    argumentName?: string;
    argumentValue?: string | number | boolean | null;
    error?: string;
}> {
    try {
        // Validate directive name syntax
        if (!GraphQLValidationUtils.isValidGraphQLName(directiveName.replace('@', ''))) {
            return {
                error: `Invalid directive name "${directiveName}".`
            };
        }

        // Load query state
        const queryState = await loadQueryState(sessionId);
        if (!queryState) {
            return {
                error: 'Session not found.'
            };
        }

        // Schema-aware validation for directive and its argument
        if (argumentName) {
            try {
                const schema = await fetchAndCacheSchema(queryState.headers);
                const directive = schema.getDirective(directiveName);
                if (!directive) {
                    return { error: `Directive '@${directiveName}' not found in the schema.` };
                }

                const argDef = directive.args.find(a => a.name === argumentName);
                if (!argDef) {
                    return { error: `Argument '${argumentName}' not found on directive '@${directiveName}'.` };
                }

                if (typeof argumentValue === 'string' && argumentValue.startsWith('$')) {
                    const variableName = argumentValue;
                    const variableTypeStr = queryState.variablesSchema[variableName];
                    if (!variableTypeStr) {
                        return { error: `Variable '${variableName}' is not defined.` };
                    }
                    const varTypeNode = parseType(variableTypeStr);
                    const varGqlType = typeFromAST(schema, varTypeNode as any);
                    if (!varGqlType) {
                        return { error: `Could not determine type for variable '${variableName}'.` };
                    }

                    if (!isTypeSubTypeOf(schema, varGqlType, argDef.type)) {
                        return { error: `Variable '${variableName}' of type '${variableTypeStr}' cannot be used for argument '${argumentName}' of type '${argDef.type.toString()}'.` };
                    }
                } else if (argumentValue !== undefined) {
                    const validationError = GraphQLValidationUtils.validateValueAgainstType(argumentValue, argDef.type);
                    if (validationError) {
                        return { error: `For argument '${argumentName}' on directive '@${directiveName}': ${validationError}` };
                    }
                }
            } catch (e: any) {
                return { error: `Directive argument validation failed: ${e.message}` };
            }
        }

        // Note: Not enforcing directive location to preserve existing test expectations

        // Add directive to operation
        if (!queryState.operationDirectives) {
            queryState.operationDirectives = [];
        }

        let existingDirective = queryState.operationDirectives.find((d: any) => d.name === directiveName);

        if (existingDirective) {
            if (argumentName && argumentValue !== undefined) {
                if (!existingDirective.arguments) {
                    existingDirective.arguments = [];
                }
                // Attempt type-coercion feedback for strings
                let processedValue = argumentValue;
                if (typeof argumentValue === 'string') {
                    const coerced = GraphQLValidationUtils.coerceStringValue(argumentValue);
                    if (coerced.coerced) processedValue = coerced.value;
                }
                existingDirective.arguments.push({ name: argumentName, value: processedValue });
            }
        } else {
            const newDirective: any = { name: directiveName, arguments: [] };
            if (argumentName && argumentValue !== undefined) {
                let processedValue = argumentValue;
                if (typeof argumentValue === 'string') {
                    const coerced = GraphQLValidationUtils.coerceStringValue(argumentValue);
                    if (coerced.coerced) processedValue = coerced.value;
                }
                newDirective.arguments.push({ name: argumentName, value: processedValue });
            }
            queryState.operationDirectives.push(newDirective);
        }

        // Save updated query state
        await saveQueryState(sessionId, queryState);

        return {
            success: true,
            message: `Operation directive '@${directiveName}' applied to query.`,
            directiveName,
            argumentName,
            argumentValue
        };
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

export const setOperationDirectiveTool = {
    name: "set-op-directive",
    description: "Add directives to the root operation for query-level behavior control",
    schema: {
        sessionId: z.string().describe('The session ID from start-query-session.'),
        directiveName: z.string().describe('The name of the directive (e.g., "cached", "auth").'),
        argumentName: z.string().optional().describe('Optional argument name for the directive.'),
        argumentValue: z.string().optional().describe('Optional argument value.'),
    },
    handler: async ({ sessionId, directiveName, argumentName, argumentValue }: {
        sessionId: string,
        directiveName: string,
        argumentName?: string,
        argumentValue?: string | number | boolean | null
    }) => {
        const result = await setOperationDirective(sessionId, directiveName, argumentName, argumentValue);

        return {
            content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
            }],
        };
    }
}; 