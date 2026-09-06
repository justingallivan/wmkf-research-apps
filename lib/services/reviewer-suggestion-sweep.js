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

import { notExcludedFilter, queryAllSuggestions } from '../dataverse/adapters/reviewer-suggestion.js';
import { queryRequests } from '../dataverse/adapters/grant-request.js';
import { isDataverseRecordNotFound } from '../dataverse/core/errors.js';
import { chunk as chunked } from '../utils/chunk.js';
import { expireInvitation, isPastCutoff } from './reviewer-engagement/expire-invitation.js';

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
      const { outcome } = await expireInvitation({
        suggestion: s,
        cutoffIso,
        nowIso,
        actingUserSystemId,
      });
      if (outcome === 'swept') result.swept++;
      else result.skipped++;
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
