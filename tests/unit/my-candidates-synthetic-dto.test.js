/**
 * 6c-ii Stage A, plan "Read-side fan-out of the marker" -- Reviewer Finder
 * candidate hydration. Derived `isSyntheticReviewer` boolean only, gated
 * exactly like `testRequestVisibilityDto`.
 *
 * @jest-environment node
 */

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
  APPLICANT_DISPOSITION_MAP: { recommended: 100000000 },
  RESPONSE_TYPE_BY_VALUE: { 100000000: 'accepted', 100000001: 'declined' },
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  __esModule: true,
  queryReviewers: jest.fn(async () => ({ records: [] })),
  getById: jest.fn(),
  update: jest.fn(async () => {}),
  clearEmailForEdit: jest.fn(async () => ({ cleared: true })),
  findByEmailCandidates: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  __esModule: true,
  updateById: jest.fn(async () => {}),
}));
jest.mock('../../lib/external/token-lifecycle', () => ({
  ensureToken: jest.fn(async () => {}),
  buildExternalUrl: jest.fn((token) => `https://reviews.wmkeck.org/external/review/${token}`),
}));
jest.mock('../../lib/services/external-token', () => ({
  hashToken: jest.fn((token) => `hash:${token}`),
}));
jest.mock('../../lib/dataverse/duplicate-key', () => ({ translateDuplicateKeyError: jest.fn(() => null) }));

const grantRequestAdapter = require('../../lib/dataverse/adapters/grant-request');
const suggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const { getMyCandidates } = require('../../lib/services/reviewer-finder/my-candidates-service');

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const SUGGESTION_ID = '33333333-3333-3333-3333-333333333333';
const PERSON_ID = '22222222-2222-2222-2222-222222222222';
const EMAIL = 'pd@example.org';

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SYNTHETIC_REVIEWER_ISOLATION;
  grantRequestAdapter.getById.mockResolvedValue({
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: 'R-1',
    akoya_title: 'A Proposal',
    wmkf_meetingdate: '2026-06-15',
    wmkf_reviewduedate: '2026-09-01',
  });
  suggestionAdapter.findByRequest.mockResolvedValue([{
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: PERSON_ID,
    wmkf_sources: 'literature_retrieved',
  }]);
});

afterEach(() => { delete process.env.SYNTHETIC_REVIEWER_ISOLATION; });

test('switch OFF: no isSyntheticReviewer key, and no marker in the select', async () => {
  potentialReviewerAdapter.queryReviewers.mockResolvedValue({
    records: [{ wmkf_potentialreviewersid: PERSON_ID, wmkf_name: 'Dr X' }],
  });
  const out = await getMyCandidates({ requestId: REQUEST_ID, azureEmail: EMAIL });
  const candidate = out.proposals[0].candidates[0];
  expect(candidate).not.toHaveProperty('isSyntheticReviewer');
  const [options] = potentialReviewerAdapter.queryReviewers.mock.calls[0];
  expect(options.select).not.toMatch(/wmkf_issyntheticreviewer/);
});

test('switch ON: emits isSyntheticReviewer=true, never the raw field', async () => {
  process.env.SYNTHETIC_REVIEWER_ISOLATION = 'on';
  potentialReviewerAdapter.queryReviewers.mockResolvedValue({
    records: [{ wmkf_potentialreviewersid: PERSON_ID, wmkf_name: 'TEST · X', wmkf_issyntheticreviewer: true }],
  });
  const out = await getMyCandidates({ requestId: REQUEST_ID, azureEmail: EMAIL });
  const candidate = out.proposals[0].candidates[0];
  expect(candidate.isSyntheticReviewer).toBe(true);
  expect(candidate).not.toHaveProperty('wmkf_issyntheticreviewer');
});
