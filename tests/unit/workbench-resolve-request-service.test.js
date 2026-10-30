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

const getCycleDatesById = jest.fn();
jest.mock('../../lib/dataverse/adapters/operations-grant-cycle', () => ({
  ...jest.requireActual('../../lib/dataverse/adapters/operations-grant-cycle'),
  getCycleDatesById: (...a) => getCycleDatesById(...a),
}));

import { resolveWorkbenchRequest } from '../../lib/services/workbench/resolve-request-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { STATUS_CLASS } from '../../lib/services/dataverse-export/constants';
import { DynamicsService } from '../../lib/services/dynamics-service';

const EXPAND = 'wmkf_GrantCycle($select=wmkf_cyclecode)';

const REQ = '11111111-1111-1111-1111-111111111111';
const CYCLE_ID = '22222222-2222-4222-8222-222222222222';
const RECORD = {
  akoya_requestid: REQ,
  akoya_requestnum: '1002794',
  akoya_title: 'A Study',
  _wmkf_grantcycle_value: CYCLE_ID,
  wmkf_GrantCycle: { wmkf_cyclecode: 'J26' },
  akoya_requeststatus: 'Some Unmapped Status',
};

beforeEach(() => {
  delete process.env.TEST_REQUEST_ISOLATION;
  jest.clearAllMocks();
  getById.mockResolvedValue(RECORD);
  findByRequestNumber.mockResolvedValue({ records: [RECORD] });
  fetchCoPIs.mockResolvedValue([]);
  getCycleDatesById.mockResolvedValue({ wmkf_grantcycleid: CYCLE_ID, wmkf_cyclecode: 'J26', wmkf_meetingdate: '2026-06-04' });
  // The link helpers check the wmkf_grantcycle restriction (covered in grant-cycle-link.test.js).
  jest.spyOn(DynamicsService, 'checkRestriction').mockImplementation(() => {});
});

afterEach(() => { delete process.env.TEST_REQUEST_ISOLATION; });

test('GUID path: adapter getById, DTO projected', async () => {
  const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(getById).toHaveBeenCalledWith(REQ, expect.objectContaining({
    select: expect.stringContaining('wmkf_ai_fieldprimer'), expand: EXPAND,
  }));
  expect(getById.mock.calls[0][1].select).toContain('_wmkf_grantcycle_value');
  expect(getById.mock.calls[0][1].select).not.toContain('wmkf_meetingdate');
  expect(findByRequestNumber).not.toHaveBeenCalled();
  expect(body.requestId).toBe(REQ);
  // meetingDate is the linked cycle's calendar Board date, not the request's own date.
  expect(getCycleDatesById).toHaveBeenCalledWith(CYCLE_ID);
  expect(body).toMatchObject({ cycleCode: 'J26', cycleLabel: 'June 2026', meetingDate: '2026-06-04' });
});

test('a June meeting date with no Grant Cycle link has no cycle and no Board date', async () => {
  getById.mockResolvedValue({ ...RECORD, wmkf_meetingdate: '2026-06-01', _wmkf_grantcycle_value: null, wmkf_GrantCycle: null });
  const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(body).toMatchObject({ cycleCode: null, cycleLabel: null, meetingDate: null });
  expect(getCycleDatesById).not.toHaveBeenCalled();
});

test('a historical (non-J/D) link has no cycle and no Board date', async () => {
  getById.mockResolvedValue({ ...RECORD, wmkf_GrantCycle: { wmkf_cyclecode: '2014-1' } });
  const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(body).toMatchObject({ cycleCode: null, meetingDate: null });
  expect(getCycleDatesById).not.toHaveBeenCalled();
});

test('a calendar row with no Board date, a missing row, or a failed calendar read degrades to no Board date', async () => {
  getCycleDatesById.mockResolvedValueOnce({ wmkf_grantcycleid: CYCLE_ID, wmkf_cyclecode: 'J26', wmkf_meetingdate: null });
  expect((await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' })).meetingDate).toBeNull();
  getCycleDatesById.mockResolvedValueOnce(null);
  expect((await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' })).meetingDate).toBeNull();
  getCycleDatesById.mockRejectedValueOnce(new Error('calendar down'));
  const body = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(body.meetingDate).toBeNull();
  expect(body.cycleCode).toBe('J26');
});

test('number path: findByRequestNumber with top 1', async () => {
  const body = await resolveWorkbenchRequest({ requestId: '', requestNumber: '1002794' });
  expect(findByRequestNumber).toHaveBeenCalledWith('1002794', expect.objectContaining({ top: 1, expand: EXPAND }));
  expect(getById).not.toHaveBeenCalled();
  expect(body.requestNumber).toBe('1002794');
});

test('Stage 1d: header DTO selects and emits only a derived badge when on', async () => {
  const off = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(getById.mock.calls[0][1].select).not.toContain('wmkf_istestrequest');
  expect(off).not.toHaveProperty('isTestRequest');

  process.env.TEST_REQUEST_ISOLATION = 'on';
  getById.mockResolvedValue({
    ...RECORD,
    wmkf_istestrequest: true,
    wmkf_testcreationrunid: '22222222-2222-4222-8222-222222222222',
  });
  const on = await resolveWorkbenchRequest({ requestId: REQ, requestNumber: '' });
  expect(getById.mock.calls[1][1].select).toContain('wmkf_istestrequest,wmkf_testcreationrunid');
  expect(on.isTestRequest).toBe(true);
  expect(on).not.toHaveProperty('wmkf_istestrequest');
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
