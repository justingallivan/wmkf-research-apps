/**
 * Cross-user data isolation tests.
 *
 * Two routes, the same post-cutover isolation model: both are now fully
 * Dataverse-backed, so the original Postgres "user_profile_id filter" property
 * no longer exists for either.
 *
 * - /api/reviewer-finder/generate-emails — Dataverse-backed: proposal info is
 *   looked up via the suggestion adapter (`findById`) + `DynamicsService`, and
 *   markAsSent persists through `DynamicsService.updateRecord` on the
 *   request-scoped `wmkf_appreviewersuggestion` record (NOT a per-user Postgres
 *   row). There is no per-user scoping at this layer — suggestions are
 *   request-scoped and any reviewer-finder staff may act on them (same model as
 *   send-emails below). The meaningful property is therefore that the write
 *   targets the Dataverse suggestion by id, with no client-supplied
 *   `user_profile_id` path — which is what we assert. (The stale pre-cutover
 *   assertion — "User B's user_profile_id-filtered query returns no rows" —
 *   was removed: that Postgres path no longer exists, so it asserted nothing.)
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

// send-emails-service.js (S404 send-time token authority gate) imports this,
// which transitively imports `jose` (ESM-only, not Jest-transformable). Stub
// it so the module import doesn't pull in jose; this isolation test's drafts
// never carry a real reviewer JWT, so the gate is not exercised here.
jest.mock('../../lib/external/verify-suggestion-token', () => ({
  verifySuggestionToken: jest.fn(async () => ({ ok: false, reason: 'not_found' })),
}));

// ---------------------------------------------------------------------------
const USER_A_PROFILE = 1;
const USER_B_PROFILE = 2;
// generate-emails / send-emails GUID-validate each candidate suggestionId before
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

// ---------------------------------------------------------------------------
// /api/reviewer-finder/generate-emails — cross-user isolation
// ---------------------------------------------------------------------------
describe('/api/reviewer-finder/generate-emails cross-user isolation', () => {
  let handler;
  // Dataverse-layer spies. The route reads/writes Dataverse, not Postgres, so the
  // isolation property is asserted on these — not on a (now non-existent) sql path.
  // resetModules + doMock gives this block its OWN dynamics-service mock shape,
  // distinct from the send-emails block above (which doMocks a different shape).
  let findById;
  let getRecord;
  let updateRecord;

  beforeAll(async () => {
    jest.resetModules();
    // resetModules drops the top-level mocks for this block's re-import, so
    // re-establish the baseConfig no-op (the route calls loadModelOverrides at
    // entry — without this it runs the real model resolver and logs noise).
    jest.doMock('../../shared/config/baseConfig', () => ({
      BASE_CONFIG: { ERROR_MESSAGES: {} },
      getModelForApp: jest.fn(() => 'claude-sonnet-4-20250514'),
      getFallbackModelForApp: jest.fn(() => 'claude-haiku-4-5-20251001'),
      loadModelOverrides: jest.fn(() => Promise.resolve()),
      _setModelResolver: jest.fn(),
      _setOverridesCache: jest.fn(),
      _shouldReloadOverrides: jest.fn(() => false),
      clearModelOverridesCache: jest.fn(),
    }));
    findById = jest.fn(async () => ({
      wmkf_appreviewersuggestionid: SUGGESTION_OWNED_BY_A,
      _wmkf_request_value: REQUEST_OWNED_BY_A,
    }));
    getRecord = jest.fn(async () => ({ akoya_requestid: REQUEST_OWNED_BY_A, akoya_title: 'Proposal A' }));
    updateRecord = jest.fn(async () => {});
    jest.doMock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
      findById: (...a) => findById(...a),
      // patchFields is a thin DynamicsService.updateRecord passthrough
      // (data-access-layer conversion, Stages 3-6) — forward through the
      // ALSO-mocked updateRecord below so the existing assertion on it holds.
      patchFields: (id, payload, opts = {}) => updateRecord('wmkf_appreviewersuggestions', id, payload, opts),
    }));
    jest.doMock('../../lib/services/dynamics-service', () => ({
      DynamicsService: {
        getRecord: (...a) => getRecord(...a),
        queryRecords: jest.fn(async () => ({ records: [] })),
        updateRecord: (...a) => updateRecord(...a),
      },
    }));
    const mod = await import('../../pages/api/reviewer-finder/generate-emails');
    handler = mod.default;
  });

  afterAll(() => {
    jest.resetModules();
  });

  it('markAsSent writes to the request-scoped Dataverse suggestion by id — no per-user (user_profile_id) path', async () => {
    // User B (NOT the suggestion's "owner") drives the route. Post-cutover there
    // is no per-user scoping: the suggestion is request-scoped and the write goes
    // straight to the Dataverse record by id (staff-shared model). The isolation
    // property we assert is that the persistence is the Dataverse updateRecord
    // keyed only by suggestionId — there is no client-supplied user_profile_id
    // filter to spoof. (The old Postgres user_profile_id assertion was removed:
    // that path no longer exists, so it asserted nothing.)
    mockAuthenticatedUser(USER_B_PROFILE, ['reviewer-finder']);

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

    const writeCalls = res.write.mock.calls.map(c => c[0]).join('');
    expect(writeCalls).toContain('result');

    // The durable side effect is a Dataverse write on the request-scoped record,
    // keyed only by suggestionId — proving there is no per-user Postgres path.
    expect(updateRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions',
      SUGGESTION_OWNED_BY_A,
      { wmkf_emailsentat: expect.any(String), wmkf_invited: true },
      {},
    );
  });
});
