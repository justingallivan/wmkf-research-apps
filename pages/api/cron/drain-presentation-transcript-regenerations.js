/** Run one presentation-transcript regeneration tick per invocation (Site Visit slice C1): generate the queued transcripts after a correction publish. */
import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import MaintenanceService from '../../../lib/services/maintenance-service';
import { runPresentationTranscriptRegenerationTick, TICK_WORK_MS } from '../../../lib/services/meeting-tracker-transcription/presentation-transcript-regeneration-worker.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  if (!verifyCronSecret(req, res)) return;
  // The work deadline is handler entry + 270 s, 30 s under the 300 s function limit.
  const deadlineMs = Date.now() + TICK_WORK_MS;
  const runId = await MaintenanceService.startRun('drain-presentation-transcript-regenerations');
  try {
    // Dataverse writes run as the stored publisher (actingUserSystemId on each row); there is no session here.
    const result = await withDalContext('cron-drain-presentation-transcript-regenerations', () => runPresentationTranscriptRegenerationTick({ deadlineMs }));
    // Counts and codes only: no request, artifact or actor identifier leaves the worker's own logs.
    const summary = { outcome: result.outcome, worked: result.worked };
    await MaintenanceService.completeRun(runId, { status: 'completed', recordsProcessed: summary.worked, details: summary });
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    console.error('[cron:drain-presentation-transcript-regenerations] failed:', error?.message || error);
    await MaintenanceService.completeRun(runId, { status: 'failed', errorMessage: 'Presentation transcript regeneration tick failed.' });
    return res.status(500).json({ ok: false, error: 'Presentation transcript regeneration tick failed.' });
  }
}
