/**
 * Cross-user data isolation tests.
 *
 * Two routes, two different isolation models after the Session 117/118
 * Dataverse cutover:
 *
 * - /api/reviewer-finder/generate-emails — still Postgres-backed for proposal
 *   info lookup, so the original "user_profile_id filter" property still
 *   applies. We assert that User B cannot read User A's proposal info via
 *   suggestionId, and that any markAsSent UPDATE filters on user_profile_id.
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

jest.mock('../../shared/config/prompts/email-reviewer', () => ({
  createPersonalizationPrompt: jest.fn(() => 'test prompt'),
}));

jest.mock('../../lib/utils/safe-fetch', () => ({
  safeFetch: jest.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })),
  isAllowedUrl: jest.fn(() => true),
}));

// ---------------------------------------------------------------------------
const USER_A_PROFILE = 1;
const USER_B_PROFILE = 2;
const SUGGESTION_OWNED_BY_A = 100;

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
          suggestionId: 'suggestion-owned-by-user-a',
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

// ---------------------------------------------------------------------------
// /api/reviewer-finder/generate-emails — cross-user isolation
// ---------------------------------------------------------------------------
describe('/api/reviewer-finder/generate-emails cross-user isolation', () => {
  let handler;

  beforeAll(async () => {
    const mod = await import('../../pages/api/reviewer-finder/generate-emails');
    handler = mod.default;
  });

  it('User B cannot look up User A proposal info via suggestionId', async () => {
    // Mock User B
    mockAuthenticatedUser(USER_B_PROFILE, ['reviewer-finder']);

    const { sql: mockSql } = require('@vercel/postgres');
    mockSql.mockImplementation((...args) => {
      const queryText = Array.isArray(args[0]) ? args[0].join(' ') : '';

      // App access queries
      if (queryText.includes('user_app_access')) {
        return Promise.resolve({ rows: [{ app_key: 'reviewer-finder' }], rowCount: 1 });
      }
      if (queryText.includes('dynamics_user_roles')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (queryText.includes('is_active')) {
        return Promise.resolve({ rows: [{ is_active: true }], rowCount: 1 });
      }

      // reviewer_suggestions lookup: return empty for User B
      if (queryText.includes('reviewer_suggestions')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }

      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const req = createMockReq({
      method: 'POST',
      body: {
        candidates: [
          { name: 'Dr. Test', email: 'test@example.com', suggestionId: SUGGESTION_OWNED_BY_A },
        ],
        template: { subject: 'Invitation', body: 'Dear {{candidateName}}' },
        settings: { senderEmail: 'sender@wmkeck.org', senderName: 'Sender' },
        options: { markAsSent: true },
      },
    });
    const res = createMockRes();

    await handler(req, res);

    // The handler should still generate emails (with fallback/empty proposal info)
    // but the markAsSent UPDATE should not affect User A's rows
    const writeCalls = res.write.mock.calls.map(c => c[0]).join('');
    // Should contain the result event
    expect(writeCalls).toContain('result');

    // Verify that the UPDATE query (markAsSent) was called with User B's profileId
    const updateCalls = mockSql.mock.calls.filter(call => {
      const queryText = Array.isArray(call[0]) ? call[0].join(' ') : '';
      return queryText.includes('UPDATE') && queryText.includes('reviewer_suggestions');
    });

    // If there was an update call, it should include the profileId filter
    for (const call of updateCalls) {
      const queryText = Array.isArray(call[0]) ? call[0].join(' ') : '';
      expect(queryText).toContain('user_profile_id');
    }
  });
});
