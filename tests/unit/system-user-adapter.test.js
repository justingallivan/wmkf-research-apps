/**
 * @jest-environment node
 *
 * Characterization tests for the new lib/dataverse/adapters/system-user.js
 * adapter (Wave 4, data-access-layer migration). Each method must byte-mirror
 * its former inline caller (dynamics-identity-service.js / reviewer-acceptance-email.js).
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { findByEmail, getById } from '../../lib/dataverse/adapters/system-user.js';

afterEach(() => jest.restoreAllMocks());

describe('system-user.findByEmail', () => {
  test('queries systemusers with escaped filter, top:1, reconciliation select', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ systemuserid: 'su-1', fullname: 'Jane PD', isdisabled: false }],
    });
    const out = await findByEmail("o'brien@example.org");
    expect(out).toEqual({ records: [{ systemuserid: 'su-1', fullname: 'Jane PD', isdisabled: false }] });
    expect(query).toHaveBeenCalledWith('systemusers', {
      select: 'systemuserid,fullname,isdisabled,internalemailaddress',
      filter: "internalemailaddress eq 'o''brien@example.org'",
      top: 1,
    });
  });
});

describe('system-user.getById', () => {
  test('gets systemuser with the acceptance-email sender select', async () => {
    const get = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      systemuserid: 'su-2',
      internalemailaddress: 'pd@example.org',
      isdisabled: false,
    });
    const out = await getById('su-2');
    expect(out).toEqual({ systemuserid: 'su-2', internalemailaddress: 'pd@example.org', isdisabled: false });
    expect(get).toHaveBeenCalledWith('systemusers', 'su-2', {
      select: 'systemuserid,internalemailaddress,isdisabled',
    });
  });
});
