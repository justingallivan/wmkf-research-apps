/**
 * Auth mocking helpers for API route tests.
 *
 * Provides presets that mock `getServerSession` (from next-auth)
 * and the `sql` tagged-template query (from @vercel/postgres) so that
 * `requireAuth`, `requireAuthWithProfile`, and `requireAppAccess`
 * behave predictably without a real database or Azure AD session.
 */

// Re-usable mock references — set by the presets below
let _mockSession = null;
let _mockSqlResults = {};
let _mockAppKeys = [];

/**
 * Mock `getServerSession` to return whatever _mockSession holds.
 */
jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(() => Promise.resolve(_mockSession)),
}));

/**
 * Mock `@vercel/postgres` so `sql` returns preset rows.
 *
 * Keys in _mockSqlResults are matched against the first raw-string
 * fragment of the tagged template (e.g. a query containing "user_app_access"
 * will match the 'user_app_access' key).
 */
jest.mock('@vercel/postgres', () => ({
  sql: jest.fn((...args) => {
    // Tagged template: args[0] is the array of string fragments
    const queryText = Array.isArray(args[0]) ? args[0].join(' ') : '';

    // Match against known table names
    for (const [key, result] of Object.entries(_mockSqlResults)) {
      if (queryText.toLowerCase().includes(key.toLowerCase())) {
        if (result instanceof Error) {
          return Promise.reject(result);
        }
        return Promise.resolve(result);
      }
    }
    // Default: empty result set
    return Promise.resolve({ rows: [], rowCount: 0 });
  }),
}));

/**
 * Mock the NextAuth options import (auth.js imports from pages/api/auth/[...nextauth]).
 */
jest.mock('../../pages/api/auth/[...nextauth]', () => ({
  authOptions: {},
}));

/**
 * Mock the app-access-service wrapper. Wave 1 closeout (2026-05-12) moved
 * `listAppKeysForUser` from Postgres to a Dataverse-by-default dispatch;
 * the old `_mockSqlResults.user_app_access` no longer intercepts the read
 * path. Mock the wrapper directly so test app-key grants stay declarative.
 *
 * Other wrapper methods are mocked as no-ops — tests that need
 * listAllGrantsForAdmin / grantApps / revokeApps should set them per-test.
 */
jest.mock('../../lib/services/app-access-service', () => ({
  listAppKeysForUser: jest.fn(() => Promise.resolve(_mockAppKeys)),
  listAllGrantsForAdmin: jest.fn(() => Promise.resolve([])),
  grantApps: jest.fn(() => Promise.resolve({ granted: [] })),
  revokeApps: jest.fn(() => Promise.resolve({ revoked: [] })),
}));

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Simulate an unauthenticated request (no session cookie).
 * All auth functions will fail with 401.
 */
export function mockUnauthenticated() {
  _mockSession = null;
  _mockSqlResults = {};
  _mockAppKeys = [];
  // Ensure auth is required
  process.env.AUTH_REQUIRED = 'true';
  process.env.AZURE_AD_CLIENT_ID = 'test-client-id';
  process.env.AZURE_AD_CLIENT_SECRET = 'test-client-secret';
  process.env.AZURE_AD_TENANT_ID = 'test-tenant-id';
}

/**
 * Simulate an authenticated user with a linked profile and specific app grants.
 *
 * @param {number} profileId - The user's profile ID
 * @param {string[]} appKeys - App keys the user has been granted
 * @param {{ isSuperuser?: boolean, azureEmail?: string|null, dynamicsSystemuserId?: string|null }} [opts]
 */
export function mockAuthenticatedUser(profileId, appKeys = [], opts = {}) {
  // Real staff sessions carry azureEmail (set in the NextAuth callback from
  // azure_email); PD-scoped endpoints resolve it via program-director-resolver.
  // Pass `{ azureEmail: null }` to simulate a malformed session that lacks it.
  const azureEmail = opts.azureEmail === null
    ? undefined
    : (opts.azureEmail || `user${profileId}@wmkeck.org`);
  _mockSession = {
    user: {
      profileId,
      email: `user${profileId}@wmkeck.org`,
      ...(azureEmail ? { azureEmail } : {}),
      ...(opts.dynamicsSystemuserId ? { dynamicsSystemuserId: opts.dynamicsSystemuserId } : {}),
      name: `Test User ${profileId}`,
    },
  };

  const roles = opts.isSuperuser ? [{ role: 'superuser' }] : [];

  _mockAppKeys = [...appKeys];
  _mockSqlResults = {
    // user_app_access mock retained for any legacy callers that still hit
    // raw SQL directly; the live read path goes through the app-access-service
    // mock above (Wave 1 closeout 2026-05-12).
    user_app_access: { rows: appKeys.map(k => ({ app_key: k })), rowCount: appKeys.length },
    dynamics_user_roles: { rows: roles, rowCount: roles.length },
    is_active: { rows: [{ is_active: true }], rowCount: 1 },
  };

  process.env.AUTH_REQUIRED = 'true';
  process.env.AZURE_AD_CLIENT_ID = 'test-client-id';
  process.env.AZURE_AD_CLIENT_SECRET = 'test-client-secret';
  process.env.AZURE_AD_TENANT_ID = 'test-tenant-id';
}

/**
 * Simulate a disabled (soft-deleted) user.
 *
 * @param {number} profileId
 */
export function mockDisabledUser(profileId) {
  _mockSession = {
    user: {
      profileId,
      email: `disabled${profileId}@wmkeck.org`,
      name: `Disabled User ${profileId}`,
    },
  };

  _mockAppKeys = ['dynamics-explorer'];
  _mockSqlResults = {
    user_app_access: { rows: [{ app_key: 'dynamics-explorer' }], rowCount: 1 },
    dynamics_user_roles: { rows: [], rowCount: 0 },
    is_active: { rows: [{ is_active: false }], rowCount: 1 },
  };

  process.env.AUTH_REQUIRED = 'true';
  process.env.AZURE_AD_CLIENT_ID = 'test-client-id';
  process.env.AZURE_AD_CLIENT_SECRET = 'test-client-secret';
  process.env.AZURE_AD_TENANT_ID = 'test-tenant-id';
}

/**
 * Simulate a user who is authenticated via Azure AD but has no linked profile.
 */
export function mockNoProfile() {
  _mockSession = {
    user: {
      email: 'noprofile@wmkeck.org',
      name: 'No Profile User',
      // no profileId
    },
  };

  _mockAppKeys = [];
  _mockSqlResults = {};

  process.env.AUTH_REQUIRED = 'true';
  process.env.AZURE_AD_CLIENT_ID = 'test-client-id';
  process.env.AZURE_AD_CLIENT_SECRET = 'test-client-secret';
  process.env.AZURE_AD_TENANT_ID = 'test-tenant-id';
}

/**
 * Make role lookup fail while preserving the current session/profile mock.
 */
export function mockRoleLookupFailure() {
  _mockSqlResults = {
    ..._mockSqlResults,
    dynamics_user_roles: new Error('role lookup failed'),
  };
}

/**
 * Make the is_active revocation check fail. Caller should first set a session
 * (e.g. via mockAuthenticatedUser) so requireAuthWithProfile reaches the check.
 */
export function mockIsActiveLookupFailure(profileId) {
  _mockSession = {
    user: {
      profileId,
      email: `user${profileId}@wmkeck.org`,
      // Real staff sessions carry azureEmail (set in the NextAuth callback from
      // azure_email); PD-scoped endpoints resolve it via program-director-resolver.
      azureEmail: `user${profileId}@wmkeck.org`,
      name: `Test User ${profileId}`,
    },
  };
  _mockAppKeys = [];
  _mockSqlResults = {
    is_active: new Error('postgres unavailable'),
  };
  process.env.AUTH_REQUIRED = 'true';
  process.env.AZURE_AD_CLIENT_ID = 'test-client-id';
  process.env.AZURE_AD_CLIENT_SECRET = 'test-client-secret';
  process.env.AZURE_AD_TENANT_ID = 'test-tenant-id';
}

/**
 * Simulate a staff session whose user_profiles row has been deleted (zero
 * rows on the is_active lookup) — the fail-open case the audit found in
 * requireAuthWithProfile / requireAppAccess and that bare requireAuth never
 * checked at all. Session carries a profileId (the deleted row's former id)
 * so the profileId lookup key is exercised.
 *
 * @param {number} profileId
 */
export function mockMissingProfile(profileId) {
  _mockSession = {
    user: {
      profileId,
      email: `gone${profileId}@wmkeck.org`,
      azureEmail: `gone${profileId}@wmkeck.org`,
      name: `Deleted Profile ${profileId}`,
    },
  };

  _mockAppKeys = [];
  _mockSqlResults = {
    // No 'is_active' key at all → the sql mock's default (empty rows) fires,
    // simulating a zero-row SELECT.
  };

  process.env.AUTH_REQUIRED = 'true';
  process.env.AZURE_AD_CLIENT_ID = 'test-client-id';
  process.env.AZURE_AD_CLIENT_SECRET = 'test-client-secret';
  process.env.AZURE_AD_TENANT_ID = 'test-tenant-id';
}

/**
 * Simulate a staff session with NO profileId, only an azureId — the
 * requireAuth fallback lookup key. Pass `disabled: true` for a disabled row
 * (azure_id present, is_active false); omit it (or pass nothing) for a
 * missing row (zero rows on the azure_id lookup).
 *
 * @param {string} azureId
 * @param {{ disabled?: boolean }} [opts]
 */
export function mockAzureIdOnlySession(azureId, opts = {}) {
  _mockSession = {
    user: {
      azureId,
      email: `azureonly-${azureId}@wmkeck.org`,
      name: `Azure-Only ${azureId}`,
      // deliberately no profileId
    },
  };

  _mockAppKeys = [];
  _mockSqlResults = opts.disabled
    ? { is_active: { rows: [{ is_active: false }], rowCount: 1 } }
    : {}; // zero rows by default

  process.env.AUTH_REQUIRED = 'true';
  process.env.AZURE_AD_CLIENT_ID = 'test-client-id';
  process.env.AZURE_AD_CLIENT_SECRET = 'test-client-secret';
  process.env.AZURE_AD_TENANT_ID = 'test-tenant-id';
}

/**
 * Simulate an applicant session (userType 'applicant'). Applicants have no
 * user_profiles row by design; requireAuth must skip the is_active lookup
 * entirely for them.
 */
export function mockApplicantSession() {
  _mockSession = {
    user: {
      userType: 'applicant',
      contactOid: 'applicant-contact-oid',
      email: 'applicant@example.org',
    },
  };

  _mockAppKeys = [];
  _mockSqlResults = {};

  process.env.AUTH_REQUIRED = 'true';
  process.env.AZURE_AD_CLIENT_ID = 'test-client-id';
  process.env.AZURE_AD_CLIENT_SECRET = 'test-client-secret';
  process.env.AZURE_AD_TENANT_ID = 'test-tenant-id';
}

/**
 * Merge additional preset rows into the `sql` mock, keyed by a query-text
 * fragment (e.g. 'dynamics_restrictions'). Call AFTER mockAuthenticatedUser
 * (which resets _mockSqlResults). Value shape matches @vercel/postgres:
 * `{ rows: [...] }`, or an Error to simulate a query failure.
 */
export function setMockSqlResults(extra = {}) {
  _mockSqlResults = { ..._mockSqlResults, ...extra };
}

// ---------------------------------------------------------------------------
// Request / Response helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal mock request object.
 */
export function createMockReq({ method = 'GET', headers = {}, body = {}, query = {} } = {}) {
  return { method, headers, body, query };
}

/**
 * Create a minimal mock response object with jest.fn() spies.
 * Supports chained calls: res.status(401).json({...})
 */
export function createMockRes() {
  const res = {
    statusCode: 200,
    headersSent: false,
    _headers: {},
    _data: null,
    _ended: false,
    status: jest.fn(function (code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function (data) {
      this._data = data;
      this.headersSent = true;
      return this;
    }),
    end: jest.fn(function () {
      this._ended = true;
      this.headersSent = true;
      return this;
    }),
    setHeader: jest.fn(function (key, value) {
      this._headers[key] = value;
      return this;
    }),
    write: jest.fn(),
    send: jest.fn(function (data) {
      this._data = data;
      this.headersSent = true;
      return this;
    }),
  };
  return res;
}

/**
 * Reset the app-access cache between tests.
 * Import clearAppAccessCache directly from auth.js.
 */
export { clearAppAccessCache } from '../../lib/utils/auth';
