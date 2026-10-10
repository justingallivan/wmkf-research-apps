/**
 * Presentation-video split tick worker (Stage 4, slice 3). Plan: docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md
 * ("Slice 3", "Cleanup and reaper", "Sandbox recipe").
 *
 * One tick: cleanup sweep (<= 2 rows), hourly orphan sweep, access check, claim one processing row, dispatch by state.
 * `queued` creates a non-persistent Sandbox and starts the detached cut; `cutting` / `uploading` poll the recorded
 * command (a still-running command releases the lease and ends the tick); `review` is the worker's last write.
 * The worker never re-runs the resolver. Before each phase it revalidates the frozen identity (copy row, SharePoint
 * source eTag/quickXorHash, current transcript revision and end) and supersedes the row when any of it changed.
 *
 * A failure or supersede never cleans the Sandbox inline; it moves the row out of processing and the cleanup sweep
 * (claimable independent of state) does the stop / usage / snapshot / delete / confirm-absent steps.
 *
 * Deviations from the plan's draft, recorded on purpose:
 *  - A cut or upload command that crashes (exit other than 0/3) is terminal (`presentation_video_cut_crashed`,
 *    `presentation_video_upload_crashed`). v1 has no automatic retry, so `cut_attempts` stays 0.
 *  - A `queued` row that already has a sandbox_name (an earlier attempt died after naming it) fails `processor_lost`
 *    rather than creating a second Sandbox; the cleanup sweep removes the first. Any error after naming fails the
 *    split in the same tick for the same reason.
 *  - The current transcript is read with `findDocumentsWithMeetingTranscriptBundle` (the plain `findDocuments` select
 *    carries no `wmkf_transcriptbundlejson`, so `confirmedPresentationEnd` would always be null).
 *
 * Logs, events and store writes carry ids, states, counts and codes only. The download URL and the upload session URL
 * exist in memory and in the Sandbox command env for the tick that uses them; the upload URL is also stored sealed.
 */
import crypto from 'node:crypto';
import { GraphService } from '../graph-service.js';
import OperationalEventService from '../operational-event-service.js';
import { presentationVideoSplitAccess, isPresentationVideoSplitRequestAllowed } from '../../utils/presentation-video-split-access.js';
import { POST_PRESENTATION_MATERIALS_DEPENDENCIES, activeBucket, sanitizeForSharePoint } from '../post-presentation-materials/material-service.js';
import { projectPostPresentationMaterials } from '../post-presentation-materials/material-model.js';
import { bindPresentationTranscript } from '../post-presentation-materials/presentation-transcript-binding.js';
import { openPresentationUploadUrl, sealPresentationUploadUrl } from '../post-presentation-materials/upload-session-crypto.js';
import { presentationVideoSandboxAdapter, isNotFound } from './presentation-video-sandbox.js';
import { CUT_SCRIPT_PY, CUT_SCRIPT_VERSION } from './presentation-video-cut-script.js';
import * as store from './presentation-video-split-store.js';

/** Work deadline: handler entry + 270 s, 30 s under the cron's 300 s maxDuration. */
export const TICK_WORK_MS = 270_000;
/** The expected SHA-256 of the pinned FFmpeg tarball (plan B4). A code constant: changing it is a reviewed commit. */
export const FFMPEG_TARBALL_SHA256 = '14020417ff8ef01470e8cb771355e65c37aff62b80fb0be41eeb7611d1360902';

const SANDBOX_DIR = '/vercel/sandbox';
const CUT_PY = `${SANDBOX_DIR}/cut.py`;
const FFMPEG_TAR = `${SANDBOX_DIR}/ffmpeg.tar.xz`;
const FFMPEG_DIR = `${SANDBOX_DIR}/ffmpeg`;
const INSTALL_RECEIPT = `${SANDBOX_DIR}/install.json`;
const WORK_DIR = `${SANDBOX_DIR}/work`;
const INSTALL_ALLOWANCE_MS = 120_000;
const UPLOAD_SETUP_ALLOWANCE_MS = 30_000;
const CONFIG_RETRY_SECONDS = 15 * 60;
const CLEANUP_BATCH = 2;
const CLEANUP_ALERT_AFTER_ATTEMPTS = 10;
const ORPHAN_BATCH = 3;
const ORPHAN_INTERVAL_MS = 55 * 60_000;
const CODE = /^[a-z0-9_]{1,80}$/;
const PROCESSING = ['queued', 'cutting', 'uploading'];

class Stop extends Error { constructor(reason) { super(reason); this.reason = reason; } }
class Yield extends Error {}
class Terminal extends Error { constructor(code) { super(code); this.code = code; } }
class Supersede extends Error { constructor(code) { super(code); this.code = code; } }
class Transient extends Error { constructor(code) { super(code); this.code = code; } }
/** A fixed configuration problem (FFmpeg blob, seal secret): the row waits, uncounted. */
class ConfigFault extends Error { constructor(code) { super(code); this.code = code; } }

const safeCode = (error, fallback) => (typeof error?.code === 'string' && CODE.test(error.code) ? error.code : fallback);
const sameId = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/** Tunables live in env, not code (memory: feedback-mutable-parameters-not-in-code). Invalid values fall back with a warning. */
export function readPresentationVideoSplitConfig(env = process.env, warn = line => console.warn(JSON.stringify(line))) {
  const pick = (name, fallback, min, max) => {
    const raw = env?.[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value >= min && value <= max) return value;
    warn({ event: 'presentation_video_config_invalid', name, code: 'presentation_video_config_invalid' });
    return fallback;
  };
  return {
    sandboxTimeoutMs: pick('PRESENTATION_VIDEO_SANDBOX_TIMEOUT_MS', 10_800_000, 600_000, 18_000_000),
    vcpus: pick('PRESENTATION_VIDEO_SANDBOX_VCPUS', 2, 1, 8),
    leaseSeconds: pick('PRESENTATION_VIDEO_LEASE_SECONDS', 600, 60, 3600),
  };
}

async function readFfmpegTarball() {
  const pathname = process.env.PRESENTATION_VIDEO_FFMPEG_BLOB_PATHNAME;
  const token = process.env.UPLOADS_BLOB_RW_TOKEN;
  if (!pathname || !token) throw new ConfigFault('presentation_video_ffmpeg_unavailable');
  let buffer;
  try {
    const { get } = await import('@vercel/blob');
    const result = await get(pathname, { access: 'private', token, useCache: false });
    if (result?.statusCode !== 200 || !result.stream) throw new Error('unavailable');
    buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
  } catch {
    throw new ConfigFault('presentation_video_ffmpeg_unavailable');
  }
  if (crypto.createHash('sha256').update(buffer).digest('hex') !== FFMPEG_TARBALL_SHA256) {
    throw new ConfigFault('presentation_video_ffmpeg_unavailable');
  }
  return buffer;
}

/** The current confirmed boundary `{ revisionId, presentationEnd: { endMs } }` or null, from the Dataverse TRANSCRIPT winner. */
async function readConfirmedBoundary(requestId) {
  const result = await POST_PRESENTATION_MATERIALS_DEPENDENCIES.findDocumentsWithMeetingTranscriptBundle(requestId);
  const { winners } = projectPostPresentationMaterials(result?.records || [], requestId);
  return bindPresentationTranscript(winners, requestId).boundary;
}

const DEFAULT_DEPENDENCIES = Object.freeze({
  now: () => Date.now(),
  log: line => console.log(JSON.stringify(line)),
  recordEvent: event => OperationalEventService.recordEvent(event),
  access: () => presentationVideoSplitAccess(),
  requestAllowed: requestId => isPresentationVideoSplitRequestAllowed(requestId),
  config: () => readPresentationVideoSplitConfig(),
  envTag: () => process.env.VERCEL_ENV || 'local',
  uploadSecret: () => process.env.EXTERNAL_LINK_SECRET,
  cutScript: { py: CUT_SCRIPT_PY, version: CUT_SCRIPT_VERSION },
  readFfmpegTarball,
  sandbox: presentationVideoSandboxAdapter,
  // store
  ...store,
  // Dataverse
  getRequest: requestId => POST_PRESENTATION_MATERIALS_DEPENDENCIES.getRequest(requestId),
  getSharePointBuckets: (...args) => POST_PRESENTATION_MATERIALS_DEPENDENCIES.getSharePointBuckets(...args),
  ensureFolderPath: (...args) => POST_PRESENTATION_MATERIALS_DEPENDENCIES.ensureFolderPath(...args),
  readConfirmedBoundary,
  // Graph
  getFileMetadataById: (...args) => GraphService.getFileMetadataById(...args),
  resolveMediaDownloadUrl: (...args) => GraphService.resolveMediaDownloadUrl(...args),
  createBrowserUploadSession: (...args) => GraphService.createBrowserUploadSession(...args),
  cancelBrowserUploadSession: (...args) => GraphService.cancelBrowserUploadSession(...args),
  sealUploadUrl: sealPresentationUploadUrl,
  openUploadUrl: openPresentationUploadUrl,
});

// Module-level: at most one orphan sweep per hour per warm instance (plus the first tick of a cold one).
let lastOrphanSweepAt = null;
export function _resetOrphanSweepForTests() { lastOrphanSweepAt = null; }

// --- tick entry --------------------------------------------------------------------------------------------

export async function runPresentationVideoSplitTick({ deadlineMs, now } = {}, dependencies = {}) {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies, ...(typeof now === 'function' ? { now } : {}) };
  const startedAt = deps.now();
  const deadline = Number.isFinite(deadlineMs) ? deadlineMs : startedAt + TICK_WORK_MS;

  // Cleanup and the orphan sweep run first and under the kill switch: they only remove Sandboxes and cost.
  try { await cleanupSweep(deps); } catch (error) { deps.log({ event: 'presentation_video_cleanup_failed', code: safeCode(error, 'presentation_video_cleanup_error') }); }
  try { await orphanSweep(deps); } catch (error) { deps.log({ event: 'presentation_video_orphan_sweep_failed', code: safeCode(error, 'presentation_video_orphan_error') }); }

  const access = deps.access();
  if (!access.valid || access.mode === 'off') return { outcome: 'access_off' };
  const cfg = deps.config();
  const claim = await deps.claimPresentationVideoSplitWork({
    accessRequestId: access.mode === 'test' ? access.requestId : null, leaseSeconds: cfg.leaseSeconds,
  });
  if (!claim) return { outcome: 'idle' };

  const ctx = { deps, deadline, cfg, row: claim.row, id: claim.row.id, requestId: claim.row.request_id, token: claim.leaseToken, state: claim.row.state };
  const fromState = ctx.state;
  let result;
  try {
    result = await guarded(ctx, () => dispatch(ctx));
  } finally {
    await Promise.resolve(deps.releasePresentationVideoSplitLease({ id: ctx.id, leaseToken: ctx.token })).catch(() => {});
  }
  deps.log({
    event: 'presentation_video_split_tick', splitId: ctx.id, requestId: ctx.requestId, outcome: result.outcome,
    code: result.code || null, fromState, toState: ctx.state, elapsedMs: deps.now() - startedAt,
  });
  return { ...result, splitId: ctx.id };
}

async function guarded(ctx, fn) {
  try {
    return await fn();
  } catch (first) {
    let error = first;
    try {
      if (error instanceof ConfigFault) return await deferConfigFault(ctx, error);
      if (error instanceof Supersede) return await endRow(ctx, 'superseded', error.code);
      if (error instanceof Terminal) return await endRow(ctx, 'failed', error.code);
    } catch (inner) {
      error = inner;
    }
    return mapError(error);
  }
}

function mapError(error) {
  if (error instanceof Stop) return { outcome: 'lease_lost', code: safeCode({ code: error.reason }, null) };
  if (error instanceof Yield) return { outcome: 'yield' };
  if (error instanceof Transient) return { outcome: 'transient', code: safeCode(error, 'presentation_video_transient') };
  const status = Number(error?.status ?? error?.response?.status);
  if (error?.isTransient === true || error?.noResponse === true || status >= 500) {
    return { outcome: 'transient', code: safeCode(error, 'presentation_video_transient') };
  }
  return { outcome: 'error', code: safeCode(error, 'presentation_video_tick_error') };
}

const remaining = ctx => ctx.deadline - ctx.deps.now();
function ensure(ctx, allowanceMs) { if (remaining(ctx) < allowanceMs) throw new Yield(); }

/** Renew the lease for the row's current state, and re-check access. A lost lease or state stops the tick. */
async function fence(ctx) {
  const renewed = await ctx.deps.renewPresentationVideoSplitLease({
    id: ctx.id, leaseToken: ctx.token, states: [ctx.state], leaseSeconds: ctx.cfg.leaseSeconds,
  });
  if (!renewed) throw new Stop('split_lease_lost');
  if (!ctx.deps.requestAllowed(ctx.requestId)) throw new Stop('access_denied');
}

async function alert(deps, { id, requestId }, { eventType, severity = 'warning', summary, stage, key, metadata }) {
  await Promise.resolve(deps.recordEvent({
    eventType, severity, summary, subsystem: 'meeting-tracker-recordings', stage, transient: false, correlationId: id,
    dedupeKey: `presentation-video:${id}:${key}`, entityRefs: requestId ? { requestId } : undefined, metadata,
  })).catch(() => {});
}

/** Move the row to failed or superseded, cancel any open upload session, alert. The Sandbox is left to cleanup. */
async function endRow(ctx, kind, code) {
  const { deps } = ctx;
  if (ctx.sessionUrl || ctx.row.upload_url_ciphertext) {
    try {
      const url = ctx.sessionUrl || deps.openUploadUrl(ctx.row.upload_url_ciphertext, deps.uploadSecret());
      await Promise.resolve(deps.cancelBrowserUploadSession(url));
    } catch { /* best effort; the session expires on its own */ }
  }
  const write = kind === 'failed' ? deps.failPresentationVideoSplit : deps.supersedePresentationVideoSplit;
  const row = await write({ id: ctx.id, leaseToken: ctx.token, failureCode: code });
  if (!row) throw new Stop('split_lease_lost');
  ctx.state = kind;
  await alert(deps, ctx, {
    eventType: `presentation_video_${kind}`, severity: kind === 'failed' ? 'error' : 'warning',
    summary: `Presentation video cut ${kind}: ${code}`, stage: kind, key: `${kind}:${code}`,
    metadata: { code, fromState: ctx.row.state, ...(ctx.outputItemId ? { outputItemId: ctx.outputItemId } : {}) },
  });
  return { outcome: kind, code };
}

async function deferConfigFault(ctx, error) {
  await ctx.deps.deferPresentationVideoSplitAttempt({ id: ctx.id, leaseToken: ctx.token, retrySeconds: CONFIG_RETRY_SECONDS });
  await alert(ctx.deps, ctx, {
    eventType: 'presentation_video_config_fault', summary: `Presentation video is waiting on configuration: ${error.code}`,
    stage: 'config', key: `config:${error.code}`, metadata: { code: error.code },
  });
  return { outcome: 'deferred', code: error.code };
}

// --- dispatch ------------------------------------------------------------------------------------------------

async function dispatch(ctx) {
  await fence(ctx);
  await revalidate(ctx);
  if (ctx.state === 'queued') return startCut(ctx);
  if (ctx.state === 'cutting') return pollCut(ctx);
  if (ctx.state === 'uploading') return pollUpload(ctx);
  throw new Stop('state_not_processing');
}

/** The frozen identity must still hold before every phase; otherwise the row is superseded. */
async function revalidate(ctx) {
  const { deps, row } = ctx;
  const copy = await deps.getPresentationVideoSourceCopy({ copyId: row.source_copy_id });
  if (!copy || copy.state !== 'copied' || !sameId(copy.sharepoint_drive_id, row.source_drive_id) || !sameId(copy.sharepoint_item_id, row.source_item_id)) {
    throw new Supersede('presentation_video_source_changed');
  }
  const item = await deps.getFileMetadataById(row.source_drive_id, row.source_item_id);
  if (!item || item.eTag !== row.source_etag || (row.source_quickxor_hash && item.quickXorHash !== row.source_quickxor_hash)) {
    throw new Supersede('presentation_video_source_changed');
  }
  const boundary = await deps.readConfirmedBoundary(ctx.requestId);
  if (!boundary || !sameId(boundary.revisionId, row.transcript_revision_id)
    || Number(boundary.presentationEnd?.endMs) !== Number(row.presentation_end_ms)) {
    throw new Supersede('presentation_video_transcript_changed');
  }
}

const receiptCode = async (deps, sbx, path, fallback) => {
  try {
    const buffer = await deps.sandbox.readFileToBuffer(sbx, path);
    const code = JSON.parse(buffer.toString('utf8'))?.code;
    return typeof code === 'string' && CODE.test(code) ? code : fallback;
  } catch { return fallback; }
};

/** queued -> cutting. */
async function startCut(ctx) {
  const { deps, row, cfg } = ctx;
  if (row.sandbox_name) throw new Terminal('processor_lost');
  ensure(ctx, INSTALL_ALLOWANCE_MS);
  // Read the tarball before naming the Sandbox, so a missing blob defers instead of failing the split.
  const tarball = await deps.readFfmpegTarball();
  const name = `s4-${row.id}`;
  if (!await deps.recordPresentationVideoSandboxName({ id: ctx.id, leaseToken: ctx.token, sandboxName: name })) throw new Stop('split_lease_lost');
  try {
    const sbx = await deps.sandbox.create({
      name, vcpus: cfg.vcpus, timeoutMs: cfg.sandboxTimeoutMs,
      tags: { app: deps.sandbox.appTag, split: row.id, env: deps.envTag() },
    });
    if (sbx.persistent !== false) throw new Terminal('presentation_video_sandbox_persistent');
    await fence(ctx);
    await deps.recordPresentationVideoSandboxCreated({ id: ctx.id, leaseToken: ctx.token });
    await deps.sandbox.writeFiles(sbx, [
      { path: CUT_PY, content: Buffer.from(deps.cutScript.py, 'utf8') },
      { path: FFMPEG_TAR, content: tarball },
    ]);
    const installExit = await deps.sandbox.run(sbx, {
      cmd: 'python3', args: [CUT_PY, 'install'],
      env: { FFMPEG_TAR, FFMPEG_SHA256: FFMPEG_TARBALL_SHA256, FFMPEG_DIR, INSTALL_RECEIPT },
    });
    if (installExit === 3) throw new Terminal(await receiptCode(deps, sbx, INSTALL_RECEIPT, 'presentation_video_install_failed'));
    if (installExit !== 0) throw new Terminal('presentation_video_install_failed');

    await fence(ctx);
    const media = await deps.resolveMediaDownloadUrl(row.source_drive_id, row.source_item_id);
    if (media.eTag !== row.source_etag) throw new Supersede('presentation_video_source_changed');
    await deps.sandbox.updateNetworkPolicy(sbx, { allow: [new URL(media.downloadUrl).hostname] });
    const commandId = await deps.sandbox.runDetached(sbx, {
      cmd: 'python3', args: [CUT_PY, 'cut'],
      env: {
        SOURCE_URL: media.downloadUrl, SOURCE_SIZE: String(row.source_size), CUT_MS: String(row.presentation_end_ms),
        FFMPEG_BIN_DIR: `${FFMPEG_DIR}/bin`, WORK_DIR,
      },
    });
    if (!await deps.recordPresentationVideoCutStarted({ id: ctx.id, leaseToken: ctx.token, commandId })) throw new Stop('split_lease_lost');
    ctx.state = 'cutting';
    return { outcome: 'cut_started' };
  } catch (error) {
    // The Sandbox is already named on the row: fail now (cleanup removes it) rather than leave a named queued row.
    if (error instanceof Stop || error instanceof Yield || error instanceof Terminal || error instanceof Supersede) throw error;
    throw new Terminal('presentation_video_start_failed');
  }
}

async function lookupRunning(ctx) {
  const { deps, row } = ctx;
  const sbx = await deps.sandbox.get(row.sandbox_name);
  if (!sbx) throw new Terminal('processor_lost');
  let command;
  try {
    command = await deps.sandbox.commandState(sbx, row.sandbox_command_id);
  } catch (error) {
    if (isNotFound(error)) throw new Terminal('processor_lost');
    throw error;
  }
  if (command.exitCode === null) {
    // Never started a probe command (it could resume a stopped Sandbox): a stopped Sandbox with an unfinished command is lost.
    if (!['pending', 'running'].includes(sbx.status)) throw new Terminal('presentation_video_sandbox_stopped');
    return { sbx, running: true };
  }
  return { sbx, running: false, exitCode: command.exitCode };
}

const sanitizeReceipt = receipt => {
  const out = {};
  for (const [key, value] of Object.entries(receipt).slice(0, 40)) {
    if (!/^[A-Za-z0-9_]{1,60}$/.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string' && value.length <= 200 && !value.includes('://')) out[key] = value;
  }
  return out;
};

/** cutting: poll; on success create the upload session and start the upload. */
async function pollCut(ctx) {
  const { deps, row } = ctx;
  const found = await lookupRunning(ctx);
  if (found.running) return { outcome: 'polling' };
  if (found.exitCode === 3) throw new Terminal(await receiptCode(deps, found.sbx, `${WORK_DIR}/receipt.json`, 'presentation_video_cut_failed'));
  if (found.exitCode !== 0) throw new Terminal('presentation_video_cut_crashed');

  let receipt = null;
  try {
    const buffer = await deps.sandbox.readFileToBuffer(found.sbx, `${WORK_DIR}/receipt.json`);
    receipt = JSON.parse(buffer.toString('utf8'));
  } catch { /* invalid below */ }
  const valid = receipt && receipt.ok === true && receipt.scriptVersion === deps.cutScript.version
    && Number(receipt.cutMs) === Number(row.presentation_end_ms)
    && Number.isSafeInteger(receipt.outputSize) && receipt.outputSize > 0
    && typeof receipt.outputQuickXorHash === 'string' && receipt.outputQuickXorHash.length > 0 && receipt.outputQuickXorHash.length <= 100;
  if (!valid) throw new Terminal('presentation_video_receipt_invalid');

  ensure(ctx, UPLOAD_SETUP_ALLOWANCE_MS);
  const secret = deps.uploadSecret();
  if (typeof secret !== 'string' || secret.length < 32) throw new ConfigFault('presentation_video_upload_secret_unavailable');
  await fence(ctx);
  const request = await deps.getRequest(ctx.requestId);
  const requestNum = request?.akoya_requestnum;
  const bucket = activeBucket(await deps.getSharePointBuckets(ctx.requestId, requestNum));
  if (!bucket) throw new Terminal('presentation_video_folder_unavailable');
  const folder = `${String(bucket.folder).replace(/\/+$/, '')}/Post Site Visit Materials`;
  await deps.ensureFolderPath(bucket.library, folder);
  const filename = `${sanitizeForSharePoint(requestNum || 'Request')}-Presentation-Video-${row.id}.mp4`;
  const session = await deps.createBrowserUploadSession(bucket.library, folder, filename, { conflictBehavior: 'fail' });
  ctx.sessionUrl = session.uploadUrl;
  try {
    const sealed = deps.sealUploadUrl(session.uploadUrl, secret);
    await deps.sandbox.updateNetworkPolicy(found.sbx, { allow: [new URL(session.uploadUrl).hostname] });
    const commandId = await deps.sandbox.runDetached(found.sbx, {
      cmd: 'python3', args: [CUT_PY, 'upload'], env: { UPLOAD_URL: session.uploadUrl, WORK_DIR },
    });
    const recorded = await deps.recordPresentationVideoCutReceiptAndUploadStarted({
      id: ctx.id, leaseToken: ctx.token, verificationReceipt: { ...sanitizeReceipt(receipt), uploadDriveId: session.driveId },
      uploadUrlCiphertext: sealed, uploadSessionExpiresAt: session.expiresAt ?? null, commandId,
    });
    if (!recorded) throw new Stop('split_lease_lost');
  } catch (error) {
    // The session is not durable on the row: cancel it so a later tick starts a clean one.
    await Promise.resolve(deps.cancelBrowserUploadSession(session.uploadUrl)).catch(() => {});
    ctx.sessionUrl = null;
    throw error;
  }
  ctx.sessionUrl = null;
  ctx.state = 'uploading';
  return { outcome: 'upload_started' };
}

/** uploading: poll; on success verify the item in SharePoint against the receipt (hard check) and move to review. */
async function pollUpload(ctx) {
  const { deps, row } = ctx;
  const found = await lookupRunning(ctx);
  if (found.running) return { outcome: 'polling' };
  if (found.exitCode !== 0) throw new Terminal(found.exitCode === 3 ? 'presentation_video_upload_failed' : 'presentation_video_upload_crashed');

  const receipt = row.verification_receipt || {};
  let upload = null;
  try {
    upload = JSON.parse((await deps.sandbox.readFileToBuffer(found.sbx, `${WORK_DIR}/upload.json`)).toString('utf8'));
  } catch { /* mismatch below */ }
  const driveId = receipt.uploadDriveId;
  if (!upload || upload.ok !== true || typeof upload.itemId !== 'string' || !upload.itemId || typeof driveId !== 'string' || !driveId) {
    throw new Terminal('presentation_video_output_mismatch');
  }
  ctx.outputItemId = upload.itemId;
  await fence(ctx);
  const item = await deps.getFileMetadataById(driveId, upload.itemId);
  if (!item || item.id !== upload.itemId || Number(item.size) !== Number(receipt.outputSize)
    || typeof item.quickXorHash !== 'string' || item.quickXorHash !== receipt.outputQuickXorHash || !item.eTag) {
    throw new Terminal('presentation_video_output_mismatch');
  }
  const moved = await deps.markPresentationVideoSplitReview({
    id: ctx.id, leaseToken: ctx.token, outputDriveId: driveId, outputItemId: item.id, outputVersionId: null,
    outputEtag: item.eTag, outputSize: Number(item.size), outputQuickXorHash: item.quickXorHash,
  });
  if (!moved) throw new Stop('split_lease_lost');
  ctx.state = 'review';
  return { outcome: 'review' };
}

// --- cleanup sweep and orphan sweep ---------------------------------------------------------------------------

const tolerateGone = async fn => { try { return await fn(); } catch (error) { if (isNotFound(error)) return null; throw error; } };

/**
 * Idempotent teardown by name. `persistUsage` runs after stop and before delete. Returns the content-free receipt.
 * Throws when the Sandbox is still present at the end, so the caller retries later.
 */
async function teardownSandbox(deps, name, { persistUsage, onSnapshot }) {
  const found = await deps.sandbox.get(name);
  const receipt = { existed: Boolean(found), snapshotsDeleted: 0 };
  if (found) {
    const usage = await deps.sandbox.stopAndReadUsage(found);
    if (persistUsage) await persistUsage(usage);
    const snapshots = (await tolerateGone(() => deps.sandbox.listSnapshots(found))) || [];
    for (const snapshot of snapshots) {
      await tolerateGone(() => deps.sandbox.deleteSnapshot(snapshot));
      receipt.snapshotsDeleted += 1;
      await onSnapshot();
    }
    await tolerateGone(() => deps.sandbox.deleteSandbox(found));
    if (await deps.sandbox.get(name)) throw new Error('sandbox_still_present');
  }
  return receipt;
}

async function cleanupSweep(deps) {
  const rows = await deps.claimPresentationVideoSplitCleanup({ limit: CLEANUP_BATCH });
  for (const row of rows) {
    try {
      const receipt = await teardownSandbox(deps, row.sandbox_name, {
        persistUsage: usage => deps.recordPresentationVideoSandboxUsage({ id: row.id, ...usage }),
        onSnapshot: () => alert(deps, { id: row.id, requestId: row.request_id }, {
          eventType: 'presentation_video_snapshot_deleted', summary: 'A presentation video Sandbox had a snapshot; it was deleted.',
          stage: 'cleanup', key: `snapshot:${row.cleanup_attempts}`,
        }),
      });
      await deps.markPresentationVideoSandboxCleaned({ id: row.id, cleanupReceipt: receipt });
      deps.log({ event: 'presentation_video_cleanup', splitId: row.id, attempts: row.cleanup_attempts, outcome: 'cleaned' });
    } catch (error) {
      const code = safeCode(error, 'presentation_video_cleanup_error');
      deps.log({ event: 'presentation_video_cleanup', splitId: row.id, attempts: row.cleanup_attempts, outcome: 'retry', code });
      if (row.cleanup_attempts >= CLEANUP_ALERT_AFTER_ATTEMPTS) {
        await alert(deps, { id: row.id, requestId: row.request_id }, {
          eventType: 'presentation_video_cleanup_failing', severity: 'error', stage: 'cleanup',
          summary: 'A presentation video Sandbox could not be cleaned up.', key: `cleanup:${row.cleanup_attempts}`,
          metadata: { attempts: row.cleanup_attempts, code },
        });
      }
    }
  }
}

/** Sandboxes created for this environment whose split row is missing or already cleaned (an interrupted create). */
async function orphanSweep(deps) {
  const minute = new Date(deps.now()).getUTCMinutes();
  const due = lastOrphanSweepAt === null || (minute === 0 && deps.now() - lastOrphanSweepAt >= ORPHAN_INTERVAL_MS);
  if (!due) return;
  lastOrphanSweepAt = deps.now();
  const env = deps.envTag();
  const names = (await deps.sandbox.listTagged()).filter(item => item.tags?.env === env && typeof item.name === 'string').map(item => item.name);
  if (names.length === 0) return;
  const uncleaned = new Set(await deps.listUncleanedPresentationVideoSandboxNames({ names }));
  for (const name of names.filter(candidate => !uncleaned.has(candidate)).slice(0, ORPHAN_BATCH)) {
    try {
      await teardownSandbox(deps, name, { persistUsage: null, onSnapshot: async () => {} });
      await alert(deps, { id: name, requestId: null }, {
        eventType: 'presentation_video_orphan_sandbox_cleaned', summary: 'An orphan presentation video Sandbox was deleted.',
        stage: 'cleanup', key: 'orphan',
      });
    } catch (error) {
      deps.log({ event: 'presentation_video_orphan_cleanup_failed', code: safeCode(error, 'presentation_video_cleanup_error') });
    }
  }
}
