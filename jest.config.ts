import type { Config } from 'jest'

const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
        // This mapping is crucial for handling your ABI and env imports correctly with mocks
        // '^@/(.*)$': '<rootDir>/src/$1', // Adjust if your source files are in a different dir
        '^../services/auth-manager.js$':
            '<rootDir>/src/services/auth-manager.ts', // Use .ts or .js for mock
        '^../services/event-listener.js$':
            '<rootDir>/src/services/event-listener.ts', // Use .ts or .js for mock

        '^../env.js$': '<rootDir>/src/env.ts', // Use .ts or .js for mock
    },
    // If your source code is in 'src'
    roots: ['<rootDir>/src'],
    testMatch: ['<rootDir>/src/**/*.test.ts'],
    // globals: {
    //     'ts-jest': {
    //         tsconfig: 'tsconfig.json',
    //         // It's good practice to set `isolatedModules: true` here too
    //         // if you add it to tsconfig.json. This helps ts-jest compile faster.
    //         isolatedModules: true,
    //     },
    // },
    // moduleNameMapper: {
    //     '^(\\.{1,2}/.*)\\.js$': '$1.ts', // Only maps local .js → .ts
    // },
    // transformIgnorePatterns: ['/node_modules/'],
}

export default config
