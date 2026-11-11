/** @jest-environment node */

import handler from '../../pages/api/workbench/staff-review-summary';
import { getById, updateById } from '../../lib/dataverse/adapters/grant-request';
import { requireAppAccess } from '../../lib/utils/auth';
import { getReviewers } from '../../lib/services/review-manager/reviewers-service';

jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: jest.fn(), updateById: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/operations-grant-cycle', () => ({
  linkedCycleCode: row => row?.cycleCode,
  linkedCycleExpand: () => 'cycle',
}));
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: (_name, callback) => callback() }));
jest.mock('../../lib/services/review-manager/reviewers-service', () => ({ getReviewers: jest.fn() }));

const requestId = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const version = 'W/"123"';
const evidenceHash = 'a'.repeat(64);
const body = { requestId, version, evidenceHash, summary: 'Staff interpretation.' };
const row = { akoya_requestid: requestId, cycleCode: 'J27', _etag: version };
const originalEnv = process.env;

function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.resetAllMocks();
  process.env = { ...originalEnv, VERCEL_ENV: 'preview', DYNAMICS_IMPERSONATION_ENABLED: 'true', DYNAMICS_URL: 'https://orgd9e66399.crm.dynamics.com' };
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: actor } } });
  getById.mockResolvedValue(row);
  getReviewers.mockResolvedValue({ proposals: [{ staffReviewEvidenceHash: evidenceHash }] });
});

afterEach(() => { process.env = originalEnv; });

test('Workbench staff can save interpretation and its evidence together without lead ownership', async () => {
  const res = response();
  await handler({ method: 'POST', body: { ...body, actor: 'spoofed' } }, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'reviewers');
  expect(updateById).toHaveBeenCalledWith(requestId, {
    wmkf_staffreviewsummary: body.summary, wmkf_staffreviewevidencehash: evidenceHash,
  }, { ifMatch: version, actingUserSystemId: actor, noFallback: true });
});

test('the shared reader returns the saved memo and its original evidence fingerprint', async () => {
  getById.mockResolvedValue({ ...row, wmkf_staffreviewsummary: body.summary, wmkf_staffreviewevidencehash: evidenceHash });
  const res = response();
  await handler({ method: 'GET', query: { requestId } }, res);
  expect(res.json).toHaveBeenCalledWith({ summary: body.summary, evidenceHash, version });
});

test('production-backed Preview rejects direct saves before any Dataverse access', async () => {
  process.env.DYNAMICS_URL = 'https://wmkf.crm.dynamics.com';
  const res = response();
  await handler({ method: 'POST', body }, res);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(getById).not.toHaveBeenCalled();
  expect(updateById).not.toHaveBeenCalled();
});

test.each([
  ['an earlier cycle', { cycleCode: 'D26' }, 404],
  ['a stale request version', { _etag: 'W/"124"' }, 409],
])('refuses %s without writing', async (_label, override, status) => {
  getById.mockResolvedValue({ ...row, ...override });
  const res = response();
  await handler({ method: 'POST', body }, res);
  expect(res.status).toHaveBeenCalledWith(status);
  expect(updateById).not.toHaveBeenCalled();
});

test('changed reviewer evidence returns a conflict without altering staff text', async () => {
  getReviewers.mockResolvedValue({ proposals: [{ staffReviewEvidenceHash: 'b'.repeat(64) }] });
  const res = response();
  await handler({ method: 'POST', body }, res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(updateById).not.toHaveBeenCalled();
});

test('a row changed during save returns conflict without a retry', async () => {
  updateById.mockRejectedValue({ status: 412 });
  const res = response();
  await handler({ method: 'POST', body }, res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(updateById).toHaveBeenCalledTimes(1);
});

test('saving fails closed if staff attribution is disabled', async () => {
  delete process.env.DYNAMICS_IMPERSONATION_ENABLED;
  const res = response();
  await handler({ method: 'POST', body }, res);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(updateById).not.toHaveBeenCalled();
});

test('the downstream handoff reads current facts and the saved interpretation together', async () => {
  getById.mockResolvedValue({ ...row, wmkf_staffreviewsummary: body.summary, wmkf_staffreviewevidencehash: evidenceHash });
  const currentEvidenceHash = 'b'.repeat(64);
  getReviewers.mockResolvedValue({ proposals: [{
    proposalId: requestId,
    staffReviewEvidenceHash: currentEvidenceHash,
    reviewers: [
      { name: 'Taylor Example', affiliation: 'Field Science Center', reviewReceivedAt: '2026-11-07', reviewerOverallAssessment: 4 },
      { name: 'Robin Example', affiliation: 'Coastal Research Institute', reviewReceivedAt: '2026-11-07', reviewerOverallAssessment: 5 },
      { name: 'Pending Reviewer', affiliation: 'Example University' },
    ],
  }] });
  const res = response();
  await handler({ method: 'GET', query: { requestId, includeReviewerFacts: '1' } }, res);
  expect(res.json).toHaveBeenCalledWith({
    summary: body.summary, evidenceHash, version, currentEvidenceHash,
    reviewerFacts: 'We received two reviews with scores of one Excellent and one Very Good. The reviewers were Robin Example of Coastal Research Institute; and Taylor Example of Field Science Center.',
  });
  expect(updateById).not.toHaveBeenCalled();
});

test('a failed reviewer read still returns the saved staff interpretation', async () => {
  getById.mockResolvedValue({ ...row, wmkf_staffreviewsummary: body.summary });
  getReviewers.mockRejectedValue(new Error('Source unavailable'));
  const res = response();
  await handler({ method: 'GET', query: { requestId, includeReviewerFacts: '1' } }, res);
  expect(res.json).toHaveBeenCalledWith({
    summary: body.summary, evidenceHash: null, version, currentEvidenceHash: null, reviewerFacts: null,
  });
});

// The step belongs to every cycle from J27 on, not to the cycle named J27.
test.each(['D27', 'J28'])('a later cycle (%s) is read like J27', async (cycleCode) => {
  getById.mockResolvedValue({ ...row, cycleCode });
  const res = response();
  await handler({ method: 'GET', query: { requestId } }, res);
  expect(res.status).not.toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalled();
});
