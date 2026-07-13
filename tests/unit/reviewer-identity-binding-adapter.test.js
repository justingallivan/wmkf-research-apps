/**
 * @jest-environment node
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  getIdentityBindingForUpdate,
  patchIdentityBinding,
} from '../../lib/dataverse/adapters/researcher.js';

afterEach(() => jest.restoreAllMocks());

const COMPLETE_BINDING = {
  wmkf_identitybindingversion: 2,
  wmkf_identitybindingsource: 'self_reported',
  wmkf_identitybindinganchor: 'orcid:0000-0002-1825-0097',
  wmkf_identityboundat: '2026-07-12T20:00:00.000Z',
  wmkf_identityderivedbindingversion: null,
  wmkf_identityfieldlineagejson: '{"schemaVersion":1,"fields":{}}',
  wmkf_googlescholarid: null,
  wmkf_googlescholarurl: null,
  wmkf_hindex: null,
  wmkf_i10index: null,
  wmkf_totalcitations: null,
  wmkf_orcid: '0000-0002-1825-0097',
  wmkf_orcidurl: 'https://orcid.org/0000-0002-1825-0097',
  wmkf_identitystatus: 'confirmed',
  wmkf_identityconfidenceband: 'high',
  wmkf_identityresolverversion: 'human@1',
  wmkf_identityresolvedat: '2026-07-12T20:00:00.000Z',
  wmkf_identityevidencesummary: 'attested',
  wmkf_identityverifiedanchorsjson: '[]',
};

describe('researcher identity-binding adapter', () => {
  test('reads the complete binding snapshot and returns the mapped ETag', async () => {
    const row = { _etag: 'W/"7"', wmkf_potentialreviewersid: 'pr-1' };
    const getRecord = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue(row);

    await expect(getIdentityBindingForUpdate('pr-1')).resolves.toBe(row);
    expect(getRecord).toHaveBeenCalledTimes(1);
    const [entitySet, id, options] = getRecord.mock.calls[0];
    expect(entitySet).toBe('wmkf_potentialreviewerses');
    expect(id).toBe('pr-1');
    expect(options.select).toContain('wmkf_identitybindingversion');
    expect(options.select).toContain('wmkf_identityfieldlineagejson');
    expect(options.select).toContain('wmkf_orcid');
    expect(options.select).toContain('wmkf_identitystatus');
    expect(options.select).not.toContain('@odata.etag');
  });

  test('read failures propagate instead of becoming an unbound row', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(new Error('Dataverse unavailable'));
    await expect(getIdentityBindingForUpdate('pr-1')).rejects.toThrow('Dataverse unavailable');
  });

  test('preserves explicit nulls in one conditional PATCH', async () => {
    const updateRecord = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    const patch = {
      ...COMPLETE_BINDING,
      wmkf_hindex: 9,
    };

    await patchIdentityBinding('pr-1', patch, {
      ifMatch: 'W/"7"',
      actingUserSystemId: 'user-1',
    });

    expect(updateRecord).toHaveBeenCalledTimes(1);
    expect(updateRecord).toHaveBeenCalledWith(
      'wmkf_potentialreviewerses',
      'pr-1',
      patch,
      { ifMatch: 'W/"7"', actingUserSystemId: 'user-1' },
    );
  });

  test.each([
    [{ ...COMPLETE_BINDING }, {}, /ifMatch required/],
    [{ ...COMPLETE_BINDING, wmkf_name: 'unsafe' }, { ifMatch: 'W/"1"' }, /unsupported fields/],
    [{ wmkf_identitybindingversion: 1 }, { ifMatch: 'W/"1"' }, /incomplete identity patch/],
  ])('rejects invalid conditional patch before writing', async (patch, options, message) => {
    const updateRecord = jest.spyOn(DynamicsService, 'updateRecord');
    await expect(patchIdentityBinding('pr-1', patch, options)).rejects.toThrow(message);
    expect(updateRecord).not.toHaveBeenCalled();
  });

  test.each(['wmkf_orcidurl', 'wmkf_identitystatus'])('rejects a complete PATCH missing %s', async (missingField) => {
    const updateRecord = jest.spyOn(DynamicsService, 'updateRecord');
    const patch = { ...COMPLETE_BINDING };
    delete patch[missingField];
    await expect(patchIdentityBinding('pr-1', patch, { ifMatch: 'W/"1"' }))
      .rejects.toThrow('incomplete identity patch');
    expect(updateRecord).not.toHaveBeenCalled();
  });

  test('rejects undefined values that JSON serialization would silently omit', async () => {
    const updateRecord = jest.spyOn(DynamicsService, 'updateRecord');
    await expect(patchIdentityBinding('pr-1', {
      ...COMPLETE_BINDING,
      wmkf_totalcitations: undefined,
    }, { ifMatch: 'W/"1"' })).rejects.toThrow('undefined identity fields');
    expect(updateRecord).not.toHaveBeenCalled();
  });

  test('propagates a 412 unchanged for service-level reread and recompute', async () => {
    const error = Object.assign(new Error('precondition failed'), { status: 412 });
    jest.spyOn(DynamicsService, 'updateRecord').mockRejectedValue(error);
    await expect(patchIdentityBinding('pr-1', COMPLETE_BINDING, { ifMatch: 'W/"1"' }))
      .rejects.toBe(error);
  });
});
