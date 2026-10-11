/** @jest-environment node */
// Stage 3b S6: finalize hand-off, receipt repair and inspection, configuration-fault deferral, crash injection.
// Plan: docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md ("Dispatch", "Recovery and non-destructive receipt
// binding", "Retry policy", Tests: Registration, Rejected candidate past expiry, Crash injection).
jest.mock('@vercel/postgres', () => ({ sql: { query: jest.fn() }, db: { connect: jest.fn() } }));
jest.mock('../../lib/services/meeting-tracker-recordings/import-service.js', () => ({ readZoomImportConfig: jest.fn() }));

import { ServiceHttpError } from '../../lib/services/service-http-error.js';
import { ZoomClientError } from '../../lib/services/meeting-tracker-recordings/zoom-client.js';
import { FINALIZE_ADMISSION_MS, reconcileFinalizedCopies } from '../../lib/services/meeting-tracker-recordings/video-copy-worker.js';
import { ID, REQ, makeWorld, logText } from '../helpers/zoom-video-copy-world.js';

const DAY = 86_400_000;
const err = (code, httpStatus, retryable = false) => new ServiceHttpError(code, { httpStatus, code, body: { error: code, code, ...(retryable ? { retryable: true } : {}) } });
const registering = (over = {}) => makeWorld({ size: 100, copyState: 'registering', ...over }).seedRegistering();
const docsFor = w => w.docs.filter(d => d.wmkf_generationkey === w.intent.generation_key);
const noLeases = w => {
  expect(w.copy.lease_token).toBeNull();
  expect(w.intent.lease_token).toBeNull();
  expect(w.slot.token).toBeNull();
};

describe('finalize hand-off (registering)', () => {
  test('registers the recording once, supersedes the Zoom link, finalizes the intent and records the receipt', async () => {
    const w = registering();
    w.docs.push(w.zoomLinkDoc());
    const result = await w.tick();
    expect(result.outcome).toBe('copied');
    expect(w.counts.createDoc).toBe(1);
    const [created] = docsFor(w);
    expect(created).toMatchObject({ wmkf_slotversion: 5, wmkf_filesize: 100, wmkf_sharepointitemid: 'item1', wmkf_producer: 'meeting-tracker-post-presentation' });
    expect(w.docs.find(d => d.wmkf_requestdocumentid === 'link-1').wmkf_lifecyclestate).not.toBe(created.wmkf_lifecyclestate);
    expect(w.intent).toMatchObject({ state: 'finalized', request_document_id: created.wmkf_requestdocumentid, upload_url_ciphertext: null });
    expect(w.copy).toMatchObject({ state: 'copied', request_document_id: created.wmkf_requestdocumentid, sharepoint_item_id: 'item1', failure_code: null });
    noLeases(w);
  });

  test('replay recovers the same Request Document: no second create, predecessor still superseded', async () => {
    const w = registering();
    w.docs.push(w.zoomLinkDoc());
    const existing = w.registeredDoc();
    expect((await w.tick()).outcome).toBe('copied');
    expect(w.counts.createDoc).toBe(0);
    expect(docsFor(w)).toHaveLength(1);
    expect(w.copy.request_document_id).toBe(existing.wmkf_requestdocumentid);
    expect(w.docs.find(d => d.wmkf_requestdocumentid === 'link-1').wmkf_lifecyclestate).toBeDefined();
    expect(w.counts.updateDoc).toBe(1);
  });

  test('the finalize hand-off needs FINALIZE_ADMISSION_MS: under it nothing is claimed or written', async () => {
    const w = registering();
    const result = await w.tick({ deadlineMs: w.t + FINALIZE_ADMISSION_MS - 1_000 });
    expect(result.outcome).toBe('budget_yield');
    expect(w.counts.claimFinalize).toBe(0);
    expect(w.counts.createDoc).toBe(0);
    expect(w.intent.state).toBe('uploaded');
    noLeases(w);
    expect((await w.tick({ deadlineMs: w.t + FINALIZE_ADMISSION_MS + 1_000 })).outcome).toBe('copied');
  });

  test('a cancel flag seen before I3 cancels the copy with the item identity and leaves the intent uploaded', async () => {
    const w = registering();
    w.copy.cancel_requested_at = new Date(w.t).toISOString();
    const result = await w.tick();
    expect(result.outcome).toBe('cancelled');
    expect(w.counts.claimFinalize).toBe(0);
    expect(w.copy).toMatchObject({ state: 'cancelled', sharepoint_item_id: 'item1' });
    expect(w.intent.state).toBe('uploaded');
  });

  test('the cancel flag is ignored once I3 has claimed (a flag set during finalize does not stop registration)', async () => {
    const w = registering();
    w.hooks.beforeCreateDoc = () => { w.copy.cancel_requested_at = new Date(w.t).toISOString(); };
    expect((await w.tick()).outcome).toBe('copied');
  });

  test('host removed at the hand-off fails the copy without claiming I3; a removed config pauses', async () => {
    const w = registering();
    const result = await w.tick({}, { readConfig: () => ({ available: true, hosts: ['other@example.org'] }) });
    expect(result).toMatchObject({ outcome: 'failed', code: 'zoom_video_host_not_approved' });
    expect(w.counts.claimFinalize).toBe(0);
    expect(w.intent.state).toBe('uploaded');
    const p = registering();
    expect((await p.tick({}, { readConfig: () => ({ available: false, hosts: [] }) })).outcome).toBe('paused');
    expect(p.copy.state).toBe('registering');
  });

  test('access denied during finalize pauses and releases the intent non-terminal', async () => {
    const w = registering();
    let calls = 0;
    const result = await w.tick({}, { requestAllowed: () => { calls += 1; return calls < 5; } });
    expect(result.outcome).toBe('paused');
    expect(w.counts.createDoc).toBe(0);
    expect(w.copy.state).toBe('registering');
    expect(w.intent.state).toBe('uploaded');
    noLeases(w);
  });

  test('the copy lease lost right before the slot stops finalize before acquireSlotLease (renewOrStop precedes it)', async () => {
    const w = registering();
    const acquire = w.materialDeps.acquireSlotLease;
    w.materialDeps.acquireSlotLease = async (...args) => { w.counts.acquire = (w.counts.acquire || 0) + 1; return acquire(...args); };
    const read = w.materialDeps.readMediaRange;
    w.materialDeps.readMediaRange = async (...args) => {
      const out = await read(...args);
      Object.assign(w.copy, { lease_token: 'taken-over', lease_expires_at: w.t + 600_000 });
      return out;
    };
    const result = await w.tick();
    expect(result.outcome).toBe('lease_lost');
    expect(w.counts.acquire || 0).toBe(0);
    expect(w.counts.createDoc).toBe(0);
    expect(w.copy.lease_token).toBe('taken-over');
  });

  describe('decision 8 at finalize', () => {
    test('a SharePoint winner that is not the confirmed one aborts zoom_video_recording_replaced with no create or supersede', async () => {
      const w = registering();
      w.docs.push(w.staffMp4Doc('staff-1', 3));
      const result = await w.tick();
      expect(result).toMatchObject({ outcome: 'failed', code: 'zoom_video_recording_replaced' });
      expect(w.counts.createDoc).toBe(0);
      expect(w.counts.updateDoc).toBe(0);
      expect(w.docs.find(d => d.wmkf_requestdocumentid === 'staff-1').wmkf_lifecyclestate).toBe(w.zoomLinkDoc().wmkf_lifecyclestate);
      expect(w.copy).toMatchObject({ state: 'failed', failure_code: 'zoom_video_recording_replaced', sharepoint_item_id: 'item1' });
      expect(w.intent.state).toBe('uploaded'); // not a rejected candidate; bytes stay unregistered
      noLeases(w);
    });

    test('a newer SharePoint winner than the confirmed slot version aborts; the confirmed one proceeds and is superseded', async () => {
      const newer = registering();
      Object.assign(newer.copy, { confirmed_winner_document_id: 'staff-1', confirmed_winner_slot_version: 3 });
      newer.docs.push(newer.staffMp4Doc('staff-2', 5));
      expect((await newer.tick()).code).toBe('zoom_video_recording_replaced');
      expect(newer.counts.createDoc).toBe(0);

      const same = registering();
      Object.assign(same.copy, { confirmed_winner_document_id: 'staff-1', confirmed_winner_slot_version: 3 });
      same.docs.push(same.staffMp4Doc('staff-1', 3));
      expect((await same.tick()).outcome).toBe('copied');
      expect(same.counts.updateDoc).toBe(1);
      expect(same.docs.find(d => d.wmkf_requestdocumentid === 'staff-1').wmkf_lifecyclestate).not.toBe(docsFor(same)[0].wmkf_lifecyclestate);
    });

    test('a Zoom-link winner and an empty slot proceed', async () => {
      for (const docs of [[], [registering().zoomLinkDoc()]]) {
        const w = registering();
        w.docs.push(...docs);
        expect((await w.tick()).outcome).toBe('copied');
      }
    });
  });

  describe('failure mapping', () => {
    test('request_document_actor_unavailable is terminal on the first attempt; the intent is released to uploaded, identities kept', async () => {
      const w = registering();
      w.materialDeps.createDocument = async () => { throw err('request_document_actor_unavailable', 403); };
      const result = await w.tick();
      expect(result).toMatchObject({ outcome: 'failed', code: 'request_document_actor_unavailable' });
      expect(w.copy).toMatchObject({ state: 'failed', registration_attempts: 0, sharepoint_item_id: 'item1' });
      expect(w.intent.state).toBe('uploaded');
      noLeases(w);
    });

    test('a bad MP4 signature and a malware flag are terminal and park the intent as a rejected candidate', async () => {
      for (const [override, code] of [
        [{ bytes: Buffer.alloc(32), mimeType: 'video/mp4', malware: null }, 'post_presentation_mp4_signature_invalid'],
        [{ bytes: Buffer.alloc(32), mimeType: 'video/mp4', malware: 'flagged' }, 'post_presentation_mp4_malware'],
      ]) {
        const w = registering();
        w.materialDeps.readMediaRange = async () => override;
        const result = await w.tick();
        expect(result).toMatchObject({ outcome: 'failed', code });
        expect(w.copy).toMatchObject({ state: 'failed', failure_code: code, registration_attempts: 0 });
        expect(w.intent).toMatchObject({ state: 'failed', candidate_item_id: 'item1', last_error: code });
        expect(w.counts.createDoc).toBe(0);
      }
    });

    test('slot busy retries with 1, 5, 15, 60 minute backoff and the fifth attempt fails registration', async () => {
      const w = registering();
      w.slot = { token: 'someone-else', fence: 4, expiresAt: w.t + 3650 * DAY };
      const waits = [];
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const result = await w.tick();
        expect(result).toMatchObject({ outcome: 'registration_retry', code: 'post_presentation_slot_busy' });
        expect(w.copy.registration_attempts).toBe(attempt);
        waits.push((w.copy.next_attempt_at - w.t) / 60_000);
        expect(w.intent.state).toBe('uploaded');
        noLeases({ ...w, slot: { token: null } });
        expect((await w.tick()).outcome).toBe('idle'); // not due yet
        w.t = w.copy.next_attempt_at + 1;
      }
      expect(waits.map(Math.round)).toEqual([1, 5, 15, 60]);
      const last = await w.tick();
      expect(last).toMatchObject({ outcome: 'failed', code: 'zoom_video_registration_failed' });
      expect(w.copy).toMatchObject({ state: 'failed', registration_attempts: 5 });
      expect(w.counts.createDoc).toBe(0);
    });

    test('Dataverse 5xx, a timeout and a non-ServiceHttpError retry; an unrecognised 4xx is terminal with its sanitized code', async () => {
      for (const thrown of [Object.assign(new Error('boom'), { status: 503 }), new Error('socket hang up'), err('post_presentation_create_unconfirmed', 502)]) {
        const w = registering();
        w.materialDeps.createDocument = async () => { throw thrown; };
        const result = await w.tick();
        expect(result.outcome).toBe('registration_retry');
        expect(w.copy).toMatchObject({ state: 'registering', registration_attempts: 1 });
      }
      const w = registering();
      w.materialDeps.createDocument = async () => { throw err('some_new_rejection', 422); };
      expect(await w.tick()).toMatchObject({ outcome: 'failed', code: 'some_new_rejection' });
      const odd = registering();
      odd.materialDeps.createDocument = async () => { throw err('Not A Code!', 422); };
      expect(await odd.tick()).toMatchObject({ outcome: 'failed', code: 'zoom_video_registration_rejected' });
    });

    test('generation ambiguity, replay mismatch and a changed Site Visit are terminal even at HTTP 500', async () => {
      const ambiguous = registering();
      ambiguous.docs.push(ambiguous.registeredDoc(), { ...ambiguous.registeredDoc(), wmkf_requestdocumentid: 'dup' });
      expect(await ambiguous.tick()).toMatchObject({ outcome: 'failed', code: 'post_presentation_generation_ambiguous' });
      const mismatch = registering();
      mismatch.registeredDoc({ wmkf_inputfingerprint: 'different' });
      expect(await mismatch.tick()).toMatchObject({ outcome: 'failed', code: 'post_presentation_replay_mismatch' });
      const moved = registering();
      moved.intent.site_visit_id = 'old-visit';
      expect(await moved.tick()).toMatchObject({ outcome: 'failed', code: 'post_presentation_site_visit_changed' });
      for (const w of [ambiguous, mismatch, moved]) expect(w.counts.createDoc).toBe(0);
    });

    test('visit unbound, ambiguous visits and a missing cycle pause instead of failing or counting', async () => {
      for (const [setup, code] of [
        [w => { w.visit = 'none'; }, 'post_presentation_site_visit_required'],
        [w => { w.visit = 'two'; }, 'post_presentation_site_visit_ambiguous'],
        [w => { w.materialDeps.getRequest = async () => ({ akoya_requestid: REQ, akoya_requestnum: '1001', wmkf_meetingdate: null }); }, 'post_presentation_cycle_required'],
      ]) {
        const w = registering();
        setup(w);
        const result = await w.tick();
        expect(result).toMatchObject({ outcome: 'paused', code });
        expect(w.copy).toMatchObject({ state: 'registering', registration_attempts: 0, failure_code: null });
        expect(w.intent.state).toBe('uploaded');
        noLeases(w);
      }
    });
  });
});

describe('receipt repair (N5)', () => {
  test('a finalized intent on a registering copy is repaired with the tick token and never finalized again', async () => {
    const w = registering();
    Object.assign(w.intent, { state: 'finalized', request_document_id: 'doc-existing', upload_url_ciphertext: null });
    const result = await w.tick({}, { reconcileFinalized: async () => {} });
    expect(result.outcome).toBe('copied');
    expect(w.counts.claimFinalize).toBe(0);
    expect(w.counts.createDoc).toBe(0);
    expect(w.copy).toMatchObject({ state: 'copied', request_document_id: 'doc-existing' });
  });

  test('reconcile-finalized repairs queued, copying, registering and failed rows even with the kill switch off', async () => {
    for (const state of ['queued', 'copying', 'registering', 'failed']) {
      const w = makeWorld({ size: 100, copyState: state });
      w.seedRegistering();
      w.copy.state = state;
      if (state === 'failed') w.copy.failure_code = 'zoom_video_registration_failed';
      Object.assign(w.intent, { state: 'finalized', request_document_id: 'doc-existing' });
      w.access = { valid: true, mode: 'off', requestId: null };
      expect(await w.tick()).toEqual({ outcome: 'access_off' });
      expect(w.copy).toMatchObject({ state: 'copied', request_document_id: 'doc-existing', failure_code: null });
      expect(w.counts.claim).toBe(0);
    }
  });

  test('a live copy lease blocks reconcile; an expired one does not', async () => {
    const w = registering();
    Object.assign(w.intent, { state: 'finalized', request_document_id: 'doc-existing' });
    Object.assign(w.copy, { lease_token: 'live-tick', lease_expires_at: w.t + 100_000 });
    expect((await reconcileFinalizedCopies(w.deps)).repaired).toBe(0);
    expect(w.copy.state).toBe('registering');
    w.t += 200_000;
    expect((await reconcileFinalizedCopies(w.deps)).repaired).toBe(1);
    expect(w.copy.state).toBe('copied');
  });

  test('N5 receipt conflict: the finalized intent is kept, an alert is raised and the copy never overwrites the other row', async () => {
    const w = registering();
    Object.assign(w.intent, { state: 'finalized', request_document_id: 'doc-existing' });
    w.copiedElsewhere = true;
    const result = await w.tick({}, { reconcileFinalized: async () => {} });
    expect(result).toMatchObject({ outcome: 'failed', code: 'zoom_video_receipt_conflict' });
    expect(w.events.map(e => e.eventType)).toContain('zoom_video_receipt_conflict');
    expect(w.intent).toMatchObject({ state: 'finalized', request_document_id: 'doc-existing' });
    expect(w.copy.state).toBe('failed');
    // the conflict is recorded, so the reconcile path never lists, retries or re-alerts on this row
    w.events.length = 0;
    expect((await reconcileFinalizedCopies(w.deps)).repaired).toBe(0);
    expect(w.events).toEqual([]);
    expect(w.copy).toMatchObject({ state: 'failed', failure_code: 'zoom_video_receipt_conflict' });
  });

  test('a copy that failed for another reason and then meets a receipt conflict records it once and leaves N5a', async () => {
    const w = registering();
    Object.assign(w.copy, { state: 'failed', failure_code: 'zoom_video_registration_failed', lease_token: null, lease_expires_at: null });
    Object.assign(w.intent, { state: 'finalized', request_document_id: 'doc-existing' });
    w.copiedElsewhere = true;
    await reconcileFinalizedCopies(w.deps);
    expect(w.copy).toMatchObject({ state: 'failed', failure_code: 'zoom_video_receipt_conflict' });
    expect(w.intent).toMatchObject({ state: 'finalized', request_document_id: 'doc-existing' });
    expect(w.counts.receiptConflicts).toBe(1);
    // repeated ticks: the row is gone from N5a, so no retry and no repeated alert
    w.events.length = 0;
    for (let i = 0; i < 3; i += 1) await reconcileFinalizedCopies(w.deps);
    expect(w.events).toEqual([]);
    expect(w.counts.receiptConflicts).toBe(1);
  });
});

describe('rejected candidate', () => {
  const rejected = (w, code = 'post_presentation_mp4_signature_invalid') => {
    Object.assign(w.intent, { state: 'failed', last_error: code });
  };

  test('is a copy-only failure with the mapped code: identities kept, intent not bound, no Dataverse or Graph call', async () => {
    const w = registering();
    rejected(w);
    const result = await w.tick();
    expect(result).toMatchObject({ outcome: 'failed', code: 'post_presentation_mp4_signature_invalid' });
    expect(w.copy).toMatchObject({ state: 'failed', sharepoint_item_id: 'item1', sharepoint_drive_id: 'drive1' });
    expect(w.intent).toMatchObject({ state: 'failed', candidate_item_id: 'item1' });
    expect(w.counts).toMatchObject({ createDoc: 0, claimFinalize: 0, bind: 0 });
    noLeases(w);
  });

  test('past intent expiry (crash between the terminal release and the copy write) it is still the copy-only failure, never bound', async () => {
    const w = registering();
    w.docs.push(w.registeredDoc()); // even if a document exists, a rejected candidate is never converted to a valid upload
    rejected(w);
    w.intent.intent_expires_at = w.t - 1;
    const result = await w.tick();
    expect(result).toMatchObject({ outcome: 'failed', code: 'post_presentation_mp4_signature_invalid' });
    expect(w.intent).toMatchObject({ state: 'failed', request_document_id: null });
    expect(w.counts.inspect).toBe(0);
    expect(w.counts.bind).toBe(0);
    expect(w.copy.state).toBe('failed'); // frees the request's active-copy lock
  });

  test('an unrecognisable last_error maps to zoom_video_registration_rejected', async () => {
    const w = registering();
    rejected(w, 'Weird Text');
    expect((await w.tick()).code).toBe('zoom_video_registration_rejected');
  });

  test('another live intent lease defers it (cleanup wins)', async () => {
    const w = registering();
    rejected(w);
    Object.assign(w.intent, { lease_token: 'cleanup', lease_expires_at: w.t + 100_000 });
    expect((await w.tick()).outcome).toBe('deferred_intent_lease');
    expect(w.copy.state).toBe('registering');
  });
});

describe('exact-registration reconciliation for expired and abandoned intents', () => {
  const expired = w => { w.intent.intent_expires_at = w.t - 1; return w; };

  test('expired with the registration present binds the receipt through I5 and N5 with no create', async () => {
    const w = expired(registering());
    const existing = w.registeredDoc();
    const result = await w.tick();
    expect(result.outcome).toBe('copied');
    expect(w.counts).toMatchObject({ createDoc: 0, claimFinalize: 0, bind: 1, copied: 1 });
    expect(w.intent).toMatchObject({ state: 'finalized', request_document_id: existing.wmkf_requestdocumentid });
    expect(w.copy).toMatchObject({ state: 'copied', request_document_id: existing.wmkf_requestdocumentid });
    noLeases(w);
  });

  test('expired with a successful read that finds nothing fails the copy zoom_video_intent_expired, identities preserved', async () => {
    const w = expired(registering());
    const result = await w.tick();
    expect(result).toMatchObject({ outcome: 'failed', code: 'zoom_video_intent_expired' });
    expect(w.copy).toMatchObject({ state: 'failed', sharepoint_item_id: 'item1' });
    expect(w.intent).toMatchObject({ state: 'uploaded', candidate_item_id: 'item1' });
    expect(w.counts.createDoc).toBe(0);
    noLeases(w);
  });

  test('a failed read, an ambiguous result and a mismatch retain, back off and alert; nothing is failed or bound', async () => {
    const cases = [
      ['read failed', w => { w.dvDown = true; }, 'registration_read_failed'],
      ['ambiguous', w => { w.registeredDoc(); w.docs.push({ ...w.docs.at(-1), wmkf_requestdocumentid: 'dup' }); }, 'registration_ambiguous'],
      ['mismatch', w => { w.registeredDoc({ wmkf_filesize: 7 }); }, 'registration_mismatch'],
      ['path partial', w => { w.registeredDoc(); w.graph.hideItem = true; }, 'path_not_complete'],
    ];
    for (const [label, setup, reason] of cases) {
      const w = expired(registering());
      setup(w);
      const result = await w.tick();
      expect([label, result.outcome, result.code]).toEqual([label, 'receipt_uncertain', reason]);
      expect(w.copy).toMatchObject({ state: 'registering', registration_attempts: 1, failure_code: null });
      expect(w.copy.next_attempt_at).toBeGreaterThan(w.t);
      expect(w.intent.state).toBe('uploaded');
      expect(w.events.map(e => e.eventType)).toContain('zoom_video_receipt_inspection_uncertain');
      expect(w.counts).toMatchObject({ bind: 0, createDoc: 0 });
      noLeases(w);
    }
  });

  test('a queued or copying copy with an expired intent backs off on the uncertain counter, then fails at its cap', async () => {
    const w = makeWorld({ size: 25, copyState: 'queued' });
    w.intent.intent_expires_at = w.t - 1;
    w.dvDown = true;
    for (let i = 1; i <= 2; i += 1) {
      expect((await w.tick()).outcome).toBe('receipt_uncertain');
      expect(w.copy.uncertain_checks).toBe(i);
      w.t = w.copy.next_attempt_at + 1;
    }
    expect(await w.tick()).toMatchObject({ outcome: 'failed', code: 'zoom_video_upload_uncertain' });
  });

  test('an I4 lease held elsewhere defers; the registration is not guessed', async () => {
    const w = expired(registering());
    const original = w.deps.claimInspection;
    w.deps.claimInspection = async () => null;
    expect((await w.tick()).outcome).toBe('deferred_intent_lease');
    w.deps.claimInspection = original;
    expect(w.copy.state).toBe('registering');
  });

  test('abandoned by a source failure and crashed before the copy write: a proven absence keeps the source code', async () => {
    const w = makeWorld({ size: 25, copyState: 'queued' });
    Object.assign(w.intent, { state: 'abandoned', last_error: 'zoom_recording_changed' });
    expect(await w.tick()).toMatchObject({ outcome: 'failed', code: 'zoom_recording_changed' });
    const other = makeWorld({ size: 25, copyState: 'queued' });
    Object.assign(other.intent, { state: 'abandoned', last_error: 'cleanup_abandoned' });
    expect(await other.tick()).toMatchObject({ outcome: 'failed', code: 'zoom_video_intent_abandoned' });
  });

  test('abandoned with a registered document binds it (the document wins over the abandonment)', async () => {
    const w = registering();
    Object.assign(w.intent, { state: 'abandoned', last_error: 'cleanup_abandoned', candidate_item_id: null, candidate_drive_id: null, candidate_site_id: null, candidate_size: null });
    Object.assign(w.copy, { state: 'queued', sharepoint_drive_id: null, sharepoint_item_id: null });
    w.registeredDoc();
    expect((await w.tick()).outcome).toBe('copied');
    expect(w.intent.state).toBe('finalized');
  });

  test('staff-cancelled abandonment with a candidate is an invalid tuple, never inspected', async () => {
    const w = registering();
    Object.assign(w.intent, { state: 'abandoned', last_error: 'staff_cancelled', upload_url_ciphertext: null });
    expect(await w.tick()).toMatchObject({ outcome: 'failed', code: 'zoom_video_state_invalid' });
    expect(w.counts.inspect).toBe(0);
  });
});

describe('failed-copy receipt inspection', () => {
  const failedCopy = w => {
    Object.assign(w.copy, { state: 'failed', failure_code: 'zoom_video_registration_failed', lease_token: null, lease_expires_at: null });
    return w;
  };

  test('a failed copy whose recording was registered is repaired through I5 and N5 with the null-token fence', async () => {
    const w = failedCopy(registering());
    const existing = w.registeredDoc();
    expect((await w.tick()).outcome).toBe('idle');
    expect(w.copy).toMatchObject({ state: 'copied', request_document_id: existing.wmkf_requestdocumentid });
    expect(w.intent.state).toBe('finalized');
    expect(w.counts.createDoc).toBe(0);
  });

  test('absence leaves the failed copy alone and it is selected again only when due', async () => {
    const w = failedCopy(registering());
    await w.tick();
    expect(w.copy.state).toBe('failed');
    expect(w.failedDueLog).toHaveLength(1);
    await w.tick();
    expect(w.failedDueLog).toHaveLength(1);
    w.t += 11 * 60_000;
    await w.tick();
    expect(w.failedDueLog).toHaveLength(2);
    expect(w.counts.createDoc).toBe(0);
  });

  test('runs only when access allows: off skips it, test:<other> restricts the selector', async () => {
    const off = failedCopy(registering());
    off.registeredDoc();
    off.access = { valid: true, mode: 'off', requestId: null };
    await off.tick();
    expect(off.copy.state).toBe('failed');
    const scoped = failedCopy(registering());
    scoped.registeredDoc();
    scoped.access = { valid: true, mode: 'test', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    let seen = null;
    await scoped.tick({}, { claimFailedDue: async args => { seen = args; return []; } });
    expect(seen.accessRequestId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(scoped.copy.state).toBe('failed');
  });

  test('an uncertain read alerts and the receipt is retained', async () => {
    const w = failedCopy(registering());
    w.dvDown = true;
    await w.tick();
    expect(w.copy.state).toBe('failed');
    expect(w.events.map(e => e.eventType)).toContain('zoom_video_receipt_inspection_uncertain');
    noLeases(w);
  });

  test('a duplicate copied-file receipt keeps the finalized intent and alerts', async () => {
    const w = failedCopy(registering());
    w.registeredDoc();
    w.copiedElsewhere = true;
    await w.tick();
    expect(w.intent.state).toBe('finalized');
    expect(w.events.map(e => e.eventType)).toContain('zoom_video_receipt_conflict');
    expect(w.copy).toMatchObject({ state: 'failed', failure_code: 'zoom_video_receipt_conflict' });
    expect(await w.deps.listFinalizedCopies()).toEqual([]);
  });
});

describe('Zoom configuration faults (ruling 21)', () => {
  for (const code of ['zoom_auth_failed', 'zoom_scope_missing', 'zoom_not_configured']) {
    test(`${code} defers 15 minutes, uncounted, with one alert; the copy is not failed`, async () => {
      const w = makeWorld({ size: 25 });
      const result = await w.tick({}, { getMeetingRecordings: async () => { throw new ZoomClientError(code); } });
      expect(result).toMatchObject({ outcome: 'config_deferred', code });
      expect(w.copy).toMatchObject({ state: 'queued', session_create_attempts: 0, uncertain_checks: 0, registration_attempts: 0, failure_code: null });
      expect(w.copy.next_attempt_at).toBe(w.t + 15 * 60_000);
      expect(w.copy.lease_token).toBeNull();
      expect(w.intent.lease_token).toBeNull();
      expect(w.events.filter(e => e.eventType === 'zoom_video_config_error')).toHaveLength(1);
      expect(JSON.stringify(w.events)).not.toContain('SECRET');
      expect((await w.tick()).outcome).toBe('idle'); // claim honors next_attempt_at
      w.t += 15 * 60_000 + 1;
      expect((await w.tick()).outcome).toBe('registering'); // due again: the copy proceeds
    });
  }

  test('an auth fault while the access token is fetched mid-pump defers too', async () => {
    const w = makeWorld({ size: 25 });
    const result = await w.tick({}, { getAccessToken: async () => { throw new ZoomClientError('zoom_auth_failed'); } });
    expect(result.outcome).toBe('config_deferred');
    expect(w.copy.state).toBe('copying');
  });

  test('a rate limit or outage is still a plain transient, not a configuration fault', async () => {
    const w = makeWorld({ size: 25 });
    const result = await w.tick({}, { getMeetingRecordings: async () => { throw new ZoomClientError('zoom_unavailable'); } });
    expect(result.outcome).toBe('transient');
    expect(w.copy.next_attempt_at).toBeNull();
    expect(w.events).toHaveLength(0);
  });
});

describe('crash injection: process death at every durable step, then a replay converges', () => {
  const MAX_REPLAYS = 4;
  const printMatrix = (label, rows) => {
    if (process.env.S6_PRINT_MATRIX) process.stdout.write(`${label}\n${rows.map(r => r.join(' | ')).join('\n')}\n`);
  };
  const terminal = w => ['copied', 'failed', 'cancelled'].includes(w.copy.state);

  async function crashMatrix({ build, assertConverged, settled = terminal }) {
    const clean = build().instrument();
    await clean.tick();
    const points = clean.trace.length;
    expect(points).toBeGreaterThan(8);
    const rows = [];
    for (let index = 1; index <= points; index += 1) {
      for (const when of ['before', 'after']) {
        const w = build().instrument();
        w.crashAt = index;
        w.crashWhen = when;
        await w.tick().catch(error => { if (!error.crash) throw error; });
        expect(w.dead).toBe(true);
        const stateAtDeath = `${w.copy.state}/${w.intent.state}`;
        let replays = 0;
        while (!settled(w) && replays < MAX_REPLAYS) {
          w.revive();
          await w.tick();
          replays += 1;
        }
        rows.push([`${w.trace[index - 1]} ${when}`, stateAtDeath, `${w.copy.state}/${w.intent.state}`, replays]);
        try {
          assertConverged(w);
        } catch (error) {
          error.message = `crash ${when} call #${index} (${w.trace[index - 1]}): ${error.message}`;
          throw error;
        }
      }
    }
    return rows;
  }

  const converged = w => {
    expect(w.copy.state).toBe('copied');
    expect(w.intent.state).toBe('finalized');
    expect(docsFor(w)).toHaveLength(1);
    expect(w.counts.createDoc).toBeLessThanOrEqual(1);
    expect(w.copy.request_document_id).toBe(docsFor(w)[0].wmkf_requestdocumentid);
    expect(w.intent.request_document_id).toBe(w.copy.request_document_id);
    expect(w.docs.filter(d => d.wmkf_requestdocumentid !== 'link-1' && d.wmkf_generationkey !== w.intent.generation_key)).toHaveLength(0);
    expect(w.copy.lease_token).toBeNull();
  };

  test('finalize hand-off: a crash before or after every dependency call replays to exactly one Request Document and a copied copy', async () => {
    const rows = await crashMatrix({
      build: () => { const w = registering(); w.docs.push(w.zoomLinkDoc()); return w; },
      assertConverged: w => {
        converged(w);
        const link = w.docs.find(d => d.wmkf_requestdocumentid === 'link-1');
        expect(link.wmkf_lifecyclestate).not.toBe(docsFor(w)[0].wmkf_lifecyclestate);
      },
    });
    printMatrix('hand-off', rows);
    // the matrix reached every write the hand-off makes
    const names = new Set(rows.map(r => r[0].split(' ')[0]));
    for (const name of ['claimFinalize', 'renewIntentFinalize', 'dv.recordUploadCandidate', 'dv.acquireSlotLease', 'dv.createDocument', 'dv.updateDocument', 'dv.completeUploadIntent', 'dv.releaseSlotLease', 'markCopied']) {
      expect(names).toContain(name);
    }
  });

  test('receipt recovery of an expired intent: a crash at every step binds the registered document once and never creates', async () => {
    const rows = await crashMatrix({
      build: () => { const w = registering(); w.intent.intent_expires_at = w.t - 1; w.registeredDoc(); return w; },
      assertConverged: w => {
        expect(w.copy.state).toBe('copied');
        expect(w.intent).toMatchObject({ state: 'finalized', request_document_id: 'doc-existing' });
        expect(w.copy.request_document_id).toBe('doc-existing');
        expect(w.counts.createDoc).toBe(0);
        expect(w.docs).toHaveLength(1);
      },
    });
    printMatrix('recovery', rows);
    const names = new Set(rows.map(r => r[0].split(' ')[0]));
    for (const name of ['claimInspection', 'renewInspection', 'dv.findDocumentByGenerationKey', 'getFileMetadataByPath', 'bindReceipt', 'releaseInspection', 'markCopied']) {
      expect(names).toContain(name);
    }
  });

  test('failed-copy inspection: a crash at every step still ends with one bound receipt and no create', async () => {
    await crashMatrix({
      build: () => {
        const w = registering();
        Object.assign(w.copy, { state: 'failed', failure_code: 'zoom_video_registration_failed', lease_token: null, lease_expires_at: null });
        w.registeredDoc();
        return w;
      },
      settled: w => w.copy.state === 'copied',
      assertConverged: w => {
        expect(w.copy.state).toBe('copied');
        expect(w.intent.state).toBe('finalized');
        expect(w.counts.createDoc).toBe(0);
      },
    });
  });

  test('a rejected candidate whose terminal release landed but whose copy write did not: replay past expiry fails the copy only', async () => {
    const w = registering();
    w.materialDeps.readMediaRange = async () => ({ bytes: Buffer.alloc(32), mimeType: 'video/mp4', malware: null });
    w.instrument();
    // kill the process right after the terminal intent release
    const clean = registering();
    clean.materialDeps.readMediaRange = w.materialDeps.readMediaRange;
    clean.instrument();
    await clean.tick();
    const releaseIndex = clean.trace.indexOf('releaseIntentFinalize') + 1;
    expect(releaseIndex).toBeGreaterThan(0);
    const dying = registering();
    dying.materialDeps.readMediaRange = async () => ({ bytes: Buffer.alloc(32), mimeType: 'video/mp4', malware: null });
    dying.instrument();
    dying.crashAt = releaseIndex;
    await dying.tick();
    expect(dying.dead).toBe(true);
    expect(dying.copy.state).toBe('registering');
    expect(dying.intent).toMatchObject({ state: 'failed', candidate_item_id: 'item1' });
    dying.revive(4 * DAY);
    expect(dying.intent.intent_expires_at).toBeLessThan(dying.t);
    const result = await dying.tick();
    expect(result).toMatchObject({ outcome: 'failed', code: 'post_presentation_mp4_signature_invalid' });
    expect(dying.copy).toMatchObject({ state: 'failed', sharepoint_item_id: 'item1' });
    expect(dying.intent).toMatchObject({ state: 'failed', request_document_id: null });
    expect(dying.counts.bind).toBe(0);
  });
});

describe('hygiene', () => {
  test('logs and alerts carry no URL, token, email or message', async () => {
    const w = registering();
    w.materialDeps.createDocument = async () => { throw Object.assign(new Error('boom https://x.example/?sig=SECRETSIG Bearer ZOOMTOKENSECRET host@example.org'), { status: 503 }); };
    await w.tick();
    const text = logText(w) + JSON.stringify(w.events) + JSON.stringify(w.matEvents);
    for (const secret of ['SECRETSIG', 'ZOOMTOKENSECRET', 'host@example.org', 'https://']) expect(text).not.toContain(secret);
    expect(ID).toBeTruthy();
  });
});
