import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { downloadReviewPanel } from '../../../lib/services/review-panel-service';
import { contentDisposition } from '../../../lib/utils/content-disposition';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';

export const config = { api: { responseLimit: false } };

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const access = await requireAppAccess(req, res, 'review-panel');
  if (!access) return;
  res.setHeader('Cache-Control', 'private, no-store');
  // downloadReviewPanel's own call graph never resolves a model, but this
  // route imports review-panel-service.js, which imports review-panel-
  // generation.js (getModelForApp) for the launch/status paths in the sibling
  // route — check:model-override-warming's transitive-import detection
  // taints this file too, so the warm is kept here as the contracted point.
  await loadModelOverrides();
  return withDalContext('review-panel-download', async () => {
    try {
      const file = await downloadReviewPanel(access.profileId, req.query);
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.query.format === 'pdf') {
        // PDF is previewed inline in an iframe; SAMEORIGIN blocks it from
        // being framed by any other origin (D4: no SharePoint/external
        // publishing — this is a private, superuser-only document).
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Content-Disposition', contentDisposition('inline', file.filename));
      } else {
        res.setHeader('Content-Disposition', contentDisposition('attachment', file.filename));
      }
      return res.send(file.bytes);
    } catch (error) {
      return res.status(error.httpStatus || 503).json({ error: error.httpStatus ? error.message : 'Unable to retrieve the saved document.' });
    }
  });
}
