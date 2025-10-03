import { z } from "zod";
import {
    loadQueryState,
    saveQueryState,
    GraphQLValidationUtils,
    fetchAndCacheSchema,
    validateInputComplexity,
    createSuccessResponse,
    createErrorResponse,
    ErrorCode
} from "./shared-utils.js";
import { getNamedType, isInputObjectType, isNonNullType, isListType, GraphQLInputType } from 'graphql';

async function setObjectValueByPath(obj: any, path: string, value: any) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            throw new Error('Prototype pollution attempt detected');
        }
        if (!current[key] || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    const lastKey = keys[keys.length - 1];
    if (lastKey === '__proto__' || lastKey === 'constructor' || lastKey === 'prototype') {
        throw new Error('Prototype pollution attempt detected');
    }
    current[lastKey] = value;
}

export async function setInputObjectArgument(
    sessionId: string,
    currentPath: string,
    argumentName: string,
    objectPath: string,
    value: any
) {
    const startTime = Date.now();
    try {
        // --- Input Validation ---
        const complexityError = validateInputComplexity(value, `input object argument "${argumentName}"`);
        if (complexityError) {
            return createErrorResponse(complexityError, {
                errorCode: ErrorCode.VALIDATION_ERROR,
                sessionId,
                path: currentPath,
                suggestion: 'Reduce the complexity of the input object value'
            });
        }
        // --- End Input Validation ---

        const queryState = await loadQueryState(sessionId);
        if (!queryState) {
            return createErrorResponse('Session not found.', {
                errorCode: ErrorCode.SESSION_NOT_FOUND,
                sessionId,
                path: currentPath,
                suggestion: 'Start a new session with start-query-session'
            });
        }

        let fieldNode = queryState.queryStructure;
        if (currentPath) {
            const pathParts = currentPath.split('.');
            for (const part of pathParts) {
                if (!fieldNode.fields || !fieldNode.fields[part]) {
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
                fieldNode = fieldNode.fields[part];
            }
        }

        if (!(fieldNode as any).args) {
            (fieldNode as any).args = {};
        }

        // Check if the argument is a variable reference
        const existingArg = (fieldNode as any).args[argumentName];
        if (existingArg && typeof existingArg === 'string' && existingArg.startsWith('$')) {
            return createErrorResponse(
                `Cannot set input object properties on variable argument '${argumentName}'. The argument is currently set to variable '${existingArg}'. Remove the variable first or use a different approach.`,
                {
                    errorCode: ErrorCode.ARGUMENT_ERROR,
                    sessionId,
                    path: currentPath,
                    suggestion: 'Remove the variable first or use set-variable-argument instead'
                }
            );
        }

        // Schema-aware validation: ensure the argument exists and is an input object, and that objectPath is valid
        try {
            const schema = await fetchAndCacheSchema(queryState.headers);

            // Resolve field definition in schema from fieldPath
            // Start from the correct root operation type
            const opType = (queryState.operationType || 'query').toLowerCase();
            let currentType: any = opType === 'mutation'
                ? (schema.getMutationType() || schema.getQueryType() || schema.getSubscriptionType())
                : opType === 'subscription'
                    ? (schema.getSubscriptionType() || schema.getQueryType() || schema.getMutationType())
                    : (schema.getQueryType() || schema.getMutationType() || schema.getSubscriptionType());
            const parts = currentPath ? currentPath.split('.') : [];
            for (const part of parts) {
                const fields: any = currentType.getFields();
                const field = fields[part];
                if (!field) {
                    return createErrorResponse(
                        `Field '${part}' not found in schema for path '${currentPath}'.`,
                        {
                            errorCode: ErrorCode.FIELD_ERROR,
                            sessionId,
                            path: currentPath,
                            suggestion: 'Verify the field path using introspect-field'
                        }
                    );
                }
                currentType = getNamedType(field.type);
            }

            const lastKey = parts.length > 0 ? parts[parts.length - 1] : '';
            const fields: any = currentType.getFields ? currentType.getFields() : {};
            const fieldDef = parts.length > 0 ? fields[lastKey] : null;
            const argType: GraphQLInputType | null = GraphQLValidationUtils.getArgumentType(schema, currentPath, argumentName);
            if (!argType) {
                return createErrorResponse(
                    `Argument '${argumentName}' not found on field '${currentPath || 'root'}'.`,
                    {
                        errorCode: ErrorCode.ARGUMENT_ERROR,
                        sessionId,
                        path: currentPath,
                        suggestion: 'Verify the argument exists on the field using introspect-field'
                    }
                );
            }

            // Unwrap NonNull/List to get base input type for structural validation
            const unwrapInputType = (t: any): any => {
                let cur = t;
                while (isNonNullType(cur) || isListType(cur)) {
                    cur = cur.ofType;
                }
                return cur;
            };
            const baseArgType: any = unwrapInputType(argType);
            if (!isInputObjectType(baseArgType)) {
                return createErrorResponse(
                    `Argument '${argumentName}' is not an input object; cannot set nested path '${objectPath}'.`,
                    {
                        errorCode: ErrorCode.ARGUMENT_ERROR,
                        sessionId,
                        path: currentPath,
                        suggestion: 'Use set-string-argument or set-variable-argument for non-object arguments'
                    }
                );
            }

            // Validate objectPath against input object fields
            const pathSegments = objectPath.split('.').filter(Boolean);
            let currentInputType: any = baseArgType;
            for (let i = 0; i < pathSegments.length; i++) {
                const seg = pathSegments[i];
                const fieldsMap = currentInputType.getFields();
                const fieldEntry = fieldsMap[seg];
                if (!fieldEntry) {
                    return createErrorResponse(
                        `Path segment '${seg}' not found in input type '${currentInputType.name}'.`,
                        {
                            errorCode: ErrorCode.ARGUMENT_ERROR,
                            sessionId,
                            path: currentPath,
                            suggestion: 'Verify the object path structure using introspect-type'
                        }
                    );
                }
                const nextType = unwrapInputType(fieldEntry.type);
                if (i < pathSegments.length - 1) {
                    if (!isInputObjectType(nextType)) {
                        return createErrorResponse(
                            `Path '${pathSegments.slice(0, i + 1).join('.')}' is not an input object.`,
                            {
                                errorCode: ErrorCode.ARGUMENT_ERROR,
                                sessionId,
                                path: currentPath,
                                suggestion: 'Ensure all path segments except the last are input objects'
                            }
                        );
                    }
                    currentInputType = nextType;
                } else {
                    // Leaf value validation
                    const validationError = GraphQLValidationUtils.validateValueAgainstType(value, fieldEntry.type);
                    if (validationError) {
                        return createErrorResponse(
                            `Invalid value for '${objectPath}': ${validationError}`,
                            {
                                errorCode: ErrorCode.VALIDATION_ERROR,
                                sessionId,
                                path: currentPath,
                                suggestion: 'Ensure the value matches the expected type'
                            }
                        );
                    }
                }
            }
        } catch (e: any) {
            return createErrorResponse(
                `Schema validation failed: ${e.message}`,
                {
                    errorCode: ErrorCode.INTERNAL_ERROR,
                    sessionId,
                    path: currentPath,
                    suggestion: 'Verify the schema is accessible and valid'
                }
            );
        }

        if (!(fieldNode as any).args[argumentName]) {
            (fieldNode as any).args[argumentName] = {};
        }

        await setObjectValueByPath((fieldNode as any).args[argumentName], objectPath, value);

        await saveQueryState(sessionId, queryState);

        return createSuccessResponse(
            {
                message: `Set '${objectPath}' to '${JSON.stringify(value)}' in input object '${argumentName}' at field '${currentPath}'.`
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

export const setInputObjectArgumentTool = {
    name: "set-input-obj-arg",
    description: "Set nested properties within GraphQL input object arguments for complex data structures",
    schema: {
        sessionId: z.string().describe("Session ID"),
        currentPath: z.string().describe("Dot-notation path to the field"),
        argumentName: z.string().describe("Argument name for the input object"),
        objectPath: z.string().describe("Dot-notation path inside the input object"),
        value: z.string().describe("Value to set"),
    },
    handler: async ({
        sessionId,
        currentPath,
        argumentName,
        objectPath,
        value
    }: {
        sessionId: string;
        currentPath: string;
        argumentName: string;
        objectPath: string;
        value: string | number | boolean | null;
    }) => {
        const result = await setInputObjectArgument(
            sessionId,
            currentPath,
            argumentName,
            objectPath,
            value
        );
        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    },
}; 