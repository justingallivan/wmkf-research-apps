/**
 * Route-level authorization regression tests.
 *
 * For a representative set of API routes, verify that:
 * 1. Unauthenticated requests → 401
 * 2. Authenticated without required app → 403
 * 3. Authenticated with correct app → does NOT return 401/403
 *
 * Routes are imported directly; all external dependencies (DB, Claude, Blob,
 * Dynamics, rate limiter) are mocked at the module level so we only exercise
 * the auth gating logic.
 */

import {
  mockUnauthenticated,
  mockAuthenticatedUser,
  createMockReq,
  createMockRes,
  clearAppAccessCache,
} from '../helpers/auth-mock';

// ---------------------------------------------------------------------------
// Global mocks for dependencies used across many routes
// ---------------------------------------------------------------------------

// Rate limiter — always allow through
jest.mock('../../shared/api/middleware/rateLimiter', () => ({
  nextRateLimiter: () => jest.fn(() => Promise.resolve(true)),
}));

// Vercel Blob
jest.mock('@vercel/blob', () => ({
  put: jest.fn(() => Promise.resolve({ url: 'https://test.public.blob.vercel-storage.com/test.pdf' })),
  del: jest.fn(),
}));

// Usage logger
jest.mock('../../lib/utils/usage-logger', () => ({
  logUsage: jest.fn(),
  estimateCostCents: jest.fn(() => 0),
}));

// Base config
jest.mock('../../shared/config/baseConfig', () => ({
  BASE_CONFIG: {
    ERROR_MESSAGES: {
      PROCESSING_FAILED: 'Processing failed',
      EMAIL_GENERATION_FAILED: 'Email generation failed',
      DATABASE_ERROR: 'Database error',
    },
  },
  getModelForApp: jest.fn(() => 'claude-sonnet-4-20250514'),
  getFallbackModelForApp: jest.fn(() => 'claude-haiku-4-5-20251001'),
  loadModelOverrides: jest.fn(() => Promise.resolve()),
  _shouldReloadOverrides: jest.fn(() => false),
  _setOverridesCache: jest.fn(),
  clearModelOverridesCache: jest.fn(),
}));

jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: jest.fn(() => Promise.resolve()),
  clearModelOverridesCache: jest.fn(),
}));

// Email generator
jest.mock('../../lib/utils/email-generator', () => ({
  generateEmlContent: jest.fn(() => 'eml-content'),
  generateEmlContentWithAttachments: jest.fn(() => 'eml-content'),
  replacePlaceholders: jest.fn((tpl) => tpl),
  buildTemplateData: jest.fn(() => ({})),
  createFilename: jest.fn(() => 'test.eml'),
}));

// Email personalization prompt
jest.mock('../../shared/config/prompts/email-reviewer', () => ({
  createPersonalizationPrompt: jest.fn(() => 'test prompt'),
}));

// Safe fetch
jest.mock('../../lib/utils/safe-fetch', () => ({
  safeFetch: jest.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })),
  isAllowedUrl: jest.fn(() => true),
}));

// Database service
jest.mock('../../lib/services/database-service', () => ({
  DatabaseService: jest.fn().mockImplementation(() => ({
    getProfiles: jest.fn(() => Promise.resolve([])),
  })),
}));

// Dynamics service — routes scope their Dataverse calls inside an ALS context
// from `lib/services/dynamics-context.js` (most via `bypassDynamicsRestrictions`;
// `/api/dynamics-explorer/chat` uses `withDynamicsContext` to thread per-user
// restrictions). The ALS wrapper runs unmocked; inside the scope the routes
// call the static methods below on DynamicsService, which we mock.
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    executeQuery: jest.fn(() => Promise.resolve({ value: [] })),
    resolveLogicalName: jest.fn((name) => name),
    checkRestriction: jest.fn(),
  },
}));

// Graph service
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: jest.fn().mockImplementation(() => ({})),
}));

// Dynamics explorer prompts
jest.mock('../../shared/config/prompts/dynamics-explorer', () => ({
  buildSystemPrompt: jest.fn(() => 'system prompt'),
  TOOL_DEFINITIONS: [],
  TABLE_ANNOTATIONS: {},
}));

jest.mock('../../lib/services/dynamics-explorer-taxonomy', () => ({
  buildResolvedTaxonomyPromptBlock: jest.fn(() => Promise.resolve('resolved taxonomy')),
}));

// ExcelJS
jest.mock('exceljs', () => ({}));

// App registry
jest.mock('../../shared/config/appRegistry', () => ({
  ALL_APP_KEYS: ['reviewer-finder', 'review-manager', 'reviewers', 'dynamics-explorer', 'integrity-screener'],
  // requireAppAccess names the guarded app in its 403/503 messages via
  // APP_REGISTRY (legacy keys reviewer-finder/review-manager stay absent,
  // mirroring the real registry).
  APP_REGISTRY: [
    { key: 'reviewers', name: 'Reviewers' },
    { key: 'dynamics-explorer', name: 'Dynamics Explorer' },
    { key: 'integrity-screener', name: 'Applicant Integrity Screener' },
  ],
}));

// Integrity screener dependencies
jest.mock('../../lib/services/integrity-service', () => ({
  IntegrityService: jest.fn().mockImplementation(() => ({})),
}));

// ---------------------------------------------------------------------------
beforeEach(() => {
  clearAppAccessCache();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Test matrix: [description, importPath, appKey, method, body?]
// ---------------------------------------------------------------------------
const routeSpecs = [
  {
    name: '/api/reviewer-finder/analyze',
    importPath: '../../pages/api/reviewer-finder/analyze',
    appKey: 'reviewer-finder',
    method: 'POST',
    body: { text: 'test proposal' },
  },
  {
    name: '/api/reviewer-finder/generate-emails',
    importPath: '../../pages/api/reviewer-finder/generate-emails',
    appKey: 'reviewer-finder',
    method: 'POST',
    body: { candidates: [], template: { subject: 's', body: 'b' }, settings: { senderEmail: 'a@b.com' } },
  },
  {
    name: '/api/review-manager/send-emails',
    importPath: '../../pages/api/review-manager/send-emails',
    appKey: 'review-manager',
    method: 'POST',
    body: { suggestionIds: [1], template: { subject: 's', body: 'b' } },
  },
  {
    name: '/api/review-manager/reviewers',
    importPath: '../../pages/api/review-manager/reviewers',
    appKey: 'review-manager',
    method: 'GET',
  },
  {
    name: '/api/dynamics-explorer/chat',
    importPath: '../../pages/api/dynamics-explorer/chat',
    appKey: 'dynamics-explorer',
    method: 'POST',
    body: { messages: [{ role: 'user', content: 'hello' }] },
  },
  {
    name: '/api/integrity-screener/screen',
    importPath: '../../pages/api/integrity-screener/screen',
    appKey: 'integrity-screener',
    method: 'POST',
    body: { applicants: [] },
  },
];

describe.each(routeSpecs)('$name', ({ importPath, appKey, method, body }) => {
  let handler;

  beforeAll(async () => {
    const mod = await import(importPath);
    handler = mod.default;
  });

  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticated();
    const req = createMockReq({ method, body });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 403 when user lacks the required app', async () => {
    // Grant a different app
    const wrongApp = appKey === 'dynamics-explorer' ? 'reviewer-finder' : 'dynamics-explorer';
    mockAuthenticatedUser(1, [wrongApp]);

    const req = createMockReq({ method, body });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('does NOT return 401/403 when user has the correct app', async () => {
    mockAuthenticatedUser(1, [appKey]);
    const req = createMockReq({ method, body });
    const res = createMockRes();

    await handler(req, res);

    // The handler may return other status codes (e.g. 400 for missing body fields)
    // but should NOT return 401 or 403
    if (res.status.mock.calls.length > 0) {
      const code = res.status.mock.calls[0][0];
      expect(code).not.toBe(401);
      expect(code).not.toBe(403);
    }
  });
});

// ---------------------------------------------------------------------------
// Request Workbench: the additive `reviewers` grant must reach BOTH legacy
// route families (reviewer-finder + review-manager) via the variadic
// requireAppAccess(..., 'reviewers') second key. A user with ONLY the
// `reviewers` grant (no legacy key) should not be bounced with 401/403.
// ---------------------------------------------------------------------------
describe.each([
  { name: '/api/reviewer-finder/my-proposals', importPath: '../../pages/api/reviewer-finder/my-proposals', method: 'GET' },
  { name: '/api/review-manager/reviewers', importPath: '../../pages/api/review-manager/reviewers', method: 'GET' },
])('reviewers-only grant reaches $name', ({ importPath, method }) => {
  let handler;
  beforeAll(async () => {
    const mod = await import(importPath);
    handler = mod.default;
  });

  it('does NOT return 401/403 for a reviewers-only grant', async () => {
    mockAuthenticatedUser(1, ['reviewers']);
    const req = createMockReq({ method });
    const res = createMockRes();

    await handler(req, res);

    if (res.status.mock.calls.length > 0) {
      const code = res.status.mock.calls[0][0];
      expect(code).not.toBe(401);
      expect(code).not.toBe(403);
    }
  });

  it('still returns 403 for an unrelated grant', async () => {
    mockAuthenticatedUser(1, ['dynamics-explorer']);
    const req = createMockReq({ method });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ---------------------------------------------------------------------------
// Admin route: /api/admin/stats (superuser only)
// ---------------------------------------------------------------------------
describe('/api/admin/stats', () => {
  let handler;

  beforeAll(async () => {
    const mod = await import('../../pages/api/admin/stats');
    handler = mod.default;
  });

  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticated();
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 403 for non-superuser', async () => {
    mockAuthenticatedUser(1, ['dynamics-explorer']);
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ---------------------------------------------------------------------------
// /api/app-access (POST = superuser only)
// ---------------------------------------------------------------------------
describe('/api/app-access POST', () => {
  let handler;

  beforeAll(async () => {
    const mod = await import('../../pages/api/app-access');
    handler = mod.default;
  });

  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticated();
    const req = createMockReq({ method: 'POST', body: { userId: 1, apps: ['reviewer-finder'] } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ---------------------------------------------------------------------------
// /api/user-profiles (profile-scoped)
// ---------------------------------------------------------------------------
describe('/api/user-profiles', () => {
  let handler;

  beforeAll(async () => {
    const mod = await import('../../pages/api/user-profiles');
    handler = mod.default;
  });

  it('returns 401 when unauthenticated (GET)', async () => {
    mockUnauthenticated();
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when unauthenticated (PATCH)', async () => {
    mockUnauthenticated();
    const req = createMockReq({ method: 'PATCH', body: { name: 'new name' } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 405 for authenticated POST because standalone profile creation is disabled', async () => {
    mockAuthenticatedUser(1, []);
    const req = createMockReq({ method: 'POST', body: { name: 'New Profile' } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
  });
});
