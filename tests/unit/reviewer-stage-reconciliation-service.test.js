/** @jest-environment node */

import fs from 'fs';

const listForRequest = jest.fn();
const createReviewerStageRefreshRequestContext = jest.fn();
const planReviewerCandidateRefresh = jest.fn();
const refreshReviewerCandidateStage = jest.fn();

jest.mock('../../lib/services/reviewer-roster-store', () => ({
  listForRequest: (...args) => listForRequest(...args),
}));
jest.mock('../../lib/services/workbench/reviewer-stage-refresh-service', () => ({
  createReviewerStageRefreshRequestContext: (...args) => createReviewerStageRefreshRequestContext(...args),
  planReviewerCandidateRefresh: (...args) => planReviewerCandidateRefresh(...args),
  refreshReviewerCandidateStage: (...args) => refreshReviewerCandidateStage(...args),
}));

import { reconcileReviewerStages } from '../../lib/services/workbench/reviewer-stage-reconciliation-service';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const CANDIDATE_KEY = 'candidate:alex%20reviewer|email:alex%40example.edu|orcid:-|affiliation:example%20university';
const UPDATED_AT = '2026-08-03 12:00:00+00';

function planned({ cacheOutcome = 'miss', pendingStages = ['applicant_anchor'], refreshes = [{ stage: 'applicant_anchor', action: 'refresh_stage' }] } = {}) {
  return {
    outcome: 'planned',
    candidateKey: CANDIDATE_KEY,
    expectedUpdatedAt: UPDATED_AT,
    plan: { cacheOutcome, promotionAuthority: 'requires_promotion_checks', pendingStages, refreshes },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  createReviewerStageRefreshRequestContext.mockResolvedValue({ requestId: REQUEST_ID });
  listForRequest.mockResolvedValue({ active: [] });
  refreshReviewerCandidateStage.mockResolvedValue({
    outcome: 'recorded', stage: 'applicant_anchor', rosterVersion: UPDATED_AT,
  });
});

test('reconciles a selected durable key through the existing stage primitive, then terminates on a current plan', async () => {
  planReviewerCandidateRefresh
    .mockResolvedValueOnce(planned())
    .mockResolvedValueOnce(planned({ cacheOutcome: 'hit', pendingStages: [], refreshes: [] }));

  const result = await reconcileReviewerStages({ requestId: REQUEST_ID, candidateKeys: [CANDIDATE_KEY] });

  expect(result).toMatchObject({ outcome: 'current', counts: { current: 1 } });
  expect(createReviewerStageRefreshRequestContext).toHaveBeenCalledWith(REQUEST_ID);
  expect(refreshReviewerCandidateStage).toHaveBeenCalledWith(expect.objectContaining({
    requestId: REQUEST_ID,
    candidateKey: CANDIDATE_KEY,
    stage: 'applicant_anchor',
    expectedUpdatedAt: UPDATED_AT,
    reconciliationContext: expect.objectContaining({ requestId: REQUEST_ID }),
    deadlineAt: expect.any(Number),
  }));
  expect(listForRequest).not.toHaveBeenCalled();
});

test('does not report success when every candidate needs the dedicated address action', async () => {
  planReviewerCandidateRefresh.mockResolvedValueOnce(planned({
    pendingStages: ['address_trust'],
    refreshes: [{ stage: 'address_trust', action: 'dedicated_address_action' }],
  }));

  const result = await reconcileReviewerStages({ requestId: REQUEST_ID, candidateKeys: [CANDIDATE_KEY] });

  expect(result).toMatchObject({
    outcome: 'action_required',
    counts: { action_required: 1 },
    continuationCandidateKeys: [CANDIDATE_KEY],
  });
  expect(refreshReviewerCandidateStage).not.toHaveBeenCalled();
});

test('preserves a per-stage retryable failure and never falls through to a later stage', async () => {
  planReviewerCandidateRefresh.mockResolvedValueOnce(planned({
    pendingStages: ['identity', 'contact'],
    refreshes: [
      { stage: 'identity', action: 'refresh_stage' },
      { stage: 'contact', action: 'refresh_stage' },
    ],
  }));
  refreshReviewerCandidateStage.mockResolvedValueOnce({
    outcome: 'failed_retryable', stage: 'identity', code: 'retryable_failure',
  });

  const result = await reconcileReviewerStages({ requestId: REQUEST_ID, candidateKeys: [CANDIDATE_KEY] });

  expect(result).toMatchObject({
    outcome: 'failed_retryable',
    candidates: [expect.objectContaining({
      candidateKey: CANDIDATE_KEY,
      outcome: 'failed_retryable',
      stages: [{ stage: 'identity', outcome: 'failed_retryable', code: 'retryable_failure' }],
    })],
  });
  expect(refreshReviewerCandidateStage).toHaveBeenCalledTimes(1);
});

test('uses only active server-listed candidate keys for an all-request pass and exposes exact continuation keys', async () => {
  const second = 'candidate:bea%20reviewer|email:bea%40example.edu|orcid:-|affiliation:example%20university';
  listForRequest.mockResolvedValue({ active: [{ candidateKey: CANDIDATE_KEY }, { candidateKey: second }] });
  planReviewerCandidateRefresh.mockImplementation(async ({ candidateKey }) => ({
    ...planned({ cacheOutcome: 'hit', pendingStages: [], refreshes: [] }),
    candidateKey,
  }));

  const result = await reconcileReviewerStages({ requestId: REQUEST_ID });

  expect(result).toMatchObject({ outcome: 'current', counts: { current: 2 } });
  expect(listForRequest).toHaveBeenCalledWith(REQUEST_ID);
  expect(planReviewerCandidateRefresh).toHaveBeenCalledWith(expect.objectContaining({ candidateKey: CANDIDATE_KEY }));
  expect(planReviewerCandidateRefresh).toHaveBeenCalledWith(expect.objectContaining({ candidateKey: second }));
});

test('rejects client namespace and malformed candidate keys before request authority work', async () => {
  const result = await reconcileReviewerStages({ requestId: REQUEST_ID, candidateKeys: ['client:browser-forged'] });

  expect(result).toEqual({ outcome: 'rejected', code: 'invalid_candidate_keys', candidates: [] });
  expect(createReviewerStageRefreshRequestContext).not.toHaveBeenCalled();
  expect(refreshReviewerCandidateStage).not.toHaveBeenCalled();
});

test('the coordinator cannot import a cold search, save, invitation, or email path', () => {
  const source = fs.readFileSync(require.resolve('../../lib/services/workbench/reviewer-stage-reconciliation-service'), 'utf8');
  expect(source).not.toMatch(/reviewer-finder\/(?:search|cold-stage-evidence|save-candidates)/);
  expect(source).not.toMatch(/(?:sendEmail|createEmailActivity|generateEmail|finalizeCandidatePromotion|recordSurfaced)/);
});
