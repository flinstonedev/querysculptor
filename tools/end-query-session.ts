import { z } from "zod";
import {
    QueryState,
    loadQueryState,
    deleteQueryState,
    createSuccessResponse,
    createErrorResponse,
    ErrorCode
} from "./shared-utils.js";

// Core business logic - testable function
export async function endQuerySession(sessionId: string) {
    const startTime = Date.now();

    try {
        // Load query state to get its details before deleting
        const queryState = await loadQueryState(sessionId);

        if (!queryState) {
            return createErrorResponse('Session not found', {
                errorCode: ErrorCode.SESSION_NOT_FOUND,
                sessionId
            });
        }

        // Delete the query state
        const deleted = await deleteQueryState(sessionId);
        const endedAt = new Date().toISOString();

        if (deleted) {
            return createSuccessResponse(
                {
                    message: `Session ${sessionId} ended successfully`,
                    sessionInfo: {
                        sessionId,
                        operationType: queryState.operationType,
                        operationName: queryState.operationName,
                        createdAt: queryState.createdAt,
                        endedAt
                    }
                },
                {
                    sessionId,
                    executionTime: Date.now() - startTime
                }
            );
        } else {
            return createErrorResponse('Failed to delete session state', {
                errorCode: ErrorCode.INTERNAL_ERROR,
                sessionId
            });
        }
    } catch (error) {
        return createErrorResponse(
            error instanceof Error ? error.message : String(error),
            {
                errorCode: ErrorCode.INTERNAL_ERROR,
                sessionId
            }
        );
    }
}

export const endQuerySessionTool = {
    name: "end-query-session",
    description: "Clean up and close a GraphQL query building session to free resources",
    schema: {
        sessionId: z.string().describe('The session ID to end.'),
    },
    handler: async ({ sessionId }: { sessionId: string }) => {
        const result = await endQuerySession(sessionId);

        const { wrapToolResponse } = await import('./shared-utils.js');
        return wrapToolResponse(result);
    }
}; 