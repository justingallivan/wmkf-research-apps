/**
 * Leadership-review checkpoint contract for a Final Writeup row.
 *
 * A Final Writeup row in lifecycle FINAL means "leadership review" only when
 * the complete checkpoint is present and well-formed: the explicit leadership
 * actor/time pair plus every SharePoint observation field the transition
 * refreshes. Every reader of a Final row's lifecycle (transition status,
 * acknowledgement, dashboard) shares this one predicate so a half-written or
 * malformed row is reported for reconciliation everywhere, never accepted by
 * one surface and rejected by another.
 */

import { isGuid } from '../../utils/guid.js';
import { REQUEST_DOCUMENT_LIFECYCLE_STATE } from '../../../shared/config/requestDocument.js';

function nonBlankString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseableTimestamp(value) {
  return nonBlankString(value) && Number.isFinite(Date.parse(value));
}

export function isLeadershipCheckpointComplete(final) {
  if (!final) return false;
  const size = final.wmkf_filesize;
  return parseableTimestamp(final.wmkf_leadershipreviewstartedat)
    && isGuid(final._wmkf_leadershipreviewstartedby_value)
    && nonBlankString(final.wmkf_sharepointversionid)
    && nonBlankString(final.wmkf_sharepointetag)
    && parseableTimestamp(final.wmkf_sharepointlastmodified)
    && (typeof size === 'number' || nonBlankString(size))
    && Number.isFinite(Number(size))
    && Number(size) >= 0
    && nonBlankString(final.wmkf_contenthash);
}

/**
 * Lifecycle acceptance shared by every Final-row reader: REVIEW is group
 * review; FINAL is leadership review only with the complete checkpoint; every
 * other lifecycle is rejected.
 */
export function isAcceptedFinalLifecycle(final) {
  if (final?.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW) return true;
  return final?.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL
    && isLeadershipCheckpointComplete(final);
}
