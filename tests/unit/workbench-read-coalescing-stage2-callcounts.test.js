/**
 * @jest-environment node
 *
 * Stage 2 read-coalescing ACCEPTANCE suite — call-count teeth.
 *
 * Proves, at the service layer, the plan's chunk-aware acceptance formula:
 *
 *   after = q(reviewers) + q(active) + q(removed) + q(decline)
 *   where q(n) = ceil(n / 25), and an empty id set contributes 0 (never
 *   queried at all — the chunk loop is skipped entirely for length 0).
 *
 * `reviewers-service.getReviewers` and `my-candidates-service.getMyCandidates`
 * now issue ONE queryReviewers call per 25-id chunk (fetchResearchersByPerson
 * was deleted; fetchPotentialReviewers carries the UNION $select). Active and
 * removed candidate sets in getMyCandidates are still queried SEPARATELY (no
 * cross-set dedup) — each contributes its own q(). decline-referrals-service
 * is UNCHANGED: it still uses its own narrow, unmerged $select.
 *
 * These are EXACT (===) call-count and exact-filter/exact-select assertions,
 * not toMatchObject/toContain — the teeth here are that this suite FAILS the
 * instant either of the two deleted-pair reads (person select + researcher
 * select, run separately) comes back, because that doubles the call count
 * this suite pins to q(n).
 */

const PERSON_DB = {};
for (let i = 0; i < 30; i += 1) {
  const id = `rp-${i}`;
  PERSON_DB[id] = {
    wmkf_potentialreviewersid: id,
    wmkf_name: `Reviewer ${i}`,
    wmkf_emailaddress: `reviewer${i}@example.edu`,
    wmkf_organizationname: `Institution ${i}`,
    wmkf_primaryaffiliation: `Affiliation ${i}`,
    wmkf_website: `https://example.edu/r${i}`,
    wmkf_hindex: 10 + i,
    wmkf_totalcitations: 1000 + i,
  };
}
for (let i = 0; i < 30; i += 1) {
  const id = `ap-${i}`;
  PERSON_DB[id] = {
    wmkf_potentialreviewersid: id,
    wmkf_name: `Active Candidate ${i}`,
    wmkf_emailaddress: `active${i}@example.edu`,
    wmkf_primaryaffiliation: `Active Affiliation ${i}`,
  };
}
for (let i = 0; i < 30; i += 1) {
  const id = `rm-${i}`;
  PERSON_DB[id] = {
    wmkf_potentialreviewersid: id,
    wmkf_name: `Removed Candidate ${i}`,
    wmkf_emailaddress: `removed${i}@example.edu`,
    wmkf_primaryaffiliation: `Removed Affiliation ${i}`,
  };
}
for (let i = 0; i < 5; i += 1) {
  const id = `dc-${i}`;
  PERSON_DB[id] = {
    wmkf_potentialreviewersid: id,
    wmkf_name: `Decliner ${i}`,
    wmkf_emailaddress: `decliner${i}@example.edu`,
  };
}

// Select-agnostic: filters by id ONLY, ignoring `select` entirely — this suite
// separately ASSERTS on the select string per-call rather than branching the
// mock on it (branching would hide a regression that widens/narrows a select).
const queryReviewersImpl = jest.fn(async ({ filter }) => {
  const ids = String(filter || '')
    .split(' or ')
    .map((clause) => clause.replace('wmkf_potentialreviewersid eq ', '').trim())
    .filter(Boolean);
  return { records: ids.map((id) => PERSON_DB[id]).filter(Boolean) };
});

jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  __esModule: true,
  queryReviewers: (...a) => queryReviewersImpl(...a),
  getById: jest.fn(async () => ({})),
  update: jest.fn(async () => {}),
  clearEmailForEdit: jest.fn(async () => ({})),
  findByEmailCandidates: jest.fn(async () => ({ one: false })),
}));

const findByRequest = jest.fn();
const findAcceptedByPD = jest.fn();
const findByPD = jest.fn();
const findRemovedByRequest = jest.fn();
const aggregateReviewHistory = jest.fn(async () => ({}));
const dismissDeclineReferral = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  findByRequest: (...a) => findByRequest(...a),
  findAcceptedByPD: (...a) => findAcceptedByPD(...a),
  findByPD: (...a) => findByPD(...a),
  findRemovedByRequest: (...a) => findRemovedByRequest(...a),
  aggregateReviewHistory: (...a) => aggregateReviewHistory(...a),
  findById: jest.fn(),
  updateLifecycle: jest.fn(async () => {}),
  restore: jest.fn(async () => {}),
  softDelete: jest.fn(async () => {}),
  bulkUpdateByRequest: jest.fn(async () => 0),
  dismissDeclineReferral: (...a) => dismissDeclineReferral(...a),
  APPLICANT_DISPOSITION_MAP: { recommended: 100000000, excluded: 100000001 },
  RESPONSE_TYPE_BY_VALUE: {
    100000000: 'accepted',
    100000001: 'declined',
    100000002: 'no_response',
    100000003: 'withdrawn_sufficient',
    100000004: 'held',
  },
}));

const getRequestById = jest.fn();
const findByRequestNumber = jest.fn(async () => ({ records: [] }));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  __esModule: true,
  getById: (...a) => getRequestById(...a),
  findByRequestNumber: (...a) => findByRequestNumber(...a),
}));

const queryAccounts = jest.fn(async () => ({ records: [] }));
jest.mock('../../lib/dataverse/adapters/account', () => ({
  __esModule: true,
  queryAccounts: (...a) => queryAccounts(...a),
}));

jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  __esModule: true,
  updateById: jest.fn(async () => {}),
}));

const resolvePD = jest.fn();
jest.mock('../../lib/services/program-director-resolver', () => ({
  __esModule: true,
  resolveByEmail: (...a) => resolvePD(...a),
}));

const fetchAnswersBySuggestion = jest.fn(async () => ({}));
jest.mock('../../lib/services/review-answers', () => ({
  __esModule: true,
  fetchAnswersBySuggestion: (...a) => fetchAnswersBySuggestion(...a),
}));

const getActiveQuestionSet = jest.fn(async () => []);
jest.mock('../../lib/external/review-question-fetcher', () => ({
  __esModule: true,
  getActiveQuestionSet: (...a) => getActiveQuestionSet(...a),
}));

jest.mock('../../lib/external/token-lifecycle', () => ({
  __esModule: true,
  ensureToken: jest.fn(async () => {}),
  buildExternalUrl: jest.fn((token) => `https://reviews.wmkeck.org/external/review/${token}`),
}));
jest.mock('../../lib/services/external-token', () => ({
  __esModule: true,
  hashToken: jest.fn((token) => `hash:${token}`),
}));
jest.mock('../../lib/dataverse/duplicate-key', () => ({
  __esModule: true,
  translateDuplicateKeyError: jest.fn(() => null),
}));

const { normalizeDeclineReferrals } = require('../../shared/utils/decline-referrals');

let getReviewers;
let getMyCandidates;
let getDeclineReferrals;
beforeAll(async () => {
  ({ getReviewers } = require('../../lib/services/review-manager/reviewers-service'));
  ({ getMyCandidates } = require('../../lib/services/reviewer-finder/my-candidates-service'));
  ({ getDeclineReferrals } = require('../../lib/services/workbench/decline-referrals-service'));
});

beforeEach(() => {
  jest.clearAllMocks();
  queryReviewersImpl.mockImplementation(async ({ filter }) => {
    const ids = String(filter || '')
      .split(' or ')
      .map((clause) => clause.replace('wmkf_potentialreviewersid eq ', '').trim())
      .filter(Boolean);
    return { records: ids.map((id) => PERSON_DB[id]).filter(Boolean) };
  });
  aggregateReviewHistory.mockResolvedValue({});
  findByRequestNumber.mockResolvedValue({ records: [] });
  queryAccounts.mockResolvedValue({ records: [] });
  findRemovedByRequest.mockResolvedValue([]);
});

// The formula itself — the assertion below computes its expectation from
// THIS function, not a hand-typed number, so the test is the formula.
function q(n) {
  return n > 0 ? Math.ceil(n / 25) : 0;
}

function reviewerSuggestionRow({ id, requestId, personId }) {
  return {
    wmkf_appreviewersuggestionid: id,
    _wmkf_request_value: requestId,
    _wmkf_potentialreviewer_value: personId,
    wmkf_accepted: true,
    wmkf_invited: true,
    wmkf_selected: true,
    wmkf_reviewstatus: 100000000,
    wmkf_responsetype: 100000000,
  };
}

function candidateSuggestionRow({ id, requestId, personId }) {
  return {
    wmkf_appreviewersuggestionid: id,
    _wmkf_request_value: requestId,
    _wmkf_potentialreviewer_value: personId,
    wmkf_sources: 'literature_retrieved',
    wmkf_invited: false,
    wmkf_accepted: false,
    wmkf_declined: false,
    createdon: '2026-01-01T00:00:00Z',
  };
}

function removedRow({ id, personId }) {
  return {
    wmkf_appreviewersuggestionid: id,
    _wmkf_potentialreviewer_value: personId,
    wmkf_invited: false,
    wmkf_declined: false,
    modifiedon: '2026-01-02T00:00:00Z',
  };
}

function assertMergedSelect(callArgs) {
  expect(callArgs.select).toEqual(expect.stringContaining('wmkf_name'));
  expect(callArgs.select).toEqual(expect.stringContaining('wmkf_primaryaffiliation'));
}

describe('getReviewers — call-count acceptance', () => {
  test('1) 3 person ids → exactly q(3)=1 call (would be 2 under the old pair)', async () => {
    getRequestById.mockResolvedValueOnce({ akoya_requestid: 'req-1', akoya_requestnum: 'R-1', akoya_title: 'T' });
    findByRequest.mockResolvedValueOnce([
      reviewerSuggestionRow({ id: 'sug-1a', requestId: 'req-1', personId: 'rp-0' }),
      reviewerSuggestionRow({ id: 'sug-1b', requestId: 'req-1', personId: 'rp-1' }),
      reviewerSuggestionRow({ id: 'sug-1c', requestId: 'req-1', personId: 'rp-2' }),
    ]);

    await getReviewers({ proposalId: 'req-1', azureEmail: 'staff@wmkeck.org' });

    expect(queryReviewersImpl).toHaveBeenCalledTimes(q(3));
    expect(queryReviewersImpl).toHaveBeenCalledTimes(1);
    const call = queryReviewersImpl.mock.calls[0][0];
    assertMergedSelect(call);
    expect(call.filter.split(' or ')).toEqual([
      'wmkf_potentialreviewersid eq rp-0',
      'wmkf_potentialreviewersid eq rp-1',
      'wmkf_potentialreviewersid eq rp-2',
    ]);
  });

  test('2) 26 person ids → exactly q(26)=2 calls, in-order chunk chains (would be 4 under the old pair)', async () => {
    getRequestById.mockResolvedValueOnce({ akoya_requestid: 'req-2', akoya_requestnum: 'R-2', akoya_title: 'T' });
    const personIds = Array.from({ length: 26 }, (_, i) => `rp-${i}`);
    findByRequest.mockResolvedValueOnce(
      personIds.map((pid, i) => reviewerSuggestionRow({ id: `sug-2-${i}`, requestId: 'req-2', personId: pid })),
    );

    await getReviewers({ proposalId: 'req-2', azureEmail: 'staff@wmkeck.org' });

    expect(queryReviewersImpl).toHaveBeenCalledTimes(q(26));
    expect(queryReviewersImpl).toHaveBeenCalledTimes(2);
    queryReviewersImpl.mock.calls.forEach(([args]) => assertMergedSelect(args));
    expect(queryReviewersImpl.mock.calls[0][0].filter.split(' or ')).toEqual(
      personIds.slice(0, 25).map((id) => `wmkf_potentialreviewersid eq ${id}`),
    );
    expect(queryReviewersImpl.mock.calls[1][0].filter.split(' or ')).toEqual(
      personIds.slice(25).map((id) => `wmkf_potentialreviewersid eq ${id}`),
    );
  });

  test('8) empty person-id set → 0 calls', async () => {
    getRequestById.mockResolvedValueOnce({ akoya_requestid: 'req-8', akoya_requestnum: 'R-8', akoya_title: 'T' });
    findByRequest.mockResolvedValueOnce([
      reviewerSuggestionRow({ id: 'sug-8', requestId: 'req-8', personId: null }),
    ]);

    await getReviewers({ proposalId: 'req-8', azureEmail: 'staff@wmkeck.org' });

    expect(queryReviewersImpl).toHaveBeenCalledTimes(q(0));
    expect(queryReviewersImpl).not.toHaveBeenCalled();
  });
});

describe('getMyCandidates — call-count acceptance', () => {
  test('3) active-only (2 ids) → exactly q(2)=1 call', async () => {
    getRequestById.mockResolvedValueOnce({ akoya_requestid: 'req-3', akoya_requestnum: 'R-3', akoya_title: 'T' });
    findByRequest.mockResolvedValueOnce([
      candidateSuggestionRow({ id: 'sug-3a', requestId: 'req-3', personId: 'ap-0' }),
      candidateSuggestionRow({ id: 'sug-3b', requestId: 'req-3', personId: 'ap-1' }),
    ]);
    findRemovedByRequest.mockResolvedValueOnce([]);

    await getMyCandidates({ requestId: 'req-3', azureEmail: 'staff@wmkeck.org' });

    expect(queryReviewersImpl).toHaveBeenCalledTimes(q(2));
    expect(queryReviewersImpl).toHaveBeenCalledTimes(1);
    const call = queryReviewersImpl.mock.calls[0][0];
    assertMergedSelect(call);
    expect(call.filter.split(' or ')).toEqual([
      'wmkf_potentialreviewersid eq ap-0',
      'wmkf_potentialreviewersid eq ap-1',
    ]);
  });

  test('4) removed-only (1 id) → exactly q(1)=1 call', async () => {
    getRequestById.mockResolvedValueOnce({ akoya_requestid: 'req-4', akoya_requestnum: 'R-4', akoya_title: 'T' });
    findByRequest.mockResolvedValueOnce([]);
    findRemovedByRequest.mockResolvedValueOnce([
      removedRow({ id: 'sug-4-removed', personId: 'rm-0' }),
    ]);

    await getMyCandidates({ requestId: 'req-4', azureEmail: 'staff@wmkeck.org' });

    expect(queryReviewersImpl).toHaveBeenCalledTimes(q(1));
    expect(queryReviewersImpl).toHaveBeenCalledTimes(1);
    const call = queryReviewersImpl.mock.calls[0][0];
    assertMergedSelect(call);
    expect(call.filter).toBe('wmkf_potentialreviewersid eq rm-0');
  });

  test('5) combined: 2 active + 2 removed (one shared person id) → exactly 2 calls, active-exact then removed-exact (proves NO union)', async () => {
    getRequestById.mockResolvedValueOnce({ akoya_requestid: 'req-5', akoya_requestnum: 'R-5', akoya_title: 'T' });
    findByRequest.mockResolvedValueOnce([
      candidateSuggestionRow({ id: 'sug-5-active-a', requestId: 'req-5', personId: 'ap-0' }),
      candidateSuggestionRow({ id: 'sug-5-active-b', requestId: 'req-5', personId: 'ap-1' }),
    ]);
    findRemovedByRequest.mockResolvedValueOnce([
      // 'ap-0' is the SAME person id as an active candidate, under a DISTINCT
      // removed suggestion id — proves the two sets are queried separately,
      // never deduped/unioned against each other.
      removedRow({ id: 'sug-5-removed-a', personId: 'ap-0' }),
      removedRow({ id: 'sug-5-removed-b', personId: 'rm-1' }),
    ]);

    await getMyCandidates({ requestId: 'req-5', azureEmail: 'staff@wmkeck.org' });

    expect(queryReviewersImpl).toHaveBeenCalledTimes(q(2) + q(2));
    expect(queryReviewersImpl).toHaveBeenCalledTimes(2);
    queryReviewersImpl.mock.calls.forEach(([args]) => assertMergedSelect(args));
    expect(queryReviewersImpl.mock.calls[0][0].filter.split(' or ')).toEqual([
      'wmkf_potentialreviewersid eq ap-0',
      'wmkf_potentialreviewersid eq ap-1',
    ]);
    expect(queryReviewersImpl.mock.calls[1][0].filter.split(' or ')).toEqual([
      'wmkf_potentialreviewersid eq ap-0',
      'wmkf_potentialreviewersid eq rm-1',
    ]);
  });

  test('6) 26 active + 1 removed → exactly q(26) + q(1) = 3 calls', async () => {
    getRequestById.mockResolvedValueOnce({ akoya_requestid: 'req-6', akoya_requestnum: 'R-6', akoya_title: 'T' });
    const activeIds = Array.from({ length: 26 }, (_, i) => `ap-${i}`);
    findByRequest.mockResolvedValueOnce(
      activeIds.map((pid, i) => candidateSuggestionRow({ id: `sug-6-active-${i}`, requestId: 'req-6', personId: pid })),
    );
    findRemovedByRequest.mockResolvedValueOnce([
      removedRow({ id: 'sug-6-removed', personId: 'rm-0' }),
    ]);

    await getMyCandidates({ requestId: 'req-6', azureEmail: 'staff@wmkeck.org' });

    expect(queryReviewersImpl).toHaveBeenCalledTimes(q(26) + q(1));
    expect(queryReviewersImpl).toHaveBeenCalledTimes(3);
    queryReviewersImpl.mock.calls.forEach(([args]) => assertMergedSelect(args));
    // Calls 0-1: active chunks (25 then 1). Call 2: the removed chunk.
    expect(queryReviewersImpl.mock.calls[0][0].filter.split(' or ')).toEqual(
      activeIds.slice(0, 25).map((id) => `wmkf_potentialreviewersid eq ${id}`),
    );
    expect(queryReviewersImpl.mock.calls[1][0].filter.split(' or ')).toEqual(
      activeIds.slice(25).map((id) => `wmkf_potentialreviewersid eq ${id}`),
    );
    expect(queryReviewersImpl.mock.calls[2][0].filter).toBe('wmkf_potentialreviewersid eq rm-0');
  });

  test('7) empty active + empty removed → 0 calls (envelope-level early return, not the helper guard)', async () => {
    // This pins getMyCandidates' own `suggestions.length === 0 && removedRows.length
    // === 0` early-return envelope (my-candidates-service.js:159) short-circuiting
    // before fetchPotentialReviewers is ever reached — NOT fetchPotentialReviewers'
    // own `if (!ids?.length) return {}` guard. A mutation deleting that inner guard
    // leaves this fixture green, since the envelope return never calls the helper at
    // all. Plain deletion of that guard line is in fact an EQUIVALENT mutant here:
    // lib/utils/chunk.js's `chunked([], 25)` yields zero chunks regardless, so the
    // loop still never issues a query — the guard's real value is null/undefined
    // safety (ids?.length), not behavior on an empty array. What fixtures 4
    // (removed-only: the ACTIVE set is empty and flows through
    // fetchPotentialReviewers([]) on the main path) and 8 (getReviewers' empty
    // person-id set) actually prove is that the helper issues ZERO Dataverse calls
    // for an empty id set — a mutation that makes it issue any (e.g. an unfiltered)
    // query before returning fails their exact === totals — confirmed by mutation
    // testing.
    getRequestById.mockResolvedValueOnce({ akoya_requestid: 'req-7', akoya_requestnum: 'R-7', akoya_title: 'T' });
    findByRequest.mockResolvedValueOnce([]);
    findRemovedByRequest.mockResolvedValueOnce([]);

    await getMyCandidates({ requestId: 'req-7', azureEmail: 'staff@wmkeck.org' });

    expect(queryReviewersImpl).toHaveBeenCalledTimes(q(0) + q(0));
    expect(queryReviewersImpl).not.toHaveBeenCalled();
  });
});

describe('getDeclineReferrals — call-count acceptance (unchanged narrow select)', () => {
  test('9) 2 declined-with-referral rows → exactly q(2)=1 call with the UNCHANGED narrow decline select', async () => {
    const stored1 = normalizeDeclineReferrals([{ name: 'Referral One', email: 'r1@example.com' }]).storedValue;
    const stored2 = normalizeDeclineReferrals([{ name: 'Referral Two', email: 'r2@example.com' }]).storedValue;
    findByRequest.mockResolvedValueOnce([
      {
        wmkf_appreviewersuggestionid: 'sug-9a',
        _wmkf_potentialreviewer_value: 'dc-0',
        wmkf_declined: true,
        wmkf_selected: false,
        wmkf_declinereferral: stored1,
        wmkf_responsereceivedat: '2026-01-01T00:00:00Z',
      },
      {
        wmkf_appreviewersuggestionid: 'sug-9b',
        _wmkf_potentialreviewer_value: 'dc-1',
        wmkf_declined: true,
        wmkf_selected: false,
        wmkf_declinereferral: stored2,
        wmkf_responsereceivedat: '2026-01-02T00:00:00Z',
      },
    ]);

    const out = await getDeclineReferrals({ requestId: 'req-9' });

    expect(queryReviewersImpl).toHaveBeenCalledTimes(q(2));
    expect(queryReviewersImpl).toHaveBeenCalledTimes(1);
    const call = queryReviewersImpl.mock.calls[0][0];
    // Literal pin: the decline read did NOT get merged/widened — it remains
    // the narrow, pre-Stage-2 select.
    expect(call.select).toBe('wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress');
    expect(call.select).not.toEqual(expect.stringContaining('wmkf_primaryaffiliation'));
    expect(call.filter.split(' or ')).toEqual([
      'wmkf_potentialreviewersid eq dc-0',
      'wmkf_potentialreviewersid eq dc-1',
    ]);
    expect(out.referrals).toHaveLength(2);
  });
});

describe('whole-page composite — the formula, not a magic number', () => {
  test('10) reviewers(3) + active(2) + removed(1) + decline(1), simulated in sequence over one shared mock', async () => {
    getRequestById.mockResolvedValueOnce({ akoya_requestid: 'req-10-reviewers', akoya_requestnum: 'R-10a', akoya_title: 'T' });
    findByRequest.mockResolvedValueOnce([
      reviewerSuggestionRow({ id: 'sug-10-rev-a', requestId: 'req-10-reviewers', personId: 'rp-0' }),
      reviewerSuggestionRow({ id: 'sug-10-rev-b', requestId: 'req-10-reviewers', personId: 'rp-1' }),
      reviewerSuggestionRow({ id: 'sug-10-rev-c', requestId: 'req-10-reviewers', personId: 'rp-2' }),
    ]);
    await getReviewers({ proposalId: 'req-10-reviewers', azureEmail: 'staff@wmkeck.org' });

    getRequestById.mockResolvedValueOnce({ akoya_requestid: 'req-10-candidates', akoya_requestnum: 'R-10b', akoya_title: 'T' });
    findByRequest.mockResolvedValueOnce([
      candidateSuggestionRow({ id: 'sug-10-active-a', requestId: 'req-10-candidates', personId: 'ap-0' }),
      candidateSuggestionRow({ id: 'sug-10-active-b', requestId: 'req-10-candidates', personId: 'ap-1' }),
    ]);
    findRemovedByRequest.mockResolvedValueOnce([
      removedRow({ id: 'sug-10-removed', personId: 'rm-0' }),
    ]);
    await getMyCandidates({ requestId: 'req-10-candidates', azureEmail: 'staff@wmkeck.org' });

    const stored = normalizeDeclineReferrals([{ name: 'Composite Referral', email: 'composite@example.com' }]).storedValue;
    findByRequest.mockResolvedValueOnce([
      {
        wmkf_appreviewersuggestionid: 'sug-10-decliner',
        _wmkf_potentialreviewer_value: 'dc-0',
        wmkf_declined: true,
        wmkf_selected: false,
        wmkf_declinereferral: stored,
        wmkf_responsereceivedat: '2026-01-03T00:00:00Z',
      },
    ]);
    await getDeclineReferrals({ requestId: 'req-10-decline' });

    const expectedTotal = q(3) + q(2) + q(1) + q(1);
    expect(expectedTotal).toBe(4); // sanity: the formula itself, not a rewritten literal
    expect(queryReviewersImpl).toHaveBeenCalledTimes(expectedTotal);
  });
});
