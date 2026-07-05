/**
 * POST /api/review-manager/send-review-reminder
 *
 * Staff "Send reminder now" action (workbench Reviews tab, Phase 1 —
 * docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md). Sends ONE review-due reminder
 * to a single accepted-but-not-submitted reviewer, on demand.
 *
 * Body: { requestId: string, suggestionId: string } — both Dataverse GUIDs,
 * validated BEFORE either reaches a Dataverse selector (trust-boundary rule;
 * `requestId` is re-checked against the suggestion's own `_wmkf_request_value`
 * server-side, not trusted from the body alone).
 *
 * Delegates all claim/eligibility/send logic to
 * `lib/services/reviewer-manual-reminder.js`, which reuses the review-due
 * cron's claim-before-send machinery (`reviewer-reminder-sweep.js`) so manual
 * and cron sends share the same fire-once marker
 * (`wmkf_remindersentat`/`wmkf_remindercount`) and can never double-send.
 * Unlike the cron, a manual re-send when the marker is already set IS allowed
 * — see that module's header for the full semantics.
 *
 * Data boundary: staff-shared, matching every other `/api/review-manager/*`
 * route — any `review-manager` user can nudge any suggestion's reviewer.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { sendManualReviewDueReminder } from '../../../lib/services/reviewer-manual-reminder';

const REASON_STATUS = {
  misconfigured: 502,
  not_found: 404,
  ineligible: 409,
  conflict: 409,
  send_failed: 502,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  try {
    const { requestId, suggestionId } = req.body || {};

    if (!requestId || typeof requestId !== 'string' || !isGuid(requestId)) {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['requestId must be a valid GUID.'] });
    }
    if (!suggestionId || typeof suggestionId !== 'string' || !isGuid(suggestionId)) {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId must be a valid GUID.'] });
    }

    const result = await withDalContext('review-manager-send-review-reminder', () =>
      sendManualReviewDueReminder({ requestId, suggestionId, actingUserSystemId }),
    );

    if (!result.ok) {
      const status = REASON_STATUS[result.reason] || 500;
      return res.status(status).json({ ok: false, reason: result.reason, errors: result.errors });
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[review-manager send-review-reminder] error:', error);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
