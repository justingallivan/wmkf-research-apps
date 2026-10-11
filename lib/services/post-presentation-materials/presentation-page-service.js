/** Minimal read model and non-buffering resolver for the materials-only page. */
import crypto from 'node:crypto';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import * as accountAdapter from '../../dataverse/adapters/account.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { isGuid } from '../../utils/guid.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_LABEL,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
  isPreSiteDistributionSnapshot,
} from '../../../shared/config/requestDocument.js';
import {
  materialBacking,
  materialDescriptor,
  projectPostPresentationMaterials,
} from './material-model.js';
import { bindPresentationTranscript, bindTranscriptSummary } from './presentation-transcript-binding.js';
import { bindPresentationVideo } from './presentation-video-binding.js';
import { getApprovedPresentationVideoByDocument } from '../meeting-tracker-recordings/presentation-video-split-store.js';
import { SUMMARY_TEXT_MAX_CHARS } from '../../../shared/config/transcriptSummary.js';

const MATERIAL_PREFIX = 'material:';
const APPLICANT_PRODUCER = 'site-visit-materials-portal';
const POST_PRESENTATION_PRODUCER = 'meeting-tracker-post-presentation';
const APPLICANT_TYPES = new Set([
  REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS,
]);
// The ONLY post-presentation artifact types an outside page may serve. The
// full TRANSCRIPT and the RECORDING contain the staff discussion held after
// the applicants leave, so they are never served here (plan section 2.1).
// Both are served only when bound to the current transcript revision and confirmed
// boundary (presentation-transcript-binding.js; plan §4.2, §4.3).
const OUTSIDE_POST_PRESENTATION_TYPE_LIST = Object.freeze([
  REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_TRANSCRIPT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY,
  // The approved cut of the Recording ends at the confirmed presentation end. Served only when
  // bindPresentationVideo proves it was cut from the current transcript revision, boundary and Recording.
  REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_VIDEO,
]);
const OUTSIDE_POST_PRESENTATION_TYPES = new Set(OUTSIDE_POST_PRESENTATION_TYPE_LIST);
const TRANSCRIPT_TYPES = new Map([
  ['text/vtt', '.vtt'],
  ['text/plain', '.txt'],
  ['application/pdf', '.pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
]);
// MP4 is accepted for the Presentation Video only.
const VIDEO_TYPES = new Map([['video/mp4', '.mp4']]);
const isVideoRow = (row) => Number(row?.wmkf_artifacttype) === REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_VIDEO;

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_title',
  '_akoya_applicantid_value',
];

const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  getAccount: (accountId) => accountAdapter.getById(accountId, { select: ['name'] }),
  findDocuments: (requestId) => requestDocumentAdapter.findByRequest(requestId, { includeMeetingTranscriptBundle: true }),
  resolveMediaDownloadUrl: (driveId, itemId) => GraphService.resolveMediaDownloadUrl(driveId, itemId),
  getApprovedVideoCut: (requestId, requestDocumentId) => getApprovedPresentationVideoByDocument({ requestId, requestDocumentId }),
  downloadFile: (driveId, itemId, options) => GraphService.downloadFile(driveId, itemId, options),
});

// The published summary is UTF-8 text with a BOM (transcript-summary-service.js); 4 bytes per char bounds it.
const SUMMARY_MAX_BYTES = SUMMARY_TEXT_MAX_CHARS * 4 + 3;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function notFound() {
  return new ServiceHttpError('not found', { httpStatus: 404, body: { ok: false, reason: 'not_found' } });
}

async function loadRequest(requestId, dependencies) {
  if (!isGuid(requestId)) throw notFound();
  let request;
  try { request = await dependencies.getRequest(requestId); } catch (error) {
    if (error?.status === 404 || /Get record failed \(404\)/.test(error?.message || '')) throw notFound();
    throw error;
  }
  if (!request || !sameId(request.akoya_requestid, requestId)) throw notFound();
  return request;
}

function eligibleApplicantRows(rows, requestId) {
  return (rows || []).filter((row) => (
    sameId(row?._wmkf_request_value, requestId)
    && APPLICANT_TYPES.has(Number(row.wmkf_artifacttype))
    && row.wmkf_producer === APPLICANT_PRODUCER
    && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    && !isPreSiteDistributionSnapshot(row)
    && materialBacking(row).kind === 'file'
  ));
}

function eligiblePresentationRows(rows, requestId) {
  const winners = projectPostPresentationMaterials(rows, requestId).winners
    .filter((row) => row.wmkf_producer === POST_PRESENTATION_PRODUCER);
  // The binding proves the derivative was cut from the CURRENT transcript at
  // its CONFIRMED boundary; anything else yields null and nothing is served.
  const { presentationTranscript } = bindPresentationTranscript(winners, requestId);
  // The summary is served only when it was made from that same revision and boundary.
  const { summary } = bindTranscriptSummary(winners, requestId);
  // The video binding also needs the current RECORDING winner (any producer), so it reads the unfiltered winners.
  const { video } = bindPresentationVideo(projectPostPresentationMaterials(rows, requestId).winners, requestId);
  return [presentationTranscript, summary, video]
    .filter((row) => row && OUTSIDE_POST_PRESENTATION_TYPES.has(Number(row.wmkf_artifacttype)));
}

const KIND_BY_TYPE = new Map([
  [REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_VIDEO, 'video'],
  [REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, 'summary'],
  [REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_TRANSCRIPT, 'transcript'],
  [REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, 'slides'],
  [REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS, 'other'],
]);
const kindOf = (row) => KIND_BY_TYPE.get(Number(row?.wmkf_artifacttype)) || 'other';

function pageDescriptor(row) {
  const descriptor = materialDescriptor(row);
  return {
    member: descriptor.member,
    kind: kindOf(row),
    label: descriptor.artifactTypeLabel,
    filename: descriptor.filename,
    contentType: descriptor.contentType,
    size: descriptor.size,
    backing: descriptor.backing,
    // Watch is offered only for the bound Presentation Video; rows reaching here are already bound.
    canWatch: isVideoRow(row) && descriptor.backing === 'file',
    canDownload: descriptor.backing === 'file',
  };
}

function applicantDescriptor(row) {
  const size = Number(row.wmkf_filesize);
  return {
    member: `${MATERIAL_PREFIX}${row.wmkf_requestdocumentid}`,
    kind: kindOf(row),
    label: REQUEST_DOCUMENT_ARTIFACT_LABEL[row.wmkf_artifacttype] || 'Material',
    filename: row.wmkf_filename || row.wmkf_name || 'Material',
    contentType: row.wmkf_contenttype || null,
    size: Number.isFinite(size) && size > 0 ? size : null,
    backing: 'file',
    canWatch: false,
    canDownload: true,
  };
}

function currentRows(rows, requestId) {
  return [
    ...eligibleApplicantRows(rows, requestId),
    ...eligiblePresentationRows(rows, requestId),
  ];
}

// The summary is shown on the page, so its bytes are read here and bound to the published row by size and
// SHA-256 (stronger than the eTag the open route compares). Any failure returns null and the page offers
// the file instead; the context never fails because the summary could not be read.
async function readSummaryText(row, dependencies) {
  const expectedSize = Number(row.wmkf_filesize);
  const expectedSha = String(row.wmkf_contenthash || '').toLowerCase();
  if (materialBacking(row).kind !== 'file' || !Number.isSafeInteger(expectedSize) || expectedSize <= 0
    || expectedSize > SUMMARY_MAX_BYTES || !/^[0-9a-f]{64}$/.test(expectedSha)) return null;
  try {
    const downloaded = await dependencies.downloadFile(row.wmkf_sharepointdriveid, row.wmkf_sharepointitemid,
      { maxBytes: SUMMARY_MAX_BYTES });
    const bytes = downloaded?.buffer;
    if (!Buffer.isBuffer(bytes) || bytes.length !== expectedSize || sha256(bytes) !== expectedSha) return null;
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch (error) {
    console.warn('[external presentation context] summary unavailable:', error?.code || error?.name || 'error');
    return null;
  }
}

export async function buildPresentationContext(
  { requestId, link },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  const request = await loadRequest(requestId, dependencies);
  let institution = request['_akoya_applicantid_value_formatted'] || null;
  if (request._akoya_applicantid_value) {
    try {
      institution = (await dependencies.getAccount(request._akoya_applicantid_value))?.name || institution;
    } catch { /* display fallback only */ }
  }
  const result = await dependencies.findDocuments(requestId);
  const applicant = eligibleApplicantRows(result?.records || [], requestId).map(applicantDescriptor);
  // The full presentation transcript stays openable by member but is not listed: the Board reads the summary.
  const presentationRows = eligiblePresentationRows(result?.records || [], requestId)
    .filter((row) => kindOf(row) !== 'transcript');
  const followUp = await Promise.all(presentationRows.map(async (row) => {
    const descriptor = pageDescriptor(row);
    return descriptor.kind === 'summary' ? { ...descriptor, text: await readSummaryText(row, dependencies) } : descriptor;
  }));
  return {
    ok: true,
    title: institution || 'Research presentation materials',
    proposalTitle: request.akoya_title || null,
    expiresAt: link?.expires_at instanceof Date ? link.expires_at.toISOString() : link?.expires_at || null,
    materials: [...applicant, ...followUp],
  };
}

function pinnedBytesMatch(row, media) {
  const pinned = String(row?.wmkf_sharepointetag || '');
  return pinned !== '' && String(media?.eTag || '') === pinned;
}

// The approved video is bound by the cut's recorded size and quickXorHash, never the eTag:
// SharePoint bumps a video's eTag on metadata-only changes (live 2026-10-10, 1003222).
function approvedVideoBytesMatch(cut, row, media) {
  return Boolean(cut
    && sameId(cut.output_drive_id, row.wmkf_sharepointdriveid) && sameId(cut.output_item_id, row.wmkf_sharepointitemid)
    && Number.isSafeInteger(cut.output_size) && cut.output_size > 0 && Number(media?.size) === cut.output_size
    && typeof cut.output_quickxor_hash === 'string' && cut.output_quickxor_hash !== ''
    && media?.quickXorHash === cut.output_quickxor_hash);
}

function validateFileMode(row, mode, mimeType, filename) {
  // Allowlist: only the outside post-presentation types; watch mode only for the Presentation Video.
  const artifactType = Number(row.wmkf_artifacttype);
  if (!OUTSIDE_POST_PRESENTATION_TYPES.has(artifactType) || (mode === 'watch' && !isVideoRow(row))) throw notFound();
  const extension = (isVideoRow(row) ? VIDEO_TYPES : TRANSCRIPT_TYPES).get(String(mimeType).split(';')[0].trim().toLowerCase());
  if (!extension || !filename.toLowerCase().endsWith(extension)) throw notFound();
}

export async function resolvePresentationMember(
  { requestId, member, mode = 'open' },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(requestId) || typeof member !== 'string' || member.length > 60
    || !member.startsWith(MATERIAL_PREFIX)
    || !['open', 'watch', 'download'].includes(mode)) throw notFound();
  const documentId = member.slice(MATERIAL_PREFIX.length);
  if (!isGuid(documentId)) throw notFound();
  await loadRequest(requestId, dependencies);
  const result = await dependencies.findDocuments(requestId);
  const row = currentRows(result?.records || [], requestId)
    .find((candidate) => sameId(candidate.wmkf_requestdocumentid, documentId));
  if (!row) throw notFound();
  const backing = materialBacking(row);
  if (backing.kind !== 'file') throw notFound();
  const media = await dependencies.resolveMediaDownloadUrl(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
  );
  if (media.malware || !sameId(media.driveId, row.wmkf_sharepointdriveid)
    || !sameId(media.itemId, row.wmkf_sharepointitemid)) throw notFound();
  const mimeType = media.mimeType || row.wmkf_contenttype || 'application/octet-stream';
  const filename = media.filename || row.wmkf_filename || row.wmkf_name || 'Material';
  if (APPLICANT_TYPES.has(Number(row.wmkf_artifacttype))) {
    if (mode === 'watch') throw notFound();
  } else {
    validateFileMode(row, mode, mimeType, filename);
    // The generation key binds the ROW to the current boundary. The bytes are bound by the approved
    // cut's size and hash for the video, and by the pinned SharePoint eTag otherwise. A replaced file is never served.
    if (isVideoRow(row)) {
      const cut = await dependencies.getApprovedVideoCut(requestId, row.wmkf_requestdocumentid);
      if (!approvedVideoBytesMatch(cut, row, media)) throw notFound();
    } else if (!pinnedBytesMatch(row, media)) throw notFound();
  }
  let redirect;
  try { redirect = new URL(media.downloadUrl); } catch { throw notFound(); }
  if (redirect.protocol !== 'https:' || redirect.username || redirect.password) throw notFound();
  return { kind: 'file', redirectUrl: redirect.toString(), filename, mimeType };
}

export const _internal = {
  DEFAULT_DEPENDENCIES,
  OUTSIDE_POST_PRESENTATION_TYPES,
  APPLICANT_PRODUCER,
  POST_PRESENTATION_PRODUCER,
  currentRows,
  eligibleApplicantRows,
  eligiblePresentationRows,
};
