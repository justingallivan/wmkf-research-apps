/** @jest-environment node */

const requireAppAccess = jest.fn();
const withDalContext = jest.fn(async (_label, operation) => operation());
const refreshReviewerCandidateStage = jest.fn();

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: (...args) => requireAppAccess(...args),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: (...args) => withDalContext(...args),
}));
jest.mock('../../lib/services/workbench/reviewer-stage-refresh-service', () => ({
  EXECUTABLE_REVIEWER_REFRESH_STAGES: ['applicant_anchor'],
  refreshReviewerCandidateStage: (...args) => refreshReviewerCandidateStage(...args),
}));

import handler, { parseRefreshRequest } from '../../pages/api/workbench/reviewer-stage-refresh';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const SUGGESTION_ID = '22222222-2222-2222-2222-222222222222';
const CANDIDATE_KEY = `suggestion:${SUGGESTION_ID}`;

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(statusCode) { this.statusCode = statusCode; return this; },
    json(body) { this.body = body; return this; },
  };
}

function body(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    candidateKey: CANDIDATE_KEY,
    stage: 'applicant_anchor',
    expectedUpdatedAt: '2026-08-02 12:00:00+00',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 5 });
  refreshReviewerCandidateStage.mockResolvedValue({
    outcome: 'recorded',
    requestId: REQUEST_ID,
    candidateKey: CANDIDATE_KEY,
    stage: 'applicant_anchor',
  });
});

test('requires the reviewer-finder + reviewers app grants before the refresh service', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const res = response();

  await handler({ method: 'POST', body: body() }, res);

  expect(refreshReviewerCandidateStage).not.toHaveBeenCalled();
  expect(requireAppAccess).toHaveBeenCalledWith(expect.any(Object), res, 'reviewer-finder', 'reviewers');
});

test('rejects a name-only request, client evidence, and an unknown stage before the service', async () => {
  for (const invalid of [
    { requestId: REQUEST_ID, name: 'Same Name, Different Person', stage: 'applicant_anchor', expectedUpdatedAt: 'v1' },
    body({ receipt: { state: 'current' } }),
    body({ dependencies: { applicantInputVersion: 'claimed' } }),
    body({ stage: 'coauthor_coi' }),
    body({ stage: 'address_trust' }),
    body({ stage: 'address_trust' }),
    body({ candidateKey: 'not-a-canonical-key' }),
    body({ candidateKey: 'client:browser-supplied' }),
    body({ candidateKey: 'candidate:legacy-generic' }),
  ]) {
    const res = response();
    await handler({ method: 'POST', body: invalid }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false, outcome: 'rejected' });
  }
  expect(refreshReviewerCandidateStage).not.toHaveBeenCalled();
  expect(withDalContext).not.toHaveBeenCalled();
});

test('rejects address trust at the generic route in favor of its dedicated action', () => {
  expect(parseRefreshRequest(body({ stage: 'address_trust' }))).toMatchObject({
    valid: false,
    code: 'dedicated_address_action',
  });
});

test('runs the sole executable stage inside the trusted DAL context and returns its full outcome', async () => {
  expect(parseRefreshRequest(body())).toMatchObject({ valid: true });
  const res = response();

  await handler({ method: 'POST', body: body() }, res);

  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({
    outcome: 'recorded',
    requestId: REQUEST_ID,
    candidateKey: CANDIDATE_KEY,
    stage: 'applicant_anchor',
  });
  expect(withDalContext).toHaveBeenCalledWith('workbench-reviewer-stage-refresh', expect.any(Function));
  expect(refreshReviewerCandidateStage).toHaveBeenCalledWith(body());
});

test('maps a lost CAS to a stale conflict without inventing success', async () => {
  refreshReviewerCandidateStage.mockResolvedValueOnce({
    outcome: 'skipped_stale',
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    candidateKey: CANDIDATE_KEY,
    stage: 'applicant_anchor',
  });
  const res = response();

  await handler({ method: 'POST', body: body() }, res);

  expect(res.statusCode).toBe(409);
  expect(res.body).toMatchObject({ outcome: 'skipped_stale' });
});

test('maps another stage\'s expired lease to a named recovery conflict', async () => {
  refreshReviewerCandidateStage.mockResolvedValueOnce({
    outcome: 'lease_recovery_required',
    code: 'lease_recovery_required',
    requestId: REQUEST_ID,
    candidateKey: CANDIDATE_KEY,
    stage: 'applicant_anchor',
    leaseStage: 'contact',
  });
  const res = response();

  await handler({ method: 'POST', body: body() }, res);

  expect(res.statusCode).toBe(409);
  expect(res.body).toMatchObject({
    outcome: 'lease_recovery_required',
    leaseStage: 'contact',
  });
});

test('maps malformed lease repair-required to a non-mutating conflict', async () => {
  refreshReviewerCandidateStage.mockResolvedValueOnce({
    outcome: 'lease_repair_required',
    code: 'lease_repair_required',
    requestId: REQUEST_ID,
    candidateKey: CANDIDATE_KEY,
    stage: 'applicant_anchor',
    leaseStage: 'contact',
  });
  const res = response();

  await handler({ method: 'POST', body: body() }, res);

  expect(res.statusCode).toBe(409);
  expect(res.body).toMatchObject({
    outcome: 'lease_repair_required',
    leaseStage: 'contact',
  });
});
