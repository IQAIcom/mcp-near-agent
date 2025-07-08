import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        include: ['**/*.test.ts'],
        exclude: ['node_modules'],
        environment: 'node',
        coverage: {
            provider: 'istanbul',
        },
        deps: {
            interopDefault: true,
        },
    },
})
