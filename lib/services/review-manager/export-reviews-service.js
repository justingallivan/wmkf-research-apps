/**
 * Authoritative combined-review DOCX export.
 *
 * The caller supplies only an authenticated user's email and a validated
 * request GUID. Review content is loaded server-side through the same service
 * that backs the Reviews tab, then composed from submitted answer snapshots.
 */

import { getReviewers } from './reviewers-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { deriveReviewMatrix } from '../../../shared/utils/review-matrix.js';
import { composeReviewReport } from '../../../shared/utils/review-report.js';
import { renderCombinedReviewDocx } from '../review-documents/docx-renderer.js';

function safeFilenamePart(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function yyyymmdd(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'export';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}${byType.month}${byType.day}`;
}

/**
 * @param {Object} args
 * @param {string} args.proposalId - validated request GUID.
 * @param {string|undefined} args.azureEmail - session-derived staff identity.
 * @param {string} [args.generatedAtIso]
 * @returns {Promise<{content:Buffer, filename:string}>}
 */
export async function exportCombinedReviews({
  proposalId,
  azureEmail,
  generatedAtIso = new Date().toISOString(),
}) {
  const result = await getReviewers({ proposalId, azureEmail });
  const proposal = result.proposals?.[0] || null;
  if (!proposal) {
    throw new ServiceHttpError('Request not found.', {
      httpStatus: 404,
      code: 'request_not_found',
      body: { error: 'Request not found.', code: 'request_not_found' },
    });
  }

  const submitted = (proposal.reviewers || []).filter((reviewer) => reviewer.reviewReceivedAt);
  if (submitted.length === 0) {
    throw new ServiceHttpError('No submitted reviews are available to export.', {
      httpStatus: 409,
      code: 'no_submitted_reviews',
      body: { error: 'No submitted reviews are available to export.', code: 'no_submitted_reviews' },
    });
  }

  const matrix = deriveReviewMatrix(submitted, result.liveQuestions ?? null);
  const report = composeReviewReport({
    requestNumber: proposal.requestNumber ?? null,
    requestTitle: proposal.proposalTitle ?? null,
    piName: proposal.proposalAuthors ?? null,
    institution: proposal.proposalInstitution ?? null,
    matrix,
    generatedAtIso,
    synthesis: proposal.reviewSynthesis ?? null,
    synthesisCurrent: proposal.reviewSynthesisState?.current ?? null,
  });
  const content = await renderCombinedReviewDocx(report);
  const requestPart = safeFilenamePart(proposal.requestNumber || proposal.proposalId, 'request');
  return {
    content,
    filename: `reviews-${requestPart}-${yyyymmdd(generatedAtIso)}.docx`,
  };
}
