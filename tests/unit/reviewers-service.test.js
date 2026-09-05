/**
 * Logic-level unit tests for lib/services/review-manager/reviewers-service.js
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Adapters + resolvers mocked; covers the GET DTO early shapes and grouping,
 * and PATCH sequential canonical-target outcomes. An attempted failure carries
 * the confirmed prefix, uncertain attempt and unattempted suffix; no replay.
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
const getReviewSynthesisJobState = jest.fn();
jest.mock('../../lib/services/review-synthesis-job-service', () => ({
  getReviewSynthesisJobState: (...a) => getReviewSynthesisJobState(...a),
}));
// A swallowed dependency error must still fail isolation checks if SQL leaks.
const unexpectedSql = jest.fn(() => { throw new Error('Unexpected SQL in reviewers-service unit test'); });
jest.mock('@vercel/postgres', () => ({ sql: (...a) => unexpectedSql(...a) }));

const synthesisNotStarted = {
  current: false, status: 'not_started', mode: null, runId: null, attempts: 0,
  lastError: null, createdAt: null, updatedAt: null, startedAt: null,
  completedAt: null, currentRunId: null, currentCompletedAt: null,
};

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
let ReviewerStatusMutationError;
beforeAll(async () => {
  const mod = await import('../../lib/services/review-manager/reviewers-service');
  getReviewers = mod.getReviewers;
  patchReviewers = mod.patchReviewers;
  ReviewerStatusMutationError = mod.ReviewerStatusMutationError;
});

beforeEach(() => {
  jest.clearAllMocks();
  updateLifecycle.mockImplementation(async () => {});
  findAcceptedByCycle.mockResolvedValue({ suggestions: [], requestById: {} });
  getReviewSynthesisJobState.mockResolvedValue({ ...synthesisNotStarted });
});

afterEach(() => {
  expect(unexpectedSql).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

describe('patchReviewers', () => {
  function success(savedIds, message) {
    return { success: true, message, savedIds, failedIds: [], notAttemptedIds: [] };
  }

  test('batch awaits each target in input order with actor and status payloads', async () => {
    const order = [];
    updateLifecycle.mockImplementation(async (id) => { order.push(id); });
    const out = await patchReviewers({ suggestionIds: IDS, reviewStatus: 'under_review', actingUserSystemId: 'su-1' });
    expect(order).toEqual(IDS);
    expect(updateLifecycle.mock.calls).toEqual(IDS.map(id => [id, { reviewStatus: 'under_review' }, { actingUserSystemId: 'su-1' }]));
    expect(out).toEqual(success(IDS, 'Updated 3 reviewers'));
  });

  test.each([0, 1, 2])('failure at index %i carries exact confirmed/uncertain/unattempted partition and original cause', async (failureIndex) => {
    const cause = new Error('dataverse 500');
    updateLifecycle.mockImplementation(async id => {
      if (id === IDS[failureIndex]) throw cause;
    });
    const error = await patchReviewers({ suggestionIds: IDS, reviewStatus: 'under_review', actingUserSystemId: null }).catch(e => e);
    expect(error).toBeInstanceOf(ReviewerStatusMutationError);
    expect(error.cause).toBe(cause);
    expect(error.savedIds).toEqual(IDS.slice(0, failureIndex));
    expect(error.failedIds).toEqual([IDS[failureIndex]]);
    expect(error.notAttemptedIds).toEqual(IDS.slice(failureIndex + 1));
    expect(updateLifecycle.mock.calls).toEqual(IDS.slice(0, failureIndex + 1).map(id => [id, { reviewStatus: 'under_review' }, { actingUserSystemId: null }]));
  });

  test('an unresolved first operation prevents the second operation and success result', async () => {
    let resolveFirst;
    const firstPending = new Promise(resolve => { resolveFirst = resolve; });
    updateLifecycle.mockImplementationOnce(() => firstPending);
    let settled = false;
    const pending = patchReviewers({ suggestionIds: IDS, reviewStatus: 'accepted' }).then(out => {
      settled = true;
      return out;
    });
    await Promise.resolve();
    expect(updateLifecycle.mock.calls.map(([id]) => id)).toEqual([IDS[0]]);
    expect(settled).toBe(false);
    resolveFirst();
    expect(await pending).toEqual(success(IDS, 'Updated 3 reviewers'));
    expect(updateLifecycle.mock.calls.map(([id]) => id)).toEqual(IDS);
  });

  test('single preserves the exact lifecycle object and submitted identity', async () => {
    const lifecycle = { reviewStatus: 'under_review', notes: 'n', accepted: false };
    const suggestionId = ' AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA ';
    const out = await patchReviewers({ suggestionId, lifecycle, actingUserSystemId: 'su-1' });
    expect(updateLifecycle).toHaveBeenCalledTimes(1);
    expect(updateLifecycle.mock.calls[0]).toEqual([suggestionId, lifecycle, { actingUserSystemId: 'su-1' }]);
    expect(updateLifecycle.mock.calls[0][1]).toBe(lifecycle);
    expect(out).toEqual(success([suggestionId], 'Reviewer updated'));
  });

  test.each(['single', 'one-element batch'])('%s failure has no confirmed saves or unattempted targets', async form => {
    const cause = new Error('write response lost');
    updateLifecycle.mockRejectedValueOnce(cause);
    const input = form === 'single'
      ? { suggestionId: IDS[0], lifecycle: { reviewStatus: 'accepted' } }
      : { suggestionIds: [IDS[0]], reviewStatus: 'accepted' };
    const error = await patchReviewers(input).catch(e => e);
    expect(error).toBeInstanceOf(ReviewerStatusMutationError);
    expect(error).toMatchObject({ cause, savedIds: [], failedIds: [IDS[0]], notAttemptedIds: [] });
    expect(updateLifecycle).toHaveBeenCalledTimes(1);
  });

  test('one-element batch retains batch message', async () => {
    expect(await patchReviewers({ suggestionIds: [IDS[0]], reviewStatus: 'accepted' }))
      .toEqual(success([IDS[0]], 'Updated 1 reviewers'));
  });

  test.each([false, true])('canonical duplicates are attempted once in first occurrence order (failure=%s)', async failing => {
    const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const c = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const suggestionIds = [` ${b.toUpperCase()} `, a, b, ` ${a.toUpperCase()} `, c, b];
    const cause = new Error('failure after duplicate');
    updateLifecycle.mockImplementation(async id => { if (failing && id === a) throw cause; });
    const out = await patchReviewers({ suggestionIds, reviewStatus: 'accepted' }).catch(e => e);
    expect(updateLifecycle.mock.calls.map(([id]) => id)).toEqual(failing ? [b, a] : [b, a, c]);
    if (failing) {
      expect(out).toBeInstanceOf(ReviewerStatusMutationError);
      expect(out).toMatchObject({ cause, savedIds: [b], failedIds: [a], notAttemptedIds: [c] });
    } else {
      expect(out).toEqual(success([b, a, c], 'Updated 3 reviewers'));
    }
    expect(suggestionIds).toEqual([` ${b.toUpperCase()} `, a, b, ` ${a.toUpperCase()} `, c, b]);
  });

  test.each([[], 'not-an-array', null, {}])('empty or nonarray batch selector %j uses single lifecycle', async suggestionIds => {
    const lifecycle = { reviewStatus: 'accepted', notes: 'preserved' };
    const out = await patchReviewers({ suggestionIds, suggestionId: IDS[0], lifecycle, reviewStatus: 'complete' });
    expect(out).toEqual(success([IDS[0]], 'Reviewer updated'));
    expect(updateLifecycle.mock.calls[0][1]).toBe(lifecycle);
  });

  test('nonempty batch takes priority over single lifecycle and single target', async () => {
    const out = await patchReviewers({ suggestionIds: [IDS[1]], suggestionId: IDS[0], reviewStatus: 'accepted', lifecycle: { reviewStatus: 'complete' } });
    expect(out).toEqual(success([IDS[1]], 'Updated 1 reviewers'));
    expect(updateLifecycle.mock.calls).toEqual([[IDS[1], { reviewStatus: 'accepted' }, { actingUserSystemId: undefined }]]);
  });

  const dedicatedStatuses = [
    ['complete', 'Complete requires the dedicated reviewer closeout endpoint'],
    [' Complete ', 'Complete requires the dedicated reviewer closeout endpoint'],
    [REVIEW_STATUS_MAP.complete, 'Complete requires the dedicated reviewer closeout endpoint'],
    ['withdrew', 'Terminal reviewer statuses require the dedicated transition endpoint'],
    [' RELEASED ', 'Terminal reviewer statuses require the dedicated transition endpoint'],
    [TERMINAL_REVIEW_STATUS_VALUES.withdrew, 'Terminal reviewer statuses require the dedicated transition endpoint'],
    [TERMINAL_REVIEW_STATUS_VALUES.released, 'Terminal reviewer statuses require the dedicated transition endpoint'],
  ];
  describe.each(['single', 'batch', 'empty-array fallback'])('%s dedicated status precheck', form => {
    test.each(dedicatedStatuses)('refuses %s before all writes with error-only service semantics', async (reviewStatus, message) => {
      const input = form === 'batch'
        ? { suggestionIds: IDS, reviewStatus, lifecycle: { reviewStatus: 'accepted' } }
        : { suggestionIds: form === 'empty-array fallback' ? [] : undefined, suggestionId: IDS[0], lifecycle: { reviewStatus }, reviewStatus: 'accepted' };
      const error = await patchReviewers(input).catch(e => e);
      expect(error).toMatchObject({ name: 'ServiceHttpError', httpStatus: 400, message });
      expect(error).not.toHaveProperty('savedIds');
      expect(error).not.toHaveProperty('failedIds');
      expect(error).not.toHaveProperty('notAttemptedIds');
      expect(updateLifecycle).not.toHaveBeenCalled();
    });
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
    expect(getReviewSynthesisJobState).toHaveBeenCalledWith(REQ, expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(out.proposals[0].reviewSynthesisState).toMatchObject(synthesisNotStarted);
  });

  test('unavailable synthesis dependency preserves reviewer DTO and returns the logged fallback without SQL or network', async () => {
    getRequestById.mockResolvedValueOnce({
      akoya_requestid: REQ, akoya_requestnum: 'R-1001', akoya_title: 'T',
      wmkf_reviewsynthesisjson: JSON.stringify({ overall: 'Previously stored synthesis' }),
    });
    findByRequest.mockResolvedValueOnce([{
      wmkf_appreviewersuggestionid: IDS[0], _wmkf_request_value: REQ,
      wmkf_selected: true, wmkf_accepted: true,
      wmkf_reviewstatus: REVIEW_STATUS_MAP.materials_sent,
    }]);
    const unavailable = new Error('Synthesis job dependency unavailable');
    getReviewSynthesisJobState.mockRejectedValueOnce(unavailable);
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = await getReviewers({ proposalId: REQ, azureEmail: 'pd@wmkeck.org' });

      expect(out.success).toBe(true);
      expect(out.totalReviewers).toBe(1);
      expect(out.proposals[0].reviewers[0]).toMatchObject({
        suggestionId: IDS[0], reviewStatus: 'materials_sent', answers: [],
      });
      expect(out.proposals[0].reviewSynthesis).toMatchObject({ overall: 'Previously stored synthesis' });
      expect(out.proposals[0].reviewSynthesisState).toEqual({
        ...synthesisNotStarted,
        ready: false, canRunManually: false, participantCount: 1,
        submittedCount: 0, resolvedCount: 0, blockingCount: 1,
        status: 'unavailable', lastError: 'Synthesis status is temporarily unavailable.',
      });
      expect(getReviewSynthesisJobState).toHaveBeenCalledTimes(1);
      expect(getReviewSynthesisJobState).toHaveBeenCalledWith(REQ, expect.stringMatching(/^[0-9a-f]{64}$/));
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith('[review-manager reviewers] synthesis job state unavailable:', unavailable);
    } finally {
      errorLog.mockRestore();
    }
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
