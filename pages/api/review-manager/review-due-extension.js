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
  previewReviewerDueDateNotification,
  retryReviewerDueDateNotification,
  saveReviewerDueDateExtension,
} from '../../../lib/services/reviewer-due-extension';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { authorizeReviewerRequestMutation } from '../../../lib/services/reviewer-request-authorization';

const REASON_STATUS = {
  assigned_pd_required: 403,
  sender_changed: 409,
  preview_stale: 409,
  invalid_preview: 400,
  invalid_cc: 400,
  cc_not_allowed_for_test_request: 409,
  recipient_policy_refused: 409,
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
  send_unconfirmed: 202,
  request_mismatch: 409,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;
  const actingUserSystemId = actorRefFromSession(access.session);

  if (!isGuid(actingUserSystemId)) return res.status(403).json({ ok: false, reason: 'assigned_pd_required' });
  const { action, operation, suggestionId, reviewDueDateOverride, template, cc, proof } = req.body || {};
  const allowed = ['action', 'suggestionId', 'template', 'cc', 'proof', 'reviewDueDateOverride', 'operation'];
  const finalOperations = ['save', 'restore', 'retry', 'resend'];
  const target = action === 'preview' ? operation : action;
  if (!isGuid(suggestionId) || !finalOperations.includes(target)
    || (action !== 'preview' && action !== target)
    || Object.keys(req.body || {}).some((key) => !allowed.includes(key))
    || (action !== 'preview' && operation !== undefined)
    || (action === 'preview' && proof !== undefined)
    || (target === 'save' ? typeof reviewDueDateOverride !== 'string' : reviewDueDateOverride !== undefined)
    || (action !== 'preview' && (typeof proof !== 'string' || !template))
    || (proof !== undefined && proof.length > 8192)) {
    return res.status(400).json({ ok: false, reason: 'invalid_preview' });
  }

  try {
    const result = await withDalContext('review-manager-review-due-extension', async () => {
      const authorization = await authorizeReviewerRequestMutation({
        profileId: access.profileId,
        callerSystemId: actingUserSystemId,
        suggestionIds: [suggestionId],
      });
      const expectedRequestId = authorization.requestIds[0];
      const pdId = authorization.programDirectorByRequestId[expectedRequestId];
      if (!isGuid(pdId) || pdId.toLowerCase() !== actingUserSystemId.toLowerCase()) {
        return { ok: false, reason: 'assigned_pd_required' };
      }
      const input = { suggestionId, expectedRequestId, reviewDueDateOverride,
        actingUserSystemId, operation: target, template, cc, proof };
      if (action === 'preview') return previewReviewerDueDateNotification(input);
      if (target === 'retry' || target === 'resend') return retryReviewerDueDateNotification(input);
      return saveReviewerDueDateExtension(input);
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
  api: { bodyParser: { sizeLimit: '128kb' } },
};
