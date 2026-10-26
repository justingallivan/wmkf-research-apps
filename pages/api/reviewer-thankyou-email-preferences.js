/** Staff self-service exact-owner automatic thank-you wording; no send/claim authority. */
import { requireAuth } from '../../lib/utils/auth';
import { actorRefFromSession } from '../../lib/utils/actor-ref';
import { isGuid } from '../../lib/utils/guid';
import { withDalContext } from '../../lib/dataverse/core/context';
import { resolveProfileToSystemUser } from '../../lib/services/dataverse-identity-map';
import { getReviewerThankYouPreferences, saveReviewerThankYouPreference, clearReviewerThankYouPreference } from '../../lib/services/reviewer-thankyou-personalization';
export const config = { api: { bodyParser: { sizeLimit: '256kb' } } };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) { res.setHeader('Allow', 'GET, PUT, DELETE'); return res.status(405).json({ ok: false, reason: 'method_not_allowed' }); }
  const session = await requireAuth(req, res);
  if (!session) return;
  if (session.authBypassed || session.user?.userType === 'applicant') return res.status(403).json({ ok: false, reason: 'staff_required' });
  const owner = actorRefFromSession(session);
  const rawProfile = session.user?.profileId;
  const profile = ['number', 'string'].includes(typeof rawProfile) ? Number(rawProfile) : NaN;
  if (!isGuid(owner) || !Number.isInteger(profile) || profile < 1) return res.status(503).json({ ok: false, reason: 'identity_unavailable' });
  const body = req.body;
  const keys = body && typeof body === 'object' ? Object.keys(body) : [];
  if (Object.keys(req.query || {}).length || (req.method === 'GET'
    ? body != null && body !== '' && (typeof body !== 'object' || Array.isArray(body) || keys.length > 0)
    : !body || typeof body !== 'object' || Array.isArray(body) || (req.method === 'PUT' ? keys.length !== 1 || keys[0] !== 'template' : keys.length !== 0))) {
    return res.status(400).json({ ok: false, reason: 'validation' });
  }
  return withDalContext('reviewer-thankyou-preferences', async () => {
    let mapped;
    try { mapped = await resolveProfileToSystemUser(profile); }
    catch { return res.status(503).json({ ok: false, reason: 'identity_unavailable' }); }
    if (!isGuid(mapped?.systemuserid) || mapped.systemuserid.toLowerCase() !== owner.toLowerCase()) return res.status(403).json({ ok: false, reason: 'identity_mismatch' });
    const identity = { ownerSystemId: owner.toLowerCase(), authenticatedProfileId: profile };
    const mutation = req.method !== 'GET';
    if (mutation) {
      let result;
      try { result = req.method === 'PUT' ? await saveReviewerThankYouPreference(owner, body.template) : await clearReviewerThankYouPreference(owner); }
      catch { return res.status(503).json({ ok: false, reason: 'persistence_unconfirmed' }); }
      if (!result?.ok) return res.status(result?.reason === 'validation' ? 400 : result?.reason === 'duplicates' ? 409 : 503).json(result || { ok: false, reason: 'persistence_unconfirmed' });
    }
    try {
      const data = await getReviewerThankYouPreferences(owner);
      if (mutation && ['unavailable', 'identity_unavailable'].includes(data.ownStatus)) return res.status(200).json({ ok: true, ...identity, refreshUnavailable: true });
      return res.status(200).json({ ok: true, ...data, ...identity });
    }
    catch { return res.status(mutation ? 200 : 503).json(mutation ? { ok: true, ...identity, refreshUnavailable: true } : { ok: false, reason: 'preference_unavailable' }); }
  });
}
