/** Own-profile copy for the reviewer deadline emails. */
import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { withDalContext } from '../../../lib/dataverse/core/context';
import {
  sharedDeadlineTemplate,
  loadOwnerDeadlineTemplate,
  saveOwnDeadlineTemplate,
  clearOwnDeadlineTemplate,
} from '../../../lib/services/reviewer-deadline-personalization';

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
  if (req.method !== 'GET' && Object.keys(req.body || {}).some((key) => key !== 'template')) {
    return res.status(400).json({ ok: false, reason: 'validation' });
  }
  if (req.method === 'DELETE' && Object.hasOwn(req.body || {}, 'template')) {
    return res.status(400).json({ ok: false, reason: 'validation' });
  }
  const ownSystemId = actorRefFromSession(access.session);
  if (!isGuid(ownSystemId) || !access.profileId) return res.status(503).json({ ok: false, reason: 'identity_unavailable' });
  try {
    return await withDalContext('review-manager-deadline-email-preferences', async () => {
      if (req.method === 'GET') {
        const shared = await sharedDeadlineTemplate();
        if (!shared.ok) return res.status(503).json({ ok: false, reason: shared.reason });
        const own = await loadOwnerDeadlineTemplate(ownSystemId);
        if (!own.ok) {
          if (own.reason === 'preference_invalid') {
            return res.status(409).json({ ok: false, reason: own.reason, ownSystemId, shared: shared.template, configured: true });
          }
          return res.status(503).json({ ok: false, reason: own.reason });
        }
        return res.status(200).json({
          ok: true,
          ownSystemId,
          shared: shared.template,
          configured: own.configured,
          template: own.configured ? own.template : shared.template,
        });
      }
      if (req.method === 'DELETE') {
        const cleared = await clearOwnDeadlineTemplate(ownSystemId);
        return res.status(writeStatus(cleared)).json(cleared);
      }
      const saved = await saveOwnDeadlineTemplate(ownSystemId, req.body?.template);
      return res.status(writeStatus(saved)).json(saved);
    });
  } catch (error) {
    console.error('[review-manager deadline-email-preferences] error:', error);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '128kb' } } };
