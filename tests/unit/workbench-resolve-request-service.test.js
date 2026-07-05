/**
 * @jest-environment node
 *
 * lib/services/workbench/resolve-request-service — logic-level tests
 * (adapter mocked), Stage 4 series A extraction. The route characterization
 * pins the full DTO; this suite pins the service branches: GUID vs number
 * resolution, 404 message variants, CoPI degradation, statusClass mapping.
 */

const getById = jest.fn();
const findByRequestNumber = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getById(...a),
  findByRequestNumber: (...a) => findByRequestNumber(...a),
}));

const fetchCoPIs = jest.fn(async () => []);
jest.mock('../../lib/services/proposal-participants', () => ({
  fetchCoPIs: (...a) => fetchCoPIs(...a),
}));

import { resolveWorkbenchRequest } from '../../lib/services/workbench/resolve-request-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { STATUS_CLASS } from '../../lib/services/dataverse-export/constants';

const REQ = '11111111-1111-1111-1111-111111111111';
const RECORD = {
  akoya_requestid: REQ,
  akoya_requestnum: '1002794',
  akoya_title: 'A Study',
  wmkf_meetingdate: '2026-06-01',
  akoya_requeststatus: 'Some Unmapped Status',
};

beforeEach(() => {
  jest.clearAllMocks();
  getById.mockResolvedValue(RECORD);
  findByRequestNumber.mockResolvedValue({ records: [RECORD] });
  fetchCoPIs.mockResolvedValue([]);
});

test('GUID path: adapter getById, DTO projected', async () => {
  const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(getById).toHaveBeenCalledWith(REQ, expect.objectContaining({ select: expect.stringContaining('wmkf_ai_fieldprimer') }));
  expect(findByRequestNumber).not.toHaveBeenCalled();
  expect(body.requestId).toBe(REQ);
  expect(body.cycleCode).toBe('J26');
});

test('number path: findByRequestNumber with top 1', async () => {
  const body = await resolveWorkbenchRequest({ requestId: '', requestNumber: '1002794' });
  expect(findByRequestNumber).toHaveBeenCalledWith('1002794', expect.objectContaining({ top: 1 }));
  expect(getById).not.toHaveBeenCalled();
  expect(body.requestNumber).toBe('1002794');
});

test('GUID miss → 404 with GUID in message; number miss → 404 with "number N"', async () => {
  getById.mockRejectedValue(new Error('not found'));
  const e1 = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' }).catch((e) => e);
  expect(e1).toBeInstanceOf(ServiceHttpError);
  expect(e1.httpStatus).toBe(404);
  expect(e1.message).toBe(`No request found for ${REQ}`);

  findByRequestNumber.mockResolvedValue({ records: [] });
  const e2 = await resolveWorkbenchRequest({ requestId: '', requestNumber: '9999999' }).catch((e) => e);
  expect(e2.httpStatus).toBe(404);
  expect(e2.message).toBe('No request found for number 9999999');
});

test('CoPI failure degrades to an empty list, never throws', async () => {
  fetchCoPIs.mockRejectedValue(new Error('junction down'));
  const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(body.proposalInfo.coPIs).toEqual([]);
});

test('statusClass: unmapped status → UNCLASSIFIED; null status → null', async () => {
  const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(body.statusClass).toBe(STATUS_CLASS.UNCLASSIFIED);

  getById.mockResolvedValue({ ...RECORD, akoya_requeststatus: null });
  const body2 = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(body2.statusClass).toBeNull();
  expect(body2.requestStatus).toBeNull();
});
