/**
 * @jest-environment node
 */

const {
  createStaffVerifiedState,
  createConflictPendingState,
  addressConflictDisposition,
  receiptCanResolveConflict,
  parseAddressTrustState,
  addressTrustDecision,
} = require('../../lib/utils/reviewer-address-trust');
const { emailConfidence } = require('../../lib/utils/reviewer-invite');

const BASE = {
  email: 'Reviewer@Example.edu',
  requestId: '11111111-1111-4111-8111-111111111111',
  candidateKey: 'candidate:reviewer',
  evidenceType: 'publication_corresponding_author',
  evidenceUrl: 'https://example.edu/paper',
  actorProfileId: 'profile-1',
  actorSystemUserId: '22222222-2222-4222-8222-222222222222',
  attestedAt: '2026-07-31T20:00:00.000Z',
};

describe('reviewer address trust bundle', () => {
  test('valid exact-address attestation upgrades staff_verified to ready', () => {
    const state = createStaffVerifiedState(BASE);
    const person = {
      wmkf_emailaddress: 'reviewer@example.edu',
      wmkf_emailsource: 'staff_verified',
      wmkf_addresstruststatejson: JSON.stringify(state),
    };
    expect(addressTrustDecision(person)).toMatchObject({ status: 'staff_verified' });
    expect(emailConfidence(person)).toMatchObject({ action: 'ready', level: 'high' });
  });

  test.each([
    ['legacy null', null, 'absent'],
    ['malformed', '{', 'malformed'],
    ['unknown version', JSON.stringify({ version: 99 }), 'unknown_version'],
  ])('%s bundle grants no authority', (_label, raw, reason) => {
    expect(parseAddressTrustState(raw, { storedEmail: BASE.email })).toEqual({
      valid: false,
      reason,
      state: null,
    });
    expect(emailConfidence({
      wmkf_emailaddress: BASE.email,
      wmkf_emailsource: 'staff_verified',
      wmkf_addresstruststatejson: raw,
    })).toMatchObject({ action: 'quick_check', level: 'low' });
  });

  test('bundle for a different address grants no authority', () => {
    const state = createStaffVerifiedState(BASE);
    expect(parseAddressTrustState(JSON.stringify(state), {
      storedEmail: 'different@example.edu',
    })).toEqual({ valid: false, reason: 'email_mismatch', state: null });
  });

  test('pending conflict blocks even a normally ready source and provides remedies', () => {
    const attested = createStaffVerifiedState(BASE);
    const conflict = createConflictPendingState({
      currentState: attested,
      email: BASE.email,
      foundEmail: 'new@example.edu',
      reason: 'email_mismatch',
      source: 'scholarly_single',
      requestId: BASE.requestId,
      candidateKey: BASE.candidateKey,
      detectedAt: '2026-07-31T21:00:00.000Z',
    });
    expect(emailConfidence({
      wmkf_emailaddress: BASE.email,
      wmkf_emailsource: 'orcid',
      wmkf_addresstruststatejson: JSON.stringify(conflict),
    })).toMatchObject({
      action: 'blocked',
      code: 'address_conflict_pending',
      remediation: expect.arrayContaining([
        expect.objectContaining({ action: 'resolve_address_conflict' }),
      ]),
    });
  });

  test('a resolved address pair is not silently reopened', () => {
    const conflict = createConflictPendingState({
      email: BASE.email,
      foundEmail: 'new@example.edu',
      reason: 'email_mismatch',
      requestId: BASE.requestId,
      candidateKey: BASE.candidateKey,
      detectedAt: '2026-07-31T21:00:00.000Z',
    });
    const resolved = createStaffVerifiedState({
      ...BASE,
      email: 'new@example.edu',
      attestedAt: '2026-07-31T22:00:00.000Z',
      resolution: {
        conflict: conflict.conflict,
        decision: 'use_found',
        resolvedAt: '2026-07-31T22:00:00.000Z',
      },
    });
    expect(addressConflictDisposition(resolved, {
      email: 'new@example.edu',
      foundEmail: BASE.email,
      reason: 'email_mismatch',
    })).toBe('resolved');
  });

  test('the same pending pair is reused but a third address supersedes it', () => {
    const pending = createConflictPendingState({
      email: BASE.email,
      foundEmail: 'new@example.edu',
      reason: 'email_mismatch',
      requestId: BASE.requestId,
      candidateKey: BASE.candidateKey,
      detectedAt: '2026-07-31T21:00:00.000Z',
    });
    expect(addressConflictDisposition(pending, {
      email: BASE.email,
      foundEmail: 'new@example.edu',
      reason: 'email_mismatch',
    })).toBe('existing');
    expect(addressConflictDisposition(pending, {
      email: BASE.email,
      foundEmail: 'third@example.edu',
      reason: 'email_mismatch',
    })).toBe('write');
  });

  test('only a post-detection receipt can resolve a conflict', () => {
    const conflict = { detectedAt: '2026-07-31T21:00:00.000Z' };
    expect(receiptCanResolveConflict({
      personConfirmed: true,
      attestedAt: '2026-07-31T20:59:59.000Z',
    }, conflict)).toBe(false);
    expect(receiptCanResolveConflict({
      personConfirmed: true,
      attestedAt: '2026-07-31T21:00:00.000Z',
    }, conflict)).toBe(true);
  });

  test('a malformed resolution cannot suppress a later contradiction', () => {
    const state = createStaffVerifiedState(BASE);
    state.resolution = {
      decision: 'keep_stored',
      conflict: {
        reason: 'email_mismatch',
        storedEmail: BASE.email,
        foundEmail: 'new@example.edu',
        requestId: BASE.requestId,
        candidateKey: BASE.candidateKey,
        detectedAt: '2026-07-31T21:00:00.000Z',
      },
      resolvedAt: '2026-07-31T20:00:00.000Z',
    };
    expect(parseAddressTrustState(state, { storedEmail: BASE.email })).toEqual({
      valid: false,
      reason: 'invalid_attestation_or_resolution',
      state: null,
    });
  });

  test('publication and institution evidence require a valid HTTP(S) URL', () => {
    expect(() => createStaffVerifiedState({ ...BASE, evidenceUrl: null })).toThrow(/Required/);
    expect(() => createStaffVerifiedState({ ...BASE, evidenceUrl: 'javascript:alert(1)' })).toThrow(/HTTP/);
  });

  test('other evidence requires a bounded note', () => {
    expect(() => createStaffVerifiedState({
      ...BASE,
      evidenceType: 'other',
      evidenceUrl: null,
      note: null,
    })).toThrow(/Required/);
  });
});
