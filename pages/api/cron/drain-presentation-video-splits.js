/** Run one presentation-video split tick per invocation (Stage 4 slice 3): cleanup sweep, then advance at most one split. */
import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import MaintenanceService from '../../../lib/services/maintenance-service';
import { runPresentationVideoSplitTick, TICK_WORK_MS } from '../../../lib/services/meeting-tracker-recordings/presentation-video-split-worker.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  if (!verifyCronSecret(req, res)) return;
  // The work deadline is handler entry + 270 s, 30 s under the 300 s function limit.
  const deadlineMs = Date.now() + TICK_WORK_MS;
  const runId = await MaintenanceService.startRun('drain-presentation-video-splits');
  try {
    const result = await withDalContext('cron-drain-presentation-video-splits', () => runPresentationVideoSplitTick({ deadlineMs }));
    // Counts and codes only: no split, request, file or Sandbox identifier leaves the worker's own logs.
    const summary = { outcome: result.outcome, code: result.code || null, worked: result.splitId ? 1 : 0 };
    await MaintenanceService.completeRun(runId, { status: 'completed', recordsProcessed: summary.worked, details: summary });
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    console.error('[cron:drain-presentation-video-splits] failed:', error?.message || error);
    await MaintenanceService.completeRun(runId, { status: 'failed', errorMessage: 'Presentation video split tick failed.' });
    return res.status(500).json({ ok: false, error: 'Presentation video split tick failed.' });
  }
}
