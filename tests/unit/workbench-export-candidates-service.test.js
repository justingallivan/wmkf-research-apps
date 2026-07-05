/**
 * @jest-environment node
 *
 * lib/services/workbench/export-candidates-service — logic-level tests
 * (adapter + workbook builder mocked), Stage 4 series A extraction. Pins the
 * authoritative meta derivation, filename sanitization, and the 404.
 */

const getById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getById(...a),
}));

const buildReviewerCandidateWorkbook = jest.fn();
jest.mock('../../lib/services/reviewer-candidate-export', () => ({
  buildReviewerCandidateWorkbook: (...a) => buildReviewerCandidateWorkbook(...a),
}));

import { exportCandidates } from '../../lib/services/workbench/export-candidates-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

const REQ = '11111111-1111-1111-1111-111111111111';
const CANDIDATES = [{ name: 'Ada Lovelace' }];

beforeEach(() => {
  jest.clearAllMocks();
  getById.mockResolvedValue({
    akoya_requestid: REQ,
    akoya_requestnum: '1002794',
    akoya_title: 'A Study',
    wmkf_organizationname: 'Example University',
    _wmkf_projectleader_value_formatted: 'Dr. Ada Lovelace',
    wmkf_meetingdate: '2026-06-01',
  });
  buildReviewerCandidateWorkbook.mockResolvedValue(Buffer.from('xlsx-bytes'));
});

test('request not found → ServiceHttpError 404, no workbook built', async () => {
  getById.mockRejectedValue(new Error('nope'));
  const err = await exportCandidates({ requestId: REQ, candidates: CANDIDATES }).catch((e) => e);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(404);
  expect(err.message).toBe('Request not found');
  expect(buildReviewerCandidateWorkbook).not.toHaveBeenCalled();
});

test('golden path: authoritative meta + dated filename', async () => {
  const { buffer, filename } = await exportCandidates({ requestId: REQ, candidates: CANDIDATES });
  expect(buildReviewerCandidateWorkbook).toHaveBeenCalledWith({
    meta: {
      requestNumber: '1002794',
      institution: 'Example University',
      pi: 'Dr. Ada Lovelace',
      applicant: null,
      title: 'A Study',
      program: null,
      cycleLabel: 'June 2026',
      exportedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    },
    candidates: CANDIDATES,
  });
  expect(buffer).toEqual(Buffer.from('xlsx-bytes'));
  expect(filename).toMatch(/^reviewer-candidates-1002794-\d{4}-\d{2}-\d{2}\.xlsx$/);
});

test('filename sanitizes the request number and falls back to "request"', async () => {
  getById.mockResolvedValue({ akoya_requestnum: 'a b/c', wmkf_meetingdate: null });
  let out = await exportCandidates({ requestId: REQ, candidates: CANDIDATES });
  expect(out.filename).toMatch(/^reviewer-candidates-a_b_c-/);

  getById.mockResolvedValue({ akoya_requestnum: null, wmkf_meetingdate: null });
  out = await exportCandidates({ requestId: REQ, candidates: CANDIDATES });
  expect(out.filename).toMatch(/^reviewer-candidates-request-/);
});
