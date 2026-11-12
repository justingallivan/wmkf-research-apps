/** Machine admission; the caller is authenticated before trusted DAL context. */
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { requireMachinePromptAccess, admitMachineJob } from '../../../../lib/services/prompt-jobs/machine-service';
export const config = { api: { bodyParser: { sizeLimit: '4kb' } } };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const access = await requireMachinePromptAccess(req);
    const { job } = await withDalContext('machine-prompt-admission', () => admitMachineJob({ body: req.body, idempotencyKey: req.headers['idempotency-key'], access }));
    res.setHeader('Location', `/api/automation/prompt-jobs/${job.jobId}`);
    if (job.pollAfterSeconds != null) res.setHeader('Retry-After', String(job.pollAfterSeconds));
    return res.status(job.pollAfterSeconds != null ? 202 : 200).json({ job });
  } catch (error) {
    if (error instanceof ServiceHttpError) return res.status(error.httpStatus).json(error.body ?? { error: error.message });
    return res.status(503).json({ error: 'prompt_job_unavailable' });
  }
}
