import { z } from "zod";
import { QueryState, loadQueryState, saveQueryState, GraphQLValidationUtils } from "./shared-utils.js";

// Core business logic - testable function
export async function applyInlineFragment(
    sessionId: string,
    parentPath: string = "",
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

        // Navigate to the parent node in the query structure
        let parentNode = queryState.queryStructure;
        if (parentPath) {
            const pathParts = parentPath.split('.');
            for (const part of pathParts) {
                if (!parentNode.fields || !parentNode.fields[part]) {
                    return {
                        error: `Parent path '${parentPath}' not found in query structure.`
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
            message: `Inline fragment on type '${onType}' applied at path '${parentPath}' with ${fieldNames.length} fields.`,
            onType,
            parentPath,
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
        parentPath: z.string().default("").describe('Dot-notation path where the inline fragment should be applied (e.g., "user", "" for root).'),
        onType: z.string().optional().describe('The type condition for the inline fragment (e.g., "Repository").'),
        typeName: z.string().optional().describe('Alias of onType for compatibility with some agents.'),
        fieldNames: z.array(z.string()).describe('Array of field names to select in the inline fragment.'),
    }).refine((data) => !!(data.onType || data.typeName), { message: 'onType (or typeName) is required' }),
    handler: async ({ sessionId, parentPath = "", onType, typeName, fieldNames }: {
        sessionId: string,
        parentPath?: string,
        onType?: string,
        typeName?: string,
        fieldNames: string[]
    }) => {
        const resolvedOnType = (onType || typeName || '').trim();
        const result = await applyInlineFragment(sessionId, parentPath, resolvedOnType, sanitizeInlineFields(fieldNames));

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