/**
 * Read model for the external deliberation briefing page
 * (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.1, §2.3).
 *
 * Everything here is resolved server-side from the verified token's request:
 *   - header: applicant, lead PI, and lead PD from the request's live lookup
 *     annotations;
 *   - writeup: the frozen DOCX snapshot pinned on the latest distribution
 *     attempt Dynamics accepted for transport (exact version, write-once item,
 *     bytes re-hashed against the ledger on every download); the companion PDF
 *     is not exposed on the briefing page;
 *   - reviews: every selected suggestion with a received review (D14), with
 *     the reviewer's name and affiliation (D13), the answer snapshot, and the
 *     uploaded PDF when one exists (generated DOCX copies are not exposed);
 *   - proposal: the same file external reviewers receive,
 *     `Reviewer Materials/Proposal_{Request#}.pdf` (owner 2026-09-10; it was
 *     the AI Materials narrative before), resolved by governed path at request
 *     time across the request's SharePoint buckets;
 *   - materials (owner 2026-09-10, S503): the request's Ready applicant slides,
 *     other applicant materials, visit recording, transcript, and transcript
 *     summary, resolved live from the request-document registry (the writeup
 *     itself is served from the ledger above, never as a material); files over
 *     MAX_MATERIAL_BYTES are listed but not served;
 *   - session / site visit: live dates, or "not yet scheduled".
 *
 * The context never carries a SharePoint URL, drive id, item id, or folder.
 * `resolveBriefingMember` maps a bounded member id back onto this model and
 * refuses anything else before any Graph call.
 */
import { createHash } from 'node:crypto';
import { GraphService } from '../graph-service';
import { ServiceHttpError } from '../service-http-error';
import { isGuid } from '../../utils/guid.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as accountAdapter from '../../dataverse/adapters/account.js';
import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion.js';
import * as potentialReviewerAdapter from '../../dataverse/adapters/potential-reviewer.js';
import * as siteVisitAdapter from '../../dataverse/adapters/site-visit.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_LABEL,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
  isPreSiteDistributionSnapshot,
} from '../../../shared/config/requestDocument.js';
import { fetchAnswersBySuggestion } from '../review-answers';
import { downloadReview } from '../review-manager/download-review-service';
import { expectedReviewerProposalFilename, getReviewerMaterialFolders } from '../../external/reviewer-materials.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets';
import { getLatestSentAttempt } from '../pre-site-visit/distribution-store';
import { selectActiveSiteVisit } from './site-visit-selection';
import { getDeliberationSessionForRequest } from './session-reader';

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  '_wmkf_programdirector_value',
];
const PERSON_SELECT = ['wmkf_potentialreviewersid', 'wmkf_name', 'wmkf_organizationname', 'wmkf_primaryaffiliation'];

export const BRIEFING_MEMBER = Object.freeze({
  WRITEUP_DOCX: 'writeup-docx',
  PROPOSAL: 'proposal',
});
const REVIEW_MEMBER_PREFIX = 'review:';
const MATERIAL_MEMBER_PREFIX = 'material:';
// The writeup is deliberately absent: it is served from the distribution
// ledger's pinned snapshot, never from the live registry row.
const MATERIAL_TYPES = new Set([
  REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY,
]);
// The document route buffers the file in the function (responseLimit 60mb);
// a visit recording can be far larger, so it is listed with its size but not
// served. Owner can raise this once streaming exists.
export const MAX_MATERIAL_BYTES = 50 * 1024 * 1024;

const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  getAccount: (accountId) => accountAdapter.getById(accountId, { select: 'name' }),
  findSuggestions: (requestId) => suggestionAdapter.findByRequest(requestId, { selectedOnly: true, requireComplete: true }),
  getPerson: (personId) => potentialReviewerAdapter.getByIdWithSelect(personId, { select: PERSON_SELECT }),
  fetchAnswers: fetchAnswersBySuggestion,
  findActiveSiteVisit: async (requestId) => {
    const { records } = await siteVisitAdapter.findActiveByRequest(requestId);
    return selectActiveSiteVisit(records);
  },
  getSession: getDeliberationSessionForRequest,
  getLatestAttempt: getLatestSentAttempt,
  findDocuments: (requestId) => requestDocumentAdapter.findByRequest(requestId),
  getSharePointBuckets: getRequestSharePointBuckets,
  getFileMetadataByPath: (...args) => GraphService.getFileMetadataByPath(...args),
  downloadFile: (...args) => GraphService.downloadFile(...args),
  downloadReview,
});

function notFound(message = 'not found') {
  return new ServiceHttpError(message, { httpStatus: 404, body: { ok: false, reason: 'not_found' } });
}

function personName(suggestion, person) {
  const first = String(suggestion.wmkf_reviewerfirstname || '').trim();
  const last = String(suggestion.wmkf_reviewerlastname || '').trim();
  const joined = [first, last].filter(Boolean).join(' ');
  return joined || person?.wmkf_name || 'Reviewer';
}

function personAffiliation(suggestion, person) {
  return suggestion.wmkf_revieweraffiliation
    || person?.wmkf_primaryaffiliation
    || person?.wmkf_organizationname
    || null;
}

function isPdfFilename(value) {
  return typeof value === 'string' && /\.pdf$/i.test(value.trim());
}

function hasPdfHeader(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'));
}

function isoOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function loadHeader(requestId, dependencies) {
  let request;
  try {
    request = await dependencies.getRequest(requestId);
  } catch (e) {
    if (e?.status === 404 || /Get record failed \(404\)/.test(e?.message || '')) throw notFound();
    throw e;
  }
  if (!request || String(request.akoya_requestid).toLowerCase() !== requestId.toLowerCase()) throw notFound();
  let institution = request['_akoya_applicantid_value_formatted'] || null;
  if (request._akoya_applicantid_value) {
    try {
      const account = await dependencies.getAccount(request._akoya_applicantid_value);
      institution = account?.name || institution;
    } catch {
      // keep the annotation name; institution is a label, not an access decision
    }
  }
  return { request, institution };
}

async function loadReviews(requestId, dependencies) {
  const rows = await dependencies.findSuggestions(requestId);
  const received = (rows || []).filter((row) => Boolean(row.wmkf_reviewreceivedat));
  const answersBySuggestion = await dependencies.fetchAnswers(received.map((row) => row.wmkf_appreviewersuggestionid));
  const reviews = [];
  for (const row of received) {
    let person = null;
    if (row._wmkf_potentialreviewer_value) {
      try {
        person = await dependencies.getPerson(row._wmkf_potentialreviewer_value);
      } catch {
        person = null;
      }
    }
    reviews.push({
      id: row.wmkf_appreviewersuggestionid,
      reviewerName: personName(row, person),
      affiliation: personAffiliation(row, person),
      receivedAt: isoOrNull(row.wmkf_reviewreceivedat),
      answers: (answersBySuggestion[row.wmkf_appreviewersuggestionid] || []).map((answer) => ({
        questionText: answer.questionText,
        questionType: answer.questionType,
        answerText: answer.answerText,
        answerHtml: answer.answerHtml,
      })),
      file: row.wmkf_reviewsharepointfolder && isPdfFilename(row.wmkf_reviewfilename)
        ? { member: `${REVIEW_MEMBER_PREFIX}${row.wmkf_appreviewersuggestionid}`, filename: row.wmkf_reviewfilename }
        : null,
    });
  }
  reviews.sort((a, b) => String(a.receivedAt || '').localeCompare(String(b.receivedAt || '')));
  return reviews;
}

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function eligibleMaterialRow(row, requestId) {
  return sameId(row?._wmkf_request_value, requestId)
    && MATERIAL_TYPES.has(row?.wmkf_artifacttype)
    && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    && Boolean(row.wmkf_sharepointdriveid && row.wmkf_sharepointitemid)
    && !isPreSiteDistributionSnapshot(row);
}

function materialDescriptor(row) {
  const size = Number(row.wmkf_filesize);
  const knownSize = Number.isFinite(size) && size > 0 ? size : null;
  return {
    member: `${MATERIAL_MEMBER_PREFIX}${row.wmkf_requestdocumentid}`,
    label: REQUEST_DOCUMENT_ARTIFACT_LABEL[row.wmkf_artifacttype] || 'Material',
    filename: row.wmkf_filename || row.wmkf_name || 'Material',
    size: knownSize,
    // Unknown size is served (the route caps the response); a known oversize
    // file is listed so the Board knows it exists, but has no download.
    available: knownSize === null || knownSize <= MAX_MATERIAL_BYTES,
    // Mirrors the document route's disposition rule (PDF inline, everything
    // else attachment) so the page opens a tab only for files a tab can show;
    // a PPTX served as an attachment into a new tab leaves a blank window.
    inline: /\.pdf$/i.test(row.wmkf_filename || row.wmkf_name || ''),
  };
}

async function loadMaterialRows(requestId, dependencies) {
  const result = await dependencies.findDocuments(requestId);
  return (result?.records || []).filter((row) => eligibleMaterialRow(row, requestId));
}

async function loadMaterials(requestId, dependencies) {
  const rows = await loadMaterialRows(requestId, dependencies);
  return rows
    .map(materialDescriptor)
    .sort((a, b) => a.label.localeCompare(b.label) || a.filename.localeCompare(b.filename));
}

function writeupFromAttempt(attempt, requestNumber) {
  if (!attempt) return null;
  const normalizedRequestNumber = String(requestNumber || '').trim();
  const docx = attempt.docx_drive_id && attempt.docx_item_id
    ? {
      member: BRIEFING_MEMBER.WRITEUP_DOCX,
      displayName: normalizedRequestNumber ? `Staff Brief ${normalizedRequestNumber}.docx` : 'Staff Brief.docx',
      size: Number(attempt.docx_size) || null,
    }
    : null;
  return { docx, sharedAt: isoOrNull(attempt.sent_at || attempt.send_requested_at) };
}

// The proposal Board members see is the exact file reviewers received:
// Reviewer Materials/Proposal_{Request#}.pdf under the request's SharePoint
// folder (active library first, archive buckets after). Same rule as the
// external reviewer portal, so nothing else in that folder can leak.
async function locateProposal(request, dependencies) {
  const filename = expectedReviewerProposalFilename(request.akoya_requestnum);
  if (!filename) return null;
  const buckets = await dependencies.getSharePointBuckets(request.akoya_requestid, request.akoya_requestnum);
  const [folderName] = getReviewerMaterialFolders();
  for (const bucket of buckets || []) {
    if (!bucket?.library || !bucket?.folder) continue;
    let metadata = null;
    try {
      metadata = await dependencies.getFileMetadataByPath(bucket.library, `${bucket.folder}/${folderName}`, filename);
    } catch {
      metadata = null;
    }
    if (metadata?.id && metadata?.driveId) {
      return { driveId: metadata.driveId, itemId: metadata.id, filename: metadata.name || filename, size: metadata.size ?? null };
    }
  }
  return null;
}

/**
 * Page model for a verified token. `link` is the verified briefing row.
 */
export async function buildBriefingContext({ requestId, link }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(requestId)) throw notFound();
  const { request, institution } = await loadHeader(requestId, dependencies);
  const [reviews, attempt, siteVisit, session, narrative, materials] = await Promise.all([
    loadReviews(requestId, dependencies),
    dependencies.getLatestAttempt(requestId),
    dependencies.findActiveSiteVisit(requestId).catch(() => null),
    dependencies.getSession(requestId).catch(() => null),
    locateProposal(request, dependencies).catch(() => null),
    loadMaterials(requestId, dependencies).catch(() => []),
  ]);
  return {
    ok: true,
    title: institution || 'Deliberation briefing',
    projectLeader: request._wmkf_projectleader_value_formatted || null,
    programDirector: request._wmkf_programdirector_value_formatted || null,
    proposalTitle: request.akoya_title || null,
    expiresAt: isoOrNull(link?.expires_at),
    session: session ? {
      scheduledStart: isoOrNull(session.scheduledStartIso),
      scheduledEnd: isoOrNull(session.scheduledEndIso),
      timeZone: session.ianaTimeZone || null,
      meetingLink: session.meetingLink || null,
      location: session.location || null,
    } : null,
    siteVisit: siteVisit ? {
      scheduledStart: isoOrNull(siteVisit.scheduledstart),
      scheduledEnd: isoOrNull(siteVisit.scheduledend),
    } : null,
    writeup: writeupFromAttempt(attempt, request.akoya_requestnum),
    reviews,
    proposal: narrative ? { member: BRIEFING_MEMBER.PROPOSAL, filename: narrative.filename, size: narrative.size } : null,
    materials,
  };
}

/**
 * Resolve one bounded member id to bytes. Anything not in the model is a 404
 * before any Graph call; the client never names a path, drive, or item.
 *
 * @returns {Promise<{ buffer: Buffer, mimeType: string, filename: string, size: number, inline: boolean }>}
 */
export async function resolveBriefingMember({ requestId, member }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(requestId) || typeof member !== 'string' || member.length > 60) throw notFound();
  // Every branch re-proves the request still resolves in Dataverse before
  // any retained Postgres pointer or Graph read is consulted.
  const { request } = await loadHeader(requestId, dependencies);

  if (member === BRIEFING_MEMBER.WRITEUP_DOCX) {
    const attempt = await dependencies.getLatestAttempt(requestId);
    const driveId = attempt?.docx_drive_id;
    const itemId = attempt?.docx_item_id;
    if (!driveId || !itemId) throw notFound();
    const file = await dependencies.downloadFile(driveId, itemId);
    // The ledger pinned the exact bytes it sent; refuse to serve anything else.
    const expectedHash = String(attempt.docx_byte_hash || '');
    const actualHash = createHash('sha256').update(file.buffer).digest('hex');
    if (!/^[0-9a-f]{64}$/.test(expectedHash) || actualHash !== expectedHash) {
      throw new ServiceHttpError('snapshot bytes differ from the pinned hash', {
        httpStatus: 409,
        body: { ok: false, reason: 'snapshot_mismatch' },
      });
    }
    const mimeType = attempt.docx_content_type || file.mimeType || 'application/octet-stream';
    return { buffer: file.buffer, mimeType, filename: attempt.docx_filename || file.filename, size: file.size, inline: false };
  }

  if (member === BRIEFING_MEMBER.PROPOSAL) {
    const narrative = await locateProposal(request, dependencies);
    if (!narrative) throw notFound();
    const file = await dependencies.downloadFile(narrative.driveId, narrative.itemId);
    const mimeType = file.mimeType || 'application/pdf';
    return { buffer: file.buffer, mimeType, filename: narrative.filename, size: file.size, inline: mimeType === 'application/pdf' };
  }

  if (member.startsWith(MATERIAL_MEMBER_PREFIX)) {
    const documentId = member.slice(MATERIAL_MEMBER_PREFIX.length);
    if (!isGuid(documentId)) throw notFound();
    // Membership proof: the row must be in THIS request's eligible material
    // set right now (type, Ready, not superseded, not a snapshot), and within
    // the size the route can buffer.
    const rows = await loadMaterialRows(requestId, dependencies);
    const row = rows.find((candidate) => sameId(candidate.wmkf_requestdocumentid, documentId));
    if (!row || !materialDescriptor(row).available) throw notFound();
    const file = await dependencies.downloadFile(row.wmkf_sharepointdriveid, row.wmkf_sharepointitemid);
    if (Number(file.size) > MAX_MATERIAL_BYTES) throw notFound();
    const mimeType = file.mimeType || 'application/octet-stream';
    return { buffer: file.buffer, mimeType, filename: row.wmkf_filename || file.filename, size: file.size, inline: mimeType === 'application/pdf' };
  }

  if (member.startsWith(REVIEW_MEMBER_PREFIX)) {
    const suggestionId = member.slice(REVIEW_MEMBER_PREFIX.length);
    if (!isGuid(suggestionId)) throw notFound();
    // Membership proof: the suggestion must be in THIS request's received set.
    const rows = await dependencies.findSuggestions(requestId);
    const row = (rows || []).find((candidate) => (
      String(candidate.wmkf_appreviewersuggestionid).toLowerCase() === suggestionId.toLowerCase()
      && Boolean(candidate.wmkf_reviewreceivedat)
      && candidate.wmkf_reviewsharepointfolder
      && isPdfFilename(candidate.wmkf_reviewfilename)
    ));
    if (!row) throw notFound();
    const file = await dependencies.downloadReview({ suggestionId: row.wmkf_appreviewersuggestionid });
    if (!isPdfFilename(file.filename) || !hasPdfHeader(file.buffer)) throw notFound();
    return { buffer: file.buffer, mimeType: 'application/pdf', filename: file.filename, size: file.size, inline: true };
  }

  throw notFound();
}
