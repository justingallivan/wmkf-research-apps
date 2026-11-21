/** Superuser-only private external-service register and dated reviews. */
import { requireSuperuser } from '../../../lib/utils/auth';
import { listServices, listReviews, saveService } from '../../../lib/services/external-services/store';
export const config = { api: { bodyParser: { sizeLimit: '64kb' } } };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const gate = await requireSuperuser(req, res);
  if (!gate) return;
  try {
    if (req.method === 'GET') {
      if (req.query.id != null) return res.json({ reviews: await listReviews(req.query.id) });
      return res.json({ services: await listServices() });
    }
    if (req.method === 'PUT') return res.json(await saveService(req.body || {}, gate.profileId));
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if ([400, 404, 409].includes(error.status)) return res.status(error.status).json({ error: error.message });
    console.error('[external-services] request failed', error.code || 'unknown');
    return res.status(503).json({ error: 'Service records are unavailable. Please retry; if this continues, ask the administrator to check the service register setup.' });
  }
}
