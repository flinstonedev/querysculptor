# ⚒️ QuerySculptor

## 🚀 **GraphQL query generation tools for AI Agents**

An MCP server that helps AI agents interact with GraphQL APIs through structured tools instead of raw query generation.

QuerySculptor provides **26 tools** via the Model Context Protocol (MCP) that allow agents to build, validate, and execute GraphQL queries step-by-step rather than generating complete query strings.

![QuerySculptor Demo](./public/assets/querysculptorchatdemo.gif)

### **How It Works**

**Traditional approaches:**
- Hardcoded queries lack flexibility and are hard to maintain
- Raw GraphQL generation has high error rates and complex syntax requirements
- Agents struggle with complex schema relationships
- No validation leads to runtime failures
- Monolithic queries require all-or-nothing construction

**QuerySculptor approach:**
- Guided construction with step-by-step query building and validation
- Schema-aware with real-time introspection and type safety
- Error prevention catches issues during construction rather than execution
- Incremental building works well with conversational AI workflows
- MCP standard compatibility with Claude, Cursor, and other MCP clients

Works best with Claude Sonnet models - results may vary with other LLMs.

## 📖 **For AI Agents**

**New to QuerySculptor?**
- 📋 **[Agent System Prompt](./AGENT_SYSTEM_PROMPT.md)** - Complete guide for AI agents
- ⚡ **[Quick Reference](./AGENT_QUICK_REFERENCE.md)** - Essential workflow and tools

## 🎯 **Problem and Solution**

### **Before: Complex GraphQL Generation**
```graphql
# Agent tries to generate this complex query in one go:
query GetUserWithPostsAndComments($userId: ID!, $postLimit: Int = 10) {
  user(id: $userId) {
    id
    name
    email
    posts(first: $postLimit) {
      edges {
        node {
          id
          title
          content
          comments(first: 5) {
            edges {
              node {
                id
                content
                author {
                  name
                }
              }
            }
          }
        }
      }
    }
  }
}
```
**Result:** Syntax errors, wrong types, missing fields, frustrated developers

### **After: QuerySculptor Approach**
```typescript
// Agent builds this incrementally with guided tools:
1. startQuerySession() 
2. introspectSchema()
3. selectField("user") 
4. setTypedArgument("id", userId)
5. selectField("user.name")
6. selectField("user.posts")
7. setTypedArgument("user.posts", "first", 10)
// ... continue building step by step
8. validateQuery() ✅
9. executeQuery() 🎉
```
**Result:** Well-formed queries, reduced syntax errors, built-in validation

## 🌟 **Features**

### **🧠 Schema Introspection**
- Live schema discovery and API understanding
- Type relationship mapping for complex schemas
- Field-level insights showing available fields and requirements

### **🔧 Guided Query Construction**
- 26 tools organized into 7 categories
- Step-by-step building suitable for AI reasoning workflows
- Real-time validation to catch errors before execution
- Fragment support for reusable query components

### **⚡ Architecture**
- Redis-backed sessions for persistent state across interactions
- Rate limiting for API protection
- Vercel deployment ready
- Comprehensive test coverage including agent-like workflow testing
- Session persistence fixes for reliable inline fragment operations

### **🤝 Compatibility**
- MCP Standard - works with Claude Desktop, Cursor, and other MCP clients
- TypeScript native with full type safety

## 📋 **Requirements**

QuerySculptor requires Redis for session management and query state persistence.

**Redis Options:**
- **[Upstash](https://upstash.com/)** - Serverless Redis (recommended for production)
- **Local Redis** - For development (`redis-server`)
- **Docker Redis** - `docker run -d -p 6379:6379 redis:alpine`
- **Any Redis provider** - AWS ElastiCache, Google Cloud Memorystore, etc.

## 🎪 **Demo and Setup**

### **🌍 Public Demo**
**MCP Endpoint:** `https://querysculptor.com/mcp`

The demo is pre-configured to use the [Pokemon API](https://graphql-pokeapi.vercel.app/) for testing QuerySculptor features.

**💬 Query Sculptor Chat Pokemon GraphQL API:** [QuerySculptor Chat](http://querysculptorchat.com) - Chat with Pokemon's GraphQL API powered by QuerySculptor MCP server

### **🎮 Demo: Pokemon API Examples**
*Our demo uses the Pokemon API - here's what you can ask:*

**Discover Pokemon:**
- *"Show me the first 10 Pokemon with their types and sprites"*
- *"Find all Pokemon that are both Fire and Flying type"*
- *"What are the stats for Charizard?"*

**Explore Abilities & Moves:**
- *"List all Pokemon abilities and their effects"*
- *"What moves can Pikachu learn?"*
- *"Show me all Electric-type moves with their power and accuracy"*

**Regional & Species Data:**
- *"List all Pokemon from the Kanto region"*
- *"Show me Pokemon species with their evolution chains"*
- *"What berries are available and what do they do?"*

**Complex Queries:**
- *"Find Pokemon with abilities that boost attack in a pinch"*
- *"Show me all legendary Pokemon with their types and base stats"*
- *"List Pokemon that can learn both Water and Ice moves"*

Add to your Cursor `mcp.json`:
```json
{
  "mcpServers": {
    "graphql-query-builder-demo": {
      "url": "https://querysculptor.com/mcp"
    }
  }
}
```

### **🏃‍♂️ Local Setup**
```bash
# Clone and setup
git clone https://github.com/flinstonedev/querysculptor.git
cd querysculptor
pnpm install

# Configure (copy example.env to .env and customize)
cp example.env .env

# Launch
vercel dev
# 🚀 Your MCP server is live at http://localhost:3000/mcp
```

**To set custom endpoint and bearer token**, edit your `.env` file:
```bash
DEFAULT_GRAPHQL_ENDPOINT=https://your-api.com/graphql
DEFAULT_GRAPHQL_HEADERS={"Authorization": "Bearer your_token"}
```

## 🎯 **Use Cases**

### **🔍 Data Discovery**
*"Agent, find all users who posted in the last week and show their top comments."*

The agent uses QuerySculptor to:
1. Introspect any GraphQL API
2. Build queries targeting users, posts, and comments
3. Execute with proper syntax and structure

### **💬 Natural Language to GraphQL**
Transform chatbots into GraphQL-capable agents:
- **User:** "Show me recent fiction books under $20"
- **Agent:** Uses QuerySculptor tools to query bookstore APIs
- **Result:** Structured data retrieval without manual query writing

### **📊 Automated Reports**
Create agents that generate business insights:
- Sales dashboards from e-commerce APIs
- User engagement from social media APIs  
- Performance metrics from any GraphQL source

### **🛠️ Developer Tools**
- **IDE integration** - AI assistants that help write queries
- **API exploration** - Discover and understand any GraphQL API
- **Query optimization** - AI-suggested performance improvements

### **🏗️ Available Tools**

**26 Tools Across 7 Categories:**

#### **🔍 Schema Intelligence (5 tools)**
- `introspect-schema` - API schema understanding
- `get-root-operation-types` - Entry point discovery
- `get-type-info` - Type analysis
- `get-field-info` - Field-level information
- `get-input-object-help` - Input object guidance

#### **🎯 Session Management (4 tools)**
- `start-query-session` - Session initialization
- `end-query-session` - Resource cleanup
- `get-current-query` - Query visualization
- `get-selections` - Field suggestions

#### **⚡ Field Selection (3 tools)**
- `select-field` - Field targeting
- `select-multiple-fields` - Batch operations
- `select-field-simple` - Simple selections

#### **🧬 Variable Management (3 tools)**
- `set-query-variable` - Variable definition
- `set-variable-value` - Value assignment
- `remove-query-variable` - Variable removal

#### **🎪 Argument Handling (4 tools)**
- `set-string-argument` - String and enum handling
- `set-typed-argument` - Numbers, booleans, complex types
- `set-input-object-argument` - Nested object construction
- `set-variable-argument` - Variable references

#### **🎭 Fragment Support (3 tools)**
- `define-named-fragment` - Reusable query components
- `apply-named-fragment` - Fragment application
- `apply-inline-fragment` - Type-conditional selections

#### **🔮 Directive Support (2 tools)**
- `set-field-directive` - Field-level directives (@include, @skip)
- `set-operation-directive` - Operation-level directives

#### **✅ Validation & Execution (2 tools)**
- `validate-query` - Schema compliance verification
- `execute-query` - Query execution

## 🌍 **Configuration**

### **🤝 Claude Desktop Setup**

QuerySculptor works with Claude Desktop through [mcp-remote](https://github.com/geelen/mcp-remote), which acts as a bridge between Claude Desktop and remote MCP servers.

Edit your configuration file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

**For Remote Demo:**
```json
{
  "mcpServers": {
    "querysculptor": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://querysculptor.com/mcp"
      ]
    }
  }
}
```

**For Local Development:**
```json
{
  "mcpServers": {
    "querysculptor-local": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:3000/mcp",
        "--allow-http"
      ]
    }
  }
}
```

**To set custom endpoint and bearer token**, add `env` to your configuration:
```json
{
  "mcpServers": {
    "querysculptor": {
      "command": "npx",
      "args": ["mcp-remote", "https://your-querysculptor.vercel.app/mcp"],
      "env": {
        "DEFAULT_GRAPHQL_ENDPOINT": "https://your-api.com/graphql",
        "DEFAULT_GRAPHQL_HEADERS": "{\"Authorization\": \"Bearer your_token\"}"
      }
    }
  }
}
```

### **🔍 Troubleshooting**

If you encounter issues:

1. **Clear mcp-remote cache:**
   ```bash
   rm -rf ~/.mcp-auth
   ```

2. **Check logs:**
   - **macOS/Linux**: `tail -n 20 -F ~/Library/Logs/Claude/mcp*.log`
   - **Windows**: `Get-Content "C:\Users\YourUsername\AppData\Local\Claude\Logs\mcp.log" -Wait -Tail 20`

3. **Restart Claude Desktop** completely after config changes

## 🚀 **Deploy Anywhere**

### **⚡ Vercel (Recommended)**

**One-Click Deploy:**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/flinstonedev/querysculptor)

After deployment, configure these environment variables in your Vercel dashboard:
- `REDIS_URL` - your Redis connection string
- `DEFAULT_GRAPHQL_ENDPOINT` - your GraphQL API endpoint (optional)
- `DEFAULT_GRAPHQL_HEADERS` - JSON string with headers for authentication (optional)

**Manual Deploy:**
```bash
# Clone and deploy
git clone https://github.com/flinstonedev/querysculptor.git
cd querysculptor
vercel --prod
```

Configure environment variables in Vercel dashboard.

**To set custom endpoint and bearer token**, add these to your Vercel environment variables:
```
DEFAULT_GRAPHQL_ENDPOINT=https://your-api.com/graphql
DEFAULT_GRAPHQL_HEADERS={"Authorization": "Bearer your_token"}
```

## 🧪 **Testing**

QuerySculptor includes comprehensive testing frameworks:

### **Standard Tests**
```bash
pnpm test            # Run all tests
pnpm test:watch      # Watch mode
pnpm test:coverage   # Coverage report
```

### **Agent-Like Testing**
Test tools exactly as AI agents would use them:
```bash
pnpm test:agent                  # Run all agent workflow tests
pnpm test:agent:basic           # Basic workflow tests
pnpm test:agent:debug           # Debug mode with detailed output
pnpm test:agent:errors          # Error scenario tests
```

The agent testing framework:
- ✅ **Real MCP Protocol**: Tests through actual MCP communication layer
- ✅ **Session Persistence**: Validates Redis-backed session management
- ✅ **Workflow Simulation**: Executes realistic multi-step agent workflows
- ✅ **Error Recovery**: Tests common failure modes and recovery patterns
- ✅ **Debug Utilities**: Detailed analysis and debugging capabilities

### **Enhanced Session Security**
- Session ID validation prevents injection attacks
- Proper whitespace handling and normalization
- Clear error messages for invalid session formats
- Backwards compatible with existing implementations

## 📈 **Roadmap**

- [ ] **Add proper logging** - Structured logging for debugging and monitoring
- [ ] **Query Optimization AI** - Automatic performance improvements  
- [ ] **Visual Query Builder** - Web UI for query construction
- [ ] **Enhanced Agent Testing** - Expand agent workflow test coverage

### **🌟 Community Contributions Welcome**
- **Documentation improvements** - Help others understand the project
- **Tool enhancements** - Add new capabilities
- **Client integrations** - Support more MCP clients
- **Performance optimizations** - Improve performance
- **Agent testing scenarios** - Add more real-world workflow tests
