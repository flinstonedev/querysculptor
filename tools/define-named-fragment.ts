import { z } from "zod";
import { QueryState, loadQueryState, saveQueryState, GraphQLValidationUtils ,
    createSuccessResponse,
    createErrorResponse,
    ErrorCode
} from "./shared-utils.js";
import { isObjectType, isInterfaceType, GraphQLObjectType, GraphQLInterfaceType } from 'graphql';

// Core business logic - testable function
export async function defineNamedFragment(
    sessionId: string,
    fragmentName: string,
    onType: string,
    fieldNames: string[]
) {
    const startTime = Date.now();

    try {
        // Validate fragment name syntax
        if (!GraphQLValidationUtils.isValidGraphQLName(fragmentName)) {
            return createErrorResponse(
                `Invalid fragment name "${fragmentName}". Must match /^[_A-Za-z][_0-9A-Za-z]*$/`,
                {
                    errorCode: ErrorCode.VALIDATION_ERROR,
                    sessionId,
                    details: { fragmentName },
                    suggestion: 'Use a valid GraphQL identifier (start with letter or underscore, followed by letters, digits, or underscores)'
                }
            );
        }

        // Validate type name syntax
        if (!GraphQLValidationUtils.isValidGraphQLName(onType)) {
            return createErrorResponse(
                `Invalid type name "${onType}". Must match /^[_A-Za-z][_0-9A-Za-z]*$/`,
                {
                    errorCode: ErrorCode.VALIDATION_ERROR,
                    sessionId,
                    details: { onType },
                    suggestion: 'Use a valid GraphQL type name'
                }
            );
        }

        // Load query state
        const queryState = await loadQueryState(sessionId);
        if (!queryState) {
            return createErrorResponse(
                'Session not found.',
                {
                    errorCode: ErrorCode.SESSION_NOT_FOUND,
                    sessionId,
                    suggestion: 'Start a new session with start-query-session'
                }
            );
        }

        // Validate that the type exists in the schema
        try {
            const { fetchAndCacheSchema } = await import('./shared-utils.js');
            const schema = await fetchAndCacheSchema();
            if (schema) {
                const type = schema.getType(onType);
                if (!type) {
                    return createErrorResponse(
                        `Type '${onType}' not found in schema.`,
                        {
                            errorCode: ErrorCode.SCHEMA_ERROR,
                            sessionId,
                            details: { onType },
                            suggestion: 'Check the schema documentation for valid types using introspect-schema or list-types'
                        }
                    );
                }
                // Ensure it's a type that can have fragments (Object, Interface, or Union)
                const { isObjectType, isInterfaceType, isUnionType } = await import('graphql');
                if (!isObjectType(type) && !isInterfaceType(type) && !isUnionType(type)) {
                    return createErrorResponse(
                        `Type '${onType}' cannot be used for fragments. Only Object, Interface, and Union types are allowed.`,
                        {
                            errorCode: ErrorCode.SCHEMA_ERROR,
                            sessionId,
                            details: { onType, typeKind: type.constructor.name },
                            suggestion: 'Use an Object, Interface, or Union type for fragments'
                        }
                    );
                }
            }
        } catch (error) {
            // Schema validation failed, but continue anyway to maintain backward compatibility
            console.warn(`Schema validation failed for fragment type ${onType}:`, error);
        }

        // Validate fields exist on the type
        try {
            const { fetchAndCacheSchema } = await import('./shared-utils.js');
            const schema = await fetchAndCacheSchema();
            if (schema) {
                const type = schema.getType(onType);
                if (type && (isObjectType(type) || isInterfaceType(type))) {
                    const availableFields = (type as GraphQLObjectType | GraphQLInterfaceType).getFields();
                    const invalidFields = fieldNames.filter(fieldName => !availableFields[fieldName]);

                    if (invalidFields.length > 0) {
                        return createErrorResponse(
                            `Invalid fields on type '${onType}': ${invalidFields.join(', ')}`,
                            {
                                errorCode: ErrorCode.SCHEMA_ERROR,
                                sessionId,
                                details: {
                                    onType,
                                    invalidFields,
                                    availableFields: Object.keys(availableFields)
                                },
                                suggestion: `Use valid fields from: ${Object.keys(availableFields).join(', ')}`
                            }
                        );
                    }
                }
            }
        } catch (error) {
            // Field validation failed, but continue anyway to maintain backward compatibility
            console.warn(`Field validation failed for fragment on type ${onType}:`, error);
        }

        // Create fragment structure
        const fragmentFields: Record<string, any> = {};
        fieldNames.forEach(fieldName => {
            fragmentFields[fieldName] = {
                fieldName: fieldName,  // Add fieldName property for proper serialization
                alias: null,
                args: {},
                fields: {},
                directives: [],
                fragmentSpreads: [],
                inlineFragments: []
            };
        });

        // Add fragment to query state
        if (!queryState.fragments) {
            queryState.fragments = {};
        }

        // Check for fragment redefinition
        if (queryState.fragments[fragmentName]) {
            return createErrorResponse(
                `Fragment '${fragmentName}' already exists.`,
                {
                    errorCode: ErrorCode.FRAGMENT_ERROR,
                    sessionId,
                    details: { fragmentName },
                    suggestion: 'Use a different name or remove the existing fragment first'
                }
            );
        }

        queryState.fragments[fragmentName] = {
            onType,
            fields: fragmentFields
        };

        // Save updated query state
        await saveQueryState(sessionId, queryState);

        return createSuccessResponse(
            {
                message: `Fragment '${fragmentName}' defined on type '${onType}' with ${fieldNames.length} fields.`,
                fragmentName,
                onType,
                fieldNames
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
                details: { fragmentName, onType, fieldNames }
            }
        );
    }
}

export const defineNamedFragmentTool = {
    name: "define-fragment",
    description: "Create reusable named fragments for common field selections across queries",
    schema: {
        sessionId: z.string().describe('The session ID from start-query-session.'),
        fragmentName: z.string().describe('The name of the fragment (e.g., "userData").'),
        onType: z.string().describe('The GraphQL type the fragment applies to (e.g., "User").'),
        fieldNames: z.array(z.string()).describe('Array of field names to include in the fragment.'),
    },
    handler: async ({ sessionId, fragmentName, onType, fieldNames }: {
        sessionId: string,
        fragmentName: string,
        onType: string,
        fieldNames: string[]
    }) => {
        const result = await defineNamedFragment(sessionId, fragmentName, onType, fieldNames);

        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
}; 