/**
 * Logic-level unit tests for lib/services/review-manager/reviewers-service.js
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Adapters + resolvers mocked; covers the GET DTO early shapes and grouping,
 * and — critically — the PATCH batch SEQUENTIAL for…of: a midway failure
 * throws out with EARLIER updates already applied and later ids untouched
 * (no partial-success reporting, no parallelization).
 */

const updateLifecycle = jest.fn(async () => {});
const findByRequest = jest.fn();
const findAcceptedByPD = jest.fn();
const findAcceptedByCycle = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  updateLifecycle: (...a) => updateLifecycle(...a),
  findByRequest: (...a) => findByRequest(...a),
  findAcceptedByPD: (...a) => findAcceptedByPD(...a),
  findAcceptedByCycle: (...a) => findAcceptedByCycle(...a),
  RESPONSE_TYPE_BY_VALUE: { 100000000: 'accepted' },
  HONORARIUM_ELIGIBILITY_BY_VALUE: {
    100000000: 'eligible',
    100000001: 'not_eligible',
    100000002: 'not_applicable',
  },
}));
const getRequestById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getRequestById(...a),
  findByRequestNumber: jest.fn(async () => ({ records: [] })),
}));
const queryReviewers = jest.fn(async () => ({ records: [] }));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  queryReviewers: (...a) => queryReviewers(...a),
}));
const resolvePD = jest.fn();
jest.mock('../../lib/services/program-director-resolver', () => ({
  resolveByEmail: (...a) => resolvePD(...a),
}));
jest.mock('../../lib/services/review-answers', () => ({
  fetchAnswersBySuggestion: jest.fn(async () => ({})),
}));
jest.mock('../../lib/external/review-answer-snapshot', () => ({
  ratingsFromAnswers: jest.fn(() => ({ impact: null, risk: null, overallRating: null })),
}));
const getActiveQuestionSet = jest.fn(async () => []);
jest.mock('../../lib/external/review-question-fetcher', () => ({
  getActiveQuestionSet: (...a) => getActiveQuestionSet(...a),
}));

const REQ = '11111111-1111-4111-8111-111111111111';
const IDS = [
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];
const { REVIEW_STATUS_MAP } = require('../../shared/config/reviewerLifecycle');
const { TERMINAL_REVIEW_STATUS_VALUES } = require('../../shared/config/reviewerStatus');

let getReviewers;
let patchReviewers;
beforeAll(async () => {
  const mod = await import('../../lib/services/review-manager/reviewers-service');
  getReviewers = mod.getReviewers;
  patchReviewers = mod.patchReviewers;
});

beforeEach(() => {
  jest.clearAllMocks();
  updateLifecycle.mockImplementation(async () => {});
  findAcceptedByCycle.mockResolvedValue({ suggestions: [], requestById: {} });
});

describe('patchReviewers', () => {
  test('batch is a SEQUENTIAL loop in input order with per-id {reviewStatus} payloads', async () => {
    const order = [];
    updateLifecycle.mockImplementation(async (id) => { order.push(id); });
    const out = await patchReviewers({ suggestionIds: IDS, reviewStatus: 'under_review', actingUserSystemId: 'su-1' });
    expect(order).toEqual(IDS);
    expect(updateLifecycle).toHaveBeenCalledTimes(3);
    for (const call of updateLifecycle.mock.calls) {
      expect(call[1]).toEqual({ reviewStatus: 'under_review' });
      expect(call[2]).toEqual({ actingUserSystemId: 'su-1' });
    }
    expect(out).toEqual({ success: true, message: 'Updated 3 reviewers' });
  });

  test('midway batch failure: earlier updates already applied, later ids untouched, error propagates untyped', async () => {
    updateLifecycle
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('dataverse 500'));
    const err = await patchReviewers({ suggestionIds: IDS, reviewStatus: 'under_review', actingUserSystemId: null })
      .catch((e) => e);
    expect(err.message).toBe('dataverse 500'); // shell maps to the PATCH 500 envelope
    expect(updateLifecycle).toHaveBeenCalledTimes(2); // ids[0] applied, ids[1] failed, ids[2] never attempted
    expect(updateLifecycle.mock.calls[0][0]).toBe(IDS[0]);
    expect(updateLifecycle.mock.calls[1][0]).toBe(IDS[1]);
  });

  test('single update forwards the shell-built lifecycle object', async () => {
    const out = await patchReviewers({ suggestionId: IDS[0], lifecycle: { reviewStatus: 'under_review', notes: 'n' }, actingUserSystemId: 'su-1' });
    expect(updateLifecycle).toHaveBeenCalledWith(IDS[0], { reviewStatus: 'under_review', notes: 'n' }, { actingUserSystemId: 'su-1' });
    expect(out).toEqual({ success: true, message: 'Reviewer updated' });
  });

  test.each([
    'complete', ' Complete ', REVIEW_STATUS_MAP.complete,
    'withdrew', 'released', TERMINAL_REVIEW_STATUS_VALUES.withdrew,
  ])('generic PATCH service refuses dedicated status %s', async (reviewStatus) => {
    await expect(patchReviewers({
      suggestionId: IDS[0],
      lifecycle: { reviewStatus },
      actingUserSystemId: 'su-1',
    })).rejects.toMatchObject({ httpStatus: 400 });
    expect(updateLifecycle).not.toHaveBeenCalled();
  });
});

describe('getReviewers', () => {
  test('proposalId scope: unknown request → empty DTO (no programDirector key)', async () => {
    getRequestById.mockRejectedValueOnce(new Error('Get record failed (404)'));
    const out = await getReviewers({ proposalId: REQ, azureEmail: 'pd@wmkeck.org' });
    expect(out).toEqual({ success: true, proposals: [], totalReviewers: 0 });
    expect(resolvePD).not.toHaveBeenCalled();
  });

  test('default scope: unresolved PD → empty DTO WITH programDirector:null', async () => {
    resolvePD.mockResolvedValueOnce(null);
    const out = await getReviewers({ azureEmail: 'someone@wmkeck.org' });
    expect(out).toEqual({ success: true, proposals: [], totalReviewers: 0, programDirector: null });
  });

  test('all scope reads accepted reviewers across the specified cycle without resolving the caller as PD', async () => {
    const out = await getReviewers({ scope: 'all', cycleCode: 'D26', azureEmail: 'staff@wmkeck.org' });

    expect(findAcceptedByCycle).toHaveBeenCalledWith('D26');
    expect(findAcceptedByPD).not.toHaveBeenCalled();
    expect(resolvePD).not.toHaveBeenCalled();
    expect(out).toEqual({ success: true, proposals: [], totalReviewers: 0 });
  });

  test('all scope requires a cycle and never falls through to an unbounded query', async () => {
    await expect(getReviewers({ scope: 'all', azureEmail: 'staff@wmkeck.org' }))
      .rejects.toMatchObject({ httpStatus: 400, message: 'cycleCode is required when scope=all' });
    expect(findAcceptedByCycle).not.toHaveBeenCalled();
    expect(resolvePD).not.toHaveBeenCalled();
  });

  test('proposalId scope groups accepted suggestions into the proposal DTO with liveQuestions', async () => {
    getRequestById.mockResolvedValueOnce({
      akoya_requestid: REQ,
      akoya_requestnum: 'R-1001',
      akoya_title: 'T',
      wmkf_meetingdate: null,
      wmkf_reviewduedate: '2026-09-09',
    });
    findByRequest.mockResolvedValueOnce([
      {
        wmkf_appreviewersuggestionid: IDS[0],
        _wmkf_request_value: REQ,
        _wmkf_potentialreviewer_value: 'person-1',
        wmkf_accepted: true,
        wmkf_reviewstatus: 100000001,
        wmkf_reviewduedateoverride: '2026-09-15',
        wmkf_honorariumeligibility: 100000000,
        wmkf_honorariumoptout: false,
        _wmkf_honorariumrequest_value: 'honorarium-1',
      },
      { wmkf_appreviewersuggestionid: IDS[1], _wmkf_request_value: REQ, wmkf_accepted: false },
    ]);
    getActiveQuestionSet.mockResolvedValueOnce([{ key: 'impact', order: 1, label: 'Impact?', type: 'picklist' }]);
    const out = await getReviewers({ proposalId: REQ, azureEmail: 'pd@wmkeck.org' });
    expect(out.success).toBe(true);
    expect(out.totalReviewers).toBe(1); // non-accepted row filtered out
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].reviewDeadline).toBe('2026-09-09');
    expect(out.proposals[0].reviewers[0]).toMatchObject({
      suggestionId: IDS[0],
      reviewStatus: 'materials_sent',
      tokenState: 'not_minted',
      reviewDueDateOverride: '2026-09-15',
      effectiveReviewDeadline: '2026-09-15',
      honorariumEligibility: 'eligible',
      honorariumOptOut: false,
      honorariumRequestId: 'honorarium-1',
      answers: [],
    });
    expect(out.proposals[0].statusSummary).toEqual({ materials_sent: 1 });
    expect(out.liveQuestions).toEqual([{ key: 'impact', order: 1, text: 'Impact?', type: 'picklist' }]);
  });

  test('default PD scope carries the request review deadline into the proposal DTO', async () => {
    resolvePD.mockResolvedValueOnce({ systemuserid: 'pd-1' });
    findAcceptedByPD.mockResolvedValueOnce({
      requestById: {
        [REQ]: {
          requestId: REQ,
          requestNumber: 'R-1001',
          title: 'T',
          reviewDeadline: '2026-09-09',
          meetingCycleCode: null,
        },
      },
      suggestions: [{
        wmkf_appreviewersuggestionid: IDS[0],
        _wmkf_request_value: REQ,
        _wmkf_potentialreviewer_value: 'person-1',
        wmkf_accepted: true,
        wmkf_reviewstatus: 100000001,
      }],
    });

    const out = await getReviewers({ azureEmail: 'pd@wmkeck.org' });

    expect(out.proposals[0].reviewDeadline).toBe('2026-09-09');
  });

  test('chunk boundary: 26 distinct person ids yield EXACTLY 2 total queryReviewers calls (merged read), first call gets ids 0-24 in order, second gets id 25, and every call select includes both former person-only and researcher-only fields', async () => {
    getRequestById.mockResolvedValueOnce({
      akoya_requestid: REQ, akoya_requestnum: 'R-1001', akoya_title: 'T', wmkf_meetingdate: null,
    });
    const personIds = Array.from({ length: 26 }, (_, i) => `person-${i}`);
    findByRequest.mockResolvedValueOnce(
      personIds.map((pid, i) => ({
        wmkf_appreviewersuggestionid: `sug-${i}`,
        _wmkf_request_value: REQ,
        _wmkf_potentialreviewer_value: pid,
        wmkf_accepted: true,
        wmkf_reviewstatus: 100000001,
      })),
    );

    await getReviewers({ proposalId: REQ, azureEmail: 'pd@wmkeck.org' });

    // Stage 2 read coalescing collapsed the former person + researcher sibling
    // reads into ONE chunked read over the same entity/filter/select. An
    // exact call count of 2 fails if the duplicate pair ever returns.
    expect(queryReviewers.mock.calls).toHaveLength(2);
    expect(queryReviewers.mock.calls[0][0].filter.split(' or ')).toEqual(
      personIds.slice(0, 25).map((id) => `wmkf_potentialreviewersid eq ${id}`),
    );
    expect(queryReviewers.mock.calls[1][0].filter.split(' or ')).toEqual(
      personIds.slice(25).map((id) => `wmkf_potentialreviewersid eq ${id}`),
    );
    for (const call of queryReviewers.mock.calls) {
      expect(call[0].select).toEqual(expect.stringContaining('wmkf_name'));
      expect(call[0].select).toEqual(expect.stringContaining('wmkf_primaryaffiliation'));
    }
  });

  test('single-chunk exact count: 2 person ids → exactly 1 queryReviewers call', async () => {
    getRequestById.mockResolvedValueOnce({
      akoya_requestid: REQ, akoya_requestnum: 'R-1001', akoya_title: 'T', wmkf_meetingdate: null,
    });
    findByRequest.mockResolvedValueOnce([
      { wmkf_appreviewersuggestionid: IDS[0], _wmkf_request_value: REQ, _wmkf_potentialreviewer_value: 'person-a', wmkf_accepted: true, wmkf_reviewstatus: 100000001 },
      { wmkf_appreviewersuggestionid: IDS[1], _wmkf_request_value: REQ, _wmkf_potentialreviewer_value: 'person-b', wmkf_accepted: true, wmkf_reviewstatus: 100000001 },
    ]);

    await getReviewers({ proposalId: REQ, azureEmail: 'pd@wmkeck.org' });

    expect(queryReviewers).toHaveBeenCalledTimes(1);
  });

  test('empty person-id set (no suggestion has a _wmkf_potentialreviewer_value) → queryReviewers never called', async () => {
    getRequestById.mockResolvedValueOnce({
      akoya_requestid: REQ, akoya_requestnum: 'R-1001', akoya_title: 'T', wmkf_meetingdate: null,
    });
    findByRequest.mockResolvedValueOnce([
      { wmkf_appreviewersuggestionid: IDS[0], _wmkf_request_value: REQ, _wmkf_potentialreviewer_value: null, wmkf_accepted: true, wmkf_reviewstatus: 100000001 },
    ]);

    await getReviewers({ proposalId: REQ, azureEmail: 'pd@wmkeck.org' });

    expect(queryReviewers).not.toHaveBeenCalled();
  });

  test('projection completeness: merged select contains every field from both former split selects', async () => {
    const FORMER_PERSON_SELECT = ['wmkf_potentialreviewersid', 'wmkf_name', 'wmkf_emailaddress', 'wmkf_organizationname'];
    const FORMER_RESEARCHER_SELECT = ['wmkf_potentialreviewersid', 'wmkf_primaryaffiliation', 'wmkf_website', 'wmkf_hindex', 'wmkf_totalcitations'];

    getRequestById.mockResolvedValueOnce({
      akoya_requestid: REQ, akoya_requestnum: 'R-1001', akoya_title: 'T', wmkf_meetingdate: null,
    });
    findByRequest.mockResolvedValueOnce([
      { wmkf_appreviewersuggestionid: IDS[0], _wmkf_request_value: REQ, _wmkf_potentialreviewer_value: 'person-a', wmkf_accepted: true, wmkf_reviewstatus: 100000001 },
    ]);

    await getReviewers({ proposalId: REQ, azureEmail: 'pd@wmkeck.org' });

    const actualSelectFields = queryReviewers.mock.calls[0][0].select.split(',');
    for (const field of [...FORMER_PERSON_SELECT, ...FORMER_RESEARCHER_SELECT]) {
      expect(actualSelectFields).toContain(field);
    }
  });

  test('hydration equivalence: a merged record hydrates the reviewer DTO exactly as the two split records used to', async () => {
    getRequestById.mockResolvedValueOnce({
      akoya_requestid: REQ, akoya_requestnum: 'R-1001', akoya_title: 'T', wmkf_meetingdate: null,
    });
    findByRequest.mockResolvedValueOnce([
      { wmkf_appreviewersuggestionid: IDS[0], _wmkf_request_value: REQ, _wmkf_potentialreviewer_value: 'person-a', wmkf_accepted: true, wmkf_reviewstatus: 100000001 },
      { wmkf_appreviewersuggestionid: IDS[1], _wmkf_request_value: REQ, _wmkf_potentialreviewer_value: 'person-missing', wmkf_accepted: true, wmkf_reviewstatus: 100000001 },
    ]);
    queryReviewers.mockResolvedValueOnce({
      records: [{
        wmkf_potentialreviewersid: 'person-a',
        wmkf_name: 'Dr. A',
        wmkf_emailaddress: 'a@example.com',
        wmkf_organizationname: 'Fallback Org',
        wmkf_primaryaffiliation: 'Primary Affiliation',
        wmkf_website: 'https://example.com',
        wmkf_hindex: 12,
        wmkf_totalcitations: 345,
      }],
    });

    const out = await getReviewers({ proposalId: REQ, azureEmail: 'pd@wmkeck.org' });

    const found = out.proposals[0].reviewers.find((r) => r.suggestionId === IDS[0]);
    expect(found).toMatchObject({
      name: 'Dr. A',
      email: 'a@example.com',
      affiliation: 'Primary Affiliation', // prefers wmkf_primaryaffiliation over wmkf_organizationname
      website: 'https://example.com',
      hIndex: 12,
      totalCitations: 345,
    });

    const missing = out.proposals[0].reviewers.find((r) => r.suggestionId === IDS[1]);
    expect(missing).toMatchObject({
      name: null,
      affiliation: null,
      email: null,
      website: null,
      hIndex: null,
      totalCitations: null,
    });
  });

  test('affiliation fallback: missing wmkf_primaryaffiliation falls back to wmkf_organizationname', async () => {
    getRequestById.mockResolvedValueOnce({
      akoya_requestid: REQ, akoya_requestnum: 'R-1001', akoya_title: 'T', wmkf_meetingdate: null,
    });
    findByRequest.mockResolvedValueOnce([
      { wmkf_appreviewersuggestionid: IDS[0], _wmkf_request_value: REQ, _wmkf_potentialreviewer_value: 'person-a', wmkf_accepted: true, wmkf_reviewstatus: 100000001 },
    ]);
    queryReviewers.mockResolvedValueOnce({
      records: [{
        wmkf_potentialreviewersid: 'person-a',
        wmkf_name: 'Dr. A',
        wmkf_emailaddress: 'a@example.com',
        wmkf_organizationname: 'Fallback Org',
      }],
    });

    const out = await getReviewers({ proposalId: REQ, azureEmail: 'pd@wmkeck.org' });

    expect(out.proposals[0].reviewers[0].affiliation).toBe('Fallback Org');
  });

  test('merged-read rejection propagates untyped (fail-hard preserved)', async () => {
    getRequestById.mockResolvedValueOnce({
      akoya_requestid: REQ, akoya_requestnum: 'R-1001', akoya_title: 'T', wmkf_meetingdate: null,
    });
    findByRequest.mockResolvedValueOnce([
      { wmkf_appreviewersuggestionid: IDS[0], _wmkf_request_value: REQ, _wmkf_potentialreviewer_value: 'person-a', wmkf_accepted: true, wmkf_reviewstatus: 100000001 },
    ]);
    queryReviewers.mockRejectedValueOnce(new Error('dataverse 500'));

    await expect(getReviewers({ proposalId: REQ, azureEmail: 'pd@wmkeck.org' }))
      .rejects.toThrow('dataverse 500');
  });
});
