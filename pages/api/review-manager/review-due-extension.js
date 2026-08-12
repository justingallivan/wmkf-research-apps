/**
 * POST /api/review-manager/review-due-extension
 *
 * Accepted-reviewer extension action. `save` commits the reviewer-specific
 * date first and then sends the automatic update email/calendar attachment;
 * `retry` re-reads the current stored date and retries notification only.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import {
  retryReviewerDueDateNotification,
  saveReviewerDueDateExtension,
} from '../../../lib/services/reviewer-due-extension';

const REASON_STATUS = {
  not_found: 404,
  ineligible: 409,
  original_due_date_missing: 409,
  invalid_extension_date: 400,
  no_extension_to_restore: 409,
  no_change: 409,
  save_failed: 409,
  misconfigured: 502,
  notification_unavailable: 502,
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
    const result = await withDalContext('review-manager-review-due-extension', () => (
      action === 'retry'
        ? retryReviewerDueDateNotification({ suggestionId })
        : saveReviewerDueDateExtension({ suggestionId, reviewDueDateOverride, actingUserSystemId })
    ));
    if (!result.ok) {
      return res.status(REASON_STATUS[result.reason] || 500).json(result);
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error('[review-manager review-due-extension] error:', error);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '8kb' } },
};
