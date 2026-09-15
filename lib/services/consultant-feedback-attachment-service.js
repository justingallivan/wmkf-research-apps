/**
 * Consultant Feedback slice 2 attachment lifecycle
 * (docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md §4 "Slice 2 registry
 * contract" / "Slice 2 attachment lifecycle").
 *
 * Reuses `lib/services/portal-upload-staging.js` verbatim (mint → claim
 * lease → load bytes → record candidate → complete/reject) with the
 * `consultant_feedback` scope. `mintAttachmentUpload` is the staff-side mint;
 * `finalizeAttachmentUpload` performs plan §4 steps 5-7 (Graph upload,
 * registry create, feedback bind) — the caller (the finalize route) performs
 * steps 3-4 (claim, load+scan) and step 8 (complete), exactly as
 * `pages/api/external/materials/[token]/finalize.js` does for
 * `finalizeMaterialUpload`.
 *
 * Registered request-document writer (`scripts/check-request-document-writers.js`):
 * the one registry-create call below carries
 * `actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED` — staff
 * identity is already captured on the Postgres `consultant_feedback` row's
 * `created_by`/`updated_by`, matching `contributor-service.js`'s policy for
 * the same reason (no per-artifact explicit-actor schema for this producer).
 */
import crypto from 'node:crypto';
import * as requestDocumentAdapter from '../dataverse/adapters/request-document.js';
import * as grantRequestAdapter from '../dataverse/adapters/grant-request.js';
import { GraphService } from './graph-service.js';
import { ServiceHttpError } from './service-http-error.js';
import { scanBytes } from './cloudmersive-scan.js';
import { isVirusScanEnabled } from '../utils/virus-scan-config.js';
import { getRequestSharePointBuckets } from '../utils/sharepoint-buckets.js';
import { isGuid } from '../utils/guid.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from './request-document-actor-service.js';
import {
  PORTAL_UPLOAD_SCOPES,
  createPortalUpload,
  staffActorBinding,
  recordPortalUploadCandidate,
  clearPortalUploadCandidate,
  discardPortalUploadCandidate,
} from './portal-upload-staging.js';
import { getUploadMaxMb, uploadMaxBytes } from './site-visit-materials/upload-cap.js';
import { writeFeedbackEntry, updateFeedbackEntry, getFeedbackEntryForFilename } from './consultant-feedback-service.js';
import { meetingDateToCycleCode } from '../utils/cycle-code.js';

const REQUEST_SELECT = ['akoya_requestid', 'akoya_requestnum', 'wmkf_meetingdate'];
const PRODUCER = 'consultant-feedback';
const FOLDER_NAME = 'Consultant Feedback';

// Plan §4: attachments restricted to PDF and DOCX (not the broader
// PORTAL_DOCUMENT_CONTENT_TYPES allowlist used by other document scopes).
export const CONSULTANT_FEEDBACK_CONTENT_TYPES = Object.freeze([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  getSharePointBuckets: getRequestSharePointBuckets,
  ensureFolderPath: (library, folder) => GraphService.ensureFolderPath(library, folder),
  uploadFile: (...args) => GraphService.uploadFileLarge(...args),
  findDocumentByGenerationKey: (key) => requestDocumentAdapter.findByGenerationKey(key),
  createDocument: (payload, options) => requestDocumentAdapter.create(payload, options),
  supersedeDocument: (id) => requestDocumentAdapter.update(
    id,
    { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED },
    { actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED, actorContext: { operation: 'consultant-feedback-attachment-loser' } },
  ),
  scanEnabled: isVirusScanEnabled,
  scanBytes,
  getUploadMaxMb,
  createPortalUpload,
  recordPortalUploadCandidate,
  clearPortalUploadCandidate,
  discardPortalUploadCandidate,
  writeFeedbackEntry,
  updateFeedbackEntry,
  getFeedbackEntryForFilename,
  randomUUID: () => crypto.randomUUID(),
});

function attachmentError(message, code, httpStatus = 409, extras = {}) {
  return new ServiceHttpError(message, { httpStatus, code, body: { ok: false, reason: code, error: message, ...extras } });
}

function badRequest(message, reason) {
  return new ServiceHttpError(message, { httpStatus: 400, body: { error: message, reason } });
}

function activeBucket(buckets) {
  const list = Array.isArray(buckets) ? buckets : [];
  return list.find((bucket) => bucket.source === 'dynamics' && String(bucket.library).toLowerCase() === 'akoya_request')
    || list.find((bucket) => bucket.source === 'dynamics')
    || null;
}

/** SharePoint refuses " * : < > ? / \ | in item names. */
function sanitizeForSharePoint(value) {
  return String(value || '').replace(/["*:<>?|\\/]/g, '').replace(/\s+/g, ' ').trim();
}

function extensionFor(contentType) {
  return contentType === 'application/pdf' ? '.pdf' : '.docx';
}

function buildFilename(requestNumber, consultantName, receivedOn, contentType) {
  const safeName = sanitizeForSharePoint(consultantName || 'Consultant');
  const safeDate = sanitizeForSharePoint(receivedOn || '');
  return `${FOLDER_NAME}-${requestNumber}-${safeName}-${safeDate}${extensionFor(contentType)}`;
}

function scanIsMisconfigured(error) {
  const status = Number(error?.status);
  return status === 401 || status === 403
    || (error?.serviceName === 'cloudmersive' && status === 500 && error?.isTransient === false);
}

/**
 * Staff mint: a private, request-bound, actor-bound staging row for one
 * PDF/DOCX attachment. `resourceId` is the request id so a finalize can only
 * claim a lease scoped to the request it was minted for.
 */
export async function mintAttachmentUpload({
  requestId, actorProfileId, filename, contentType, size,
}, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(requestId)) throw badRequest('requestId must be a GUID.', 'invalid_request_id');
  if (!Number.isSafeInteger(actorProfileId) && !/^\d+$/.test(String(actorProfileId || ''))) {
    throw badRequest('actorProfileId is required.', 'invalid_actor');
  }
  const cap = await dependencies.getUploadMaxMb();
  const maxBytes = uploadMaxBytes(cap.maxMb);
  if (!Number.isSafeInteger(size) || size <= 0) throw badRequest('size must be a positive integer.', 'invalid_size');
  if (size > maxBytes) throw attachmentError(`Files larger than ${cap.maxMb} MB cannot be uploaded here.`, 'file_too_large', 400);

  return dependencies.createPortalUpload({
    scope: PORTAL_UPLOAD_SCOPES.CONSULTANT_FEEDBACK,
    resourceId: requestId,
    actorBinding: staffActorBinding(actorProfileId),
    filename,
    contentType,
    maxBytes,
    allowedContentTypes: CONSULTANT_FEEDBACK_CONTENT_TYPES,
  });
}

/**
 * Plan §4 steps 5-7. The caller has already claimed the staging lease and
 * loaded+verified (and, when enabled, scanned) the bytes — this function
 * uploads to SharePoint, creates the registry row (replay-safe by generation
 * key), and binds the entry, inside the finalize route's overall lease.
 *
 * Exactly one of `entryId` (bind to an existing entry via `updateFeedbackEntry`)
 * or `newEntry` (attachment-only create via `writeFeedbackEntry`) must be
 * supplied. On a bind conflict (`attachment_conflict` — a race with another
 * finalize or a delete), the just-created registry row is superseded and its
 * Graph item discarded before the error is thrown, so a Ready-but-unbound
 * registry row is never left behind by the loser.
 */
export async function finalizeAttachmentUpload({
  requestId, actorProfileId, file, stagingId, entryId = null, newEntry = null,
}, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(requestId)) throw badRequest('requestId must be a GUID.', 'invalid_request_id');
  if (!isGuid(stagingId)) throw badRequest('stagingId must be a GUID.', 'invalid_staging_id');
  if (Boolean(entryId) === Boolean(newEntry)) {
    throw badRequest('Provide exactly one of entryId or newEntry.', 'invalid_bind_target');
  }

  const request = await dependencies.getRequest(requestId);
  if (!request?.akoya_requestid) throw attachmentError('The request could not be resolved.', 'not_found', 404);

  if (dependencies.scanEnabled()) {
    let scan;
    try {
      scan = await dependencies.scanBytes(file.buffer, file.filename);
    } catch (error) {
      if (scanIsMisconfigured(error)) throw attachmentError('The malware scanner is not configured correctly.', 'scan_misconfigured', 500);
      throw attachmentError('The file could not be scanned. Try again shortly.', 'scan_unavailable', 503);
    }
    const verdict = scan?.scan_result ?? scan?.scanResult ?? null;
    if (verdict === 'infected') throw attachmentError('The file failed the malware scan.', 'scan_infected', 422);
    if (verdict !== 'clean') throw attachmentError('The file could not be scanned. Try again shortly.', 'scan_unavailable', 503);
  }

  const sha256 = file.sha256 || crypto.createHash('sha256').update(file.buffer).digest('hex');
  // One staged upload is one operation: the generation key is derived from
  // the staging id (not the future feedback row id — Codex AR-1 finding 1
  // closed this circular dependency for attachment-only entries), so a retry
  // reuses the registry row it already created.
  const generationKey = crypto.createHash('sha256')
    .update(`${request.akoya_requestid}|${REQUEST_DOCUMENT_ARTIFACT_TYPE.CONSULTANT_FEEDBACK}|${stagingId}|${sha256}`)
    .digest('hex');

  const existing = await dependencies.findDocumentByGenerationKey(generationKey);
  const existingRecords = existing?.records || [];
  let registryId;
  let createdFilename;

  if (existingRecords.length > 1) {
    // Ambiguous — more than one registry row claims this exact generation
    // key. Fail closed: never guess which row is authoritative, never
    // re-upload or re-create (that would make a third).
    throw attachmentError('This attachment cannot be finalized (ambiguous registry state).', 'attachment_replay_ambiguous', 409);
  }

  if (existingRecords.length === 1) {
    // Replay after a lost response past step 6: the Graph upload and
    // registry create already committed under this exact generation key —
    // UNLESS a later operation already superseded (or otherwise disqualified)
    // this exact row, in which case its file may already be gone and binding
    // to it would attach a dead reference. That is permanent, not retryable.
    const row = existingRecords[0];
    const rowReady = row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY;
    const rowSuperseded = row.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED;
    if (!rowReady || rowSuperseded) {
      throw attachmentError('This attachment can no longer be finalized.', 'attachment_replay_dead', 409);
    }
    registryId = row.wmkf_requestdocumentid;
    createdFilename = row.wmkf_filename;
  } else {
    // Step-5 recovery (Codex R3 finding): a candidate recorded by an EARLIER
    // attempt for THIS exact operation must be reused, never silently
    // overwritten by a second upload — that would permanently lose the only
    // cleanup identity for the first one.
    const existingCandidate = file.candidate || null;
    let uploaded;
    // Reused on replay from the candidate itself (`existingCandidate` already
    // has the folder identity baked into its filename); recomputed for a
    // fresh upload. Only used for the registry's informational
    // `wmkf_sharepointfolderpath` field below, never re-derived from it.
    let folderPath = null;
    if (existingCandidate && existingCandidate.generationKey === generationKey) {
      // The bytes for this exact operation were already accepted by
      // SharePoint (step 5 committed) before something failed en route to
      // the registry create (step 6). Finish from the recorded identity —
      // no second Graph call.
      uploaded = {
        id: existingCandidate.itemId,
        driveId: existingCandidate.driveId,
        versionId: existingCandidate.versionId || null,
        name: existingCandidate.filename,
        siteId: null,
        webUrl: null,
        eTag: null,
        size: file.buffer.length,
        lastModified: null,
      };
    } else {
      if (existingCandidate) {
        // A candidate is recorded, but for a DIFFERENT operation (a stale
        // leftover from an earlier, unrelated finalize body on this same
        // staging row). Discard its Graph item and clear the ledger slot
        // BEFORE uploading, so this attempt's own `recordPortalUploadCandidate`
        // below never overwrites it silently.
        // Fail closed: the ledger slot is cleared ONLY when the discard is
        // confirmed. A thrown or falsy discard keeps the stale candidate as the
        // only cleanup identity for that foreign item, and this attempt stops
        // rather than overwrite it.
        let discarded = false;
        try {
          discarded = Boolean(await dependencies.discardPortalUploadCandidate(existingCandidate));
        } catch (error) {
          console.error('[consultant-feedback-attachment] stale candidate discard failed', { message: error?.message });
        }
        if (!discarded) {
          throw attachmentError('A previous upload for this file is still being cleaned up. Try again shortly.', 'stale_candidate_retained', 503);
        }
        await dependencies.clearPortalUploadCandidate({ stagingId, leaseToken: file.leaseToken });
      }
      const bucket = activeBucket(await dependencies.getSharePointBuckets(request.akoya_requestid, request.akoya_requestnum));
      if (!bucket) throw attachmentError('The request has no active SharePoint folder.', 'folder_unavailable', 503);
      folderPath = `${String(bucket.folder).replace(/\/+$/, '')}/${FOLDER_NAME}`;
      let consultantName = 'Consultant';
      let receivedOn = '';
      if (entryId) {
        const info = await dependencies.getFeedbackEntryForFilename({ id: entryId, requestId });
        if (info) {
          consultantName = info.consultantName || consultantName;
          receivedOn = info.receivedOn || receivedOn;
        }
      } else {
        consultantName = newEntry?.consultantName || consultantName;
        receivedOn = newEntry?.receivedOn || receivedOn;
      }
      const filename = buildFilename(request.akoya_requestnum, consultantName, receivedOn, file.mimeType);
      await dependencies.ensureFolderPath(bucket.library, folderPath);
      // 'rename' (not 'replace'): each attachment is its own SharePoint item —
      // two attachments on one request (or a retried upload that races an
      // unrelated one) must never collide on the same canonical name and
      // silently overwrite a different entry's file. The registry filename
      // below always uses `uploaded.name`, SharePoint's actual (possibly
      // renamed) name, never the requested `filename`.
      // Inherent window (same as materials/grantee uploads): a crash between
      // Graph accepting these bytes and `recordPortalUploadCandidate`
      // committing below leaves this exact upload briefly untracked.
      uploaded = await dependencies.uploadFile(bucket.library, folderPath, filename, file.buffer, file.mimeType, { conflictBehavior: 'rename' });
      if (!uploaded?.id || !uploaded?.driveId) throw attachmentError('SharePoint did not return the stored file identity.', 'upload_unconfirmed', 502);

      const candidate = {
        requestId: request.akoya_requestid,
        generationKey,
        driveId: uploaded.driveId,
        itemId: uploaded.id,
        versionId: uploaded.versionId || null,
        filename: uploaded.name,
      };
      // Candidate recorded BEFORE the registry create (step 6), so a crash
      // between them leaves a discoverable orphan the staging cleanup sweep
      // can reconcile, and a retry (above) reuses this exact identity
      // instead of uploading again.
      await dependencies.recordPortalUploadCandidate({ stagingId, leaseToken: file.leaseToken, candidate });
    }

    const created = await dependencies.createDocument({
      wmkf_name: `${request.akoya_requestnum} consultant feedback (staff upload)`,
      'wmkf_Request@odata.bind': `/akoya_requests(${request.akoya_requestid})`,
      wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.CONSULTANT_FEEDBACK,
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
      wmkf_generationkey: generationKey,
      wmkf_cyclecode: meetingDateToCycleCode(request.wmkf_meetingdate),
      wmkf_inputfingerprint: sha256,
      wmkf_claimtoken: dependencies.randomUUID(),
      wmkf_producer: PRODUCER,
      wmkf_contenttype: file.mimeType,
      wmkf_contenthash: sha256,
      wmkf_sharepointsiteid: uploaded.siteId || null,
      wmkf_sharepointdriveid: uploaded.driveId,
      wmkf_sharepointitemid: uploaded.id,
      wmkf_sharepointweburl: uploaded.webUrl || null,
      wmkf_sharepointversionid: uploaded.versionId || null,
      wmkf_sharepointetag: uploaded.eTag || null,
      wmkf_sharepointfolderpath: folderPath,
      wmkf_filename: uploaded.name,
      wmkf_filesize: uploaded.size ?? file.buffer.length,
      wmkf_sharepointlastmodified: uploaded.lastModified || null,
    }, { actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED, actorContext: { operation: 'consultant-feedback-attachment', requestId: request.akoya_requestid } });
    registryId = created?.wmkf_requestdocumentid || created?.id || null;
    if (!registryId) throw attachmentError('The registry did not confirm the stored file.', 'registry_unconfirmed', 503);
    createdFilename = uploaded.name;
  }

  try {
    const bound = entryId
      ? await dependencies.updateFeedbackEntry({ id: entryId, requestId, actorProfileId, patch: { requestdocumentId: registryId } })
      : await dependencies.writeFeedbackEntry({ ...newEntry, requestId, actorProfileId, requestdocumentId: registryId });
    return { requestdocumentId: registryId, feedbackId: bound.id, filename: createdFilename };
  } catch (error) {
    // Binding the IDENTICAL registry id a row already holds is an idempotent
    // success inside `updateFeedbackEntry` (a replay after a crash before
    // `completePortalUpload`), never an error here — so any error reaching
    // this catch is a genuine, permanent loser outcome or an unrelated
    // failure, never "already bound to the id we just proved out."
    const loserReason = error instanceof ServiceHttpError ? (error.body?.reason || error.code) : null;
    const isLoser = loserReason === 'attachment_conflict' || loserReason === 'attachment_target_gone';
    if (!isLoser) {
      // Any OTHER bind failure — eligibility (400), a transient Postgres
      // error — leaves the registry row Ready and unbound. The staging row
      // is released (not rejected) by the caller for these codes, and a
      // retry with the SAME staging id finds this exact row again by
      // generation key and performs only step 7: superseding it here would
      // strand a live SharePoint item behind a Superseded row that a retry
      // would then bind to as dead (the bug this fix closes).
      throw error;
    }
    // Loser-side cleanup (§4 step 7): either another finalize won the race
    // (`attachment_conflict`) or a delete won it out from under this finalize
    // (`attachment_target_gone`) — either way the registry row this finalize
    // just proved out (or replayed) will never bind, so supersede it and
    // discard the Graph item now rather than leaving a Ready-but-unbound row
    // for a retry to attach to. The caller (finalize route) rejects the
    // staging row on both these codes, so there is no retry to protect here.
    try {
      await dependencies.supersedeDocument(registryId);
    } catch (supersedeError) {
      console.error('[consultant-feedback-attachment] loser-side supersede failed', { registryId, message: supersedeError?.message });
    }
    try {
      const registry = await dependencies.findDocumentByGenerationKey(generationKey);
      const records = registry?.records || [];
      const row = records.length === 1 ? records[0] : null;
      if (records.length > 1) {
        console.error('[consultant-feedback-attachment] ambiguous generation-key match on loser-side discard; skipping', { registryId, count: records.length });
      } else if (row?.wmkf_sharepointdriveid && row?.wmkf_sharepointitemid) {
        await dependencies.discardPortalUploadCandidate({ driveId: row.wmkf_sharepointdriveid, itemId: row.wmkf_sharepointitemid });
      }
    } catch (discardError) {
      console.error('[consultant-feedback-attachment] loser-side discard failed', { registryId, message: discardError?.message });
    }
    // Rethrow the ORIGINAL error (not a relabeled one): its httpStatus/reason
    // (`attachment_conflict` or `attachment_target_gone`) already carries the
    // exact loser reason the route and the client need.
    throw error;
  }
}
