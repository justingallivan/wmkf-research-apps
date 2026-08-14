/**
 * POST /api/review-manager/send-review-reminder
 *
 * Staff reminder action. For an invited, unanswered reviewer (`kind:
 * 'respond'`), `action:'preview'` renders editable plain-text copy without a
 * token/write/send and `action:'send'` accepts that complete reviewed copy.
 * The accepted-but-not-submitted `reviewdue` path remains send-only.
 *
 * Body: { requestId: string, suggestionId: string,
 *         kind?: 'respond'|'reviewdue', action?: 'preview'|'send',
 *         reviewed?: { subject, bodyText, to, from, senderId } }
 * — both ids are Dataverse GUIDs,
 * validated BEFORE either reaches a Dataverse selector (trust-boundary rule;
 * `requestId` is re-checked against the suggestion's own `_wmkf_request_value`
 * server-side, not trusted from the body alone).
 *
 * Delegates all claim/eligibility/send logic to
 * `lib/services/reviewer-manual-reminder.js`, which reuses the review-due
 * cron's send/token/template machinery (`reviewer-reminder-sweep.js`). The
 * manual service freshly authorizes the row, then persists its marker + token
 * in one ETag-bound PATCH before sending. Unlike the cron, a manual re-send
 * when the relevant marker is already set IS allowed — see that module's
 * header for the full semantics.
 *
 * Data boundary: staff-shared, matching every other `/api/review-manager/*`
 * route — any `review-manager` user can nudge any suggestion's reviewer.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import {
  previewManualRespondReminder,
  sendManualRespondReminder,
  sendManualReviewDueReminder,
} from '../../../lib/services/reviewer-manual-reminder';

const REASON_STATUS = {
  misconfigured: 502,
  not_found: 404,
  read_failed: 502,
  removed: 409,
  revoked: 409,
  ineligible: 409,
  conflict: 409,
  prepare_failed: 502,
  send_failed: 502,
  invalid_preview: 400,
  recipient_changed: 409,
  sender_changed: 409,
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
    if (action === 'preview' && kind !== 'respond') {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['preview is supported only for respond reminders.'] });
    }
    if (action === 'send' && kind === 'respond') {
      const reviewed = req.body?.reviewed;
      if (
        !reviewed || typeof reviewed !== 'object'
        || typeof reviewed.subject !== 'string' || !reviewed.subject.trim()
        || typeof reviewed.bodyText !== 'string' || !reviewed.bodyText.trim()
        || typeof reviewed.to !== 'string' || !reviewed.to.trim()
        || typeof reviewed.from !== 'string' || !reviewed.from.trim()
        || typeof reviewed.senderId !== 'string' || !isGuid(reviewed.senderId)
      ) {
        return res.status(400).json({ ok: false, reason: 'invalid_preview' });
      }
    }

    const reminderAction = action === 'preview'
      ? previewManualRespondReminder
      : kind === 'respond'
        ? sendManualRespondReminder
        : sendManualReviewDueReminder;
    const reviewed = action === 'send' && kind === 'respond' ? req.body?.reviewed : undefined;
    const result = await withDalContext('review-manager-send-review-reminder', () =>
      reminderAction({ requestId, suggestionId, actingUserSystemId, ...(reviewed === undefined ? {} : { reviewed }) }),
    );

    if (!result.ok) {
      const status = REASON_STATUS[result.reason] || 500;
      return res.status(status).json({ ok: false, reason: result.reason, errors: result.errors });
    }
    return res.status(200).json(result.draft ? { ok: true, draft: result.draft } : { ok: true });
  } catch (error) {
    console.error('[review-manager send-review-reminder] error:', error);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
