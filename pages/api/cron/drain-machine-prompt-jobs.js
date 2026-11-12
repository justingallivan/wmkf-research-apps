/** Unscheduled, strictly authenticated, server-selected machine pilot stage. */
import { constantTimeEqual, verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { runMachineJobTick } from '../../../lib/services/prompt-jobs/machine-worker';
export const config = { maxDuration: 300 };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!process.env.CRON_SECRET || !constantTimeEqual(req.headers.authorization, `Bearer ${process.env.CRON_SECRET}`)) return res.status(401).json({ error: 'Unauthorized' });
  if (!verifyCronSecret(req, res)) return;
  try { return res.status(200).json(await withDalContext('cron-machine-prompt-jobs', () => runMachineJobTick())); }
  catch { return res.status(503).json({ error: 'prompt_job_worker_unavailable' }); }
}
