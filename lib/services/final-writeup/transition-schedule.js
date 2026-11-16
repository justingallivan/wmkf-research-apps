import { readScheduledPreparationStateStatusPairs } from '../../../shared/config/siteVisit.js';
import { REQUEST_DOCUMENT_LIFECYCLE_STATE } from '../../../shared/config/requestDocument.js';
import { linkedCycleCode } from '../../dataverse/adapters/operations-grant-cycle.js';
import { isJ27ScopeCycle } from '../workbench/j27-read-model.js';
import { finalError } from './transition-model.js';
import { readPreparationConfig } from '../pre-site-visit/preparation-config.js';

const sameId = (left, right) => String(left || '').toLowerCase() === String(right || '').toLowerCase();

/**
 * The schedule classification the start guard relies on, as a pure function so
 * the J27 later-phase facts (lib/services/workbench/j27-later-facts.js) read a
 * presentation's end by the same rule. `state`: `missing` (no record),
 * `unverified` (a record does not classify, or not exactly one is eligible, or
 * its end is unreadable), `upcoming`, `ended`.
 */
export function classifyPresentationSchedule(rows, pairs, nowMs) {
  const classified = rows.map((row) => pairs.find((pair) => pair.stateCode === Number(row.statecode)
    && pair.statusCode === Number(row.statuscode)) || null);
  const eligible = rows.filter((_row, index) => classified[index]?.eligible);
  const end = Date.parse(eligible[0]?.scheduledend || '');
  const classifiedSchedule = rows.length > 0 && classified.every(Boolean) && eligible.length === 1 && Number.isFinite(end);
  const state = rows.length === 0 ? 'missing' : !classifiedSchedule ? 'unverified' : end > nowMs ? 'upcoming' : 'ended';
  return { state, eligible, end, classifiedSchedule };
}

export async function assertScheduledEnd({ requestId, request, source, dependencies }) {
  if (typeof dependencies.findSiteVisits !== 'function') {
    throw finalError('A completed Research presentation schedule is required before group review.', 'final_writeup_site_visit_not_ended');
  }
  const result = await dependencies.findSiteVisits([requestId]);
  if (result?.capped || result?.hasMore) {
    throw finalError('The Research presentation schedule could not be completely verified.', 'final_writeup_schedule_unavailable', 503);
  }
  const rows = (result?.records || []).filter((row) => sameId(row._regardingobjectid_value, requestId));
  const pairs = dependencies.readSchedulePairs?.() || readScheduledPreparationStateStatusPairs();
  const env = dependencies.env || process.env;
  const schedule = classifyPresentationSchedule(rows, pairs, (dependencies.now?.() || new Date()).getTime());
  const { eligible, end } = schedule;
  const noScheduleMapConfigured = !String(env.STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS || '').trim();
  const preparationInactive = !readPreparationConfig(env).active;
  const completeReview = source.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
    && source.wmkf_milestoneversionid && source.wmkf_milestonecontenthash && source.wmkf_milestonecreatedat
    && source.wmkf_sharepointversionid === source.wmkf_milestoneversionid;
  const legacyWithoutMap = noScheduleMapConfigured && pairs.length === 0 && preparationInactive;
  // The request's live Grant Cycle link owns scope; the document's copied code may be stale.
  // D63/D64: only a resolved earlier cycle may bypass presentation verification.
  const cycleCode = linkedCycleCode(request);
  const legacyCycle = cycleCode !== null && !isJ27ScopeCycle(cycleCode);
  if (legacyCycle && completeReview && (legacyWithoutMap || rows.length === 0)) {
    if (legacyWithoutMap && rows.some((row) => {
      const end = Date.parse(row.scheduledend || '');
      return Number.isFinite(end) && end > (dependencies.now?.() || new Date()).getTime();
    })) {
      throw finalError('Group review cannot start before a future Research presentation ends.',
        'final_writeup_site_visit_not_ended', 409, { presentationSchedule: 'unverified' });
    }
    return {
      legacyCompleteReview: true,
      compatibilityReason: legacyWithoutMap ? 'legacy_review_schedule_unverified' : 'legacy_complete_review_without_schedule',
    };
  }
  if (schedule.state !== 'ended') {
    const presentationSchedule = schedule.state;
    throw finalError('Group review can start after the scheduled Research presentation has ended.',
      'final_writeup_site_visit_not_ended', 409, { presentationSchedule });
  }
  const event = await dependencies.getSiteVisit?.(eligible[0].activityid);
  if (!event || !event._etag || !sameId(event.activityid, eligible[0].activityid)
    || !sameId(event._regardingobjectid_value, requestId)
    || Date.parse(event.scheduledend || '') !== end
    || Number(event.statecode) !== Number(eligible[0].statecode)
    || Number(event.statuscode) !== Number(eligible[0].statuscode)) {
    throw finalError('The completed Research presentation schedule could not be concurrency-verified.', 'final_writeup_schedule_unavailable', 503);
  }
  return {
    siteVisitId: event.activityid,
    scheduledEnd: event.scheduledend,
    stateCode: Number(event.statecode),
    statusCode: Number(event.statuscode),
    eventEtag: event._etag,
  };
}
