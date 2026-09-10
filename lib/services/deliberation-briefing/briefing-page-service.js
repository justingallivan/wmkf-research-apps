/**
 * Read model for the external deliberation briefing page
 * (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.1, §2.3).
 *
 * Everything here is resolved server-side from the verified token's request:
 *   - writeup: the frozen Word/PDF snapshots pinned on the latest distribution
 *     attempt Dynamics accepted for transport (exact version, write-once items,
 *     bytes re-hashed against the ledger on every download);
 *   - reviews: every selected suggestion with a received review (D14), with
 *     the reviewer's name and affiliation (D13), the answer snapshot, and the
 *     uploaded file when one exists;
 *   - proposal narrative: `AI Materials/ProposalNarrative_{Request#}.pdf`
 *     resolved by governed path at request time;
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
import { fetchAnswersBySuggestion } from '../review-answers';
import { downloadReview } from '../review-manager/download-review-service';
import {
  expectedProposalNarrativeFilename,
  resolveActiveAiMaterialsFolder,
} from '../workbench-proposal-documents';
import { getLatestSentAttempt } from '../pre-site-visit/distribution-store';
import { selectActiveSiteVisit } from './site-visit-selection';
import { getDeliberationSessionForRequest } from './session-reader';

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
  '_akoya_applicantid_value',
];
const PERSON_SELECT = ['wmkf_potentialreviewersid', 'wmkf_name', 'wmkf_organizationname', 'wmkf_primaryaffiliation'];

export const BRIEFING_MEMBER = Object.freeze({
  WRITEUP_DOCX: 'writeup-docx',
  WRITEUP_PDF: 'writeup-pdf',
  PROPOSAL: 'proposal',
});
const REVIEW_MEMBER_PREFIX = 'review:';

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
  resolveNarrativeFolder: resolveActiveAiMaterialsFolder,
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
      file: row.wmkf_reviewsharepointfolder && row.wmkf_reviewfilename
        ? { member: `${REVIEW_MEMBER_PREFIX}${row.wmkf_appreviewersuggestionid}`, filename: row.wmkf_reviewfilename }
        : null,
    });
  }
  reviews.sort((a, b) => String(a.receivedAt || '').localeCompare(String(b.receivedAt || '')));
  return reviews;
}

function writeupFromAttempt(attempt) {
  if (!attempt) return null;
  const docx = attempt.docx_drive_id && attempt.docx_item_id
    ? { member: BRIEFING_MEMBER.WRITEUP_DOCX, filename: attempt.docx_filename, size: Number(attempt.docx_size) || null }
    : null;
  const pdf = attempt.pdf_drive_id && attempt.pdf_item_id
    ? { member: BRIEFING_MEMBER.WRITEUP_PDF, filename: attempt.pdf_filename, size: Number(attempt.pdf_size) || null }
    : null;
  return { docx, pdf, sharedAt: isoOrNull(attempt.sent_at || attempt.send_requested_at) };
}

async function locateNarrative(request, dependencies) {
  const filename = expectedProposalNarrativeFilename(request.akoya_requestnum);
  if (!filename) return null;
  const location = await dependencies.resolveNarrativeFolder(request.akoya_requestid, request.akoya_requestnum);
  if (!location) return null;
  const metadata = await dependencies.getFileMetadataByPath(location.library, location.folder, filename);
  if (!metadata?.id || !metadata?.driveId) return null;
  return { driveId: metadata.driveId, itemId: metadata.id, filename: metadata.name || filename, size: metadata.size ?? null };
}

/**
 * Page model for a verified token. `link` is the verified briefing row.
 */
export async function buildBriefingContext({ requestId, link }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(requestId)) throw notFound();
  const { request, institution } = await loadHeader(requestId, dependencies);
  const [reviews, attempt, siteVisit, session, narrative] = await Promise.all([
    loadReviews(requestId, dependencies),
    dependencies.getLatestAttempt(requestId),
    dependencies.findActiveSiteVisit(requestId).catch(() => null),
    dependencies.getSession(requestId).catch(() => null),
    locateNarrative(request, dependencies).catch(() => null),
  ]);
  return {
    ok: true,
    title: institution || 'Deliberation briefing',
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
    writeup: writeupFromAttempt(attempt),
    reviews,
    proposal: narrative ? { member: BRIEFING_MEMBER.PROPOSAL, filename: narrative.filename, size: narrative.size } : null,
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

  if (member === BRIEFING_MEMBER.WRITEUP_DOCX || member === BRIEFING_MEMBER.WRITEUP_PDF) {
    const attempt = await dependencies.getLatestAttempt(requestId);
    const prefix = member === BRIEFING_MEMBER.WRITEUP_DOCX ? 'docx' : 'pdf';
    const driveId = attempt?.[`${prefix}_drive_id`];
    const itemId = attempt?.[`${prefix}_item_id`];
    if (!driveId || !itemId) throw notFound();
    const file = await dependencies.downloadFile(driveId, itemId);
    // The ledger pinned the exact bytes it sent; refuse to serve anything else.
    const expectedHash = String(attempt[`${prefix}_byte_hash`] || '');
    const actualHash = createHash('sha256').update(file.buffer).digest('hex');
    if (!/^[0-9a-f]{64}$/.test(expectedHash) || actualHash !== expectedHash) {
      throw new ServiceHttpError('snapshot bytes differ from the pinned hash', {
        httpStatus: 409,
        body: { ok: false, reason: 'snapshot_mismatch' },
      });
    }
    const mimeType = attempt[`${prefix}_content_type`] || file.mimeType || 'application/octet-stream';
    return { buffer: file.buffer, mimeType, filename: attempt[`${prefix}_filename`] || file.filename, size: file.size, inline: mimeType === 'application/pdf' };
  }

  if (member === BRIEFING_MEMBER.PROPOSAL) {
    const narrative = await locateNarrative(request, dependencies);
    if (!narrative) throw notFound();
    const file = await dependencies.downloadFile(narrative.driveId, narrative.itemId);
    const mimeType = file.mimeType || 'application/pdf';
    return { buffer: file.buffer, mimeType, filename: narrative.filename, size: file.size, inline: mimeType === 'application/pdf' };
  }

  if (member.startsWith(REVIEW_MEMBER_PREFIX)) {
    const suggestionId = member.slice(REVIEW_MEMBER_PREFIX.length);
    if (!isGuid(suggestionId)) throw notFound();
    // Membership proof: the suggestion must be in THIS request's received set.
    const rows = await dependencies.findSuggestions(requestId);
    const row = (rows || []).find((candidate) => (
      String(candidate.wmkf_appreviewersuggestionid).toLowerCase() === suggestionId.toLowerCase()
      && Boolean(candidate.wmkf_reviewreceivedat)
      && candidate.wmkf_reviewsharepointfolder && candidate.wmkf_reviewfilename
    ));
    if (!row) throw notFound();
    const file = await dependencies.downloadReview({ suggestionId: row.wmkf_appreviewersuggestionid });
    const mimeType = file.mimeType || 'application/octet-stream';
    return { buffer: file.buffer, mimeType, filename: file.filename, size: file.size, inline: mimeType === 'application/pdf' };
  }

  throw notFound();
}
