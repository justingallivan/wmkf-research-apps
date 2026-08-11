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
  getForEmailReconcile: jest.fn(),
  isExcluded: jest.fn((row) => row?.wmkf_applicantdisposition === 'excluded'),
  findByPotentialReviewerAndRequest: jest.fn(async () => null),
  repointToPotentialReviewer: jest.fn(async () => undefined),
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  __esModule: true,
  getForEmailReconcile: jest.fn(async () => ({})),
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
jest.mock('../../lib/services/alert-service', () => ({
  __esModule: true,
  default: {
    getOpenAutoResolveKeysByType: jest.fn(async () => []),
    autoResolve: jest.fn(async () => 1),
  },
}));

const rosterStore = require('../../lib/services/reviewer-roster-store');
const suggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const researcherAdapter = require('../../lib/dataverse/adapters/researcher');
const NotificationService = require('../../lib/services/notification-service').default;
const AlertService = require('../../lib/services/alert-service').default;
const { reconcileReviewerEmails } = require('../../lib/services/reviewer-email-reconciler');

const ALERT_KEY = (sug) => `reviewer-email-reconcile:${sug}`;

const REQ = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SUG = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PERSON = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const KEEPER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

// A vetted roster candidate (id-anchored, persistable email).
const vettedCandidate = (over = {}) => ({
  suggestionId: SUG,
  email: 'ava.mercer@example.org',
  emailSource: 'claude_search',
  emailPersistAllowed: true,
  identityStatus: 'probable',
  ...over,
});

function seed(candidate, sug = {}) {
  rosterStore.findReconcilableCandidates.mockResolvedValue([{ requestId: REQ, candidate }]);
  suggestionAdapter.getForEmailReconcile.mockResolvedValue({
    _wmkf_request_value: REQ,
    _wmkf_potentialreviewer_value: PERSON,
    wmkf_selected: true,
    ...sug,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  AlertService.getOpenAutoResolveKeysByType.mockResolvedValue([ALERT_KEY(SUG)]);
  potentialReviewerAdapter.getForEmailReconcile.mockResolvedValue({}); // person has no email
  potentialReviewerAdapter.findByEmailCandidates.mockResolvedValue({ none: true });
  suggestionAdapter.findByPotentialReviewerAndRequest.mockResolvedValue(null);
  potentialReviewerAdapter.update.mockResolvedValue(undefined);
  researcherAdapter.updateById.mockResolvedValue(undefined);
});

test('WRITE: ownerless vetted email → written to the person with vetted source', async () => {
  seed(vettedCandidate());
  const r = await reconcileReviewerEmails({});
  expect(r.written).toEqual([{ requestId: REQ, suggestionId: SUG, personId: PERSON, email: 'ava.mercer@example.org' }]);
  // S387: address + vetted source in ONE patch, never a follow-up source write.
  expect(potentialReviewerAdapter.update).toHaveBeenCalledWith(PERSON, { email: 'ava.mercer@example.org', emailSource: 'claude_search' }, expect.anything());
  expect(researcherAdapter.updateById).not.toHaveBeenCalledWith(PERSON, { emailSource: 'claude_search' }, expect.anything());
});

test('Find-row anchor: reconciles a roster candidate stamped with suggestionId after save-candidates', async () => {
  seed(vettedCandidate({
    name: 'Dr Find Saved',
    potentialReviewerId: PERSON,
    source: 'claude_search',
  }));
  const r = await reconcileReviewerEmails({});
  expect(suggestionAdapter.getForEmailReconcile).toHaveBeenCalledWith(SUG);
  expect(r.scanned).toBe(1);
  expect(r.written).toEqual([{ requestId: REQ, suggestionId: SUG, personId: PERSON, email: 'ava.mercer@example.org' }]);
});

test('REPOINT: single active keeper with no colliding suggestion → repointed', async () => {
  seed(vettedCandidate());
  potentialReviewerAdapter.findByEmailCandidates.mockResolvedValue({ one: true, id: KEEPER, row: { statecode: 0 } });
  const r = await reconcileReviewerEmails({});
  expect(suggestionAdapter.repointToPotentialReviewer).toHaveBeenCalledWith(SUG, KEEPER, expect.anything());
  expect(r.repointed).toEqual([{ requestId: REQ, suggestionId: SUG, from: PERSON, to: KEEPER, email: 'ava.mercer@example.org' }]);
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
  potentialReviewerAdapter.getForEmailReconcile.mockResolvedValue({ wmkf_emailaddress: 'existing@example.org' });
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
  suggestionAdapter.getForEmailReconcile
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValue({ _wmkf_request_value: REQ, _wmkf_potentialreviewer_value: PERSON, wmkf_selected: true });
  const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
  const r = await reconcileReviewerEmails({});
  warn.mockRestore();
  expect(r.errors).toHaveLength(1);
  expect(r.written).toHaveLength(1); // the second row still processed
});

// ─────────────── Retraction (S414) ───────────────
// `autoResolveKey` only DEDUPES new alerts, so before this a needs-merge alert
// outlived its condition forever. The danger in fixing that is the mirror of the
// affiliation-alert lesson: retracting an alert whose duplicate still exists
// destroys the only standing signal. These tests pin BOTH directions.

test('RETRACT: a deselected suggestion auto-resolves its stale alert', async () => {
  // The duplicate row was removed from the request, so the cron has no work item
  // left and the alert is stale.
  seed(vettedCandidate(), { wmkf_selected: false });
  const r = await reconcileReviewerEmails({});
  expect(AlertService.autoResolve).toHaveBeenCalledWith(ALERT_KEY(SUG));
  expect(r.retracted).toEqual([{ suggestionId: SUG, reason: 'deselected', count: 1 }]);
  expect(r.skipped).toBe(1);
});

test('RETRACT: a deselected suggestion retracts even when its roster email is no longer vetted', async () => {
  // Production alert 383 still qualifies for the roster scan, but its current
  // identity decision makes pickVettedEmail return null. Lifecycle evidence is
  // independent of whether the old contact claim remains authoritative.
  seed(vettedCandidate({ identityStatus: 'ambiguous' }), { wmkf_selected: false });
  const r = await reconcileReviewerEmails({});
  expect(AlertService.autoResolve).toHaveBeenCalledWith(ALERT_KEY(SUG));
  expect(r.retracted).toEqual([{ suggestionId: SUG, reason: 'deselected', count: 1 }]);
  expect(r.skipped).toBe(1);
});

test('NO RETRACT: a selected suggestion without a currently vetted email keeps its standing alert', async () => {
  seed(vettedCandidate({ identityStatus: 'ambiguous' }));
  const r = await reconcileReviewerEmails({});
  expect(AlertService.autoResolve).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.getForEmailReconcile).not.toHaveBeenCalled();
  expect(r.skipped).toBe(1);
});

test('unvetted row without an open keyed alert skips the Dataverse lifecycle read', async () => {
  seed(vettedCandidate({ identityStatus: 'ambiguous' }));
  AlertService.getOpenAutoResolveKeysByType.mockResolvedValue([]);
  const r = await reconcileReviewerEmails({});
  expect(suggestionAdapter.getForEmailReconcile).not.toHaveBeenCalled();
  expect(r.skipped).toBe(1);
  expect(r.errors).toEqual([]);
});

test('vetted row without an open keyed alert still runs the normal write path', async () => {
  seed(vettedCandidate());
  AlertService.getOpenAutoResolveKeysByType.mockResolvedValue([]);
  const r = await reconcileReviewerEmails({});
  expect(suggestionAdapter.getForEmailReconcile).toHaveBeenCalledWith(SUG);
  expect(r.written).toEqual([{ requestId: REQ, suggestionId: SUG, personId: PERSON, email: 'ava.mercer@example.org' }]);
});

test('open-alert key scan failure falls back to checking unvetted lifecycles', async () => {
  seed(vettedCandidate({ identityStatus: 'ambiguous' }), { wmkf_selected: false });
  AlertService.getOpenAutoResolveKeysByType.mockRejectedValue(new Error('pg down'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const r = await reconcileReviewerEmails({});
  warn.mockRestore();
  expect(suggestionAdapter.getForEmailReconcile).toHaveBeenCalledWith(SUG);
  expect(r.retracted).toEqual([{ suggestionId: SUG, reason: 'deselected', count: 1 }]);
});

test('RETRACT: the person already having an email auto-resolves the alert', async () => {
  seed(vettedCandidate());
  potentialReviewerAdapter.getForEmailReconcile.mockResolvedValue({ wmkf_emailaddress: 'ava.mercer@example.org' });
  const r = await reconcileReviewerEmails({});
  expect(r.retracted).toEqual([{ suggestionId: SUG, reason: 'email_present', count: 1 }]);
});

test('RETRACT: a vanished suggestion auto-resolves the alert', async () => {
  seed(vettedCandidate({ identityStatus: 'ambiguous' }));
  suggestionAdapter.getForEmailReconcile.mockResolvedValue(null);
  const r = await reconcileReviewerEmails({});
  expect(r.retracted).toEqual([{ suggestionId: SUG, reason: 'suggestion_gone', count: 1 }]);
});

test('NO RETRACT: a systemic Dataverse 404 is a row error, not evidence the suggestion is gone', async () => {
  seed(vettedCandidate({ identityStatus: 'ambiguous' }));
  suggestionAdapter.getForEmailReconcile.mockRejectedValue(Object.assign(new Error('bad entity path'), {
    serviceName: 'dataverse',
    status: 404,
    dataverseCode: '0x8006088a',
  }));
  const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
  const r = await reconcileReviewerEmails({});
  warn.mockRestore();
  expect(r.errors).toHaveLength(1);
  expect(AlertService.autoResolve).not.toHaveBeenCalled();
  expect(r.retracted).toEqual([]);
});

test('RETRACT: an applicant-excluded suggestion is lifecycle-conclusive without a row error', async () => {
  seed(vettedCandidate({ identityStatus: 'ambiguous' }), {
    wmkf_selected: false,
    wmkf_applicantdisposition: 'excluded',
  });
  const r = await reconcileReviewerEmails({});
  expect(r.retracted).toEqual([{ suggestionId: SUG, reason: 'applicant_excluded', count: 1 }]);
  expect(r.errors).toEqual([]);
});

test('RETRACT: a successful write and repoint each retract', async () => {
  seed(vettedCandidate());
  const written = await reconcileReviewerEmails({});
  expect(written.retracted).toEqual([{ suggestionId: SUG, reason: 'written', count: 1 }]);

  jest.clearAllMocks();
  AlertService.autoResolve.mockResolvedValue(1);
  seed(vettedCandidate());
  potentialReviewerAdapter.getForEmailReconcile.mockResolvedValue({});
  potentialReviewerAdapter.findByEmailCandidates.mockResolvedValue({ one: true, id: KEEPER, row: { statecode: 0 } });
  suggestionAdapter.findByPotentialReviewerAndRequest.mockResolvedValue(null);
  const repointed = await reconcileReviewerEmails({});
  expect(repointed.retracted).toEqual([{ suggestionId: SUG, reason: 'repointed', count: 1 }]);
});

test('NO RETRACT: keeper_has_suggestion still alerts and never retracts', async () => {
  seed(vettedCandidate());
  potentialReviewerAdapter.findByEmailCandidates.mockResolvedValue({ one: true, id: KEEPER, row: { statecode: 0 } });
  suggestionAdapter.findByPotentialReviewerAndRequest.mockResolvedValue({ wmkf_appreviewersuggestionid: 'other' });
  const r = await reconcileReviewerEmails({});
  expect(r.alerted[0]).toMatchObject({ reason: 'keeper_has_suggestion' });
  expect(AlertService.autoResolve).not.toHaveBeenCalled();
  expect(r.retracted).toEqual([]);
});

test('NO RETRACT: an ambiguous owner leaves the standing signal intact', async () => {
  seed(vettedCandidate());
  potentialReviewerAdapter.findByEmailCandidates.mockResolvedValue({ ambiguous: true, count: 2, rows: [] });
  const r = await reconcileReviewerEmails({});
  expect(AlertService.autoResolve).not.toHaveBeenCalled();
  expect(r.retracted).toEqual([]);
});

test('NO RETRACT: a stale-roster request mismatch says nothing about the alert', async () => {
  // The roster row points at a different request than the suggestion actually
  // belongs to. That is roster staleness, NOT evidence the duplicate is resolved.
  seed(vettedCandidate(), { _wmkf_request_value: 'ffffffff-ffff-ffff-ffff-ffffffffffff' });
  const r = await reconcileReviewerEmails({});
  expect(AlertService.autoResolve).not.toHaveBeenCalled();
  expect(r.skipped).toBe(1);
});

test('NO RETRACT: a contradictory same-person owner is not treated as resolved', async () => {
  seed(vettedCandidate());
  potentialReviewerAdapter.findByEmailCandidates.mockResolvedValue({ one: true, id: PERSON, row: { statecode: 0 } });
  const r = await reconcileReviewerEmails({});
  expect(AlertService.autoResolve).not.toHaveBeenCalled();
  expect(r.retracted).toEqual([]);
});

test('NO RETRACT: a missing person is non-reconcilable and preserves the alert', async () => {
  seed(vettedCandidate());
  potentialReviewerAdapter.getForEmailReconcile.mockResolvedValue(null);
  const r = await reconcileReviewerEmails({});
  expect(potentialReviewerAdapter.findByEmailCandidates).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
  expect(AlertService.autoResolve).not.toHaveBeenCalled();
  expect(r.skipped).toBe(1);
});

test('dryRun reports intended retractions without mutating alerts', async () => {
  seed(vettedCandidate(), { wmkf_selected: false });
  const r = await reconcileReviewerEmails({ dryRun: true });
  expect(AlertService.autoResolve).not.toHaveBeenCalled();
  expect(r.retracted).toEqual([]);
  expect(r.wouldRetract).toEqual([{ suggestionId: SUG, reason: 'deselected' }]);
  expect(r.retractionPreviewComplete).toBe(true);
});

test('dryRun omits no-op retraction attempts when no keyed alert is open', async () => {
  seed(vettedCandidate(), { wmkf_selected: false });
  AlertService.getOpenAutoResolveKeysByType.mockResolvedValue([]);
  const r = await reconcileReviewerEmails({ dryRun: true });
  expect(AlertService.autoResolve).not.toHaveBeenCalled();
  expect(r.wouldRetract).toEqual([]);
  expect(r.retractionPreviewComplete).toBe(true);
});

test('dryRun marks the retraction preview incomplete when the open-key scan fails', async () => {
  seed(vettedCandidate(), { wmkf_selected: false });
  AlertService.getOpenAutoResolveKeysByType.mockRejectedValue(new Error('pg down'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const r = await reconcileReviewerEmails({ dryRun: true });
  warn.mockRestore();
  expect(AlertService.autoResolve).not.toHaveBeenCalled();
  expect(r.wouldRetract).toEqual([]);
  expect(r.retractionPreviewComplete).toBe(false);
});

test('a retraction failure is non-fatal and leaves the outcome intact', async () => {
  seed(vettedCandidate());
  AlertService.autoResolve.mockRejectedValue(new Error('pg down'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const r = await reconcileReviewerEmails({});
  warn.mockRestore();
  expect(r.written).toHaveLength(1); // the write still counts
  expect(r.retracted).toEqual([]);
  expect(r.errors).toHaveLength(0);
});

test('retracted is only recorded when a row was actually updated', async () => {
  // autoResolve returns 0 when no alert existed — the common case. A no-op must
  // not inflate the retracted list, or the cron log implies work that never happened.
  seed(vettedCandidate());
  AlertService.autoResolve.mockResolvedValue(0);
  const r = await reconcileReviewerEmails({});
  expect(AlertService.autoResolve).toHaveBeenCalledWith(ALERT_KEY(SUG));
  expect(r.retracted).toEqual([]);
});

test('the emitted autoResolveKey is EXACTLY the key retraction matches on', async () => {
  // Load-bearing coupling: alertNeedsMerge and retractNeedsMerge must derive the
  // key from one definition. If they drift, alerts are raised under one key and
  // retracted under another — retraction silently no-ops forever (fail-open).
  seed(vettedCandidate());
  potentialReviewerAdapter.findByEmailCandidates.mockResolvedValue({ one: true, id: KEEPER, row: { statecode: 0 } });
  suggestionAdapter.findByPotentialReviewerAndRequest.mockResolvedValue({ wmkf_appreviewersuggestionid: 'other' });
  await reconcileReviewerEmails({});
  const emitted = NotificationService.notify.mock.calls[0][0].autoResolveKey;

  jest.clearAllMocks();
  AlertService.autoResolve.mockResolvedValue(1);
  seed(vettedCandidate(), { wmkf_selected: false }); // a retracting outcome
  await reconcileReviewerEmails({});
  expect(AlertService.autoResolve).toHaveBeenCalledWith(emitted);
});
