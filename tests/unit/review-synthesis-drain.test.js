/**
 * @jest-environment node
 */

const findReviewSynthesisParticipants = jest.fn();
const findByRequest = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findReviewSynthesisParticipants: (...args) => findReviewSynthesisParticipants(...args),
  findByRequest: (...args) => findByRequest(...args),
}));

const loadReviewSynthesisContext = jest.fn();
const synthesizeReviews = jest.fn();
jest.mock('../../lib/services/review-manager/synthesize-reviews-service', () => ({
  loadReviewSynthesisContext: (...args) => loadReviewSynthesisContext(...args),
  synthesizeReviews: (...args) => synthesizeReviews(...args),
}));

const enqueueAutomaticReviewSynthesisJob = jest.fn();
const claimAutomaticReviewSynthesisJobs = jest.fn();
const cancelReviewSynthesisJob = jest.fn();
const recordReviewSynthesisJobFailure = jest.fn();
jest.mock('../../lib/services/review-synthesis-job-service', () => ({
  enqueueAutomaticReviewSynthesisJob: (...args) => enqueueAutomaticReviewSynthesisJob(...args),
  claimAutomaticReviewSynthesisJobs: (...args) => claimAutomaticReviewSynthesisJobs(...args),
  cancelReviewSynthesisJob: (...args) => cancelReviewSynthesisJob(...args),
  recordReviewSynthesisJobFailure: (...args) => recordReviewSynthesisJobFailure(...args),
}));

const { drainReviewSynthesisJobs } = require('../../lib/services/review-synthesis-drain');

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const INPUT_HASH = 'a'.repeat(64);

function submittedRow(overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: '22222222-2222-4222-8222-222222222222',
    _wmkf_request_value: REQUEST_ID,
    wmkf_selected: true,
    wmkf_invited: true,
    wmkf_accepted: true,
    wmkf_reviewreceivedat: '2026-07-28T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  findReviewSynthesisParticipants.mockResolvedValue({
    records: [submittedRow()],
    capped: false,
  });
  loadReviewSynthesisContext.mockResolvedValue({
    readiness: { ready: true, inputHash: INPUT_HASH },
  });
  enqueueAutomaticReviewSynthesisJob.mockResolvedValue({ id: 1, status: 'queued' });
  claimAutomaticReviewSynthesisJobs.mockResolvedValue([]);
  cancelReviewSynthesisJob.mockResolvedValue({ status: 'cancelled' });
  recordReviewSynthesisJobFailure.mockResolvedValue({ status: 'queued' });
  synthesizeReviews.mockResolvedValue({ ok: true });
});

test('enqueues one automatic job for a newly-ready request fingerprint', async () => {
  const result = await drainReviewSynthesisJobs();
  expect(result).toMatchObject({
    scannedRequests: 1,
    eligible: 1,
    enqueued: 1,
    claimed: 0,
  });
  expect(enqueueAutomaticReviewSynthesisJob).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    inputHash: INPUT_HASH,
  });
});

test('fails closed rather than scanning a truncated participant population', async () => {
  findReviewSynthesisParticipants.mockResolvedValueOnce({ records: [], capped: true });
  await expect(drainReviewSynthesisJobs()).rejects.toThrow(/5000-row cap/);
  expect(enqueueAutomaticReviewSynthesisJob).not.toHaveBeenCalled();
});

test('cancels a claimed job when its current fingerprint changed', async () => {
  claimAutomaticReviewSynthesisJobs.mockResolvedValueOnce([{
    id: 2,
    request_id: REQUEST_ID,
    input_hash: 'b'.repeat(64),
    lease_token: '33333333-3333-4333-8333-333333333333',
  }]);
  const result = await drainReviewSynthesisJobs();
  expect(result.cancelled).toBe(1);
  expect(cancelReviewSynthesisJob).toHaveBeenCalledWith(
    expect.objectContaining({ id: 2 }),
    'input_fingerprint_changed_before_generation',
  );
  expect(synthesizeReviews).not.toHaveBeenCalled();
});

test('revalidates and runs a matching claimed job through automatic mode', async () => {
  const job = {
    id: 3,
    request_id: REQUEST_ID,
    input_hash: INPUT_HASH,
    lease_token: '33333333-3333-4333-8333-333333333333',
  };
  claimAutomaticReviewSynthesisJobs.mockResolvedValueOnce([job]);
  const result = await drainReviewSynthesisJobs();
  expect(result.completed).toBe(1);
  expect(synthesizeReviews).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    overwrite: true,
    actingUserSystemId: null,
    mode: 'automatic',
    job,
  });
});
