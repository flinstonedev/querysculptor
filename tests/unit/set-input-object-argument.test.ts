import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setInputObjectArgument } from '../../tools/set-input-object-argument';
import * as sharedUtils from '../../tools/shared-utils';

vi.mock('../../tools/shared-utils', async () => {
    const { createSharedUtilsMock } = await import('../core/setup');
    const { buildSchema, getNamedType, isObjectType, isInterfaceType } = await import('graphql');
    const actualUtils = await vi.importActual('../../tools/shared-utils');

    const testSchema = buildSchema(`
        input UserInput { name: String, age: Int, active: Boolean, profile: ProfileInput }
        input ProfileInput { name: String, age: Int }
        input FilterInput { name: String, status: String, species: String, origin: OriginInput }
        input OriginInput { name: String }
        type User { id: ID!, name: String }
        type Mutation { updateUser(input: UserInput, filter: FilterInput): User }
        type Query { user: User }
    `);

    const base = createSharedUtilsMock({
        fetchAndCacheSchema: vi.fn().mockResolvedValue(testSchema),
        loadQueryState: vi.fn(),
        saveQueryState: vi.fn(),
    });

    return {
        ...base,
        buildQueryFromStructure: actualUtils.buildQueryFromStructure,
        validateInputComplexity: vi.fn().mockReturnValue(null),
        GraphQLValidationUtils: {
            ...base.GraphQLValidationUtils,
            getArgumentType: (schema: any, currentPath: string, argumentName: string) => {
                const tryRoot = (root: any) => {
                    if (!root) return null;
                    let current: any = root;
                    const parts = currentPath.split('.').filter(Boolean);
                    for (let i = 0; i < parts.length; i++) {
                        const f = current.getFields()[parts[i]];
                        if (!f) return null;
                        if (i === parts.length - 1) {
                            const arg = f.args.find((a: any) => a.name === argumentName);
                            return arg ? arg.type : null;
                        }
                        const nt = getNamedType(f.type);
                        if (isObjectType(nt) || isInterfaceType(nt)) current = nt; else return null;
                    }
                    return null;
                };
                return tryRoot(schema.getMutationType())
                    || tryRoot(schema.getQueryType())
                    || tryRoot(schema.getSubscriptionType());
            },
        },
        createSuccessResponse: vi.fn().mockImplementation((data, options = {}) => ({
            success: true,
            data,
            warnings: options.warnings,
            metadata: {
                sessionId: options.sessionId,
                stateVersion: options.stateVersion,
                executionTime: options.executionTime,
                timestamp: new Date().toISOString()
            }
        })),
        createErrorResponse: vi.fn().mockImplementation((error, options = {}) => ({
            success: false,
            error,
            details: {
                errorCode: options.errorCode,
                suggestion: options.suggestion,
                field: options.field,
                path: options.path,
                availableOptions: options.availableOptions
            },
            metadata: {
                sessionId: options.sessionId,
                timestamp: new Date().toISOString()
            }
        })),
        wrapToolResponse: vi.fn().mockImplementation((response) => ({
            content: [{
                type: 'text',
                text: JSON.stringify(response, null, 2)
            }]
        })),
        ErrorCode: {
            SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
            VALIDATION_ERROR: 'VALIDATION_ERROR',
            SCHEMA_ERROR: 'SCHEMA_ERROR',
            REDIS_UNAVAILABLE: 'REDIS_UNAVAILABLE',
            ARGUMENT_ERROR: 'ARGUMENT_ERROR',
            FIELD_ERROR: 'FIELD_ERROR',
            VARIABLE_ERROR: 'VARIABLE_ERROR',
            FRAGMENT_ERROR: 'FRAGMENT_ERROR',
            DIRECTIVE_ERROR: 'DIRECTIVE_ERROR',
            EXECUTION_ERROR: 'EXECUTION_ERROR',
            INTERNAL_ERROR: 'INTERNAL_ERROR'
        },
    };
});

describe('setInputObjectArgument', () => {
    let queryState: any;

    beforeEach(() => {
        vi.clearAllMocks();
        queryState = {
            operationType: 'mutation',
            queryStructure: {
                fields: {
                    updateUser: {
                        fieldName: 'updateUser',
                        args: {},
                    },
                },
            },
            variablesSchema: {},
        };

        vi.mocked(sharedUtils.loadQueryState).mockResolvedValue(queryState);
        vi.mocked(sharedUtils.saveQueryState).mockImplementation(async (sid, qs) => {
            queryState = qs;
        });
    });

    it('should set a nested value in an input object argument', async () => {
        await setInputObjectArgument('test-session', 'updateUser', 'input', 'profile.name', 'John Doe');
        await setInputObjectArgument('test-session', 'updateUser', 'input', 'profile.age', 30);

        const queryString = sharedUtils.buildQueryFromStructure(
            queryState.queryStructure,
            queryState.operationType,
            queryState.variablesSchema
        );

        const cleanedQuery = queryString.replace(/\s+/g, '');
        expect(cleanedQuery).toContain('updateUser(input:{profile:{name:"JohnDoe",age:30}}');
    });

    describe('Critical Input Object Validation', () => {
        it('should handle complex input objects correctly', async () => {
            // Set multiple fields in input object
            const nameResult = await setInputObjectArgument('test-session', 'updateUser', 'filter', 'name', 'Rick');
            expect(nameResult.success).toBe(true);

            const statusResult = await setInputObjectArgument('test-session', 'updateUser', 'filter', 'status', 'Alive');
            expect(statusResult.success).toBe(true);

            const speciesResult = await setInputObjectArgument('test-session', 'updateUser', 'filter', 'species', 'Human');
            expect(speciesResult.success).toBe(true);
        });

        it('should handle nested input objects correctly', async () => {
            const result = await setInputObjectArgument('test-session', 'updateUser', 'filter', 'origin.name', 'Earth');
            expect(result.success).toBe(true);
            expect(result.data.message).toContain("Set 'origin.name' to '\"Earth\"' in input object 'filter'");
        });

        it('should set simple field values correctly', async () => {
            const result = await setInputObjectArgument('test-session', 'updateUser', 'input', 'name', 'John Doe');
            expect(result.success).toBe(true);
            expect(result.data.message).toContain("Set 'name' to '\"John Doe\"' in input object 'input'");
        });

        it('should set numeric field values correctly', async () => {
            const result = await setInputObjectArgument('test-session', 'updateUser', 'input', 'age', 25);
            expect(result.success).toBe(true);
            expect(result.data.message).toContain("Set 'age' to '25' in input object 'input'");
        });

        it('should set boolean field values correctly', async () => {
            const result = await setInputObjectArgument('test-session', 'updateUser', 'input', 'active', true);
            expect(result.success).toBe(true);
            expect(result.data.message).toContain("Set 'active' to 'true' in input object 'input'");
        });
    });
}); 