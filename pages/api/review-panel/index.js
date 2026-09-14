import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import { getReviewPanelPage, getReviewPanelForRequest, reviewPanelAction } from '../../../lib/services/review-panel-service';

export const maxDuration = 300;
export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const access = await requireAppAccess(req, res, 'review-panel');
  if (!access) return;
  res.setHeader('Cache-Control', 'private, no-store');
  // GET resolves configuration.reservationPerEntry via snapshotConfiguration
  // (model resolution); POST launch resolves the seat/chair models too.
  // check:model-override-warming requires this ROUTE FILE to carry the
  // awaited warm before either path reaches getModelForApp, even though
  // review-panel-generation.js's snapshotConfiguration also calls it.
  await loadModelOverrides();
  return withDalContext('review-panel', async () => {
    try {
      if (req.method === 'POST') return res.json(await reviewPanelAction(access.profileId, req.body || {}));
      // Per-request read for the Workbench tab; the service GUID-validates
      // requestId before it reaches any selector.
      if (typeof req.query.requestId === 'string' && req.query.requestId) {
        return res.json(await getReviewPanelForRequest(access.profileId, req.query.requestId));
      }
      return res.json(await getReviewPanelPage(access.profileId));
    } catch (error) {
      if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
      console.error('[review-panel]', error.message);
      return res.status(503).json({ error: error.code === '42P01'
        ? 'The review panel database is awaiting activation.'
        : 'The review panel service is unavailable. Please retry.' });
    }
  });
}
