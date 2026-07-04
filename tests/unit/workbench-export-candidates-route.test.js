/**
 * POST /api/workbench/export-candidates — characterization test written BEFORE
 * converting the route's raw `DynamicsService.getRecord('akoya_requests', ...)`
 * call to the grant-request adapter (Wave 5 conversion). Asserts the golden-path
 * .xlsx response and the "request not found" 404 failure path, against CURRENT
 * behavior.
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn() },
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => fn(),
}));
jest.mock('../../lib/services/reviewer-candidate-export', () => ({
  buildReviewerCandidateWorkbook: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { buildReviewerCandidateWorkbook } from '../../lib/services/reviewer-candidate-export';
import handler from '../../pages/api/workbench/export-candidates';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.send = (b) => { res.body = b; return res; };
  return res;
}

const body = (over = {}) => ({
  requestId: REQUEST_ID,
  candidates: [{ name: 'Ada Lovelace' }],
  ...over,
});
const reqOf = (b) => ({ method: 'POST', body: b });

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  '_wmkf_grantprogram_value',
  'wmkf_meetingdate',
].join(',');

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ profileId: 'p', session: { user: {} } });
  DynamicsService.getRecord.mockReset().mockResolvedValue({
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002794',
    akoya_title: 'A Study',
    wmkf_organizationname: 'Example University',
    _wmkf_projectleader_value_formatted: 'Dr. Ada Lovelace',
    wmkf_meetingdate: '2026-06-01',
  });
  buildReviewerCandidateWorkbook.mockReset().mockResolvedValue(Buffer.from('xlsx-bytes'));
});

test('non-POST → 405', async () => {
  const res = mockRes();
  await handler({ method: 'GET', body: {} }, res);
  expect(res.statusCode).toBe(405);
});

test('invalid requestId → 400, no read attempted', async () => {
  const res = mockRes();
  await handler(reqOf(body({ requestId: 'not-a-guid' })), res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

test('golden path: builds the workbook from the authoritatively-fetched request metadata', async () => {
  const res = mockRes();
  await handler(reqOf(body()), res);
  expect(res.statusCode).toBe(200);
  expect(DynamicsService.getRecord).toHaveBeenCalledWith('akoya_requests', REQUEST_ID, { select: REQUEST_SELECT });
  expect(buildReviewerCandidateWorkbook).toHaveBeenCalledWith({
    meta: expect.objectContaining({ requestNumber: '1002794', institution: 'Example University', pi: 'Dr. Ada Lovelace' }),
    candidates: body().candidates,
  });
  expect(res.headers['Content-Type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  expect(res.body).toEqual(Buffer.from('xlsx-bytes'));
});

test('request not found → 404, no workbook built', async () => {
  DynamicsService.getRecord.mockRejectedValue(new Error('not found'));
  const res = mockRes();
  await handler(reqOf(body()), res);
  expect(res.statusCode).toBe(404);
  expect(buildReviewerCandidateWorkbook).not.toHaveBeenCalled();
});
