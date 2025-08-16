# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Development:**
```bash
pnpm install          # Install dependencies
pnpm dev             # Start development server with hot reload
pnpm start           # Start production server
```

**Testing:**
```bash
pnpm test            # Run all tests
pnpm test:watch      # Run tests in watch mode
pnpm test:ui         # Run tests with UI
pnpm test:coverage   # Generate coverage report
```

**Running specific tests:**
```bash
pnpm test path/to/test.test.ts  # Run a specific test file
```

## Architecture

QuerySculptor is an MCP (Model Context Protocol) server that provides tools for AI agents to build GraphQL queries programmatically. The architecture consists of:

**Core Components:**
- **MCP Server** (`api/server.ts`): Vercel-hosted server that registers all tools with rate limiting
- **Redis Sessions**: Stores query building state between tool calls
- **Tool System**: 26 tools organized into 8 categories, each handling specific GraphQL operations

**Tool Categories:**
1. **Schema Intelligence** (5 tools): Introspection and type discovery
2. **Session Management** (4 tools): Query state lifecycle
3. **Field Selection** (2 tools): Building query selections
4. **Variable Management** (3 tools): GraphQL variables
5. **Argument Handling** (4 tools): Field arguments
6. **Fragment Support** (3 tools): Query fragments
7. **Directive Support** (2 tools): GraphQL directives
8. **Validation & Execution** (3 tools): Query validation and execution

**Key Design Patterns:**
- Each tool is a separate module in `tools/` with consistent structure
- Tools communicate through Redis-backed session state
- Rate limiting is applied at the middleware level
- All tools validate against the introspected GraphQL schema
- Query building is incremental and stateful

**Session Flow:**
1. Start session → Introspect schema → Build query incrementally → Validate → Execute
2. Session state includes: query structure, variables, fragments, and schema cache

**Error Handling:**
- Tools return structured error responses
- Schema validation happens before execution
- Rate limiting prevents abuse

**Testing Strategy:**
- Extensive test coverage with Vitest
- Unit tests for individual tools
- Integration tests for complete workflows
- Test helpers for mocking GraphQL schemas

**Deployment & Configuration:**
- Vercel deployment with `vercel.json` configuration
- Environment-based configuration via `.env` file
- Rate limiting with Redis backend (required)
- Security headers and CORS configuration for MCP endpoint

**Important Files:**
- `api/server.ts`: Main MCP server entry point
- `tools/index.ts`: Tool registration and catalog
- `tools/shared-utils.ts`: Common utilities and Redis session management
- `vercel.json`: Deployment configuration and routing
- `vitest.config.ts`: Test configuration with proper GraphQL module resolution