/**
 * Reviewer engagement — post-send email bookkeeping command
 * (Reviewer Lifecycle Stage 3E: extracted from
 * `lib/services/review-manager/send-emails-service.js`, which imports and
 * calls `recordDeliveredEmail` unchanged at its existing post-loop site; it
 * is not re-exported from the old module — no other production caller uses
 * it).
 *
 * Scan orchestration, transport, streaming and correlation stay in
 * `send-emails-service.js`; this file holds only the conditional,
 * re-validated write that stamps a single already-delivered message.
 */

import { REVIEW_STATUS_MAP } from '../../../shared/config/reviewerLifecycle.js';
import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { isConcreteEtag } from '../../utils/etag';

const POST_SEND_OPEN_REVIEW_STATUSES = new Set([
  REVIEW_STATUS_MAP.accepted,
  REVIEW_STATUS_MAP.materials_sent,
  REVIEW_STATUS_MAP.under_review,
  REVIEW_STATUS_MAP.review_received,
]);

// This records an already-delivered message, never sends one. Each conditional
// attempt re-evaluates the row so a receipt/closeout or another reminder cannot
// be overwritten using the earlier recipient-hydration snapshot.
export async function recordDeliveredEmail({ suggestionId, originalSuggestion, templateType, sentAt, actingUserSystemId }) {
  const timestampField = {
    materials: 'wmkf_materialssentat',
    followup: 'wmkf_remindersentat',
    thankyou: 'wmkf_thankyousentat',
  }[templateType];
  if (typeof timestampField !== 'string') throw new Error(`Unsupported post-send template: ${templateType}`);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fresh = await suggestionAdapter.findById(suggestionId);
    if (!fresh) throw new Error('Suggestion is no longer available');
    for (const lookup of ['_wmkf_request_value', '_wmkf_potentialreviewer_value']) {
      const originalId = originalSuggestion?.[lookup];
      const freshId = fresh[lookup];
      if (typeof originalId !== 'string' || !originalId.trim()
          || typeof freshId !== 'string' || !freshId.trim()
          || originalId.toLowerCase() !== freshId.toLowerCase()) {
        throw new Error('Suggestion request or reviewer binding changed after delivery');
      }
    }
    // Same concrete-version contract as the invitation expiry writer. Never
    // downgrade a missing/malformed version to the adapter's fallback or '*'.
    if (!isConcreteEtag(fresh._etag)) {
      throw new Error('Suggestion version is unavailable for email bookkeeping');
    }

    const status = fresh.wmkf_reviewstatus;
    if (templateType !== 'thankyou'
        && (fresh.wmkf_completedat || (status != null && !POST_SEND_OPEN_REVIEW_STATUSES.has(status)))) {
      throw new Error('Suggestion is closed or has an unknown review status');
    }
    const received = Boolean(fresh.wmkf_reviewreceivedat) || status === REVIEW_STATUS_MAP.review_received;
    // Another completed send may have recorded a newer timestamp while this
    // attempt was in flight. Preserve it while still counting this delivery.
    const recordedAt = fresh[timestampField];
    const timestamp = Date.parse(recordedAt) > Date.parse(sentAt) ? recordedAt : sentAt;
    let updates;
    if (templateType === 'materials') {
      const shouldBump = !received && (status == null || status === REVIEW_STATUS_MAP.accepted);
      updates = { materialsSentAt: timestamp, ...(shouldBump ? { reviewStatus: 'materials_sent' } : {}) };
    } else if (templateType === 'followup') {
      const count = fresh.wmkf_remindercount ?? 0;
      if (!Number.isInteger(count) || count < 0 || count >= 2147483647) {
        throw new Error('Suggestion reminder count is invalid or exhausted');
      }
      const shouldBump = !received
        && (status === REVIEW_STATUS_MAP.accepted || status === REVIEW_STATUS_MAP.materials_sent);
      updates = {
        reminderSentAt: timestamp,
        reminderCount: count + 1,
        ...(shouldBump ? { reviewStatus: 'under_review' } : {}),
      };
    } else {
      // Manual courtesy bookkeeping is delivery-only, including after closeout;
      // it is not the cron's pre-send claim and does not require a receipt.
      updates = { thankYouSentAt: timestamp };
    }

    try {
      await suggestionAdapter.updateLifecycle(suggestionId, updates, {
        actingUserSystemId,
        ifMatch: fresh._etag,
      });
      return;
    } catch (err) {
      // Only a known rejected conditional write is safe to retry. Ambiguous
      // transport/server errors keep the existing sent-with-warning outcome.
      if (err?.status !== 412 || attempt === 2) throw err;
    }
  }
}
