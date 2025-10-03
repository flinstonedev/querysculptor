import { z } from "zod";
import { loadQueryState, saveQueryState, GraphQLValidationUtils, fetchAndCacheSchema ,
    createSuccessResponse,
    createErrorResponse,
    ErrorCode
} from "./shared-utils.js";

// Core business logic - testable function
export async function selectMultipleFields(
    sessionId: string,
    currentPath: string = "",
    fieldNames: string[]
) {
    const startTime = Date.now();
    try {
        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
            return createErrorResponse('Invalid sessionId.', {
                errorCode: ErrorCode.SESSION_NOT_FOUND,
                sessionId,
                suggestion: 'Provide a valid session ID from start-query-session'
            });
        }
        // Validate field names syntax
        for (const fieldName of fieldNames) {
            if (!GraphQLValidationUtils.isValidGraphQLName(fieldName)) {
                return createErrorResponse(`Invalid field name "${fieldName}". Must match /^[_A-Za-z][_0-9A-Za-z]*$/`, {
                    errorCode: ErrorCode.FIELD_ERROR,
                    sessionId,
                    suggestion: 'Field names must start with a letter or underscore and contain only alphanumeric characters and underscores'
                });
            }
        }

        // Load query state
        const queryState = await loadQueryState(sessionId);
        if (!queryState) {
            return createErrorResponse('Session not found.', {
                errorCode: ErrorCode.SESSION_NOT_FOUND,
                sessionId,
                suggestion: 'Use start-query-session to create a new session'
            });
        }

        // Navigate to the current node in the query structure
        let parentNode = queryState.queryStructure;
        if (currentPath) {
            const pathParts = currentPath.split('.');
            for (const part of pathParts) {
                if (!parentNode.fields[part]) {
                    return createErrorResponse(`Path '${currentPath}' not found in query structure.`, {
                        errorCode: ErrorCode.FIELD_ERROR,
                        sessionId,
                        path: currentPath,
                        suggestion: 'Verify the path exists using get-current-query'
                    });
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
                    currentPath,
                    fieldName
                );

                if (!validation.valid) {
                    return createErrorResponse(validation.error || 'Field validation failed', {
                        errorCode: ErrorCode.FIELD_ERROR,
                        sessionId,
                        path: currentPath,
                        suggestion: 'Use get-selections to see available fields at this path'
                    });
                }
            }
        } catch (validationError) {
            return createErrorResponse(
                `Schema validation failed: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
                {
                    errorCode: ErrorCode.SCHEMA_ERROR,
                    sessionId,
                    path: currentPath,
                    suggestion: 'Check if the schema is accessible and the fields exist at this path'
                }
            );
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

        return createSuccessResponse(
            {
                success: true,
                message: `Successfully selected ${addedFields.length} fields at path '${currentPath}': ${addedFields.join(', ')}.`,
                selectedFields: addedFields,
                currentPath: currentPath
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
                path: currentPath
            }
        );
    }
}

export const selectMultipleFieldsTool = {
    name: "select-multi-fields",
    description: "Add multiple fields to the GraphQL query structure in a single operation for efficiency",
    schema: {
        sessionId: z.string().describe('The session ID from start-query-session.'),
        currentPath: z.string().default("").describe('Dot-notation path where fields should be added (e.g., "user", "" for root).'),
        fieldNames: z.array(z.string()).describe('Array of field names to select (without aliases or arguments).'),
    },
    handler: async ({ sessionId, currentPath = "", fieldNames }: {
        sessionId: string,
        currentPath?: string,
        fieldNames: string[]
    }) => {
        const result = await selectMultipleFields(sessionId, currentPath, fieldNames);

        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
}; 