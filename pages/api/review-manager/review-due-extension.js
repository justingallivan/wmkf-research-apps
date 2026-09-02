/**
 * POST /api/review-manager/review-due-extension
 *
 * Accepted-reviewer extension action. `save` preflights the automatic notice,
 * commits the reviewer-specific date, then dispatches the email/calendar;
 * `retry` re-reads the current stored date and sends notification only.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import {
  retryReviewerDueDateNotification,
  saveReviewerDueDateExtension,
} from '../../../lib/services/reviewer-due-extension';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { authorizeReviewerRequestMutation } from '../../../lib/services/reviewer-request-authorization';

const REASON_STATUS = {
  not_found: 404,
  ineligible: 409,
  original_due_date_missing: 409,
  invalid_extension_date: 400,
  no_extension_to_restore: 409,
  no_change: 409,
  conflict: 409,
  save_failed: 502,
  read_failed: 502,
  misconfigured: 502,
  notification_unavailable: 502,
  token_recovery_required: 409,
  send_failed: 502,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;
  const actingUserSystemId = actorRefFromSession(access.session);

  const { action, suggestionId, reviewDueDateOverride } = req.body || {};
  if (!isGuid(suggestionId)) {
    return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId must be a valid GUID.'] });
  }
  if (action !== 'save' && action !== 'retry') {
    return res.status(400).json({ ok: false, reason: 'validation', errors: ['action must be save or retry.'] });
  }
  if (
    action === 'save'
    && reviewDueDateOverride !== null
    && typeof reviewDueDateOverride !== 'string'
  ) {
    return res.status(400).json({ ok: false, reason: 'validation', errors: ['reviewDueDateOverride must be a date string or null.'] });
  }
  if (action === 'save' && !Object.prototype.hasOwnProperty.call(req.body || {}, 'reviewDueDateOverride')) {
    return res.status(400).json({ ok: false, reason: 'validation', errors: ['reviewDueDateOverride is required for save.'] });
  }

  try {
    const result = await withDalContext('review-manager-review-due-extension', async () => {
      await authorizeReviewerRequestMutation({
        profileId: access.profileId,
        callerSystemId: actingUserSystemId,
        suggestionIds: [suggestionId],
      });
      return action === 'retry'
        ? retryReviewerDueDateNotification({ suggestionId })
        : saveReviewerDueDateExtension({ suggestionId, reviewDueDateOverride, actingUserSystemId });
    });
    if (!result.ok) {
      return res.status(REASON_STATUS[result.reason] || 500).json(result);
    }
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof ServiceHttpError) {
      return res.status(error.httpStatus).json(error.body ?? { ok: false, reason: error.message });
    }
    console.error('[review-manager review-due-extension] error:', error);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '8kb' } },
};
