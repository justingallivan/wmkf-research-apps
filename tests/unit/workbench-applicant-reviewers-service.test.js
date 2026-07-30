/**
 * @jest-environment node
 *
 * lib/services/workbench/applicant-reviewers-service — logic-level tests
 * (adapters mocked), Stage 4 series A extraction. Pins the branches the
 * route-level characterization can't reach cheaply: slot dedupe, per-slot
 * partial failure (recommendedFailed/recommendedComplete), extraction
 * failure isolation, and the 404 typed error.
 */

const getById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  getById: (...a) => getById(...a),
}));

const ensureApplicantRecommended = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  ensureApplicantRecommended: (...a) => ensureApplicantRecommended(...a),
}));

const extractExcludedReviewers = jest.fn();
jest.mock('../../lib/services/reviewer-exclusion-parser', () => ({
  extractExcludedReviewers: (...a) => extractExcludedReviewers(...a),
}));

const loadApplicantKnownReviewer = jest.fn();
jest.mock('../../lib/services/workbench/applicant-known-reviewer-service', () => ({
  loadApplicantKnownReviewer: (...a) => loadApplicantKnownReviewer(...a),
}));

const loadModelOverrides = jest.fn(async () => {});
jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: (...a) => loadModelOverrides(...a),
}));

import { ingestApplicantReviewers } from '../../lib/services/workbench/applicant-reviewers-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

const REQ = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const P1 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const P2 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const baseRequest = (over = {}) => ({
  akoya_requestid: REQ,
  akoya_requestnum: '1002788',
  akoya_title: 'Engineered gene circuits',
  wmkf_meetingdate: null,
  wmkf_excludedreviewers: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  getById.mockResolvedValue(baseRequest());
  ensureApplicantRecommended.mockResolvedValue({ id: 'sug-1', created: true, skippedExcluded: false });
  extractExcludedReviewers.mockResolvedValue({ names: [], substantive: false, parseFailed: false });
  loadApplicantKnownReviewer.mockImplementation(async (personId) => ({
    status: 'known',
    code: null,
    potentialReviewerId: personId,
    name: 'Known Reviewer',
    email: 'known@example.edu',
    emailSource: null,
    emailReadiness: { action: 'quick_check', level: 'low', reason: 'Check' },
  }));
});

const args = { requestId: REQ, actingUserSystemId: 'u-1', userProfileId: 7 };

test('unresolvable request → ServiceHttpError 404 with the historical message', async () => {
  getById.mockRejectedValue(new Error('not found'));
  await expect(ingestApplicantReviewers(args)).rejects.toMatchObject({
    httpStatus: 404,
    message: `No request found for ${REQ}`,
  });
  await expect(ingestApplicantReviewers(args)).rejects.toBeInstanceOf(ServiceHttpError);
});

test('does NOT warm model overrides itself — warming is the shell\'s job (check:model-override-warming contract; the endpoint test pins the once-only route-level call)', async () => {
  getById.mockResolvedValue(baseRequest({ wmkf_excludedreviewers: 'Mya Breitbart' }));
  extractExcludedReviewers.mockResolvedValue({ names: [{ name: 'Mya Breitbart', affiliation: null }], substantive: true, parseFailed: false });
  await ingestApplicantReviewers(args);
  expect(loadModelOverrides).not.toHaveBeenCalled();
});

test('dedupes the same person across slots (single response entry, slotsPopulated counts distinct)', async () => {
  getById.mockResolvedValue(baseRequest({
    _wmkf_potentialreviewer1_value: P1,
    _wmkf_potentialreviewer1_value_formatted: 'Dr. One',
    _wmkf_potentialreviewer2_value: P1, // duplicate person
    _wmkf_potentialreviewer3_value: '00000000-0000-0000-0000-000000000000', // zero GUID skipped
    _wmkf_potentialreviewer4_value: P2,
    _wmkf_potentialreviewer4_value_formatted: 'Dr. Two',
  }));
  const body = await ingestApplicantReviewers(args);
  expect(ensureApplicantRecommended).toHaveBeenCalledTimes(2);
  expect(body.recommended.map((r) => r.slot)).toEqual([1, 4]);
  expect(body.slotsPopulated).toBe(2);
  expect(body.recommendedCreated).toBe(2);
  expect(body.recommendedComplete).toBe(true);
  expect(body.knownLookupComplete).toBe(true);
});

test('per-slot failure is partial: failed slot lands in recommendedFailed/errors, others still materialize', async () => {
  getById.mockResolvedValue(baseRequest({
    _wmkf_potentialreviewer1_value: P1,
    _wmkf_potentialreviewer1_value_formatted: 'Dr. One',
    _wmkf_potentialreviewer2_value: P2,
    _wmkf_potentialreviewer2_value_formatted: 'Dr. Two',
  }));
  ensureApplicantRecommended
    .mockRejectedValueOnce(new Error('junction write failed'))
    .mockResolvedValueOnce({ id: 'sug-2', created: true, skippedExcluded: false });
  const body = await ingestApplicantReviewers(args);
  expect(body.recommended).toHaveLength(1);
  expect(body.recommended[0].potentialReviewerId).toBe(P2);
  expect(body.recommendedFailed).toEqual([
    { slot: 1, potentialReviewerId: P1, name: 'Dr. One', error: 'junction write failed' },
  ]);
  expect(body.recommendedComplete).toBe(false);
  expect(body.slotsPopulated).toBe(2);
  expect(body.errors).toHaveLength(1);
});

test('exact-person hydration failure does not recast a successful materialization as failed', async () => {
  getById.mockResolvedValue(baseRequest({
    _wmkf_potentialreviewer1_value: P1,
    _wmkf_potentialreviewer1_value_formatted: 'Dr. One',
  }));
  loadApplicantKnownReviewer.mockResolvedValue({
    status: 'unavailable',
    code: 'person_unavailable',
    potentialReviewerId: P1,
  });
  const body = await ingestApplicantReviewers(args);
  expect(body.recommended).toHaveLength(1);
  expect(body.recommendedComplete).toBe(true);
  expect(body.recommendedFailed).toBeUndefined();
  expect(body.knownLookupComplete).toBe(false);
  expect(body.knownLookupFailed).toEqual([{
    slot: 1,
    potentialReviewerId: P1,
    suggestionId: 'sug-1',
    code: 'person_unavailable',
  }]);
});

test('extraction failure never blocks recommended ingestion (excludedParseFailed + stage error)', async () => {
  getById.mockResolvedValue(baseRequest({
    _wmkf_potentialreviewer1_value: P1,
    wmkf_excludedreviewers: 'some text',
  }));
  extractExcludedReviewers.mockRejectedValue(new Error('llm down'));
  const body = await ingestApplicantReviewers(args);
  expect(body.recommended).toHaveLength(1);
  expect(body.excludedParseFailed).toBe(true);
  expect(body.excluded).toEqual([]);
  expect(body.excludedRaw).toBe('some text');
  expect(body.errors).toEqual([{ stage: 'excluded-extraction', error: 'llm down' }]);
});

test('passes acting user + request-derived label/cycle/programArea to the adapter', async () => {
  getById.mockResolvedValue(baseRequest({
    wmkf_meetingdate: '2026-06-01',
    _wmkf_programareaserved_value_formatted: 'Science',
    _wmkf_potentialreviewer1_value: P1,
    _wmkf_potentialreviewer1_value_formatted: 'Dr. One',
  }));
  await ingestApplicantReviewers(args);
  expect(ensureApplicantRecommended).toHaveBeenCalledWith({
    potentialReviewerId: P1,
    requestId: REQ,
    suggestionLabel: 'Engineered gene circuits — Dr. One',
    grantCycleCode: 'J26',
    programArea: 'Science',
    matchReason: 'Recommended by applicant (legacy reviewer slot).',
  }, { actingUserSystemId: 'u-1' });
});
