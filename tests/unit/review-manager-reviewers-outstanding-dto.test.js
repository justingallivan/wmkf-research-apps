/**
 * GET /api/review-manager/reviewers — outstanding-tracking DTO fields
 * (workbench Reviews tab Phase 1, docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md).
 *
 * Verifies `submitted`, `daysSinceMaterialsSent`, `materialsSentAt`,
 * `reminderSentAt`, and `reminderCount` are projected correctly for an
 * accepted-but-not-submitted reviewer vs a submitted one. The adapter +
 * DynamicsService are mocked; the route's projection logic runs for real.
 */

import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import * as suggestionAdapter from '../../lib/dataverse/adapters/reviewer-suggestion';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    getRecord: jest.fn(),
    queryRecords: jest.fn(),
    queryAllRecords: jest.fn(),
  },
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findByRequest: jest.fn(),
  RESPONSE_TYPE_BY_VALUE: {},
}));

const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';
const OUTSTANDING_ID = '11111111-1111-1111-1111-111111111111';
const SUBMITTED_ID = '22222222-2222-2222-2222-222222222222';
const PERSON_OUTSTANDING = '33333333-3333-3333-3333-333333333333';
const PERSON_SUBMITTED = '44444444-4444-4444-4444-444444444444';

const DAY_MS = 24 * 60 * 60 * 1000;

let handler;
beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/reviewers')).default;
});

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { azureEmail: 'pd@example.com' } } });
  DynamicsService.getRecord.mockResolvedValue({
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002788',
    akoya_title: 'Test',
    wmkf_meetingdate: null,
    wmkf_reviewduedate: '2099-09-09',
  });
  DynamicsService.queryRecords.mockResolvedValue({
    records: [
      { wmkf_potentialreviewersid: PERSON_OUTSTANDING, wmkf_name: 'Dr. Outstanding', wmkf_emailaddress: 'out@e.com' },
      { wmkf_potentialreviewersid: PERSON_SUBMITTED, wmkf_name: 'Dr. Submitted', wmkf_emailaddress: 'sub@e.com' },
    ],
  });
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [] });
});

function get(query) {
  const req = createMockReq({ method: 'GET', query });
  const res = createMockRes();
  return { req, res };
}

test('accepted, materials sent, not submitted → submitted:false with days-since-materials-sent computed', async () => {
  const materialsSentAt = new Date(Date.now() - 5 * DAY_MS).toISOString();
  suggestionAdapter.findByRequest.mockResolvedValue([{
    wmkf_appreviewersuggestionid: OUTSTANDING_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: PERSON_OUTSTANDING,
    wmkf_accepted: true,
    wmkf_reviewstatus: 100000001, // materials_sent
    wmkf_materialssentat: materialsSentAt,
    wmkf_remindersentat: null,
    wmkf_remindercount: 0,
    wmkf_reviewreceivedat: null,
    wmkf_externaltokenhash: 'stored-token-hash',
    wmkf_externaltokenexpires: '2100-01-01T00:00:00Z',
    wmkf_externaltokenrevoked: false,
  }]);

  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  const reviewer = res._data.proposals[0].reviewers[0];
  expect(reviewer.submitted).toBe(false);
  expect(reviewer.materialsSentAt).toBe(materialsSentAt);
  expect(reviewer.daysSinceMaterialsSent).toBe(5);
  expect(reviewer.reminderSentAt).toBeNull();
  expect(reviewer.reminderCount).toBe(0);
  expect(reviewer.tokenState).toBe('active');
  expect(reviewer.reviewDueReminderEligibility).toBe('eligible');
});

test('token state remains pure liveness while reminder eligibility reports deadline coverage separately', async () => {
  suggestionAdapter.findByRequest.mockResolvedValue([{
    wmkf_appreviewersuggestionid: OUTSTANDING_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: PERSON_OUTSTANDING,
    wmkf_accepted: true,
    wmkf_reviewstatus: 100000001,
    wmkf_materialssentat: '2026-08-01T00:00:00Z',
    wmkf_reviewreceivedat: null,
    wmkf_externaltokenhash: 'stored-token-hash',
    wmkf_externaltokenexpires: '2099-09-09T23:59:59Z',
    wmkf_externaltokenrevoked: false,
  }]);

  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);

  const reviewer = res._data.proposals[0].reviewers[0];
  expect(reviewer.tokenState).toBe('active');
  expect(reviewer.reviewDueReminderEligibility).toBe('token_insufficient_window');
});

test('submitted reviewer → submitted:true regardless of materialsSentAt age', async () => {
  const materialsSentAt = new Date(Date.now() - 10 * DAY_MS).toISOString();
  suggestionAdapter.findByRequest.mockResolvedValue([{
    wmkf_appreviewersuggestionid: SUBMITTED_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: PERSON_SUBMITTED,
    wmkf_accepted: true,
    wmkf_reviewstatus: 100000003, // review_received
    wmkf_materialssentat: materialsSentAt,
    wmkf_reviewreceivedat: '2026-06-28T12:00:00Z',
  }]);

  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  const reviewer = res._data.proposals[0].reviewers[0];
  expect(reviewer.submitted).toBe(true);
  expect(reviewer.daysSinceMaterialsSent).toBe(10);
});

test('materials not yet sent → daysSinceMaterialsSent is null', async () => {
  suggestionAdapter.findByRequest.mockResolvedValue([{
    wmkf_appreviewersuggestionid: OUTSTANDING_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: PERSON_OUTSTANDING,
    wmkf_accepted: true,
    wmkf_reviewstatus: 100000000, // accepted, materials not sent yet
    wmkf_materialssentat: null,
    wmkf_reviewreceivedat: null,
  }]);

  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  const reviewer = res._data.proposals[0].reviewers[0];
  expect(reviewer.submitted).toBe(false);
  expect(reviewer.daysSinceMaterialsSent).toBeNull();
});

test('reminderSentAt + reminderCount pass through from wmkf_remindersentat/wmkf_remindercount', async () => {
  const remindersentat = new Date(Date.now() - 2 * DAY_MS).toISOString();
  suggestionAdapter.findByRequest.mockResolvedValue([{
    wmkf_appreviewersuggestionid: OUTSTANDING_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: PERSON_OUTSTANDING,
    wmkf_accepted: true,
    wmkf_reviewstatus: 100000001,
    wmkf_materialssentat: new Date(Date.now() - 9 * DAY_MS).toISOString(),
    wmkf_remindersentat: remindersentat,
    wmkf_remindercount: 2,
    wmkf_reviewreceivedat: null,
  }]);

  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);

  const reviewer = res._data.proposals[0].reviewers[0];
  expect(reviewer.reminderSentAt).toBe(remindersentat);
  expect(reviewer.reminderCount).toBe(2);
});
