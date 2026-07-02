/**
 * @jest-environment node
 *
 * Fix A (S317): the backstop reconciler recovers reviewer emails that reached the
 * roster (emailPersistAllowed=true) but not Dataverse. Verifies the per-row decision:
 * WRITE ownerless, REPOINT a single active keeper (guarded), ALERT ambiguous/colliding,
 * and the idempotency + selected-only + id-anchor + dryRun invariants.
 */

jest.mock('../../lib/services/reviewer-roster-store', () => ({
  __esModule: true,
  findReconcilableCandidates: jest.fn(async () => []),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  findById: jest.fn(),
  findByPotentialReviewerAndRequest: jest.fn(async () => null),
  repointToPotentialReviewer: jest.fn(async () => undefined),
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  __esModule: true,
  getById: jest.fn(async () => ({})),
  findByEmailCandidates: jest.fn(async () => ({ none: true })),
  update: jest.fn(async () => undefined),
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  __esModule: true,
  updateById: jest.fn(async () => undefined),
}));
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: { notify: jest.fn(async () => ({ id: 'n1' })) },
}));

const rosterStore = require('../../lib/services/reviewer-roster-store');
const suggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const researcherAdapter = require('../../lib/dataverse/adapters/researcher');
const NotificationService = require('../../lib/services/notification-service').default;
const { reconcileReviewerEmails } = require('../../lib/services/reviewer-email-reconciler');

const REQ = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SUG = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PERSON = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const KEEPER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

// A vetted roster candidate (id-anchored, persistable email).
const vettedCandidate = (over = {}) => ({
  suggestionId: SUG,
  email: 'jun.ye@colorado.edu',
  emailSource: 'claude_search',
  emailPersistAllowed: true,
  ...over,
});

function seed(candidate, sug = {}) {
  rosterStore.findReconcilableCandidates.mockResolvedValue([{ requestId: REQ, candidate }]);
  suggestionAdapter.findById.mockResolvedValue({
    _wmkf_request_value: REQ,
    _wmkf_potentialreviewer_value: PERSON,
    wmkf_selected: true,
    ...sug,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  potentialReviewerAdapter.getById.mockResolvedValue({}); // person has no email
  potentialReviewerAdapter.findByEmailCandidates.mockResolvedValue({ none: true });
  suggestionAdapter.findByPotentialReviewerAndRequest.mockResolvedValue(null);
  potentialReviewerAdapter.update.mockResolvedValue(undefined);
  researcherAdapter.updateById.mockResolvedValue(undefined);
});

test('WRITE: ownerless vetted email → written to the person with vetted source', async () => {
  seed(vettedCandidate());
  const r = await reconcileReviewerEmails({});
  expect(r.written).toEqual([{ requestId: REQ, suggestionId: SUG, personId: PERSON, email: 'jun.ye@colorado.edu' }]);
  expect(potentialReviewerAdapter.update).toHaveBeenCalledWith(PERSON, { email: 'jun.ye@colorado.edu' }, expect.anything());
  expect(researcherAdapter.updateById).toHaveBeenCalledWith(PERSON, { emailSource: 'claude_search' }, expect.anything());
});

test('Find-row anchor: reconciles a roster candidate stamped with suggestionId after save-candidates', async () => {
  seed(vettedCandidate({
    name: 'Dr Find Saved',
    potentialReviewerId: PERSON,
    source: 'claude_search',
  }));
  const r = await reconcileReviewerEmails({});
  expect(suggestionAdapter.findById).toHaveBeenCalledWith(SUG);
  expect(r.scanned).toBe(1);
  expect(r.written).toEqual([{ requestId: REQ, suggestionId: SUG, personId: PERSON, email: 'jun.ye@colorado.edu' }]);
});

test('REPOINT: single active keeper with no colliding suggestion → repointed', async () => {
  seed(vettedCandidate());
  potentialReviewerAdapter.findByEmailCandidates.mockResolvedValue({ one: true, id: KEEPER, row: { statecode: 0 } });
  const r = await reconcileReviewerEmails({});
  expect(suggestionAdapter.repointToPotentialReviewer).toHaveBeenCalledWith(SUG, KEEPER, expect.anything());
  expect(r.repointed).toEqual([{ requestId: REQ, suggestionId: SUG, from: PERSON, to: KEEPER, email: 'jun.ye@colorado.edu' }]);
  expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
});

test('ALERT: keeper already has a suggestion on the request → no repoint, alert', async () => {
  seed(vettedCandidate());
  potentialReviewerAdapter.findByEmailCandidates.mockResolvedValue({ one: true, id: KEEPER, row: { statecode: 0 } });
  suggestionAdapter.findByPotentialReviewerAndRequest.mockResolvedValue({ wmkf_appreviewersuggestionid: 'other' });
  const r = await reconcileReviewerEmails({});
  expect(suggestionAdapter.repointToPotentialReviewer).not.toHaveBeenCalled();
  expect(r.alerted[0]).toMatchObject({ reason: 'keeper_has_suggestion', keeperId: KEEPER });
  expect(NotificationService.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'reviewer_email_reconcile_needs_merge' }));
});

test('ALERT: ambiguous owner (>1) → alert, no mutation', async () => {
  seed(vettedCandidate());
  potentialReviewerAdapter.findByEmailCandidates.mockResolvedValue({ ambiguous: true, count: 2, rows: [] });
  const r = await reconcileReviewerEmails({});
  expect(r.alerted[0]).toMatchObject({ reason: 'ambiguous_owner' });
  expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
  expect(suggestionAdapter.repointToPotentialReviewer).not.toHaveBeenCalled();
});

test('does NOT repoint to an INACTIVE single owner → alert', async () => {
  seed(vettedCandidate());
  potentialReviewerAdapter.findByEmailCandidates.mockResolvedValue({ one: true, id: KEEPER, row: { statecode: 1 } });
  const r = await reconcileReviewerEmails({});
  expect(suggestionAdapter.repointToPotentialReviewer).not.toHaveBeenCalled();
  expect(r.alerted[0]).toMatchObject({ reason: 'inactive_owner' });
});

test('idempotent: person already has an email → skipped', async () => {
  seed(vettedCandidate());
  potentialReviewerAdapter.getById.mockResolvedValue({ wmkf_emailaddress: 'already@there.edu' });
  const r = await reconcileReviewerEmails({});
  expect(r.skipped).toBe(1);
  expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
});

test('id anchor: a suggestion belonging to a different request is skipped', async () => {
  seed(vettedCandidate(), { _wmkf_request_value: 'ffffffff-ffff-ffff-ffff-ffffffffffff' });
  const r = await reconcileReviewerEmails({});
  expect(r.skipped).toBe(1);
  expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
});

test('only selected suggestions are reconciled', async () => {
  seed(vettedCandidate(), { wmkf_selected: false });
  const r = await reconcileReviewerEmails({});
  expect(r.skipped).toBe(1);
  expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
});

test('non-persistable candidate (emailPersistAllowed false) is skipped by the gate', async () => {
  seed(vettedCandidate({ emailPersistAllowed: false }));
  const r = await reconcileReviewerEmails({});
  expect(r.skipped).toBe(1);
  expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
});

test('dryRun: reports the intended write without mutating Dataverse', async () => {
  seed(vettedCandidate());
  const r = await reconcileReviewerEmails({ dryRun: true });
  expect(r.written).toHaveLength(1);
  expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
  expect(researcherAdapter.updateById).not.toHaveBeenCalled();
});

test('dryRun: records an alert but fires NO notification (no side effects)', async () => {
  seed(vettedCandidate());
  potentialReviewerAdapter.findByEmailCandidates.mockResolvedValue({ ambiguous: true, count: 2, rows: [] });
  const r = await reconcileReviewerEmails({ dryRun: true });
  expect(r.alerted[0]).toMatchObject({ reason: 'ambiguous_owner' });
  expect(NotificationService.notify).not.toHaveBeenCalled();
});

test('a row error is recorded, never fatal to the batch', async () => {
  rosterStore.findReconcilableCandidates.mockResolvedValue([
    { requestId: REQ, candidate: vettedCandidate() },
    { requestId: REQ, candidate: vettedCandidate({ suggestionId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' }) },
  ]);
  suggestionAdapter.findById
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValue({ _wmkf_request_value: REQ, _wmkf_potentialreviewer_value: PERSON, wmkf_selected: true });
  const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
  const r = await reconcileReviewerEmails({});
  warn.mockRestore();
  expect(r.errors).toHaveLength(1);
  expect(r.written).toHaveLength(1); // the second row still processed
});
