import { readScheduledPreparationStateStatusPairs } from '../../../shared/config/siteVisit.js';
import { REQUEST_DOCUMENT_LIFECYCLE_STATE } from '../../../shared/config/requestDocument.js';
import { finalError } from './transition-model.js';
import { readPreparationConfig } from '../pre-site-visit/preparation-config.js';

const sameId = (left, right) => String(left || '').toLowerCase() === String(right || '').toLowerCase();

export async function assertScheduledEnd({ requestId, source, dependencies }) {
  if (typeof dependencies.findSiteVisits !== 'function') {
    throw finalError('A completed Site Visit schedule is required before group review.', 'final_writeup_site_visit_not_ended');
  }
  const result = await dependencies.findSiteVisits([requestId]);
  if (result?.capped || result?.hasMore) {
    throw finalError('The Site Visit schedule could not be completely verified.', 'final_writeup_schedule_unavailable', 503);
  }
  const rows = (result?.records || []).filter((row) => sameId(row._regardingobjectid_value, requestId));
  const pairs = dependencies.readSchedulePairs?.() || readScheduledPreparationStateStatusPairs();
  const env = dependencies.env || process.env;
  const classified = rows.map((row) => pairs.find((pair) => pair.stateCode === Number(row.statecode)
    && pair.statusCode === Number(row.statuscode)) || null);
  const eligible = rows.filter((_row, index) => classified[index]?.eligible);
  const noScheduleMapConfigured = !String(env.STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS || '').trim();
  const preparationInactive = !readPreparationConfig(env).active;
  const completeReview = source.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
    && source.wmkf_milestoneversionid && source.wmkf_milestonecontenthash && source.wmkf_milestonecreatedat
    && source.wmkf_sharepointversionid === source.wmkf_milestoneversionid;
  const legacyWithoutMap = noScheduleMapConfigured && pairs.length === 0 && preparationInactive;
  if (completeReview && (legacyWithoutMap || rows.length === 0)) {
    if (legacyWithoutMap && rows.some((row) => {
      const end = Date.parse(row.scheduledend || '');
      return Number.isFinite(end) && end > (dependencies.now?.() || new Date()).getTime();
    })) {
      throw finalError('Group review cannot start before a future Site Visit ends.', 'final_writeup_site_visit_not_ended');
    }
    return {
      legacyCompleteReview: true,
      compatibilityReason: legacyWithoutMap ? 'legacy_review_schedule_unverified' : 'legacy_complete_review_without_schedule',
    };
  }
  const end = Date.parse(eligible[0]?.scheduledend || '');
  const ended = rows.length > 0 && classified.every(Boolean) && eligible.length === 1
    && Number.isFinite(end) && end <= (dependencies.now?.() || new Date()).getTime();
  if (!ended) {
    throw finalError('Group review can start after the scheduled Site Visit has ended.', 'final_writeup_site_visit_not_ended');
  }
  const event = await dependencies.getSiteVisit?.(eligible[0].activityid);
  if (!event || !event._etag || !sameId(event.activityid, eligible[0].activityid)
    || !sameId(event._regardingobjectid_value, requestId)
    || Date.parse(event.scheduledend || '') !== end
    || Number(event.statecode) !== Number(eligible[0].statecode)
    || Number(event.statuscode) !== Number(eligible[0].statuscode)) {
    throw finalError('The completed Site Visit schedule could not be concurrency-verified.', 'final_writeup_schedule_unavailable', 503);
  }
  return {
    siteVisitId: event.activityid,
    scheduledEnd: event.scheduledend,
    stateCode: Number(event.statecode),
    statusCode: Number(event.statuscode),
    eventEtag: event._etag,
  };
}
