import { z } from "zod";
import { QueryState, loadQueryState, saveQueryState, GraphQLValidationUtils ,
    createSuccessResponse,
    createErrorResponse,
    ErrorCode
} from "./shared-utils.js";

// Core business logic - testable function
export async function applyNamedFragment(
    sessionId: string,
    currentPath: string = "",
    fragmentName: string
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

        // Check if fragment exists
        if (!queryState.fragments || !queryState.fragments[fragmentName]) {
            return createErrorResponse(
                `Fragment '${fragmentName}' not found.`,
                {
                    errorCode: ErrorCode.FRAGMENT_ERROR,
                    sessionId,
                    details: { fragmentName },
                    suggestion: 'Define the fragment first with define-named-fragment'
                }
            );
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

        // Add fragment spread to the parent node
        if (!parentNode.fragmentSpreads) {
            parentNode.fragmentSpreads = [];
        }

        if (!parentNode.fragmentSpreads.includes(fragmentName)) {
            parentNode.fragmentSpreads.push(fragmentName);
        }

        // Save updated query state
        await saveQueryState(sessionId, queryState);

        return createSuccessResponse(
            {
                message: `Fragment '${fragmentName}' applied at path '${currentPath}'.`,
                fragmentName,
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
                details: { fragmentName, currentPath }
            }
        );
    }
}

export const applyNamedFragmentTool = {
    name: "apply-fragment",
    description: "Apply a previously defined named fragment to a specific location in the query",
    schema: z.object({
        sessionId: z.string().describe('The session ID from start-query-session.'),
        currentPath: z.string().default("").describe('Dot-notation path where the fragment should be applied (e.g., "user", "" for root).'),
        fragmentName: z.string().describe('The name of the fragment to apply.'),
    }),
    handler: async ({ sessionId, currentPath = "", fragmentName }: {
        sessionId: string,
        currentPath?: string,
        fragmentName: string
    }) => {
        const result = await applyNamedFragment(sessionId, currentPath, fragmentName);

        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
}; 