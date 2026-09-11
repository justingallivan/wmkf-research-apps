/**
 * Applicant-side service for the materials contributor link
 * (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §16, PR 2): what the page shows
 * a PI or liaison, and the finalize step that turns a claimed staged upload
 * into a SharePoint file plus a request-document registry row. The registry is
 * the only owner of received files; the collection row never stores them.
 */
import crypto from 'node:crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { scanBytes } from '../cloudmersive-scan.js';
import { isVirusScanEnabled } from '../../utils/virus-scan-config.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets';
import { sanitizeBlobFilename } from '../../utils/blob-filename.js';
import { meetingDateToCycleCode } from '../../utils/cycle-code.js';
import { validateSiteVisitMaterial } from '../../utils/site-visit-material-file.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../request-document-actor-service.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import { SITE_VISIT_MATERIALS_FOLDERS } from '../../../shared/config/siteVisitMaterials.js';
import { getUploadMaxMb, uploadMaxBytes } from './upload-cap.js';
import { canonicalFilename, matchReceivedFiles } from './collection-service.js';
import { acquireSlotLease, releaseSlotLease } from './collection-store.js';
import { recordPortalUploadCandidate } from '../portal-upload-staging.js';
import AlertRecipients from '../alert-recipients.js';

const REQUEST_SELECT = ['akoya_requestid', 'akoya_requestnum', 'akoya_title', 'wmkf_meetingdate', '_akoya_applicantid_value'];
const PRODUCER = 'site-visit-materials-portal';
const SLOT_ARTIFACT_TYPE = Object.freeze({
  presentation_pdf: REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
  presentation_source: REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
  participant_bios: REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS,
  other: REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS,
});
const OUT_OF_SYNC_MS = 60 * 60 * 1000;

export const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  findDocumentsByRequest: (requestId) => requestDocumentAdapter.findByRequest(requestId),
  findDocumentByGenerationKey: (key) => requestDocumentAdapter.findByGenerationKey(key),
  getSharePointBuckets: getRequestSharePointBuckets,
  ensureFolderPath: (library, folder) => GraphService.ensureFolderPath(library, folder),
  uploadFile: (...args) => GraphService.uploadFileLarge(...args),
  createDocument: (payload, options) => requestDocumentAdapter.create(payload, options),
  supersedeDocument: (id) => requestDocumentAdapter.update(id, { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED }, { actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED }),
  scanEnabled: isVirusScanEnabled,
  scanBytes,
  getUploadMaxMb,
  acquireSlotLease,
  releaseSlotLease,
  recordPortalUploadCandidate,
  getSupportEmail: async () => {
    try {
      const config = await AlertRecipients.readConfig();
      const address = Array.isArray(config?.support) ? config.support[0] : null;
      return address || null;
    } catch (error) {
      console.error('[site-visit-materials] support email lookup failed:', error?.message || error);
      return null;
    }
  },
  randomUUID: () => crypto.randomUUID(),
  now: () => new Date(),
});

function materialsError(message, code, httpStatus = 409, extras = {}) {
  return new ServiceHttpError(message, { httpStatus, code, body: { ok: false, reason: code, error: message, ...extras } });
}

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

export function outOfSync(received) {
  const pdf = received?.presentation_pdf?.receivedAt;
  const source = received?.presentation_source?.receivedAt;
  if (!pdf || !source) return false;
  return Math.abs(Date.parse(pdf) - Date.parse(source)) > OUT_OF_SYNC_MS;
}

/** What the contributor page shows. Filenames only; no SharePoint identity. */
export async function buildContributorContext({ collection }, dependencies = DEFAULT_DEPENDENCIES) {
  const request = await dependencies.getRequest(collection.request_id);
  if (!request?.akoya_requestid) throw materialsError('The request could not be resolved.', 'not_found', 404);
  const [documents, cap, supportEmail] = await Promise.all([
    dependencies.findDocumentsByRequest(collection.request_id),
    dependencies.getUploadMaxMb(),
    dependencies.getSupportEmail(),
  ]);
  const { received, other } = matchReceivedFiles(documents?.records, collection.request_id, request.akoya_requestnum);
  const now = dependencies.now();
  const closed = collection.status === 'closed' || new Date(collection.closes_at).getTime() <= now.getTime();
  return {
    ok: true,
    institution: request._akoya_applicantid_value_formatted || request['_akoya_applicantid_value@OData.Community.Display.V1.FormattedValue'] || null,
    proposalTitle: request.akoya_title || null,
    dueAt: new Date(collection.due_at).toISOString(),
    closesAt: new Date(collection.closes_at).toISOString(),
    closed,
    maxMb: cap.maxMb,
    supportEmail,
    checklist: (collection.checklist || []).filter((item) => !item.waived).map((item) => ({
      key: item.key,
      label: item.label,
      required: item.required === true,
      received: received[item.key] ? { filename: received[item.key].filename, receivedAt: received[item.key].receivedAt } : null,
    })),
    other: other.map((file) => ({ filename: file.filename, receivedAt: file.receivedAt })),
    outOfSync: outOfSync(received),
  };
}

function activeBucket(buckets) {
  const list = Array.isArray(buckets) ? buckets : [];
  return list.find((bucket) => bucket.source === 'dynamics' && String(bucket.library).toLowerCase() === 'akoya_request')
    || list.find((bucket) => bucket.source === 'dynamics')
    || null;
}

function otherFilename(requestNumber, original) {
  // SharePoint refuses " * : < > ? / \ | in item names; the blob sanitizer only strips separators.
  const safe = sanitizeBlobFilename(original).replace(/["*:<>?|]/g, '').replace(/\s+/g, ' ').trim();
  return `${requestNumber} Site Visit - ${safe}`;
}

/**
 * Retire the slot's prior row. A failure here is transient for the caller:
 * the staging row is released, and the retry reuses the created row by
 * generation key and only redoes this step.
 */
async function supersedePrevious(previous, currentId, dependencies) {
  if (!previous?.artifactId || !currentId || sameId(previous.artifactId, currentId)) return;
  try {
    await dependencies.supersedeDocument(previous.artifactId);
  } catch (error) {
    throw materialsError('The previous file could not be retired. Try again shortly.', 'supersede_failed', 503, { cause: error?.message || String(error) });
  }
}

function scanIsMisconfigured(error) {
  const status = Number(error?.status);
  return status === 401 || status === 403
    || (error?.serviceName === 'cloudmersive' && status === 500 && error?.isTransient === false);
}

function logScanFailure(error) {
  const status = Number(error?.status);
  console.error('[site-visit-materials] malware scan failed', {
    serviceName: typeof error?.serviceName === 'string' ? error.serviceName : null,
    status: Number.isFinite(status) ? status : null,
    isTransient: error?.isTransient === true,
    causeKind: typeof error?.causeKind === 'string' ? error.causeKind : null,
  });
}

function graphCandidateMatches(row, candidate) {
  if (typeof candidate?.driveId !== 'string' || !candidate.driveId
    || typeof candidate?.itemId !== 'string' || !candidate.itemId
    || typeof candidate?.filename !== 'string' || !candidate.filename) return false;
  return String(row?.wmkf_sharepointdriveid || '') === candidate.driveId
    && String(row?.wmkf_sharepointitemid || '') === candidate.itemId
    && String(row?.wmkf_sharepointversionid || '') === String(candidate?.versionId || '')
    && String(row?.wmkf_filename || '') === String(candidate?.filename || '');
}

function replayIsBound({ row, candidate, requestId, slot, generationKey, current }) {
  if (!row?.wmkf_requestdocumentid || !candidate) return false;
  if (!sameId(row._wmkf_request_value, requestId)) return false;
  if (row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY) return false;
  if (row.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED) return false;
  if (!sameId(candidate.requestId, requestId) || candidate.slot !== slot || candidate.generationKey !== generationKey) return false;
  if (!graphCandidateMatches(row, candidate)) return false;
  return slot === 'other' || (current?.artifactId && sameId(current.artifactId, row.wmkf_requestdocumentid));
}

/**
 * Persist one claimed staged upload: validate bytes for the slot, scan, upload
 * to the request's flat site-visit folder under the canonical name (replace
 * keeps SharePoint version history), register the row, then supersede the
 * slot's previous row so readers see one current file per slot.
 */
export async function finalizeMaterialUpload({
  collection,
  slotKey,
  file,
  stagingId,
  leaseToken,
  candidateResult = null,
}, dependencies = DEFAULT_DEPENDENCIES) {
  const slot = slotKey === 'other' ? 'other' : (collection.checklist || []).find((item) => item.key === slotKey && !item.waived)?.key;
  if (!slot) throw materialsError('That checklist item is not open for upload.', 'slot_not_open', 400);
  if (!collection?.id || !stagingId || !leaseToken) throw materialsError('The staged upload is incomplete.', 'bad_request', 400);
  const request = await dependencies.getRequest(collection.request_id);
  if (!request?.akoya_requestid) throw materialsError('The request could not be resolved.', 'not_found', 404);
  const cap = await dependencies.getUploadMaxMb();
  if (file.buffer.length > uploadMaxBytes(cap.maxMb)) throw materialsError(`Files larger than ${cap.maxMb} MB cannot be uploaded here.`, 'file_too_large', 400);
  const validation = validateSiteVisitMaterial(file.filename, file.buffer, slot);
  if (!validation.ok) throw materialsError('That file type is not accepted for this item.', validation.reason, 422);
  if (dependencies.scanEnabled()) {
    // Same contract as the grantee path: only an explicit "clean" proceeds.
    let scan;
    try {
      scan = await dependencies.scanBytes(file.buffer, file.filename);
    } catch (error) {
      logScanFailure(error);
      if (scanIsMisconfigured(error)) {
        throw materialsError('The malware scanner is not configured correctly.', 'scan_misconfigured', 500);
      }
      throw materialsError('The file could not be scanned. Try again shortly.', 'scan_unavailable', 503);
    }
    const verdict = scan?.scan_result ?? scan?.scanResult ?? null;
    if (verdict === 'infected') throw materialsError('The file failed the malware scan.', 'scan_infected', 422);
    if (verdict !== 'clean') throw materialsError('The file could not be scanned. Try again shortly.', 'scan_unavailable', 503);
  }
  // One staged upload is one operation: the generation key is derived from the
  // staging id, so a retry after a lost response reuses the registry row it
  // already created instead of uploading another version and adding a second row.
  const sha256 = file.sha256 || crypto.createHash('sha256').update(file.buffer).digest('hex');
  const generationKey = crypto.createHash('sha256').update(`site-visit-materials:${request.akoya_requestid}:${slot}:${stagingId}`).digest('hex');
  const slotLease = await dependencies.acquireSlotLease({ collectionId: collection.id, slotKey: slot });
  if (!slotLease) throw materialsError('Another upload for this item is being finalized. Try again shortly.', 'slot_busy', 409);

  let operationError = null;
  try {
    const [existing, documents] = await Promise.all([
      dependencies.findDocumentByGenerationKey(generationKey),
      dependencies.findDocumentsByRequest(request.akoya_requestid),
    ]);
    const existingRow = existing?.records?.length === 1 ? existing.records[0] : null;
    const current = slot === 'other' ? null : matchReceivedFiles(
      documents?.records,
      request.akoya_requestid,
      request.akoya_requestnum,
    ).received[slot];
    // A recorded candidate with no registry row means the SharePoint upload
    // landed but the Dataverse create never committed. That is safe to redo
    // from the top (replace adds one SharePoint version, no duplicate row).
    // Only a row that exists but does not bind to this operation is ambiguous.
    if (existing?.records?.length) {
      if (!replayIsBound({ row: existingRow, candidate: candidateResult, requestId: request.akoya_requestid, slot, generationKey, current })) {
        throw materialsError('The prior finalize result is ambiguous and cannot be retried automatically.', 'replay_ambiguous', 409);
      }
      await supersedePrevious(
        candidateResult.predecessorArtifactId ? { artifactId: candidateResult.predecessorArtifactId } : null,
        existingRow.wmkf_requestdocumentid,
        dependencies,
      );
      return {
        ok: true,
        slot,
        filename: existingRow.wmkf_filename,
        receivedAt: existingRow.wmkf_sharepointlastmodified || existingRow.modifiedon || null,
        artifactId: existingRow.wmkf_requestdocumentid,
        sha256,
        replayed: true,
      };
    }

    const previous = current;
    const bucket = activeBucket(await dependencies.getSharePointBuckets(request.akoya_requestid, request.akoya_requestnum));
    if (!bucket) throw materialsError('The request has no active SharePoint folder.', 'folder_unavailable', 503);
    const folderPath = `${String(bucket.folder).replace(/\/+$/, '')}/${SITE_VISIT_MATERIALS_FOLDERS[slot]}`;
    const filename = slot === 'other' ? otherFilename(request.akoya_requestnum, file.filename) : canonicalFilename(request.akoya_requestnum, slot, validation.extension);
    await dependencies.ensureFolderPath(bucket.library, folderPath);
    const uploaded = await dependencies.uploadFile(bucket.library, folderPath, filename, file.buffer, validation.contentType, { conflictBehavior: 'replace' });
    if (!uploaded?.id || !uploaded?.driveId) throw materialsError('SharePoint did not return the stored file identity.', 'upload_unconfirmed', 502);

    const candidate = {
      requestId: request.akoya_requestid,
      slot,
      generationKey,
      predecessorArtifactId: previous?.artifactId || null,
      driveId: uploaded.driveId,
      itemId: uploaded.id,
      versionId: uploaded.versionId || null,
      filename: uploaded.name || filename,
    };
    await dependencies.recordPortalUploadCandidate({ stagingId, leaseToken, candidate });

    const now = dependencies.now();
    const created = await dependencies.createDocument({
      wmkf_name: `${request.akoya_requestnum} ${slot === 'other' ? 'site visit material' : slot.replace('_', ' ')} (applicant upload)`,
      'wmkf_Request@odata.bind': `/akoya_requests(${request.akoya_requestid})`,
      wmkf_artifacttype: SLOT_ARTIFACT_TYPE[slot],
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
      wmkf_generationkey: generationKey,
      wmkf_cyclecode: meetingDateToCycleCode(request.wmkf_meetingdate),
      wmkf_inputfingerprint: sha256,
      wmkf_claimtoken: dependencies.randomUUID(),
      wmkf_producer: PRODUCER,
      wmkf_contenttype: validation.contentType,
      wmkf_contenthash: sha256,
      wmkf_sharepointsiteid: uploaded.siteId || null,
      wmkf_sharepointdriveid: uploaded.driveId,
      wmkf_sharepointitemid: uploaded.id,
      wmkf_sharepointweburl: uploaded.webUrl || null,
      wmkf_sharepointversionid: uploaded.versionId || null,
      wmkf_sharepointetag: uploaded.eTag || null,
      wmkf_sharepointfolderpath: folderPath,
      wmkf_filename: uploaded.name || filename,
      wmkf_filesize: uploaded.size ?? file.buffer.length,
      wmkf_sharepointlastmodified: uploaded.lastModified || null,
    }, { actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED, actorContext: { operation: 'site-visit-materials-upload', requestId: request.akoya_requestid, slot } });
    const createdId = created?.wmkf_requestdocumentid || created?.id || null;
    if (!createdId) throw materialsError('The registry did not confirm the stored file.', 'registry_unconfirmed', 503);
    await supersedePrevious(previous, createdId, dependencies);
    return { ok: true, slot, filename: uploaded.name || filename, receivedAt: uploaded.lastModified || now.toISOString(), artifactId: createdId, sha256 };
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await dependencies.releaseSlotLease({ collectionId: collection.id, slotKey: slot, leaseToken: slotLease.leaseToken });
    } catch (releaseError) {
      if (!operationError) throw releaseError;
      // Preserve the operation's classified error (especially replay_ambiguous)
      // so the route does not release staging for a blind retry. The lease has
      // a bounded expiry, so a failed release remains recoverable.
      console.error('[site-visit-materials] slot lease release failed', {
        name: typeof releaseError?.name === 'string' ? releaseError.name : null,
      });
    }
  }
}
