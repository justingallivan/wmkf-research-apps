/**
 * Reviewer VIP flags service (reviewer invitation VIP preview slice).
 *
 * Per-(lead PD, reviewer person) flags backing the Invite Reviewers panel:
 * a flagged person's invitation drafts render as full editable preview
 * cards; others collapse to the batch summary. The lead PD ALWAYS resolves
 * server-side from the request row — callers pass a request id, never a PD.
 * Flags key on wmkf_potentialreviewersid (candidates have no CRM contact
 * pre-acceptance, S389). Synchronous routing aid only: no ledger workflow
 * reads these flags and no send path is gated here.
 *
 * Contract: plain argument objects, never req/res; ASSUMES a trusted DAL
 * context already exists — the route shell establishes it.
 */

import { getById as getRequestById } from '../../dataverse/adapters/grant-request';
import {
  clearReviewerVipFlag,
  listReviewerVipFlags,
  setReviewerVipFlag,
} from '../scheduled-email-store';

async function resolveLeadPdSystemUserId(requestId) {
  const request = await getRequestById(requestId, {
    select: 'akoya_requestid,_wmkf_programdirector_value',
  });
  return request?._wmkf_programdirector_value || null;
}

/** @returns {Promise<{pdSystemUserId: string, flaggedPotentialReviewerIds: string[]} | null>} null = request has no assigned PD */
export async function listReviewerVipFlagsForRequest(requestId) {
  const pdSystemUserId = await resolveLeadPdSystemUserId(requestId);
  if (!pdSystemUserId) return null;
  const flags = await listReviewerVipFlags(pdSystemUserId);
  return {
    pdSystemUserId,
    flaggedPotentialReviewerIds: flags.map((row) => row.potential_reviewer_id),
  };
}

/** @returns {Promise<{pdSystemUserId: string} | null>} null = request has no assigned PD */
export async function setReviewerVipFlagForRequest(requestId, potentialReviewerId, flagged) {
  const pdSystemUserId = await resolveLeadPdSystemUserId(requestId);
  if (!pdSystemUserId) return null;
  if (flagged) {
    await setReviewerVipFlag(pdSystemUserId, potentialReviewerId);
  } else {
    await clearReviewerVipFlag(pdSystemUserId, potentialReviewerId);
  }
  return { pdSystemUserId };
}
