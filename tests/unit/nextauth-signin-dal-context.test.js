/**
 * S333 bypass-strip Stage 0 characterization (BYPASS_STRIP_PLAN.md sites
 * 31-32, A4, pages/api/auth/[...nextauth].js). The `signIn` callback fires
 * `bypassDynamicsRestrictions('staff-signin-reconcile', ...)` fire-and-forget
 * (`.catch(()=>{})`) after Azure AD auth, with no ambient Dataverse context.
 * Drives the real dynamics-context machinery (no dynamics-context mock) and
 * asserts hasTrustedDalContext() === true inside reconcileProfile, for both
 * the new-profile and unlinked-profile branches (both bound to the same
 * literal label 'staff-signin-reconcile').
 *
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/services/app-access-service', () => ({ grantApps: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../lib/services/notification-service', () => ({ notifyNewUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../lib/services/dynamics-identity-service', () => ({ reconcileProfile: jest.fn() }));
jest.mock('next-auth', () => jest.fn(() => ({})));
jest.mock('next-auth/providers/azure-ad', () => jest.fn(() => ({})));

const { sql } = require('@vercel/postgres');
const { grantApps } = require('../../lib/services/app-access-service');
const { reconcileProfile } = require('../../lib/services/dynamics-identity-service');
const { hasTrustedDalContext } = require('../../lib/dataverse/core/context');
const { assertDataverseAccess } = require('../../lib/services/dynamics-context');
const { authOptions } = require('../../pages/api/auth/[...nextauth].js');

function taggedRows(rows) {
  const fn = async () => ({ rows });
  return fn;
}

describe('nextauth signIn DAL context (S333 characterization, sites 31-32)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DATAVERSE_DAL_UNIVERSAL = 'on';
  });

  afterEach(() => {
    delete process.env.DATAVERSE_DAL_UNIVERSAL;
  });

  test('negative control: no trusted context exists before the callback', () => {
    expect(hasTrustedDalContext()).toBe(false);
  });

  test('new-profile branch: reconcileProfile runs inside a trusted context', async () => {
    const seen = { grantInside: null, reconcileInside: null };
    grantApps.mockImplementation(async () => {
      assertDataverseAccess('app-access:write');
      seen.grantInside = hasTrustedDalContext();
    });
    reconcileProfile.mockImplementation(async () => {
      seen.reconcileInside = hasTrustedDalContext();
    });
    // Sequence: existingByAzureId (empty) -> unlinkedProfiles (empty) -> INSERT new
    sql
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'profile-1' }] });

    const ok = await authOptions.callbacks.signIn({
      user: { id: 'azure-1', email: 'STAFF@example.org', name: 'Staff Person' },
      account: { provider: 'azure-ad' },
      profile: { oid: 'azure-1', name: 'Staff Person' },
    });

    // Allow the fire-and-forget promise to settle before asserting.
    await new Promise((resolve) => setImmediate(resolve));

    expect(ok).toBe(true);
    expect(grantApps).toHaveBeenCalledWith('profile-1', expect.any(Array), null);
    expect(seen.grantInside).toBe(true);
    expect(reconcileProfile).toHaveBeenCalledWith('profile-1', { silent: true });
    expect(seen.reconcileInside).toBe(true);
    expect(hasTrustedDalContext()).toBe(false);
  });

  test('unlinked-profile branch: reconcileProfile runs inside a trusted context', async () => {
    const seen = { grantInside: null, reconcileInside: null };
    grantApps.mockImplementation(async () => {
      assertDataverseAccess('app-access:write');
      seen.grantInside = hasTrustedDalContext();
    });
    reconcileProfile.mockImplementation(async () => {
      seen.reconcileInside = hasTrustedDalContext();
    });
    // Sequence: existingByAzureId (empty) -> unlinkedProfiles (match) -> INSERT temp
    sql
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'unlinked-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'temp-profile-1' }] });

    const ok = await authOptions.callbacks.signIn({
      user: { id: 'azure-2', email: 'STAFF2@example.org', name: 'Staff Two' },
      account: { provider: 'azure-ad' },
      profile: { oid: 'azure-2', name: 'Staff Two' },
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(ok).toBe(true);
    expect(grantApps).toHaveBeenCalledWith('temp-profile-1', expect.any(Array), null);
    expect(seen.grantInside).toBe(true);
    expect(reconcileProfile).toHaveBeenCalledWith('temp-profile-1', { silent: true });
    expect(seen.reconcileInside).toBe(true);
    expect(hasTrustedDalContext()).toBe(false);
  });
});
