const nextJest = require('next/jest')

// Reuse next/jest's SWC transform so the ESM sources under lib/services
// (e.g. `import { sql } from '@vercel/postgres'`) compile the same way they
// do for the main jest.config.js suite. This project is otherwise entirely
// separate: own testEnvironment, own testMatch, own globalSetup, and it
// must never be picked up by `npm test` (see jest.config.js
// testPathIgnorePatterns — tests/pg-contract/ must be added there).
const createJestConfig = nextJest({
  dir: './',
})

const customJestConfig = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/pg-contract/**/*.test.js'],
  globalSetup: '<rootDir>/tests/pg-contract/support/global-setup.js',
  moduleNameMapper: {
    // See tests/pg-contract/support/vercel-postgres-pg-shim.js: the real
    // @vercel/postgres is Neon's WebSocket driver and cannot reach a plain
    // container Postgres. This lane routes through pg instead.
    '^@vercel/postgres$': '<rootDir>/tests/pg-contract/support/vercel-postgres-pg-shim.js',
  },
  verbose: true,
}

module.exports = createJestConfig(customJestConfig)
