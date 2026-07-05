/**
 * Characterization test for the wmkf_portalmemberships adapter
 * (lib/dataverse/adapters/membership.js).
 *
 * Byte-mirrors the single raw call in lib/services/membership-service.js's
 * getLiveMembershipsForContact.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as membership from '../../lib/dataverse/adapters/membership.js';

afterEach(() => jest.restoreAllMocks());

describe('membership.queryMemberships (characterization)', () => {
  test('golden: forwards select/filter/top verbatim', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [{ wmkf_portalmembershipid: 'm1' }] });
    const select = 'wmkf_portalmembershipid,_wmkf_contact_value';
    const filter = '_wmkf_contact_value eq contact-1 and wmkf_approvalstatus eq 100000002 and statecode eq 0';
    const out = await membership.queryMemberships(select, filter, 100);
    expect(out.records).toHaveLength(1);
    expect(q).toHaveBeenCalledWith('wmkf_portalmemberships', { select, filter, top: 100 });
  });

  test('failure path: propagates a queryRecords rejection', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockRejectedValue(new Error('boom'));
    await expect(membership.queryMemberships('x', 'y eq 1', 1)).rejects.toThrow('boom');
  });
});
