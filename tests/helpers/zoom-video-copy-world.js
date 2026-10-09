/**
 * Shared in-memory world for the Zoom video copy worker tests (Stage 3b S5/S6). Not a test file.
 * The caller registers the jest.mock calls for '@vercel/postgres' and import-service before importing this.
 */
import { hashZoomHostEmail } from '../../lib/services/meeting-tracker-recordings/video-copy-store.js';
import { runZoomVideoCopyTick } from '../../lib/services/meeting-tracker-recordings/video-copy-worker.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

export const ID = '11111111-1111-4111-8111-111111111111';
export const REQ = '22222222-2222-4222-8222-222222222222';
export const OTHER_REQ = '99999999-9999-4999-8999-999999999999';
export const ACTOR = '33333333-3333-4333-8333-333333333333';
export const HOST = 'host@example.org';
export const CHUNK = 10;
export const SECRETS = ['ZOOMTOKENSECRET', 'SECRETDL', 'SECRETSIG', 'tempauth=', 'Bearer', 'https://', HOST, '@'];
export const VISIT = '77777777-7777-4777-8777-777777777777';
export const ZOOM_LINK = 'https://us02web.zoom.us/rec/share/abc';

/**
 * In-memory copy store, intent store, Graph and Zoom that enforce the real predicates (live token, state,
 * candidate, lease clearing on recovery-session writes), so a skipped renewal or reacquire really fails.
 */
export function makeWorld({ size = 25, copyState = 'queued' } = {}) {
  const w = {
    t: 1_000_000, logs: [], events: [], hosts: [HOST], allowed: true,
    access: { valid: true, mode: 'on', requestId: null },
    ms: { list: 500, resolve: 500, get: 500, put: 500 },
    counts: { claim: 0, claimPump: 0, create: 0, put: 0, del: 0, list: 0, resolve: 0, get: 0, intentRenew: 0, reconcile: 0 },
    puts: [], sleeps: [], remainingAtGet: [], maxBuffered: 0, denyNext: [], getAccessArgs: [], rangeArgs: [],
    graph: { sessions: new Map(), item: null, hideItem: false, partialItem: null, lossStatus: 410, cancelOutcome: 'cancelled', nextUrl: 1 },
    hooks: {}, failCreate: false, putError: null,
  };
  const iso = ms => new Date(ms).toISOString();
  w.detail = () => ({
    host_id: 'host1',
    recording_files: [{
      id: 'file1', status: 'completed', file_extension: 'MP4', recording_type: 'shared_screen_with_speaker_view',
      file_size: size, download_url: 'https://zoom.us/rec/download/SECRETDL',
    }],
  });
  w.copy = {
    id: ID, upload_id: ID, request_id: REQ, state: copyState, lease_token: null, lease_expires_at: 0, next_attempt_at: null,
    cancel_requested_at: null, declared_size: size, bytes_confirmed: 0, session_create_attempts: 0, session_restarts: 0,
    uncertain_checks: 0, registration_attempts: 0, zoom_meeting_uuid: 'm==', zoom_host_id: 'host1',
    zoom_host_email_sha256: hashZoomHostEmail(HOST), zoom_file_id: 'file1',
    zoom_recording_type: 'shared_screen_with_speaker_view', sharepoint_drive_id: null, sharepoint_item_id: null, failure_code: null,
  };
  w.intent = {
    id: ID, origin: 'zoom_copy', state: 'initiated', upload_url_ciphertext: null, lease_token: null, lease_expires_at: 0,
    candidate_item_id: null, candidate_drive_id: null, candidate_site_id: null, candidate_size: null, last_error: null,
    request_id: REQ, actor_id: ACTOR, library_name: 'Lib', folder_path: 'Folder/Post', physical_filename: '1001-Recording.mp4',
    declared_size: size, intent_expires_at: w.t + 3 * 86_400_000, upload_session_expires_at: null,
  };
  const live = (row, token) => token && row.lease_token === token && row.lease_expires_at > w.t;
  const free = row => !row.lease_token || row.lease_expires_at <= w.t;
  const bumpCopy = () => { w.copy.lease_expires_at = w.t + 600_000; };
  const bumpIntent = () => { w.intent.lease_expires_at = w.t + 300_000; };
  const endCopy = (state, patch = {}) => Object.assign(w.copy, { state, lease_token: null, lease_expires_at: null, next_attempt_at: null }, patch);

  const copyReturn = () => ({ ...w.copy });
  const snapshot = () => ({
    ...w.copy,
    intent_state: w.intent.state, intent_origin: w.intent.origin, intent_last_error: w.intent.last_error,
    intent_has_ciphertext: Boolean(w.intent.upload_url_ciphertext), intent_expires_at: w.intent.intent_expires_at,
    intent_expired: w.intent.intent_expires_at <= w.t, intent_lease_live: Boolean(w.intent.lease_token && w.intent.lease_expires_at > w.t),
    candidate_item_id: w.intent.candidate_item_id, candidate_drive_id: w.intent.candidate_drive_id,
    candidate_site_id: w.intent.candidate_site_id,
  });
  const cap = (field, code) => {
    if (w.copy[field] + 1 > 3) throw new Error('CHECK violated: counter above cap');
    w.copy[field] += 1;
    if (w.copy[field] < 3) return false;
    endCopy('failed', { failure_code: code });
    return true;
  };

  const graphError = (status, message = 'graph failed https://graph.example/up?tempauth=SECRETSIG Bearer ZOOMTOKENSECRET') =>
    Object.assign(new Error(message), { status });
  const item = () => w.graph.item;

  w.deps = {
    chunkBytes: CHUNK,
    now: () => w.t,
    sleep: async ms => { w.sleeps.push(ms); w.t += ms; },
    log: line => w.logs.push(line),
    recordEvent: async event => { w.events.push(event); },
    access: () => w.access,
    requestAllowed: () => w.allowed,
    readConfig: () => ({ available: true, hosts: w.hosts }),
    reconcileFinalized: async () => { w.counts.reconcile += 1; },
    sealUploadUrl: url => `sealed:${url}`,
    openUploadUrl: cipher => { if (!String(cipher).startsWith('sealed:')) throw new Error('bad cipher'); return cipher.slice(7); },

    claimCopy: async ({ accessRequestId = null } = {}) => {
      w.counts.claim += 1;
      w.lastClaimAccess = accessRequestId;
      const c = w.copy;
      if (!['queued', 'copying', 'registering'].includes(c.state) || !free(c)) return null;
      if (c.next_attempt_at && c.next_attempt_at > w.t) return null;
      if (accessRequestId && accessRequestId !== c.request_id) return null;
      c.lease_token = `copy-${w.counts.claim}`; bumpCopy();
      return { row: copyReturn(), leaseToken: c.lease_token };
    },
    getSnapshot: async () => snapshot(),
    renewCopyLease: async ({ leaseToken, states }) => {
      if (!live(w.copy, leaseToken) || !states.includes(w.copy.state)) return null;
      bumpCopy();
      return { state: w.copy.state, cancel_requested_at: w.copy.cancel_requested_at };
    },
    releaseCopyLease: async ({ leaseToken }) => {
      if (w.copy.lease_token !== leaseToken) return null;
      Object.assign(w.copy, { lease_token: null, lease_expires_at: null });
      return copyReturn();
    },
    markCopying: async ({ leaseToken }) => {
      if (!live(w.copy, leaseToken) || w.copy.state !== 'queued') return null;
      w.copy.state = 'copying'; return copyReturn();
    },
    recordProgress: async ({ leaseToken, bytesConfirmed }) => {
      if (!live(w.copy, leaseToken) || w.copy.state !== 'copying') return null;
      w.copy.bytes_confirmed = Math.min(bytesConfirmed, w.copy.declared_size); return copyReturn();
    },
    recordCreateFailure: async ({ leaseToken, retryAfterSeconds }) => {
      if (!live(w.copy, leaseToken) || w.copy.state !== 'queued') return null;
      if (!cap('session_create_attempts', 'zoom_video_session_create_failed')) w.copy.next_attempt_at = w.t + retryAfterSeconds * 1000;
      return copyReturn();
    },
    recordRestart: async ({ leaseToken }) => {
      if (!live(w.copy, leaseToken) || !['queued', 'copying'].includes(w.copy.state)) return null;
      w.copy.bytes_confirmed = 0;
      cap('session_restarts', 'zoom_video_session_expired');
      return copyReturn();
    },
    recordUncertainCheck: async ({ leaseToken, retryAfterSeconds, capFailureCode }) => {
      if (!live(w.copy, leaseToken) || !['queued', 'copying'].includes(w.copy.state)) return null;
      if (!cap('uncertain_checks', capFailureCode)) w.copy.next_attempt_at = w.t + retryAfterSeconds * 1000;
      return copyReturn();
    },
    markRegistering: async ({ leaseToken, driveId, itemId }) => {
      if (!live(w.copy, leaseToken) || !['queued', 'copying'].includes(w.copy.state)) return null;
      Object.assign(w.copy, { state: 'registering', sharepoint_drive_id: driveId, sharepoint_item_id: itemId, bytes_confirmed: w.copy.declared_size });
      return copyReturn();
    },
    failCopy: async ({ leaseToken, failureCode }) => {
      if (!live(w.copy, leaseToken) || !['queued', 'copying', 'registering'].includes(w.copy.state)) return null;
      endCopy('failed', { failure_code: failureCode }); return copyReturn();
    },
    cancelCopy: async ({ leaseToken, driveId = null, itemId = null }) => {
      if (!live(w.copy, leaseToken) || !['queued', 'copying', 'registering'].includes(w.copy.state)) return null;
      endCopy('cancelled', { sharepoint_drive_id: driveId, sharepoint_item_id: itemId }); return copyReturn();
    },

    claimPump: async () => {
      w.counts.claimPump += 1;
      const u = w.intent;
      if (!['initiated', 'failed'].includes(u.state) || u.candidate_item_id || !free(u) || u.intent_expires_at <= w.t) return null;
      u.lease_token = `intent-${w.counts.claimPump}`; bumpIntent();
      return { row: { ...u }, leaseToken: u.lease_token };
    },
    recordIntentSession: async ({ leaseToken, uploadUrlCiphertext, expiresAt, intentExpiresAt }) => {
      const u = w.intent;
      if (w.hooks.i2Throw) { const mode = w.hooks.i2Throw; w.hooks.i2Throw = null; if (mode === 'applied') Object.assign(u, { upload_url_ciphertext: uploadUrlCiphertext }); throw new Error('db down'); }
      if (u.state !== 'initiated' || u.upload_url_ciphertext || u.candidate_item_id || !live(u, leaseToken)) return null;
      Object.assign(u, { upload_url_ciphertext: uploadUrlCiphertext, upload_session_expires_at: expiresAt, intent_expires_at: Date.parse(intentExpiresAt) });
      return { ...u };
    },
    renewIntentRecovery: async ({ leaseToken }) => {
      w.counts.intentRenew += 1;
      const u = w.intent;
      if (!live(u, leaseToken) || !['initiated', 'failed'].includes(u.state) || u.candidate_item_id) return null;
      bumpIntent(); return { ...u };
    },
    releaseIntentRecovery: async ({ leaseToken }) => {
      const u = w.intent;
      if (!live(u, leaseToken)) return null;
      Object.assign(u, { lease_token: null, lease_expires_at: null }); return { ...u };
    },
    markRecoveryTerminal: async ({ leaseToken }) => {
      const u = w.intent;
      if (!live(u, leaseToken) || !['initiated', 'failed'].includes(u.state) || u.candidate_item_id) return null;
      Object.assign(u, { state: 'failed', last_error: 'session_expired' }); return { ...u };
    },
    markRecoveryUncertain: async ({ leaseToken, lastError }) => {
      const u = w.intent;
      if (!live(u, leaseToken) || !['initiated', 'failed'].includes(u.state) || u.candidate_item_id) return null;
      Object.assign(u, { state: 'failed', last_error: lastError }); return { ...u };
    },
    cancelRecovery: async ({ leaseToken }) => {
      const u = w.intent;
      if (!live(u, leaseToken) || !['initiated', 'failed'].includes(u.state) || u.candidate_item_id) return null;
      Object.assign(u, { state: 'abandoned', upload_url_ciphertext: null, lease_token: null, lease_expires_at: null, last_error: 'staff_cancelled' });
      return { ...u };
    },
    abandonForSourceFailure: async ({ leaseToken, failureCode }) => {
      const u = w.intent;
      if (!live(u, leaseToken) || !['initiated', 'failed'].includes(u.state) || u.candidate_item_id) return null;
      Object.assign(u, { state: 'abandoned', upload_url_ciphertext: null, lease_token: null, lease_expires_at: null, last_error: failureCode });
      return { ...u };
    },
    recordRecoverySession: async ({ leaseToken, uploadUrlCiphertext, expiresAt, intentExpiresAt }) => {
      const u = w.intent;
      if (!live(u, leaseToken) || u.state !== 'failed' || u.candidate_item_id) return null;
      Object.assign(u, {
        state: 'initiated', upload_url_ciphertext: uploadUrlCiphertext, upload_session_expires_at: expiresAt,
        intent_expires_at: Date.parse(intentExpiresAt), lease_token: null, lease_expires_at: null, last_error: null,
      });
      return { ...u };
    },
    refreshUploadSession: async ({ requestId, actorId, leaseToken, uploadUrlCiphertext }) => {
      const u = w.intent;
      if (requestId !== u.request_id || actorId !== u.actor_id || !['initiated', 'uploaded'].includes(u.state)
        || u.upload_url_ciphertext !== uploadUrlCiphertext || !(free(u) || live(u, leaseToken))) return null;
      return { ...u };
    },
    recordUploadCandidate: async ({ requestId, actorId, candidate, leaseToken }) => {
      const u = w.intent;
      if (requestId !== u.request_id || actorId !== u.actor_id || !live(u, leaseToken) || ['finalized', 'abandoned'].includes(u.state)) return null;
      // The real token arm keeps `finalizing`, and keeps a rejected `failed` candidate failed.
      Object.assign(u, { state: u.state === 'finalizing' ? 'finalizing' : (u.state === 'failed' && u.candidate_item_id) ? 'failed' : 'uploaded', candidate_version_id: candidate.versionId, candidate_etag: candidate.eTag, candidate_item_id: candidate.itemId, candidate_drive_id: candidate.driveId, candidate_site_id: candidate.siteId, candidate_size: candidate.size });
      return { ...u };
    },

    getMeetingRecordings: async () => { w.counts.list += 1; w.t += w.ms.list; return w.detail(); },
    getAccessToken: async () => 'ZOOMTOKENSECRET',
    resolveRecordingDownloadUrl: async (downloadUrl, args) => {
      w.counts.resolve += 1; w.t += w.ms.resolve; w.getAccessArgs.push(args);
      return `https://ssrweb.zoom.us/resolved?sig=SECRETSIG${w.counts.resolve}`;
    },
    fetchRecordingRange: async (url, args) => {
      w.counts.get += 1; w.rangeArgs.push({ url, args });
      w.remainingAtGet.push(args.deadlineMs - w.t);
      w.t += w.ms.get;
      if (w.hooks.afterGet) w.hooks.afterGet(w.counts.get);
      const denied = w.denyNext.shift();
      if (denied) return { bytes: null, status: denied };
      const bytes = Buffer.alloc(args.end - args.start + 1, 7);
      w.maxBuffered = Math.max(w.maxBuffered, bytes.length);
      return { bytes, status: 206 };
    },

    createBrowserUploadSession: async () => {
      w.counts.create += 1;
      if (w.failCreate) throw graphError(503);
      const uploadUrl = `https://graph.example/up/${w.graph.nextUrl++}?tempauth=SECRETSIG`;
      w.graph.sessions.set(uploadUrl, { received: 0 });
      return { uploadUrl, expiresAt: iso(w.t + 3_600_000), nextExpectedRanges: ['0-'] };
    },
    getBrowserUploadSessionStatus: async url => {
      const s = w.graph.sessions.get(url);
      if (!s) throw graphError(w.graph.lossStatus);
      return { expiresAt: iso(w.t + 3_600_000), nextExpectedRanges: [`${s.received}-`] };
    },
    putUploadSessionChunk: async (url, { start, bytes, total }) => {
      w.counts.put += 1; w.t += w.ms.put;
      if (w.putError) throw graphError(w.putError);
      const s = w.graph.sessions.get(url);
      if (!s) throw graphError(w.graph.lossStatus);
      if (start !== s.received) throw graphError(416);
      s.received += bytes.length;
      w.puts.push({ start, length: bytes.length });
      if (w.hooks.afterPut) w.hooks.afterPut(w.puts.length, s.received === total);
      if (s.received === total) {
        w.graph.item = { id: 'item1', driveId: 'drive1', siteId: 'site1', name: w.intent.physical_filename, size: total, eTag: 'e1', versionId: '1', cTag: 'c1', webUrl: 'https://sp.example/x' };
        return { status: 201, nextExpectedRanges: [], expirationDateTime: iso(w.t + 3_000_000), item: w.graph.item };
      }
      return { status: 202, nextExpectedRanges: [`${s.received}-`], expirationDateTime: iso(w.t + 3_000_000), item: null };
    },
    cancelBrowserUploadSession: async url => {
      w.counts.del += 1; w.graph.sessions.delete(url);
      return { outcome: w.graph.cancelOutcome, status: 204 };
    },
    getFileMetadataByPath: async () => {
      if (w.graph.partialItem) return w.graph.partialItem;
      return item() && !w.graph.hideItem ? { ...item() } : null;
    },
    getFileMetadataById: async () => (item() ? { ...item() } : null),
  };
  // Seed an existing Graph session (and its sealed receipt on the intent) at a given received offset.
  w.seedSession = (received, { copy = 'copying' } = {}) => {
    const uploadUrl = `https://graph.example/up/${w.graph.nextUrl++}?tempauth=SECRETSIG`;
    w.graph.sessions.set(uploadUrl, { received });
    w.intent.upload_url_ciphertext = `sealed:${uploadUrl}`;
    w.copy.state = copy;
    return uploadUrl;
  };

  // ---- S6: registration, receipt repair and receipt inspection -------------------------------------------
  Object.assign(w.copy, { confirmed_winner_document_id: null, confirmed_winner_slot_version: null, request_document_id: null });
  Object.assign(w.intent, {
    generation_key: 'g'.repeat(64), client_resume_fingerprint: 'f'.repeat(64), site_visit_id: VISIT,
    candidate_version_id: null, candidate_etag: null, request_document_id: null,
  });
  Object.assign(w.counts, { claimFinalize: 0, createDoc: 0, updateDoc: 0, bind: 0, copied: 0, defer: 0, inspect: 0 });
  w.docs = [];
  w.visit = 'active';
  w.dvDown = false;
  w.matEvents = [];
  w.copiedElsewhere = false; // another copied row already owns the request/file (N5 uniqueness conflict)
  w.slot = { token: null, fence: 4, expiresAt: 0 }; // earlier documents carry lower fences
  w.nextDoc = 1;
  w.mime = 'video/mp4';
  w.failedDueLog = [];

  const intentExpired = () => w.intent.intent_expires_at <= w.t;
  const INSPECTABLE = ['initiated', 'uploaded', 'finalizing', 'failed', 'abandoned'];
  const REGISTRATION_BACKOFF = [60, 300, 900, 3600];

  const completeUploadIntent = async ({ leaseToken, requestDocumentId }) => {
    const u = w.intent;
    if (!live(u, leaseToken) || u.state !== 'finalizing' || !u.candidate_item_id) return null;
    Object.assign(u, {
      state: 'finalized', request_document_id: requestDocumentId, upload_url_ciphertext: null,
      lease_token: null, lease_expires_at: null, last_error: null,
    });
    return { ...u };
  };
  const renewIntentFinalize = async ({ leaseToken }) => {
    const u = w.intent;
    if (!live(u, leaseToken) || intentExpired() || u.state !== 'finalizing') return null;
    bumpIntent(); return { ...u };
  };

  Object.assign(w.deps, {
    reconcileFinalized: null, // the built-in reconcile runs unless a test injects its own
    claimFinalize: async () => {
      const u = w.intent;
      if (u.origin !== 'zoom_copy' || intentExpired() || !u.candidate_item_id || !free(u) || !['uploaded', 'finalizing'].includes(u.state)) return null;
      w.counts.claimFinalize += 1;
      Object.assign(u, { state: 'finalizing', lease_token: `fin-${w.counts.claimFinalize}` });
      bumpIntent();
      return { row: { ...u }, leaseToken: u.lease_token };
    },
    renewIntentFinalize,
    releaseIntentFinalize: async ({ leaseToken, lastError = null, terminal = false }) => {
      const u = w.intent;
      if (u.lease_token !== leaseToken || u.state !== 'finalizing') return null;
      Object.assign(u, {
        state: terminal && u.candidate_item_id ? 'failed' : u.candidate_item_id ? 'uploaded' : 'initiated',
        lease_token: null, lease_expires_at: null, last_error: lastError,
      });
      return { ...u };
    },
    claimInspection: async () => {
      w.counts.inspect += 1;
      const u = w.intent;
      if (u.origin !== 'zoom_copy' || !INSPECTABLE.includes(u.state) || !free(u)) return null;
      if (!(intentExpired() || w.copy.state === 'failed' || (u.state === 'abandoned' && u.last_error !== 'staff_cancelled'))) return null;
      u.lease_token = `inspect-${w.counts.inspect}`; bumpIntent();
      return { row: { ...u }, leaseToken: u.lease_token };
    },
    renewInspection: async ({ leaseToken }) => {
      const u = w.intent;
      if (!live(u, leaseToken) || !INSPECTABLE.includes(u.state)) return null;
      bumpIntent(); return { ...u };
    },
    releaseInspection: async ({ leaseToken }) => {
      const u = w.intent;
      if (u.lease_token !== leaseToken) return null;
      Object.assign(u, { lease_token: null, lease_expires_at: null }); return { ...u };
    },
    // Mirrors bindReceiptInTransaction's rechecks (the real function is proved against Postgres separately).
    bindReceipt: async ({ inspectionLeaseToken, copyLeaseToken = null, expected, verified }) => {
      w.counts.bind += 1;
      const u = w.intent; const c = verified.candidate;
      const reject = reason => ({ bound: false, reason });
      if (!live(u, inspectionLeaseToken)) return reject('inspection_lease_lost');
      if (!INSPECTABLE.includes(u.state) || u.state !== expected.state || u.generation_key !== expected.generationKey
        || (u.candidate_item_id ?? null) !== (expected.candidateItemId ?? null) || (u.last_error ?? null) !== (expected.lastError ?? null)) return reject('intent_changed');
      if (u.state === 'failed' && u.candidate_item_id) return reject('rejected_candidate');
      if (u.state === 'abandoned' && (u.last_error === 'staff_cancelled' || u.request_document_id)) return reject('abandonment_not_bindable');
      if (u.candidate_item_id && (u.candidate_drive_id !== c.driveId || u.candidate_item_id !== c.itemId || Number(w.copy.declared_size) !== c.size)) return reject('candidate_mismatch');
      if (['queued', 'copying', 'registering'].includes(w.copy.state)) {
        if (!copyLeaseToken || !live(w.copy, copyLeaseToken)) return reject('copy_lease_lost');
      } else if (w.copy.state === 'failed') {
        if (!free(w.copy)) return reject('copy_lease_live');
      } else return reject('copy_state_invalid');
      Object.assign(u, {
        state: 'finalized', request_document_id: verified.requestDocumentId, candidate_site_id: c.siteId, candidate_drive_id: c.driveId,
        candidate_item_id: c.itemId, candidate_version_id: c.versionId, candidate_etag: c.eTag, candidate_size: c.size,
        upload_url_ciphertext: null, lease_token: null, lease_expires_at: null, last_error: null,
      });
      return { bound: true, row: { ...u } };
    },
    markCopied: async ({ leaseToken = null }) => {
      const u = w.intent; const c = w.copy;
      if (u.state !== 'finalized' || !['queued', 'copying', 'registering', 'failed'].includes(c.state)) return null;
      if (!((leaseToken && live(c, leaseToken)) || (!leaseToken && free(c)))) return null;
      if (w.copiedElsewhere) throw Object.assign(new Error('conflict'), { code: 'zoom_video_receipt_conflict' });
      w.counts.copied += 1;
      Object.assign(c, {
        state: 'copied', request_document_id: u.request_document_id, sharepoint_drive_id: u.candidate_drive_id,
        sharepoint_item_id: u.candidate_item_id, failure_code: null, next_attempt_at: null, lease_token: null, lease_expires_at: null,
      });
      return copyReturn();
    },
    listFinalizedCopies: async () => (w.intent.state === 'finalized' && ['queued', 'copying', 'registering', 'failed'].includes(w.copy.state) && free(w.copy) ? [{ id: ID }] : []),
    claimFailedDue: async ({ deferSeconds = 600 } = {}) => {
      const c = w.copy;
      if (c.state !== 'failed' || (c.next_attempt_at && c.next_attempt_at > w.t) || ['finalized', 'abandoned'].includes(w.intent.state)) return [];
      c.next_attempt_at = w.t + deferSeconds * 1000;
      w.failedDueLog.push(w.t);
      return [{ id: ID, request_id: REQ, upload_id: ID, failure_code: c.failure_code }];
    },
    deferRegistration: async ({ leaseToken }) => {
      const c = w.copy;
      if (!live(c, leaseToken) || c.state !== 'registering') return null;
      w.counts.defer += 1;
      if (c.registration_attempts + 1 > 5) throw new Error('CHECK violated: registration attempts above cap');
      c.registration_attempts += 1;
      if (c.registration_attempts >= 5) endCopy('failed', { failure_code: 'zoom_video_registration_failed' });
      else Object.assign(c, { next_attempt_at: w.t + REGISTRATION_BACKOFF[c.registration_attempts - 1] * 1000, lease_token: null, lease_expires_at: null });
      return copyReturn();
    },
    deferAttempt: async ({ leaseToken, retryAfterSeconds }) => {
      const c = w.copy;
      if (!live(c, leaseToken) || !['queued', 'copying', 'registering'].includes(c.state)) return null;
      Object.assign(c, { next_attempt_at: w.t + retryAfterSeconds * 1000, lease_token: null, lease_expires_at: null });
      return copyReturn();
    },
  });

  const doc = (id, fence, over = {}) => ({
    wmkf_requestdocumentid: id, _wmkf_request_value: REQ, wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_producer: 'meeting-tracker-post-presentation', wmkf_slotversion: fence, createdon: iso(w.t + fence * 1000), ...over,
  });
  w.zoomLinkDoc = (id = 'link-1', fence = 1) => doc(id, fence, { wmkf_externalurl: ZOOM_LINK });
  w.staffMp4Doc = (id = 'staff-1', fence = 3) => doc(id, fence, {
    wmkf_generationkey: 'staff-key', wmkf_inputfingerprint: 'staff-fp', wmkf_sharepointsiteid: 'site', wmkf_sharepointdriveid: 'drive-staff',
    wmkf_sharepointitemid: 'item-staff', wmkf_sharepointversionid: '1.0', wmkf_sharepointetag: 'e', wmkf_sharepointfolderpath: 'F',
    wmkf_filename: 'staff.mp4', wmkf_contenttype: 'video/mp4', wmkf_filesize: 100,
  });
  // Seed: bytes complete and recorded, the copy `registering`, ready for the finalize hand-off.
  w.seedRegistering = () => {
    w.graph.item = { id: 'item1', driveId: 'drive1', siteId: 'site1', name: w.intent.physical_filename, size: w.copy.declared_size, eTag: 'e1', versionId: '1', cTag: 'c1', webUrl: 'https://sp.example/x' };
    Object.assign(w.intent, {
      state: 'uploaded', candidate_item_id: 'item1', candidate_drive_id: 'drive1', candidate_site_id: 'site1',
      candidate_version_id: '1', candidate_etag: 'e1', candidate_size: w.copy.declared_size, upload_url_ciphertext: null,
    });
    Object.assign(w.copy, { state: 'registering', sharepoint_drive_id: 'drive1', sharepoint_item_id: 'item1', bytes_confirmed: w.copy.declared_size });
    return w;
  };
  // The registered document a finished finalize would have left, for the recovery paths.
  w.registeredDoc = (over = {}) => {
    const d = doc('doc-existing', 2, {
      wmkf_generationkey: w.intent.generation_key, wmkf_inputfingerprint: w.intent.client_resume_fingerprint,
      wmkf_sharepointsiteid: 'site1', wmkf_sharepointdriveid: 'drive1', wmkf_sharepointitemid: 'item1', wmkf_sharepointversionid: '1',
      wmkf_sharepointetag: 'e1', wmkf_sharepointfolderpath: 'Folder/Post', wmkf_filename: w.intent.physical_filename,
      wmkf_contenttype: 'video/mp4', wmkf_filesize: w.copy.declared_size, ...over,
    });
    w.docs.push(d);
    return d;
  };

  w.materialDeps = {
    getRequest: async () => ({ akoya_requestid: REQ, akoya_requestnum: '1001', wmkf_meetingdate: '2026-12-10T00:00:00Z' }),
    findActiveSiteVisit: async () => ({
      records: w.visit === 'none' ? [] : [
        { activityid: VISIT, _regardingobjectid_value: REQ },
        ...(w.visit === 'two' ? [{ activityid: 'other-visit', _regardingobjectid_value: REQ }] : []),
      ],
    }),
    findDocuments: async () => ({ records: w.docs.map(d => ({ ...d })) }),
    findDocumentByGenerationKey: async key => {
      if (w.dvDown) throw Object.assign(new Error('dataverse down'), { status: 503 });
      return { records: w.docs.filter(d => d.wmkf_generationkey === key).map(d => ({ ...d })) };
    },
    createDocument: async payload => {
      if (w.hooks.beforeCreateDoc) w.hooks.beforeCreateDoc();
      w.counts.createDoc += 1;
      const id = `doc-${w.nextDoc++}`;
      w.docs.push({ ...payload, wmkf_requestdocumentid: id, _wmkf_request_value: REQ, createdon: iso(w.t + 10_000 * w.counts.createDoc) });
      return { wmkf_requestdocumentid: id };
    },
    updateDocument: async (id, patch) => {
      w.counts.updateDoc += 1;
      Object.assign(w.docs.find(d => d.wmkf_requestdocumentid === id), patch);
      return {};
    },
    acquireSlotLease: async ({ leaseToken }) => {
      const s = w.slot;
      if (s.token && s.token !== leaseToken && s.expiresAt > w.t) return null;
      if (s.token !== leaseToken) s.fence += 1;
      Object.assign(s, { token: leaseToken, expiresAt: w.t + 300_000 });
      return { fence_version: s.fence };
    },
    getSlotLease: async () => ({ lease_token: w.slot.token, lease_expires_at: iso(w.slot.expiresAt), fence_version: w.slot.fence }),
    renewSlotLease: async lease => {
      const s = w.slot;
      if (s.token !== lease.leaseToken || s.expiresAt <= w.t || s.fence !== lease.fenceVersion) return null;
      s.expiresAt = w.t + 300_000; return { fence_version: s.fence };
    },
    releaseSlotLease: async lease => { if (w.slot.token === lease.leaseToken) Object.assign(w.slot, { token: null, expiresAt: 0 }); return {}; },
    readMediaRange: async () => ({ mimeType: w.mime, malware: null, bytes: Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(24)]) }),
    renewUploadLease: renewIntentFinalize,
    completeUploadIntent,
    recordUploadCandidate: w.deps.recordUploadCandidate,
    getFileMetadataByPath: w.deps.getFileMetadataByPath,
    getFileMetadataById: w.deps.getFileMetadataById,
    recordEvent: async event => { w.matEvents.push(event); },
    randomUUID: () => 'claim-token',
    now: () => new Date(w.t),
  };
  w.deps.materialDependencies = w.materialDeps;

  // Process-death injection: every I/O dependency is numbered in call order. `crashAt` kills the process before or
  // after the Nth call; afterwards every call throws, so no cleanup or later write can rescue the case.
  w.trace = [];
  w.dead = false;
  w.crashAt = null;
  w.crashWhen = 'after';
  const NOT_IO = new Set(['now', 'log', 'access', 'requestAllowed', 'readConfig', 'sleep', 'chunkBytes', 'sealUploadUrl', 'openUploadUrl', 'recordEvent', 'finalizeClaimed', 'reconcileFinalized', 'materialDependencies']);
  const wrap = (name, fn) => async (...args) => {
    if (w.dead) throw Object.assign(new Error('process is dead'), { crash: true });
    w.trace.push(name);
    const hit = w.crashAt === w.trace.length;
    if (hit && w.crashWhen === 'before') { w.dead = true; throw Object.assign(new Error('crash'), { crash: true }); }
    const result = await fn(...args);
    if (hit && w.crashWhen === 'after') { w.dead = true; throw Object.assign(new Error('crash'), { crash: true }); }
    return result;
  };
  w.instrument = () => {
    for (const [name, fn] of Object.entries(w.deps)) if (typeof fn === 'function' && !NOT_IO.has(name)) w.deps[name] = wrap(name, fn);
    for (const [name, fn] of Object.entries(w.materialDeps)) if (typeof fn === 'function' && !['now', 'randomUUID', 'recordEvent'].includes(name)) w.materialDeps[name] = wrap(`dv.${name}`, fn);
    return w;
  };
  // Replay after a crash: the process is new and every lease has run out (copy 600 s, intent and slot 300 s).
  w.revive = (advanceMs = 700_000) => { w.dead = false; w.crashAt = null; w.t += advanceMs; return w; };
  w.tick = (overrides = {}, depOverrides = {}) => runZoomVideoCopyTick({ deadlineMs: w.t + 270_000, ...overrides }, { ...w.deps, ...depOverrides });
  return w;
}
export const logText = w => JSON.stringify(w.logs);
