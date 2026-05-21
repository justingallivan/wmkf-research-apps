// Jest DOM setup
import '@testing-library/jest-dom'

// Mock Next.js router
jest.mock('next/router', () => ({
  useRouter() {
    return {
      route: '/',
      pathname: '/',
      query: '',
      asPath: '/',
      push: jest.fn(),
      pop: jest.fn(),
      reload: jest.fn(),
      back: jest.fn(),
      prefetch: jest.fn(),
      beforePopState: jest.fn(),
      events: {
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
      },
    }
  },
}))

// Mock Next.js Head component
jest.mock('next/head', () => {
  return function Head({ children }) {
    return children
  }
})

// Mock environment variables for testing
process.env.NODE_ENV = 'test'
process.env.CLAUDE_API_KEY = 'test-claude-api-key'
process.env.API_SECRET_KEY = 'test-secret-key'

// Default mock for the app-access service. Wave 1 closeout (2026-05-12)
// moved listAppKeysForUser from Postgres to a Dataverse-by-default dispatch
// wrapper; without this default, any test that lets a requireAppAccess-
// guarded handler run will trigger a real Dataverse call, fail on missing
// env, and short-circuit the handler before its own mocks are reached.
// Tests that need non-empty app grants (auth-mock helper, custom per-test
// setups) re-mock this module — their jest.mock calls override this default.
jest.mock('./lib/services/app-access-service', () => ({
  listAppKeysForUser: jest.fn(() => Promise.resolve([])),
  listAllGrantsForAdmin: jest.fn(() => Promise.resolve([])),
  grantApps: jest.fn(() => Promise.resolve({ granted: [] })),
  revokeApps: jest.fn(() => Promise.resolve({ revoked: [] })),
}))

// Global test utilities
global.fetch = jest.fn()

// Mock fetch responses
beforeEach(() => {
  fetch.mockClear()
})

// Suppress console.warn in tests unless explicitly testing for warnings
const originalWarn = console.warn
beforeAll(() => {
  console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('Warning: ')) {
      return
    }
    originalWarn.call(console, ...args)
  }
})

afterAll(() => {
  console.warn = originalWarn
})

// Mock file API for testing file uploads (jsdom only — node-env tests opt out)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'File', {
    value: class File {
      constructor(fileParts, fileName, options) {
        this.parts = fileParts
        this.name = fileName
        this.type = options?.type || 'text/plain'
        this.size = fileParts.reduce((acc, part) => acc + part.length, 0)
        this.lastModified = Date.now()
      }
    },
    writable: true,
  })

  // Mock FileReader
  Object.defineProperty(window, 'FileReader', {
    value: class FileReader {
      readAsDataURL = jest.fn(() => {
        setTimeout(() => {
          this.result = 'data:text/plain;base64,dGVzdA=='
          this.onload?.()
        }, 0)
      })
      readAsText = jest.fn(() => {
        setTimeout(() => {
          this.result = 'test content'
          this.onload?.()
        }, 0)
      })
    },
    writable: true,
  })
}

// Mock crypto for API key encryption testing
Object.defineProperty(global, 'crypto', {
  value: {
    randomBytes: jest.fn(() => Buffer.from('test-random-bytes')),
    createCipheriv: jest.fn(() => ({
      update: jest.fn(() => 'encrypted'),
      final: jest.fn(() => 'final'),
      getAuthTag: jest.fn(() => Buffer.from('auth-tag')),
    })),
    createDecipheriv: jest.fn(() => ({
      setAuthTag: jest.fn(),
      update: jest.fn(() => 'decrypted'),
      final: jest.fn(() => 'final'),
    })),
    createHash: jest.fn(() => ({
      update: jest.fn(() => ({ digest: jest.fn(() => 'hashed') })),
    })),
    scryptSync: jest.fn(() => Buffer.from('derived-key')),
  },
  writable: true,
})