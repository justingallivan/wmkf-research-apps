/**
 * Characterization tests for the wmkf_granteedeliverables adapter
 * (lib/dataverse/adapters/grantee-deliverable.js).
 *
 * Byte-mirrors the three raw call shapes in
 * lib/services/grantee-deliverable-record.js.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as granteeDeliverable from '../../lib/dataverse/adapters/grantee-deliverable.js';

afterEach(() => jest.restoreAllMocks());

const SELECT = 'wmkf_granteedeliverableid,wmkf_name,_wmkf_request_value';
const GUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('grantee-deliverable.queryDeliverables (characterization)', () => {
  test('golden: forwards select/filter/orderby/top verbatim', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [{ wmkf_granteedeliverableid: GUID }] });
    const out = await granteeDeliverable.queryDeliverables(`_wmkf_request_value eq ${GUID}`, {
      select: SELECT, orderby: 'modifiedon desc', top: 2,
    });
    expect(out.records).toHaveLength(1);
    expect(q).toHaveBeenCalledWith('wmkf_granteedeliverables', {
      select: SELECT, filter: `_wmkf_request_value eq ${GUID}`, orderby: 'modifiedon desc', top: 2,
    });
  });

  test('failure path: propagates a queryRecords rejection', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockRejectedValue(new Error('boom'));
    await expect(granteeDeliverable.queryDeliverables('x eq 1', {})).rejects.toThrow('boom');
  });
});

describe('grantee-deliverable.create (characterization)', () => {
  test('golden: forwards payload + options verbatim', async () => {
    const c = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ wmkf_granteedeliverableid: GUID });
    const payload = { wmkf_name: 'Request X Deliverable' };
    const out = await granteeDeliverable.create(payload, { actingUserSystemId: 'sys' });
    expect(out).toEqual({ wmkf_granteedeliverableid: GUID });
    expect(c).toHaveBeenCalledWith('wmkf_granteedeliverables', payload, { actingUserSystemId: 'sys' });
  });

  test('omits options entirely when none passed', async () => {
    const c = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({});
    await granteeDeliverable.create({ wmkf_name: 'x' });
    expect(c.mock.calls[0]).toHaveLength(2);
  });
});

describe('grantee-deliverable.update (characterization)', () => {
  test('golden: forwards id/patch/options verbatim', async () => {
    const u = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    await granteeDeliverable.update(GUID, { wmkf_deliverablestatus: 1 }, { ifMatch: 'W/"1"', actingUserSystemId: 'sys' });
    expect(u).toHaveBeenCalledWith('wmkf_granteedeliverables', GUID, { wmkf_deliverablestatus: 1 }, { ifMatch: 'W/"1"', actingUserSystemId: 'sys' });
  });

  test('failure path: propagates an updateRecord rejection', async () => {
    jest.spyOn(DynamicsService, 'updateRecord').mockRejectedValue(new Error('412'));
    await expect(granteeDeliverable.update(GUID, {}, {})).rejects.toThrow('412');
  });
});
