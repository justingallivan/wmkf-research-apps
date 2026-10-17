/** Production-only durable release/archive worker and Pacific morning notices. */
import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { runBoardWorkflow } from '../../../lib/services/board-writeups/worker';
export const config = { maxDuration: 300 };
export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronSecret(req, res)) return;
  try { return res.json(await withDalContext('cron-board-writeups', () => runBoardWorkflow())); }
  catch (e) { return res.status(500).json({ error: 'Board workflow failed.', code: e.code || 'board_worker_failed' }); }
}
