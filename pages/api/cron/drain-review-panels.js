import { withDalContext } from '../../../lib/dataverse/core/context';
import { drainReviewPanels } from '../../../lib/services/review-panel-worker';
import { verifyReviewPanelCronSecret } from '../../../lib/services/review-panel-rollout';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';

export const maxDuration = 300;
export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyReviewPanelCronSecret(req, res)) return;
  if (process.env.REVIEW_PANEL_ENABLED !== 'true') return res.json({ enabled: false });
  // Warmed here (not inside the worker) so the model-override-warming gate
  // sees the awaited call in this route file: drainReviewPanels transitively
  // reaches getModelForApp via review-panel-generation.js's snapshotConfiguration
  // path whenever a run's pinned config needs re-resolving.
  await loadModelOverrides();
  return withDalContext('cron-drain-review-panels', async () => {
    try { return res.json(await drainReviewPanels()); }
    catch (error) { console.error('[review-panel-worker]', error.message); return res.status(503).json({ error: 'Review panel processing could not complete.' }); }
  });
}
