/** Machine status is scoped by the authenticated principal and current policy. */
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { requireSummaryPromptAccess, readSummaryJob } from '../../../../lib/services/prompt-jobs/machine-summary-service';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const access = await requireSummaryPromptAccess(req);
    const { job } = await withDalContext('machine-prompt-status', () => readSummaryJob({ jobId: req.query.jobId, access }));
    if (job.pollAfterSeconds != null) res.setHeader('Retry-After', String(job.pollAfterSeconds));
    return res.status(200).json({ job });
  } catch (error) {
    if (error instanceof ServiceHttpError) return res.status(error.httpStatus).json(error.body ?? { error: error.message });
    return res.status(503).json({ error: 'prompt_job_unavailable' });
  }
}
