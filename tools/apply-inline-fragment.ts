import { z } from "zod";
import { QueryState, loadQueryState, saveQueryState, GraphQLValidationUtils ,
    createSuccessResponse,
    createErrorResponse,
    ErrorCode
} from "./shared-utils.js";

// Core business logic - testable function
export async function applyInlineFragment(
    sessionId: string,
    currentPath: string = "",
    onType: string,
    fieldNames: string[]
) {
    const startTime = Date.now();

    try {
        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
            return createErrorResponse(
                `Invalid sessionId. Received: ${typeof sessionId === 'string' ? `"${sessionId}"` : String(sessionId)} (type: ${typeof sessionId})`,
                {
                    errorCode: ErrorCode.VALIDATION_ERROR,
                    sessionId: sessionId || 'unknown',
                    suggestion: 'Provide a valid non-empty session ID string'
                }
            );
        }

        // Load query state with retry for race conditions
        let queryState = await loadQueryState(sessionId);
        if (!queryState) {
            // Retry once after a short delay in case of race condition
            console.warn(`[apply-inline-frag] Session not found on first attempt, retrying for ID: ${sessionId}`);
            await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
            queryState = await loadQueryState(sessionId);

            if (!queryState) {
                // Include more diagnostic info to help debug session issues
                console.error(`[apply-inline-frag] Session not found after retry for ID: ${sessionId}`);
                return createErrorResponse(
                    `Session not found. SessionId: "${sessionId}" (length: ${sessionId.length})`,
                    {
                        errorCode: ErrorCode.SESSION_NOT_FOUND,
                        sessionId,
                        suggestion: 'Start a new session with start-query-session'
                    }
                );
            }
            console.log(`[apply-inline-frag] Session found on retry for ID: ${sessionId}`);
        }

        // Navigate to the current node in the query structure
        let parentNode = queryState.queryStructure;
        if (currentPath) {
            const pathParts = currentPath.split('.');
            for (const part of pathParts) {
                if (!parentNode.fields || !parentNode.fields[part]) {
                    return createErrorResponse(
                        `Path '${currentPath}' not found in query structure.`,
                        {
                            errorCode: ErrorCode.VALIDATION_ERROR,
                            sessionId,
                            details: { currentPath, missingPart: part },
                            suggestion: 'Use add-field to create the path first, or verify the path exists'
                        }
                    );
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

        return createSuccessResponse(
            {
                message: `Inline fragment on type '${onType}' applied at path '${currentPath}' with ${fieldNames.length} fields.`,
                onType,
                currentPath: currentPath,
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
                details: { onType, currentPath, fieldNames }
            }
        );
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
    }),
    handler: async ({ sessionId, currentPath = "", onType, typeName, fieldNames }: {
        sessionId: string,
        currentPath?: string,
        onType?: string,
        typeName?: string,
        fieldNames: string[]
    }) => {
        // Validate that either typeName or onType is provided (moved from schema.refine)
        if (!typeName && !onType) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        error: 'typeName (or onType) is required'
                    }, null, 2)
                }],
            };
        }
        
        const resolvedOnType = (typeName || onType || '').trim();
        const result = await applyInlineFragment(sessionId, currentPath, resolvedOnType, sanitizeInlineFields(fieldNames));

        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
};

function sanitizeInlineFields(fieldNames: string[]): string[] {
    // Normalize fields like "owner { login }" -> keeps as original token; parser will handle nesting
    return fieldNames.map(f => (typeof f === 'string' ? f.trim() : f)).filter(Boolean) as string[];
}