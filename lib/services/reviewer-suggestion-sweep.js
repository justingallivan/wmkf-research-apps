/**
 * Sweep stale reviewer-invitation suggestions.
 *
 * "Stale" = wmkf_selected eq true AND wmkf_emailsentat populated AND no
 * response, review-status, receipt, completion or withdrawal evidence AND the parent
 * request's meeting date is at least `graceDays` in the past. The meeting
 * date is the natural close-of-cycle signal — past it, no more responses
 * are expected, so leaving the suggestion in "pending" is misleading.
 *
 * Flips matching rows to wmkf_responsetype = no_response with
 * wmkf_responsereceivedat = now. Distinct from `declined` (reviewer-initiated)
 * and `withdrawn_sufficient` (PD "we're full" cancellation) so analytics
 * stay clean.
 *
 * Discovery is only a shortlist. Each write rechecks the suggestion and its
 * parent date, then uses that suggestion's exact ETag. Changed/missing rows,
 * unusable versions and precondition conflicts are skipped without retry.
 * The suggestion ETag does not lock the separate parent Request's meeting date.
 *
 * Designed for cron use (small synchronous batches, fail-soft per-row,
 * bounded by maxBatch); also exposed as a direct service so ad-hoc backfills
 * can call it.
 */

import { RESPONSE_TYPE_MAP, isExcluded, notExcludedFilter, queryAllSuggestions, getByIdWithSelect, patchFields } from '../dataverse/adapters/reviewer-suggestion.js';
import { queryRequests } from '../dataverse/adapters/grant-request.js';
import { isDataverseRecordNotFound } from '../dataverse/core/errors.js';
import { chunk as chunked } from '../utils/chunk.js';

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

function isPastCutoff(meetingDate, cutoffIso) {
  if (!meetingDate) return false;
  const millis = new Date(meetingDate).getTime();
  return Number.isFinite(millis) && new Date(millis).toISOString() < cutoffIso;
}

/**
 * `eligible` counts the discovery shortlist. `skipped` counts eligible rows
 * beyond maxBatch plus safe no-write outcomes from fresh checks or conflicts.
 * Dry runs return discovery counts without fresh checks or writes.
 *
 * @param {object} opts
 * @param {number} [opts.graceDays=0]   Skip requests whose meeting date is
 *                                       within `graceDays` of today. Default 0
 *                                       (sweep starts at meetingdate < now).
 * @param {number} [opts.maxBatch=200]  Hard upper bound on writes per run.
 * @param {boolean} [opts.dryRun=false] Identify but don't write.
 * @param {string}  [opts.actingUserSystemId=null]  Pass-through to writes
 *                                       (impersonation flag in dynamics-service
 *                                       gates whether MSCRMCallerID is sent).
 */
export async function sweepStaleInvites({
  graceDays = 0,
  maxBatch = 200,
  dryRun = false,
  actingUserSystemId = null,
} = {}) {
  const cutoffIso = new Date(Date.now() - graceDays * 86400000).toISOString();
  const nowIso = new Date().toISOString();

  // Step 1: pull every selected, emailed-but-not-yet-resolved suggestion.
  // No request-side join in OData; we filter on meeting date in step 2.
  const candidates = await queryAllSuggestions({
    select: 'wmkf_appreviewersuggestionid,wmkf_emailsentat,_wmkf_request_value,wmkf_accepted,wmkf_declined,wmkf_responsetype',
    filter: `wmkf_selected eq true and wmkf_emailsentat ne null and (wmkf_accepted eq false or wmkf_accepted eq null) and (wmkf_declined eq false or wmkf_declined eq null) and wmkf_responsetype eq null and ${notExcludedFilter()}`,
  });

  if (candidates.records.length === 0) {
    return { scanned: 0, eligible: 0, swept: 0, skipped: 0, errors: [], dryRun };
  }

  // Step 2: batch-fetch parent requests' meeting dates, keep only those past cutoff.
  const requestIds = [...new Set(candidates.records.map((s) => s._wmkf_request_value).filter(Boolean))];
  const meetingDateByRequest = {};
  const CHUNK = 25;
  for (const chunk of chunked(requestIds, CHUNK)) {
    const filter = chunk.map((id) => `akoya_requestid eq ${id}`).join(' or ');
    const { records } = await queryRequests({
      select: 'akoya_requestid,wmkf_meetingdate',
      filter,
      top: chunk.length,
    });
    for (const r of records) {
      meetingDateByRequest[r.akoya_requestid] = r.wmkf_meetingdate || null;
    }
  }

  const eligible = candidates.records.filter((s) =>
    isPastCutoff(meetingDateByRequest[s._wmkf_request_value], cutoffIso));

  const toWrite = eligible.slice(0, maxBatch);
  const result = {
    scanned: candidates.records.length,
    eligible: eligible.length,
    swept: 0,
    skipped: Math.max(0, eligible.length - toWrite.length),
    errors: [],
    dryRun,
  };

  if (dryRun) return result;

  for (const s of toWrite) {
    try {
      const fresh = await getByIdWithSelect(s.wmkf_appreviewersuggestionid, EXPIRY_SELECT);
      if (!isPendingInvitation(fresh)
          || !fresh._wmkf_request_value
          || fresh._wmkf_request_value !== s._wmkf_request_value
          || typeof fresh._etag !== 'string'
          || fresh._etag !== fresh._etag.trim()
          || !/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]+"$/.test(fresh._etag)) {
        result.skipped++;
        continue;
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
        result.skipped++;
        continue;
      }

      await patchFields(s.wmkf_appreviewersuggestionid, {
        wmkf_responsetype: RESPONSE_TYPE_MAP.no_response,
        wmkf_responsereceivedat: nowIso,
      }, { actingUserSystemId, ifMatch: fresh._etag });
      result.swept++;
    } catch (e) {
      if (isDataverseRecordNotFound(e) || e?.status === 412) {
        result.skipped++;
      } else {
        result.errors.push({ id: s.wmkf_appreviewersuggestionid, message: e.message?.slice(0, 240) });
      }
    }
  }
  return result;
}
