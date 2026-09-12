import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { getCycleDossierPage, cycleDossierAction } from '../../../lib/services/cycle-dossier-service';
export const maxDuration = 300;
export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };
export default async function handler(req, res) {
  if (!['GET','POST'].includes(req.method)) { res.setHeader('Allow','GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const access = await requireAppAccess(req, res, 'cycle-dossier');
  if (!access) return;
  res.setHeader('Cache-Control', 'private, no-store');
  return withDalContext('cycle-dossier', async () => {
    try {
      return res.json(req.method === 'GET' ? await getCycleDossierPage(access.profileId)
        : await cycleDossierAction(access.profileId, req.body || {}));
    } catch (error) {
      if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
      console.error('[cycle-dossier]', error.message);
      return res.status(503).json({ error: error.code === '42P01'
        ? 'The dossier pilot database is awaiting activation.'
        : 'The dossier service is unavailable. Please retry.' });
    }
  });
}
