/** Exact-session sender's reusable distribution introduction. No distribution writes. */
import { requireAppAccess } from '../../../../../lib/utils/auth';
import { actorRefFromSession } from '../../../../../lib/utils/actor-ref';
import { isGuid } from '../../../../../lib/utils/guid';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { getDistributionPreferences, saveDistributionPreference, clearDistributionPreference } from '../../../../../lib/services/pre-site-visit/distribution-personalization';
export const config = { api: { bodyParser: { sizeLimit: '256kb' } } };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) { res.setHeader('Allow', 'GET, PUT, DELETE'); return res.status(405).json({ ok: false, reason: 'method_not_allowed' }); }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  const owner = actorRefFromSession(access.session);
  if (!isGuid(owner)) return res.status(503).json({ ok: false, reason: 'identity_unavailable' });
  const keys = Object.keys(req.body || {});
  if (Object.keys(req.query || {}).length || (req.method === 'GET' ? keys.length > 0 : !req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || (req.method === 'PUT' ? keys.length !== 1 || keys[0] !== 'template' : keys.length !== 0))) return res.status(400).json({ ok: false, reason: 'validation' });
  return withDalContext('distribution-email-preferences', async () => {
    try {
      if (req.method !== 'GET') {
        const result = req.method === 'PUT' ? await saveDistributionPreference(owner, req.body.template) : await clearDistributionPreference(owner);
        if (!result.ok) return res.status(result.reason === 'validation' ? 400 : result.reason === 'duplicates' ? 409 : 503).json(result);
      }
      // Mutation confirmation is independent from this presentation refresh.
      const data = await getDistributionPreferences(owner);
      return res.status(200).json({ ok: true, ...data });
    } catch { return res.status(req.method === 'GET' ? 503 : 200).json(req.method === 'GET' ? { ok: false, reason: 'preference_unavailable' } : { ok: true, refreshUnavailable: true }); }
  });
}
