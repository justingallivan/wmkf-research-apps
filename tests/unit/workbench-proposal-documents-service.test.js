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
import { DynamicsService } from '../../lib/services/dynamics-service';

const REQ = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
  getById.mockResolvedValue({
    akoya_requestid: REQ, akoya_requestnum: '1002794', wmkf_meetingdate: '2026-06-01', wmkf_GrantCycle: { wmkf_cyclecode: 'J26' },
  });
  // The link helpers check the wmkf_grantcycle restriction (covered in grant-cycle-link.test.js).
  jest.spyOn(DynamicsService, 'checkRestriction').mockImplementation(() => {});
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
  expect(getById).toHaveBeenCalledWith(REQ, {
    select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate',
    expand: 'wmkf_GrantCycle($select=wmkf_cyclecode)',
  });
  expect(listProposalDocuments).toHaveBeenCalledWith(REQ, '1002794', 'J26');
  expect(body).toEqual({
    success: true,
    boardWriteups: [],
    slots: [],
    reviewerMaterials: [],
    aiMaterials: [],
    otherDocuments: [],
    libraries: ['Documents'],
    errors: [],
  });
});

test('no Grant Cycle link → null cycle code passed through, even with a June meeting date', async () => {
  getById.mockResolvedValue({ akoya_requestid: REQ, akoya_requestnum: '1002794', wmkf_meetingdate: '2026-06-01' });
  await listWorkbenchProposalDocuments({ requestId: REQ });
  expect(listProposalDocuments).toHaveBeenCalledWith(REQ, '1002794', null);
});

test('listing failure propagates untyped (shell maps to 500)', async () => {
  listProposalDocuments.mockRejectedValue(new Error('graph down'));
  await expect(listWorkbenchProposalDocuments({ requestId: REQ })).rejects.toThrow('graph down');
});
