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
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  updateLifecycle: (...a) => updateLifecycle(...a),
  findByRequest: (...a) => findByRequest(...a),
  findAcceptedByPD: (...a) => findAcceptedByPD(...a),
  RESPONSE_TYPE_BY_VALUE: { 100000000: 'accepted' },
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
});

describe('patchReviewers', () => {
  test('batch is a SEQUENTIAL loop in input order with per-id {reviewStatus} payloads', async () => {
    const order = [];
    updateLifecycle.mockImplementation(async (id) => { order.push(id); });
    const out = await patchReviewers({ suggestionIds: IDS, reviewStatus: 'complete', actingUserSystemId: 'su-1' });
    expect(order).toEqual(IDS);
    expect(updateLifecycle).toHaveBeenCalledTimes(3);
    for (const call of updateLifecycle.mock.calls) {
      expect(call[1]).toEqual({ reviewStatus: 'complete' });
      expect(call[2]).toEqual({ actingUserSystemId: 'su-1' });
    }
    expect(out).toEqual({ success: true, message: 'Updated 3 reviewers' });
  });

  test('midway batch failure: earlier updates already applied, later ids untouched, error propagates untyped', async () => {
    updateLifecycle
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('dataverse 500'));
    const err = await patchReviewers({ suggestionIds: IDS, reviewStatus: 'complete', actingUserSystemId: null })
      .catch((e) => e);
    expect(err.message).toBe('dataverse 500'); // shell maps to the PATCH 500 envelope
    expect(updateLifecycle).toHaveBeenCalledTimes(2); // ids[0] applied, ids[1] failed, ids[2] never attempted
    expect(updateLifecycle.mock.calls[0][0]).toBe(IDS[0]);
    expect(updateLifecycle.mock.calls[1][0]).toBe(IDS[1]);
  });

  test('single update forwards the shell-built lifecycle object', async () => {
    const out = await patchReviewers({ suggestionId: IDS[0], lifecycle: { reviewStatus: 'complete', notes: 'n' }, actingUserSystemId: 'su-1' });
    expect(updateLifecycle).toHaveBeenCalledWith(IDS[0], { reviewStatus: 'complete', notes: 'n' }, { actingUserSystemId: 'su-1' });
    expect(out).toEqual({ success: true, message: 'Reviewer updated' });
  });

  test.each(['withdrew', 'released'])('generic PATCH service refuses terminal status %s', async (reviewStatus) => {
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
    const out = await getReviewers({ proposalId: REQ, azureEmail: 'pd@wmkf.org' });
    expect(out).toEqual({ success: true, proposals: [], totalReviewers: 0 });
    expect(resolvePD).not.toHaveBeenCalled();
  });

  test('default scope: unresolved PD → empty DTO WITH programDirector:null', async () => {
    resolvePD.mockResolvedValueOnce(null);
    const out = await getReviewers({ azureEmail: 'someone@wmkf.org' });
    expect(out).toEqual({ success: true, proposals: [], totalReviewers: 0, programDirector: null });
  });

  test('proposalId scope groups accepted suggestions into the proposal DTO with liveQuestions', async () => {
    getRequestById.mockResolvedValueOnce({
      akoya_requestid: REQ, akoya_requestnum: 'R-1001', akoya_title: 'T', wmkf_meetingdate: null,
    });
    findByRequest.mockResolvedValueOnce([
      {
        wmkf_appreviewersuggestionid: IDS[0],
        _wmkf_request_value: REQ,
        _wmkf_potentialreviewer_value: 'person-1',
        wmkf_accepted: true,
        wmkf_reviewstatus: 100000001,
      },
      { wmkf_appreviewersuggestionid: IDS[1], _wmkf_request_value: REQ, wmkf_accepted: false },
    ]);
    getActiveQuestionSet.mockResolvedValueOnce([{ key: 'impact', order: 1, label: 'Impact?', type: 'picklist' }]);
    const out = await getReviewers({ proposalId: REQ, azureEmail: 'pd@wmkf.org' });
    expect(out.success).toBe(true);
    expect(out.totalReviewers).toBe(1); // non-accepted row filtered out
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].reviewers[0]).toMatchObject({
      suggestionId: IDS[0],
      reviewStatus: 'materials_sent',
      tokenState: 'not_minted',
      answers: [],
    });
    expect(out.proposals[0].statusSummary).toEqual({ materials_sent: 1 });
    expect(out.liveQuestions).toEqual([{ key: 'impact', order: 1, text: 'Impact?', type: 'picklist' }]);
  });

  test('chunk boundary: 26 distinct person ids chunk both the reviewer and researcher OR-chains at 25, first call gets ids 0-24 in order, second gets id 25', async () => {
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

    await getReviewers({ proposalId: REQ, azureEmail: 'pd@wmkf.org' });

    // Both fetchPotentialReviewers (wmkf_name select) and fetchResearchersByPerson
    // (wmkf_primaryaffiliation select) run their own two-chunk loop over the same
    // personIds; disambiguate by select since the two loops interleave under Promise.all.
    const reviewerCalls = queryReviewers.mock.calls.filter((c) => c[0].select.includes('wmkf_name'));
    const researcherCalls = queryReviewers.mock.calls.filter((c) => c[0].select.includes('wmkf_primaryaffiliation'));
    expect(reviewerCalls).toHaveLength(2);
    expect(researcherCalls).toHaveLength(2);
    for (const calls of [reviewerCalls, researcherCalls]) {
      expect(calls[0][0].filter.split(' or ')).toEqual(
        personIds.slice(0, 25).map((id) => `wmkf_potentialreviewersid eq ${id}`),
      );
      expect(calls[1][0].filter.split(' or ')).toEqual(
        personIds.slice(25).map((id) => `wmkf_potentialreviewersid eq ${id}`),
      );
    }
  });
});
