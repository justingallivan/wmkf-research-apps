/**
 * @jest-environment node
 *
 * The 'confirmed' sticky-attestation invariant on the person identity adapter.
 * The resolver never emits 'confirmed' (only probable/unresolved/ambiguous), so a
 * stored 'confirmed' is a human self-report/manual attestation that an automated
 * resolver verdict must NOT downgrade (writeIdentityDecision) or clear
 * (clearIdentityFields). Guards the reviewer self-reported-ORCID capture from
 * being wiped by a later enrich pass.
 */
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { writeIdentityDecision, clearIdentityFields } from '../../lib/dataverse/adapters/researcher.js';

afterEach(() => jest.restoreAllMocks());

const decision = (status) => ({ status, confidenceBand: status === 'confirmed' ? 'high' : 'low', resolverVersion: 'x', resolvedAt: 'T', anchors: [] });

describe('writeIdentityDecision — confirmed is sticky', () => {
  test('existing confirmed + incoming probable → NO overwrite (preserve attestation)', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_identitystatus: 'confirmed' });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await writeIdentityDecision('pr-1', decision('probable'));
    expect(patch).not.toHaveBeenCalled();
  });

  test('existing confirmed + incoming unresolved → NO overwrite', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_identitystatus: 'confirmed' });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await writeIdentityDecision('pr-1', decision('unresolved'));
    expect(patch).not.toHaveBeenCalled();
  });

  test('existing confirmed + incoming confirmed → DOES overwrite (fresh attestation replaces)', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_identitystatus: 'confirmed' });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await writeIdentityDecision('pr-1', decision('confirmed'));
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][2].wmkf_identitystatus).toBe('confirmed');
  });

  test('incoming confirmed → skips the pre-read entirely (no guard needed)', async () => {
    const getRec = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_identitystatus: 'probable' });
    jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await writeIdentityDecision('pr-1', decision('confirmed'));
    expect(getRec).not.toHaveBeenCalled();
  });

  test('existing probable + incoming unresolved → normal overwrite (resolver downgrade allowed)', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_identitystatus: 'probable' });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await writeIdentityDecision('pr-1', decision('unresolved'));
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][2].wmkf_identitystatus).toBe('unresolved');
  });

  test('FAIL CLOSED: status read error on a downgrade → throws, no write (Codex #1)', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await expect(writeIdentityDecision('pr-1', decision('probable'))).rejects.toThrow('forbidden');
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('clearIdentityFields — never clears a confirmed record', () => {
  test('existing confirmed → NO clear', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_identitystatus: 'confirmed' });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await clearIdentityFields('pr-1', ['wmkf_orcid', 'wmkf_orcidurl']);
    expect(patch).not.toHaveBeenCalled();
  });

  test('existing probable → clears (nulls the fields)', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_identitystatus: 'probable' });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await clearIdentityFields('pr-1', ['wmkf_orcid', 'wmkf_orcidurl']);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][2]).toEqual({ wmkf_orcid: null, wmkf_orcidurl: null });
  });

  test('FAIL CLOSED: status read error → throws, no clear (Codex #1)', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(new Error('transient'));
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await expect(clearIdentityFields('pr-1', ['wmkf_orcid'])).rejects.toThrow('transient');
    expect(patch).not.toHaveBeenCalled();
  });
});
