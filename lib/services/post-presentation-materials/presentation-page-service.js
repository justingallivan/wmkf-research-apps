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
import { isReviewerProposalFile, expectedReviewerProposalFilename } from '../../external/reviewer-materials.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets.js';
import {
  isPostPresentationMaterialsRequestAllowed,
  isPostPresentationMaterialsSchemaReady,
} from '../../utils/post-presentation-materials-readiness.js';

const MATERIAL_PREFIX = 'material:';
// The proposal is not a registry row: it is the one external-reviewer PDF found by convention
// (lib/external/reviewer-materials.js), so it has a fixed member instead of a document id.
// Owner decision 2026-10-11 (Session 594) reverses the 2026-09-21 "no proposal" rule for this page.
const PROPOSAL_MEMBER = 'proposal';
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
  // Locates the reviewer PDF only; never returned to the page.
  'akoya_requestnum',
];

const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  getAccount: (accountId) => accountAdapter.getById(accountId, { select: ['name'] }),
  findDocuments: (requestId) => requestDocumentAdapter.findByRequest(requestId, { includeMeetingTranscriptBundle: true }),
  resolveMediaDownloadUrl: (driveId, itemId) => GraphService.resolveMediaDownloadUrl(driveId, itemId),
  getApprovedVideoCut: (requestId, requestDocumentId) => getApprovedPresentationVideoByDocument({ requestId, requestDocumentId }),
  downloadFile: (driveId, itemId, options) => GraphService.downloadFile(driveId, itemId, options),
  listReviewerProposal: (requestId, requestNumber) => listReviewerProposalStrict(requestId, requestNumber),
  getDriveId: (library) => GraphService.getDriveId(library),
  convertToPdf: (driveId, itemId) => GraphService.downloadFileAsPdf(driveId, itemId,
    { maxBytes: OFFICE_PDF_MAX_BYTES, timeoutMs: OFFICE_PDF_TIMEOUT_MS }),
  presentationSchemaReady: isPostPresentationMaterialsSchemaReady,
  presentationRequestAllowed: isPostPresentationMaterialsRequestAllowed,
});

// Applicant Office files (bios in Word, slides sent only as PowerPoint, the odd spreadsheet) can be viewed:
// Microsoft converts the current item to PDF and the bytes are returned from this origin, bounded below
// the Function response limit.
const OFFICE_TYPES = new Map([
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
  ['application/vnd.ms-powerpoint', '.ppt'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.ms-excel', '.xls'],
]);
const OFFICE_SOURCE_MAX_BYTES = 50 * 1024 * 1024;
const OFFICE_PDF_MAX_BYTES = 4 * 1024 * 1024;
// Bounds each Graph request and the body read, well inside the Function's duration.
const OFFICE_PDF_TIMEOUT_MS = 20_000;

// The published summary is UTF-8 text with a BOM (transcript-summary-service.js); 4 bytes per char bounds it.
const SUMMARY_MAX_BYTES = SUMMARY_TEXT_MAX_CHARS * 4 + 3;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
// The summary is optional on the page: a slow SharePoint read must not hold back the video and slides.
// downloadFile takes no abort signal, so the abandoned read ends on its own Graph timeouts.
const SUMMARY_READ_DEADLINE_MS = 4000;
// The proposal lookup lists the request's SharePoint folders completely (4-8 s live, 2026-10-11), so the
// context never waits for it: the page asks separately with mode 'check' and adds the row when confirmed.

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

// The Board's proposal must be the ONLY canonical reviewer PDF, so the search must be complete:
// every bucket resolved, every listing whole (no truncation, no depth cut-off). A folder confirmed
// absent counts as empty; any other failure throws, and the caller then offers no proposal.
// (lib/external/reviewer-materials.js listReviewerMaterials skips failed buckets, which could leave
// one archive copy looking unique; Codex review 2026-10-11.)
export async function listReviewerProposalStrict(requestId, requestNumber, {
  getBuckets = (id, num) => getRequestSharePointBuckets(id, num, { requireResolvedParents: true, requireCompleteResults: true }),
  listFiles = (library, folder, options) => GraphService.listFiles(library, folder, options),
} = {}) {
  const buckets = await getBuckets(requestId, requestNumber);
  const matches = [];
  for (const bucket of buckets || []) {
    let items;
    try {
      items = await listFiles(bucket.library, bucket.folder, {
        recursive: true, maxDepth: 3, failOnTruncation: true, failOnDepthLimit: true,
      });
    } catch (error) {
      if (error?.code === 'graph_folder_not_found') continue;
      throw error;
    }
    for (const file of items || []) {
      if (isReviewerProposalFile(file.folder || '', file.name, requestNumber)) {
        matches.push({ id: file.id, name: file.name, folder: file.folder, library: bucket.library });
      }
    }
  }
  return matches;
}

function withinDeadline(work, ms, label) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[external presentation context] ${label} unavailable: deadline`);
      resolve(null);
    }, ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

// Exactly one canonical reviewer PDF (Reviewer Materials/Proposal_{requestNumber}.pdf) or nothing.
// None or several (for example the same name in two buckets) is a confirmed absence (404); a lookup
// that failed is temporary (503), so the page retries instead of hiding the row for good.
async function findBoardProposal(request, dependencies) {
  const requestNumber = request?.akoya_requestnum;
  if (!expectedReviewerProposalFilename(requestNumber)) return null;
  let files;
  try {
    files = await dependencies.listReviewerProposal(request.akoya_requestid, requestNumber);
  } catch (error) {
    console.warn('[external presentation] proposal lookup failed:', error?.code || error?.name || 'error');
    throw new ServiceHttpError('proposal lookup unavailable', {
      httpStatus: 503, body: { ok: false, reason: 'proposal_unavailable' },
    });
  }
  return Array.isArray(files) && files.length === 1 && files[0]?.id && files[0]?.library ? files[0] : null;
}

const PROPOSAL_DESCRIPTOR = Object.freeze({
  member: PROPOSAL_MEMBER,
  kind: 'proposal',
  label: 'Proposal',
  // The filename carries the request number, which the page never shows.
  filename: null,
  contentType: 'application/pdf',
  size: null,
  backing: 'file',
  canWatch: false,
  canDownload: true,
});

async function resolveProposal({ requestId, mode }, dependencies) {
  if (!['open', 'download', 'check'].includes(mode)) throw notFound();
  const request = await loadRequest(requestId, dependencies);
  const file = await findBoardProposal(request, dependencies);
  if (!file) throw notFound();
  const driveId = await dependencies.getDriveId(file.library);
  const media = await dependencies.resolveMediaDownloadUrl(driveId, file.id);
  const mimeType = String(media?.mimeType || '').split(';')[0].trim().toLowerCase();
  if (!media || media.malware || !sameId(media.itemId, file.id)
    || media.filename !== expectedReviewerProposalFilename(request.akoya_requestnum)
    || mimeType !== 'application/pdf') throw notFound();
  let redirect;
  try { redirect = new URL(media.downloadUrl); } catch { throw notFound(); }
  if (redirect.protocol !== 'https:' || redirect.username || redirect.password) throw notFound();
  // 'check' runs every gate above but returns only the page's descriptor, never a URL.
  if (mode === 'check') return { kind: 'available', material: { ...PROPOSAL_DESCRIPTOR } };
  return { kind: 'file', redirectUrl: redirect.toString(), filename: media.filename, mimeType: 'application/pdf' };
}

function readSummaryTextWithin(row, dependencies) {
  return withinDeadline(readSummaryText(row, dependencies),
    dependencies.summaryReadDeadlineMs ?? SUMMARY_READ_DEADLINE_MS, 'summary');
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
    return descriptor.kind === 'summary' ? { ...descriptor, text: await readSummaryTextWithin(row, dependencies) } : descriptor;
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
    || !['open', 'watch', 'download', 'check', 'pdf'].includes(mode)) throw notFound();
  if (member === PROPOSAL_MEMBER) return resolveProposal({ requestId, mode }, dependencies);
  if (!member.startsWith(MATERIAL_PREFIX) || mode === 'check') throw notFound();
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
    if (mode === 'pdf') return convertOfficeToPdf({ media, mimeType, filename }, dependencies);
  } else {
    if (mode === 'pdf') throw notFound();
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

/**
 * Staff playback of the approved presentation video (Workbench Staff deliberations; plan
 * docs/plans/STAFF_READER_AND_VIDEO_PLAN_2026-10-11.md §1). Same binding and byte checks as the
 * Board page's watch mode: the bound Presentation Video winner only, never the full recording,
 * served only while its bytes match the approved cut. Gated like the Workbench materials list.
 * Any failure is a 404; the caller redirects to the returned Graph URL and never logs it.
 */
export async function resolveStaffPresentationVideo({ requestId }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(requestId) || !dependencies.presentationSchemaReady()
    || !dependencies.presentationRequestAllowed(requestId)) throw notFound();
  const result = await dependencies.findDocuments(requestId);
  const winners = projectPostPresentationMaterials(result?.records || [], requestId).winners;
  const { video: row } = bindPresentationVideo(winners, requestId);
  if (!row || !isVideoRow(row) || materialBacking(row).kind !== 'file') throw notFound();
  const media = await dependencies.resolveMediaDownloadUrl(row.wmkf_sharepointdriveid, row.wmkf_sharepointitemid);
  if (media.malware || !sameId(media.driveId, row.wmkf_sharepointdriveid)
    || !sameId(media.itemId, row.wmkf_sharepointitemid)) throw notFound();
  const mimeType = media.mimeType || row.wmkf_contenttype || '';
  const filename = media.filename || row.wmkf_filename || row.wmkf_name || '';
  const extension = VIDEO_TYPES.get(String(mimeType).split(';')[0].trim().toLowerCase());
  if (!extension || !filename.toLowerCase().endsWith(extension)) throw notFound();
  const cut = await dependencies.getApprovedVideoCut(requestId, row.wmkf_requestdocumentid);
  if (!approvedVideoBytesMatch(cut, row, media)) throw notFound();
  let redirect;
  try { redirect = new URL(media.downloadUrl); } catch { throw notFound(); }
  if (redirect.protocol !== 'https:' || redirect.username || redirect.password) throw notFound();
  return { redirectUrl: redirect.toString() };
}

async function convertOfficeToPdf({ media, mimeType, filename }, dependencies) {
  const extension = OFFICE_TYPES.get(String(mimeType).split(';')[0].trim().toLowerCase());
  if (!extension || !filename.toLowerCase().endsWith(extension)
    || !(Number(media.size) > 0) || Number(media.size) > OFFICE_SOURCE_MAX_BYTES) throw notFound();
  let buffer;
  try {
    buffer = await dependencies.convertToPdf(media.driveId, media.itemId);
  } catch (error) {
    console.warn('[external presentation] Office to PDF failed:', error?.code || error?.name || 'error');
    // Too large to view here: the page offers the original file instead.
    if (error?.code === 'graph_download_size_limit') throw notFound();
    throw new ServiceHttpError('conversion unavailable', { httpStatus: 503, body: { ok: false, reason: 'conversion_unavailable' } });
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > OFFICE_PDF_MAX_BYTES
    || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw notFound();
  return { kind: 'pdf', buffer };
}

export const _internal = {
  DEFAULT_DEPENDENCIES,
  PROPOSAL_MEMBER,
  OUTSIDE_POST_PRESENTATION_TYPES,
  APPLICANT_PRODUCER,
  POST_PRESENTATION_PRODUCER,
  currentRows,
  eligibleApplicantRows,
  eligiblePresentationRows,
};
