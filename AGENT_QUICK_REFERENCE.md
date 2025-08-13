# QuerySculptor Quick Reference for AI Agents

## Essential Workflow
```
start-query-session → introspect-schema → build query → validate-query → execute-query
```

## Tool Quick Reference

### Session (Required First)
- `start-query-session` - Create session with endpoint/headers
- `get-query-state` - Debug current state
- `end-query-session` - Cleanup

### Schema (Required Early)  
- `introspect-schema` - Get all types/fields (run after session start)
- `search-schema` - Find types/fields by name
- `get-field-details` - Check field arguments/requirements
- `get-input-object-help` - Mutation input structure

### Building
- `select-field` - Add single field
- `select-multiple-fields` - Add multiple fields
- `set-string-argument` - String/enum args
- `set-typed-argument` - Number/boolean/object args  
- `set-input-object-argument` - Complex nested inputs

### Variables
- `add-variable` - Define variable
- `set-variable-value` - Set value
- `set-variable-argument` - Use variable in field

### Final Steps
- `validate-query` - Check query validity
- `execute-query` - Run query
- `get-query-string` - View GraphQL text

## Common Patterns

**Basic Query:**
```
start-query-session(endpoint) → introspect-schema → select-field("user") → 
set-string-argument("user", "id", "123") → validate-query → execute-query
```

**Mutation:**
```
start-query-session → introspect-schema → get-input-object-help("UserInput") →
select-field("createUser") → set-input-object-argument("createUser", "input", {...}) →
validate-query → execute-query
```

## Error Handling
- Always check response.error field
- validate-query before execute-query
- Use get-query-state for debugging
- Re-run introspect-schema if schema issues

## Response Format
- Success: `{success: true, data...}`
- Error: `{error: "message"}`
- Warning: `{success: true, warning: "message"}`