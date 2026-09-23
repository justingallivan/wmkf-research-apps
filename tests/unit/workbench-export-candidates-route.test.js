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
jest.mock('../../lib/services/workbench/export-candidates-service', () => ({
  exportCandidates: jest.fn((...args) =>
    jest.requireActual('../../lib/services/workbench/export-candidates-service').exportCandidates(...args)),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { buildReviewerCandidateWorkbook } from '../../lib/services/reviewer-candidate-export';
import { exportCandidates } from '../../lib/services/workbench/export-candidates-service';
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
    wmkf_organizationname: 'N/A',
    _akoya_applicantid_value_formatted: 'Example University',
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

test('unauthenticated caller: short-circuit, no request/export work attempted', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const res = mockRes();
  await handler(reqOf(body()), res);
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
  expect(buildReviewerCandidateWorkbook).not.toHaveBeenCalled();
});

test('invalid requestId → 400, no read attempted', async () => {
  const res = mockRes();
  await handler(reqOf(body({ requestId: 'not-a-guid' })), res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

test('empty candidates array → 400, no read attempted', async () => {
  const res = mockRes();
  await handler(reqOf(body({ candidates: [] })), res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

test('too many candidates (>500) → 400, no read attempted', async () => {
  const res = mockRes();
  const many = Array.from({ length: 501 }, (_, i) => ({ name: `Reviewer ${i}` }));
  await handler(reqOf(body({ candidates: many })), res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

test('golden path: builds the workbook from the authoritatively-fetched request metadata (full envelope pin)', async () => {
  const res = mockRes();
  await handler(reqOf(body()), res);
  expect(res.statusCode).toBe(200);
  expect(DynamicsService.getRecord).toHaveBeenCalledWith('akoya_requests', REQUEST_ID, { select: REQUEST_SELECT });
  expect(buildReviewerCandidateWorkbook).toHaveBeenCalledWith({
    meta: expect.objectContaining({
      requestNumber: '1002794',
      institution: 'Example University',
      pi: 'Dr. Ada Lovelace',
      applicant: 'Example University',
      title: 'A Study',
      program: null,
      cycleLabel: 'June 2026',
    }),
    candidates: body().candidates,
  });
  expect(res.headers['Content-Type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  expect(res.headers['Content-Disposition']).toMatch(/^attachment; filename="(reviewer-candidates-1002794-\d{4}-\d{2}-\d{2}\.xlsx)"; filename\*=UTF-8''\1$/);
  expect(res.headers['Content-Length']).toBe(Buffer.from('xlsx-bytes').length);
  expect(res.body).toEqual(Buffer.from('xlsx-bytes'));
});

test('encodes quoted, Unicode, and CR/LF characters in the service filename', async () => {
  exportCandidates.mockResolvedValueOnce({
    buffer: Buffer.from('xlsx-bytes'),
    filename: 'bad"é\r\nInjected: yes.xlsx',
  });
  const res = mockRes();
  await handler(reqOf(body()), res);
  expect(res.headers['Content-Disposition']).toBe(
    `attachment; filename="bad_Injected: yes.xlsx"; filename*=UTF-8''bad%22%C3%A9Injected%3A%20yes.xlsx`,
  );
  expect(res.headers['Content-Disposition']).not.toMatch(/[\r\n]/);
  expect(res.body).toEqual(Buffer.from('xlsx-bytes'));
});

test('request not found → 404, no workbook built', async () => {
  DynamicsService.getRecord.mockRejectedValue(new Error('not found'));
  const res = mockRes();
  await handler(reqOf(body()), res);
  expect(res.statusCode).toBe(404);
  expect(buildReviewerCandidateWorkbook).not.toHaveBeenCalled();
});
