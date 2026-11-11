/** One bounded, server-selected trial stage. Scheduling/activation require a separate rollout. */
import { constantTimeEqual, verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { runStaffJobTick } from '../../../lib/services/prompt-jobs/staff-worker';
export const config = {maxDuration:90};
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if (!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
  // This provider-capable worker never inherits the generic development bypass.
  if (!process.env.CRON_SECRET || !constantTimeEqual(req.headers.authorization,`Bearer ${process.env.CRON_SECRET}`)) return res.status(401).json({error:'Unauthorized'});
  if (!verifyCronSecret(req,res)) return;
  try {return res.status(200).json(await withDalContext('cron-prompt-jobs',()=>runStaffJobTick()));}
  catch {return res.status(503).json({error:'prompt_job_worker_unavailable'});}
}
