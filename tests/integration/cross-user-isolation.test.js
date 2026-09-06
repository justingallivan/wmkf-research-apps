/**
 * Cross-user data isolation tests.
 *
 * One route (post-cutover isolation model, fully Dataverse-backed, so the
 * original Postgres "user_profile_id filter" property no longer exists).
 * The generate-emails block that used to sit alongside it was removed with
 * that route on 2026-09-06 (owner decision D2).
 *
 * - /api/review-manager/send-emails — fully Dataverse-backed since Session 118.
 *   Reviewer data is fetched via the suggestion adapter (`findById`), which
 *   does not filter by user_profile_id (Dataverse has no per-user scoping for
 *   suggestions — they're scoped to a request, and any review-manager user
 *   can fetch any suggestion). The cross-user isolation property has shifted
 *   from "User B's query returns no rows" to "the sender identity is taken
 *   from the session, not from request body" — i.e. User B cannot send mail
 *   *as* User A even if they hold a User A suggestion ID. We assert that the
 *   route rejects the send when the session lacks an azureEmail (which is
 *   how an unverified sender would manifest).
 */

import {
  mockAuthenticatedUser,
  createMockReq,
  createMockRes,
  clearAppAccessCache,
} from '../helpers/auth-mock';

import { sql } from '@vercel/postgres';

// ---------------------------------------------------------------------------
// Global mocks (same as auth-routes.test.js)
// ---------------------------------------------------------------------------
jest.mock('../../shared/api/middleware/rateLimiter', () => ({
  nextRateLimiter: () => jest.fn(() => Promise.resolve(true)),
}));

jest.mock('@vercel/blob', () => ({
  put: jest.fn(),
  del: jest.fn(),
}));

jest.mock('../../lib/utils/usage-logger', () => ({
  logUsage: jest.fn(),
  estimateCostCents: jest.fn(() => 0),
}));

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
  _setModelResolver: jest.fn(),
  _setOverridesCache: jest.fn(),
  _shouldReloadOverrides: jest.fn(() => false),
  clearModelOverridesCache: jest.fn(),
}));

jest.mock('../../lib/utils/email-generator', () => ({
  generateEmlContent: jest.fn(() => 'eml-content'),
  generateEmlContentWithAttachments: jest.fn(() => 'eml-content'),
  replacePlaceholders: jest.fn((tpl) => tpl),
  buildTemplateData: jest.fn(() => ({})),
  createFilename: jest.fn((name) => `${name}.eml`),
}));


jest.mock('../../lib/utils/safe-fetch', () => ({
  safeFetch: jest.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })),
  isAllowedUrl: jest.fn(() => true),
}));

// send-emails-service.js (S404 send-time token authority gate) imports these,
// which transitively import `jose` (ESM-only, not Jest-transformable). Stub
// them so the module import doesn't pull in jose; this isolation test's drafts
// never carry a real reviewer JWT, so the gate is not exercised here.
jest.mock('../../lib/external/verify-suggestion-token', () => ({
  verifySuggestionToken: jest.fn(async () => ({ ok: false, reason: 'not_found' })),
}));
jest.mock('../../lib/external/token-lifecycle', () => ({
  mintAndStore: jest.fn(),
  SEND_TIME_TOKEN_PLACEHOLDER_JWT: 'send_time_token.pending_authority.not_live',
}));

// ---------------------------------------------------------------------------
const USER_A_PROFILE = 1;
const USER_B_PROFILE = 2;
// send-emails GUID-validates each candidate suggestionId before
// it reaches a record-id selector (S259 trust-boundary hardening), so this must
// be GUID-shaped or the route 400s before the isolation logic under test runs.
const SUGGESTION_OWNED_BY_A = '33333333-3333-4333-8333-333333333333';
const REQUEST_OWNED_BY_A = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  clearAppAccessCache();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// /api/review-manager/send-emails — cross-user isolation
// ---------------------------------------------------------------------------
describe('/api/review-manager/send-emails cross-user isolation', () => {
  let handler;

  beforeAll(async () => {
    // The Dataverse-backed handler imports DynamicsService at module load
    // and invokes its static methods inside a real `bypassDynamicsRestrictions`
    // ALS scope. We only need to mock the static methods the handler actually
    // calls; the ALS wrapper runs unmocked.
    jest.doMock('../../lib/services/dynamics-service', () => ({
      DynamicsService: {
        executeQuery: jest.fn(() => Promise.resolve({ value: [] })),
        getRecord: jest.fn(() => Promise.resolve(null)),
      },
    }));
    const mod = await import('../../pages/api/review-manager/send-emails');
    handler = mod.default;
  });

  it('rejects send when session has no azureEmail (sender identity must come from session)', async () => {
    // Mock User B with review-manager access but no azureEmail in the session —
    // this is the auth-layer property that replaces the old Postgres-filter
    // isolation: sender identity is derived from session, not request body.
    mockAuthenticatedUser(USER_B_PROFILE, ['review-manager'], { azureEmail: null });

    const req = createMockReq({
      method: 'POST',
      body: {
        drafts: [{
          suggestionId: SUGGESTION_OWNED_BY_A,
          subject: 'Test',
          body: 'Test body',
        }],
        templateType: 'materials',
      },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._data).toMatchObject({
      error: expect.stringMatching(/sender email/i),
    });
  });
});
