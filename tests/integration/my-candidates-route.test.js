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

const { requireAppAccess } = require('../../lib/utils/auth');
const { resolveByEmail } = require('../../lib/services/program-director-resolver');
const grantRequestAdapter = require('../../lib/dataverse/adapters/grant-request');
const suggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');

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
    potentialReviewerAdapter.queryReviewers.mockImplementation(async ({ select }) => {
      if (select.includes('wmkf_organizationname')) {
        return { records: [{ wmkf_potentialreviewersid: PERSON_ID, wmkf_name: 'Dr X', wmkf_emailaddress: 'x@example.org' }] };
      }
      return { records: [{ wmkf_potentialreviewersid: PERSON_ID, wmkf_primaryaffiliation: 'MIT' }] };
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
      SUGGESTION_ID, { invited: true }, { actingUserSystemId: 'u-1' },
    );
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
});
