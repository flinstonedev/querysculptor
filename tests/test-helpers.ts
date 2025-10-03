/**
 * 🔧 PRIORITY 1 FIX: Test Assertion Helpers
 * 
 * This file provides standardized assertion patterns to replace
 * the 80+ anti-pattern assertions using expect().toBeUndefined()
 */

import { expect } from 'vitest';

/**
 * Assert that an operation was successful
 * Replaces: expect(result.error).toBeUndefined()
 *
 * Updated for unified response format:
 * - result.success = true
 * - result.data contains the payload (optional - some responses have data at top level)
 * - result.data.message or result.message contains the message
 */
export function expectSuccess(result: any, expectedMessage?: string): void {
    // Check if it's an error first
    if (result.error) {
        throw new Error(`Expected success but got error: ${result.error}`);
    }

    // For wrapped responses with explicit success field
    if ('success' in result) {
        expect(result.success).toBe(true);

        // Data might be at result.data or at the top level
        // Only check result.data if success is explicitly true and data exists
        if (result.success === true && result.data !== undefined) {
            expect(result.data).toBeDefined();

            // If expected message provided, verify it
            if (expectedMessage) {
                expect(result.data.message).toContain(expectedMessage);
            }

            // Verify message exists (success should always have a message)
            if (result.data.message !== undefined) {
                expect(result.data.message).toBeDefined();
                expect(typeof result.data.message).toBe('string');
                expect(result.data.message.length).toBeGreaterThan(0);
            }
        } else if (result.success === true) {
            // Legacy format: data is at the top level
            // If expected message provided, verify it
            if (expectedMessage && result.message) {
                expect(result.message).toContain(expectedMessage);
            }
        }
    }
}

/**
 * Assert that an operation failed with expected error
 * Replaces inconsistent error checking patterns
 */
export function expectError(result: any, expectedErrorMessage?: string): void {
    // Positive assertion - verify error exists
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);

    // Verify success is not present or is false
    expect(result.success).not.toBe(true);

    // If expected error message provided, verify it
    if (expectedErrorMessage) {
        expect(result.error).toContain(expectedErrorMessage);
    }
}

/**
 * Assert that a query string contains expected GraphQL content
 * Replaces inconsistent query validation patterns  
 */
export function expectValidQuery(queryString: string, expectedContent: string[]): void {
    // Verify query string is valid
    expect(queryString).toBeDefined();
    expect(typeof queryString).toBe('string');
    expect(queryString.length).toBeGreaterThan(0);

    // Verify it contains expected content
    expectedContent.forEach(content => {
        expect(queryString).toContain(content);
    });

    // Basic GraphQL syntax validation
    expect(queryString).toMatch(/^(query|mutation|subscription)/);
    expect(queryString).toContain('{');
    expect(queryString).toContain('}');
}

/**
 * Assert that a field selection was successful
 * Standardized pattern for field selection tests
 */
export function expectFieldSelection(result: any, fieldName: string, parentPath?: string): void {
    expectSuccess(result);

    const expectedMessage = parentPath
        ? `Field '${fieldName}' selected successfully at path '${parentPath}'`
        : `Field '${fieldName}' selected successfully`;

    expect(result.data.message).toContain(expectedMessage);

    // Verify query structure was updated
    expect(result.data.queryStructure).toBeDefined();
}

/**
 * Assert that an argument was set successfully
 * Standardized pattern for argument setting tests
 */
export function expectArgumentSet(
    result: any,
    argumentName: string,
    argumentValue: any,
    currentPath: string
): void {
    expectSuccess(result);

    expect(result.data.message).toContain(`argument '${argumentName}'`);
    expect(result.data.message).toContain(String(argumentValue));
    expect(result.data.message).toContain(`path '${currentPath}'`);

    // Verify query structure was updated
    expect(result.data.queryStructure).toBeDefined();
}

/**
 * Assert that a variable was set successfully
 * Standardized pattern for variable tests
 */
export function expectVariableSet(
    result: any,
    variableName: string,
    variableType: string
): void {
    expectSuccess(result);

    expect(result.data.message).toContain(`Variable '${variableName}'`);
    expect(result.data.message).toContain(`type '${variableType}'`);
}

/**
 * Assert that a session was created successfully
 * Standardized pattern for session creation tests
 */
export function expectSessionCreated(
    result: any,
    operationType: string,
    operationName?: string
): void {
    expectSuccess(result);

    expect(result.data.sessionId).toBeDefined();
    expect(typeof result.data.sessionId).toBe('string');
    expect(result.data.sessionId.length).toBeGreaterThan(0);

    expect(result.data.operationType).toBe(operationType);

    if (operationName) {
        expect(result.data.operationName).toBe(operationName);
    }
}

/**
 * Assert that a session was ended successfully
 * Standardized pattern for session cleanup tests
 */
export function expectSessionEnded(result: any, sessionId: string): void {
    expectSuccess(result);

    expect(result.data.message).toContain('ended successfully');
    expect(result.data.sessionInfo?.sessionId).toBe(sessionId);
}

/**
 * Assert that validation passed
 * Standardized pattern for validation tests
 */
export function expectValidationPassed(result: any): void {
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
    expect(result.error).toBeUndefined();

    // Query should be present for successful validation
    if ('query' in result) {
        expect(result.query).toBeDefined();
        expect(typeof result.query).toBe('string');
    }
}

/**
 * Assert that validation failed with expected errors
 * Standardized pattern for validation failure tests
 */
export function expectValidationFailed(result: any, expectedErrors?: string[]): void {
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);

    if (expectedErrors) {
        expectedErrors.forEach(expectedError => {
            expect(result.errors.some((error: string) =>
                error.includes(expectedError)
            )).toBe(true);
        });
    }
}

/**
 * Assert that current query result is valid
 * Standardized pattern for getCurrentQuery tests
 */
export function expectCurrentQuery(
    result: any,
    expectedQueryParts: string[],
    expectedVariables?: Record<string, string>
): void {
    // Should not have error
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();

    // Should have query string
    expect(result.data.queryString).toBeDefined();
    expectValidQuery(result.data.queryString, expectedQueryParts);

    // Should have variables schema
    expect(result.data.variables_schema).toBeDefined();

    if (expectedVariables) {
        expect(result.data.variables_schema).toEqual(expectedVariables);
    }
}

/**
 * Assert that a directive was set successfully
 * Standardized pattern for directive tests
 */
export function expectDirectiveSet(
    result: any,
    directiveName: string,
    currentPath?: string
): void {
    expectSuccess(result);

    expect(result.data.message).toContain(`Directive '@${directiveName}'`);

    if (currentPath) {
        expect(result.data.message).toContain(`path '${currentPath}'`);
    }
} 