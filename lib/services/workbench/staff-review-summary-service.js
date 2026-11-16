import { getById, updateById } from '../../dataverse/adapters/grant-request';
import { linkedCycleCode, linkedCycleExpand } from '../../dataverse/adapters/operations-grant-cycle';
import { isJ27ScopeCycle } from './j27-read-model';
import { isDataverseRecordNotFound } from '../../dataverse/core/errors';
import { getReviewers } from '../review-manager/reviewers-service';
import { composeReviewerFacts } from '../../../shared/utils/review-writeup-paragraphs';
import { ServiceHttpError } from '../service-http-error';

// The isolated sandbox rule now lives with the other field readiness checks.
export { staffReviewSummaryEnabled } from '../../utils/workbench-field-readiness.js';

const conflict = (message) => new ServiceHttpError(message, { httpStatus: 409 });

export async function getStaffReviewSummary(requestId) {
  const row = await getById(requestId, {
    select: 'akoya_requestid,wmkf_staffreviewsummary,wmkf_staffreviewevidencehash',
    expand: linkedCycleExpand(),
  }).catch(error => {
    if (isDataverseRecordNotFound(error)) return null;
    throw error;
  });
  if (!row?.akoya_requestid || !isJ27ScopeCycle(linkedCycleCode(row))) {
    throw new ServiceHttpError('Request not found.', { httpStatus: 404 });
  }
  return {
    summary: row.wmkf_staffreviewsummary ?? '',
    evidenceHash: row.wmkf_staffreviewevidencehash ?? null,
    version: row._etag ?? null,
  };
}

export async function getStaffReviewHandoff(requestId) {
  const record = await getStaffReviewSummary(requestId);
  try {
    const { proposals } = await getReviewers({ proposalId: requestId });
    const proposal = proposals.length === 1 ? proposals[0] : null;
    if (proposal?.proposalId?.toLowerCase() !== requestId.toLowerCase() || !Array.isArray(proposal.reviewers)) {
      return { ...record, reviewerFacts: null, currentEvidenceHash: null };
    }
    const reviewers = proposal.reviewers.filter(reviewer => reviewer.reviewReceivedAt);
    return {
      ...record,
      reviewerFacts: composeReviewerFacts(reviewers),
      currentEvidenceHash: proposal.staffReviewEvidenceHash ?? null,
    };
  } catch {
    // Staff prose is still available when the independent evidence read fails.
    return { ...record, reviewerFacts: null, currentEvidenceHash: null };
  }
}

/** `beforeWrite` is required: the route's admission re-check, run just before the conditional write. */
export async function saveStaffReviewSummary({ requestId, version, summary, evidenceHash, actor, beforeWrite }) {
  if (typeof beforeWrite !== 'function') throw new TypeError('beforeWrite is required');
  const current = await getStaffReviewSummary(requestId);
  if (current.version !== version) throw conflict('The request changed. Reload before saving.');
  const { proposals } = await getReviewers({ proposalId: requestId });
  if (proposals[0]?.staffReviewEvidenceHash !== evidenceHash) {
    throw conflict('Review evidence changed. Refresh the reports before saving.');
  }
  if (current.summary === summary && current.evidenceHash === (summary ? evidenceHash : null)) return;
  await beforeWrite();
  try {
    await updateById(requestId, {
      wmkf_staffreviewsummary: summary || null,
      wmkf_staffreviewevidencehash: summary ? evidenceHash : null,
    }, { ifMatch: version, actingUserSystemId: actor, noFallback: true });
  } catch (error) {
    if (error?.status === 412) throw conflict('The request changed. Reload before saving.');
    throw error;
  }
}
