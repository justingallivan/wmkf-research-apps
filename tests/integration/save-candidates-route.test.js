/**
 * @jest-environment node
 *
 * Characterization coverage for pages/api/reviewer-finder/save-candidates.js
 * (Stage 3 reviewer-finder wave, docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md).
 * Flagged in the Stage 0 inventory as covered ONLY by
 * tests/unit/reviewer-route-identity-gate.test.js, which pins the identity/COI
 * gating logic with toMatchObject but does not cover auth/method short-circuit
 * or the exact byte-for-byte response envelope. This file fills that gap per
 * the per-wave contract minimum: unauth, wrong-method, happy-path envelope
 * pinned fully, and the two batch-rejection envelopes (422 all-unresolved,
 * 500 all-failed). It pins CURRENT behavior only — no refactor. Clients
 * depend on these exact shapes (plan warning for save-candidates.js).
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({
    profileId: 'P1', session: { user: { dynamicsSystemuserId: 'SYS-1' } },
  })),
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: {} }));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  upsertByEmail: jest.fn(async () => ({ id: 'PID-1' })),
  getById: jest.fn(async () => ({ wmkf_primaryaffiliation: 'MIT' })),
  setContactLink: jest.fn(async () => ({ action: 'link' })),
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  upsertByPotentialReviewer: jest.fn(async () => ({ id: 'PID-1' })),
  writeIdentityDecision: jest.fn(async () => undefined),
  clearIdentityFields: jest.fn(async () => undefined),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  upsert: jest.fn(async () => ({ id: 'S1' })),
}));
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  stampSuggestionAnchor: jest.fn(async () => ({ updated: 1 })),
}));
jest.mock('../../lib/services/reviewer-identity-lookup', () => ({
  lookupReviewerIdentity: jest.fn(async () => ({ outcome: 'none' })),
}));
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: { notify: jest.fn(async () => ({ id: 'alert-1' })) },
}));

const { requireAppAccess } = require('../../lib/utils/auth');
const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const researcherAdapter = require('../../lib/dataverse/adapters/researcher');
const reviewerSuggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  res.setHeader = jest.fn();
  return res;
}

let handler;
beforeAll(() => {
  handler = require('../../pages/api/reviewer-finder/save-candidates').default;
});

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({
    profileId: 'P1', session: { user: { dynamicsSystemuserId: 'SYS-1' } },
  });
  potentialReviewerAdapter.upsertByEmail.mockResolvedValue({ id: 'PID-1' });
  researcherAdapter.upsertByPotentialReviewer.mockResolvedValue({ id: 'PID-1' });
  reviewerSuggestionAdapter.upsert.mockResolvedValue({ id: 'S1' });
});

test('wrong method (GET) → 405', async () => {
  const req = { method: 'GET', body: {} };
  const res = mockRes();
  await handler(req, res);

  expect(res.statusCode).toBe(405);
  expect(res.body).toEqual({ error: 'Method not allowed' });
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
});

test('unauthenticated (requireAppAccess denies) → route returns immediately, no adapter writes', async () => {
  requireAppAccess.mockImplementationOnce(async (req, resp) => {
    resp.status(401).json({ error: 'Authentication required' });
    return null;
  });
  const req = { method: 'POST', body: { requestId: 'REQ-1', candidates: [{ name: 'Dr X' }] } };
  const res = mockRes();
  await handler(req, res);

  expect(res.statusCode).toBe(401);
  expect(res.body).toEqual({ error: 'Authentication required' });
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
});

test('domain error: missing requestId → 400', async () => {
  const req = { method: 'POST', body: { candidates: [{ name: 'Dr X' }] } };
  const res = mockRes();
  await handler(req, res);

  expect(res.statusCode).toBe(400);
  expect(res.body).toEqual({ error: 'requestId is required (Dataverse akoya_request GUID)' });
});

test('domain error: missing/empty candidates array → 400', async () => {
  const req = { method: 'POST', body: { requestId: 'REQ-1', candidates: [] } };
  const res = mockRes();
  await handler(req, res);

  expect(res.statusCode).toBe(400);
  expect(res.body).toEqual({ error: 'candidates array is required' });
});

test('happy-path response envelope is pinned exactly (single resolved candidate)', async () => {
  const req = {
    method: 'POST',
    body: {
      requestId: 'REQ-1',
      proposalTitle: 'A Proposal',
      programArea: 'Science',
      grantCycleCode: 'J26',
      candidates: [{ name: 'Dr X', email: 'x@mit.edu', affiliation: 'MIT' }],
    },
  };
  const res = mockRes();
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({
    success: true,
    savedCount: 1,
    savedNames: ['Dr X'],
    totalRequested: 1,
  });
  expect(reviewerSuggestionAdapter.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ potentialReviewerId: 'PID-1', requestId: 'REQ-1', selected: true }),
    { actingUserSystemId: 'SYS-1' },
  );
});

test('422 envelope pinned exactly when every candidate is rejected as unresolved identity', async () => {
  const req = {
    method: 'POST',
    body: {
      requestId: 'REQ-1',
      candidates: [{ name: 'Dr Unresolved', needsIdentification: true }],
    },
  };
  const res = mockRes();
  await handler(req, res);

  expect(res.statusCode).toBe(422);
  expect(res.body).toEqual({
    error: 'Selected candidates were not saved — they need identity review or are at the PI’s institution.',
    success: false,
    savedCount: 0,
    savedNames: [],
    totalRequested: 1,
    rejectedUnresolved: 1,
    rejectedInstitutionCOI: 0,
    errors: [{
      name: 'Dr Unresolved',
      error: 'Candidate identity is unresolved (needs identity review); not saved.',
      code: 'identity_unresolved',
    }],
  });
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
});

test('500 envelope pinned exactly when every candidate fails a non-identity adapter write', async () => {
  potentialReviewerAdapter.upsertByEmail.mockRejectedValue(new Error('Dataverse write failed'));
  const req = {
    method: 'POST',
    body: { requestId: 'REQ-1', candidates: [{ name: 'Dr Fails' }] },
  };
  const res = mockRes();
  await handler(req, res);

  expect(res.statusCode).toBe(500);
  expect(res.body).toEqual({
    error: 'No candidates were saved.',
    success: false,
    savedCount: 0,
    savedNames: [],
    totalRequested: 1,
    errors: [{ name: 'Dr Fails', error: 'Dataverse write failed' }],
  });
});
