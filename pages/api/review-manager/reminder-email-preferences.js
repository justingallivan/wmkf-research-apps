/** Own-profile copy for reviewer respond-by and review-due reminders. */
import { requireAppAccess } from '../../../lib/utils/auth';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { withDalContext } from '../../../lib/dataverse/core/context';
import {
  REMINDER_KINDS,
  sharedReminderTemplate,
  loadSenderReminderTemplate,
  saveOwnReminderTemplate,
  clearOwnReminderTemplate,
} from '../../../lib/services/reviewer-reminder-personalization';

function writeStatus(result) {
  if (result.ok) return 200;
  if (result.reason === 'validation') return 400;
  if (result.reason === 'identity_unavailable') return 503;
  return 500;
}

export default async function handler(req, res) {
  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PUT, DELETE');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }
  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;
  const kind = req.method === 'GET' ? req.query?.kind : req.body?.kind;
  if (!REMINDER_KINDS.includes(kind)) return res.status(400).json({ ok: false, reason: 'invalid_kind' });
  if (req.method !== 'GET' && Object.keys(req.body || {}).some((key) => !['kind', 'template'].includes(key))) {
    return res.status(400).json({ ok: false, reason: 'validation' });
  }
  if (req.method === 'DELETE' && Object.hasOwn(req.body || {}, 'template')) {
    return res.status(400).json({ ok: false, reason: 'validation' });
  }
  const ownSystemId = actorRefFromSession(access.session);
  if (!ownSystemId || !access.profileId) return res.status(503).json({ ok: false, reason: 'identity_unavailable' });
  try {
    return await withDalContext('review-manager-reminder-email-preferences', async () => {
      if (req.method === 'GET') {
        const shared = await sharedReminderTemplate(kind);
        if (!shared.ok) return res.status(503).json({ ok: false, reason: shared.reason });
        const own = await loadSenderReminderTemplate(ownSystemId, kind, shared.template);
        if (!own.ok) {
          if (own.reason === 'preference_invalid') {
            return res.status(409).json({ ok: false, reason: own.reason, ownSystemId, shared: shared.template, configured: true });
          }
          return res.status(503).json({ ok: false, reason: own.reason });
        }
        return res.status(200).json({ ok: true, kind, ownSystemId, shared: shared.template, configured: own.configured, template: own.template });
      }
      if (req.method === 'DELETE') {
        const cleared = await clearOwnReminderTemplate(ownSystemId, kind);
        return res.status(writeStatus(cleared)).json({ ...cleared, kind });
      }
      const saved = await saveOwnReminderTemplate(ownSystemId, kind, req.body?.template);
      return res.status(writeStatus(saved)).json(saved);
    });
  } catch (error) {
    console.error('[review-manager reminder-email-preferences] error:', error);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
