/**
 * @jest-environment node
 *
 * lib/services/workbench/export-candidates-service — logic-level tests
 * (adapter + workbook builder mocked), Stage 4 series A extraction. Pins the
 * authoritative meta derivation, filename sanitization, and the 404.
 */

const getById = jest.fn();
const queryRequests = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getById(...a),
  queryRequests: (...a) => queryRequests(...a),
}));
// Grant Cycle link helpers: real strings and the real row reader, without the
// restriction context the adapter-mocked service never establishes.
jest.mock('../../lib/dataverse/adapters/operations-grant-cycle', () => ({
  linkedCycleExpand: () => 'wmkf_GrantCycle($select=wmkf_cyclecode)',
  linkedCycleCode: (row) => {
    const code = row?.wmkf_GrantCycle?.wmkf_cyclecode;
    return typeof code === 'string' && /^[JD]\d{2}$/.test(code) ? code : null;
  },
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
    wmkf_organizationname: 'N/A',
    _akoya_applicantid_value_formatted: 'Example University',
    _wmkf_projectleader_value_formatted: 'Dr. Ada Lovelace',
    wmkf_meetingdate: '2026-06-01',
    wmkf_GrantCycle: { wmkf_cyclecode: 'J26' },
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
      applicant: 'Example University',
      title: 'A Study',
      program: null,
      cycleLabel: 'June 2026',
      exportedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    },
    candidates: CANDIDATES,
  });
  expect(getById).toHaveBeenCalledWith(REQ, expect.objectContaining({
    expand: 'wmkf_GrantCycle($select=wmkf_cyclecode)',
  }));
  expect(getById.mock.calls[0][1].select.split(',')).toContain('wmkf_meetingdate');
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

test('a June meeting date without a Grant Cycle link exports no cycle label', async () => {
  getById.mockResolvedValue({ akoya_requestnum: '1002794', wmkf_meetingdate: '2026-06-01' });
  await exportCandidates({ requestId: REQ, candidates: CANDIDATES });
  expect(buildReviewerCandidateWorkbook.mock.calls[0][0].meta.cycleLabel).toBeNull();
});

test('with test-request isolation on, the ordinary-request read carries the Grant Cycle expand', async () => {
  const previous = process.env.TEST_REQUEST_ISOLATION;
  process.env.TEST_REQUEST_ISOLATION = 'on';
  try {
    queryRequests.mockResolvedValue({ records: [{ akoya_requestnum: '1002794', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' } }] });
    await exportCandidates({ requestId: REQ, candidates: CANDIDATES });
    expect(getById).not.toHaveBeenCalled();
    expect(queryRequests).toHaveBeenCalledWith(expect.objectContaining({
      expand: 'wmkf_GrantCycle($select=wmkf_cyclecode)',
      filter: expect.stringContaining(`(akoya_requestid eq ${REQ}) and (`),
      top: 1,
    }));
    expect(buildReviewerCandidateWorkbook.mock.calls[0][0].meta.cycleLabel).toBe('December 2026');
  } finally {
    if (previous === undefined) delete process.env.TEST_REQUEST_ISOLATION;
    else process.env.TEST_REQUEST_ISOLATION = previous;
  }
});
