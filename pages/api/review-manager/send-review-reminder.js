/**
 * POST /api/review-manager/send-review-reminder
 *
 * Lead-PD or superuser reminder action. Both kinds require an editable preview
 * before send; preview has the same request authorization because it reveals
 * the assigned PD's personal template and reviewer contact details.
 *
 * Body: { requestId: string, suggestionId: string,
 *         kind?: 'respond'|'reviewdue', action?: 'preview'|'send',
 *         template?: { subject, body }, proof?: string }
 * — both ids are Dataverse GUIDs,
 * validated BEFORE either reaches a Dataverse selector (trust-boundary rule;
 * `requestId` is re-checked against the suggestion's own `_wmkf_request_value`
 * server-side, not trusted from the body alone).
 *
 * Delegates all claim/eligibility/send logic to
 * `lib/services/reviewer-manual-reminder.js`, which reuses the review-due
 * cron's send/token/template machinery (`reviewer-reminder-sweep.js`). The
 * manual service freshly authorizes the row, then persists the relevant marker
 * (and a token only for respond-by nudges) in an ETag-bound PATCH before sending.
 * Unlike the cron, a manual re-send
 * when the relevant marker is already set IS allowed — see that module's
 * header for the full semantics.
 *
 * Data boundary: preview remains read-only and, like send, requires the lead
 * PD or a superuser because it may show the assigned PD's personal copy.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import {
  previewManualReminder,
  sendManualReminderWithProof,
} from '../../../lib/services/reviewer-manual-reminder';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { authorizeReviewerRequestMutation } from '../../../lib/services/reviewer-request-authorization';

const REASON_STATUS = {
  misconfigured: 502,
  not_found: 404,
  read_failed: 502,
  removed: 409,
  revoked: 409,
  token_revoked: 409,
  token_not_minted: 409,
  token_invalid_data: 409,
  token_expired: 409,
  token_insufficient_window: 409,
  due_date_missing: 409,
  ineligible: 409,
  conflict: 409,
  prepare_failed: 502,
  send_failed: 502,
  send_unconfirmed: 202,
  invalid_preview: 400,
  recipient_changed: 409,
  sender_changed: 409,
  preview_stale: 409,
  preference_unavailable: 503,
  preference_invalid: 503,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const actingUserSystemId = actorRefFromSession(access.session);

  try {
    const { requestId, suggestionId } = req.body || {};
    const kind = req.body?.kind === undefined ? 'reviewdue' : req.body.kind;
    const action = req.body?.action === undefined ? 'send' : req.body.action;

    if (!requestId || typeof requestId !== 'string' || !isGuid(requestId)) {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['requestId must be a valid GUID.'] });
    }
    if (!suggestionId || typeof suggestionId !== 'string' || !isGuid(suggestionId)) {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId must be a valid GUID.'] });
    }
    if (kind !== 'respond' && kind !== 'reviewdue') {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['kind must be respond or reviewdue.'] });
    }
    if (action !== 'preview' && action !== 'send') {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['action must be preview or send.'] });
    }
    if (action === 'send' && (typeof req.body?.proof !== 'string' || !req.body.proof)) {
      return res.status(400).json({ ok: false, reason: 'invalid_preview' });
    }
    if (Object.keys(req.body || {}).some((key) => !['requestId', 'suggestionId', 'kind', 'action', 'template', 'proof'].includes(key))) {
      return res.status(400).json({ ok: false, reason: 'validation' });
    }
    const reminderAction = action === 'preview' ? previewManualReminder : sendManualReminderWithProof;
    const result = await withDalContext('review-manager-send-review-reminder', async () => {
      await authorizeReviewerRequestMutation({
        profileId: access.profileId,
        callerSystemId: actingUserSystemId,
        requestIds: [requestId],
        suggestionIds: [suggestionId],
      });
      return reminderAction({ kind, requestId, suggestionId, actingUserSystemId, template: req.body?.template, proof: req.body?.proof });
    });

    if (!result.ok) {
      const status = REASON_STATUS[result.reason] || 500;
      return res.status(status).json({
        ok: false, reason: result.reason, errors: result.errors,
        ...(action === 'preview' && result.shared ? { shared: result.shared } : {}),
      });
    }
    return res.status(200).json(result.draft ? { ok: true, draft: result.draft } : { ok: true });
  } catch (error) {
    if (error instanceof ServiceHttpError) {
      return res.status(error.httpStatus).json(error.body ?? { ok: false, reason: error.message });
    }
    console.error('[review-manager send-review-reminder] error:', error);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
