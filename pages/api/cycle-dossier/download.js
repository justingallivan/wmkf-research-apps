import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { downloadCycleDossier } from '../../../lib/services/cycle-dossier-service';
export const config = { api: { responseLimit: false } };
export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const access = await requireAppAccess(req, res, 'cycle-dossier');
  if (!access) return;
  res.setHeader('Cache-Control', 'private, no-store');
  return withDalContext('cycle-dossier-download', async () => {
    try {
      const file = await downloadCycleDossier(access.profileId, req.query);
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `${req.query.format === 'pdf' ? 'inline' : 'attachment'}; filename="${file.filename}"`);
      return res.send(file.bytes);
    } catch (error) {
      return res.status(error.httpStatus || 503).json({ error: error.httpStatus ? error.message : 'Unable to retrieve the saved document.' });
    }
  });
}
