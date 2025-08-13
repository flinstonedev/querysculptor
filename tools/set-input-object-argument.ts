import { z } from "zod";
import {
    loadQueryState,
    saveQueryState,
    GraphQLValidationUtils,
    fetchAndCacheSchema,
    validateInputComplexity
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
    fieldPath: string,
    argumentName: string,
    objectPath: string,
    value: any
) {
    try {
        // --- Input Validation ---
        const complexityError = validateInputComplexity(value, `input object argument "${argumentName}"`);
        if (complexityError) {
            return { error: complexityError };
        }
        // --- End Input Validation ---

        const queryState = await loadQueryState(sessionId);
        if (!queryState) {
            return { error: 'Session not found.' };
        }

        let fieldNode = queryState.queryStructure;
        if (fieldPath) {
            const pathParts = fieldPath.split('.');
            for (const part of pathParts) {
                if (!fieldNode.fields || !fieldNode.fields[part]) {
                    return { error: `Field at path '${fieldPath}' not found.` };
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
            return {
                error: `Cannot set input object properties on variable argument '${argumentName}'. The argument is currently set to variable '${existingArg}'. Remove the variable first or use a different approach.`
            };
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
            const parts = fieldPath ? fieldPath.split('.') : [];
            for (const part of parts) {
                const fields: any = currentType.getFields();
                const field = fields[part];
                if (!field) {
                    return { error: `Field '${part}' not found in schema for path '${fieldPath}'.` };
                }
                currentType = getNamedType(field.type);
            }

            const lastKey = parts.length > 0 ? parts[parts.length - 1] : '';
            const fields: any = currentType.getFields ? currentType.getFields() : {};
            const fieldDef = parts.length > 0 ? fields[lastKey] : null;
            const argType: GraphQLInputType | null = GraphQLValidationUtils.getArgumentType(schema, fieldPath, argumentName);
            if (!argType) {
                return { error: `Argument '${argumentName}' not found on field '${fieldPath || 'root'}'.` };
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
                return { error: `Argument '${argumentName}' is not an input object; cannot set nested path '${objectPath}'.` };
            }

            // Validate objectPath against input object fields
            const pathSegments = objectPath.split('.').filter(Boolean);
            let currentInputType: any = baseArgType;
            for (let i = 0; i < pathSegments.length; i++) {
                const seg = pathSegments[i];
                const fieldsMap = currentInputType.getFields();
                const fieldEntry = fieldsMap[seg];
                if (!fieldEntry) {
                    return { error: `Path segment '${seg}' not found in input type '${currentInputType.name}'.` };
                }
                const nextType = unwrapInputType(fieldEntry.type);
                if (i < pathSegments.length - 1) {
                    if (!isInputObjectType(nextType)) {
                        return { error: `Path '${pathSegments.slice(0, i + 1).join('.')}' is not an input object.` };
                    }
                    currentInputType = nextType;
                } else {
                    // Leaf value validation
                    const validationError = GraphQLValidationUtils.validateValueAgainstType(value, fieldEntry.type);
                    if (validationError) {
                        return { error: `Invalid value for '${objectPath}': ${validationError}` };
                    }
                }
            }
        } catch (e: any) {
            return { error: `Schema validation failed: ${e.message}` };
        }

        if (!(fieldNode as any).args[argumentName]) {
            (fieldNode as any).args[argumentName] = {};
        }

        await setObjectValueByPath((fieldNode as any).args[argumentName], objectPath, value);

        await saveQueryState(sessionId, queryState);

        return {
            success: true,
            message: `Set '${objectPath}' to '${JSON.stringify(value)}' in input object '${argumentName}' at field '${fieldPath}'.`
        };

    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}

export const setInputObjectArgumentTool = {
    name: "set-input-obj-arg",
    description: "Set nested properties within GraphQL input object arguments for complex data structures",
    schema: {
        sessionId: z.string().describe("Session ID"),
        fieldPath: z.string().describe("Dot-notation path to the field"),
        argumentName: z.string().describe("Argument name for the input object"),
        objectPath: z.string().describe("Dot-notation path inside the input object"),
        value: z.string().describe("Value to set"),
    },
    handler: async ({
        sessionId,
        fieldPath,
        argumentName,
        objectPath,
        value
    }: {
        sessionId: string;
        fieldPath: string;
        argumentName: string;
        objectPath: string;
        value: string | number | boolean | null;
    }) => {
        const result = await setInputObjectArgument(
            sessionId,
            fieldPath,
            argumentName,
            objectPath,
            value
        );
        return {
            content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
            }],
        };
    },
}; 