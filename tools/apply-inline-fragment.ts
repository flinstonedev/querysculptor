import { z } from "zod";
import { QueryState, loadQueryState, saveQueryState, GraphQLValidationUtils } from "./shared-utils.js";

// Core business logic - testable function
export async function applyInlineFragment(
    sessionId: string,
    currentPath: string = "",
    onType: string,
    fieldNames: string[]
): Promise<{
    success?: boolean;
    message?: string;
    onType?: string;
    parentPath?: string;
    fieldNames?: string[];
    error?: string;
}> {
    try {
        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
            return { error: 'Invalid sessionId.' };
        }
        // Load query state
        const queryState = await loadQueryState(sessionId);
        if (!queryState) {
            return {
                error: 'Session not found.'
            };
        }

        // Navigate to the current node in the query structure
        let parentNode = queryState.queryStructure;
        if (currentPath) {
            const pathParts = currentPath.split('.');
            for (const part of pathParts) {
                if (!parentNode.fields || !parentNode.fields[part]) {
                    return {
                        error: `Path '${currentPath}' not found in query structure.`
                    };
                }
                parentNode = parentNode.fields[part];
            }
        }

        // Create inline fragment structure
        const inlineFragmentFields: Record<string, any> = {};
        fieldNames.forEach(fieldName => {
            inlineFragmentFields[fieldName] = {
                fieldName: fieldName,
                alias: null,
                args: {},
                fields: {},
                directives: [],
                fragmentSpreads: [],
                inlineFragments: []
            };
        });

        // Add inline fragment to the parent node
        if (!parentNode.inlineFragments) {
            parentNode.inlineFragments = [];
        }

        parentNode.inlineFragments.push({
            on_type: onType,
            selections: inlineFragmentFields
        });

        // Save updated query state
        await saveQueryState(sessionId, queryState);

        return {
            success: true,
            message: `Inline fragment on type '${onType}' applied at path '${currentPath}' with ${fieldNames.length} fields.`,
            onType,
            parentPath: currentPath,
            fieldNames
        };
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

export const applyInlineFragmentTool = {
    name: "apply-inline-frag",
    description: "Apply type-conditional field selections using inline fragments for union/interface types",
    schema: z.object({
        sessionId: z.string().describe('The session ID from start-query-session.'),
        currentPath: z.string().default("").describe('Dot-notation path where the inline fragment should be applied (e.g., "user", "" for root).'),
        typeName: z.string().optional().describe('The type condition for the inline fragment (e.g., "Repository").'),
        onType: z.string().optional().describe('Alias of typeName for compatibility.'),
        fieldNames: z.array(z.string()).describe('Array of field names to select in the inline fragment.'),
    }).refine((data) => !!(data.typeName || data.onType), { message: 'typeName (or onType) is required' }),
    handler: async ({ sessionId, currentPath = "", onType, typeName, fieldNames }: {
        sessionId: string,
        currentPath?: string,
        onType?: string,
        typeName?: string,
        fieldNames: string[]
    }) => {
        const resolvedOnType = (typeName || onType || '').trim();
        const result = await applyInlineFragment(sessionId, currentPath, resolvedOnType, sanitizeInlineFields(fieldNames));

        return {
            content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
            }],
        };
    }
};

function sanitizeInlineFields(fieldNames: string[]): string[] {
    // Normalize fields like "owner { login }" -> keeps as original token; parser will handle nesting
    return fieldNames.map(f => (typeof f === 'string' ? f.trim() : f)).filter(Boolean) as string[];
}