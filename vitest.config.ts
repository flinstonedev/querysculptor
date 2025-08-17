import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['tests/core/setup.ts'],
        include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
        exclude: [
            '**/node_modules/**', 
            '**/dist/**',
            // Exclude agent tests by default - they require Redis and should be run explicitly
            process.env.USE_REAL_REDIS !== 'true' ? 'tests/agent-testing/**' : ''
        ].filter(Boolean),
        testTimeout: 10000,
        hookTimeout: 10000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/',
                'tests/',
                'api/server.ts',
                '**/*.d.ts',
                'vite.config.ts',
                'vitest.config.ts'
            ]
        },
        // Ensure proper test isolation
        pool: 'forks',
        isolate: true
    },
    esbuild: {
        target: 'node18'
    },
    resolve: {
        alias: {
            '@': '.',
            // Ensure consistent GraphQL module resolution
            'graphql': 'graphql'
        },
        // Dedupe GraphQL to prevent conflicts
        dedupe: ['graphql']
    }
}) 