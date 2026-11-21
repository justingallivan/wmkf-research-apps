/** Superuser-only private external-service register and dated reviews. */
import { requireSuperuser } from '../../../lib/utils/auth';
import { listServices, listReviews, saveService } from '../../../lib/services/external-services/store';
import { readCheck } from '../../../lib/services/external-services/check-store';
import { checkForUpdates } from '../../../lib/services/external-services/checks';
import { invalid } from '../../../lib/services/external-services/model';
export const maxDuration = 60;
export const config = { api: { bodyParser: { sizeLimit: '512kb' } } };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const gate = await requireSuperuser(req, res);
  if (!gate) return;
  try {
    if (req.method === 'GET') {
      if (req.query.id != null) return res.json({ reviews: await listReviews(req.query.id), check: await readCheck(req.query.id) });
      return res.json({ services: await listServices() });
    }
    if (req.method === 'PUT') return res.json(await saveService(req.body || {}, gate.profileId));
    if (req.method === 'POST') {
      if (!req.body || Array.isArray(req.body) || Object.keys(req.body).sort().join(',') !== 'action,id' || req.body.action !== 'check') throw invalid('Expected a service and check action.');
      return res.json({ check: await checkForUpdates(req.body.id, gate.profileId) });
    }
    res.setHeader('Allow', 'GET, PUT, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if ([400, 404, 409].includes(error.status)) return res.status(error.status).json({ error: error.message });
    console.error('[external-services] request failed', error.code || 'unknown');
    return res.status(503).json({ error: 'Service records are unavailable. Please retry; if this continues, ask the administrator to check the service register setup.' });
  }
}
