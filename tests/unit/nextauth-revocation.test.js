/**
 * Revocation hardening for pages/api/auth/[...nextauth].js
 * (docs/audits/claude-auth-side-effect-security-audit-2026-08-15.md §1).
 *
 * Covers two gaps:
 *  (a) signIn: a fresh Azure sign-in for an already-disabled `azure_id` must
 *      be denied outright (no writes, no provisioning side effects), not
 *      fall through to the unlinked/new-profile branches whose
 *      `ON CONFLICT (azure_id) DO UPDATE` would match the disabled row.
 *  (b) jwt: a zero-row `is_active = true` lookup for a staff token must
 *      invalidate the token (`return {}`), not silently keep stale claims.
 *
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/services/app-access-service', () => ({ grantApps: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../lib/services/notification-service', () => ({ notifyNewUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../lib/services/dynamics-identity-service', () => ({ reconcileProfile: jest.fn().mockResolvedValue(undefined) }));
jest.mock('next-auth', () => jest.fn(() => ({})));
jest.mock('next-auth/providers/azure-ad', () => jest.fn(() => ({})));

const { sql } = require('@vercel/postgres');
const { grantApps } = require('../../lib/services/app-access-service');
const NotificationService = require('../../lib/services/notification-service');
const { reconcileProfile } = require('../../lib/services/dynamics-identity-service');
const { authOptions } = require('../../pages/api/auth/[...nextauth].js');

describe('nextauth signIn revocation (disabled azure_id)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('disabled azure_id: signIn returns false, no writes, no side effects', async () => {
    // Only one row for the first (and only) query — a disabled profile.
    sql.mockResolvedValueOnce({
      rows: [{ id: 'profile-disabled', name: 'x', display_name: 'X', azure_email: 'x@example.org', needs_linking: false, is_active: false }],
    });

    const ok = await authOptions.callbacks.signIn({
      user: { id: 'azure-disabled', email: 'DISABLED@example.org', name: 'Disabled Person' },
      account: { provider: 'azure-ad' },
      profile: { oid: 'azure-disabled', name: 'Disabled Person' },
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(ok).toBe(false);
    expect(sql).toHaveBeenCalledTimes(1);
    expect(grantApps).not.toHaveBeenCalled();
    expect(NotificationService.notifyNewUser).not.toHaveBeenCalled();
    expect(reconcileProfile).not.toHaveBeenCalled();
  });

  test('NULL is_active azure_id: signIn returns false, no writes, no side effects (fails closed on NULL, not just false)', async () => {
    // is_active: null — a row that is neither explicitly active nor
    // explicitly disabled. The old predicate (`profile.is_active === false`)
    // treats null as active and falls through to the UPDATE/return-true
    // branch; the fixed predicate (`profile.is_active !== true`) denies it.
    sql.mockResolvedValueOnce({
      rows: [{ id: 'profile-null', name: 'x', display_name: 'X', azure_email: 'x@example.org', needs_linking: false, is_active: null }],
    });

    const ok = await authOptions.callbacks.signIn({
      user: { id: 'azure-null', email: 'NULLACTIVE@example.org', name: 'Null Active Person' },
      account: { provider: 'azure-ad' },
      profile: { oid: 'azure-null', name: 'Null Active Person' },
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(ok).toBe(false);
    expect(sql).toHaveBeenCalledTimes(1);
    expect(grantApps).not.toHaveBeenCalled();
    expect(NotificationService.notifyNewUser).not.toHaveBeenCalled();
    expect(reconcileProfile).not.toHaveBeenCalled();
  });

  test('active linked sign-in still works: last_login UPDATE issued, returns true', async () => {
    sql
      .mockResolvedValueOnce({
        rows: [{ id: 'profile-active', name: 'x', display_name: 'X', azure_email: 'x@example.org', needs_linking: false, is_active: true }],
      })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const ok = await authOptions.callbacks.signIn({
      user: { id: 'azure-active', email: 'ACTIVE@example.org', name: 'Active Person' },
      account: { provider: 'azure-ad' },
      profile: { oid: 'azure-active', name: 'Active Person' },
    });

    expect(ok).toBe(true);
    expect(sql).toHaveBeenCalledTimes(2);
  });

  test('genuinely new user still provisioned: empty -> empty -> INSERT, returns true', async () => {
    sql
      .mockResolvedValueOnce({ rows: [] }) // existingByAzureId
      .mockResolvedValueOnce({ rows: [] }) // unlinkedProfiles
      .mockResolvedValueOnce({ rows: [{ id: 'new-profile-1' }] }); // INSERT

    const ok = await authOptions.callbacks.signIn({
      user: { id: 'azure-new', email: 'NEW@example.org', name: 'New Person' },
      account: { provider: 'azure-ad' },
      profile: { oid: 'azure-new', name: 'New Person' },
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(ok).toBe(true);
    expect(grantApps).toHaveBeenCalledWith('new-profile-1', expect.any(Array), null);
  });

  test('signIn DB error still returns false (fail closed)', async () => {
    sql.mockImplementationOnce(() => { throw new Error('db down'); });

    const ok = await authOptions.callbacks.signIn({
      user: { id: 'azure-err', email: 'ERR@example.org', name: 'Err Person' },
      account: { provider: 'azure-ad' },
      profile: { oid: 'azure-err', name: 'Err Person' },
    });

    expect(ok).toBe(false);
  });
});

describe('nextauth jwt revocation (zero-row is_active lookup)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('zero-row lookup with stale profileId invalidates the token', async () => {
    sql.mockResolvedValueOnce({ rows: [] });

    const token = {
      userType: 'staff',
      azureId: 'azure-1',
      azureEmail: 'staff@example.org',
      profileId: 7,
      lastActivity: Date.now(),
    };

    const result = await authOptions.callbacks.jwt({ token, user: undefined, account: undefined, profile: undefined });

    expect(result).toEqual({});
    expect(result.azureId).toBeUndefined();
    expect(result.profileId).toBeUndefined();
  });

  test('zero-row lookup on an azureId-only token (no profileId) invalidates the token', async () => {
    sql.mockResolvedValueOnce({ rows: [] });

    const token = {
      userType: 'staff',
      azureId: 'azure-2',
      azureEmail: 'staff2@example.org',
      lastActivity: Date.now(),
    };

    const result = await authOptions.callbacks.jwt({ token, user: undefined, account: undefined, profile: undefined });

    expect(result).toEqual({});
  });

  test('active row refreshes claims and keeps the token, including needsLinking for an active temp profile', async () => {
    sql.mockResolvedValueOnce({
      rows: [{
        id: 'profile-1',
        name: 'Staff Person',
        display_name: 'Staff Person',
        avatar_color: '#abc',
        needs_linking: true,
        last_login_at: new Date(),
        dynamics_systemuser_id: 'du-1',
      }],
    });

    const token = {
      userType: 'staff',
      azureId: 'azure-1',
      azureEmail: 'staff@example.org',
      lastActivity: Date.now(),
    };

    const result = await authOptions.callbacks.jwt({ token, user: undefined, account: undefined, profile: undefined });

    expect(result.profileId).toBe('profile-1');
    expect(result.needsLinking).toBe(true);
    expect(result.dynamicsSystemuserId).toBe('du-1');
    expect(result.azureId).toBe('azure-1');
  });

  test('DB error on staff lookup keeps the token as-is (not cleared)', async () => {
    sql.mockImplementationOnce(() => { throw new Error('db down'); });

    const token = {
      userType: 'staff',
      azureId: 'azure-1',
      azureEmail: 'staff@example.org',
      profileId: 5,
      lastActivity: Date.now(),
    };

    const result = await authOptions.callbacks.jwt({ token, user: undefined, account: undefined, profile: undefined });

    expect(result.azureId).toBe('azure-1');
    expect(result.profileId).toBe(5);
  });

  test('applicant token returned unchanged without any staff DB lookup', async () => {
    const token = {
      userType: 'applicant',
      contactOid: 'oid-1',
      contactEmail: 'applicant@example.org',
      lastActivity: Date.now(),
    };

    const result = await authOptions.callbacks.jwt({ token, user: undefined, account: undefined, profile: undefined });

    expect(sql).not.toHaveBeenCalled();
    expect(result.contactOid).toBe('oid-1');
    expect(result.userType).toBe('applicant');
  });

  test('idle-timeout behavior unchanged: expired lastActivity returns {}', async () => {
    const token = {
      userType: 'staff',
      azureId: 'azure-1',
      azureEmail: 'staff@example.org',
      lastActivity: Date.now() - (3 * 60 * 60 * 1000), // 3h ago, > 2h idle timeout
    };

    const result = await authOptions.callbacks.jwt({ token, user: undefined, account: undefined, profile: undefined });

    expect(result).toEqual({});
    expect(sql).not.toHaveBeenCalled();
  });
});
