/**
 * Zoom video copy tick worker, transfer path (Stage 3b, slice S5). Plan:
 * docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md ("Transfer", "State machine and leases", "Dispatch",
 * "Server cancellation", Build rulings 2-5, 8a, 11, 12).
 *
 * One tick claims at most one copy row (N2), takes the intent pump lease (I1) and moves bytes from Zoom into a
 * Graph upload session in 10 MiB chunks, one chunk in memory at a time. Graph's `nextExpectedRanges`, never the
 * `bytes_confirmed` column, is the resume pointer. The resolved Zoom URL lives in memory for this tick only.
 *
 * S6 adds the rest of the dispatch table: the finalize hand-off for `registering` rows (I3, `finalizeClaimedMp4Upload`
 * with the copy fence and decision 8), receipt repair for finalized intents (N5, also run first in every tick as
 * reconcile-finalized), rejected candidates, exact-registration inspection for expired and abandoned intents and for
 * failed copies (I4/I5), and the Zoom configuration-fault deferral (ruling 21). Receipt inspection never writes to
 * Graph or Dataverse; it only binds an exactly verified, already registered document.
 *
 * Logs carry copy/request ids, states, counts and sanitized codes only; never a URL, token, email or error message.
 */
import { GraphService } from '../graph-service.js';
import OperationalEventService from '../operational-event-service.js';
import { GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES } from '../../../shared/utils/graph-browser-upload.js';
import { isZoomVideoCopyRequestAllowed, zoomVideoCopyAccess } from '../../utils/zoom-video-copy-access.js';
import { isPostPresentationMaterialsRequestAllowed } from '../../utils/post-presentation-materials-readiness.js';
import { materialBacking } from '../post-presentation-materials/material-model.js';
import {
  POST_PRESENTATION_MATERIALS_DEPENDENCIES,
  _internal as materialInternals,
  materialError,
} from '../post-presentation-materials/material-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import {
  abandonZoomCopyIntentForSourceFailure,
  bindZoomCopyRegisteredReceipt,
  cancelPresentationMaterialUploadRecovery,
  claimZoomCopyIntentForFinalize,
  claimZoomCopyIntentPump,
  claimZoomCopyIntentReceiptInspection,
  markPresentationMaterialUploadRecoveryTerminal,
  markPresentationMaterialUploadRecoveryUncertain,
  recordPresentationMaterialUploadCandidate,
  recordPresentationMaterialUploadRecoverySession,
  recordZoomCopyIntentSession,
  refreshPresentationMaterialUploadSession,
  releasePresentationMaterialUpload,
  releasePresentationMaterialUploadRecovery,
  releaseZoomCopyIntentReceiptInspection,
  renewPresentationMaterialUploadLease,
  renewPresentationMaterialUploadRecovery,
  renewZoomCopyIntentReceiptInspection,
} from '../post-presentation-materials/upload-intent-store.js';
import {
  openPresentationUploadUrl,
  sealPresentationUploadUrl,
} from '../post-presentation-materials/upload-session-crypto.js';
import {
  ZoomClientError,
  fetchRecordingRange,
  getAccessToken,
  getMeetingRecordings,
  resolveRecordingDownloadUrl,
} from './zoom-client.js';
import { readZoomImportConfig } from './import-service.js';
import {
  cancelZoomVideoCopy,
  claimFailedZoomVideoCopiesDue,
  claimZoomVideoCopyWork,
  deferZoomVideoCopyAttempt,
  deferZoomVideoCopyRegistration,
  failZoomVideoCopy,
  getZoomVideoCopySnapshot,
  hashZoomHostEmail,
  listZoomVideoCopiesWithFinalizedIntent,
  markZoomVideoCopyCopied,
  markZoomVideoCopyCopying,
  markZoomVideoCopyRegistering,
  recordZoomVideoCopyProgress,
  recordZoomVideoCopySessionCreateFailure,
  recordZoomVideoCopySessionRestart,
  recordZoomVideoCopyUncertainCheck,
  releaseZoomVideoCopyLease,
  renewZoomVideoCopyLease,
} from './video-copy-store.js';

const {
  resolveStableMp4Path, persistMp4Candidate, exactSequentialRange, intentReviewAfter,
  finalizeClaimedMp4Upload, validateRecoveredMp4Row, TERMINAL_MP4_VALIDATION_CODES,
} = materialInternals;

export const CHUNK_BYTES = GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES;
/** Work deadline: handler entry + 270 s, 30 s under the cron's 300 s maxDuration. */
export const TICK_WORK_MS = 270_000;
/** Plan "Tick budget": a chunk starts only when at least this much remains. */
export const CHUNK_ADMISSION_MS = 190_000;
/** Plan "Tick budget": the finalize hand-off starts only when at least this much remains. */
export const FINALIZE_ADMISSION_MS = 150_000;
const RESOLVE_ALLOWANCE_MS = 30_000;
const RANGE_ALLOWANCE_MS = 45_000;
const PUT_ALLOWANCE_MS = 45_000;
const STATUS_ALLOWANCE_MS = 30_000;
const PATH_CHECK_ALLOWANCE_MS = 20_000;
const LOSS_CHECK_DELAYS_MS = [0, 2_000, 8_000];
const SESSION_CREATE_RETRY_SECONDS = 60;
const UNCERTAIN_RETRY_SECONDS = 600;
const POST_FINAL_RETRY_SECONDS = 60;
// Ruling 21: a Zoom auth/scope fault waits this long, uncounted.
const CONFIG_RETRY_SECONDS = 15 * 60;
// A receipt inspection that could not prove absence or a match backs off this long on an active copy.
const RECEIPT_RETRY_SECONDS = 10 * 60;
// Failed-copy receipt inspection: rows per tick, and the time one row needs (Dataverse read plus two Graph reads).
const FAILED_INSPECTION_BATCH = 2;
const INSPECTION_ALLOWANCE_MS = 60_000;
const RECONCILE_BATCH = 10;
const CODE = /^[a-z0-9_]{1,80}$/;

// --- control-flow signals -----------------------------------------------------------------------------------

class Stop extends Error { constructor(reason) { super(reason); this.reason = reason; } }
class Pause extends Error { constructor(reason) { super(reason); this.reason = reason; } }
class Yield extends Error {}
class CancelSeen extends Error {}
class Terminal extends Error {
  constructor(code, { deleteSession = true } = {}) { super(code); this.code = code; this.deleteSession = deleteSession; }
}
class Transient extends Error { constructor(code) { super(code); this.code = code; } }
/** Zoom rejected our credentials or scope: a configuration fault, not the copy's (ruling 21). */
class ConfigFault extends Error { constructor(code) { super(code); this.code = code; } }

const safeCode = (error, fallback) => (typeof error?.code === 'string' && CODE.test(error.code) ? error.code : fallback);

const DEFAULT_DEPENDENCIES = Object.freeze({
  chunkBytes: CHUNK_BYTES,
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  log: line => console.log(JSON.stringify(line)),
  recordEvent: event => OperationalEventService.recordEvent(event),
  access: () => zoomVideoCopyAccess(),
  requestAllowed: requestId => isZoomVideoCopyRequestAllowed(requestId) && isPostPresentationMaterialsRequestAllowed(requestId),
  readConfig: () => readZoomImportConfig(),
  // Reconcile-finalized (N5a/N5) runs first in every tick, even when access is off. Replaceable as one seam.
  reconcileFinalized: null,
  materialDependencies: POST_PRESENTATION_MATERIALS_DEPENDENCIES,
  // copy store
  claimCopy: claimZoomVideoCopyWork,
  getSnapshot: getZoomVideoCopySnapshot,
  renewCopyLease: renewZoomVideoCopyLease,
  releaseCopyLease: releaseZoomVideoCopyLease,
  markCopying: markZoomVideoCopyCopying,
  recordProgress: recordZoomVideoCopyProgress,
  recordCreateFailure: recordZoomVideoCopySessionCreateFailure,
  recordRestart: recordZoomVideoCopySessionRestart,
  recordUncertainCheck: recordZoomVideoCopyUncertainCheck,
  markRegistering: markZoomVideoCopyRegistering,
  failCopy: failZoomVideoCopy,
  cancelCopy: cancelZoomVideoCopy,
  deferRegistration: deferZoomVideoCopyRegistration,
  deferAttempt: deferZoomVideoCopyAttempt,
  markCopied: markZoomVideoCopyCopied,
  listFinalizedCopies: listZoomVideoCopiesWithFinalizedIntent,
  claimFailedDue: claimFailedZoomVideoCopiesDue,
  // intent store
  claimPump: claimZoomCopyIntentPump,
  recordIntentSession: recordZoomCopyIntentSession,
  renewIntentRecovery: renewPresentationMaterialUploadRecovery,
  releaseIntentRecovery: releasePresentationMaterialUploadRecovery,
  markRecoveryTerminal: markPresentationMaterialUploadRecoveryTerminal,
  markRecoveryUncertain: markPresentationMaterialUploadRecoveryUncertain,
  cancelRecovery: cancelPresentationMaterialUploadRecovery,
  recordRecoverySession: recordPresentationMaterialUploadRecoverySession,
  refreshUploadSession: refreshPresentationMaterialUploadSession,
  recordUploadCandidate: recordPresentationMaterialUploadCandidate,
  abandonForSourceFailure: abandonZoomCopyIntentForSourceFailure,
  claimFinalize: claimZoomCopyIntentForFinalize,
  renewIntentFinalize: renewPresentationMaterialUploadLease,
  releaseIntentFinalize: releasePresentationMaterialUpload,
  claimInspection: claimZoomCopyIntentReceiptInspection,
  renewInspection: renewZoomCopyIntentReceiptInspection,
  releaseInspection: releaseZoomCopyIntentReceiptInspection,
  bindReceipt: bindZoomCopyRegisteredReceipt,
  finalizeClaimed: finalizeClaimedMp4Upload,
  // Zoom
  getMeetingRecordings,
  getAccessToken,
  resolveRecordingDownloadUrl,
  fetchRecordingRange,
  // Graph
  createBrowserUploadSession: (...args) => GraphService.createBrowserUploadSession(...args),
  getBrowserUploadSessionStatus: (...args) => GraphService.getBrowserUploadSessionStatus(...args),
  cancelBrowserUploadSession: (...args) => GraphService.cancelBrowserUploadSession(...args),
  putUploadSessionChunk: (...args) => GraphService.putUploadSessionChunk(...args),
  getFileMetadataByPath: (...args) => GraphService.getFileMetadataByPath(...args),
  getFileMetadataById: (...args) => GraphService.getFileMetadataById(...args),
  sealUploadUrl: sealPresentationUploadUrl,
  openUploadUrl: openPresentationUploadUrl,
});

// --- tick entry --------------------------------------------------------------------------------------------

/**
 * Run one tick. `deadlineMs` is the absolute work deadline on the same clock as `now()` (default handler entry +
 * 270 s). Returns a small result object; it never throws for a copy-level problem.
 */
export async function runZoomVideoCopyTick({ deadlineMs, now } = {}, dependencies = {}) {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies, ...(typeof now === 'function' ? { now } : {}) };
  const startedAt = deps.now();
  const deadline = Number.isFinite(deadlineMs) ? deadlineMs : startedAt + TICK_WORK_MS;
  const access = deps.access();
  // Local receipt repair only (no remote call), so it runs under the kill switch. A failure never blocks the tick.
  try {
    if (typeof deps.reconcileFinalized === 'function') await deps.reconcileFinalized({ access });
    else await reconcileFinalizedCopies(deps);
  } catch (error) {
    deps.log({ event: 'zoom_video_copy_reconcile_failed', code: safeCode(error, 'zoom_video_reconcile_error') });
  }
  // Kill switch: off (or an invalid value) claims nothing; test:<GUID> claims only that request.
  if (!access.valid || access.mode === 'off') return { outcome: 'access_off' };
  const accessRequestId = access.mode === 'test' ? access.requestId : null;
  try {
    await inspectFailedCopies(deps, { accessRequestId, deadline });
  } catch (error) {
    deps.log({ event: 'zoom_video_copy_inspection_failed', code: safeCode(error, 'zoom_video_inspection_error') });
  }
  const claim = await deps.claimCopy({ accessRequestId });
  if (!claim) return { outcome: 'idle' };

  const ctx = {
    deps, deadline, id: claim.row.id, requestId: claim.row.request_id, row: claim.row, copyToken: claim.leaseToken,
    copyState: claim.row.state, snapshot: null, intent: null, intentToken: null, ciphertext: null, intentState: null,
    candidate: null, listing: null, resolvedUrl: null, ending: false, endCode: null, chunks: 0,
    bytesFrom: null, bytesTo: null, expirationDateTime: null, restarts: 0,
  };
  const fromState = ctx.copyState;
  let result;
  try {
    result = await guarded(ctx, () => dispatch(ctx));
  } finally {
    await releaseAll(ctx);
  }
  deps.log({
    event: 'zoom_video_copy_tick',
    copyId: ctx.id,
    requestId: ctx.requestId,
    outcome: result.outcome,
    code: result.code || null,
    fromState,
    toState: ctx.copyState,
    chunks: ctx.chunks,
    bytesFrom: ctx.bytesFrom,
    bytesTo: ctx.bytesTo,
    restarts: ctx.restarts,
    expirationDateTime: ctx.expirationDateTime,
    elapsedMs: deps.now() - startedAt,
  });
  return { ...result, copyId: ctx.id };
}

async function releaseAll(ctx) {
  const { deps } = ctx;
  if (ctx.intentToken) {
    await Promise.resolve(deps.releaseIntentRecovery({ uploadId: ctx.id, leaseToken: ctx.intentToken })).catch(() => {});
    ctx.intentToken = null;
  }
  await Promise.resolve(deps.releaseCopyLease({ id: ctx.id, leaseToken: ctx.copyToken })).catch(() => {});
}

/** Run `fn`; map control-flow signals and errors to a tick outcome. Cancel and terminal source errors divert to the end sequence. */
async function guarded(ctx, fn) {
  try {
    return await fn();
  } catch (first) {
    let error = first;
    try {
      if (error instanceof ConfigFault) return await deferConfigFault(ctx, error);
      if (error instanceof CancelSeen) return await endTransfer(ctx, { code: null });
      if (error instanceof Terminal) return await endTransfer(ctx, { code: error.code, deleteSession: error.deleteSession });
    } catch (inner) {
      error = inner;
    }
    return mapError(error);
  }
}

function mapError(error) {
  if (error instanceof Stop) return { outcome: 'lease_lost', code: safeCode({ code: error.reason }, null) };
  if (error instanceof Pause) return { outcome: 'paused', code: safeCode({ code: error.reason }, null) };
  if (error instanceof Yield) return { outcome: 'yield' };
  if (error instanceof Transient) return { outcome: 'transient', code: safeCode(error, 'zoom_video_transient') };
  if (error?.code === 'post_presentation_candidate_record_failed') return { outcome: 'lease_lost', code: 'candidate_not_recorded' };
  const status = Number(error?.status);
  if (error?.isTransient === true || error?.noResponse === true || status >= 500) {
    return { outcome: 'transient', code: safeCode(error, 'zoom_video_transient') };
  }
  return { outcome: 'error', code: safeCode(error, 'zoom_video_tick_error') };
}

// --- budget, fences ----------------------------------------------------------------------------------------

const remaining = ctx => ctx.deadline - ctx.deps.now();
function ensure(ctx, allowanceMs) {
  if (remaining(ctx) < allowanceMs) throw new Yield();
}

/** Local policy gate shared by every fence: kill switch / feature access (pause) and the Zoom config (pause). */
function assertAllowed(ctx) {
  if (!ctx.deps.requestAllowed(ctx.requestId)) throw new Pause('access_denied');
}

/** Host recheck (ruling 12): the stored hash must still match an approved host. Removal is terminal, not a pause. */
function assertSourceApproved(ctx) {
  const config = ctx.deps.readConfig();
  if (!config?.available) throw new Pause('zoom_config_unavailable');
  const approved = (config.hosts || []).some(host => hashZoomHostEmail(host) === ctx.row.zoom_host_email_sha256);
  if (!approved) throw new Terminal('zoom_video_host_not_approved', { deleteSession: false });
}

/**
 * Copy fence (plan "Copy fence"): N3 renew with the expected state, the cancel flag where it applies, access, and
 * the source approval. Returns { cancel } when the flag is set but tolerated.
 */
async function copyFence(ctx, { cancelOk = false, source = true } = {}) {
  const renewed = await ctx.deps.renewCopyLease({ id: ctx.id, leaseToken: ctx.copyToken, states: [ctx.copyState] });
  if (!renewed) throw new Stop('copy_lease_lost');
  const cancel = Boolean(renewed.cancel_requested_at);
  assertAllowed(ctx);
  if (source && !ctx.ending) assertSourceApproved(ctx);
  if (cancel && !cancelOk && !ctx.ending) throw new CancelSeen();
  return { cancel };
}

/** Copy fence plus the intent pump lease renewal (before every PUT and every Postgres write on the pump path). */
async function fence(ctx, options = {}) {
  const result = await copyFence(ctx, options);
  const renewed = await ctx.deps.renewIntentRecovery({ uploadId: ctx.id, leaseToken: ctx.intentToken });
  if (!renewed) throw new Stop('intent_lease_lost');
  return result;
}

async function ensureIntentLease(ctx) {
  if (ctx.intentToken) return true;
  const claim = await ctx.deps.claimPump({ uploadId: ctx.id });
  if (!claim) return false;
  ctx.intent = claim.row;
  ctx.intentToken = claim.leaseToken;
  ctx.ciphertext = claim.row.upload_url_ciphertext || null;
  ctx.intentState = claim.row.state;
  return true;
}

// --- dispatch (plan "Dispatch (explicit reachable pairs)") -------------------------------------------------

const KNOWN_INTENT_STATES = new Set(['initiated', 'failed', 'uploaded', 'finalizing', 'finalized', 'abandoned']);

function invalidShape(snap, ctx) {
  if (!snap || snap.intent_origin !== 'zoom_copy' || !KNOWN_INTENT_STATES.has(snap.intent_state)) return true;
  const candidate = Boolean(snap.candidate_item_id);
  const cipher = Boolean(snap.intent_has_ciphertext);
  const state = ctx.copyState;
  if (snap.intent_state === 'initiated' && candidate) return true;
  if ((snap.intent_state === 'uploaded' || snap.intent_state === 'finalizing') && !candidate) return true;
  if (snap.intent_state === 'abandoned' && cipher) return true;
  if (snap.intent_state === 'abandoned' && snap.intent_last_error === 'staff_cancelled' && candidate) return true;
  if (state === 'copying' && snap.intent_state === 'initiated' && !cipher) return true;
  if (state === 'registering' && !candidate) return true;
  if ((state === 'queued' || state === 'copying') && snap.intent_state === 'finalizing') return true;
  return false;
}

async function dispatch(ctx) {
  const { deps } = ctx;
  const snap = await deps.getSnapshot({ id: ctx.id });
  ctx.snapshot = snap;
  assertAllowed(ctx);
  if (snap) ctx.copyState = snap.state;
  const candidate = Boolean(snap?.candidate_item_id);

  if (invalidShape(snap, ctx)) return invalidTuple(ctx);
  // A finalized intent is a registered document: repair the copy's receipt, never finalize again.
  if (snap.intent_state === 'finalized') return repairReceipt(ctx);
  if (snap.intent_lease_live) return { outcome: 'deferred_intent_lease' };
  // A rejected candidate (terminal finalize release) is a copy-only failure, expired or not: it precedes the expiry row.
  if (snap.intent_state === 'failed' && candidate) return rejectedCandidate(ctx, snap);
  // Crash after abandonment replays cancelled, even after expiry.
  if (snap.intent_state === 'abandoned' && !candidate && snap.intent_last_error === 'staff_cancelled') {
    await copyFence(ctx, { cancelOk: true, source: false });
    return cancelCopyOnly(ctx);
  }
  // Expired intents and other abandonments: exact-registration reconciliation before any failure.
  if (snap.intent_expired || snap.intent_state === 'abandoned') return reconcileUnsettled(ctx, snap);
  if (ctx.copyState === 'registering') return finalizeHandOff(ctx);

  if (snap.intent_state === 'uploaded') {
    // Candidate recorded, copy not yet registering (crash between the two writes) or cancelled before I3.
    return finishBytes(ctx, { driveId: snap.candidate_drive_id, itemId: snap.candidate_item_id });
  }
  // initiated | failed, no candidate
  if (snap.cancel_requested_at) return endTransfer(ctx, { code: null });
  return transfer(ctx);
}

async function invalidTuple(ctx) {
  await alert(ctx.deps, ctx, {
    eventType: 'zoom_video_copy_state_invalid',
    summary: 'A Zoom video copy row and its intent are in a combination the worker does not recognize.',
    stage: 'video-copy-dispatch',
    key: 'state-invalid',
  });
  // No Graph or Dataverse write; identities are retained. Failing the copy frees the request's active-copy lock.
  return failDirect(ctx, 'zoom_video_state_invalid');
}

/** Best-effort operational alert; identifiers only (copy and request ids), never a URL, token, email or message. */
async function alert(deps, { id, requestId }, { eventType, severity = 'warning', summary, stage, key, metadata }) {
  await Promise.resolve(deps.recordEvent({
    eventType,
    severity,
    summary,
    subsystem: 'meeting-tracker-recordings',
    stage,
    transient: false,
    correlationId: id,
    dedupeKey: `zoom-video-copy:${id}:${key}`,
    entityRefs: requestId ? { requestId } : undefined,
    metadata,
  })).catch(() => {});
}

async function failDirect(ctx, code) {
  await copyFence(ctx, { cancelOk: true, source: false });
  const row = await ctx.deps.failCopy({ id: ctx.id, leaseToken: ctx.copyToken, failureCode: code });
  if (!row) throw new Stop('copy_lease_lost');
  ctx.copyState = 'failed';
  return { outcome: 'failed', code };
}

async function cancelCopyOnly(ctx, identity = {}) {
  const row = await ctx.deps.cancelCopy({
    id: ctx.id, leaseToken: ctx.copyToken, driveId: identity.driveId ?? null, itemId: identity.itemId ?? null,
  });
  if (!row) throw new Stop('copy_lease_lost');
  ctx.copyState = 'cancelled';
  return { outcome: 'cancelled', code: identity.itemId ? 'cancelled_after_bytes' : null };
}

// --- Zoom side -----------------------------------------------------------------------------------------------

function classifyZoom(error) {
  if (!(error instanceof ZoomClientError)) return error;
  switch (error.code) {
    case 'zoom_not_found': return new Terminal('zoom_recording_changed');
    case 'zoom_range_unsupported':
    case 'zoom_download_invalid':
    case 'zoom_download_denied': return new Terminal(error.code);
    case 'zoom_not_configured':
    case 'zoom_auth_failed':
    case 'zoom_scope_missing': return new ConfigFault(error.code);
    default: return new Transient(error.code);
  }
}

/** Re-list the meeting and re-find the file; anything that no longer matches the row is terminal. */
async function listAndValidate(ctx) {
  ensure(ctx, RESOLVE_ALLOWANCE_MS);
  const startedAt = ctx.deps.now();
  let detail;
  try {
    detail = await ctx.deps.getMeetingRecordings(ctx.row.zoom_meeting_uuid);
  } catch (error) {
    throw classifyZoom(error);
  }
  const files = Array.isArray(detail?.recording_files) ? detail.recording_files : [];
  const file = files.find(item => item?.id === ctx.row.zoom_file_id);
  if (detail?.host_id !== ctx.row.zoom_host_id || !file || file.status !== 'completed'
    || String(file.file_extension || '').toUpperCase() !== 'MP4' || file.recording_type !== ctx.row.zoom_recording_type
    || Number(file.file_size) !== Number(ctx.row.declared_size) || typeof file.download_url !== 'string' || !file.download_url) {
    throw new Terminal('zoom_recording_changed');
  }
  ctx.listing = { downloadUrl: file.download_url, spentMs: ctx.deps.now() - startedAt };
}

/** Resolve the download URL for this tick (never persisted). `relist` forces a fresh listing. */
async function resolveUrl(ctx, { relist = false } = {}) {
  if (relist || !ctx.listing) await listAndValidate(ctx);
  const listing = ctx.listing;
  ctx.listing = null;
  const startedAt = ctx.deps.now();
  ensure(ctx, 1_000);
  try {
    const bearer = await ctx.deps.getAccessToken();
    ctx.resolvedUrl = await ctx.deps.resolveRecordingDownloadUrl(listing.downloadUrl, {
      bearer,
      deadlineMs: Math.min(ctx.deadline, startedAt + Math.max(0, RESOLVE_ALLOWANCE_MS - listing.spentMs)),
    });
  } catch (error) {
    throw classifyZoom(error);
  }
}

// --- Graph path checks -------------------------------------------------------------------------------------

/**
 * Exact-path checks at the given delays (each after a lease renewal, the browser `recoveryPath` loop). A complete
 * item is recorded as the intent's candidate under the pump lease. Returns complete | partial | mismatch | absent.
 */
async function recoveryPath(ctx, delays, { cancelOk = false } = {}) {
  for (const delayMs of delays) {
    if (delayMs) {
      ensure(ctx, delayMs + PATH_CHECK_ALLOWANCE_MS);
      await ctx.deps.sleep(delayMs);
    }
    ensure(ctx, PATH_CHECK_ALLOWANCE_MS);
    await fence(ctx, { cancelOk });
    let found;
    try {
      found = await resolveStableMp4Path(ctx.intent, ctx.deps);
    } catch (error) {
      if (error?.code === 'post_presentation_candidate_mismatch') return { state: 'mismatch' };
      throw error;
    }
    if (found.state === 'complete') {
      await persistMp4Candidate(ctx.intent, found.candidate, ctx.intentToken, ctx.deps);
      ctx.candidate = found.candidate;
      ctx.intentState = 'uploaded';
      return { state: 'complete' };
    }
    if (found.state !== 'absent') return { state: found.state };
  }
  return { state: 'absent' };
}

/**
 * Bytes complete: the candidate is recorded (intent `uploaded`). Copy fence only from here (the recovery renewal can
 * no longer match). The cancel flag is read after the candidate write, never before.
 */
async function finishBytes(ctx, identity = null) {
  const driveId = identity?.driveId ?? ctx.candidate.driveId;
  const itemId = identity?.itemId ?? ctx.candidate.itemId;
  const { cancel } = await copyFence(ctx, { cancelOk: true, source: false });
  let result;
  if (ctx.endCode) {
    const row = await ctx.deps.failCopy({ id: ctx.id, leaseToken: ctx.copyToken, failureCode: ctx.endCode });
    if (!row) throw new Stop('copy_lease_lost');
    ctx.copyState = 'failed';
    result = { outcome: 'failed', code: ctx.endCode };
  } else if (cancel || ctx.ending) {
    result = await cancelCopyOnly(ctx, { driveId, itemId });
  } else {
    const row = await ctx.deps.markRegistering({ id: ctx.id, leaseToken: ctx.copyToken, driveId, itemId });
    if (!row) throw new Stop('copy_lease_lost');
    ctx.copyState = 'registering';
    ctx.bytesTo = Number(row.declared_size);
    // The finalize hand-off continues from `registering` on the next tick (the copy is due at once).
    result = { outcome: 'registering' };
  }
  if (ctx.intentToken) {
    await Promise.resolve(ctx.deps.releaseIntentRecovery({ uploadId: ctx.id, leaseToken: ctx.intentToken })).catch(() => {});
    ctx.intentToken = null;
  }
  return result;
}

/** Retain and back off: shared counter, optional intent mark (`failed` + last_error), cap failure by caller. */
async function uncertain(ctx, { capCode, lastError = null, retrySeconds = UNCERTAIN_RETRY_SECONDS }) {
  await fence(ctx, { cancelOk: true, source: false });
  if (lastError) {
    const marked = await ctx.deps.markRecoveryUncertain({ uploadId: ctx.id, leaseToken: ctx.intentToken, lastError });
    if (!marked) throw new Stop('intent_changed');
    ctx.intentState = 'failed';
  }
  const row = await ctx.deps.recordUncertainCheck({
    id: ctx.id, leaseToken: ctx.copyToken, retryAfterSeconds: retrySeconds, capFailureCode: capCode,
  });
  if (!row) throw new Stop('copy_lease_lost');
  if (row.state === 'failed') {
    ctx.copyState = 'failed';
    return { outcome: 'failed', code: row.failure_code || capCode };
  }
  return { outcome: 'uncertain', code: lastError || capCode };
}

// --- transfer ------------------------------------------------------------------------------------------------

async function transfer(ctx) {
  const { deps } = ctx;
  if (!(await ensureIntentLease(ctx))) return { outcome: 'deferred_intent_lease' };
  if (ctx.copyState === 'queued' && ctx.ciphertext && ctx.intentState === 'initiated') {
    // I2 committed but N4 did not: promote with the recorded session; never create again or count a failure.
    await fence(ctx);
    if (!(await deps.markCopying({ id: ctx.id, leaseToken: ctx.copyToken }))) throw new Stop('copy_lease_lost');
    ctx.copyState = 'copying';
  }
  const failedWithoutSession = ctx.intentState === 'failed' && !ctx.ciphertext;
  const path = await recoveryPath(ctx, failedWithoutSession ? LOSS_CHECK_DELAYS_MS : [0]);
  if (path.state === 'complete') return finishBytes(ctx);
  if (path.state === 'mismatch') return failDirect(ctx, 'zoom_video_path_conflict');
  if (path.state === 'partial' && !ctx.ciphertext) {
    return ctx.intentState === 'initiated'
      ? failDirect(ctx, 'zoom_video_path_conflict')
      : uncertain(ctx, { capCode: 'zoom_video_session_uncertain', lastError: 'retry_status_unknown' });
  }
  await listAndValidate(ctx);

  if (!ctx.ciphertext) {
    const created = await createSession(ctx);
    if (created.outcome) return created;
    return pump(ctx, created.uploadUrl, 0);
  }
  return resumeSession(ctx, path.state);
}

/** Existing session: read Graph's status; healthy resumes from Graph's offset, 404/410 is loss. */
async function resumeSession(ctx, initialPath) {
  const { deps } = ctx;
  const size = Number(ctx.row.declared_size);
  let uploadUrl;
  try {
    uploadUrl = deps.openUploadUrl(ctx.ciphertext);
  } catch {
    return uncertain(ctx, { capCode: 'zoom_video_session_uncertain', lastError: 'session_unreadable' });
  }
  ensure(ctx, STATUS_ALLOWANCE_MS);
  await fence(ctx);
  let status;
  try {
    status = await deps.getBrowserUploadSessionStatus(uploadUrl, { timeoutMs: Math.min(STATUS_ALLOWANCE_MS, remaining(ctx)) });
  } catch (error) {
    const code = Number(error?.status);
    if (code === 404 || code === 410) return handleLoss(ctx, code, initialPath);
    throw error;
  }
  let offset;
  let expiresAt;
  try {
    offset = exactSequentialRange(status.nextExpectedRanges, size);
    expiresAt = new Date(status.expiresAt);
    if (!Number.isFinite(expiresAt.getTime())) throw new Error('invalid expiry');
  } catch {
    return uncertain(ctx, { capCode: 'zoom_video_session_uncertain', lastError: 'session_range_invalid' });
  }
  const intentExpiresAt = intentReviewAfter(expiresAt).toISOString();
  await fence(ctx);
  if (ctx.intentState === 'failed') {
    // Healthy status after a failed/uncertain mark: restore `initiated` (this clears the lease), reacquire I1.
    const saved = await deps.recordRecoverySession({
      uploadId: ctx.id, leaseToken: ctx.intentToken, uploadUrlCiphertext: ctx.ciphertext,
      expiresAt: expiresAt.toISOString(), intentExpiresAt,
    });
    if (!saved) throw new Stop('intent_changed');
    ctx.intentToken = null;
    ctx.intentState = 'initiated';
    if (!(await ensureIntentLease(ctx))) return { outcome: 'deferred_intent_lease' };
  } else {
    const saved = await deps.refreshUploadSession({
      uploadId: ctx.id, requestId: ctx.intent.request_id, actorId: ctx.intent.actor_id, leaseToken: ctx.intentToken,
      uploadUrlCiphertext: ctx.ciphertext, expiresAt: expiresAt.toISOString(), intentExpiresAt,
    });
    if (!saved) throw new Stop('intent_changed');
  }
  if (ctx.copyState === 'queued') {
    await fence(ctx);
    if (!(await deps.markCopying({ id: ctx.id, leaseToken: ctx.copyToken }))) throw new Stop('copy_lease_lost');
    ctx.copyState = 'copying';
  }
  if (offset !== Number(ctx.row.bytes_confirmed)) {
    await fence(ctx, { cancelOk: true });
    if (!(await deps.recordProgress({ id: ctx.id, leaseToken: ctx.copyToken, bytesConfirmed: offset }))) throw new Stop('copy_lease_lost');
  }
  return pump(ctx, uploadUrl, offset);
}

/** The copy's session-create failure counts only while `queued`; a restart's failure is bounded by the restart cap. */
async function sessionCreateFailed(ctx, error) {
  if (ctx.copyState !== 'queued') throw new Transient(safeCode(error, 'zoom_video_session_create_failed'));
  await copyFence(ctx, { cancelOk: true, source: false });
  const row = await ctx.deps.recordCreateFailure({ id: ctx.id, leaseToken: ctx.copyToken, retryAfterSeconds: SESSION_CREATE_RETRY_SECONDS });
  if (!row) throw new Stop('copy_lease_lost');
  if (row.state === 'failed') {
    ctx.copyState = 'failed';
    return { outcome: 'failed', code: 'zoom_video_session_create_failed' };
  }
  return { outcome: 'session_create_failed', code: safeCode(error, 'zoom_video_session_create_failed') };
}

/** Intent readback after an ambiguous record: true recorded, false proven not recorded, null unknown. */
async function readbackRecorded(ctx) {
  try {
    const snap = await ctx.deps.getSnapshot({ id: ctx.id });
    if (!snap) return null;
    return snap.intent_state === 'initiated' && Boolean(snap.intent_has_ciphertext);
  } catch {
    return null;
  }
}

/**
 * Create a session and record it under the pump lease (I2 for `initiated`, the recovery-session writer for
 * `failed`, which clears the lease so I1 is reacquired). Returns { uploadUrl } or a terminal-for-this-tick outcome.
 */
async function createSession(ctx) {
  const { deps } = ctx;
  const row = ctx.intent;
  const size = Number(ctx.row.declared_size);
  await fence(ctx);
  ensure(ctx, STATUS_ALLOWANCE_MS);
  let session = null;
  let recorded = false;
  let safeToCancel = false;
  try {
    let sealed;
    let expiresAt;
    let intentExpiresAt;
    try {
      session = await deps.createBrowserUploadSession(row.library_name, row.folder_path, row.physical_filename, { conflictBehavior: 'fail' });
      safeToCancel = true;
      if (exactSequentialRange(session.nextExpectedRanges, size) !== 0) {
        const error = new Error('nonzero range for a fresh session');
        error.code = 'zoom_video_session_range_invalid';
        throw error;
      }
      expiresAt = new Date(session.expiresAt);
      intentExpiresAt = intentReviewAfter(expiresAt).toISOString();
      sealed = deps.sealUploadUrl(session.uploadUrl);
    } catch (error) {
      return await sessionCreateFailed(ctx, error);
    }
    await fence(ctx);
    const fromFailed = ctx.intentState === 'failed';
    const args = { uploadId: ctx.id, leaseToken: ctx.intentToken, uploadUrlCiphertext: sealed, expiresAt: expiresAt.toISOString(), intentExpiresAt };
    let saved = null;
    let writeError = null;
    try {
      saved = fromFailed ? await deps.recordRecoverySession(args) : await deps.recordIntentSession(args);
    } catch (error) {
      writeError = error;
    }
    if (!saved) {
      const readback = await readbackRecorded(ctx);
      if (readback === true) {
        saved = true; // ambiguous result, but the receipt is there: repair, not failure
      } else if (readback === false) {
        return await sessionCreateFailed(ctx, writeError || { code: 'zoom_video_session_not_recorded' });
      } else {
        safeToCancel = false; // unknown: retain, never DELETE
        throw new Transient('zoom_video_session_record_unknown');
      }
    }
    recorded = true;
    ctx.ciphertext = sealed;
    ctx.intentState = 'initiated';
    if (fromFailed) {
      ctx.intentToken = null; // the recovery-session writer clears the lease
      if (!(await ensureIntentLease(ctx))) return { outcome: 'deferred_intent_lease' };
    }
    if (ctx.copyState === 'queued') {
      await fence(ctx);
      if (!(await deps.markCopying({ id: ctx.id, leaseToken: ctx.copyToken }))) throw new Stop('copy_lease_lost');
      ctx.copyState = 'copying';
    }
    return { uploadUrl: session.uploadUrl };
  } finally {
    if (session && !recorded && safeToCancel) {
      await Promise.resolve(deps.cancelBrowserUploadSession(session.uploadUrl)).catch(() => {});
    }
  }
}

/** Session gone (status or PUT 404/410): exact-path checks, then restart (410, all absent) or uncertain. */
async function handleLoss(ctx, httpStatus, initialPath) {
  const initial = initialPath ?? (await recoveryPath(ctx, [0])).state;
  if (initial === 'complete') return finishBytes(ctx);
  const visible = await recoveryPath(ctx, LOSS_CHECK_DELAYS_MS);
  if (visible.state === 'complete') return finishBytes(ctx);
  if (initial === 'mismatch' || visible.state === 'mismatch') return failDirect(ctx, 'zoom_video_path_conflict');
  if (httpStatus === 410 && initial === 'absent' && visible.state === 'absent') return restartSession(ctx);
  return uncertain(ctx, { capCode: 'zoom_video_session_uncertain', lastError: 'retry_status_unknown' });
}

async function restartSession(ctx) {
  const { deps } = ctx;
  await fence(ctx);
  if (!(await deps.markRecoveryTerminal({ uploadId: ctx.id, leaseToken: ctx.intentToken }))) throw new Stop('intent_changed');
  ctx.intentState = 'failed';
  await copyFence(ctx, { cancelOk: true, source: false });
  const row = await deps.recordRestart({ id: ctx.id, leaseToken: ctx.copyToken });
  if (!row) throw new Stop('copy_lease_lost');
  if (row.state === 'failed') {
    ctx.copyState = 'failed';
    return { outcome: 'failed', code: row.failure_code || 'zoom_video_session_expired' };
  }
  ctx.restarts += 1;
  const created = await createSession(ctx);
  if (created.outcome) return created;
  return pump(ctx, created.uploadUrl, 0);
}

// --- pump ------------------------------------------------------------------------------------------------------

async function pump(ctx, uploadUrl, startOffset) {
  const { deps } = ctx;
  const size = Number(ctx.row.declared_size);
  let offset = startOffset;
  if (ctx.bytesFrom === null) ctx.bytesFrom = offset;
  if (!ctx.resolvedUrl) await resolveUrl(ctx);
  while (offset < size) {
    if (remaining(ctx) < CHUNK_ADMISSION_MS) return { outcome: 'budget_yield' };
    const start = offset;
    const end = Math.min(start + deps.chunkBytes, size) - 1;
    await fence(ctx);
    let bytes = null;
    for (let attempt = 0; ; attempt += 1) {
      ensure(ctx, RANGE_ALLOWANCE_MS);
      let got;
      try {
        got = await deps.fetchRecordingRange(ctx.resolvedUrl, { start, end, total: size, deadlineMs: ctx.deadline });
      } catch (error) {
        throw classifyZoom(error);
      }
      if (got.bytes) { bytes = got.bytes; break; }
      // 401/403/404/410 from the resolved URL: re-resolve once per chunk, then terminal.
      if (attempt >= 1) throw new Terminal('zoom_download_denied');
      await resolveUrl(ctx, { relist: true });
    }
    await fence(ctx);
    ensure(ctx, PUT_ALLOWANCE_MS);
    let put;
    try {
      put = await deps.putUploadSessionChunk(uploadUrl, {
        start, bytes, total: size, timeoutMs: Math.min(PUT_ALLOWANCE_MS, remaining(ctx)),
      });
    } catch (error) {
      bytes = null;
      const code = Number(error?.status);
      if (code === 404 || code === 410) return handleLoss(ctx, code, undefined);
      if (code >= 500 || error?.isTransient === true || error?.noResponse === true || !Number.isFinite(code)) throw new Transient('graph_put_failed');
      return uncertain(ctx, { capCode: 'zoom_video_session_uncertain', lastError: 'put_rejected' });
    }
    bytes = null;
    ctx.chunks += 1;
    ctx.expirationDateTime = put.expirationDateTime || ctx.expirationDateTime;
    if (end === size - 1) {
      ctx.bytesTo = size;
      return completeAfterFinalChunk(ctx);
    }
    let next = null;
    if (!put.item) {
      try { next = exactSequentialRange(put.nextExpectedRanges, size); } catch { next = null; }
    }
    if (next !== end + 1) {
      return uncertain(ctx, { capCode: 'zoom_video_session_uncertain', lastError: 'put_range_mismatch' });
    }
    offset = next;
    ctx.bytesTo = offset;
    await fence(ctx, { cancelOk: true });
    if (!(await deps.recordProgress({ id: ctx.id, leaseToken: ctx.copyToken, bytesConfirmed: offset }))) throw new Stop('copy_lease_lost');
  }
  return { outcome: 'budget_yield' };
}

/** After the final PUT: verify the exact path (ignoring the cancel flag); absent or partial retries via uncertain_checks (ruling 8a). */
async function completeAfterFinalChunk(ctx) {
  const path = await recoveryPath(ctx, [0], { cancelOk: true });
  if (path.state === 'complete') return finishBytes(ctx);
  if (path.state === 'mismatch') return failDirect(ctx, 'zoom_video_path_conflict');
  return uncertain(ctx, { capCode: 'zoom_video_upload_uncertain', retrySeconds: POST_FINAL_RETRY_SECONDS });
}

// --- end sequence: cancel and terminal source failures (plan "Server cancellation") --------------------------

/**
 * Cancel before bytes complete (`code === null`, staff cancel) or fail with a source code. Exact-path checks first
 * (a complete item is recorded and the copy ends with its identity), DELETE only when a session is recorded and
 * `deleteSession`, then abandonment and a copy-only terminal write. A 404 from DELETE is never proof.
 */
async function endTransfer(ctx, { code, deleteSession = true }) {
  const { deps } = ctx;
  ctx.ending = true;
  ctx.endCode = code;
  if (!(await ensureIntentLease(ctx))) return { outcome: 'deferred_intent_lease' };
  const first = await recoveryPath(ctx, [0]);
  if (first.state === 'complete') return finishBytes(ctx);
  if (first.state !== 'absent') return uncertain(ctx, { capCode: 'zoom_video_cancel_uncertain', lastError: 'cancel_path_uncertain' });
  let cancellation = null;
  if (ctx.ciphertext && deleteSession) {
    let uploadUrl;
    try {
      uploadUrl = deps.openUploadUrl(ctx.ciphertext);
    } catch {
      return uncertain(ctx, { capCode: 'zoom_video_cancel_uncertain', lastError: 'cancel_status_unknown' });
    }
    ensure(ctx, STATUS_ALLOWANCE_MS);
    await fence(ctx);
    try {
      cancellation = await deps.cancelBrowserUploadSession(uploadUrl);
    } catch {
      return uncertain(ctx, { capCode: 'zoom_video_cancel_uncertain', lastError: 'cancel_status_unknown' });
    }
  }
  const visible = deleteSession ? await recoveryPath(ctx, LOSS_CHECK_DELAYS_MS) : first;
  if (visible.state === 'complete') return finishBytes(ctx);
  if (visible.state !== 'absent' || (cancellation && !['cancelled', 'expired'].includes(cancellation.outcome))) {
    return uncertain(ctx, {
      capCode: 'zoom_video_cancel_uncertain',
      lastError: visible.state === 'absent' ? 'cancel_status_unknown' : 'cancel_path_uncertain',
    });
  }
  await fence(ctx);
  const abandoned = code === null
    ? await deps.cancelRecovery({ uploadId: ctx.id, leaseToken: ctx.intentToken })
    : await deps.abandonForSourceFailure({ uploadId: ctx.id, leaseToken: ctx.intentToken, failureCode: code });
  if (!abandoned) throw new Stop('intent_changed');
  ctx.intentToken = null; // abandonment clears the intent lease; the copy-only write uses the copy token alone
  ctx.ciphertext = null;
  await copyFence(ctx, { cancelOk: true, source: false });
  if (code === null) return cancelCopyOnly(ctx);
  const row = await deps.failCopy({ id: ctx.id, leaseToken: ctx.copyToken, failureCode: code });
  if (!row) throw new Stop('copy_lease_lost');
  ctx.copyState = 'failed';
  return { outcome: 'failed', code };
}

// --- S6: receipt repair, finalize hand-off, receipt inspection, configuration faults ------------------------

const ZOOM_CODE = /^zoom_[a-z0-9_]{1,75}$/;
const FINALIZE_PAUSE_CODES = new Set([
  'post_presentation_site_visit_required', 'post_presentation_site_visit_ambiguous', 'post_presentation_cycle_required',
]);
// Plan "Retry policy": terminal on the first attempt, whatever their HTTP status.
const FINALIZE_TERMINAL_CODES = new Set([
  ...TERMINAL_MP4_VALIDATION_CODES,
  'request_document_actor_unavailable', 'zoom_video_recording_replaced', 'post_presentation_site_visit_changed',
  'post_presentation_replay_mismatch', 'post_presentation_generation_ambiguous', 'post_presentation_candidate_mismatch',
]);

/**
 * Reconcile-finalized: N5a then N5 with a null token per row. A finalized intent is a registered document; the copy's
 * receipt is repaired locally (Postgres only), so this runs even when the kill switch is off. A copied-file
 * uniqueness conflict keeps the finalized intent and raises an alert.
 */
export async function reconcileFinalizedCopies(deps) {
  const rows = (await deps.listFinalizedCopies({ limit: RECONCILE_BATCH })) || [];
  let repaired = 0;
  for (const { id } of rows) {
    try {
      if (await deps.markCopied({ id, leaseToken: null })) repaired += 1;
    } catch (error) {
      if (error?.code === 'zoom_video_receipt_conflict') await receiptConflictAlert(deps, { id });
      else deps.log({ event: 'zoom_video_copy_reconcile_row_failed', copyId: id, code: safeCode(error, 'zoom_video_reconcile_error') });
    }
  }
  if (rows.length) deps.log({ event: 'zoom_video_copy_reconcile', candidates: rows.length, repaired });
  return { repaired };
}

const receiptConflictAlert = (deps, ref) => alert(deps, ref, {
  eventType: 'zoom_video_receipt_conflict',
  severity: 'error',
  summary: 'A registered Zoom video copy could not be recorded because another copy already owns this request and file.',
  stage: 'video-copy-receipt',
  key: 'receipt-conflict',
});

/** Receipt repair from the dispatch path: the intent is finalized and this tick holds the copy lease. */
async function repairReceipt(ctx) {
  await copyFence(ctx, { cancelOk: true, source: false });
  return settleCopied(ctx);
}

/** N5 with this tick's token. A uniqueness conflict fails the copy (freeing the request's active lock) and alerts. */
async function settleCopied(ctx) {
  let row;
  try {
    row = await ctx.deps.markCopied({ id: ctx.id, leaseToken: ctx.copyToken });
  } catch (error) {
    if (error?.code !== 'zoom_video_receipt_conflict') throw error;
    await receiptConflictAlert(ctx.deps, ctx);
    return failDirect(ctx, 'zoom_video_receipt_conflict');
  }
  if (!row) throw new Stop('copy_lease_lost'); // reconcile-finalized repairs it on a later tick
  ctx.copyState = 'copied';
  return { outcome: 'copied' };
}

/** Rejected candidate: copy-only failure with the mapped finalize error; identities and the intent are left alone. */
function rejectedCandidate(ctx, snap) {
  const code = CODE.test(snap.intent_last_error || '') ? snap.intent_last_error : 'zoom_video_registration_rejected';
  return failDirect(ctx, code);
}

// --- receipt inspection (I4/I5) ---------------------------------------------------------------------------

/**
 * Look up the exact generation key and bind a verified, already registered document to the intent. Never creates,
 * deletes or supersedes anything. `fence` (active copies) renews the copy lease before every read and write.
 * Returns { result: 'bound' | 'absent' | 'uncertain' | 'deferred', reason }. Absence is claimed only when the
 * Dataverse read succeeded and returned no document; every other doubt retains, backs off and alerts.
 */
async function inspectReceipt(deps, { id, requestId, copyToken = null, fence = null }) {
  const claim = await deps.claimInspection({ uploadId: id });
  if (!claim) return { result: 'deferred' };
  const row = claim.row;
  const token = claim.leaseToken;
  const renew = async () => {
    if (fence) await fence();
    if (!(await deps.renewInspection({ uploadId: id, leaseToken: token }))) throw new Stop('inspection_lease_lost');
  };
  const uncertain = async reason => {
    await alert(deps, { id, requestId }, {
      eventType: 'zoom_video_receipt_inspection_uncertain',
      summary: 'A Zoom video copy could not prove whether its recording was registered; it is retained and will be checked again.',
      stage: 'video-copy-receipt',
      key: 'inspection-uncertain',
      metadata: { reason },
    });
    return { result: 'uncertain', reason };
  };
  try {
    await renew();
    let found;
    try {
      found = await deps.materialDependencies.findDocumentByGenerationKey(row.generation_key);
    } catch {
      return await uncertain('registration_read_failed');
    }
    if (!Array.isArray(found?.records)) return await uncertain('registration_read_invalid');
    if (found.records.length === 0) return { result: 'absent' };
    if (found.records.length > 1) return await uncertain('registration_ambiguous');
    const document = found.records[0];
    await renew();
    let path;
    try {
      path = await resolveStableMp4Path(row, deps);
    } catch (error) {
      return await uncertain(error?.code === 'post_presentation_candidate_mismatch' ? 'candidate_mismatch' : 'path_read_failed');
    }
    if (path.state !== 'complete') return await uncertain('path_not_complete');
    if (!validateRecoveredMp4Row(document, {
      requestId: row.request_id,
      generationKey: row.generation_key,
      inputFingerprint: row.client_resume_fingerprint,
      fenceVersion: Number.MAX_SAFE_INTEGER, // no slot is held here; the identity checks are the verification
      candidate: path.candidate,
    })) return await uncertain('registration_mismatch');
    await renew();
    const bound = await deps.bindReceipt({
      copyId: id,
      inspectionLeaseToken: token,
      copyLeaseToken: copyToken,
      expected: { state: row.state, generationKey: row.generation_key, candidateItemId: row.candidate_item_id, lastError: row.last_error },
      verified: { requestDocumentId: document.wmkf_requestdocumentid, candidate: path.candidate },
    });
    if (!bound?.bound) return await uncertain(`bind_${safeCode({ code: bound?.reason }, 'refused')}`);
    return { result: 'bound' };
  } finally {
    await Promise.resolve(deps.releaseInspection({ uploadId: id, leaseToken: token })).catch(() => {});
  }
}

/**
 * Active copy (Q/C/R) whose intent expired or was abandoned by something other than staff: exact-registration
 * inspection before any failure (plan "Expired registration"). Bound repairs the receipt; proven absence fails the
 * copy only (identities preserved); everything else retains and backs off.
 */
async function reconcileUnsettled(ctx, snap) {
  const { deps } = ctx;
  const outcome = await inspectReceipt(deps, {
    id: ctx.id, requestId: ctx.requestId, copyToken: ctx.copyToken,
    fence: () => copyFence(ctx, { cancelOk: true, source: false }),
  });
  if (outcome.result === 'deferred') return { outcome: 'deferred_intent_lease' };
  if (outcome.result === 'bound') return settleCopied(ctx);
  if (outcome.result === 'absent') {
    if (snap.intent_state !== 'abandoned') return failDirect(ctx, 'zoom_video_intent_expired');
    // Source-failure abandonment crashed before the copy write: keep the source's own code.
    return failDirect(ctx, ZOOM_CODE.test(snap.intent_last_error || '') ? snap.intent_last_error : 'zoom_video_intent_abandoned');
  }
  await copyFence(ctx, { cancelOk: true, source: false });
  // Registering rows share the registration cap (then failed, and the due batch keeps inspecting); Q/C use the uncertain counter.
  const row = ctx.copyState === 'registering'
    ? await deps.deferRegistration({ id: ctx.id, leaseToken: ctx.copyToken })
    : await deps.recordUncertainCheck({
      id: ctx.id, leaseToken: ctx.copyToken, retryAfterSeconds: RECEIPT_RETRY_SECONDS, capFailureCode: 'zoom_video_upload_uncertain',
    });
  if (!row) throw new Stop('copy_lease_lost');
  if (row.state === 'failed') {
    ctx.copyState = 'failed';
    return { outcome: 'failed', code: row.failure_code };
  }
  return { outcome: 'receipt_uncertain', code: outcome.reason };
}

/**
 * Failed copies with an unsettled intent (ruling 16 selector, which also advances their next attempt): inspect, and
 * on a bound receipt repair the copy with N5's null-token fence. No copy lease is taken; the I4 lease sits on the intent.
 */
async function inspectFailedCopies(deps, { accessRequestId, deadline }) {
  const rows = (await deps.claimFailedDue({ limit: FAILED_INSPECTION_BATCH, accessRequestId })) || [];
  for (const row of rows) {
    if (deadline - deps.now() < INSPECTION_ALLOWANCE_MS) break;
    if (!deps.requestAllowed(row.request_id)) continue;
    const ref = { id: row.id, requestId: row.request_id };
    try {
      const outcome = await inspectReceipt(deps, ref);
      if (outcome.result === 'bound') {
        try {
          await deps.markCopied({ id: row.id, leaseToken: null });
        } catch (error) {
          if (error?.code !== 'zoom_video_receipt_conflict') throw error;
          await receiptConflictAlert(deps, ref);
        }
      }
      deps.log({ event: 'zoom_video_copy_inspection', copyId: row.id, requestId: row.request_id, result: outcome.result, reason: outcome.reason || null });
    } catch (error) {
      deps.log({ event: 'zoom_video_copy_inspection_failed', copyId: row.id, code: safeCode(error, 'zoom_video_inspection_error') });
    }
  }
}

// --- finalize hand-off (plan "Finalize hand-off", "Registration retry", decision 8) ----------------------------

/**
 * Decision 8 at finalize: with no verified same-operation document yet, a SharePoint winner other than the one staff
 * confirmed at start is terminal. A Zoom link or no winner proceeds through the existing predecessor logic.
 */
function winnerStillConfirmed(ctx) {
  return async ({ winner, winnerDocumentId, winnerSlotVersion }) => {
    if (!winner || materialBacking(winner).kind !== 'file') return;
    const confirmedId = ctx.row.confirmed_winner_document_id;
    if (confirmedId && String(confirmedId).toLowerCase() === String(winnerDocumentId).toLowerCase()
      && Number(ctx.row.confirmed_winner_slot_version) === winnerSlotVersion) return;
    throw materialError('A newer recording was saved while the video was copying.', 'zoom_video_recording_replaced', 409);
  };
}

function classifyFinalizeError(error) {
  if (error instanceof Stop) return { kind: 'lost', code: safeCode({ code: error.reason }, 'copy_lease_lost') };
  if (error instanceof Pause) return { kind: 'pause', code: safeCode({ code: error.reason }, 'access_denied') };
  const code = typeof error?.code === 'string' && CODE.test(error.code) ? error.code : null;
  if (FINALIZE_PAUSE_CODES.has(code)) return { kind: 'pause', code };
  if (FINALIZE_TERMINAL_CODES.has(code)) return { kind: 'terminal', code, validation: TERMINAL_MP4_VALIDATION_CODES.has(code) };
  // Ruling 8: retryable = flagged retryable, not a ServiceHttpError (Dataverse/Graph/timeouts), or HTTP 5xx.
  const status = Number(error?.httpStatus ?? error?.status);
  const retryable = error?.body?.retryable === true || !(error instanceof ServiceHttpError) || status >= 500
    || error?.isTransient === true || error?.noResponse === true;
  return retryable
    ? { kind: 'retry', code: code || 'zoom_video_registration_retry' }
    : { kind: 'terminal', code: code || 'zoom_video_registration_rejected', validation: false };
}

/**
 * `registering` with a recorded candidate: take I3, run the shared MP4 finalize under both fences, then N5. Every
 * lease renewal inside finalize renews the copy lease (N3) and the intent finalize lease and stops when either is
 * gone; the cancel flag is ignored after I3 (POST cancel is refused while registering).
 */
async function finalizeHandOff(ctx) {
  const { deps } = ctx;
  if (remaining(ctx) < FINALIZE_ADMISSION_MS) return { outcome: 'budget_yield' };
  const { cancel } = await copyFence(ctx, { cancelOk: true, source: false });
  if (cancel) {
    // Flag seen before I3: the copy ends cancelled with the item's identity; the intent stays `uploaded`, unregistered.
    return cancelCopyOnly(ctx, { driveId: ctx.row.sharepoint_drive_id, itemId: ctx.row.sharepoint_item_id });
  }
  try {
    assertSourceApproved(ctx); // host policy re-check at the hand-off, before any intent lease
  } catch (error) {
    if (error instanceof Terminal) return failDirect(ctx, error.code); // bytes stay unregistered; nothing to cancel
    throw error;
  }
  const claim = await deps.claimFinalize({ uploadId: ctx.id });
  if (!claim) return { outcome: 'deferred_intent_lease' };
  const intentToken = claim.leaseToken;
  const renewOrStop = async () => {
    if (!(await deps.renewCopyLease({ id: ctx.id, leaseToken: ctx.copyToken, states: ['registering'] }))) throw new Stop('copy_lease_lost');
    assertAllowed(ctx);
    const live = await deps.renewIntentFinalize({ uploadId: ctx.id, leaseToken: intentToken });
    if (!live) throw new Stop('intent_lease_lost');
    return live;
  };
  try {
    await deps.finalizeClaimed({
      row: claim.row,
      leaseToken: intentToken,
      actingUserSystemId: claim.row.actor_id,
      renewOrStop,
      beforeCreate: winnerStillConfirmed(ctx),
    }, deps.materialDependencies);
  } catch (error) {
    return finalizeFailed(ctx, intentToken, error);
  }
  return settleCopied(ctx);
}

async function finalizeFailed(ctx, intentToken, error) {
  const { deps } = ctx;
  const failure = classifyFinalizeError(error);
  // Non-terminal unless the file itself was rejected (signature, malware): that one parks the intent as a rejected candidate.
  await Promise.resolve(deps.releaseIntentFinalize({
    uploadId: ctx.id, leaseToken: intentToken, lastError: failure.code, terminal: failure.kind === 'terminal' && failure.validation === true,
  })).catch(() => {});
  if (failure.kind === 'lost' || failure.kind === 'pause') throw error; // mapped to lease_lost / paused by the tick
  if (failure.kind === 'terminal') return failDirect(ctx, failure.code);
  await copyFence(ctx, { cancelOk: true, source: false });
  const row = await deps.deferRegistration({ id: ctx.id, leaseToken: ctx.copyToken });
  if (!row) throw new Stop('copy_lease_lost');
  if (row.state === 'failed') {
    ctx.copyState = 'failed';
    return { outcome: 'failed', code: row.failure_code };
  }
  return { outcome: 'registration_retry', code: failure.code };
}

// --- ruling 21 ---------------------------------------------------------------------------------------------------

/** Zoom auth/scope fault: not the copy's fault. Alert once per deferral, release the lease with a 15 minute delay, count nothing. */
async function deferConfigFault(ctx, error) {
  await alert(ctx.deps, ctx, {
    eventType: 'zoom_video_config_error',
    severity: 'error',
    summary: 'Zoom rejected the app credentials or scope while copying a recording video; the copy is waiting and will retry.',
    stage: 'video-copy-zoom',
    key: 'config-error',
    metadata: { code: error.code },
  });
  const row = await ctx.deps.deferAttempt({ id: ctx.id, leaseToken: ctx.copyToken, retryAfterSeconds: CONFIG_RETRY_SECONDS });
  if (!row) throw new Stop('copy_lease_lost');
  return { outcome: 'config_deferred', code: error.code };
}
