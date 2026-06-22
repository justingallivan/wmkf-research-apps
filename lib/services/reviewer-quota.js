/**
 * Reviewer quota → PD notify (reviewer-engagement Phase 4, spec §3.C).
 *
 * Called from the external accept path AFTER the accept PATCH commits, so the
 * freshly-accepted reviewer is counted (a pre-write count is off by one). When the
 * accepted count first reaches the request's desired count, notify the lead PD ONCE so
 * they can decide whether to selectively decline still-pending invitees. NOT automatic —
 * reaching quota only notifies; it never declines anyone.
 *
 * Concurrency (Codex P1): the "notify once" gate is a conditional null→set of
 * `wmkf_quotanotifiedat` via an If-Match/ETag write. Two concurrent accepts both read it
 * null and both attempt the conditional set; the first wins (200) and notifies, the second
 * loses the ETag race (412) and does NOT notify. Because the only contention on the request
 * row in the accept path is this very write, a 412 reliably means "another accept already
 * crossed the threshold and notified" — so we skip notifying without a retry.
 *
 * Non-fatal: the accept already committed. Any failure here is logged, never raised.
 */

import { DynamicsService } from './dynamics-service.js';
import { countAcceptedForRequest } from '../dataverse/adapters/reviewer-suggestion.js';
import { resolveProgramDirectorEmailForRequest } from './program-director-resolver.js';
import NotificationService from './notification-service.js';

const REQUEST_SET = 'akoya_requests';

/**
 * @param {Object} args
 * @param {string} args.requestId
 * @param {string|null} [args.actingUserSystemId]
 * @returns {Promise<{ notified: boolean, reason?: string, count?: number, desired?: number }>}
 */
export async function maybeNotifyQuotaReached({ requestId, actingUserSystemId = null } = {}) {
  if (!requestId) return { notified: false, reason: 'no_request' };

  // Fresh read for the desired count, the prior-notify marker, and a CURRENT ETag (the
  // conditional write needs an up-to-date version token).
  let request;
  try {
    request = await DynamicsService.getRecord(REQUEST_SET, requestId, {
      select: 'akoya_requestid,akoya_requestnum,wmkf_desiredcount,wmkf_quotanotifiedat,_wmkf_programdirector_value',
    });
  } catch (e) {
    return { notified: false, reason: 'request_read_failed' };
  }
  if (!request?.akoya_requestid) return { notified: false, reason: 'request_not_found' };

  const desired = Number.isInteger(request.wmkf_desiredcount) ? request.wmkf_desiredcount : null;
  if (desired == null || desired <= 0) return { notified: false, reason: 'no_quota_configured' };
  if (request.wmkf_quotanotifiedat != null) return { notified: false, reason: 'already_notified' };

  const count = await countAcceptedForRequest(requestId);
  if (count < desired) return { notified: false, reason: 'below_quota', count, desired };

  // Conditional null→set: only the first writer past the threshold succeeds. A 412 means a
  // concurrent accept already claimed the notify — do not double-notify.
  try {
    await DynamicsService.updateRecord(REQUEST_SET, requestId, {
      wmkf_quotanotifiedat: new Date().toISOString(),
    }, { ifMatch: request._etag });
  } catch (e) {
    if (e.status === 412 || /\b412\b/.test(e.message || '')) {
      return { notified: false, reason: 'lost_notify_race', count, desired };
    }
    return { notified: false, reason: 'quota_marker_write_failed', count, desired };
  }

  // We own the single false→set transition — notify the lead PD.
  const pdEmail = await resolveProgramDirectorEmailForRequest(requestId).catch(() => null);
  try {
    await NotificationService.notify({
      type: 'reviewer_quota_reached',
      severity: 'info',
      title: `Reviewer quota reached for ${request.akoya_requestnum || 'a request'}`,
      message:
        `${count} reviewer(s) have accepted for request ${request.akoya_requestnum || requestId}, `
        + `meeting the desired count of ${desired}. You can now selectively decline any still-pending `
        + `invitees you no longer need from the Reviewers tab, or leave them open for a wanted-but-slow reviewer.`,
      metadata: { requestId, requestNumber: request.akoya_requestnum || null, count, desired },
      source: 'reviewer-quota',
      category: 'reviewers',
      explicitRecipients: pdEmail ? [pdEmail] : [],
    });
  } catch (notifyErr) {
    // The marker is set (quota won't re-notify); the alert delivery failed. Log only —
    // the accept is committed and the threshold transition already happened.
    console.warn('[reviewer-quota] PD notify failed after marker set (non-fatal):', notifyErr?.message || notifyErr);
  }
  return { notified: true, count, desired };
}
