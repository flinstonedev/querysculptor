import { z } from "zod";
import {
    GraphQLSchema,
    isObjectType,
    isInterfaceType
} from 'graphql';
import {
    resolveEndpointAndHeaders,
    fetchAndCacheSchema,
    getTypeNameStr,
    createSuccessResponse,
    createErrorResponse,
    ErrorCode
} from "./shared-utils.js";

// Core business logic - testable function
export async function getFieldInfo(
    typeName: string,
    fieldName: string
) {
    const startTime = Date.now();
    const { url: resolvedUrl, headers, error } = resolveEndpointAndHeaders();

    if (!resolvedUrl || error) {
        return createErrorResponse(
            error || "No GraphQL endpoint available",
            {
                errorCode: ErrorCode.SCHEMA_ERROR,
                suggestion: 'Set DEFAULT_GRAPHQL_ENDPOINT environment variable'
            }
        );
    }

    try {
        const schema = await fetchAndCacheSchema();
        const gqlType = schema.getType(typeName);

        if (!gqlType || (!isObjectType(gqlType) && !isInterfaceType(gqlType))) {
            return createErrorResponse(
                `Type '${typeName}' not found or not an object/interface type`,
                {
                    errorCode: ErrorCode.SCHEMA_ERROR,
                    suggestion: 'Use get-type-info to verify the type exists'
                }
            );
        }

        const fields = gqlType.getFields();
        const field = fields[fieldName];

        if (!field) {
            return createErrorResponse(
                `Field '${fieldName}' not found on type '${typeName}'`,
                {
                    errorCode: ErrorCode.FIELD_ERROR,
                    suggestion: `Available fields: ${Object.keys(fields).slice(0, 5).join(', ')}`
                }
            );
        }

        const argsInfo = field.args.map((arg: any) => ({
            name: arg.name,
            description: arg.description,
            type: getTypeNameStr(arg.type),
            defaultValue: arg.defaultValue !== undefined ? String(arg.defaultValue) : null
        }));

        return createSuccessResponse(
            {
                name: fieldName,
                description: field.description || undefined,
                type: getTypeNameStr(field.type),
                args: argsInfo
            },
            {
                executionTime: Date.now() - startTime
            }
        );
    } catch (error) {
        return createErrorResponse(
            error instanceof Error ? error.message : String(error),
            {
                errorCode: ErrorCode.SCHEMA_ERROR
            }
        );
    }
}

export const getFieldInfoTool = {
    name: "get-field-info",
    description: "Get detailed information about a specific field within a GraphQL type including arguments and return type.",
    schema: {
        typeName: z.string().describe('The name of the parent GraphQL type.'),
        fieldName: z.string().describe('The name of the field to get information for.')
    },
    handler: async ({ typeName, fieldName }: {
        typeName: string;
        fieldName: string;
    }) => {
        const result = await getFieldInfo(typeName, fieldName);
        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
}; 