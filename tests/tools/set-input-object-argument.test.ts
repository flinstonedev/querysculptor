import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setInputObjectArgument } from '../../tools/set-input-object-argument';
import * as sharedUtils from '../../tools/shared-utils';

vi.mock('../../tools/shared-utils', async () => {
    const { createSharedUtilsMock } = await import('../setup');
    const { buildSchema, getNamedType, isObjectType, isInterfaceType } = await import('graphql');

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
        loadQueryState: vi.fn(),
        saveQueryState: vi.fn(),
        fetchAndCacheSchema: vi.fn().mockResolvedValue(testSchema),
    });

    return {
        ...base,
        GraphQLValidationUtils: {
            ...base.GraphQLValidationUtils,
            getArgumentType: (schema: any, fieldPath: string, argumentName: string) => {
                const tryRoot = (root: any) => {
                    if (!root) return null;
                    let current: any = root;
                    const parts = fieldPath.split('.').filter(Boolean);
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
            const nameResult = await setInputObjectArgument('test-session', 'updateUser', 'filter', 'name', 'Rick', true);
            expect(nameResult.success).toBe(true);

            const statusResult = await setInputObjectArgument('test-session', 'updateUser', 'filter', 'status', 'Alive', true);
            expect(statusResult.success).toBe(true);

            const speciesResult = await setInputObjectArgument('test-session', 'updateUser', 'filter', 'species', 'Human', true);
            expect(speciesResult.success).toBe(true);
        });

        it('should handle nested input objects correctly', async () => {
            const result = await setInputObjectArgument('test-session', 'updateUser', 'filter', 'origin.name', 'Earth', true);
            expect(result.success).toBe(true);
            expect(result.message).toContain("Set 'origin.name' to '\"Earth\"' in input object 'filter'");
        });

        it('should set simple field values correctly', async () => {
            const result = await setInputObjectArgument('test-session', 'updateUser', 'input', 'name', 'John Doe', true);
            expect(result.success).toBe(true);
            expect(result.message).toContain("Set 'name' to '\"John Doe\"' in input object 'input'");
        });

        it('should set numeric field values correctly', async () => {
            const result = await setInputObjectArgument('test-session', 'updateUser', 'input', 'age', 25, true);
            expect(result.success).toBe(true);
            expect(result.message).toContain("Set 'age' to '25' in input object 'input'");
        });

        it('should set boolean field values correctly', async () => {
            const result = await setInputObjectArgument('test-session', 'updateUser', 'input', 'active', true, true);
            expect(result.success).toBe(true);
            expect(result.message).toContain("Set 'active' to 'true' in input object 'input'");
        });
    });
}); 