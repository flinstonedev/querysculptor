import { z } from "zod";
import { QueryState, loadQueryState, saveQueryState, GraphQLValidationUtils, fetchAndCacheSchema } from "./shared-utils.js";
import { isObjectType, isInterfaceType, getNamedType, GraphQLObjectType, GraphQLInterfaceType, GraphQLFieldMap, GraphQLField, GraphQLNamedType } from 'graphql';

// Core business logic - testable function
export async function selectMultipleFields(
    sessionId: string,
    parentPath: string = "",
    fieldNames: string[]
): Promise<{
    success?: boolean;
    message?: string;
    selectedFields?: string[];
    parentPath?: string;
    error?: string;
}> {
    try {
        // Validate field names syntax
        for (const fieldName of fieldNames) {
            if (!GraphQLValidationUtils.isValidGraphQLName(fieldName)) {
                return {
                    error: `Invalid field name "${fieldName}". Must match /^[_A-Za-z][_0-9A-Za-z]*$/`
                };
            }
        }

        // Load query state
        const queryState = await loadQueryState(sessionId);
        if (!queryState) {
            return {
                error: 'Session not found.'
            };
        }

        // Navigate to the parent node in the query structure
        let parentNode = queryState.queryStructure;
        if (parentPath) {
            const pathParts = parentPath.split('.');
            for (const part of pathParts) {
                if (!parentNode.fields[part]) {
                    return {
                        error: `Parent path '${parentPath}' not found in query structure.`
                    };
                }
                parentNode = parentNode.fields[part];
            }
        }

        // Comprehensive incremental validation for each field
        try {
            const schema = await fetchAndCacheSchema(queryState.headers);
            for (const fieldName of fieldNames) {
                const validation = GraphQLValidationUtils.validateFieldAddition(
                    schema,
                    queryState,
                    parentPath,
                    fieldName
                );

                if (!validation.valid) {
                    return {
                        error: validation.error
                    };
                }
            }
        } catch (validationError) {
            return {
                error: `Schema validation failed: ${validationError instanceof Error ? validationError.message : String(validationError)}`
            };
        }

        // Add all fields to the query structure
        if (!parentNode.fields) {
            parentNode.fields = {};
        }

        const addedFields: string[] = [];
        for (const fieldName of fieldNames) {
            parentNode.fields[fieldName] = {
                fieldName: fieldName,  // Add fieldName property for proper serialization
                alias: null,
                args: {},
                fields: {},
                directives: [],
                fragmentSpreads: [],
                inlineFragments: []
            };
            addedFields.push(fieldName);
        }

        // Save the updated query state
        await saveQueryState(sessionId, queryState);

        return {
            success: true,
            message: `Successfully selected ${addedFields.length} fields at path '${parentPath}': ${addedFields.join(', ')}.`,
            selectedFields: addedFields,
            parentPath
        };
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

export const selectMultipleFieldsTool = {
    name: "select-multi-fields",
    description: "Add multiple fields to the GraphQL query structure in a single operation for efficiency",
    schema: {
        sessionId: z.string().describe('The session ID from start-query-session.'),
        parentPath: z.string().default("").describe('Dot-notation path where fields should be added (e.g., "user", "" for root).'),
        fieldNames: z.array(z.string()).describe('Array of field names to select (without aliases or arguments).'),
    },
    handler: async ({ sessionId, parentPath = "", fieldNames }: {
        sessionId: string,
        parentPath?: string,
        fieldNames: string[]
    }) => {
        const result = await selectMultipleFields(sessionId, parentPath, fieldNames);

        return {
            content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
            }],
        };
    }
}; 