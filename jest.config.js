const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files
  dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  testPathIgnorePatterns: [
    '<rootDir>/.next/',
    '<rootDir>/.next.nosync/',
    '<rootDir>/node_modules/',
    '<rootDir>/node_modules.nosync/',
    '<rootDir>/tests/e2e/' // E2E tests handled separately
  ],
  // iCloud-exclusion artifacts (*.nosync). Without this, Jest's haste map
  // scans node_modules.nosync/ and aborts on duplicate package names.
  modulePathIgnorePatterns: [
    '<rootDir>/node_modules\\.nosync/',
    '<rootDir>/\\.next\\.nosync/',
  ],
  collectCoverageFrom: [
    'shared/**/*.{js,jsx}',
    'pages/**/*.{js,jsx}',
    '!pages/_app.js',
    '!pages/_document.js',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  // Coverage thresholds disabled until test coverage reaches target levels.
  // Re-enable when global ≥ 70% and shared/ ≥ 80%.
  // coverageThreshold: {
  //   global: { branches: 70, functions: 70, lines: 70, statements: 70 },
  //   'shared/': { branches: 80, functions: 80, lines: 80, statements: 80 },
  // },
  moduleNameMapper: {
    // Handle module aliases
    '^@/(.*)$': '<rootDir>/$1',
    '^@shared/(.*)$': '<rootDir>/shared/$1',
    '^@pages/(.*)$': '<rootDir>/pages/$1',
  },
  testMatch: [
    '<rootDir>/tests/**/*.(test|spec).{js,jsx}',
    '<rootDir>/shared/**/__tests__/**/*.(test|spec).{js,jsx}',
    '<rootDir>/pages/**/__tests__/**/*.(test|spec).{js,jsx}',
  ],
  verbose: true,
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig)