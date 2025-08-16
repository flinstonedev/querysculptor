import { config } from 'dotenv';
import {
    GraphQLSchema,
    getIntrospectionQuery,
    buildClientSchema,
    printSchema,
    isObjectType,
    isInterfaceType,
    isEnumType,
    isInputObjectType,
    isNonNullType,
    isListType,
    isScalarType,
    isUnionType,
    getNamedType,
    print,
    astFromValue,
    GraphQLString,
    GraphQLInt,
    GraphQLFloat,
    GraphQLBoolean,
    parse,
    validate,
    buildSchema,
    GraphQLError,
    GraphQLObjectType,
    GraphQLInputObjectType,
    GraphQLInterfaceType,
    isLeafType,
    GraphQLInputType,
    coerceInputValue
} from 'graphql';
import { createClient } from 'redis';
import { randomBytes } from 'crypto';

// Load environment variables from .env file
config({ path: '.env' });

// Redis client setup
const redis = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
        // Implement a bounded exponential backoff reconnect strategy
        reconnectStrategy: (retries: number) => Math.min(1000 * Math.pow(2, retries), 15000),
        connectTimeout: 2000,
    }
});

let useRedis = false;
let redisConnectionAttempted = false;
let redisConnectionPromise: Promise<void> | null = null;
let lastRedisInitAttempt = 0;

// Configurable TTL and retry interval
const SESSION_TTL_SECONDS = (() => {
    const raw = process.env.SESSION_TTL_SECONDS;
    if (raw === undefined) return 3600; // default 1 hour
    const value = parseInt(raw, 10);
    return isNaN(value) ? 3600 : value; // allow 0 => no expiry
})();
const HAS_SESSION_TTL = SESSION_TTL_SECONDS > 0;

const REDIS_RETRY_INTERVAL_MS = (() => {
    const value = parseInt(process.env.REDIS_RETRY_INTERVAL_MS || '30000', 10);
    return isNaN(value) || value <= 0 ? 30000 : value;
})();

const REDIS_OPERATION_RETRY_MS = (() => {
    const value = parseInt(process.env.REDIS_OPERATION_RETRY_MS || '1000', 10);
    return isNaN(value) || value <= 0 ? 1000 : value;
})();

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForRedisReady(): Promise<void> {
    // Ensure connection attempts are active
    await initializeRedis();

    let backoff = 250;
    const maxBackoff = 5000;
    const maxWaitTime = 10000; // Maximum 10 seconds to wait for Redis
    const startTime = Date.now();
    
    while (!(redis as any).isReady) {
        // Check if we've exceeded maximum wait time
        if (Date.now() - startTime > maxWaitTime) {
            console.warn('Redis connection timeout after 10 seconds, giving up');
            throw new Error('Redis connection timeout');
        }
        
        await delay(backoff);
        backoff = Math.min(maxBackoff, Math.floor(backoff * 1.5));
        // Kick the client in case connect wasn't called yet or ended
        try {
            if (!(redis as any).isOpen) {
                await redis.connect().catch(() => { });
            }
        } catch { }
    }
}

// Initialize Redis connection
async function initializeRedis(): Promise<boolean> {
    // If already using Redis and client is ready, we're good
    if (useRedis && (redis as any).isReady) {
        return true;
    }

    // If a previous attempt failed, allow periodic re-attempts
    const now = Date.now();
    if (redisConnectionAttempted && !useRedis && now - lastRedisInitAttempt < REDIS_RETRY_INTERVAL_MS) {
        return false;
    }

    if (!redisConnectionPromise || (!useRedis && now - lastRedisInitAttempt >= REDIS_RETRY_INTERVAL_MS)) {
        redisConnectionPromise = (async () => {
            try {
                redisConnectionAttempted = true;
                lastRedisInitAttempt = Date.now();
                let connectionSucceeded = false;

                redis.on('error', (err: Error) => {
                    if (!connectionSucceeded) {
                        console.error('Redis connection failed:', err.message);
                        useRedis = false;
                    } else {
                        console.warn('Redis error after successful connection:', err.message);
                    }
                });

                redis.on('connect', () => {
                    console.log('Redis Client Connected');
                });

                redis.on('ready', () => {
                    console.log('Redis Client Ready');
                });

                redis.on('end', () => {
                    console.warn('Redis connection ended. Waiting for reconnection...');
                    useRedis = false;
                    // Allow subsequent initialize attempts
                    redisConnectionAttempted = false;
                    redisConnectionPromise = null;
                });

                if (!(redis as any).isOpen) {
                    await Promise.race([
                        redis.connect(),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Redis connection timeout')), 2000)
                        )
                    ]);
                }

                // Verify connection works before marking as successful
                await redis.ping();
                connectionSucceeded = true;
                useRedis = true;
                console.log('Redis connection verified');

            } catch (error) {
                console.error('Redis connection failed:', error instanceof Error ? error.message : String(error));
                useRedis = false;
            }
        })();
    }

    await redisConnectionPromise;
    return useRedis;
}

async function withRedisRetry<T>(label: string, op: () => Promise<T>): Promise<T> {
    // Ensure Redis is connected (retry until ready)
    await waitForRedisReady();
    let attempt = 0;
    const maxAttempts = 5; // Limit retry attempts to prevent infinite loops
    
    // Use capped exponential backoff for op-level retry
    while (attempt < maxAttempts) {
        try {
            return await op();
        } catch (err: any) {
            attempt++;
            console.warn(`[${label}] Redis operation failed (attempt ${attempt}/${maxAttempts}): ${err?.message || err}`);
            
            // If we've exhausted all attempts, throw the error
            if (attempt >= maxAttempts) {
                console.error(`[${label}] Redis operation failed after ${maxAttempts} attempts, giving up`);
                throw new Error(`Redis operation failed: ${err?.message || err}`);
            }
            
            // If client not ready, wait and try to reconnect
            if (!(redis as any).isReady) {
                await delay(REDIS_OPERATION_RETRY_MS);
                await waitForRedisReady();
                continue;
            }
            // Backoff before retry
            const sleep = Math.min(REDIS_OPERATION_RETRY_MS * attempt, 5000);
            await delay(sleep);
        }
    }
    
    // This should never be reached due to the throw above, but TypeScript needs it
    throw new Error(`[${label}] Unexpected end of retry loop`);
}

function normalizeSessionId(sessionId: string): string {
    const raw = (sessionId || '').trim();
    // Our session IDs are hex strings (randomBytes(16)). Strip non-hex and normalize case.
    const cleaned = raw.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
    return cleaned || raw; // fallback to raw if nothing left after cleaning
}

// Schema caching
const schemaCache = new Map<string, GraphQLSchema>();
const rawSchemaJsonCache = new Map<string, any>();

// Query state structure
export interface QueryState {
    headers: Record<string, string>;
    operationType: string;
    operationTypeName: string;
    operationName: string | null;
    queryStructure: {
        fields: Record<string, any>;
        fragmentSpreads: string[];
        inlineFragments: any[];
    };
    fragments: Record<string, any>;
    variablesSchema: Record<string, string>;
    variablesDefaults: Record<string, any>;
    variablesValues: Record<string, any>;
    operationDirectives: any[];
    createdAt: string;
}

// GraphQL validation utilities
export class GraphQLValidationUtils {
    static isValidGraphQLName(name: string): boolean {
        if (!name || typeof name !== 'string') return false;
        return /^[_A-Za-z][_0-9A-Za-z]*$/.test(name);
    }

    static validateOperationName(name: string | null): { valid: boolean; error?: string } {
        if (name === null || name === undefined) return { valid: true };
        if (typeof name !== 'string') return { valid: false, error: 'Operation name must be a string' };
        if (name.trim() === '') return { valid: true };

        if (!this.isValidGraphQLName(name)) {
            return {
                valid: false,
                error: `Invalid operation name "${name}". Must match /^[_A-Za-z][_0-9A-Za-z]*$/`
            };
        }
        return { valid: true };
    }

    static validateVariableName(name: string): { valid: boolean; error?: string } {
        if (!name || typeof name !== 'string') {
            return { valid: false, error: 'Variable name must be a string' };
        }

        if (!name.startsWith('$')) {
            return { valid: false, error: 'Variable name must start with "$"' };
        }

        const nameWithoutDollar = name.slice(1);
        if (!this.isValidGraphQLName(nameWithoutDollar)) {
            return {
                valid: false,
                error: `Invalid variable name "${name}". Must be $[_A-Za-z][_0-9A-Za-z]*`
            };
        }
        return { valid: true };
    }

    static validateFieldAlias(alias: string | null): { valid: boolean; error?: string } {
        if (alias === null || alias === undefined) return { valid: true };
        if (typeof alias !== 'string') return { valid: false, error: 'Field alias must be a string' };
        if (alias.trim() === '') return { valid: false, error: 'Field alias cannot be empty' };

        if (!this.isValidGraphQLName(alias)) {
            return {
                valid: false,
                error: `Invalid field alias "${alias}". Must match /^[_A-Za-z][_0-9A-Za-z]*$/`
            };
        }
        return { valid: true };
    }

    static validateStringLength(value: string, name: string): { valid: boolean; error?: string } {
        const MAX_STRING_LENGTH = 8192;
        if (value.length > MAX_STRING_LENGTH) {
            return {
                valid: false,
                error: `Input for "${name}" exceeds maximum allowed length of ${MAX_STRING_LENGTH} characters.`
            };
        }
        return { valid: true };
    }

    static validateNoControlCharacters(value: string, name: string): { valid: boolean; error?: string } {
        // eslint-disable-next-line no-control-regex
        const controlCharRegex = /[\u0000-\u001F\u007F-\u009F]/;
        if (controlCharRegex.test(value)) {
            return {
                valid: false,
                error: `Input for "${name}" contains disallowed control characters.`
            };
        }
        return { valid: true };
    }

    static validatePaginationValue(argumentName: string, value: string): { valid: boolean; error?: string } {
        const paginationArgs = ['first', 'last', 'limit', 'top', 'count'];
        const MAX_PAGINATION_VALUE = 500;
        if (paginationArgs.includes(argumentName.toLowerCase())) {
            const numericValue = parseInt(value, 10);
            if (!isNaN(numericValue) && numericValue > MAX_PAGINATION_VALUE) {
                return {
                    valid: false,
                    error: `Pagination value for '${argumentName}' (${numericValue}) exceeds maximum of ${MAX_PAGINATION_VALUE}.`
                };
            }
        }
        return { valid: true };
    }

    static serializeGraphQLValue(value: any): string {
        if (value === null || value === undefined) {
            return 'null';
        }

        if (typeof value === 'string' && value.startsWith('$')) {
            return value;
        }

        // Handle special __graphqlString wrapper for proper string serialization
        if (typeof value === 'object' && value !== null && '__graphqlString' in value) {
            return JSON.stringify(value.__graphqlString);
        }

        try {
            let gqlType;

            if (typeof value === 'string') {
                gqlType = GraphQLString;
            } else if (typeof value === 'number') {
                if (Number.isInteger(value)) {
                    gqlType = GraphQLInt;
                } else {
                    gqlType = GraphQLFloat;
                }
            } else if (typeof value === 'boolean') {
                gqlType = GraphQLBoolean;
            } else if (Array.isArray(value)) {
                const serializedElements = value.map(v => this.serializeGraphQLValue(v));
                return `[${serializedElements.join(', ')}]`;
            } else if (typeof value === 'object' && value !== null) {
                const entries = Object.entries(value).map(([k, v]) =>
                    `${k}: ${this.serializeGraphQLValue(v)}`
                );
                return `{${entries.join(', ')}}`;
            } else {
                return JSON.stringify(value);
            }

            const ast = astFromValue(value, gqlType);
            if (ast) {
                return print(ast);
            }

            return typeof value === 'string' ? JSON.stringify(value) : String(value);
        } catch (error) {
            return typeof value === 'string' ? JSON.stringify(value) : String(value);
        }
    }

    static validateValueAgainstType(value: any, type: any): string | null {
        if (isNonNullType(type)) {
            if (value === null || value === undefined) {
                return `Expected non-nullable type not to be null`;
            }
            return this.validateValueAgainstType(value, type.ofType);
        }

        if (value === null || value === undefined) {
            return null; // Nullable type, null value is ok.
        }

        const namedType = getNamedType(type);

        if (isScalarType(namedType)) {
            switch (namedType.name) {
                case 'String':
                    if (typeof value !== 'string') {
                        return `Type String expects a string, but received ${typeof value}.`;
                    }
                    break;
                case 'ID':
                    // ID accepts both string and number/int values (GraphQL spec)
                    if (typeof value !== 'string' && typeof value !== 'number') {
                        return `Type ID expects a string or number, but received ${typeof value}.`;
                    }
                    break;
                case 'Int':
                    // Enhanced Int validation with type coercion for protocol compatibility
                    const coercedIntValue = this.coerceToInteger(value);
                    if (coercedIntValue === null) {
                        return `Invalid value "${String(value)}": Int cannot represent non-integer value: "${String(value)}"`;
                    }
                    break;
                case 'Float':
                    // Enhanced Float validation with type coercion for protocol compatibility
                    const coercedFloatValue = this.coerceToFloat(value);
                    if (coercedFloatValue === null) {
                        return `Type Float expects a number, but received ${typeof value}.`;
                    }
                    break;
                case 'Boolean':
                    // Enhanced Boolean validation with type coercion for protocol compatibility
                    const coercedBoolValue = this.coerceToBoolean(value);
                    if (coercedBoolValue === null) {
                        return `Type Boolean expects a boolean, but received ${typeof value}.`;
                    }
                    break;
            }
        }

        return null; // No validation error
    }

    /**
     * Coerce value to integer, handling protocol type conversion issues
     * Returns the coerced integer value or null if coercion fails
     */
    static coerceToInteger(value: any): number | null {
        // Direct number that's an integer
        if (typeof value === 'number' && Number.isInteger(value)) {
            return value;
        }

        // String that represents an integer (protocol conversion case)
        if (typeof value === 'string') {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed.toString() === value) {
                return parsed;
            }
        }

        // Boolean to number conversion (edge case)
        if (typeof value === 'boolean') {
            return null; // Booleans should not coerce to integers
        }

        return null;
    }

    /**
     * Coerce value to float, handling protocol type conversion issues
     * Returns the coerced float value or null if coercion fails
     */
    static coerceToFloat(value: any): number | null {
        // Direct number
        if (typeof value === 'number') {
            return value;
        }

        // String that represents a number (protocol conversion case)
        if (typeof value === 'string') {
            const parsed = parseFloat(value);
            if (!isNaN(parsed) && isFinite(parsed)) {
                return parsed;
            }
        }

        return null;
    }

    /**
     * Coerce value to boolean, handling protocol type conversion issues
     * Returns the coerced boolean value or null if coercion fails
     */
    static coerceToBoolean(value: any): boolean | null {
        // Direct boolean
        if (typeof value === 'boolean') {
            return value;
        }

        // String representations of boolean (protocol conversion case)
        if (typeof value === 'string') {
            const lowerValue = value.toLowerCase();
            if (lowerValue === 'true') {
                return true;
            }
            if (lowerValue === 'false') {
                return false;
            }
        }

        // Number to boolean (JavaScript falsy/truthy, but be strict)
        if (typeof value === 'number') {
            return null; // Numbers should not automatically coerce to booleans
        }

        return null;
    }

    static coerceStringValue(value: string): { coerced: boolean; value: any; type?: string; warning?: string } {
        // Try to detect and coerce numeric values
        const numericValue = this.coerceToInteger(value);
        if (numericValue !== null) {
            return {
                coerced: true,
                value: numericValue,
                type: 'Int',
                warning: `Detected numeric value "${value}". Consider using set-typed-argument() for better type safety.`
            };
        }

        const floatValue = this.coerceToFloat(value);
        if (floatValue !== null && floatValue !== numericValue) {
            return {
                coerced: true,
                value: floatValue,
                type: 'Float',
                warning: `Detected float value "${value}". Consider using set-typed-argument() for better type safety.`
            };
        }

        // Try to detect and coerce boolean values
        const booleanValue = this.coerceToBoolean(value);
        if (booleanValue !== null) {
            return {
                coerced: true,
                value: booleanValue,
                type: 'Boolean',
                warning: `Detected boolean value "${value}". Consider using set-typed-argument() for better type safety.`
            };
        }

        // Value should remain as string
        return {
            coerced: false,
            value: value
        };
    }

    static validateFieldInSchema(
        schema: GraphQLSchema,
        parentType: any,
        fieldName: string
    ): { valid: boolean; error?: string; fieldDef?: any } {
        if (!parentType) {
            return { valid: false, error: 'Parent type not found in schema' };
        }

        const fields = parentType.getFields();
        const fieldDef = fields[fieldName];

        if (!fieldDef) {
            const suggestion = this.findSimilarName(fieldName, Object.keys(fields));
            let error = `Field '${fieldName}' not found on type '${parentType.name}'.`;
            if (suggestion) {
                error += ` Did you mean '${suggestion}'?`;
            }
            return { valid: false, error };
        }

        return { valid: true, fieldDef };
    }

    static validateVariableType(typeString: string): { valid: boolean; error?: string } {
        if (!typeString || typeof typeString !== 'string' || typeString.trim() === '') {
            return { valid: false, error: 'Variable type cannot be empty' };
        }

        const MAX_TYPE_DEPTH = 5;
        const depth = typeString.split('[').length - 1;
        if (depth > MAX_TYPE_DEPTH) {
            return {
                valid: false,
                error: `Variable type nesting depth of ${depth} exceeds maximum of ${MAX_TYPE_DEPTH} in "${typeString}".`
            };
        }

        const typeValidation = this.validateGraphQLType(typeString);
        if (!typeValidation.valid) {
            return typeValidation;
        }

        try {
            const testQuery = `query Test($var: ${typeString}) { __typename }`;
            parse(testQuery);
            return { valid: true };
        } catch (error) {
            return {
                valid: false,
                error: `Invalid variable type "${typeString}": ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    static validateQuerySyntax(queryString: string): { valid: boolean; errors?: string[] } {
        if (!queryString) {
            return { valid: false, errors: ['Query string is empty'] };
        }

        try {
            parse(queryString);
            return { valid: true };
        } catch (error) {
            return {
                valid: false,
                errors: [error instanceof Error ? error.message : String(error)]
            };
        }
    }

    static validateAgainstSchema(
        queryString: string,
        schema: GraphQLSchema
    ): { valid: boolean; errors?: string[] } {
        try {
            const document = parse(queryString);
            const errors = validate(schema, document);

            if (errors.length > 0) {
                return {
                    valid: false,
                    errors: errors.map(err => err.message)
                };
            }

            return { valid: true };
        } catch (error) {
            return {
                valid: false,
                errors: [error instanceof Error ? error.message : String(error)]
            };
        }
    }

    static validateArgumentInSchema(
        fieldDef: any,
        argumentName: string,
        fieldPath?: string
    ): { valid: boolean; error?: string; argDef?: any } {
        try {
            if (!fieldDef || !fieldDef.args) {
                return {
                    valid: false,
                    error: `No arguments available for field '${fieldPath || 'unknown'}'`
                };
            }

            const argDef = fieldDef.args.find((arg: any) => arg.name === argumentName);

            if (!argDef) {
                const availableArgs = fieldDef.args.map((arg: any) => arg.name);
                const suggestion = this.findSimilarName(argumentName, availableArgs);

                let error = `Argument '${argumentName}' not found on field '${fieldPath || fieldDef.name}'.`;

                if (suggestion) {
                    error += ` Did you mean '${suggestion}'?`;
                } else if (availableArgs.length > 0) {
                    const argList = availableArgs.slice(0, 5).join(', ');
                    error += ` Available arguments: ${argList}${availableArgs.length > 5 ? ', ...' : ''}.`;
                } else {
                    error += ' This field does not accept any arguments.';
                }

                return { valid: false, error };
            }

            return { valid: true, argDef };
        } catch (error) {
            return {
                valid: false,
                error: `Error validating argument: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    static validateGraphQLType(typeString: string): { valid: boolean; error?: string; suggestion?: string } {
        // First check if it's already a valid GraphQL type
        const validTypes = ['Int', 'Float', 'String', 'Boolean', 'ID'];
        const baseType = typeString.replace(/[!\[\]]/g, ''); // Remove non-null and list modifiers

        if (validTypes.includes(baseType)) {
            return { valid: true };
        }

        const commonTypeMistakes: Record<string, string> = {
            'integer': 'Int',
            'int': 'Int',
            'number': 'Int',
            'float': 'Float',
            'double': 'Float',
            'bool': 'Boolean',
            'boolean': 'Boolean',
            'string': 'String',
            'str': 'String',
            'text': 'String',
            'id': 'ID',
            'identifier': 'ID'
        };

        const normalizedType = typeString.toLowerCase();
        if (commonTypeMistakes[normalizedType]) {
            return {
                valid: false,
                error: `Invalid type '${typeString}'. Did you mean '${commonTypeMistakes[normalizedType]}'?`,
                suggestion: commonTypeMistakes[normalizedType]
            };
        }

        // Try to parse as GraphQL type
        try {
            const testQuery = `query Test($var: ${typeString}) { __typename }`;
            parse(testQuery);
            return { valid: true };
        } catch (error) {
            return {
                valid: false,
                error: `Could not determine GraphQL type for '${typeString}'. Use standard GraphQL types like Int, String, Boolean, ID, or Float.`
            };
        }
    }

    static findSimilarName(target: string, candidates: string[]): string | null {
        if (candidates.length === 0) return null;

        const targetLower = target.toLowerCase();
        let bestMatch = null;
        let bestScore = Infinity;

        for (const candidate of candidates) {
            const candidateLower = candidate.toLowerCase();
            const score = this.levenshteinDistance(targetLower, candidateLower);

            // Only suggest if it's reasonably similar (within 3 edits and target length)
            if (score < bestScore && score <= Math.min(3, Math.ceil(target.length * 0.6))) {
                bestScore = score;
                bestMatch = candidate;
            }
        }

        return bestMatch;
    }

    static levenshteinDistance(a: string, b: string): number {
        const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

        for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

        for (let j = 1; j <= b.length; j++) {
            for (let i = 1; i <= a.length; i++) {
                const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,     // deletion
                    matrix[j - 1][i] + 1,     // insertion
                    matrix[j - 1][i - 1] + substitutionCost // substitution
                );
            }
        }

        return matrix[b.length][a.length];
    }

    static generatePerformanceWarning(argumentName: string, value: any): string | null {
        if (argumentName === 'limit' && typeof value === 'number' && value > 1000) {
            return `Large limit value (${value}) may impact performance. Consider using pagination with smaller limits and 'page' or 'offset' arguments.`;
        }

        if (argumentName === 'limit' && typeof value === 'string') {
            const numValue = parseInt(value, 10);
            if (!isNaN(numValue) && numValue > 1000) {
                return `Large limit value (${numValue}) may impact performance. Consider using pagination with smaller limits and 'page' or 'offset' arguments.`;
            }
        }

        return null;
    }

    /**
     * Finds the specific GraphQL type for a given field path and argument name.
     * This is essential for schema-aware validation.
     * @param schema The GraphQL schema object.
     * @param fieldPath The dot-separated path to the field (e.g., "user.posts").
     * @param argumentName The name of the argument to get the type for.
     * @returns The GraphQLInputType if found, otherwise null.
     */
    static getArgumentType(
        schema: GraphQLSchema,
        fieldPath: string,
        argumentName: string
    ): GraphQLInputType | null {
        try {
            const pathParts = fieldPath.split('.').filter(p => p);
            if (pathParts.length === 0) return null;

            const rootTypes: Array<GraphQLObjectType | null> = [
                schema.getQueryType() || null,
                schema.getMutationType() || null,
                schema.getSubscriptionType() || null,
            ];

            for (const root of rootTypes) {
                if (!root) continue;
                let currentType: GraphQLObjectType | GraphQLInterfaceType | null = root;

                let failed = false;
                for (let i = 0; i < pathParts.length; i++) {
                    const fieldName = pathParts[i];
                    const field: any = currentType.getFields()[fieldName];
                    if (!field) { failed = true; break; }

                    if (i === pathParts.length - 1) {
                        const arg = field.args.find((a: any) => a.name === argumentName);
                        if (arg) {
                            return arg.type as GraphQLInputType;
                        } else {
                            failed = true;
                            break;
                        }
                    } else {
                        const fieldType: any = getNamedType(field.type);
                        if (isObjectType(fieldType) || isInterfaceType(fieldType)) {
                            currentType = fieldType;
                        } else {
                            failed = true;
                            break;
                        }
                    }
                }

                if (!failed) {
                    // If traversal succeeded but argument not found, keep searching other roots
                }
            }

            return null;
        } catch (error) {
            console.warn('Error getting argument type:', error);
            return null;
        }
    }

    /**
     * Validates that a field can be added at the specified path in the query structure.
     * This ensures incremental query building maintains validity.
     */
    static validateFieldAddition(
        schema: GraphQLSchema,
        queryState: QueryState,
        parentPath: string,
        fieldName: string,
        alias?: string
    ): { valid: boolean; error?: string; warning?: string } {
        try {
            // Basic name validation
            if (!this.isValidGraphQLName(fieldName)) {
                return {
                    valid: false,
                    error: `Invalid field name "${fieldName}". Must match /^[_A-Za-z][_0-9A-Za-z]*$/`
                };
            }

            // Alias validation
            if (alias) {
                const aliasValidation = this.validateFieldAlias(alias);
                if (!aliasValidation.valid) {
                    return {
                        valid: false,
                        error: aliasValidation.error
                    };
                }
            }

            // Navigate to parent type in schema
            let currentType: GraphQLObjectType | GraphQLInterfaceType | null = null;

            // Determine root type based on operation
            switch (queryState.operationType.toLowerCase()) {
                case 'query':
                    currentType = schema.getQueryType() || null;
                    break;
                case 'mutation':
                    currentType = schema.getMutationType() || null;
                    break;
                case 'subscription':
                    currentType = schema.getSubscriptionType() || null;
                    break;
            }

            if (!currentType) {
                return {
                    valid: false,
                    error: `No ${queryState.operationType} type defined in schema`
                };
            }

            // Navigate through path if specified
            if (parentPath) {
                const pathParts = parentPath.split('.');
                for (const part of pathParts) {
                    if (!currentType || (!isObjectType(currentType) && !isInterfaceType(currentType))) {
                        return {
                            valid: false,
                            error: `Cannot traverse path '${parentPath}': type '${(currentType as any)?.name || 'unknown'}' is not an object or interface type`
                        };
                    }

                    const fields: any = currentType.getFields();
                    const field: any = fields[part];
                    if (!field) {
                        const availableFields = Object.keys(fields).slice(0, 5).join(', ');
                        return {
                            valid: false,
                            error: `Field '${part}' not found on type '${currentType.name}'. Available fields: ${availableFields}`
                        };
                    }

                    const fieldType: any = getNamedType(field.type);
                    if (isObjectType(fieldType) || isInterfaceType(fieldType)) {
                        currentType = fieldType;
                    } else {
                        return {
                            valid: false,
                            error: `Cannot select subfields on scalar/enum field '${part}' of type '${fieldType.name}'`
                        };
                    }
                }
            }

            // Validate field exists on target type
            if (!currentType || (!isObjectType(currentType) && !isInterfaceType(currentType))) {
                return {
                    valid: false,
                    error: 'Cannot determine target type for field validation'
                };
            }

            const fields = currentType.getFields();
            if (!fields[fieldName]) {
                const suggestion = this.findSimilarName(fieldName, Object.keys(fields));
                let error = `Field '${fieldName}' not found on type '${currentType.name}'.`;
                if (suggestion) {
                    error += ` Did you mean '${suggestion}'?`;
                } else {
                    const availableFields = Object.keys(fields).slice(0, 5).join(', ');
                    error += ` Available fields: ${availableFields}`;
                }
                return { valid: false, error };
            }

            // Check for field conflicts in query structure
            const targetNode = this.navigateToQueryNode(queryState.queryStructure, parentPath);
            if (targetNode && targetNode.fields) {
                const key = alias || fieldName;
                if (targetNode.fields[key] && targetNode.fields[key].fieldName !== fieldName) {
                    return {
                        valid: false,
                        error: `Alias conflict: '${key}' is already used for field '${targetNode.fields[key].fieldName}'. Choose a different alias.`
                    };
                }
            }

            return { valid: true };
        } catch (error) {
            return {
                valid: false,
                error: `Field validation failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * Validates that an argument can be set on a field with the given value.
     */
    static validateArgumentAddition(
        schema: GraphQLSchema,
        queryState: QueryState,
        fieldPath: string,
        argumentName: string,
        value: any,
        isVariable: boolean = false
    ): { valid: boolean; error?: string; warning?: string } {
        try {
            // Basic name validation
            if (!this.isValidGraphQLName(argumentName)) {
                return {
                    valid: false,
                    error: `Invalid argument name "${argumentName}". Must match /^[_A-Za-z][_0-9A-Za-z]*$/`
                };
            }

            // Verify field exists in query structure
            const fieldNode = this.navigateToQueryNode(queryState.queryStructure, fieldPath);
            if (!fieldNode) {
                return {
                    valid: false,
                    error: `Field at path '${fieldPath}' not found in query structure. Add the field first.`
                };
            }

            // Get argument definition from schema
            const argType = this.getArgumentType(schema, fieldPath, argumentName);
            if (!argType) {
                return {
                    valid: false,
                    error: `Argument '${argumentName}' not found on field '${fieldPath}'. Check the schema documentation.`
                };
            }

            // Skip value validation for variable references
            if (isVariable || (typeof value === 'string' && value.startsWith('$'))) {
                return { valid: true };
            }

            // Handle special case of string "null" conversion before validation
            let valueToValidate = value;
            if (typeof value === 'string' && value.toLowerCase() === 'null') {
                valueToValidate = null;
            }

            // Validate value against argument type
            const valueError = this.validateValueAgainstType(valueToValidate, argType);
            if (valueError) {
                return {
                    valid: false,
                    error: `Invalid value for argument '${argumentName}'. Reason: ${valueError}`
                };
            }

            // Generate warnings
            const warnings: string[] = [];

            // Performance warnings
            const perfWarning = this.generatePerformanceWarning(argumentName, value);
            if (perfWarning) warnings.push(perfWarning);

            // Pagination validation
            const paginationValidation = this.validatePaginationValue(argumentName, String(value));
            if (!paginationValidation.valid) {
                return { valid: false, error: paginationValidation.error };
            }

            return {
                valid: true,
                warning: warnings.length > 0 ? warnings.join(' ') : undefined
            };
        } catch (error) {
            return {
                valid: false,
                error: `Argument validation failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * Validates the entire query structure for completeness and correctness.
     * This is called before query execution or when explicitly requested.
     */
    static validateQueryStructure(
        schema: GraphQLSchema,
        queryState: QueryState
    ): { valid: boolean; errors: string[]; warnings: string[] } {
        const errors: string[] = [];
        const warnings: string[] = [];

        try {
            // Check for empty query
            if (!queryState.queryStructure.fields || Object.keys(queryState.queryStructure.fields).length === 0) {
                errors.push('Query is empty. Add at least one field to the query.');
                return { valid: false, errors, warnings };
            }

            // Validate query complexity
            const complexityAnalysis = analyzeQueryComplexity(queryState.queryStructure, queryState.operationType);
            if (!complexityAnalysis.valid) {
                errors.push(...complexityAnalysis.errors);
            }
            warnings.push(...complexityAnalysis.warnings);

            // Validate required arguments
            const requiredArgsValidation = this.validateRequiredArguments(
                schema,
                queryState.queryStructure,
                queryState.operationType
            );
            if (!requiredArgsValidation.valid) {
                errors.push(...requiredArgsValidation.warnings);
            }

            // Build and validate query syntax (include operation directives and variable defaults)
            const queryString = buildQueryFromStructure(
                queryState.queryStructure,
                queryState.operationType,
                queryState.variablesSchema,
                queryState.operationName,
                queryState.fragments,
                queryState.operationDirectives,
                queryState.variablesDefaults
            );

            if (queryString.trim() === '') {
                errors.push('Generated query is empty.');
                return { valid: false, errors, warnings };
            }

            // Validate against schema
            const schemaValidation = this.validateAgainstSchema(queryString, schema);
            if (!schemaValidation.valid) {
                errors.push(...(schemaValidation.errors || []));
            }

            return {
                valid: errors.length === 0,
                errors,
                warnings
            };
        } catch (error) {
            errors.push(`Query structure validation failed: ${error instanceof Error ? error.message : String(error)}`);
            return { valid: false, errors, warnings };
        }
    }

    /**
     * Helper to navigate to a specific node in the query structure.
     */
    static navigateToQueryNode(queryStructure: any, path: string): any | null {
        if (!path) return queryStructure;

        let currentNode = queryStructure;
        const pathParts = path.split('.');

        for (const part of pathParts) {
            if (!currentNode.fields || !currentNode.fields[part]) {
                return null;
            }
            currentNode = currentNode.fields[part];
        }

        return currentNode;
    }

    static validateRequiredArguments(
        schema: GraphQLSchema,
        queryStructure: any,
        operationType: string = 'query'
    ): { valid: boolean; warnings: string[] } {
        const warnings: string[] = [];

        const validateNode = (node: any, path: string, currentType: GraphQLObjectType | GraphQLInterfaceType | null) => {
            if (!currentType || !node.fields) return;

            Object.entries(node.fields).forEach(([fieldKey, fieldNode]: [string, any]) => {
                const fieldName = fieldNode.fieldName || fieldKey;
                const fieldPath = path ? `${path}.${fieldKey}` : fieldKey;

                try {
                    const fields = currentType.getFields();
                    const fieldDef = fields[fieldName];

                    if (fieldDef && fieldDef.args) {
                        fieldDef.args.forEach((argDef: any) => {
                            if (isNonNullType(argDef.type)) {
                                const providedArgs = fieldNode.args || {};
                                if (!(argDef.name in providedArgs)) {
                                    warnings.push(`Required argument '${argDef.name}' missing for field '${fieldPath}'`);
                                }
                            }
                        });
                    }

                    // Recurse into nested fields
                    if (fieldNode.fields && Object.keys(fieldNode.fields).length > 0) {
                        const nextType = fieldDef ? getNamedType(fieldDef.type) : null;
                        if (nextType && (isObjectType(nextType) || isInterfaceType(nextType))) {
                            validateNode(fieldNode, fieldPath, nextType);
                        }
                    }
                } catch (error) {
                    console.warn(`Error validating field ${fieldPath}:`, error);
                }
            });
        };

        try {
            let rootType: GraphQLObjectType | null = null;
            switch (operationType.toLowerCase()) {
                case 'query':
                    rootType = schema.getQueryType() || null;
                    break;
                case 'mutation':
                    rootType = schema.getMutationType() || null;
                    break;
                case 'subscription':
                    rootType = schema.getSubscriptionType() || null;
                    break;
            }

            if (rootType) {
                validateNode(queryStructure, '', rootType);
            }
        } catch (error) {
            console.warn('Error in validateRequiredArguments:', error);
        }

        return { valid: warnings.length === 0, warnings };
    }
}

// Helper function to sanitize URLs for logging
function sanitizeUrlForLogging(url: string): string {
    try {
        const urlObj = new URL(url);
        if (urlObj.username || urlObj.password) {
            return url.replace(/\/\/[^@]*@/, '//***:***@');
        }
        return url;
    } catch {
        return url;
    }
}

// Helper function to resolve endpoint and headers
// SECURITY: Only allows requests to the default GraphQL endpoint to prevent SSRF attacks
// Mock-first approach for testing - defaults to localhost
export function resolveEndpointAndHeaders(): { url: string | null; headers: Record<string, string> } {
    // Only use the default endpoint from environment variables
    const defaultEndpoint = process.env.DEFAULT_GRAPHQL_ENDPOINT;
    let resolvedUrl: string | null = null;

    if (defaultEndpoint) {
        resolvedUrl = defaultEndpoint;
        console.log(`Using default GraphQL endpoint: ${sanitizeUrlForLogging(defaultEndpoint)}`);
    } else {
        // For test environments, default to localhost to prevent real network calls
        if (process.env.NODE_ENV === 'test') {
            resolvedUrl = 'http://localhost:4000/graphql';
            console.log('Test environment: using localhost GraphQL endpoint');
        } else {
            console.warn('No DEFAULT_GRAPHQL_ENDPOINT configured in environment variables');
        }
    }

    const headers: Record<string, string> = {};

    if (process.env.DEFAULT_GRAPHQL_HEADERS) {
        try {
            const defaultHeaders = JSON.parse(process.env.DEFAULT_GRAPHQL_HEADERS);
            if (typeof defaultHeaders !== 'object' || defaultHeaders === null || Array.isArray(defaultHeaders)) {
                throw new Error('Headers must be a valid object');
            }

            // Validate each header key/value
            for (const [key, value] of Object.entries(defaultHeaders)) {
                if (typeof key !== 'string' || typeof value !== 'string') {
                    throw new Error(`Invalid header: ${key} must be string`);
                }
                if (key.length > 100 || value.length > 1000) {
                    throw new Error(`Header ${key} exceeds maximum length`);
                }
            }

            Object.assign(headers, defaultHeaders);
        } catch (error) {
            console.warn(`Failed to parse DEFAULT_GRAPHQL_HEADERS: ${error instanceof Error ? error.message : 'Invalid JSON'}`);
        }
    }

    return { url: resolvedUrl, headers };
}

// Fetch and cache schema
export async function fetchAndCacheSchema(sessionHeaders?: Record<string, string>): Promise<GraphQLSchema> {
    const { url: resolvedUrl, headers: envHeaders } = resolveEndpointAndHeaders();

    if (!resolvedUrl) {
        throw new Error("No default GraphQL endpoint configured in environment variables (DEFAULT_GRAPHQL_ENDPOINT)");
    }

    if (schemaCache.has(resolvedUrl)) {
        return schemaCache.get(resolvedUrl)!;
    }

    const mergedHeaders = { ...envHeaders, ...sessionHeaders };
    const introspectionQuery = getIntrospectionQuery({ descriptions: true });

    try {
        const response = await fetch(resolvedUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...mergedHeaders,
            },
            body: JSON.stringify({ query: introspectionQuery }),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.errors) {
            throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
        }

        if (!result.data) {
            throw new Error("Invalid introspection response: 'data' field missing");
        }

        const schema = buildClientSchema(result.data);
        schemaCache.set(resolvedUrl, schema);
        rawSchemaJsonCache.set(resolvedUrl, result.data);

        return schema;
    } catch (error) {
        throw new Error(`Error processing schema from ${resolvedUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// Helper function to get type name string from GraphQL type
export function getTypeNameStr(gqlType: any): string {
    if (isNonNullType(gqlType)) return `${getTypeNameStr(gqlType.ofType)}!`;
    if (isListType(gqlType)) return `[${getTypeNameStr(gqlType.ofType)}]`;
    if (gqlType && gqlType.name) return gqlType.name;
    return String(gqlType);
}

// Generate session ID
export function generateSessionId(): string {
    return randomBytes(16).toString('hex');
}

// Query state storage functions
export async function saveQueryState(sessionId: string, queryState: QueryState): Promise<void> {
    const serializableData = { ...queryState };
    await withRedisRetry('saveQueryState', async () => {
        const normalizedId = normalizeSessionId(sessionId);
        const sessionKey = `querystate:${normalizedId}`;
        if (HAS_SESSION_TTL) {
            await redis.setEx(sessionKey, SESSION_TTL_SECONDS, JSON.stringify(serializableData));
        } else {
            await redis.set(sessionKey, JSON.stringify(serializableData));
        }
        console.log(`Session ${normalizedId} saved to Redis`);
    });
}

export async function loadQueryState(sessionId: string): Promise<QueryState | null> {
    const normalizedId = normalizeSessionId(sessionId);
    const sessionKey = `querystate:${normalizedId}`;
    return await withRedisRetry('loadQueryState', async () => {
        const data = await redis.get(sessionKey);
        if (!data) {
            console.log(`Session ${normalizedId} not found in Redis`);
            return null;
        }
        const jsonString = typeof data === 'string' ? data : (data as Buffer).toString();
        const queryState = JSON.parse(jsonString);
        console.log(`Session ${normalizedId} loaded from Redis`);
        if (HAS_SESSION_TTL) {
            try {
                await redis.expire(sessionKey, SESSION_TTL_SECONDS);
            } catch { }
        }
        return queryState;
    });
}

export async function deleteQueryState(sessionId: string): Promise<boolean> {
    const normalizedId = normalizeSessionId(sessionId);
    const sessionKey = `querystate:${normalizedId}`;
    return await withRedisRetry('deleteQueryState', async () => {
        const result = await redis.del(sessionKey);
        return (result as number) > 0;
    });
}

// Export the raw schema cache for use in other tools
export { rawSchemaJsonCache };

// Generate example values for GraphQL types
export function generateExampleValue(gqlType: any): any {
    if (isNonNullType(gqlType)) {
        return generateExampleValue(gqlType.ofType);
    }

    if (isListType(gqlType)) {
        return generateExampleValue(gqlType.ofType);
    }

    if (isScalarType(gqlType)) {
        if (gqlType.name === "String") return "example_string";
        if (gqlType.name === "Int") return 42;
        if (gqlType.name === "Float") return 3.14;
        if (gqlType.name === "Boolean") return true;
        if (gqlType.name === "ID") return "example_id";
        return "example_value";
    }

    if (isEnumType(gqlType)) {
        const enumValues = gqlType.getValues();
        return enumValues.length > 0 ? enumValues[0].name : "ENUM_VALUE";
    }

    if (isInputObjectType(gqlType)) {
        const nestedObj: any = {};
        const fields = gqlType.getFields();
        Object.entries(fields).forEach(([fieldName, fieldDef]) => {
            if (isNonNullType((fieldDef as any).type)) {
                nestedObj[fieldName] = generateExampleValue((fieldDef as any).type.ofType);
            } else {
                nestedObj[fieldName] = generateExampleValue((fieldDef as any).type);
            }
        });
        return nestedObj;
    }

    return null;
}

// Build query from structure
export function buildQueryFromStructure(
    queryStructure: any,
    operationType: string,
    variablesSchema: Record<string, string>,
    operationName?: string | null,
    fragments: Record<string, any> = {},
    operationDirectives: any[] = [],
    variablesDefaults: Record<string, any> = {}
): string {
    const hasFields = queryStructure.fields && Object.keys(queryStructure.fields).length > 0;
    const hasFragmentSpreads = queryStructure.fragmentSpreads && queryStructure.fragmentSpreads.length > 0;
    const hasInlineFragments = queryStructure.inlineFragments && queryStructure.inlineFragments.length > 0;
    const hasFragments = fragments && Object.keys(fragments).length > 0;

    if (!hasFields && !hasFragmentSpreads && !hasInlineFragments && !hasFragments) {
        return "";
    }

    let variablesString = Object.entries(variablesSchema)
        .map(([name, type]) => {
            const cleanVarName = name.startsWith('$') ? name.slice(1) : name;
            let definition = `$${cleanVarName}: ${type}`;

            if (variablesDefaults[name] !== undefined) {
                const defaultValue = variablesDefaults[name];
                definition += ` = ${GraphQLValidationUtils.serializeGraphQLValue(defaultValue)}`;
            }

            return definition;
        })
        .join(', ');

    let operationDirectivesString = "";
    if (operationDirectives && operationDirectives.length > 0) {
        operationDirectivesString = " " + operationDirectives.map(dir => {
            let argsString = "";
            if (dir.arguments && dir.arguments.length > 0) {
                argsString = "(" + dir.arguments.map((arg: { name: string, value: any }) => {
                    const value = typeof arg.value === 'string' && arg.value.startsWith('$')
                        ? arg.value
                        : GraphQLValidationUtils.serializeGraphQLValue(arg.value);
                    return `${arg.name}: ${value}`;
                }).join(', ') + ")";
            }
            return `@${dir.name}${argsString}`;
        }).join(" ") + " ";
    }

    const selectionSetString = buildSelectionSet(queryStructure.fields);

    // Properly serialize fragments
    const fragmentsString = Object.entries(fragments).map(([fragmentName, fragmentData]: [string, any]) => {
        if (fragmentData && fragmentData.onType && fragmentData.fields) {
            const fragmentSelectionSet = buildSelectionSet(fragmentData.fields);
            return `fragment ${fragmentName} on ${fragmentData.onType} {\n${fragmentSelectionSet}\n}`;
        }
        return '';
    }).filter(f => f).join('\n\n');

    let queryString = '';
    if (operationType) {
        queryString += `${operationType}`;
    }

    if (operationName) {
        queryString += ` ${operationName}`;
    }

    if (variablesString) {
        queryString += `(${variablesString})`
    }

    if (operationDirectivesString) {
        queryString += `${operationDirectivesString}`;
    }

    queryString += ` {\n${selectionSetString}\n}`;

    if (fragmentsString) {
        queryString += `\n\n${fragmentsString}`;
    }

    return queryString.trim();
}

// Build selection set from fields structure
export function buildSelectionSet(fields: Record<string, any>, indent = '  '): string {
    return Object.entries(fields).map(([, fieldData]) => {
        let fieldString = `${indent}${fieldData.alias ? fieldData.alias + ': ' : ''}${fieldData.fieldName}`;

        if (fieldData.args && Object.keys(fieldData.args).length > 0) {
            const args = Object.entries(fieldData.args).map(([argName, argValue]: [string, any]) => {
                if (typeof argValue === 'object' && argValue !== null && ('value' in argValue || 'is_variable' in argValue || 'is_enum' in argValue || 'is_typed' in argValue)) {
                    if (argValue.is_variable) {
                        return `${argName}: ${argValue.value}`;
                    } else if (argValue.is_enum) {
                        return `${argName}: ${argValue.value}`;
                    } else if (argValue.is_typed) {
                        // Handle typed values - serialize the raw value properly
                        if (typeof argValue.value === 'number' || typeof argValue.value === 'boolean' || argValue.value === null) {
                            return `${argName}: ${argValue.value}`;
                        } else {
                            return `${argName}: ${GraphQLValidationUtils.serializeGraphQLValue(argValue.value)}`;
                        }
                    } else {
                        return `${argName}: ${GraphQLValidationUtils.serializeGraphQLValue(argValue.value)}`;
                    }
                } else {
                    if (typeof argValue === 'string' && argValue.startsWith('$')) {
                        return `${argName}: ${argValue}`;
                    } else if (typeof argValue === 'object' && argValue !== null && '__graphqlString' in argValue) {
                        // Handle special string format to prevent double quoting
                        return `${argName}: ${JSON.stringify(argValue.__graphqlString)}`;
                    } else {
                        return `${argName}: ${GraphQLValidationUtils.serializeGraphQLValue(argValue)}`;
                    }
                }
            });
            fieldString += `(${args.join(', ')})`;
        }

        if (fieldData.directives && fieldData.directives.length > 0) {
            const directives = fieldData.directives.map((dir: any) => {
                let directiveStr = `@${dir.name}`;
                if (dir.arguments && dir.arguments.length > 0) {
                    const dirArgs = dir.arguments.map((arg: any) => {
                        const value = typeof arg.value === 'string' && arg.value.startsWith('$')
                            ? arg.value
                            : GraphQLValidationUtils.serializeGraphQLValue(arg.value);
                        return `${arg.name}: ${value}`;
                    });
                    directiveStr += `(${dirArgs.join(', ')})`;
                }
                return directiveStr;
            });
            fieldString += ` ${directives.join(' ')}`;
        }

        let subSelectionContent = '';
        if (fieldData.fields && Object.keys(fieldData.fields).length > 0) {
            subSelectionContent += buildSelectionSet(fieldData.fields, indent + '  ');
        }

        if (fieldData.fragmentSpreads && Array.isArray(fieldData.fragmentSpreads) && fieldData.fragmentSpreads.length > 0) {
            if (subSelectionContent && !subSelectionContent.endsWith('\n')) subSelectionContent += '\n';
            subSelectionContent += fieldData.fragmentSpreads.map((s: string) => `${indent + '  '}...${s}`).join('\n');
        }

        if (fieldData.inlineFragments) {
            fieldData.inlineFragments.forEach((inlineFrag: any) => {
                if (inlineFrag.on_type && inlineFrag.selections && Object.keys(inlineFrag.selections).length > 0) {
                    if (subSelectionContent && !subSelectionContent.endsWith('\n')) subSelectionContent += '\n';
                    // Support primitive string fields inside inline fragments for nested syntax like "owner { login }"
                    const selections = normalizeSelections(inlineFrag.selections);
                    const inlineFragSelectionStr = buildSelectionSet(selections, indent + '    ');
                    subSelectionContent += `${indent + '  '}... on ${inlineFrag.on_type} {\n${inlineFragSelectionStr}\n${indent + '  '}}`;
                }
            });
        }

        if (subSelectionContent) {
            fieldString += ` {\n${subSelectionContent}\n${indent}}`;
        }

        return fieldString;
    }).join('\n');
}

function normalizeSelections(selections: Record<string, any>): Record<string, any> {
    const normalized: Record<string, any> = {};
    for (const [key, val] of Object.entries(selections)) {
        if (typeof key === 'string' && key.includes('{')) {
            // This case typically won't occur since keys are field names; handle values as strings below
        }
        if (typeof val === 'string') {
            // Parse shorthand like "owner { login }"
            const m = val.match(/^([^\s{]+)\s*\{\s*([^}]+)\s*\}$/);
            if (m) {
                const parent = m[1];
                const children = m[2].split(',').map(s => s.trim()).filter(Boolean);
                normalized[parent] = normalized[parent] || {
                    fieldName: parent,
                    alias: null,
                    args: {},
                    fields: {},
                    directives: [],
                    fragmentSpreads: [],
                    inlineFragments: []
                };
                for (const child of children) {
                    normalized[parent].fields[child] = {
                        fieldName: child,
                        alias: null,
                        args: {},
                        fields: {},
                        directives: [],
                        fragmentSpreads: [],
                        inlineFragments: []
                    };
                }
                continue;
            }
        }
        normalized[key] = val;
    }
    return normalized;
}

export const MAX_INPUT_COMPLEXITY = {
    DEPTH: 10,
    PROPERTIES: 1000,
};

// Query depth and complexity limits
export const MAX_QUERY_COMPLEXITY = {
    DEPTH: 12, // Increased from 8 to allow more reasonable nesting
    FIELD_COUNT: 200, // Increased from 100 to allow more comprehensive queries
    TOTAL_COMPLEXITY_SCORE: 2500, // Increased from 1000 to allow realistic queries
};

export const QUERY_EXECUTION_TIMEOUT = {
    DEFAULT: 30000, // 30 seconds
    EXPENSIVE: 60000, // 60 seconds for expensive operations
};

/**
 * Analyze query depth and complexity
 */
export function analyzeQueryComplexity(
    queryStructure: any,
    operationType: string = 'query'
): {
    valid: boolean;
    depth: number;
    fieldCount: number;
    complexityScore: number;
    errors: string[];
    warnings: string[];
} {
    const result = {
        valid: true,
        depth: 0,
        fieldCount: 0,
        complexityScore: 0,
        errors: [] as string[],
        warnings: [] as string[],
    };

    const visited = new Set<string>();

    function analyzeNode(node: any, currentDepth: number, path: string = ''): void {
        if (!node || !node.fields) return;

        if (currentDepth > result.depth) {
            result.depth = currentDepth;
        }

        if (currentDepth > MAX_QUERY_COMPLEXITY.DEPTH) {
            result.valid = false;
            result.errors.push(
                `Query depth ${currentDepth} exceeds maximum allowed depth of ${MAX_QUERY_COMPLEXITY.DEPTH} at path: ${path}`
            );
            return; // Stop analyzing deeper to prevent excessive error messages
        }

        // Analyze each field
        Object.entries(node.fields).forEach(([fieldKey, fieldData]: [string, any]) => {
            const fieldPath = path ? `${path}.${fieldKey}` : fieldKey;
            result.fieldCount++;

            // Calculate field complexity score
            let fieldComplexity = 1; // Base complexity

            // Add complexity for arguments
            if (fieldData.args && Object.keys(fieldData.args).length > 0) {
                fieldComplexity += Object.keys(fieldData.args).length * 0.5;

                // Higher complexity for pagination arguments with large values
                Object.entries(fieldData.args).forEach(([argName, argValue]: [string, any]) => {
                    if (['first', 'last', 'limit', 'count'].includes(argName.toLowerCase())) {
                        const numValue = typeof argValue === 'number' ? argValue :
                            (typeof argValue === 'string' ? parseInt(argValue, 10) : 0);
                        if (numValue > 100) {
                            fieldComplexity += Math.log10(numValue) * 2;
                        }
                    }
                });
            }

            // Add complexity for directives
            if (fieldData.directives && fieldData.directives.length > 0) {
                fieldComplexity += fieldData.directives.length * 0.3;
            }

            // Multiply by depth factor (deeper fields are more expensive)
            // Reduced multiplier from 1.5 to 1.2 to be less aggressive
            fieldComplexity *= Math.pow(1.2, currentDepth);

            result.complexityScore += fieldComplexity;

            // Prevent circular references in analysis
            if (!visited.has(fieldPath)) {
                visited.add(fieldPath);

                // Recursively analyze nested fields
                if (fieldData.fields && Object.keys(fieldData.fields).length > 0) {
                    analyzeNode(fieldData, currentDepth + 1, fieldPath);
                }

                visited.delete(fieldPath);
            }
        });

        // Analyze fragment spreads
        if (node.fragmentSpreads && Array.isArray(node.fragmentSpreads)) {
            node.fragmentSpreads.forEach((fragmentName: string) => {
                result.fieldCount++;
                result.complexityScore += 2; // Fragment spreads add complexity
            });
        }

        // Analyze inline fragments
        if (node.inlineFragments && Array.isArray(node.inlineFragments)) {
            node.inlineFragments.forEach((inlineFragment: any, index: number) => {
                const fragPath = `${path}...on${inlineFragment.on_type || 'Unknown'}[${index}]`;
                if (inlineFragment.selections) {
                    analyzeNode({ fields: inlineFragment.selections }, currentDepth + 1, fragPath);
                }
            });
        }
    }

    // Start analysis from root
    analyzeNode(queryStructure, 1);

    // Check overall limits
    if (result.fieldCount > MAX_QUERY_COMPLEXITY.FIELD_COUNT) {
        result.valid = false;
        result.errors.push(
            `Query field count ${result.fieldCount} exceeds maximum allowed field count of ${MAX_QUERY_COMPLEXITY.FIELD_COUNT}`
        );
    }

    if (result.complexityScore > MAX_QUERY_COMPLEXITY.TOTAL_COMPLEXITY_SCORE) {
        result.valid = false;
        result.errors.push(
            `Query complexity score ${Math.round(result.complexityScore)} exceeds maximum allowed complexity of ${MAX_QUERY_COMPLEXITY.TOTAL_COMPLEXITY_SCORE}`
        );
    }

    // Add warnings for high complexity
    if (result.complexityScore > MAX_QUERY_COMPLEXITY.TOTAL_COMPLEXITY_SCORE * 0.7) {
        result.warnings.push(
            `Query complexity score ${Math.round(result.complexityScore)} is approaching the limit of ${MAX_QUERY_COMPLEXITY.TOTAL_COMPLEXITY_SCORE}. Consider simplifying the query.`
        );
    }

    if (result.depth > MAX_QUERY_COMPLEXITY.DEPTH * 0.8) {
        result.warnings.push(
            `Query depth ${result.depth} is approaching the limit of ${MAX_QUERY_COMPLEXITY.DEPTH}. Consider reducing nesting.`
        );
    }

    return result;
}

/**
 * Execute with timeout
 */
export async function executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string = 'Operation timed out'
): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
            reject(new Error(`${timeoutMessage} (${timeoutMs}ms)`));
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
}

/**
 * Calculate per-field complexity score for rate limiting
 */
export function calculateFieldComplexityScore(fieldData: any, depth: number = 1): number {
    let score = 1; // Base score

    // Arguments add complexity
    if (fieldData.args && Object.keys(fieldData.args).length > 0) {
        score += Object.keys(fieldData.args).length * 0.5;
    }

    // Directives add complexity
    if (fieldData.directives && fieldData.directives.length > 0) {
        score += fieldData.directives.length * 0.3;
    }

    // Nested fields multiply complexity
    if (fieldData.fields && Object.keys(fieldData.fields).length > 0) {
        const nestedScore = Object.values(fieldData.fields).reduce((sum: number, nestedField: any) => {
            return sum + calculateFieldComplexityScore(nestedField, depth + 1);
        }, 0);
        score += nestedScore * 1.2; // Nested fields are more expensive
    }

    // Depth multiplier
    score *= Math.pow(1.3, depth - 1);

    return score;
}

export function validateInputComplexity(value: any, name: string): string | null {
    if (value === null || typeof value !== 'object') {
        return null; // Not a complex object, no need to validate
    }

    const visited = new WeakSet();
    let count = 0;

    function check(val: any, depth: number): string | null {
        if (val === null || typeof val !== 'object') {
            return null;
        }

        if (depth > MAX_INPUT_COMPLEXITY.DEPTH) {
            return `Input for "${name}" exceeds the maximum allowed depth of ${MAX_INPUT_COMPLEXITY.DEPTH}.`;
        }

        if (visited.has(val)) {
            // This is a circular reference. We don't treat it as an error,
            // but we stop traversing to prevent infinite loops.
            return null;
        }
        visited.add(val);

        if (Array.isArray(val)) {
            count += val.length;
            for (const item of val) {
                const error = check(item, depth + 1);
                if (error) return error;
            }
        } else {
            const keys = Object.keys(val);
            count += keys.length;
            for (const key of keys) {
                const error = check(val[key], depth + 1);
                if (error) return error;
            }
        }

        if (count > MAX_INPUT_COMPLEXITY.PROPERTIES) {
            return `Input for "${name}" exceeds the maximum allowed number of properties/elements of ${MAX_INPUT_COMPLEXITY.PROPERTIES}.`;
        }

        return null;
    }

    return check(value, 1);
} 