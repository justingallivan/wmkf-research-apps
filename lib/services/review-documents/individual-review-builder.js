/**
 * Shared builder for one structured review's approved individual DOCX.
 *
 * The caller owns the authoritative suggestion/request/reviewer reads and the
 * generation timestamp. This module owns the stable answer-snapshot read,
 * report composition, filename, content type, and template-backed render. The
 * thank-you sweep supplies send time; retained-file generation will supply the
 * review receipt time without introducing a second composition contract.
 */

import { fetchAnswersBySuggestion } from '../review-answers.js';
import { composeSingleReviewCopy } from '../../../shared/utils/review-report.js';
import { renderIndividualReviewDocx } from './docx-renderer.js';

export const REVIEW_DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function reviewerTitleAndOrganization(row) {
  const title = String(row?.wmkf_reviewertitle || '').trim();
  const organization = String(row?.wmkf_revieweraffiliation || '').trim();
  if (!title) return organization || null;
  if (!organization || title.toLowerCase().includes(organization.toLowerCase())) return title;
  return `${title}, ${organization}`;
}

/**
 * Build the DOCX attachment/file payload for one structured review.
 *
 * `generatedAtIso` is deliberately caller-supplied: thank-you attachments keep
 * send-time metadata, while the future retained SharePoint copy can use the
 * immutable review receipt timestamp.
 */
export async function buildIndividualReviewDocx({
  suggestionId,
  reviewer,
  request,
  row,
  generatedAtIso,
}) {
  const answersBySuggestion = await fetchAnswersBySuggestion([suggestionId]);
  const answers = answersBySuggestion[suggestionId] || [];
  const copy = composeSingleReviewCopy({
    reviewerName: reviewer.wmkf_name || null,
    reviewerTitleAndOrganization: reviewerTitleAndOrganization(row),
    requestNumber: request.akoya_requestnum || null,
    requestTitle: request.akoya_title || null,
    institution: request.wmkf_organizationname || request._akoya_applicantid_value_formatted || null,
    submittedAt: row.wmkf_reviewreceivedat || null,
    generatedAtIso,
    answers,
  });
  const content = await renderIndividualReviewDocx(copy);
  return {
    filename: `Review-${request.akoya_requestnum || 'copy'}.docx`,
    contentType: REVIEW_DOCX_CONTENT_TYPE,
    content,
  };
}
