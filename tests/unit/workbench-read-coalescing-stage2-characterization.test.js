/**
 * @jest-environment node
 *
 * Characterization suite — Workbench read-coalescing Stage 2.
 *
 * Pins the EXACT current responses of three GET-only read services so the
 * upcoming read-merge refactor (person + researcher queryReviewers calls
 * collapsed from TWO $select-scoped calls into ONE union-$select call) can
 * be proven response-equivalent before/after:
 *
 *   - lib/services/review-manager/reviewers-service.js        getReviewers
 *   - lib/services/reviewer-finder/my-candidates-service.js   getMyCandidates
 *   - lib/services/workbench/decline-referrals-service.js     getDeclineReferrals
 *
 * MOCKING NOTE (select-agnostic person/researcher fixture): the current
 * services issue TWO queryReviewers calls per id set with different
 * $select values (name-ish fields, then bibliometric fields). After the
 * merge there will be ONE call with the union $select. The mock below does
 * NOT branch on `select` — it always returns the same fully-merged
 * person+researcher record for a requested id, regardless of which $select
 * was passed. That keeps every pinned DTO below valid both BEFORE and AFTER
 * the merge. This suite intentionally does NOT assert call counts or
 * $select contents (that is a separate, later call-count suite) — the sole
 * exception is the explicit "queryReviewers never called" pins, which are
 * current AND target behavior (empty id-set short-circuit).
 */

// ───────────────────────── shared person/researcher fixture DB ─────────────────────────
// Keyed by wmkf_potentialreviewersid. Each record carries BOTH person-select
// fields (wmkf_name, wmkf_emailaddress, wmkf_organizationname, wmkf_emailsource,
// wmkf_academicrank, wmkf_primarydepartment, wmkf_maininstitution) AND
// researcher-select fields (wmkf_primaryaffiliation, wmkf_website,
// wmkf_facultypageurl, wmkf_hindex, wmkf_totalcitations, wmkf_orcid,
// wmkf_orcidurl, wmkf_googlescholarid, wmkf_googlescholarurl, wmkf_keywords)
// so the SAME record satisfies either current $select.
const PERSON_DB = {
  'person-a1': {
    wmkf_potentialreviewersid: 'person-a1',
    wmkf_name: 'Dr. Priya Natarajan',
    wmkf_emailaddress: 'priya.natarajan@example.edu',
    wmkf_organizationname: 'MIT',
    wmkf_primaryaffiliation: 'MIT Department of Chemistry',
    wmkf_website: 'https://chem.mit.edu/natarajan',
    wmkf_hindex: 34,
    wmkf_totalcitations: 5210,
  },
  'person-a2': {
    wmkf_potentialreviewersid: 'person-a2',
    wmkf_name: 'Dr. Marcus Lindqvist',
    wmkf_emailaddress: 'mlindqvist@example.org',
    wmkf_organizationname: 'Uppsala University',
    wmkf_primaryaffiliation: 'Uppsala University, Dept of Physical Chemistry',
    wmkf_website: 'https://uu.se/lindqvist',
    wmkf_hindex: 19,
    wmkf_totalcitations: 1875,
  },
  'person-c1': {
    wmkf_potentialreviewersid: 'person-c1',
    wmkf_name: 'Dr. Amara Okafor',
    wmkf_emailaddress: 'aokafor@example.edu',
    wmkf_organizationname: 'Acme University',
    wmkf_academicrank: 'Associate Professor',
    wmkf_primarydepartment: 'Materials Science',
    wmkf_maininstitution: 'Acme University',
    wmkf_primaryaffiliation: 'Acme University, Materials Science',
    wmkf_website: 'https://acme.edu/okafor',
    wmkf_facultypageurl: 'https://acme.edu/faculty/okafor',
    wmkf_hindex: 22,
    wmkf_totalcitations: 2650,
    wmkf_orcid: '0000-0003-1234-5678',
    wmkf_orcidurl: 'https://orcid.org/0000-0003-1234-5678',
    wmkf_googlescholarid: 'okafor-scholar',
    wmkf_googlescholarurl: 'https://scholar.google.com/citations?user=okafor-scholar',
    wmkf_keywords: 'nanomaterials, catalysis',
  },
  'person-c2': {
    wmkf_potentialreviewersid: 'person-c2',
    wmkf_name: 'Dr. Felix Baumgartner',
    wmkf_emailaddress: 'fbaumgartner@example.org',
    wmkf_organizationname: 'ETH Zurich',
    wmkf_academicrank: 'Professor',
    wmkf_primarydepartment: 'Physics',
    wmkf_maininstitution: 'ETH Zurich',
    wmkf_primaryaffiliation: 'ETH Zurich, Department of Physics',
    wmkf_website: 'https://ethz.ch/baumgartner',
    wmkf_facultypageurl: 'https://ethz.ch/faculty/baumgartner.pdf', // document URL → filtered out
    wmkf_hindex: 41,
    wmkf_totalcitations: 8890,
    wmkf_orcid: '0000-0002-9999-0000',
    wmkf_orcidurl: 'https://orcid.org/0000-0002-9999-0000',
    wmkf_googlescholarid: 'baumgartner-scholar',
    wmkf_googlescholarurl: 'https://scholar.google.com/citations?user=baumgartner-scholar',
    wmkf_keywords: 'condensed matter',
  },
  'person-d1': {
    wmkf_potentialreviewersid: 'person-d1',
    wmkf_name: 'Dr. Grace Kim',
    wmkf_emailaddress: 'gkim@example.edu',
    wmkf_organizationname: 'Seoul National University',
    wmkf_emailsource: 'manual',
    wmkf_primaryaffiliation: 'Seoul National University, Chemistry',
    wmkf_orcid: '0000-0001-1111-2222',
    wmkf_orcidurl: 'https://orcid.org/0000-0001-1111-2222',
    wmkf_googlescholarid: 'gkim-scholar',
    _etag: 'W/"person-d1-etag-7"',
  },
  'person-e1': {
    wmkf_potentialreviewersid: 'person-e1',
    wmkf_name: 'Dr. Hassan Al-Sayed',
    wmkf_emailaddress: 'halsayed@example.org',
    wmkf_organizationname: 'Cairo University',
    wmkf_emailsource: 'enrichment',
    wmkf_primaryaffiliation: 'Cairo University, Engineering',
    wmkf_orcid: '0000-0004-4444-5555',
    wmkf_orcidurl: 'https://orcid.org/0000-0004-4444-5555',
    wmkf_googlescholarid: 'alsayed-scholar',
    _etag: 'W/"person-e1-etag-2"',
  },
  'person-g1': {
    wmkf_potentialreviewersid: 'person-g1',
    wmkf_name: 'Dr. Ines Duarte',
    wmkf_emailaddress: 'iduarte@example.edu',
    wmkf_organizationname: 'University of Lisbon',
    wmkf_primaryaffiliation: 'University of Lisbon, Biology',
  },
  'person-h-a': { wmkf_potentialreviewersid: 'person-h-a', wmkf_name: 'Dr. Marco Rossi', wmkf_emailaddress: 'mrossi@example.it' },
  'person-h-elena': { wmkf_potentialreviewersid: 'person-h-elena', wmkf_name: 'Dr. Elena Popova', wmkf_emailaddress: 'epopova@ethz.ch' },
  'person-h-b': { wmkf_potentialreviewersid: 'person-h-b', wmkf_name: 'Dr. Wei Zhang', wmkf_emailaddress: 'wzhang@example.cn' },
};

// Select-agnostic: filters by id ONLY, ignoring the `select` argument entirely,
// so it validates identically whether the caller asks with the current
// narrow $selects or the future merged union $select.
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

// review-answer-snapshot's ratingsFromAnswers, review-synthesis-content's digest
// builder/hasher, review-synthesis-readiness's evaluator, and
// reviewer-due-date's resolver are all PURE and left real — their outputs are
// deterministic functions of the fixture data and are pinned literally below.
// review-synthesis-job-service hits @vercel/postgres directly; there is no
// POSTGRES_URL in the test env, so getReviewSynthesisJobState always rejects
// and reviewers-service's own try/catch falls back to its fixed "unavailable"
// shape — this is exercised (not mocked) and pinned as-is below.

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
});

const UNAVAILABLE_JOB_STATE = {
  current: false,
  status: 'unavailable',
  mode: null,
  runId: null,
  attempts: 0,
  lastError: 'Synthesis status is temporarily unavailable.',
  createdAt: null,
  updatedAt: null,
  startedAt: null,
  completedAt: null,
  currentRunId: null,
  currentCompletedAt: null,
};

// ───────────────────────────── getReviewers ─────────────────────────────

describe('getReviewers — characterization', () => {
  test('(a) single-proposal scope: two hydrated reviewers + one with no returned person row', async () => {
    getRequestById.mockResolvedValueOnce({
      akoya_requestid: 'req-a1',
      akoya_requestnum: 'R-2001',
      akoya_title: 'Catalytic Water Splitting Mechanisms',
      wmkf_meetingdate: '2026-06-15',
      wmkf_reviewduedate: '2026-09-01',
      wmkf_abstract: 'Investigating novel catalysts for water splitting.',
      wmkf_organizationname: 'Acme Research Institute',
      _akoya_applicantid_value_formatted: 'Acme Research Institute',
      _wmkf_projectleader_value_formatted: 'Dr. Priya Natarajan',
      _wmkf_grantprogram_value_formatted: 'Chemistry Innovation Grant',
      _wmkf_programareaserved_value_formatted: 'Physical Sciences',
      wmkf_reviewsynthesisjson: JSON.stringify({
        consensus: ['Strong methodology'],
        disagreements: [],
        keyConcerns: ['Budget scope'],
        ratingSummaries: [{ questionKey: 'impact', questionText: 'Impact?', summary: 'High impact' }],
        overall: 'Recommend funding',
      }),
    });
    findByRequest.mockResolvedValueOnce([
      {
        wmkf_appreviewersuggestionid: 'sug-a1',
        _wmkf_request_value: 'req-a1',
        _wmkf_potentialreviewer_value: 'person-a1',
        wmkf_accepted: true,
        wmkf_invited: true,
        wmkf_selected: true,
        wmkf_reviewstatus: 100000003, // review_received
        wmkf_responsetype: 100000000, // accepted
        wmkf_notes: 'Strong fit for chemistry expertise.',
        wmkf_emailsentat: '2026-06-20T09:00:00Z',
        wmkf_respondremindersentat: null,
        wmkf_responsereceivedat: '2026-06-22T14:30:00Z',
        wmkf_withdrawnsufficientat: null,
        wmkf_completedat: '2026-08-05T00:00:00Z',
        wmkf_materialssentat: null,
        wmkf_remindersentat: null,
        wmkf_remindercount: 0,
        wmkf_reviewduedateoverride: '2026-09-10',
        wmkf_reviewreceivedat: '2026-08-01T12:00:00Z',
        wmkf_reviewfilename: 'review-priya.pdf',
        wmkf_thankyousentat: '2026-08-06T00:00:00Z',
        wmkf_externaltokenissued: '2026-06-20T09:00:00Z',
        wmkf_externaltokenexpires: '2099-01-01T00:00:00Z',
        wmkf_externaltokenrevoked: false,
        wmkf_externaltokenhash: 'hash-a1',
        wmkf_proposalfirstaccessed: '2026-06-21T08:00:00Z',
        wmkf_reviewsharepointfolder: 'https://wmkf.sharepoint.com/reviews/req-a1/sug-a1',
        wmkf_reviewuploadedbystaff: false,
        wmkf_revieweraffiliation: 'MIT Chemistry',
      },
      {
        wmkf_appreviewersuggestionid: 'sug-a2',
        _wmkf_request_value: 'req-a1',
        _wmkf_potentialreviewer_value: 'person-a2',
        wmkf_accepted: true,
        wmkf_invited: true,
        wmkf_selected: true,
        wmkf_reviewstatus: 100000001, // materials_sent
        wmkf_responsetype: 100000000,
        wmkf_notes: null,
        wmkf_emailsentat: '2026-06-20T09:05:00Z',
        wmkf_respondremindersentat: '2026-07-01T00:00:00Z',
        wmkf_responsereceivedat: '2026-06-23T10:00:00Z',
        wmkf_withdrawnsufficientat: null,
        wmkf_completedat: null,
        wmkf_materialssentat: null,
        wmkf_remindersentat: '2026-08-10T00:00:00Z',
        wmkf_remindercount: 2,
        wmkf_reviewduedateoverride: null,
        wmkf_reviewreceivedat: null,
        wmkf_reviewfilename: null,
        wmkf_thankyousentat: null,
        wmkf_externaltokenissued: '2026-06-20T09:05:00Z',
        wmkf_externaltokenexpires: '2020-01-01T00:00:00Z', // already expired
        wmkf_externaltokenrevoked: false,
        wmkf_externaltokenhash: 'hash-a2',
        wmkf_proposalfirstaccessed: null,
        wmkf_reviewsharepointfolder: null,
        wmkf_reviewuploadedbystaff: false,
        wmkf_revieweraffiliation: null,
      },
      {
        // No corresponding PERSON_DB row — pins the || {} / || null fallbacks.
        wmkf_appreviewersuggestionid: 'sug-a3',
        _wmkf_request_value: 'req-a1',
        _wmkf_potentialreviewer_value: 'person-a3-missing',
        wmkf_accepted: true,
        wmkf_invited: true,
        wmkf_selected: true,
        wmkf_reviewstatus: 100000000, // accepted
        wmkf_responsetype: 100000000,
        wmkf_notes: 'Backup reviewer, pending record cleanup.',
        wmkf_emailsentat: null,
        wmkf_respondremindersentat: null,
        wmkf_responsereceivedat: null,
        wmkf_withdrawnsufficientat: null,
        wmkf_completedat: null,
        wmkf_materialssentat: null,
        wmkf_remindersentat: null,
        wmkf_remindercount: 0,
        wmkf_reviewduedateoverride: null,
        wmkf_reviewreceivedat: null,
        wmkf_reviewfilename: null,
        wmkf_thankyousentat: null,
        wmkf_externaltokenissued: '2026-06-25T00:00:00Z',
        wmkf_externaltokenexpires: '2099-01-01T00:00:00Z',
        wmkf_externaltokenrevoked: true,
        wmkf_externaltokenhash: 'hash-a3',
        wmkf_proposalfirstaccessed: null,
        wmkf_reviewsharepointfolder: null,
        wmkf_reviewuploadedbystaff: false,
        wmkf_revieweraffiliation: null,
      },
    ]);
    fetchAnswersBySuggestion.mockResolvedValueOnce({
      'sug-a1': [
        { questionKey: 'riskLevel', answerValue: 'low' },
        { questionKey: 'overallAssessment', answerValue: 'Fundable with minor revisions' },
      ],
    });
    getActiveQuestionSet.mockResolvedValueOnce([
      { key: 'impact', order: 1, label: 'Impact and Significance', type: 'picklist' },
      { key: 'feasibility', order: 2, label: 'Feasibility', type: 'text' },
    ]);

    const out = await getReviewers({ proposalId: 'req-a1', azureEmail: 'staff@wmkeck.org' });

    expect(out).toEqual({
      success: true,
      totalReviewers: 3,
      liveQuestions: [
        { key: 'impact', order: 1, text: 'Impact and Significance', type: 'picklist' },
        { key: 'feasibility', order: 2, text: 'Feasibility', type: 'text' },
      ],
      proposals: [
        {
          proposalId: 'req-a1',
          proposalTitle: 'Catalytic Water Splitting Mechanisms',
          proposalAbstract: 'Investigating novel catalysts for water splitting.',
          proposalAuthors: 'Dr. Priya Natarajan',
          proposalInstitution: 'Acme Research Institute',
          requestNumber: 'R-2001',
          programArea: 'Physical Sciences',
          grantCycleCode: 'J26',
          cycleLabel: expect.any(String),
          meetingDate: '2026-06-15',
          reviewDeadline: '2026-09-01',
          reviewSynthesis: {
            consensus: ['Strong methodology'],
            disagreements: [],
            keyConcerns: ['Budget scope'],
            ratingSummaries: [{ questionKey: 'impact', questionText: 'Impact?', summary: 'High impact' }],
            overall: 'Recommend funding',
          },
          reviewSynthesisState: {
            ready: true,
            canRunManually: true,
            participantCount: 3,
            submittedCount: 1,
            resolvedCount: 3,
            blockingCount: 0,
            ...UNAVAILABLE_JOB_STATE,
          },
          statusSummary: { review_received: 1, materials_sent: 1, accepted: 1 },
          reviewers: [
            {
              suggestionId: 'sug-a1',
              potentialReviewerId: 'person-a1',
              name: 'Dr. Priya Natarajan',
              affiliation: 'MIT Department of Chemistry',
              email: 'priya.natarajan@example.edu',
              website: 'https://chem.mit.edu/natarajan',
              hIndex: 34,
              totalCitations: 5210,
              notes: 'Strong fit for chemistry expertise.',
              reviewStatus: 'review_received',
              responseType: 'accepted',
              emailSentAt: '2026-06-20T09:00:00Z',
              respondReminderSentAt: null,
              responseReceivedAt: '2026-06-22T14:30:00Z',
              withdrawnSufficientAt: null,
              completedAt: '2026-08-05T00:00:00Z',
              materialsSentAt: null,
              daysSinceMaterialsSent: null,
              reminderSentAt: null,
              reminderCount: 0,
              reviewDueDateOverride: '2026-09-10',
              effectiveReviewDeadline: '2026-09-10',
              reviewDueReminderEligibility: 'eligible',
              reviewReceivedAt: '2026-08-01T12:00:00Z',
              submitted: true,
              reviewFilename: 'review-priya.pdf',
              thankyouSentAt: '2026-08-06T00:00:00Z',
              tokenIssuedAt: '2026-06-20T09:00:00Z',
              tokenExpiresAt: '2099-01-01T00:00:00Z',
              tokenRevoked: false,
              tokenState: 'active',
              proposalFirstAccessedAt: '2026-06-21T08:00:00Z',
              reviewSharePointFolder: 'https://wmkf.sharepoint.com/reviews/req-a1/sug-a1',
              reviewUploadedByStaff: false,
              reviewerAffiliation: 'MIT Chemistry',
              reviewerRiskLevel: 'low',
              reviewerOverallAssessment: 'Fundable with minor revisions',
              answers: [
                { questionKey: 'riskLevel', answerValue: 'low' },
                { questionKey: 'overallAssessment', answerValue: 'Fundable with minor revisions' },
              ],
            },
            {
              suggestionId: 'sug-a2',
              potentialReviewerId: 'person-a2',
              name: 'Dr. Marcus Lindqvist',
              affiliation: 'Uppsala University, Dept of Physical Chemistry',
              email: 'mlindqvist@example.org',
              website: 'https://uu.se/lindqvist',
              hIndex: 19,
              totalCitations: 1875,
              notes: null,
              reviewStatus: 'materials_sent',
              responseType: 'accepted',
              emailSentAt: '2026-06-20T09:05:00Z',
              respondReminderSentAt: '2026-07-01T00:00:00Z',
              responseReceivedAt: '2026-06-23T10:00:00Z',
              withdrawnSufficientAt: null,
              completedAt: null,
              materialsSentAt: null,
              daysSinceMaterialsSent: null,
              reminderSentAt: '2026-08-10T00:00:00Z',
              reminderCount: 2,
              reviewDueDateOverride: null,
              effectiveReviewDeadline: '2026-09-01',
              reviewDueReminderEligibility: 'token_expired',
              reviewReceivedAt: null,
              submitted: false,
              reviewFilename: null,
              thankyouSentAt: null,
              tokenIssuedAt: '2026-06-20T09:05:00Z',
              tokenExpiresAt: '2020-01-01T00:00:00Z',
              tokenRevoked: false,
              tokenState: 'expired',
              proposalFirstAccessedAt: null,
              reviewSharePointFolder: null,
              reviewUploadedByStaff: false,
              reviewerAffiliation: null,
              reviewerRiskLevel: null,
              reviewerOverallAssessment: null,
              answers: [],
            },
            {
              suggestionId: 'sug-a3',
              potentialReviewerId: 'person-a3-missing',
              name: null,
              affiliation: null,
              email: null,
              website: null,
              hIndex: null,
              totalCitations: null,
              notes: 'Backup reviewer, pending record cleanup.',
              reviewStatus: 'accepted',
              responseType: 'accepted',
              emailSentAt: null,
              respondReminderSentAt: null,
              responseReceivedAt: null,
              withdrawnSufficientAt: null,
              completedAt: null,
              materialsSentAt: null,
              daysSinceMaterialsSent: null,
              reminderSentAt: null,
              reminderCount: 0,
              reviewDueDateOverride: null,
              effectiveReviewDeadline: '2026-09-01',
              reviewDueReminderEligibility: 'token_revoked',
              reviewReceivedAt: null,
              submitted: false,
              reviewFilename: null,
              thankyouSentAt: null,
              tokenIssuedAt: '2026-06-25T00:00:00Z',
              tokenExpiresAt: '2099-01-01T00:00:00Z',
              tokenRevoked: true,
              tokenState: 'revoked',
              proposalFirstAccessedAt: null,
              reviewSharePointFolder: null,
              reviewUploadedByStaff: false,
              reviewerAffiliation: null,
              reviewerRiskLevel: null,
              reviewerOverallAssessment: null,
              answers: [],
            },
          ],
        },
      ],
    });
  });

  test('(b) empty person-id set: queryReviewers never called, || {} / null fallbacks throughout', async () => {
    getRequestById.mockResolvedValueOnce({
      akoya_requestid: 'req-b1',
      akoya_requestnum: 'R-2002',
      akoya_title: null,
      wmkf_meetingdate: null,
      wmkf_reviewduedate: null,
    });
    findByRequest.mockResolvedValueOnce([
      {
        wmkf_appreviewersuggestionid: 'sug-b1',
        _wmkf_request_value: 'req-b1',
        _wmkf_potentialreviewer_value: null,
        wmkf_accepted: true,
        wmkf_invited: true,
        wmkf_selected: true,
        wmkf_reviewstatus: null,
        wmkf_responsetype: null,
      },
    ]);
    getActiveQuestionSet.mockResolvedValueOnce([]);

    const out = await getReviewers({ proposalId: 'req-b1', azureEmail: 'staff@wmkeck.org' });

    expect(queryReviewersImpl).not.toHaveBeenCalled();
    expect(out).toEqual({
      success: true,
      totalReviewers: 1,
      liveQuestions: [],
      proposals: [
        {
          proposalId: 'req-b1',
          proposalTitle: 'Request R-2002',
          proposalAbstract: null,
          proposalAuthors: null,
          proposalInstitution: null,
          requestNumber: 'R-2002',
          programArea: null,
          grantCycleCode: null,
          cycleLabel: null,
          meetingDate: null,
          reviewDeadline: null,
          reviewSynthesis: null,
          reviewSynthesisState: {
            ready: false,
            canRunManually: false,
            participantCount: 1,
            submittedCount: 0,
            resolvedCount: 0,
            blockingCount: 1,
            ...UNAVAILABLE_JOB_STATE,
          },
          statusSummary: { accepted: 1 },
          reviewers: [
            {
              suggestionId: 'sug-b1',
              potentialReviewerId: null,
              name: null,
              affiliation: null,
              email: null,
              website: null,
              hIndex: null,
              totalCitations: null,
              notes: null,
              reviewStatus: 'accepted',
              responseType: null,
              emailSentAt: null,
              respondReminderSentAt: null,
              responseReceivedAt: null,
              withdrawnSufficientAt: null,
              completedAt: null,
              materialsSentAt: null,
              daysSinceMaterialsSent: null,
              reminderSentAt: null,
              reminderCount: 0,
              reviewDueDateOverride: null,
              effectiveReviewDeadline: null,
              reviewDueReminderEligibility: 'token_not_minted',
              reviewReceivedAt: null,
              submitted: false,
              reviewFilename: null,
              thankyouSentAt: null,
              tokenIssuedAt: null,
              tokenExpiresAt: null,
              tokenRevoked: false,
              tokenState: 'not_minted',
              proposalFirstAccessedAt: null,
              reviewSharePointFolder: null,
              reviewUploadedByStaff: false,
              reviewerAffiliation: null,
              reviewerRiskLevel: null,
              reviewerOverallAssessment: null,
              answers: [],
            },
          ],
        },
      ],
    });
  });
});

// ─────────────────────────── getMyCandidates ───────────────────────────

describe('getMyCandidates — characterization', () => {
  test('(c) single-request, active-only: full hydration + AKA institution + review history', async () => {
    getRequestById.mockResolvedValueOnce({
      akoya_requestid: 'req-c1',
      akoya_requestnum: 'R-3001',
      akoya_title: 'Nanomaterial Drug Delivery Platforms',
      wmkf_meetingdate: '2026-12-10',
      wmkf_reviewduedate: '2027-02-15',
      wmkf_abstract: 'Novel delivery mechanisms using engineered nanoparticles.',
      _akoya_applicantid_value: 'acct-c1',
      _akoya_applicantid_value_formatted: 'Acme University (legal)',
      _wmkf_projectleader_value_formatted: 'Dr. Amara Okafor',
      _wmkf_grantprogram_value_formatted: 'Materials Science Grant',
      _wmkf_programareaserved_value_formatted: 'Engineering',
    });
    findByRequest.mockResolvedValueOnce([
      {
        wmkf_appreviewersuggestionid: 'sug-c1',
        _wmkf_request_value: 'req-c1',
        _wmkf_potentialreviewer_value: 'person-c1',
        wmkf_sources: 'literature_retrieved',
        wmkf_relevancescore: 0.91,
        wmkf_matchreason: 'Cited three times in the proposal bibliography.',
        wmkf_applicantdisposition: null,
        wmkf_invited: true,
        wmkf_accepted: true,
        wmkf_declined: false,
        wmkf_notes: 'Great domain fit.',
        wmkf_emailsentat: '2026-12-11T09:00:00Z',
        wmkf_responsetype: 100000000,
        wmkf_responsereceivedat: '2026-12-12T10:00:00Z',
        wmkf_respondremindersentat: null,
        wmkf_reviewduedateoverride: '2027-02-20',
        wmkf_grantcyclecode: null,
        wmkf_summarybloburl: 'https://blob.core.windows.net/summaries/req-c1.pdf',
        createdon: '2026-12-01T08:00:00Z',
      },
      {
        wmkf_appreviewersuggestionid: 'sug-c2',
        _wmkf_request_value: 'req-c1',
        _wmkf_potentialreviewer_value: 'person-c2',
        wmkf_sources: 'staff_manual',
        wmkf_relevancescore: null,
        wmkf_matchreason: null,
        wmkf_applicantdisposition: null,
        wmkf_invited: false,
        wmkf_accepted: false,
        wmkf_declined: false,
        wmkf_notes: null,
        wmkf_emailsentat: null,
        wmkf_responsetype: null,
        wmkf_responsereceivedat: null,
        wmkf_respondremindersentat: null,
        wmkf_reviewduedateoverride: null,
        wmkf_grantcyclecode: null,
        wmkf_summarybloburl: null,
        createdon: '2026-12-02T09:00:00Z',
      },
    ]);
    findRemovedByRequest.mockResolvedValueOnce([]);
    queryAccounts.mockResolvedValueOnce({
      records: [{ accountid: 'acct-c1', akoya_aka: 'Acme University', name: 'Acme University (legal)' }],
    });
    aggregateReviewHistory.mockResolvedValueOnce({
      'person-c1': { reviewCount: 3, lastReviewAt: '2026-07-01T00:00:00Z' },
    });

    const out = await getMyCandidates({ requestId: 'req-c1', azureEmail: 'staff@wmkeck.org' });

    expect(out).toEqual({
      success: true,
      totalCandidates: 2,
      proposals: [
        {
          proposalId: 'req-c1',
          proposalTitle: 'Nanomaterial Drug Delivery Platforms',
          proposalAbstract: 'Novel delivery mechanisms using engineered nanoparticles.',
          proposalAuthors: 'Dr. Amara Okafor',
          proposalInstitution: 'Acme University',
          requestNumber: 'R-3001',
          programArea: 'Engineering',
          grantCycleCode: 'D26',
          grantCycleLabel: expect.any(String),
          meetingDate: '2026-12-10',
          reviewDeadline: '2027-02-15',
          summaryBlobUrl: 'https://blob.core.windows.net/summaries/req-c1.pdf',
          candidates: [
            {
              suggestionId: 'sug-c1',
              potentialReviewerId: 'person-c1',
              name: 'Dr. Amara Okafor',
              affiliation: 'Acme University, Materials Science',
              academicRank: 'Associate Professor',
              primaryDepartment: 'Materials Science',
              mainInstitution: 'Acme University',
              email: 'aokafor@example.edu',
              website: 'https://acme.edu/okafor',
              facultyPageUrl: 'https://acme.edu/faculty/okafor',
              googleScholarUrl: 'https://scholar.google.com/citations?user=okafor-scholar',
              googleScholarId: 'okafor-scholar',
              orcid: '0000-0003-1234-5678',
              orcidUrl: 'https://orcid.org/0000-0003-1234-5678',
              keywords: 'nanomaterials, catalysis',
              hIndex: 22,
              totalCitations: 2650,
              relevanceScore: 0.91,
              reasoning: 'Cited three times in the proposal bibliography.',
              sources: ['literature_retrieved'],
              referredBy: null,
              applicantRecommended: false,
              manualAdded: false,
              invited: true,
              accepted: true,
              declined: false,
              notes: 'Great domain fit.',
              emailSentAt: '2026-12-11T09:00:00Z',
              responseType: 'accepted',
              responseReceivedAt: '2026-12-12T10:00:00Z',
              respondReminderSentAt: null,
              reviewDueDateOverride: '2027-02-20',
              requestReviewDeadline: '2027-02-15',
              effectiveReviewDeadline: '2027-02-20',
              savedAt: '2026-12-01T08:00:00Z',
              priorReviewCount: 3,
              lastReviewAt: '2026-07-01T00:00:00Z',
            },
            {
              suggestionId: 'sug-c2',
              potentialReviewerId: 'person-c2',
              name: 'Dr. Felix Baumgartner',
              affiliation: 'ETH Zurich, Department of Physics',
              academicRank: 'Professor',
              primaryDepartment: 'Physics',
              mainInstitution: 'ETH Zurich',
              email: 'fbaumgartner@example.org',
              website: 'https://ethz.ch/baumgartner',
              facultyPageUrl: null, // document URL (.pdf) filtered out
              googleScholarUrl: 'https://scholar.google.com/citations?user=baumgartner-scholar',
              googleScholarId: 'baumgartner-scholar',
              orcid: '0000-0002-9999-0000',
              orcidUrl: 'https://orcid.org/0000-0002-9999-0000',
              keywords: 'condensed matter',
              hIndex: 41,
              totalCitations: 8890,
              relevanceScore: null,
              reasoning: null,
              sources: ['staff_manual'],
              referredBy: null,
              applicantRecommended: false,
              manualAdded: true,
              invited: false,
              accepted: false,
              declined: false,
              notes: null,
              emailSentAt: null,
              responseType: null,
              responseReceivedAt: null,
              respondReminderSentAt: null,
              reviewDueDateOverride: null,
              requestReviewDeadline: '2027-02-15',
              effectiveReviewDeadline: '2027-02-15',
              savedAt: '2026-12-02T09:00:00Z',
              priorReviewCount: 0,
              lastReviewAt: null,
            },
          ],
        },
      ],
    });
  });

  test('(d) single-request, removed-only: proposal shell + full removedCandidates projection', async () => {
    getRequestById.mockResolvedValueOnce({
      akoya_requestid: 'req-d1',
      akoya_requestnum: 'R-3002',
      akoya_title: 'Quantum Sensing for Environmental Monitoring',
    });
    findByRequest.mockResolvedValueOnce([]);
    findRemovedByRequest.mockResolvedValueOnce([
      {
        wmkf_appreviewersuggestionid: 'sug-d1',
        _wmkf_potentialreviewer_value: 'person-d1',
        wmkf_matchreason: 'Declined; recommended a colleague instead.',
        wmkf_invited: true,
        wmkf_declined: true,
        wmkf_responsetype: 100000001, // declined
        modifiedon: '2026-11-05T16:00:00Z',
      },
    ]);

    const out = await getMyCandidates({ requestId: 'req-d1', azureEmail: 'staff@wmkeck.org' });

    expect(out).toEqual({
      success: true,
      totalCandidates: 0,
      proposals: [
        {
          proposalId: 'req-d1',
          proposalTitle: 'Quantum Sensing for Environmental Monitoring',
          requestNumber: 'R-3002',
          candidates: [],
          removedCandidates: [
            {
              suggestionId: 'sug-d1',
              potentialReviewerId: 'person-d1',
              name: 'Dr. Grace Kim',
              affiliation: 'Seoul National University, Chemistry',
              email: 'gkim@example.edu',
              emailSource: 'manual',
              personEtag: 'W/"person-d1-etag-7"',
              reasoning: 'Declined; recommended a colleague instead.',
              googleScholarId: 'gkim-scholar',
              orcid: '0000-0001-1111-2222',
              orcidUrl: 'https://orcid.org/0000-0001-1111-2222',
              wasInvited: true,
              declined: true,
              responseType: 'declined',
              removedAt: '2026-11-05T16:00:00Z',
            },
          ],
        },
      ],
    });
  });

  test('(e) combined active + removed: SAME person id in an active row and a distinct removed row', async () => {
    getRequestById.mockResolvedValueOnce({
      akoya_requestid: 'req-e1',
      akoya_requestnum: 'R-3003',
      akoya_title: 'Coral Reef Resilience Genomics',
    });
    findByRequest.mockResolvedValueOnce([
      {
        wmkf_appreviewersuggestionid: 'sug-e-active',
        _wmkf_request_value: 'req-e1',
        _wmkf_potentialreviewer_value: 'person-e1',
        wmkf_sources: 'proposal_named',
        wmkf_invited: true,
        wmkf_accepted: true,
        wmkf_declined: false,
        wmkf_responsetype: 100000000,
        createdon: '2026-10-01T00:00:00Z',
      },
    ]);
    findRemovedByRequest.mockResolvedValueOnce([
      {
        wmkf_appreviewersuggestionid: 'sug-e-removed',
        _wmkf_potentialreviewer_value: 'person-e1',
        wmkf_matchreason: null,
        wmkf_invited: false,
        wmkf_declined: false,
        wmkf_responsetype: null,
        modifiedon: '2026-09-15T00:00:00Z',
      },
    ]);

    const out = await getMyCandidates({ requestId: 'req-e1', azureEmail: 'staff@wmkeck.org' });

    expect(out.totalCandidates).toBe(1);
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].candidates).toEqual([
      expect.objectContaining({
        suggestionId: 'sug-e-active',
        potentialReviewerId: 'person-e1',
        name: 'Dr. Hassan Al-Sayed',
        affiliation: 'Cairo University, Engineering',
        accepted: true,
        sources: ['proposal_named'],
      }),
    ]);
    expect(out.proposals[0].removedCandidates).toEqual([
      {
        suggestionId: 'sug-e-removed',
        potentialReviewerId: 'person-e1',
        name: 'Dr. Hassan Al-Sayed',
        affiliation: 'Cairo University, Engineering',
        email: 'halsayed@example.org',
        emailSource: 'enrichment',
        personEtag: 'W/"person-e1-etag-2"',
        reasoning: null,
        googleScholarId: 'alsayed-scholar',
        orcid: '0000-0004-4444-5555',
        orcidUrl: 'https://orcid.org/0000-0004-4444-5555',
        wasInvited: false,
        declined: false,
        responseType: null,
        removedAt: '2026-09-15T00:00:00Z',
      },
    ]);
  });

  test('(f) empty envelope: no suggestions, no removed rows', async () => {
    getRequestById.mockResolvedValueOnce({
      akoya_requestid: 'req-f1',
      akoya_requestnum: 'R-3004',
      akoya_title: 'Empty proposal',
    });
    findByRequest.mockResolvedValueOnce([]);
    findRemovedByRequest.mockResolvedValueOnce([]);

    const out = await getMyCandidates({ requestId: 'req-f1', azureEmail: 'staff@wmkeck.org' });

    expect(out).toEqual({ success: true, proposals: [], totalCandidates: 0 });
    expect(queryReviewersImpl).not.toHaveBeenCalled();
  });

  test('(f) PD-scope suggestions with null person refs never call queryReviewers', async () => {
    resolvePD.mockResolvedValueOnce({ systemuserid: 'pd-1' });
    findByPD.mockResolvedValueOnce({
      suggestions: [
        {
          wmkf_appreviewersuggestionid: 'sug-f2',
          _wmkf_request_value: 'req-f2',
          _wmkf_potentialreviewer_value: null,
          wmkf_sources: 'proposal_named',
          wmkf_invited: false,
          wmkf_accepted: false,
          wmkf_declined: false,
          createdon: '2026-05-01T00:00:00Z',
        },
      ],
      requestById: {
        'req-f2': {
          requestId: 'req-f2',
          requestNumber: 'R-3005',
          title: 'PD-scope proposal',
          abstract: null,
          meetingDate: null,
          reviewDeadline: null,
          cycleCode: null,
          cycleLabel: null,
          applicantId: null,
          applicant: null,
          projectLeader: null,
          grantProgram: null,
          programArea: null,
          programDirectorId: 'pd-1',
        },
      },
    });

    const out = await getMyCandidates({ azureEmail: 'pd@wmkeck.org' });

    expect(queryReviewersImpl).not.toHaveBeenCalled();
    expect(out.totalCandidates).toBe(1);
    expect(out.proposals[0].candidates[0]).toMatchObject({
      suggestionId: 'sug-f2',
      potentialReviewerId: null,
      name: null,
      affiliation: null,
    });
  });

  test('(g) aggregateReviewHistory rejection is fail-soft: list returns, priorReviewCount 0 / lastReviewAt null', async () => {
    getRequestById.mockResolvedValueOnce({
      akoya_requestid: 'req-g1',
      akoya_requestnum: 'R-3006',
      akoya_title: 'Fail-soft review history proposal',
    });
    findByRequest.mockResolvedValueOnce([
      {
        wmkf_appreviewersuggestionid: 'sug-g1',
        _wmkf_request_value: 'req-g1',
        _wmkf_potentialreviewer_value: 'person-g1',
        wmkf_sources: 'literature_retrieved',
        wmkf_invited: true,
        wmkf_accepted: true,
        wmkf_declined: false,
        createdon: '2026-04-01T00:00:00Z',
      },
    ]);
    findRemovedByRequest.mockResolvedValueOnce([]);
    aggregateReviewHistory.mockRejectedValueOnce(new Error('history query timed out'));

    const out = await getMyCandidates({ requestId: 'req-g1', azureEmail: 'staff@wmkeck.org' });

    expect(out.totalCandidates).toBe(1);
    expect(out.proposals[0].candidates[0]).toMatchObject({
      suggestionId: 'sug-g1',
      name: 'Dr. Ines Duarte',
      priorReviewCount: 0,
      lastReviewAt: null,
    });
  });
});

// ────────────────────────── getDeclineReferrals ──────────────────────────

describe('getDeclineReferrals — characterization', () => {
  test('(h) one already-resolved structured referral is excluded; one unresolved structured referral is pinned in full', async () => {
    const resolvedStored = normalizeDeclineReferrals([
      { name: 'Dr. Elena Popova', institution: 'ETH Zurich', email: 'epopova@ethz.ch' },
    ]).storedValue;
    const unresolvedStored = normalizeDeclineReferrals([
      { name: 'Dr. Sanjay Mehta', institution: 'IIT Bombay', email: 'smehta@iitb.ac.in' },
    ]).storedValue;

    findByRequest.mockResolvedValueOnce([
      {
        wmkf_appreviewersuggestionid: 'sug-h-decliner-a',
        _wmkf_potentialreviewer_value: 'person-h-a',
        wmkf_accepted: false,
        wmkf_declined: true,
        wmkf_selected: false,
        wmkf_declinereferral: resolvedStored,
        wmkf_responsereceivedat: '2026-07-01T09:00:00Z',
      },
      {
        wmkf_appreviewersuggestionid: 'sug-h-decliner-b',
        _wmkf_potentialreviewer_value: 'person-h-b',
        wmkf_accepted: false,
        wmkf_declined: true,
        wmkf_selected: false,
        wmkf_declinereferral: unresolvedStored,
        wmkf_responsereceivedat: '2026-07-02T11:00:00Z',
      },
      {
        // durably-selected referred candidate that exactly matches decliner A's referral
        wmkf_appreviewersuggestionid: 'sug-h-elena',
        _wmkf_potentialreviewer_value: 'person-h-elena',
        wmkf_accepted: false,
        wmkf_declined: false,
        wmkf_selected: true,
        wmkf_sources: 'referred',
        wmkf_declinereferral: null,
        wmkf_responsereceivedat: null,
      },
    ]);

    const out = await getDeclineReferrals({ requestId: 'req-h1' });

    expect(findByRequest).toHaveBeenCalledWith('req-h1', { selectedOnly: false });
    expect(out).toEqual({
      success: true,
      referrals: [
        {
          referralId: 'sug-h-decliner-b:0',
          suggestionId: 'sug-h-decliner-b',
          referralIndex: 0,
          reviewerName: 'Dr. Wei Zhang',
          referralName: 'Dr. Sanjay Mehta',
          institution: 'IIT Bombay',
          email: 'smehta@iitb.ac.in',
          referralText: 'Dr. Sanjay Mehta · IIT Bombay · smehta@iitb.ac.in',
          legacy: false,
          dismissible: true,
          referralVersion: expect.any(String),
          declinedAt: '2026-07-02T11:00:00Z',
        },
      ],
    });
  });

  test('(h) empty case: no declined-with-referral rows → empty envelope, queryReviewers never called', async () => {
    findByRequest.mockResolvedValueOnce([
      {
        wmkf_appreviewersuggestionid: 'sug-h-empty',
        _wmkf_potentialreviewer_value: 'person-h-a',
        wmkf_accepted: true,
        wmkf_declined: false,
        wmkf_selected: true,
        wmkf_declinereferral: null,
        wmkf_responsereceivedat: null,
      },
    ]);

    const out = await getDeclineReferrals({ requestId: 'req-h2' });

    expect(out).toEqual({ success: true, referrals: [] });
    expect(queryReviewersImpl).not.toHaveBeenCalled();
  });
});
