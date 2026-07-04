/**
 * Manual "Send reminder now" action (workbench Reviews tab, Phase 1 —
 * docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md, governing decision 5).
 *
 * A staffer can nudge a single accepted-but-not-submitted reviewer on demand.
 * This reuses the review-due reminder's claim/send/token/template machinery
 * from `reviewer-reminder-sweep.js` verbatim (`sendOneReminder`,
 * `loadRequestContext`, `loadReviewer`) so manual and cron sends are
 * byte-identical in what they send and how they claim.
 *
 * Manual-send semantics (binding, per the plan):
 *   - Stamps the SAME `wmkf_remindersentat` marker + increments
 *     `wmkf_remindercount` the cron uses, so the fire-once cron (which filters
 *     `wmkf_remindersentat eq null`) will skip anyone manually nudged.
 *   - UNLIKE the cron, a manual re-send when the marker is already set IS
 *     allowed (staff-initiated, deliberate) — there is no `wmkf_remindersentat
 *     eq null` filter here.
 *   - Still concurrency-safe: `sendOneReminder` claims via If-Match BEFORE
 *     sending (claim-before-send, at-most-once). A 412 on the claim aborts
 *     without sending and is surfaced as a conflict, not silently retried.
 *
 * Eligibility (server-side, re-checked against a fresh read — never trusts
 * client-supplied status): suggestion belongs to the given request, accepted,
 * materials sent (or under review), review not yet received, not
 * applicant-excluded (`isExcluded`, same predicate as `notExcludedFilter`).
 */

import { DynamicsService } from './dynamics-service.js';
import { readRequiredEmailDefaults } from './email-defaults.js';
import { isExcluded } from '../dataverse/adapters/reviewer-suggestion.js';
import {
  SUGGESTION_SET,
  REVIEW_DUE_SUBJECT_KEY,
  REVIEW_DUE_BODY_KEY,
  REVIEW_STATUS_MATERIALS_SENT,
  REVIEW_STATUS_UNDER_REVIEW,
  loadRequestContext,
  loadReviewer,
  sendOneReminder,
} from './reviewer-reminder-sweep.js';

const SUGGESTION_SELECT = [
  'wmkf_appreviewersuggestionid',
  '_wmkf_request_value',
  '_wmkf_potentialreviewer_value',
  'wmkf_accepted',
  'wmkf_reviewstatus',
  'wmkf_reviewreceivedat',
  'wmkf_applicantdisposition',
  'wmkf_remindercount',
].join(',');

/**
 * @param {{ requestId: string, suggestionId: string, actingUserSystemId?: string|null }} args
 *   Both ids must already be GUID-validated by the caller (route trust boundary) —
 *   this service interpolates them raw into Dataverse selectors.
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'misconfigured'|'not_found'|'ineligible'|'conflict'|'send_failed', errors?: any[] }>}
 */
export async function sendManualReviewDueReminder({ requestId, suggestionId, actingUserSystemId = null } = {}) {
  const emailDefaults = await readRequiredEmailDefaults([REVIEW_DUE_SUBJECT_KEY, REVIEW_DUE_BODY_KEY], {
    source: 'reviewer-reminders-review-due-manual',
  });
  if (!emailDefaults.ok) {
    return { ok: false, reason: 'misconfigured', errors: emailDefaults.failures };
  }

  let row;
  try {
    row = await DynamicsService.getRecord(SUGGESTION_SET, suggestionId, { select: SUGGESTION_SELECT });
  } catch (e) {
    return { ok: false, reason: 'not_found' };
  }
  if (!row?.wmkf_appreviewersuggestionid) return { ok: false, reason: 'not_found' };

  // Eligibility, re-derived from a fresh read (never trust client-claimed state).
  if (row._wmkf_request_value !== requestId) return { ok: false, reason: 'ineligible' };
  if (row.wmkf_accepted !== true) return { ok: false, reason: 'ineligible' };
  const materialsSent = row.wmkf_reviewstatus === REVIEW_STATUS_MATERIALS_SENT
    || row.wmkf_reviewstatus === REVIEW_STATUS_UNDER_REVIEW;
  if (!materialsSent) return { ok: false, reason: 'ineligible' };
  if (row.wmkf_reviewreceivedat) return { ok: false, reason: 'ineligible' };
  if (isExcluded(row)) return { ok: false, reason: 'ineligible' };

  const ctx = await loadRequestContext(requestId, new Map());
  if (!ctx) return { ok: false, reason: 'ineligible' };
  const { request, pd, signatureBlock } = ctx;
  if (!pd?.internalemailaddress || !pd?.systemuserid) return { ok: false, reason: 'ineligible' };

  const reviewer = await loadReviewer(row._wmkf_potentialreviewer_value);
  if (!reviewer?.wmkf_emailaddress) return { ok: false, reason: 'ineligible' };

  const result = { sent: 0, claimFailed: 0, sendFailed: 0, errors: [] };
  await sendOneReminder({
    kind: 'reviewdue',
    subjectTemplate: emailDefaults.values[REVIEW_DUE_SUBJECT_KEY],
    bodyTemplate: emailDefaults.values[REVIEW_DUE_BODY_KEY],
    row,
    request,
    pd,
    signatureBlock,
    reviewer,
    actingUserSystemId,
    result,
  });

  if (result.claimFailed > 0) return { ok: false, reason: 'conflict' };
  if (result.sendFailed > 0) return { ok: false, reason: 'send_failed', errors: result.errors };
  return { ok: true };
}
