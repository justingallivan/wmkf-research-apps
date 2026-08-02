/** @jest-environment node */

import fs from 'fs';

const findCandidateBySuggestion = jest.fn();
const startStageRefresh = jest.fn();
const completeStageRefresh = jest.fn();
const failStageRefresh = jest.fn();
const recoverExpiredStageRefresh = jest.fn();
const findById = jest.fn();
const hasApplicantProvenance = jest.fn();
const getById = jest.fn();
const buildApplicantAnchorRefreshReceipt = jest.fn();
const enrichRecommended = jest.fn();

jest.mock('../../lib/services/reviewer-roster-store', () => ({
  findCandidateBySuggestion: (...args) => findCandidateBySuggestion(...args),
  startStageRefresh: (...args) => startStageRefresh(...args),
  completeStageRefresh: (...args) => completeStageRefresh(...args),
  failStageRefresh: (...args) => failStageRefresh(...args),
  recoverExpiredStageRefresh: (...args) => recoverExpiredStageRefresh(...args),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...args) => findById(...args),
  hasApplicantProvenance: (...args) => hasApplicantProvenance(...args),
}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...args) => getById(...args),
}));
jest.mock('../../lib/services/workbench/reviewer-warm-validation-service', () => ({
  REQUEST_SELECT: 'akoya_requestid,_wmkf_potentialreviewer1_value',
  buildApplicantAnchorRefreshReceipt: (...args) => buildApplicantAnchorRefreshReceipt(...args),
}));
// The target service must not import or call the legacy full-batch repair path.
jest.mock('../../lib/services/workbench/enrich-recommended-service', () => ({
  enrichRecommended: (...args) => enrichRecommended(...args),
}));

import {
  EXECUTABLE_REVIEWER_REFRESH_STAGES,
  refreshReviewerCandidateStage,
} from '../../lib/services/workbench/reviewer-stage-refresh-service';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const SUGGESTION_ID = '22222222-2222-2222-2222-222222222222';
const PERSON_ID = '33333333-3333-3333-3333-333333333333';
const CANDIDATE_KEY = `suggestion:${SUGGESTION_ID}`;
const UPDATED_AT = '2026-08-02 12:00:00+00';
const STARTED_UPDATED_AT = '2026-08-02 12:00:01+00';

function target(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    stage: 'applicant_anchor',
    expectedUpdatedAt: UPDATED_AT,
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    candidateKey: CANDIDATE_KEY,
    suggestionId: SUGGESTION_ID,
    potentialReviewerId: PERSON_ID,
    rosterStatus: 'active',
    isApplicantRecommended: true,
    name: 'Server-only display value',
    ...overrides,
  };
}

function suggestion(overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: PERSON_ID,
    wmkf_sources: 'applicant',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  findCandidateBySuggestion.mockResolvedValue(candidate());
  findById.mockResolvedValue(suggestion());
  hasApplicantProvenance.mockReturnValue(true);
  startStageRefresh.mockResolvedValue({ outcome: 'recorded', updatedAt: STARTED_UPDATED_AT });
  completeStageRefresh.mockResolvedValue({ outcome: 'recorded' });
  failStageRefresh.mockResolvedValue({ outcome: 'failed_retryable' });
  recoverExpiredStageRefresh.mockResolvedValue({ outcome: 'failed_retryable', updatedAt: '2026-08-02 12:00:00.500+00' });
  getById.mockResolvedValue({ akoya_requestid: REQUEST_ID });
  buildApplicantAnchorRefreshReceipt.mockReturnValue({
    state: 'current',
    contractVersion: 1,
    sourceVersion: 'applicant-slot-version',
    completedAt: '2026-08-02T12:00:02.000Z',
  });
});

test('refreshes exactly one canonical applicant anchor and never calls batch enrichment', async () => {
  const result = await refreshReviewerCandidateStage(target());

  expect(EXECUTABLE_REVIEWER_REFRESH_STAGES).toEqual(['applicant_anchor']);
  expect(result).toEqual({
    outcome: 'recorded',
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    candidateKey: CANDIDATE_KEY,
    stage: 'applicant_anchor',
  });
  expect(findCandidateBySuggestion).toHaveBeenCalledWith(REQUEST_ID, SUGGESTION_ID);
  expect(findById).toHaveBeenCalledWith(SUGGESTION_ID);
  expect(startStageRefresh).toHaveBeenCalledWith(
    REQUEST_ID,
    CANDIDATE_KEY,
    UPDATED_AT,
    'applicant_anchor',
    expect.objectContaining({ reason: 'manual_refresh', attemptId: expect.any(String) }),
  );
  expect(completeStageRefresh).toHaveBeenCalledWith(
    REQUEST_ID,
    CANDIDATE_KEY,
    STARTED_UPDATED_AT,
    'applicant_anchor',
    expect.any(String),
    expect.objectContaining({ state: 'current', contractVersion: 1 }),
  );
  expect(enrichRecommended).not.toHaveBeenCalled();
  const source = fs.readFileSync(require.resolve('../../lib/services/workbench/reviewer-stage-refresh-service'), 'utf8');
  expect(source).not.toMatch(/from ['"][^'"]*enrich-recommended-service/);
  expect(source).not.toMatch(/findApplicantRecommendedByRequest/);
});

test('rejects unknown stages and a name-only identity before any roster or Dataverse read', async () => {
  await expect(refreshReviewerCandidateStage(target({ stage: 'contact' }))).resolves.toMatchObject({
    outcome: 'rejected',
    code: 'stage_not_executable',
  });
  await expect(refreshReviewerCandidateStage({
    requestId: REQUEST_ID,
    name: 'Same Name, Different Person',
    stage: 'applicant_anchor',
    expectedUpdatedAt: UPDATED_AT,
  })).resolves.toMatchObject({
    outcome: 'rejected',
    code: 'invalid_refresh_target',
  });
  expect(findCandidateBySuggestion).not.toHaveBeenCalled();
  expect(findById).not.toHaveBeenCalled();
  expect(enrichRecommended).not.toHaveBeenCalled();
});

test('rejects a suggestion from a different request without starting a stage write', async () => {
  findById.mockResolvedValueOnce(suggestion({ _wmkf_request_value: '44444444-4444-4444-4444-444444444444' }));

  await expect(refreshReviewerCandidateStage(target())).resolves.toMatchObject({
    outcome: 'rejected',
    code: 'suggestion_anchor_mismatch',
  });
  expect(startStageRefresh).not.toHaveBeenCalled();
  expect(enrichRecommended).not.toHaveBeenCalled();
});

test('returns skipped_stale when the initial candidate-key CAS loses', async () => {
  startStageRefresh.mockResolvedValueOnce({ outcome: 'skipped_stale' });

  await expect(refreshReviewerCandidateStage(target())).resolves.toMatchObject({ outcome: 'skipped_stale' });
  expect(completeStageRefresh).not.toHaveBeenCalled();
  expect(failStageRefresh).not.toHaveBeenCalled();
  expect(enrichRecommended).not.toHaveBeenCalled();
});

test('records a retryable stage failure after the lease starts without replacing prior evidence', async () => {
  getById.mockRejectedValueOnce(new Error('Dataverse request read timed out'));

  await expect(refreshReviewerCandidateStage(target())).resolves.toMatchObject({ outcome: 'failed_retryable' });
  expect(failStageRefresh).toHaveBeenCalledWith(
    REQUEST_ID,
    CANDIDATE_KEY,
    STARTED_UPDATED_AT,
    'applicant_anchor',
    expect.any(String),
    { terminal: false, errorCode: 'retryable_failure' },
  );
  expect(completeStageRefresh).not.toHaveBeenCalled();
  expect(enrichRecommended).not.toHaveBeenCalled();
});

test('records a terminal stage outcome when the server can no longer resolve the request inputs', async () => {
  getById.mockResolvedValueOnce(null);
  failStageRefresh.mockResolvedValueOnce({ outcome: 'failed_terminal' });

  await expect(refreshReviewerCandidateStage(target())).resolves.toMatchObject({ outcome: 'failed_terminal' });
  expect(failStageRefresh).toHaveBeenCalledWith(
    REQUEST_ID,
    CANDIDATE_KEY,
    STARTED_UPDATED_AT,
    'applicant_anchor',
    expect.any(String),
    { terminal: true, errorCode: 'terminal_failure' },
  );
  expect(enrichRecommended).not.toHaveBeenCalled();
});

test('recovers only an expired matching lease before starting a replacement attempt', async () => {
  findCandidateBySuggestion.mockResolvedValueOnce(candidate({
    stageFreshness: {
      applicant_anchor: {
        state: 'refreshing',
        refreshAttemptId: 'prior-attempt',
        refreshStartedAt: '2025-08-02T11:00:00.000Z',
      },
    },
  }));

  await expect(refreshReviewerCandidateStage(target())).resolves.toMatchObject({ outcome: 'recorded' });
  expect(recoverExpiredStageRefresh).toHaveBeenCalledWith(
    REQUEST_ID,
    CANDIDATE_KEY,
    UPDATED_AT,
    'applicant_anchor',
    'prior-attempt',
    expect.objectContaining({ leaseMs: expect.any(Number) }),
  );
  expect(startStageRefresh).toHaveBeenCalledWith(
    REQUEST_ID,
    CANDIDATE_KEY,
    '2026-08-02 12:00:00.500+00',
    'applicant_anchor',
    expect.any(Object),
  );
});
