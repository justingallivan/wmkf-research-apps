/**
 * 6c-ii Stage A, plan "Read-side fan-out of the marker" -- Workbench Reviews
 * tab DTO. A person row shown with its own identity emits a derived
 * `isSyntheticReviewer` boolean, never the raw field, gated exactly like
 * `testRequestVisibilityDto`: absent while SYNTHETIC_REVIEWER_ISOLATION is
 * off (byte-for-byte compatible with today's shape), present (true/false)
 * once on.
 *
 * @jest-environment node
 */

const updateLifecycle = jest.fn(async () => {});
const findByRequest = jest.fn();
const findAcceptedByPD = jest.fn();
const findAcceptedByCycle = jest.fn();
jest.mock('../../lib/services/workbench/program-scope-service.js', () => ({
  resolveWorkbenchProgramScope: jest.fn(async () => ({
    programs: [{ programId: '11111111-1111-4111-8111-111111111111', name: 'Research' }],
    defaultProgramId: '11111111-1111-4111-8111-111111111111',
    programId: '11111111-1111-4111-8111-111111111111',
    programName: 'Research',
  })),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  updateLifecycle: (...a) => updateLifecycle(...a),
  findByRequest: (...a) => findByRequest(...a),
  findAcceptedByPD: (...a) => findAcceptedByPD(...a),
  findAcceptedByCycle: (...a) => findAcceptedByCycle(...a),
  RESPONSE_TYPE_BY_VALUE: {},
  HONORARIUM_ELIGIBILITY_BY_VALUE: {},
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
jest.mock('../../lib/services/program-director-resolver', () => ({
  resolveByEmail: jest.fn(),
}));
jest.mock('../../lib/services/review-answers', () => ({
  fetchAnswersBySuggestion: jest.fn(async () => ({})),
}));
jest.mock('../../lib/external/review-answer-snapshot', () => ({
  ratingsFromAnswers: jest.fn(() => ({ riskLevel: null, overallAssessment: null })),
}));
jest.mock('../../lib/external/review-question-fetcher', () => ({
  getActiveQuestionSet: jest.fn(async () => []),
}));
jest.mock('../../lib/services/review-synthesis-job-service', () => ({
  getReviewSynthesisJobState: jest.fn(async () => ({
    current: false, status: 'not_started', mode: null, runId: null, attempts: 0,
    lastError: null, createdAt: null, updatedAt: null, startedAt: null,
    completedAt: null, currentRunId: null, currentCompletedAt: null,
  })),
}));
jest.mock('@vercel/postgres', () => ({ sql: () => { throw new Error('no SQL expected'); } }));

const REQ = '11111111-1111-4111-8111-111111111111';
const SUG = '22222222-2222-4222-8222-222222222222';
const PERSON = 'person-1';

let getReviewers;
beforeAll(async () => {
  ({ getReviewers } = await import('../../lib/services/review-manager/reviewers-service'));
});

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SYNTHETIC_REVIEWER_ISOLATION;
  getRequestById.mockResolvedValue({
    akoya_requestid: REQ,
    akoya_requestnum: 'R-1001',
    akoya_title: 'T',
    _wmkf_grantprogram_value: '11111111-1111-4111-8111-111111111111',
    wmkf_meetingdate: null,
    wmkf_reviewduedate: null,
  });
  findByRequest.mockResolvedValue([{
    wmkf_appreviewersuggestionid: SUG,
    _wmkf_request_value: REQ,
    _wmkf_potentialreviewer_value: PERSON,
    wmkf_accepted: true,
  }]);
});

afterEach(() => { delete process.env.SYNTHETIC_REVIEWER_ISOLATION; });

test('switch OFF: no isSyntheticReviewer key at all, and no marker named in the person select', async () => {
  queryReviewers.mockResolvedValueOnce({ records: [{ wmkf_potentialreviewersid: PERSON, wmkf_name: 'Ada' }] });
  const out = await getReviewers({ proposalId: REQ, azureEmail: 'pd@wmkeck.org' });
  expect(out.proposals[0].reviewers[0]).not.toHaveProperty('isSyntheticReviewer');
  const [options] = queryReviewers.mock.calls[0];
  expect(options.select).not.toMatch(/wmkf_issyntheticreviewer/);
});

test('switch ON: emits derived isSyntheticReviewer=true for a marker-true person, never the raw field', async () => {
  process.env.SYNTHETIC_REVIEWER_ISOLATION = 'on';
  queryReviewers.mockResolvedValueOnce({
    records: [{ wmkf_potentialreviewersid: PERSON, wmkf_name: 'TEST · Ada', wmkf_issyntheticreviewer: true }],
  });
  const out = await getReviewers({ proposalId: REQ, azureEmail: 'pd@wmkeck.org' });
  expect(out.proposals[0].reviewers[0].isSyntheticReviewer).toBe(true);
  expect(out.proposals[0].reviewers[0]).not.toHaveProperty('wmkf_issyntheticreviewer');
});

test('switch ON: emits isSyntheticReviewer=false for an ordinary person', async () => {
  process.env.SYNTHETIC_REVIEWER_ISOLATION = 'on';
  queryReviewers.mockResolvedValueOnce({
    records: [{ wmkf_potentialreviewersid: PERSON, wmkf_name: 'Ada', wmkf_issyntheticreviewer: false }],
  });
  const out = await getReviewers({ proposalId: REQ, azureEmail: 'pd@wmkeck.org' });
  expect(out.proposals[0].reviewers[0].isSyntheticReviewer).toBe(false);
});
