/**
 * D48 invitation precondition: an invitation (emailed by send-emails, or a
 * first copyable link from regenerate-token) needs the reviewer-visible
 * proposal PDF, so materials are ready whenever the reviewer accepts.
 *
 * Returns 'present' when at least one reviewer-visible proposal file is
 * listed; 'unavailable' when nothing matched and some folder could not be
 * listed for a reason other than a speculative archive folder not existing
 * (or the listing threw); otherwise 'missing'.
 */
import { listReviewerMaterialsWithAvailability } from '../../external/reviewer-materials';

export async function checkInvitationProposalPdf(request) {
  if (!request?.akoya_requestid || !request?.akoya_requestnum) return 'unavailable';
  try {
    const { files, unavailableSources = [] } = await listReviewerMaterialsWithAvailability(request.akoya_requestid, request.akoya_requestnum);
    if (files.length > 0) return 'present';
    return unavailableSources.length > 0 ? 'unavailable' : 'missing';
  } catch (err) {
    console.error(`[invitation-proposal-pdf] check failed for request ${request.akoya_requestid}: ${err.message}`);
    return 'unavailable';
  }
}
