/** Run one Zoom video copy tick per invocation (Stage 3b): copy, register or repair at most one recording. */
import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import MaintenanceService from '../../../lib/services/maintenance-service';
import { runZoomVideoCopyTick, TICK_WORK_MS } from '../../../lib/services/meeting-tracker-recordings/video-copy-worker.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  if (!verifyCronSecret(req, res)) return;
  // The work deadline is handler entry + 270 s, 30 s under the 300 s function limit.
  const deadlineMs = Date.now() + TICK_WORK_MS;
  const runId = await MaintenanceService.startRun('drain-zoom-video-copies');
  try {
    const result = await withDalContext('cron-drain-zoom-video-copies', () => runZoomVideoCopyTick({ deadlineMs }));
    // Counts and codes only: no copy, request, host, file or meeting identifier leaves the worker's own logs.
    const summary = { outcome: result.outcome, code: result.code || null, worked: result.copyId ? 1 : 0 };
    await MaintenanceService.completeRun(runId, { status: 'completed', recordsProcessed: summary.worked, details: summary });
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    console.error('[cron:drain-zoom-video-copies] failed:', error?.message || error);
    await MaintenanceService.completeRun(runId, { status: 'failed', errorMessage: 'Zoom video copy tick failed.' });
    return res.status(500).json({ ok: false, error: 'Zoom video copy tick failed.' });
  }
}
