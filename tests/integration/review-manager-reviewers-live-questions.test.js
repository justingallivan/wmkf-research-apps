/**
 * GET /api/review-manager/reviewers — `liveQuestions` (workbench Reviews tab
 * Phase 2, docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md).
 *
 * Verifies the route projects `getActiveQuestionSet()` into the minimal
 * `{key, order, text, type}` shape the matrix derivation module consumes, and
 * fails SOFT (liveQuestions: null, logged, no 500) when the fetcher throws —
 * `getActiveQuestionSet()` itself fails closed for the reviewer-facing form,
 * but a workbench read of past submissions must not 500 on that basis.
 */

import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import * as suggestionAdapter from '../../lib/dataverse/adapters/reviewer-suggestion';
import { getActiveQuestionSet } from '../../lib/external/review-question-fetcher';

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
jest.mock('../../lib/external/review-question-fetcher', () => ({
  getActiveQuestionSet: jest.fn(),
}));

const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';
const SUGGESTION_ID = '11111111-1111-1111-1111-111111111111';
const PERSON_ID = '22222222-2222-2222-2222-222222222222';

let handler;
beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/reviewers')).default;
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  requireAppAccess.mockResolvedValue({ session: { user: { azureEmail: 'pd@example.com' } } });
  DynamicsService.getRecord.mockResolvedValue({
    akoya_requestid: REQUEST_ID, akoya_requestnum: '1002788', akoya_title: 'Test', wmkf_meetingdate: null,
  });
  suggestionAdapter.findByRequest.mockResolvedValue([{
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: PERSON_ID,
    wmkf_accepted: true,
    wmkf_reviewstatus: 100000003, // review_received
    wmkf_reviewreceivedat: '2026-06-28T12:00:00Z',
  }]);
  DynamicsService.queryRecords.mockResolvedValue({
    records: [{ wmkf_potentialreviewersid: PERSON_ID, wmkf_name: 'Dr. X', wmkf_emailaddress: 'x@e.com' }],
  });
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [] });
});

afterEach(() => {
  console.error.mockRestore();
});

function get(query) {
  const req = createMockReq({ method: 'GET', query });
  const res = createMockRes();
  return { req, res };
}

test('returns the live question set projected into {key, order, text, type}', async () => {
  getActiveQuestionSet.mockResolvedValue([
    { key: 'impact', order: 1, label: 'Impact?', type: 'picklist', required: true, options: [{ value: 1, label: 'Low' }] },
    { key: 'comments', order: 2, label: 'Comments?', type: 'richtext', required: false },
  ]);

  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(res._data.liveQuestions).toEqual([
    { key: 'impact', order: 1, text: 'Impact?', type: 'picklist' },
    { key: 'comments', order: 2, text: 'Comments?', type: 'richtext' },
  ]);
});

test('fails soft to liveQuestions: null (not a 500) when the fetcher throws', async () => {
  getActiveQuestionSet.mockRejectedValue(new Error('Dataverse unreachable'));

  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(res._data.liveQuestions).toBeNull();
  expect(res._data.success).toBe(true);
  // Failure is logged, not swallowed silently.
  expect(console.error).toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// GET full response-envelope pin (route-consolidation Stage 2 Phase A). None
// of the other review-manager-reviewers test files assert the full proposal +
// reviewer shape together in one place — each targets a single slice (answers,
// outstanding fields, synthesis, liveQuestions). This test pins every key the
// route emits for one fully-populated reviewer, using the same
// DynamicsService.queryRecords-serves-both-calls mocking pattern the other
// tests in this suite already rely on (fetchPotentialReviewers and
// fetchResearchersByPerson both read via queryReviewers → queryRecords).
// ---------------------------------------------------------------------------
test('GET success returns the full proposal + reviewer envelope', async () => {
  DynamicsService.getRecord.mockResolvedValue({
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002788',
    akoya_title: 'Full Envelope Test Request',
    wmkf_abstract: 'An abstract.',
    wmkf_meetingdate: null,
    wmkf_reviewduedate: '2026-09-09',
    wmkf_organizationname: 'Test University',
    _akoya_applicantid_value_formatted: 'Applicant Name',
    _wmkf_projectleader_value_formatted: 'PI Name',
    _wmkf_grantprogram_value_formatted: 'Program A',
    _wmkf_programareaserved_value_formatted: 'Area A',
    wmkf_reviewsynthesisjson: null,
  });
  suggestionAdapter.findByRequest.mockResolvedValue([{
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: PERSON_ID,
    wmkf_accepted: true,
    wmkf_reviewstatus: 100000003, // review_received
    wmkf_responsetype: 100000000,
    wmkf_notes: 'A note',
    wmkf_materialssentat: '2026-06-20T00:00:00Z',
    wmkf_remindersentat: '2026-06-22T00:00:00Z',
    wmkf_remindercount: 1,
    wmkf_reviewreceivedat: '2026-06-28T12:00:00Z',
    wmkf_reviewfilename: 'review.pdf',
    wmkf_thankyousentat: '2026-06-29T00:00:00Z',
    wmkf_externaltokenhash: 'hash-1',
    wmkf_externaltokenissued: '2026-06-15T00:00:00Z',
    wmkf_externaltokenexpires: '2099-01-01T00:00:00Z',
    wmkf_externaltokenrevoked: false,
    wmkf_proposalfirstaccessed: '2026-06-16T00:00:00Z',
    wmkf_reviewsharepointfolder: 'https://sharepoint/example',
    wmkf_reviewuploadedbystaff: true,
    wmkf_revieweraffiliation: 'Reviewer University',
  }]);
  DynamicsService.queryRecords.mockResolvedValue({
    records: [{
      wmkf_potentialreviewersid: PERSON_ID,
      wmkf_name: 'Dr. Full',
      wmkf_emailaddress: 'full@example.com',
      wmkf_organizationname: 'Fallback Org',
      wmkf_primaryaffiliation: 'Primary Affiliation Univ',
      wmkf_website: 'https://reviewer.example',
      wmkf_hindex: 12,
      wmkf_totalcitations: 345,
    }],
  });
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [] }); // no submitted answers snapshotted
  getActiveQuestionSet.mockResolvedValue([
    { key: 'impact', order: 1, label: 'Impact?', type: 'picklist' },
  ]);

  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(res._data).toEqual({
    success: true,
    totalReviewers: 1,
    liveQuestions: [{ key: 'impact', order: 1, text: 'Impact?', type: 'picklist' }],
    proposals: [{
      proposalId: REQUEST_ID,
      proposalTitle: 'Full Envelope Test Request',
      proposalAbstract: 'An abstract.',
      proposalAuthors: 'PI Name',
      proposalInstitution: 'Test University',
      requestNumber: '1002788',
      programArea: 'Area A',
      grantCycleCode: null,
      cycleLabel: null,
      meetingDate: null,
      reviewDeadline: '2026-09-09',
      reviewSynthesis: null,
      statusSummary: { review_received: 1 },
      reviewers: [{
        suggestionId: SUGGESTION_ID,
        potentialReviewerId: PERSON_ID,
        name: 'Dr. Full',
        affiliation: 'Primary Affiliation Univ',
        email: 'full@example.com',
        website: 'https://reviewer.example',
        hIndex: 12,
        totalCitations: 345,
        notes: 'A note',
        reviewStatus: 'review_received',
        responseType: undefined, // RESPONSE_TYPE_BY_VALUE is mocked to {} in this suite
        materialsSentAt: '2026-06-20T00:00:00Z',
        daysSinceMaterialsSent: expect.any(Number),
        reminderSentAt: '2026-06-22T00:00:00Z',
        reminderCount: 1,
        reviewReceivedAt: '2026-06-28T12:00:00Z',
        submitted: true,
        reviewFilename: 'review.pdf',
        thankyouSentAt: '2026-06-29T00:00:00Z',
        tokenIssuedAt: '2026-06-15T00:00:00Z',
        tokenExpiresAt: '2099-01-01T00:00:00Z',
        tokenRevoked: false,
        tokenState: 'active',
        proposalFirstAccessedAt: '2026-06-16T00:00:00Z',
        reviewSharePointFolder: 'https://sharepoint/example',
        reviewUploadedByStaff: true,
        reviewerAffiliation: 'Reviewer University',
        reviewerRiskLevel: null,
        reviewerOverallAssessment: null,
        answers: [],
      }],
    }],
  });
});

// ---------------------------------------------------------------------------
// GET domain error (500) — not previously covered by any of the other
// review-manager-reviewers test files, which only exercise 200 paths.
// ---------------------------------------------------------------------------
test('GET 500s with the failure envelope when a downstream adapter call throws', async () => {
  suggestionAdapter.findByRequest.mockRejectedValue(new Error('Dataverse unavailable'));

  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);

  expect(res.statusCode).toBe(500);
  expect(res._data.error).toBe('Failed to fetch reviewers');
  expect(typeof res._data.timestamp).toBe('string');
  // NODE_ENV is 'test' under jest, not 'development' — details is stripped.
  expect(res._data.details).toBeUndefined();
  expect(console.error).toHaveBeenCalled();
});
