/**
 * Characterization test for the accounts adapter
 * (lib/dataverse/adapters/account.js).
 *
 * Byte-mirrors the single raw getRecord call in
 * lib/services/grantee-document-assembly.js's assembleGranteeDocument.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as account from '../../lib/dataverse/adapters/account.js';

afterEach(() => jest.restoreAllMocks());

const GUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('account.getById (characterization)', () => {
  test('golden: forwards select verbatim, returns the record', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ name: 'Some University' });
    const select = 'name,address1_city,address1_stateorprovince';
    const out = await account.getById(GUID, { select });
    expect(out).toEqual({ name: 'Some University' });
    expect(g).toHaveBeenCalledWith('accounts', GUID, { select });
  });

  test('failure path: propagates a 404-style rejection', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    await expect(account.getById(GUID, { select: 'name' })).rejects.toThrow('not found');
  });
});

describe('account.queryAccounts (characterization)', () => {
  test('golden: forwards options verbatim to DynamicsService.queryRecords (my-candidates aka batch shape)', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ accountid: GUID, akoya_aka: 'AKA U', name: 'Some University' }],
    });
    const options = {
      select: 'accountid,akoya_aka,name',
      filter: `accountid eq ${GUID}`,
      top: 500,
    };
    const out = await account.queryAccounts(options);
    expect(out).toEqual({ records: [{ accountid: GUID, akoya_aka: 'AKA U', name: 'Some University' }] });
    expect(query).toHaveBeenCalledWith('accounts', options);
  });

  test('failure path: propagates a rejection', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockRejectedValue(new Error('transient'));
    await expect(account.queryAccounts({ select: 'accountid', filter: 'accountid eq x', top: 1 }))
      .rejects.toThrow('transient');
  });
});
