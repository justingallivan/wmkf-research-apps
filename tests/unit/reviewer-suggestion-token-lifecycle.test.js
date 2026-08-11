/**
 * @jest-environment node
 *
 * reviewer-suggestion external-token-lifecycle methods — byte-mirror
 * lib/external/token-lifecycle.js's inline getRecord/updateRecord calls
 * (data-access-layer migration, Stage 3-6). No bypassDynamicsRestrictions
 * here; that wrapper stays with the caller.
 */
import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  getForTokenStatus,
  setExternalToken,
  revokeExternalToken,
  extendExternalTokenExpiry,
} from '../../lib/dataverse/adapters/reviewer-suggestion.js';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';

afterEach(() => jest.restoreAllMocks());

describe('getForTokenStatus', () => {
  it('calls getRecord with the ensureToken-scoped select', async () => {
    const spy = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_appreviewersuggestionid: SUGGESTION_ID });
    await getForTokenStatus(SUGGESTION_ID);
    expect(spy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', SUGGESTION_ID, {
      select: 'wmkf_appreviewersuggestionid,wmkf_externaltokenhash,wmkf_externaltokenrevoked,wmkf_externaltokenexpires,wmkf_accepted,wmkf_reviewduedateoverride,_wmkf_request_value,wmkf_applicantdisposition',
    });
  });
});

describe('setExternalToken', () => {
  it('PATCHes hash, issued (now), expires, and clears revoked', async () => {
    const spy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    const expiresAt = new Date(Date.now() + 60_000);
    await setExternalToken(SUGGESTION_ID, { hash: 'deadbeef', expiresAt }, { actingUserSystemId: 'u1' });

    expect(spy).toHaveBeenCalledTimes(1);
    const [entitySet, id, patch, opts] = spy.mock.calls[0];
    expect(entitySet).toBe('wmkf_appreviewersuggestions');
    expect(id).toBe(SUGGESTION_ID);
    expect(patch.wmkf_externaltokenhash).toBe('deadbeef');
    expect(patch.wmkf_externaltokenexpires).toBe(expiresAt.toISOString());
    expect(patch.wmkf_externaltokenrevoked).toBe(false);
    expect(typeof patch.wmkf_externaltokenissued).toBe('string');
    expect(opts).toEqual({ actingUserSystemId: 'u1' });
  });
});

describe('revokeExternalToken', () => {
  it('PATCHes only wmkf_externaltokenrevoked = true', async () => {
    const spy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    await revokeExternalToken(SUGGESTION_ID);
    expect(spy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', SUGGESTION_ID, {
      wmkf_externaltokenrevoked: true,
    }, { actingUserSystemId: undefined });
  });
});

describe('extendExternalTokenExpiry', () => {
  it('PATCHes only wmkf_externaltokenexpires', async () => {
    const spy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await extendExternalTokenExpiry(SUGGESTION_ID, expiresAt, { actingUserSystemId: 'u2' });
    expect(spy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', SUGGESTION_ID, {
      wmkf_externaltokenexpires: expiresAt.toISOString(),
    }, { actingUserSystemId: 'u2' });
  });
});
