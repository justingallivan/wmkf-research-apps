/**
 * @jest-environment node
 *
 * lib/services/workbench/proposal-documents-service — logic-level tests
 * (adapter + list service mocked), Stage 4 series A extraction.
 */

const getById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getById(...a),
  SELECT_PROFILES: { DOCUMENT_SCOPE: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate' },
}));

const listProposalDocuments = jest.fn();
jest.mock('../../lib/services/workbench-proposal-documents', () => ({
  listProposalDocuments: (...a) => listProposalDocuments(...a),
}));

import { listWorkbenchProposalDocuments } from '../../lib/services/workbench/proposal-documents-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

const REQ = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
  getById.mockResolvedValue({ akoya_requestid: REQ, akoya_requestnum: '1002794', wmkf_meetingdate: '2026-06-01' });
  listProposalDocuments.mockResolvedValue({
    slots: [], reviewerMaterials: [], aiMaterials: [], otherDocuments: [], libraries: ['Documents'], errors: [],
  });
});

test('unresolvable request → ServiceHttpError 404; no listing attempted', async () => {
  getById.mockRejectedValue(new Error('not found'));
  const err = await listWorkbenchProposalDocuments({ requestId: REQ }).catch((e) => e);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(404);
  expect(err.message).toBe(`No request found for ${REQ}`);
  expect(listProposalDocuments).not.toHaveBeenCalled();
});

test('derives scope from the resolved record (id/number/cycle) and spreads the result', async () => {
  const body = await listWorkbenchProposalDocuments({ requestId: REQ });
  expect(getById).toHaveBeenCalledWith(REQ, { select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate' });
  expect(listProposalDocuments).toHaveBeenCalledWith(REQ, '1002794', 'J26');
  expect(body).toEqual({
    success: true,
    slots: [],
    reviewerMaterials: [],
    aiMaterials: [],
    otherDocuments: [],
    libraries: ['Documents'],
    errors: [],
  });
});

test('null meeting date → null cycle code passed through', async () => {
  getById.mockResolvedValue({ akoya_requestid: REQ, akoya_requestnum: '1002794', wmkf_meetingdate: null });
  await listWorkbenchProposalDocuments({ requestId: REQ });
  expect(listProposalDocuments).toHaveBeenCalledWith(REQ, '1002794', null);
});

test('listing failure propagates untyped (shell maps to 500)', async () => {
  listProposalDocuments.mockRejectedValue(new Error('graph down'));
  await expect(listWorkbenchProposalDocuments({ requestId: REQ })).rejects.toThrow('graph down');
});
