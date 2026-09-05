/**
 * @jest-environment node
 *
 * Characterization coverage for pages/api/reviewer-finder/my-candidates.js
 * (Stage 3 reviewer-finder wave, docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md).
 * Multi-verb route (P1m applies) — GET/PATCH/DELETE pinned SEPARATELY per the
 * per-wave contract minimum, each with its own auth/method/envelope/error
 * coverage. Duplicate-email partial-save + savedFields semantics stay in
 * tests/unit/my-candidates-partial-save-on-email-conflict.test.js (not
 * duplicated here). This file pins CURRENT behavior only — no refactor.
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({
    session: { user: { azureEmail: 'pd@example.org', dynamicsSystemuserId: 'u-1' } },
  })),
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/reviewer-request-authorization', () => ({
  authorizeReviewerRequestMutation: jest.fn(async () => ({})),
}));
jest.mock('../../lib/services/program-director-resolver', () => ({
  resolveByEmail: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  __esModule: true,
  getById: jest.fn(),
  findByRequestNumber: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/account', () => ({
  __esModule: true,
  queryAccounts: jest.fn(async () => ({ records: [] })),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  findByRequest: jest.fn(async () => []),
  findRemovedByRequest: jest.fn(async () => []),
  findByPD: jest.fn(async () => ({ suggestions: [], requestById: {} })),
  aggregateReviewHistory: jest.fn(async () => ({})),
  findById: jest.fn(),
  updateLifecycle: jest.fn(async () => {}),
  restore: jest.fn(async () => {}),
  softDelete: jest.fn(async () => {}),
  bulkUpdateByRequest: jest.fn(async () => 0),
  APPLICANT_DISPOSITION_MAP: { recommended: 100000000 },
  RESPONSE_TYPE_BY_VALUE: {},
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  __esModule: true,
  queryReviewers: jest.fn(async () => ({ records: [] })),
  update: jest.fn(async () => {}),
  findByEmailCandidates: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  __esModule: true,
  updateById: jest.fn(async () => {}),
}));
jest.mock('../../lib/external/token-lifecycle', () => ({ ensureToken: jest.fn() }));
jest.mock('../../lib/dataverse/duplicate-key', () => ({ translateDuplicateKeyError: jest.fn(() => null) }));

// "Remove entirely" — a distinct service module; mocked wholesale here since
// its own orchestration logic is pinned in tests/unit/remove-candidate-service.test.js.
// This file only pins the ROUTE's dispatch/auth/error-mapping for mode=hard
// and the removal-preflight GET mode.
jest.mock('../../lib/services/reviewer-finder/remove-candidate-service', () => ({
  __esModule: true,
  describeRemoval: jest.fn(),
  removeCandidateEntirely: jest.fn(),
}));

const { requireAppAccess } = require('../../lib/utils/auth');
const { resolveByEmail } = require('../../lib/services/program-director-resolver');
const grantRequestAdapter = require('../../lib/dataverse/adapters/grant-request');
const suggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const { describeRemoval, removeCandidateEntirely } = require('../../lib/services/reviewer-finder/remove-candidate-service');
const { authorizeReviewerRequestMutation } = require('../../lib/services/reviewer-request-authorization');

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const SUGGESTION_ID = '33333333-3333-3333-3333-333333333333';
const PERSON_ID = '22222222-2222-2222-2222-222222222222';

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  res.setHeader = jest.fn();
  return res;
}

let handler;
beforeAll(() => {
  handler = require('../../pages/api/reviewer-finder/my-candidates').default;
});

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({
    session: { user: { azureEmail: 'pd@example.org', dynamicsSystemuserId: 'u-1' } },
  });
});

describe('wrapper-level dispatch', () => {
  test('wrong method (PUT) → 405', async () => {
    const req = { method: 'PUT', query: {}, body: {} };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });

  test('unauthenticated (requireAppAccess denies) → route returns immediately, no adapter calls', async () => {
    requireAppAccess.mockImplementationOnce(async (req, resp) => {
      resp.status(401).json({ error: 'Authentication required' });
      return null;
    });
    const req = { method: 'GET', query: {}, body: {} };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required' });
    expect(resolveByEmail).not.toHaveBeenCalled();
    expect(suggestionAdapter.findByPD).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  test('happy path (single-request scope, requestId): envelope pinned exactly', async () => {
    grantRequestAdapter.getById.mockResolvedValue({
      akoya_requestid: REQUEST_ID,
      akoya_requestnum: 'R-1',
      akoya_title: 'A Proposal',
      wmkf_meetingdate: '2026-06-15',
      wmkf_abstract: 'Abstract text',
      _akoya_applicantid_value: null,
      _wmkf_projectleader_value: null,
      _wmkf_grantprogram_value: null,
      _wmkf_programareaserved_value: null,
      _wmkf_programdirector_value: 'pd-1',
    });
    suggestionAdapter.findByRequest.mockResolvedValue([{
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_request_value: REQUEST_ID,
      _wmkf_potentialreviewer_value: PERSON_ID,
      wmkf_sources: 'literature_retrieved',
      wmkf_selected: true,
      wmkf_relevancescore: 0.9,
      wmkf_matchreason: 'Strong topical match',
    }]);
    potentialReviewerAdapter.queryReviewers.mockResolvedValue({
      records: [{ wmkf_potentialreviewersid: PERSON_ID, wmkf_name: 'Dr X', wmkf_emailaddress: 'x@example.org', wmkf_primaryaffiliation: 'MIT' }],
    });

    const req = { method: 'GET', query: { requestId: REQUEST_ID }, body: {} };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.totalCandidates).toBe(1);
    expect(res.body.proposals).toHaveLength(1);
    expect(res.body.proposals[0]).toEqual(expect.objectContaining({
      proposalId: REQUEST_ID,
      proposalTitle: 'A Proposal',
      requestNumber: 'R-1',
    }));
    expect(res.body.proposals[0].candidates).toEqual([expect.objectContaining({
      suggestionId: SUGGESTION_ID,
      potentialReviewerId: PERSON_ID,
      name: 'Dr X',
      affiliation: 'MIT',
      email: 'x@example.org',
      relevanceScore: 0.9,
      reasoning: 'Strong topical match',
      invited: false,
      accepted: false,
      declined: false,
    })]);
  });

  test('domain error: requestId not a valid GUID → 400', async () => {
    const req = { method: 'GET', query: { requestId: 'not-a-guid' }, body: {} };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'requestId is not a valid GUID' });
    expect(grantRequestAdapter.getById).not.toHaveBeenCalled();
  });

  test('PD-scope with no resolvable PD → 200 empty envelope with programDirector: null', async () => {
    resolveByEmail.mockResolvedValue(null);
    const req = { method: 'GET', query: {}, body: {} };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, proposals: [], totalCandidates: 0, programDirector: null });
  });
});

describe('PATCH', () => {
  test('happy path (per-suggestion lifecycle edit): envelope pinned exactly', async () => {
    authorizeReviewerRequestMutation.mockResolvedValueOnce({ requestIds: [REQUEST_ID], isSuperuser: false });
    suggestionAdapter.findById.mockResolvedValueOnce({ _wmkf_request_value: REQUEST_ID, wmkf_reviewstatus: null, _etag: 'W/"route-happy-1"' });
    const req = {
      method: 'PATCH',
      query: {},
      body: { suggestionId: SUGGESTION_ID, invited: true },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Candidate updated',
      updated: { suggestionId: SUGGESTION_ID, invited: true },
    });
    expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledWith(
      SUGGESTION_ID, { invited: true }, { actingUserSystemId: 'u-1', ifMatch: 'W/"route-happy-1"' },
    );
    expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({
      profileId: undefined,
      callerSystemId: 'u-1',
      suggestionIds: [SUGGESTION_ID],
    });
  });

  test('happy path (bulk-by-request edit): envelope pinned exactly', async () => {
    suggestionAdapter.bulkUpdateByRequest.mockResolvedValue(3);
    const req = {
      method: 'PATCH',
      query: {},
      body: { proposalId: REQUEST_ID, programArea: 'Science' },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Proposal updated',
      updated: { proposalId: REQUEST_ID, programArea: 'Science', suggestionsUpdated: 3 },
    });
    expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({
      profileId: undefined,
      callerSystemId: 'u-1',
      requestIds: [REQUEST_ID],
    });
  });

  test('domain error: neither suggestionId nor proposalId → 400', async () => {
    const req = { method: 'PATCH', query: {}, body: {} };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'suggestionId or proposalId is required' });
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  });

  test('domain error: suggestionId not a valid GUID → 400', async () => {
    const req = { method: 'PATCH', query: {}, body: { suggestionId: 'not-a-guid', invited: true } };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'suggestionId is not a valid GUID' });
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  });
});

describe('DELETE', () => {
  test('happy path: envelope pinned exactly', async () => {
    const req = { method: 'DELETE', query: {}, body: { suggestionId: SUGGESTION_ID } };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Candidate removed' });
    expect(suggestionAdapter.softDelete).toHaveBeenCalledWith(
      SUGGESTION_ID, { actingUserSystemId: 'u-1', alsoRevokeToken: true },
    );
    expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({
      profileId: undefined,
      callerSystemId: 'u-1',
      suggestionIds: [SUGGESTION_ID],
    });
  });

  test('domain error: missing suggestionId → 400', async () => {
    const req = { method: 'DELETE', query: {}, body: {} };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'suggestionId is required' });
    expect(suggestionAdapter.softDelete).not.toHaveBeenCalled();
  });

  test('domain error: suggestionId not a valid GUID → 400', async () => {
    const req = { method: 'DELETE', query: {}, body: { suggestionId: 'not-a-guid' } };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'suggestionId is not a valid GUID' });
    expect(suggestionAdapter.softDelete).not.toHaveBeenCalled();
  });

  describe('mode: hard ("Remove entirely")', () => {
    test('happy path: dispatches to removeCandidateEntirely (not softDelete), envelope passed through', async () => {
      removeCandidateEntirely.mockResolvedValue({
        success: true,
        suggestionId: SUGGESTION_ID,
        honorariumDeleted: true,
        answerRowsDeleted: 2,
        contactDeleted: false,
        draftDeleted: true,
        auditAlertId: 42,
      });
      const req = {
        method: 'DELETE',
        query: {},
        body: { suggestionId: SUGGESTION_ID, mode: 'hard' },
      };
      const res = mockRes();
      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({ success: true, suggestionId: SUGGESTION_ID }));
      expect(removeCandidateEntirely).toHaveBeenCalledWith({
        suggestionId: SUGGESTION_ID,
        deleteContact: false,
        actingUserSystemId: 'u-1',
      });
      expect(suggestionAdapter.softDelete).not.toHaveBeenCalled();
    });

    test('deleteContact:true is forwarded through', async () => {
      removeCandidateEntirely.mockResolvedValue({ success: true });
      const req = {
        method: 'DELETE',
        query: {},
        body: { suggestionId: SUGGESTION_ID, mode: 'hard', deleteContact: true },
      };
      const res = mockRes();
      await handler(req, res);

      expect(removeCandidateEntirely).toHaveBeenCalledWith({
        suggestionId: SUGGESTION_ID,
        deleteContact: true,
        actingUserSystemId: 'u-1',
      });
    });

    test('partial cleanup warnings from the service are surfaced in the API response', async () => {
      removeCandidateEntirely.mockResolvedValue({
        success: true,
        suggestionId: SUGGESTION_ID,
        partialFailure: 'postgres_draft_delete_failed',
        warnings: ['postgres_draft_delete_failed'],
        postgresError: 'pg connection reset',
      });
      const req = {
        method: 'DELETE',
        query: {},
        body: { suggestionId: SUGGESTION_ID, mode: 'hard' },
      };
      const res = mockRes();
      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({
        success: true,
        suggestionId: SUGGESTION_ID,
        partialFailure: 'postgres_draft_delete_failed',
        warnings: ['postgres_draft_delete_failed'],
        postgresError: 'pg connection reset',
      }));
    });

    test('same GUID-validation gate as the soft-delete path: invalid suggestionId → 400, service never called', async () => {
      const req = { method: 'DELETE', query: {}, body: { suggestionId: 'not-a-guid', mode: 'hard' } };
      const res = mockRes();
      await handler(req, res);

      expect(res.statusCode).toBe(400);
      expect(removeCandidateEntirely).not.toHaveBeenCalled();
    });

    test('unauthenticated → same app-access gate as every other verb, service never called', async () => {
      requireAppAccess.mockImplementationOnce(async (req, resp) => {
        resp.status(401).json({ error: 'Authentication required' });
        return null;
      });
      const req = { method: 'DELETE', query: {}, body: { suggestionId: SUGGESTION_ID, mode: 'hard' } };
      const res = mockRes();
      await handler(req, res);

      expect(res.statusCode).toBe(401);
      expect(removeCandidateEntirely).not.toHaveBeenCalled();
    });

    test('domain ServiceHttpError from the service → mapped status/body', async () => {
      const { ServiceHttpError } = require('../../lib/services/service-http-error');
      removeCandidateEntirely.mockRejectedValue(new ServiceHttpError('nope', { httpStatus: 409, body: { error: 'nope' } }));
      const req = { method: 'DELETE', query: {}, body: { suggestionId: SUGGESTION_ID, mode: 'hard' } };
      const res = mockRes();
      await handler(req, res);

      expect(res.statusCode).toBe(409);
      expect(res.body).toEqual({ error: 'nope' });
    });

    test('unexpected error → 500', async () => {
      removeCandidateEntirely.mockRejectedValue(new Error('dataverse down'));
      const req = { method: 'DELETE', query: {}, body: { suggestionId: SUGGESTION_ID, mode: 'hard' } };
      const res = mockRes();
      await handler(req, res);

      expect(res.statusCode).toBe(500);
      expect(res.body.error).toBe('Failed to remove candidate entirely');
    });
  });
});

describe('GET mode: removal-preflight', () => {
  test('happy path: returns the disclosure', async () => {
    describeRemoval.mockResolvedValue({
      suggestionId: SUGGESTION_ID,
      requestId: REQUEST_ID,
      requestNumber: 'R-1',
      honorarium: null,
      hasSubmittedReview: false,
      answerRowCount: 0,
      contactId: null,
      contactAssociations: null,
      reviewFile: {
        folder: 'REQ-1/Reviewer_Uploads/Jane',
        filename: 'review.pdf',
        wmkf_reviewsharepointfolder: 'REQ-1/Reviewer_Uploads/Jane',
        wmkf_reviewfilename: 'review.pdf',
      },
      reviewSharePointFolder: 'REQ-1/Reviewer_Uploads/Jane',
      reviewFilename: 'review.pdf',
    });
    const req = { method: 'GET', query: { mode: 'removal-preflight', suggestionId: SUGGESTION_ID }, body: {} };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      suggestionId: SUGGESTION_ID,
      reviewSharePointFolder: 'REQ-1/Reviewer_Uploads/Jane',
      reviewFilename: 'review.pdf',
    }));
    expect(describeRemoval).toHaveBeenCalledWith({ suggestionId: SUGGESTION_ID });
  });

  test('missing suggestionId → 400, service never called', async () => {
    const req = { method: 'GET', query: { mode: 'removal-preflight' }, body: {} };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(describeRemoval).not.toHaveBeenCalled();
  });

  test('invalid suggestionId GUID → 400', async () => {
    const req = { method: 'GET', query: { mode: 'removal-preflight', suggestionId: 'not-a-guid' }, body: {} };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(describeRemoval).not.toHaveBeenCalled();
  });
});

describe('Stage 1D request authorization binding and conflict envelopes', () => {
  const OTHER_REQUEST = '44444444-4444-4444-4444-444444444444';
  beforeEach(() => {
    authorizeReviewerRequestMutation.mockReset().mockResolvedValue({ requestIds: [REQUEST_ID], isSuperuser: false });
    suggestionAdapter.findById.mockReset().mockResolvedValue({
      _wmkf_request_value: REQUEST_ID, wmkf_reviewstatus: null,
      wmkf_completedat: null, _etag: 'W/"route-1"',
    });
    suggestionAdapter.updateLifecycle.mockReset().mockResolvedValue(undefined);
  });
  test('uses server-derived binding and ignores a spoofed body binding', async () => {
    const res = mockRes();
    await handler({ method: 'PATCH', query: {}, body: {
      suggestionId: SUGGESTION_ID, invited: true, authorizedRequestId: OTHER_REQUEST,
    } }, res);
    expect(res.statusCode).toBe(200);
    expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledWith(SUGGESTION_ID, { invited: true }, { actingUserSystemId: 'u-1', ifMatch: 'W/"route-1"' });
  });
  test('a body binding cannot authorize a suggestion reparented after the ownership check', async () => {
    suggestionAdapter.findById.mockResolvedValue({ _wmkf_request_value: OTHER_REQUEST, wmkf_reviewstatus: null, _etag: 'W/"moved"' });
    const res = mockRes();
    await handler({ method: 'PATCH', query: {}, body: {
      suggestionId: SUGGESTION_ID, invited: true, authorizedRequestId: OTHER_REQUEST,
    } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'correction_request_changed' });
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  });
  test('authorization denial precedes the service lifecycle read and write', async () => {
    const { ServiceHttpError } = require('../../lib/services/service-http-error');
    authorizeReviewerRequestMutation.mockRejectedValueOnce(new ServiceHttpError('Forbidden', { httpStatus: 403 }));
    const res = mockRes();
    await handler({ method: 'PATCH', query: {}, body: { suggestionId: SUGGESTION_ID, invited: true } }, res);
    expect(res.statusCode).toBe(403);
    expect(suggestionAdapter.findById).not.toHaveBeenCalled();
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  });
  test.each([
    [{ wmkf_reviewstatus: 100000004 }, 'correction_closed'],
    [{ wmkf_reviewstatus: undefined }, 'correction_state_unavailable'],
    [{ _etag: '*' }, 'correction_version_unavailable'],
  ])('returns service source/version failure as HTTP 409: %j', async (overrides, code) => {
    suggestionAdapter.findById.mockResolvedValue({
      _wmkf_request_value: REQUEST_ID, wmkf_reviewstatus: null, _etag: 'W/"route-1"', ...overrides,
    });
    const res = mockRes();
    await handler({ method: 'PATCH', query: {}, body: { suggestionId: SUGGESTION_ID, accepted: true } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code });
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  });
  test('maps rejected conditional write to HTTP 409 without retry', async () => {
    suggestionAdapter.updateLifecycle.mockRejectedValueOnce(Object.assign(new Error('Precondition failed'), { status: 412 }));
    const res = mockRes();
    await handler({ method: 'PATCH', query: {}, body: { suggestionId: SUGGESTION_ID, invited: true } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'correction_conflict' });
    expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledTimes(1);
  });
});
