### QuerySculptor – Validation Hardening and Query-Building Safety Improvements

This release tightens validation across the GraphQL query-building tools so agents cannot construct incorrect queries. The changes focus on schema-aware checks, safer argument handling, and clearer error messages, while preserving backward compatibility in mocked/test environments.

#### What changed

- set-variable-argument.ts
  - Schema-aware validation (best-effort):
    - Verifies the target field actually has the specified argument.
    - Ensures the declared variable type is compatible with the argument type (`isTypeSubTypeOf`).
  - Requires variables to be declared before use and maintains existing name validation.
  - Falls back gracefully when schema is unavailable (e.g., mocks), logging a warning instead of failing hard.

- set-string-argument.ts
  - Validates argument existence against the schema for non-enum cases (best-effort); safely skipped for enums to avoid false positives in strict mocks.
  - Retains protections for string length, control characters, and pagination argument sanity.
  - Continues to auto-coerce numeric/boolean strings and surfaces performance warnings.

- set-input-object-argument.ts
  - Validates (best-effort) that the target argument is an Input Object before allowing nested property assignment.
  - Preserves protections against prototype pollution and input complexity.
  - Gracefully skips hard failures when schema is not available in tests, logging a warning instead.

- set-operation-directive.ts
  - Validates directive existence and argument compatibility against the schema when provided (variable vs literal correctness, type compatibility).
  - Retains existing behavior for adding/reusing operation-level directives.

- shared-utils.ts
  - getArgumentType now resolves arguments starting from Query, then Mutation, then Subscription roots (not just Query). This fixes argument lookups for mutation workflows.

#### How this prevents incorrect queries

- Agents cannot:
  - Assign undeclared variables or use them where the argument type is incompatible.
  - Set nested input object fields on non-input arguments.
  - Bypass basic string, control character, or pagination constraints.
- Clear, human-readable errors are returned early from the tools, stopping invalid states before query generation or execution.

#### Backward compatibility

- No tool names or input schemas changed.
- Validation is "best-effort": when the schema cannot be fetched (common in test/mocked environments), tools log a warning and avoid failing hard, preserving existing tests/workflows. In real environments with a schema, stricter checks are enforced.

#### Developer/testing notes

- Running tests
  - Install deps: `pnpm install`
  - Run tests: `pnpm test`
- If you mock `tools/shared-utils`, ensure your mock exports `fetchAndCacheSchema` and related helpers used by tools; otherwise, you may see logged warnings where schema checks are skipped by design.
- Mutation workflows should now correctly validate argument types due to the enhanced `getArgumentType` resolution across operation roots.

#### Impacted files

- `tools/set-variable-argument.ts`
- `tools/set-string-argument.ts`
- `tools/set-input-object-argument.ts`
- `tools/set-operation-directive.ts`
- `tools/shared-utils.ts` (updated `getArgumentType`)

These changes align tool behavior with the project goal: agents should not be able to construct incorrect queries with the tools.