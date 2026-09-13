import { withDalContext } from '../../../lib/dataverse/core/context';
import { drainReviewPanels } from '../../../lib/services/review-panel-worker';
import { verifyReviewPanelCronSecret } from '../../../lib/services/review-panel-rollout';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';

export const maxDuration = 300;
export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyReviewPanelCronSecret(req, res)) return;
  if (process.env.REVIEW_PANEL_ENABLED !== 'true') return res.json({ enabled: false });
  // A run's config is pinned once at launch (snapshotConfiguration's
  // getModelForApp resolution happens there, not here) — drainReviewPanels
  // itself only reads that already-pinned run.data.config, never re-resolves
  // a model. This call exists because check:model-override-warming (docs/
  // CI_GATES_REFERENCE.md) statically requires every route touching a
  // model-resolving review-panel module to warm overrides before use, and
  // this cron route is the review-panel feature's contracted warm point for
  // the whole worker path — keep the call even though this route's own
  // runtime call graph never reaches getModelForApp.
  await loadModelOverrides();
  return withDalContext('cron-drain-review-panels', async () => {
    try { return res.json(await drainReviewPanels()); }
    catch (error) { console.error('[review-panel-worker]', error.message); return res.status(503).json({ error: 'Review panel processing could not complete.' }); }
  });
}
