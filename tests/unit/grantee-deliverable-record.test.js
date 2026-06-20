/**
 * grantee-deliverable-record helper — read/create split and alt-key recovery.
 *
 * @jest-environment node
 */
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { queryRecords: jest.fn(), createRecord: jest.fn(), updateRecord: jest.fn() },
}));

import { DynamicsService } from '../../lib/services/dynamics-service';
import {
  getDeliverableForRequest,
  ensureDeliverableForRequest,
  patchDeliverable,
  GRANTEE_DELIVERABLE_ENTITY_SET,
} from '../../lib/services/grantee-deliverable-record';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const ROW = {
  wmkf_granteedeliverableid: 'deliv-1',
  _wmkf_request_value: REQUEST_ID,
  wmkf_deliverablestatus: 100000000,
  _etag: 'W/"1"',
};

beforeEach(() => {
  DynamicsService.queryRecords.mockReset().mockResolvedValue({ records: [] });
  DynamicsService.createRecord.mockReset().mockResolvedValue(ROW);
  DynamicsService.updateRecord.mockReset().mockResolvedValue({});
});

test('getDeliverableForRequest is read-only and missing row returns null', async () => {
  const result = await getDeliverableForRequest(REQUEST_ID);
  expect(result).toBeNull();
  expect(DynamicsService.queryRecords).toHaveBeenCalledWith(GRANTEE_DELIVERABLE_ENTITY_SET, expect.objectContaining({
    filter: `_wmkf_request_value eq ${REQUEST_ID}`,
    top: 2,
  }));
  expect(DynamicsService.createRecord).not.toHaveBeenCalled();
});

test('ensureDeliverableForRequest returns existing row without creating', async () => {
  DynamicsService.queryRecords.mockResolvedValue({ records: [ROW] });
  const result = await ensureDeliverableForRequest(REQUEST_ID, { actingUserSystemId: 'sys-1' });
  expect(result).toBe(ROW);
  expect(DynamicsService.createRecord).not.toHaveBeenCalled();
});

test('ensureDeliverableForRequest creates with request bind when missing', async () => {
  const result = await ensureDeliverableForRequest(REQUEST_ID, {
    requestNumber: '1002794',
    actingUserSystemId: 'sys-1',
  });
  expect(result).toBe(ROW);
  expect(DynamicsService.createRecord).toHaveBeenCalledWith(GRANTEE_DELIVERABLE_ENTITY_SET, {
    wmkf_name: 'Request 1002794 Deliverable',
    'wmkf_Request@odata.bind': `/akoya_requests(${REQUEST_ID})`,
  }, { actingUserSystemId: 'sys-1' });
});

test('ensureDeliverableForRequest recovers from alternate-key conflict by re-reading', async () => {
  DynamicsService.queryRecords
    .mockResolvedValueOnce({ records: [] })
    .mockResolvedValueOnce({ records: [ROW] });
  DynamicsService.createRecord.mockRejectedValue(Object.assign(new Error('duplicate alternate key'), { status: 412 }));

  const result = await ensureDeliverableForRequest(REQUEST_ID);

  expect(result).toBe(ROW);
  expect(DynamicsService.createRecord).toHaveBeenCalledTimes(1);
  expect(DynamicsService.queryRecords).toHaveBeenCalledTimes(2);
});

test('patchDeliverable only writes package-owned fields', async () => {
  DynamicsService.queryRecords.mockResolvedValue({ records: [ROW] });
  await patchDeliverable(REQUEST_ID, {
    wmkf_deliverablestatus: 100000003,
    wmkf_imagecaption: 'Caption',
    wmkf_abstractapproved: 'not owned here',
  }, { actingUserSystemId: 'sys-1' });

  expect(DynamicsService.updateRecord).toHaveBeenCalledWith(
    GRANTEE_DELIVERABLE_ENTITY_SET,
    'deliv-1',
    { wmkf_deliverablestatus: 100000003, wmkf_imagecaption: 'Caption' },
    { ifMatch: 'W/"1"', actingUserSystemId: 'sys-1' },
  );
});
