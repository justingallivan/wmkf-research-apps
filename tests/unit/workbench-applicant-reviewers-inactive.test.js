/** @jest-environment node */

// Exercise the real ingestion, capability, suggestion adapter and repair
// hydrator together; mock only Dataverse transport and unrelated extraction.
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ getById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/potential-reviewer.js', () => ({
  getById: jest.fn(),
  findByEmailCandidates: jest.fn(),
}));
jest.mock('../../lib/services/reviewer-exclusion-parser.js', () => ({
  extractExcludedReviewers: jest.fn(async () => ({ names: [], substantive: false, parseFailed: false })),
}));

import * as requests from '../../lib/dataverse/adapters/grant-request.js';
import * as people from '../../lib/dataverse/adapters/potential-reviewer.js';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { ingestApplicantReviewers } from '../../lib/services/workbench/applicant-reviewers-service.js';
import { ensureApplicantRecommended, upsert, ensureStaffManualCandidate } from '../../lib/dataverse/adapters/reviewer-suggestion.js';

// Existing applicant-reviewers suite identities.
const REQUEST = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PERSON = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SUGGESTION = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const previous = {
  TEST_REQUEST_ISOLATION: process.env.TEST_REQUEST_ISOLATION,
  SYNTHETIC_REVIEWER_ISOLATION: process.env.SYNTHETIC_REVIEWER_ISOLATION,
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TEST_REQUEST_ISOLATION = 'on';
  process.env.SYNTHETIC_REVIEWER_ISOLATION = 'on';
  requests.getById.mockResolvedValue({ akoya_requestid: REQUEST, _wmkf_potentialreviewer1_value: PERSON });
  people.getById.mockResolvedValue({
    wmkf_potentialreviewersid: PERSON, statecode: 1, wmkf_issyntheticreviewer: false,
    wmkf_name: 'Inactive applicant recommendation', wmkf_emailaddress: 'ordinary@example.org',
  });
  jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
  jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ wmkf_appreviewersuggestionid: SUGGESTION });
  jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test.each([false, null])('inactive ordinary marker %s reaches repair hydration and repeat ingestion preserves curation', async (marker) => {
  people.getById.mockResolvedValue({
    wmkf_potentialreviewersid: PERSON, statecode: 1, wmkf_issyntheticreviewer: marker,
    wmkf_name: 'Inactive applicant recommendation', wmkf_emailaddress: 'ordinary@example.org',
  });
  const first = await ingestApplicantReviewers({ requestId: REQUEST });
  expect(first.recommendedComplete).toBe(true);
  expect(first.recommendedFailed).toBeUndefined();
  expect(first.recommended).toHaveLength(1);
  expect(first.recommended[0].applicantKnownReviewer).toMatchObject({
    status: 'inactive', code: 'person_inactive', potentialReviewerId: PERSON,
  });
  expect(first.knownLookupFailed).toEqual([expect.objectContaining({ code: 'person_inactive', potentialReviewerId: PERSON })]);
  expect(DynamicsService.createRecord).toHaveBeenCalledWith('wmkf_appreviewersuggestions', expect.objectContaining({
    wmkf_selected: false,
    'wmkf_PotentialReviewer@odata.bind': `/wmkf_potentialreviewerses(${PERSON})`,
    'wmkf_Request@odata.bind': `/akoya_requests(${REQUEST})`,
  }), expect.any(Object));

  const created = DynamicsService.createRecord.mock.calls[0][1];
  DynamicsService.queryRecords.mockResolvedValue({ records: [{
    ...created, wmkf_appreviewersuggestionid: SUGGESTION, wmkf_selected: true, wmkf_invited: true,
  }] });
  const retry = await ingestApplicantReviewers({ requestId: REQUEST });
  expect(retry.recommendedComplete).toBe(true);
  expect(retry.recommended[0]).toMatchObject({
    suggestionId: SUGGESTION, created: false, selected: true,
    applicantKnownReviewer: { status: 'inactive', code: 'person_inactive' },
  });
  expect(DynamicsService.createRecord).toHaveBeenCalledTimes(1);
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  expect(people.findByEmailCandidates).not.toHaveBeenCalled();
});

test.each([ensureApplicantRecommended, upsert, ensureStaffManualCandidate])('other binding callers remain strict for inactive ordinary people (%p)', async (bind) => {
  await expect(bind({ potentialReviewerId: PERSON, requestId: REQUEST }))
    .rejects.toMatchObject({ code: 'reviewer_person_inactive' });
  expect(DynamicsService.queryRecords).not.toHaveBeenCalled();
  expect(DynamicsService.createRecord).not.toHaveBeenCalled();
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
});

test('inactive synthetic slot still fails before any junction write', async () => {
  people.getById.mockResolvedValue({ wmkf_potentialreviewersid: PERSON, statecode: 1, wmkf_issyntheticreviewer: true });
  const body = await ingestApplicantReviewers({ requestId: REQUEST });
  expect(body.recommendedComplete).toBe(false);
  expect(body.recommendedFailed).toHaveLength(1);
  expect(body.recommended).toEqual([]);
  expect(DynamicsService.createRecord).not.toHaveBeenCalled();
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
});

test('adapter re-read refuses a slot person whose marker changed to synthetic after the service read', async () => {
  people.getById.mockResolvedValueOnce({ wmkf_potentialreviewersid: PERSON, statecode: 1, wmkf_issyntheticreviewer: false });
  people.getById.mockResolvedValue({ wmkf_potentialreviewersid: PERSON, statecode: 1, wmkf_issyntheticreviewer: true });
  const body = await ingestApplicantReviewers({ requestId: REQUEST });
  expect(people.getById).toHaveBeenCalledTimes(2);
  expect(body.recommendedFailed).toHaveLength(1);
  expect(body.recommended).toEqual([]);
  expect(DynamicsService.createRecord).not.toHaveBeenCalled();
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
});

test.each(['off', undefined, 'invalid'])('reviewer isolation %s refuses even an inactive ordinary applicant slot before reading the person', async (value) => {
  if (value === undefined) delete process.env.SYNTHETIC_REVIEWER_ISOLATION;
  else process.env.SYNTHETIC_REVIEWER_ISOLATION = value;
  const body = await ingestApplicantReviewers({ requestId: REQUEST });
  expect(body.recommendedComplete).toBe(false);
  expect(body.recommendedFailed).toHaveLength(1);
  expect(people.getById).not.toHaveBeenCalled();
  expect(DynamicsService.createRecord).not.toHaveBeenCalled();
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
});
