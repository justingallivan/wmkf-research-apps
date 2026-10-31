/**
 * @jest-environment node
 *
 * D46/D49: the acceptance job's release_materials step. Each test pins one
 * row of the build plan's state table (REVIEWER_INVITATION_CALENDAR_BUILD_PLAN
 * §3.3 build notes): reversible checks before the claim, nothing resumed
 * blindly, markers only after a confirmed send.
 */

jest.mock('../../lib/services/operational-event-service', () => ({ __esModule: true, default: { markRecovered: jest.fn(async () => 1), markSuperseded: jest.fn(async () => 1) } }));
jest.mock('../../lib/services/alert-service', () => ({ __esModule: true, default: { autoResolve: jest.fn(async () => 1) } }));
jest.mock('../../lib/utils/reviewer-invite', () => {
  const actual = jest.requireActual('../../lib/utils/reviewer-invite');
  return { ...actual, emailConfidence: jest.fn(person => actual.emailConfidence(person)) };
});
import { processReviewerAcceptanceJob, drainReviewerAcceptanceJobs } from '../../lib/services/reviewer-acceptance-drain';
import { emailConfidence } from '../../lib/utils/reviewer-invite';
import { REVIEW_STATUS_MAP } from '../../shared/config/reviewerLifecycle';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const REVIEWER_ID = '33333333-3333-4333-8333-333333333333';
const CYCLE_ID = '55555555-5555-4555-8555-555555555555';
const LEASE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLACEHOLDER = 'send_time_token.pending_authority.not_live';

const suggestionRow = (overrides = {}) => ({
  wmkf_appreviewersuggestionid: SUGGESTION_ID, wmkf_accepted: true, wmkf_declined: false, wmkf_honorariumoptout: true,
  wmkf_revieweremail: 'reviewer@example.org', _wmkf_potentialreviewer_value: REVIEWER_ID, _wmkf_request_value: REQUEST_ID,
  wmkf_reviewstatus: REVIEW_STATUS_MAP.accepted, _etag: 'W/"10"', ...overrides,
});
const requestRow = () => ({ akoya_requestid: REQUEST_ID, akoya_requestnum: 'REQ-001', akoya_title: 'Proposal', wmkf_reviewduedate: '2027-03-10', _wmkf_grantcycle_value: CYCLE_ID });
const reviewerRow = (overrides = {}) => ({ wmkf_potentialreviewersid: REVIEWER_ID, wmkf_name: 'Dr. Reviewer', wmkf_emailaddress: 'reviewer@example.org', ...overrides });

function job({ steps = {}, isAcceptRepeat = false } = {}) {
  const suggestion = suggestionRow();
  return { id: 77, lease_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'queued', attempts: 0,
    suggestion_id: SUGGESTION_ID, request_id: REQUEST_ID, created_at: new Date().toISOString(), accepted_at: '2026-07-01T10:00:00.000Z', steps,
    payload: { schemaVersion: 1, acceptedAt: '2026-07-01T10:00:00.000Z', isAcceptRepeat, optedOut: true, body: {},
      suggestion, acceptedSuggestion: suggestion, request: requestRow(), reviewer: reviewerRow() } };
}

function deps({ suggestion = suggestionRow(), person = reviewerRow(), release = null } = {}) {
  const store = { release };
  const materials = {
    get: jest.fn(async () => store.release),
    claim: jest.fn(async () => { store.release = { suggestion_id: SUGGESTION_ID, source: 'acceptance', job_id: '77', state: 'claimed', lease_token: LEASE }; return { claimed: true, release: store.release }; }),
    markLinkMinted: jest.fn(async () => { store.release.state = 'link_minted'; return store.release; }),
    markSent: jest.fn(async () => { store.release.state = 'sent'; return store.release; }),
    record: jest.fn(async () => { store.release.state = 'recorded'; return store.release; }),
    stopRelease: jest.fn(async (_id, _lease, state) => { store.release.state = state; return store.release; }),
    recordDelivered: jest.fn(async () => {}),
    preflight: jest.fn(async () => ({ ok: true, fileCount: 1 })),
    cycleCodes: jest.fn(async () => ({ [CYCLE_ID]: 'J27' })),
    cycleConfigs: jest.fn(async () => ({ J27: { review_template_blob_url: 'https://blob/template.docx', additional_attachments: [] } })),
    attachments: jest.fn(async () => [{ filename: 'template.docx', contentType: 'application/octet-stream', content: Buffer.from('t') }]),
    prepare: jest.fn(async ({ attachments }) => ({ ok: true, placeholderToken: PLACEHOLDER, message: { to: 'reviewer@example.org', subject: 'Materials', body: `<p>https://x/external/review/${PLACEHOLDER}</p>`, attachments } })),
    assertBound: jest.fn(async () => {}),
    mint: jest.fn(async () => ({ jwt: 'minted.jwt.value' })),
    send: jest.fn(async () => ({ sent: true })),
  };
  const d = {
    switchesReady: () => true,
    suggestions: { getForAcceptanceDrain: jest.fn(async () => suggestion) },
    potentialReviewers: { getById: jest.fn(async () => person) },
    ensureHonorarium: jest.fn(), ensureAcceptedContact: jest.fn(async () => ({ contactId: 'c', addressCaptureError: null })),
    captureOrcid: jest.fn(async () => ({ persisted: true })), captureIdentity: jest.fn(async () => ({})), syncNameTitle: jest.fn(async () => ({})),
    alertEmail: jest.fn(async () => ({})), autoLinkAccount: jest.fn(async () => ({ skipped: 'no_exact_target' })),
    alertAffiliation: jest.fn(async () => ({})), resolveAffiliation: jest.fn(async () => ({ resolvedCount: 0 })),
    prepareAcceptanceEmail: jest.fn(async input => ({ ok: true, ...input })),
    readConfirmationRequest: jest.fn(async () => requestRow()),
    sendPreparedAcceptanceEmail: jest.fn(async () => ({ sent: true })),
    notify: jest.fn(async () => ({ id: 1 })), quota: jest.fn(async () => ({ notified: false })),
    deleteLateHonorarium: jest.fn(), cancelLateReleasedHonorarium: jest.fn(),
    materials,
    jobs: { mergeReviewerAcceptanceJobStep: jest.fn(async () => ({})), completeReviewerAcceptanceJob: jest.fn(async () => ({})),
      cancelReviewerAcceptanceJob: jest.fn(async () => ({})), recordReviewerAcceptanceJobFailure: jest.fn(async () => ({ status: 'queued' })) },
  };
  return { d, materials, store };
}
const stepPatches = d => d.jobs.mergeReviewerAcceptanceJobStep.mock.calls.filter(c => c[2] === 'release_materials').map(c => c[3]);
const finalOutcome = d => stepPatches(d).find(p => p.completedAt)?.outcome;
const notified = (d, type) => d.notify.mock.calls.some(([opts]) => opts.type === type);
const materialsSent = m => m.send.mock.calls.length;

test('happy path: claim, mint, one email with the minted link and cycle attachments, then the markers', async () => {
  const { d, materials, store } = deps();
  expect((await processReviewerAcceptanceJob(job(), d)).status).toBe('completed');
  expect(materials.claim).toHaveBeenCalledWith({ suggestionId: SUGGESTION_ID, requestId: REQUEST_ID, source: 'acceptance', jobId: 77 });
  expect(materials.mint).toHaveBeenCalledWith(expect.objectContaining({ suggestionId: SUGGESTION_ID, ifMatch: 'W/"10"', expiresAt: expect.any(Date) }));
  const sent = materials.send.mock.calls[0][0].message;
  expect(sent.body).toContain('minted.jwt.value'); expect(sent.body).not.toContain(PLACEHOLDER);
  expect(sent.attachments).toEqual([expect.objectContaining({ filename: 'template.docx' })]);
  expect(materials.recordDelivered).toHaveBeenCalledWith(expect.objectContaining({ suggestionId: SUGGESTION_ID, templateType: 'materials' }));
  expect(store.release.state).toBe('recorded');
  expect(d.sendPreparedAcceptanceEmail).not.toHaveBeenCalled();
  expect(finalOutcome(d)).toBe('released');
  // Order: nothing irreversible before the claim; markers only after the send.
  const order = ['claim', 'mint', 'markLinkMinted', 'send', 'markSent', 'recordDelivered', 'record'].map(k => materials[k].mock.invocationCallOrder[0]);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test.each([
  ['no proposal PDF', m => { m.preflight.mockResolvedValue({ ok: true, fileCount: 0 }); }, 'proposal_missing'],
  ['template keys not seeded', m => { m.prepare.mockResolvedValue({ ok: false, reason: 'materials_defaults_blank' }); }, 'materials_template_missing'],
  ['no Grant Cycle link', m => { m.cycleCodes.mockResolvedValue({}); }, 'grant_cycle_missing'],
  ['test request refusal', m => { m.assertBound.mockRejectedValue(new Error('test')); }, 'test_request_email_denied'],
])('%s: materials held, today’s confirmation sent, nothing claimed or minted', async (_name, arrange, reason) => {
  const { d, materials } = deps(); arrange(materials);
  expect((await processReviewerAcceptanceJob(job(), d)).status).toBe('completed');
  expect(d.sendPreparedAcceptanceEmail).toHaveBeenCalledTimes(1);
  expect(materials.claim).not.toHaveBeenCalled(); expect(materials.mint).not.toHaveBeenCalled(); expect(materialsSent(materials)).toBe(0);
  expect(stepPatches(d).find(p => p.completedAt)).toMatchObject({ outcome: 'held', reason });
  expect(notified(d, 'reviewer_materials_release_held')).toBe(true);
});

test('an address conflict holds materials before any claim', async () => {
  emailConfidence.mockReturnValueOnce({ level: 'low', action: 'blocked', code: 'address_conflict_pending' });
  const { d, materials } = deps();
  await processReviewerAcceptanceJob(job(), d);
  expect(stepPatches(d).find(p => p.completedAt)).toMatchObject({ outcome: 'held', reason: 'address_conflict_pending' });
  expect(materials.claim).not.toHaveBeenCalled(); expect(d.sendPreparedAcceptanceEmail).toHaveBeenCalledTimes(1);
});

test.each([
  ['revoked link', { wmkf_externaltokenrevoked: true }, 'held'],
  ['materials already sent', { wmkf_materialssentat: '2027-02-25T00:00:00Z' }, 'skipped'],
  ['status already under review', { wmkf_reviewstatus: REVIEW_STATUS_MAP.under_review }, 'skipped'],
])('%s: no automatic release', async (_name, overrides, outcome) => {
  const { d, materials } = deps({ suggestion: suggestionRow(overrides) });
  await processReviewerAcceptanceJob(job(), d);
  expect(finalOutcome(d)).toBe(outcome);
  expect(materials.claim).not.toHaveBeenCalled(); expect(materialsSent(materials)).toBe(0);
  expect(d.sendPreparedAcceptanceEmail).toHaveBeenCalledTimes(outcome === 'held' ? 1 : 0);
});

test('blank review status after acceptance is eligible (accept does not set a status)', async () => {
  const { d, materials } = deps({ suggestion: suggestionRow({ wmkf_reviewstatus: null }) });
  await processReviewerAcceptanceJob(job(), d);
  expect(finalOutcome(d)).toBe('released'); expect(materialsSent(materials)).toBe(1);
});

test.each([
  ['attachments', m => { m.attachments.mockRejectedValue(new Error('blob')); }],
  ['proposal listing', m => { m.preflight.mockResolvedValue({ ok: false, reason: 'materials_unavailable' }); }],
  ['cycle configuration', m => { m.cycleConfigs.mockRejectedValue(new Error('dv')); }],
  ['claim store', m => { m.claim.mockRejectedValue(new Error('pg')); }],
])('a transient %s failure retries with nothing claimed, minted or sent', async (_name, arrange) => {
  const { d, materials } = deps(); arrange(materials);
  await expect(processReviewerAcceptanceJob(job(), d)).rejects.toThrow('materials_release_preparation');
  expect(materials.mint).not.toHaveBeenCalled(); expect(materialsSent(materials)).toBe(0);
  expect(d.sendPreparedAcceptanceEmail).not.toHaveBeenCalled();
});

test('a release owned by manual release or another job is never sent again', async () => {
  for (const release of [{ source: 'manual', job_id: null, state: 'claimed' }, { source: 'acceptance', job_id: '12', state: 'recorded' }]) {
    const { d, materials } = deps({ release: { suggestion_id: SUGGESTION_ID, ...release } });
    expect((await processReviewerAcceptanceJob(job(), d)).status).toBe('completed');
    expect(finalOutcome(d)).toBe('skipped');
    expect(materialsSent(materials)).toBe(0); expect(d.sendPreparedAcceptanceEmail).not.toHaveBeenCalled();
  }
});

test('a claim lost to manual release is skipped without minting', async () => {
  const { d, materials } = deps();
  materials.claim.mockResolvedValue({ claimed: false, release: { source: 'manual', state: 'claimed' } });
  await processReviewerAcceptanceJob(job(), d);
  expect(finalOutcome(d)).toBe('skipped'); expect(materials.mint).not.toHaveBeenCalled();
});

test('a claim lost to an earlier worker of this job is deferred while it may still be sending, never closed', async () => {
  const { d, materials } = deps();
  materials.claim.mockResolvedValue({ claimed: false, release: { source: 'acceptance', job_id: '77', state: 'claimed', lease_until: new Date(Date.now() + 60000).toISOString() } });
  await expect(processReviewerAcceptanceJob(job(), d)).rejects.toThrow('release_in_progress');
  expect(stepPatches(d).some(p => p.completedAt)).toBe(false); expect(materials.mint).not.toHaveBeenCalled();
});

test('retry after a confirmed send only finishes the bookkeeping', async () => {
  const { d, materials, store } = deps({ release: { suggestion_id: SUGGESTION_ID, source: 'acceptance', job_id: '77', state: 'sent', sent_at: new Date('2027-02-25T01:00:00Z') } });
  await processReviewerAcceptanceJob(job(), d);
  expect(materialsSent(materials)).toBe(0); expect(materials.mint).not.toHaveBeenCalled();
  expect(materials.recordDelivered).toHaveBeenCalledWith(expect.objectContaining({ sentAt: '2027-02-25T01:00:00.000Z' }));
  expect(store.release.state).toBe('recorded'); expect(finalOutcome(d)).toBe('released');
  expect(require('../../lib/services/alert-service').default.autoResolve).toHaveBeenCalledWith(`reviewer-materials-release:${SUGGESTION_ID}`);
});

test('a failed bookkeeping write retries and the next attempt does not resend', async () => {
  const { d, materials, store } = deps();
  materials.recordDelivered.mockRejectedValueOnce(new Error('412'));
  await expect(processReviewerAcceptanceJob(job(), d)).rejects.toThrow('materials_bookkeeping_unavailable');
  expect(store.release.state).toBe('sent');
  expect(notified(d, 'reviewer_materials_release_unrecorded')).toBe(true);
  await processReviewerAcceptanceJob(job(), d);
  expect(materialsSent(materials)).toBe(1); expect(store.release.state).toBe('recorded');
});

test.each(['claimed', 'link_minted', 'uncertain', 'failed'])('an unfinished %s release of this job (lease expired) is never resumed: staff alert', async state => {
  const { d, materials } = deps({ release: { suggestion_id: SUGGESTION_ID, source: 'acceptance', job_id: '77', state, lease_until: new Date(Date.now() - 1000).toISOString() } });
  expect((await processReviewerAcceptanceJob(job(), d)).status).toBe('completed');
  expect(materials.mint).not.toHaveBeenCalled(); expect(materialsSent(materials)).toBe(0);
  expect(finalOutcome(d)).toBe('stopped'); expect(notified(d, 'reviewer_materials_release_stopped')).toBe(true);
});

test('mint failure stops the release as failed; nothing sent or marked', async () => {
  const { d, materials, store } = deps(); materials.mint.mockRejectedValue(new Error('412'));
  await processReviewerAcceptanceJob(job(), d);
  expect(store.release.state).toBe('failed'); expect(materialsSent(materials)).toBe(0);
  expect(materials.recordDelivered).not.toHaveBeenCalled(); expect(finalOutcome(d)).toBe('stopped');
});

test.each([
  ['a definite failure', Object.assign(new Error('400'), { status: 400 }), 'failed'],
  ['an unconfirmed send', new Error('socket hang up'), 'uncertain'],
])('%s stops the release without markers', async (_name, error, expected) => {
  const { d, materials, store } = deps(); materials.send.mockRejectedValue(error);
  await processReviewerAcceptanceJob(job(), d);
  expect(['failed', 'uncertain']).toContain(store.release.state);
  if (expected === 'uncertain') expect(store.release.state).toBe('uncertain');
  expect(materials.recordDelivered).not.toHaveBeenCalled(); expect(materials.record).not.toHaveBeenCalled();
  expect(finalOutcome(d)).toBe('stopped');
});

test('a send whose receipt cannot be kept (row taken over) alerts and writes no markers', async () => {
  const { d, materials } = deps(); materials.markSent.mockResolvedValue(null);
  await processReviewerAcceptanceJob(job(), d);
  expect(materialsSent(materials)).toBe(1); expect(materials.recordDelivered).not.toHaveBeenCalled();
  expect(stepPatches(d).find(p => p.completedAt)).toMatchObject({ outcome: 'stopped', reason: 'sent_after_release_taken_over' });
});

test('a repeat acceptance runs no materials step', async () => {
  const { d, materials } = deps();
  await processReviewerAcceptanceJob(job({ isAcceptRepeat: true }), d);
  expect(materials.get).not.toHaveBeenCalled(); expect(materialsSent(materials)).toBe(0);
});

test('the address check re-reads the reviewer; a failed read retries with nothing claimed', async () => {
  const { d, materials } = deps();
  d.potentialReviewers.getById.mockResolvedValueOnce(reviewerRow()).mockRejectedValueOnce(new Error('dv'));
  await expect(processReviewerAcceptanceJob(job(), d)).rejects.toThrow('reviewer_unavailable');
  expect(materials.claim).not.toHaveBeenCalled(); expect(materialsSent(materials)).toBe(0);
});

test('bookkeeping after a send binds to the job\u2019s suggestion snapshot', async () => {
  const { d, materials } = deps({ release: { suggestion_id: SUGGESTION_ID, source: 'acceptance', job_id: '77', state: 'sent', sent_at: '2027-02-25T01:00:00.000Z' } });
  await processReviewerAcceptanceJob(job(), d);
  expect(materials.recordDelivered.mock.calls[0][0].originalSuggestion).toMatchObject({ _wmkf_request_value: REQUEST_ID, _wmkf_potentialreviewer_value: REVIEWER_ID });
});

test.each(['claimed', 'link_minted'])('a %s release still under its lease (another worker may be sending) is deferred, not closed', async state => {
  const { d, materials } = deps({ release: { suggestion_id: SUGGESTION_ID, source: 'acceptance', job_id: '77', state, lease_until: new Date(Date.now() + 60000).toISOString() } });
  await expect(processReviewerAcceptanceJob(job(), d)).rejects.toThrow('release_in_progress');
  expect(stepPatches(d).some(p => p.completedAt)).toBe(false); expect(materials.mint).not.toHaveBeenCalled();
  expect(notified(d, 'reviewer_materials_release_stopped')).toBe(false);
});

test('a staff alert that cannot be stored keeps the step open; the retry alerts and completes', async () => {
  const { d, materials, store } = deps(); materials.mint.mockRejectedValue(new Error('412'));
  d.notify.mockRejectedValueOnce(new Error('alert store down'));
  await expect(processReviewerAcceptanceJob(job(), d)).rejects.toThrow('materials_alert_unavailable');
  expect(stepPatches(d).some(p => p.completedAt)).toBe(false);
  store.release.lease_until = new Date(Date.now() - 1000).toISOString();
  await processReviewerAcceptanceJob(job(), d);
  expect(notified(d, 'reviewer_materials_release_stopped')).toBe(true); expect(finalOutcome(d)).toBe('stopped');
  expect(materials.mint).toHaveBeenCalledTimes(1);
});

test.each([
  ['revoked', { wmkf_externaltokenrevoked: true }],
  ['materials sent elsewhere', { wmkf_materialssentat: '2027-02-25T00:00:00Z' }],
])('%s during preparation: the final recheck refuses before any claim or mint', async (_name, change) => {
  const { d, materials } = deps();
  const base = suggestionRow();
  // Reads: job start, accept check, step fresh read, final recheck (changed).
  d.suggestions.getForAcceptanceDrain.mockResolvedValueOnce(base).mockResolvedValueOnce(base).mockResolvedValueOnce(base).mockResolvedValueOnce({ ...base, ...change });
  await expect(processReviewerAcceptanceJob(job(), d)).rejects.toThrow('suggestion_changed');
  expect(materials.claim).not.toHaveBeenCalled(); expect(materials.mint).not.toHaveBeenCalled();
});

test('every drain run re-raises alerts for stuck releases, independent of any job budget', async () => {
  const notify = jest.fn(async () => ({ id: 1 }));
  const listStuckMaterialsReleases = jest.fn(async () => [
    { suggestion_id: SUGGESTION_ID, job_id: 77, state: 'uncertain', error_code: 'send_unconfirmed' },
    { suggestion_id: '66666666-6666-4666-8666-666666666666', request_id: REQUEST_ID, job_id: 78, state: 'sent', error_code: null, sent_at: '2026-10-30T10:00:00.000Z' },
  ]);
  const jobs = { claimReviewerAcceptanceJobs: jest.fn(async () => []) };
  // The sent row's bookkeeping retry fails, so it still alerts.
  const findSuggestionForMaterials = jest.fn(async () => { throw new Error('dataverse down'); });
  const result = await drainReviewerAcceptanceJobs({ deps: { jobs, notify, listStuckMaterialsReleases, findSuggestionForMaterials, switchesReady: () => true } });
  expect(result.materialsAlerts).toBe(2);
  expect(notify.mock.calls.map(([o]) => [o.type, o.autoResolveKey])).toEqual([
    ['reviewer_materials_release_stopped', `reviewer-materials-release:${SUGGESTION_ID}`],
    ['reviewer_materials_release_unrecorded', 'reviewer-materials-release:66666666-6666-4666-8666-666666666666'],
  ]);
  notify.mockRejectedValue(new Error('down'));
  expect((await drainReviewerAcceptanceJobs({ deps: { jobs, notify, listStuckMaterialsReleases, findSuggestionForMaterials, switchesReady: () => true } })).materialsAlerts).toBe(0);
});

describe('stuck sent releases: bookkeeping is retried, never the email (any source)', () => {
  const SENT_ROW = { suggestion_id: SUGGESTION_ID, request_id: REQUEST_ID, source: 'manual', job_id: null, state: 'sent', error_code: null, sent_at: new Date('2026-10-30T10:00:00.000Z') };
  const run = async ({ fresh = suggestionRow(), recordDelivered = jest.fn(async () => {}), record = jest.fn(async () => ({ state: 'recorded' })) } = {}) => {
    const AlertService = require('../../lib/services/alert-service').default;
    AlertService.autoResolve.mockClear();
    const notify = jest.fn(async () => ({ id: 1 }));
    const jobs = { claimReviewerAcceptanceJobs: jest.fn(async () => []) };
    const result = await drainReviewerAcceptanceJobs({ deps: {
      jobs, notify, switchesReady: () => true,
      listStuckMaterialsReleases: jest.fn(async () => [SENT_ROW]),
      findSuggestionForMaterials: jest.fn(async () => fresh),
      materials: { recordDelivered, record },
    } });
    return { result, notify, recordDelivered, record, AlertService };
  };

  test('a manual sent row is recorded from its persisted sent_at, the alert resolves, nothing is sent', async () => {
    const { result, notify, recordDelivered, record, AlertService } = await run();
    expect(recordDelivered).toHaveBeenCalledWith(expect.objectContaining({
      suggestionId: SUGGESTION_ID, templateType: 'materials', sentAt: '2026-10-30T10:00:00.000Z',
      originalSuggestion: { _wmkf_request_value: REQUEST_ID, _wmkf_potentialreviewer_value: REVIEWER_ID },
    }));
    expect(record).toHaveBeenCalledWith(SUGGESTION_ID);
    expect(AlertService.autoResolve).toHaveBeenCalledWith(`reviewer-materials-release:${SUGGESTION_ID}`);
    expect(notify).not.toHaveBeenCalled();
    expect(result.materialsAlerts).toBe(0);
  });

  test('a reviewer row that cannot take the bookkeeping keeps the unrecorded alert', async () => {
    const { notify, record } = await run({ recordDelivered: jest.fn(async () => { throw new Error('Suggestion is closed or has an unknown review status'); }) });
    expect(record).not.toHaveBeenCalled();
    expect(notify.mock.calls[0][0]).toMatchObject({ type: 'reviewer_materials_release_unrecorded' });
  });

  test('a suggestion now on another request is not recorded', async () => {
    const recordDelivered = jest.fn(async () => {});
    const { notify } = await run({ fresh: suggestionRow({ _wmkf_request_value: '99999999-9999-4999-8999-999999999999' }), recordDelivered });
    expect(recordDelivered).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe('15-minute fallback before the claim (owner, 2026-10-30)', () => {
  const failingAttachments = m => m.attachments.mockRejectedValue(new Error('blob store down'));
  const stepsSince = minutes => ({ release_materials: { firstPreparationFailedAt: new Date(Date.now() - minutes * 60000).toISOString() } });

  test('the first transient failure records when failures began and retries', async () => {
    const { d, materials } = deps(); failingAttachments(materials);
    await expect(processReviewerAcceptanceJob(job(), d)).rejects.toThrow('cycle_attachments_unavailable');
    expect(stepPatches(d).some(p => p.firstPreparationFailedAt)).toBe(true);
    expect(d.sendPreparedAcceptanceEmail).not.toHaveBeenCalled();
  });

  test('under 15 minutes it keeps retrying without resetting the start', async () => {
    const { d, materials } = deps(); failingAttachments(materials);
    await expect(processReviewerAcceptanceJob(job({ steps: stepsSince(10) }), d)).rejects.toThrow('cycle_attachments_unavailable');
    expect(stepPatches(d).some(p => p.firstPreparationFailedAt)).toBe(false);
    expect(d.sendPreparedAcceptanceEmail).not.toHaveBeenCalled();
  });

  test('after 15 minutes the reviewer gets today’s confirmation and staff a held alert; nothing claimed', async () => {
    const { d, materials } = deps(); failingAttachments(materials);
    expect((await processReviewerAcceptanceJob(job({ steps: stepsSince(16) }), d)).status).toBe('completed');
    expect(d.sendPreparedAcceptanceEmail).toHaveBeenCalledTimes(1);
    expect(stepPatches(d).find(p => p.completedAt)).toMatchObject({ outcome: 'held', reason: 'cycle_attachments_unavailable_after_retries' });
    expect(notified(d, 'reviewer_materials_release_held')).toBe(true);
    expect(materials.claim).not.toHaveBeenCalled(); expect(materialsSent(materials)).toBe(0);
  });

  test('after the claim there is no fallback: a live release still defers', async () => {
    const { d, materials } = deps({ release: { suggestion_id: SUGGESTION_ID, source: 'acceptance', job_id: '77', state: 'link_minted', lease_until: new Date(Date.now() + 60000).toISOString() } });
    await expect(processReviewerAcceptanceJob(job({ steps: stepsSince(30) }), d)).rejects.toThrow('release_in_progress');
    expect(d.sendPreparedAcceptanceEmail).not.toHaveBeenCalled(); expect(materials.mint).not.toHaveBeenCalled();
  });
});
