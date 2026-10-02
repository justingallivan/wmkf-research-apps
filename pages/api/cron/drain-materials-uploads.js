/** Drain at most one applicant materials job per invocation. */
import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import MaintenanceService from '../../../lib/services/maintenance-service';
import { drainOneMaterialsUpload } from '../../../lib/services/site-visit-materials/background-job-drain.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  if (!verifyCronSecret(req, res)) return;
  const runId = await MaintenanceService.startRun('drain-materials-uploads');
  try {
    const result = await withDalContext('cron-drain-materials-uploads', () => drainOneMaterialsUpload());
    await MaintenanceService.completeRun(runId, {
      status: result.status === 'failed' ? 'failed' : 'completed',
      recordsProcessed: result.jobId ? 1 : 0,
      details: result,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[cron:drain-materials-uploads] failed:', error?.message || error);
    await MaintenanceService.completeRun(runId, {
      status: 'failed',
      errorMessage: 'Applicant materials background drain failed.',
    });
    return res.status(500).json({ ok: false, error: 'Applicant materials background drain failed.' });
  }
}
