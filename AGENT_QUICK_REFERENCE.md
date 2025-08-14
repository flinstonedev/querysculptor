# QuerySculptor Quick Reference for AI Agents

## Essential Workflow
```
start-query-session → introspect-schema → build query → validate-query → execute-query
```

## Tool Quick Reference

### Session (Required First)
- `start-query-session` - Create session
- `get-current-query` - View current query text and variables
- `get-root-operation-types` - Discover root operation types
- `end-query-session` - Cleanup

### Schema (Required Early)
- `introspect-schema` - Get all types/fields
- `get-type-info` - Inspect a type
- `get-field-info` - Field args/return type
- `get-input-object-help` - Mutation input structure

### Building
- `select-field` - Add single field
- `select-multi-fields` - Add multiple fields
- `get-selections` - Available fields/inline fragments at a path
- `set-string-argument` - String/enum args
- `set-typed-argument` - Number/boolean/object args
- `set-input-object-argument` - Complex nested inputs
- `set-variable-argument` - Use variable in field

### Variables
- `set-query-variable` - Define variable (+optional default)
- `set-variable-value` - Set value
- `remove-query-variable` - Remove variable

### Final Steps
- `validate-query` - Check query validity
- `execute-query` - Run query
- `get-current-query` - View GraphQL text

## Unions/Interfaces (Inline Fragments)
- When validation says a field is not on a union/interface member, use `apply-inline-frag` at the correct parent path.
- Example:
```
parentPath: "search.edges.node"
typeName: "Repository"
fieldNames: ["name", "owner { login }", "stargazers { totalCount }", "url"]
```

## Error Handling
- Always check `response.error`
- Use `validate-query` before `execute-query`
- Use `get-current-query` and `get-selections` for debugging
- Re-run `introspect-schema` if schema issues

## Response Format
- Success: `{success: true, ...}`
- Error: `{error: "message"}`
- Warning: `{success: true, warning: "message", ...}`