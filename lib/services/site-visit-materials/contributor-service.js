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
  getSharePointBuckets: getRequestSharePointBuckets,
  ensureFolderPath: (library, folder) => GraphService.ensureFolderPath(library, folder),
  uploadFile: (...args) => GraphService.uploadFileLarge(...args),
  createDocument: (payload, options) => requestDocumentAdapter.create(payload, options),
  supersedeDocument: (id) => requestDocumentAdapter.update(id, { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED }, { actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED }),
  scanEnabled: isVirusScanEnabled,
  scanBytes,
  getUploadMaxMb,
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
  const [documents, cap] = await Promise.all([
    dependencies.findDocumentsByRequest(collection.request_id),
    dependencies.getUploadMaxMb(),
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
 * Persist one claimed staged upload: validate bytes for the slot, scan, upload
 * to the request's flat site-visit folder under the canonical name (replace
 * keeps SharePoint version history), register the row, then supersede the
 * slot's previous row so readers see one current file per slot.
 */
export async function finalizeMaterialUpload({ collection, slotKey, file }, dependencies = DEFAULT_DEPENDENCIES) {
  const slot = slotKey === 'other' ? 'other' : (collection.checklist || []).find((item) => item.key === slotKey && !item.waived)?.key;
  if (!slot) throw materialsError('That checklist item is not open for upload.', 'slot_not_open', 400);
  const request = await dependencies.getRequest(collection.request_id);
  if (!request?.akoya_requestid) throw materialsError('The request could not be resolved.', 'not_found', 404);
  const cap = await dependencies.getUploadMaxMb();
  if (file.buffer.length > uploadMaxBytes(cap.maxMb)) throw materialsError(`Files larger than ${cap.maxMb} MB cannot be uploaded here.`, 'file_too_large', 400);
  const validation = validateSiteVisitMaterial(file.filename, file.buffer, slot);
  if (!validation.ok) throw materialsError('That file type is not accepted for this item.', validation.reason, 422);
  if (dependencies.scanEnabled()) {
    const scan = await dependencies.scanBytes(file.buffer, file.filename);
    if (scan?.scanResult === 'infected' || scan?.scan_result === 'infected') throw materialsError('The file failed the malware scan.', 'scan_infected', 422);
    if (scan?.scanResult === 'error' || scan?.scan_result === 'error') throw materialsError('The file could not be scanned. Try again shortly.', 'scan_unavailable', 503);
  }
  const bucket = activeBucket(await dependencies.getSharePointBuckets(request.akoya_requestid, request.akoya_requestnum));
  if (!bucket) throw materialsError('The request has no active SharePoint folder.', 'folder_unavailable', 503);
  const folderPath = `${String(bucket.folder).replace(/\/+$/, '')}/${SITE_VISIT_MATERIALS_FOLDERS[slot]}`;
  const filename = slot === 'other' ? otherFilename(request.akoya_requestnum, file.filename) : canonicalFilename(request.akoya_requestnum, slot, validation.extension);
  await dependencies.ensureFolderPath(bucket.library, folderPath);
  const uploaded = await dependencies.uploadFile(bucket.library, folderPath, filename, file.buffer, validation.contentType, { conflictBehavior: 'replace' });
  if (!uploaded?.id || !uploaded?.driveId) throw materialsError('SharePoint did not return the stored file identity.', 'upload_unconfirmed', 502);

  const sha256 = file.sha256 || crypto.createHash('sha256').update(file.buffer).digest('hex');
  const now = dependencies.now();
  const documents = await dependencies.findDocumentsByRequest(request.akoya_requestid);
  const previous = slot === 'other' ? null : matchReceivedFiles(documents?.records, request.akoya_requestid, request.akoya_requestnum).received[slot];
  const created = await dependencies.createDocument({
    wmkf_name: `${request.akoya_requestnum} ${slot === 'other' ? 'site visit material' : slot.replace('_', ' ')} (applicant upload)`,
    'wmkf_Request@odata.bind': `/akoya_requests(${request.akoya_requestid})`,
    wmkf_artifacttype: SLOT_ARTIFACT_TYPE[slot],
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_generationkey: crypto.createHash('sha256').update(`site-visit-materials:${request.akoya_requestid}:${slot}:${sha256}:${now.toISOString()}`).digest('hex'),
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
  if (previous && createdId && !sameId(previous.artifactId, createdId)) {
    try { await dependencies.supersedeDocument(previous.artifactId); } catch (error) { console.warn('[site-visit-materials] supersede failed:', error?.message || error); }
  }
  return { ok: true, slot, filename: uploaded.name || filename, receivedAt: uploaded.lastModified || now.toISOString(), artifactId: createdId, sha256 };
}
