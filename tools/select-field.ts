import { z } from "zod";
import { GraphQLSchema, isObjectType, isInterfaceType, getNamedType } from 'graphql';
import {
    QueryState,
    loadQueryState,
    saveQueryState,
    fetchAndCacheSchema,
    GraphQLValidationUtils,
    createSuccessResponse,
    createErrorResponse,
    wrapToolResponse,
    ErrorCode
} from "./shared-utils.js";

// Core business logic - testable function
export async function selectGraphQLField(
    sessionId: string,
    currentPath: string = "",
    fieldName: string,
    alias?: string
) {
    const startTime = Date.now();

    try {
        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
            return createErrorResponse('Invalid sessionId', {
                errorCode: ErrorCode.VALIDATION_ERROR,
                suggestion: 'Provide a valid session ID from start-query-session'
            });
        }

        // Validate field alias syntax
        const aliasValidation = GraphQLValidationUtils.validateFieldAlias(alias || null);
        if (!aliasValidation.valid) {
            return createErrorResponse(aliasValidation.error || 'Invalid field alias', {
                errorCode: ErrorCode.FIELD_ERROR,
                field: fieldName,
                sessionId
            });
        }

        // Validate field name syntax
        if (!GraphQLValidationUtils.isValidGraphQLName(fieldName)) {
            return createErrorResponse(
                `Invalid field name "${fieldName}"`,
                {
                    errorCode: ErrorCode.FIELD_ERROR,
                    field: fieldName,
                    suggestion: 'Field names must match /^[_A-Za-z][_0-9A-Za-z]*$/',
                    sessionId
                }
            );
        }

        // Load query state
        const queryState = await loadQueryState(sessionId);
        if (!queryState) {
            return createErrorResponse('Session not found', {
                errorCode: ErrorCode.SESSION_NOT_FOUND,
                suggestion: 'Start a new session with start-query-session',
                sessionId
            });
        }

        const warnings: string[] = [];

        // Comprehensive incremental validation
        try {
            const schema = await fetchAndCacheSchema(queryState.headers);
            const validation = GraphQLValidationUtils.validateFieldAddition(
                schema,
                queryState,
                currentPath,
                fieldName,
                alias
            );

            if (!validation.valid) {
                return createErrorResponse(validation.error || 'Field validation failed', {
                    errorCode: ErrorCode.VALIDATION_ERROR,
                    field: fieldName,
                    path: currentPath,
                    sessionId
                });
            }

            if (validation.warning) {
                warnings.push(validation.warning);
            }
        } catch (schemaError) {
            return createErrorResponse(
                `Schema validation failed: ${schemaError instanceof Error ? schemaError.message : String(schemaError)}`,
                {
                    errorCode: ErrorCode.SCHEMA_ERROR,
                    field: fieldName,
                    sessionId
                }
            );
        }

        // Navigate to the current node in the query structure
        let parentNode = queryState.queryStructure;
        if (currentPath) {
            const pathParts = currentPath.split('.');
            for (const part of pathParts) {
                if (!parentNode.fields[part]) {
                    return createErrorResponse(`Path '${currentPath}' not found in query structure`, {
                        errorCode: ErrorCode.FIELD_ERROR,
                        path: currentPath,
                        suggestion: 'Verify the path exists using get-current-query',
                        sessionId
                    });
                }
                parentNode = parentNode.fields[part]!;
            }
        }

        // Add the field to the structure
        if (!parentNode.fields) {
            parentNode.fields = {};
        }

        const key = alias || fieldName;

        // Check for alias conflicts
        if (parentNode.fields[key] && parentNode.fields[key].fieldName !== fieldName) {
            return createErrorResponse(
                `Alias conflict: '${key}' is already used for field '${parentNode.fields[key].fieldName}'`,
                {
                    errorCode: ErrorCode.FIELD_ERROR,
                    field: fieldName,
                    path: currentPath,
                    suggestion: 'Choose a different alias or field name',
                    sessionId
                }
            );
        }

        parentNode.fields[key] = {
            fieldName: fieldName,
            alias: alias || null,
            args: {},
            fields: {},
            directives: [],
            fragmentSpreads: [],
            inlineFragments: []
        };

        // Save updated query state
        await saveQueryState(sessionId, queryState);

        return createSuccessResponse(
            {
                message: `Field '${fieldName}' selected successfully`,
                fieldKey: key,
                currentPath: currentPath,
                fieldName: fieldName,
                alias: alias || null
            },
            {
                warnings: warnings.length > 0 ? warnings : undefined,
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
                field: fieldName,
                path: currentPath,
                sessionId
            }
        );
    }
}

export const selectFieldTool = {
    name: "select-field",
    description: "Add a field to the GraphQL query structure with optional aliasing and validation",
    schema: {
        sessionId: z.string().describe('The session ID from start-query-session.'),
        currentPath: z.string().default("").describe('Dot-notation path where the field should be added (e.g., "user", "" for root).'),
        fieldName: z.string().describe('The name of the field to select.'),
        alias: z.string().optional().describe('An optional alias for the selected field.'),
    },
    handler: async ({ sessionId, currentPath = "", fieldName, alias }: {
        sessionId: string,
        currentPath?: string,
        fieldName: string,
        alias?: string
    }) => {
        const result = await selectGraphQLField(sessionId, currentPath, fieldName, alias);
        return wrapToolResponse(result);
    }
}; 