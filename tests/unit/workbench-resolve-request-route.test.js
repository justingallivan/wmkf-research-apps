/**
 * GET /api/workbench/resolve-request — characterization test written BEFORE
 * converting the route's raw `DynamicsService.getRecord`/`queryRecords`
 * `akoya_requests` calls to the grant-request adapter (Wave 5 conversion).
 * Asserts the golden-path DTO shape (both GUID and request-number resolution)
 * and the "request not found" 404 failure path, against CURRENT behavior.
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn(), queryRecords: jest.fn() },
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => fn(),
}));
jest.mock('../../lib/services/proposal-participants', () => ({
  fetchCoPIs: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { fetchCoPIs } from '../../lib/services/proposal-participants';
import handler from '../../pages/api/workbench/resolve-request';
import { classifyStatus, STATUS_CLASS } from '../../lib/services/dataverse-export/constants';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';

const SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
  'akoya_requeststatus',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  '_wmkf_grantprogram_value',
  '_wmkf_programdirector_value',
  'wmkf_abstract',
  'akoya_request',
  'akoya_expenses',
  'wmkf_ai_fitrationale',
  'wmkf_ai_summary',
  'wmkf_ai_dataextract',
  'wmkf_ai_fieldprimer',
].join(',');

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
const reqOf = (query) => ({ method: 'GET', query });

const RECORD = {
  akoya_requestid: REQUEST_ID,
  akoya_requestnum: '1002794',
  akoya_title: 'A Study',
  wmkf_meetingdate: '2026-06-01',
  akoya_requeststatus: 'Active',
  wmkf_organizationname: 'Example University',
  _wmkf_projectleader_value_formatted: 'Dr. Ada Lovelace',
};

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ profileId: 'p', session: { user: {} } });
  DynamicsService.getRecord.mockReset().mockResolvedValue(RECORD);
  DynamicsService.queryRecords.mockReset().mockResolvedValue({ records: [RECORD] });
  fetchCoPIs.mockReset().mockResolvedValue([]);
});

test('non-GET → 405', async () => {
  const res = mockRes();
  await handler({ method: 'POST', query: {} }, res);
  expect(res.statusCode).toBe(405);
});

test('unauthenticated caller: short-circuit, no request lookup attempted', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const res = mockRes();
  await handler(reqOf({ requestId: REQUEST_ID }), res);
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
  expect(DynamicsService.queryRecords).not.toHaveBeenCalled();
});

test('neither requestId nor requestNumber → 400', async () => {
  const res = mockRes();
  await handler(reqOf({}), res);
  expect(res.statusCode).toBe(400);
});

test('golden path by GUID: resolves and returns the expected DTO shape (full envelope pin)', async () => {
  const res = mockRes();
  await handler(reqOf({ requestId: REQUEST_ID }), res);
  expect(res.statusCode).toBe(200);
  expect(DynamicsService.getRecord).toHaveBeenCalledWith('akoya_requests', REQUEST_ID, { select: SELECT });
  const expectedStatusClass = classifyStatus('Active')?.class || STATUS_CLASS.UNCLASSIFIED;
  expect(res.body).toEqual({
    success: true,
    requestId: REQUEST_ID,
    requestNumber: '1002794',
    title: 'A Study',
    cycleCode: 'J26',
    cycleLabel: 'June 2026',
    meetingDate: '2026-06-01',
    requestStatus: 'Active',
    statusClass: expectedStatusClass,
    institution: 'Example University',
    applicant: null,
    projectLeader: 'Dr. Ada Lovelace',
    grantProgram: null,
    programDirector: null,
    programDirectorId: null,
    proposalInfo: {
      pi: 'Dr. Ada Lovelace',
      coPIs: [],
      abstract: null,
      requestedAmount: null,
      totalProjectBudget: null,
    },
    aiContent: {
      fitRationale: null,
      summary: null,
      dataExtract: null,
      fieldPrimer: null,
    },
  });
});

test('golden path by requestNumber: queries by exact number match', async () => {
  const res = mockRes();
  await handler(reqOf({ requestNumber: '1002794' }), res);
  expect(res.statusCode).toBe(200);
  expect(DynamicsService.queryRecords).toHaveBeenCalledWith('akoya_requests', {
    select: SELECT,
    filter: "akoya_requestnum eq '1002794'",
    top: 1,
  });
  expect(res.body.requestId).toBe(REQUEST_ID);
});

test('request not found by GUID → 404, no CoPI lookup attempted', async () => {
  DynamicsService.getRecord.mockRejectedValue(new Error('not found'));
  const res = mockRes();
  await handler(reqOf({ requestId: REQUEST_ID }), res);
  expect(res.statusCode).toBe(404);
  expect(fetchCoPIs).not.toHaveBeenCalled();
});

test('request not found by requestNumber → 404', async () => {
  DynamicsService.queryRecords.mockResolvedValue({ records: [] });
  const res = mockRes();
  await handler(reqOf({ requestNumber: '9999999' }), res);
  expect(res.statusCode).toBe(404);
});
