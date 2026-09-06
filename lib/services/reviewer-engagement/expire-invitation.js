/**
 * Reviewer engagement — invitation expiry command
 * (Reviewer Lifecycle Stage 3E: extracted from
 * `lib/services/reviewer-suggestion-sweep.js`, the per-row body of its
 * `for (const s of toWrite)` loop; the sweep's discovery, batch/dry-run
 * counters, and the loop's outer try/catch — which owns 412 and
 * not-found handling — stay there).
 *
 * `isPastCutoff` moves here (the sweep's discovery pass also uses it for
 * meeting-date filtering, so the sweep imports it back from this module).
 */

import { RESPONSE_TYPE_MAP, getByIdWithSelect, patchFields, isExcluded } from '../../dataverse/adapters/reviewer-suggestion.js';
import { queryRequests } from '../../dataverse/adapters/grant-request.js';

const EXPIRY_SELECT = [
  'wmkf_appreviewersuggestionid', 'wmkf_selected', 'wmkf_emailsentat',
  '_wmkf_request_value', 'wmkf_accepted', 'wmkf_declined',
  'wmkf_responsetype', 'wmkf_responsereceivedat', 'wmkf_reviewreceivedat',
  'wmkf_reviewstatus', 'wmkf_completedat', 'wmkf_withdrawnsufficientat',
  'wmkf_applicantdisposition',
].join(',');

function isPendingInvitation(row) {
  return row?.wmkf_selected === true
    && typeof row.wmkf_emailsentat === 'string' && row.wmkf_emailsentat.trim() !== ''
    && (row.wmkf_accepted === false || row.wmkf_accepted == null)
    && (row.wmkf_declined === false || row.wmkf_declined == null)
    && row.wmkf_responsetype == null
    && row.wmkf_responsereceivedat == null
    && row.wmkf_reviewreceivedat == null
    && row.wmkf_reviewstatus == null
    && row.wmkf_completedat == null
    && row.wmkf_withdrawnsufficientat == null
    && !isExcluded(row);
}

export function isPastCutoff(meetingDate, cutoffIso) {
  if (!meetingDate) return false;
  const millis = new Date(meetingDate).getTime();
  return Number.isFinite(millis) && new Date(millis).toISOString() < cutoffIso;
}

/**
 * Re-validates and, if still eligible, expires a single stale invitation
 * suggestion. Returns `{ outcome: 'skipped' }` or `{ outcome: 'swept' }`;
 * errors (including a rejected conditional write) propagate to the caller,
 * which owns retry/skip classification for 412 and not-found.
 *
 * @param {object} args
 * @param {object} args.suggestion   Discovery-shortlist row (must carry
 *                                    wmkf_appreviewersuggestionid and
 *                                    _wmkf_request_value).
 * @param {string} args.cutoffIso
 * @param {string} args.nowIso
 * @param {string|null} args.actingUserSystemId
 */
export async function expireInvitation({ suggestion, cutoffIso, nowIso, actingUserSystemId }) {
  const s = suggestion;
  const fresh = await getByIdWithSelect(s.wmkf_appreviewersuggestionid, EXPIRY_SELECT);
  if (!isPendingInvitation(fresh)
      || !fresh._wmkf_request_value
      || fresh._wmkf_request_value !== s._wmkf_request_value
      || typeof fresh._etag !== 'string'
      || fresh._etag !== fresh._etag.trim()
      || !/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]+"$/.test(fresh._etag)) {
    return { outcome: 'skipped' };
  }

  // Revalidate this parent instead of reusing the discovery date. A later
  // parent-only edit remains outside the suggestion's ETag protection.
  const { records } = await queryRequests({
    select: 'akoya_requestid,wmkf_meetingdate',
    filter: `akoya_requestid eq ${fresh._wmkf_request_value}`,
    top: 1,
  });
  const parent = records.find((r) => r.akoya_requestid === fresh._wmkf_request_value);
  if (!isPastCutoff(parent?.wmkf_meetingdate, cutoffIso)) {
    return { outcome: 'skipped' };
  }

  await patchFields(s.wmkf_appreviewersuggestionid, {
    wmkf_responsetype: RESPONSE_TYPE_MAP.no_response,
    wmkf_responsereceivedat: nowIso,
  }, { actingUserSystemId, ifMatch: fresh._etag });
  return { outcome: 'swept' };
}
