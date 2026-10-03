import { verifyTranscriptionCronSecret } from '../../../lib/utils/cron-auth';
import { runTranscriptionPreflight } from '../../../lib/services/transcription-pilot/preflight';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!verifyTranscriptionCronSecret(req, res)) return;
  const hasPreflightParameter = req.query && Object.prototype.hasOwnProperty.call(req.query, 'preflight');
  const hasWorkflowProbeParameter = req.query && Object.prototype.hasOwnProperty.call(req.query, 'workflow_probe');
  const hasRecoveryParameter = req.query && Object.prototype.hasOwnProperty.call(req.query, 'recovery');
  const queryKeys = Object.keys(req.query || {});
  if (queryKeys.some((key) => !['preflight', 'workflow_probe', 'recovery'].includes(key))) {
    return res.status(400).json({ error: 'Unsupported cron mode' });
  }
  const requestedModes = [hasPreflightParameter, hasWorkflowProbeParameter, hasRecoveryParameter].filter(Boolean).length;
  if (requestedModes > 1) return res.status(400).json({ error: 'Cron modes are mutually exclusive' });
  if (hasWorkflowProbeParameter) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
    if (req.query.workflow_probe !== '1' || hasPreflightParameter
        || Object.keys(req.query).some((key) => key !== 'workflow_probe')) {
      return res.status(400).json({ error: 'Invalid workflow probe request' });
    }
    const readiness = await runTranscriptionPreflight();
    if (!readiness.ok) return res.status(503).json({ ok: false, checks: readiness.checks });
    const { startSyntheticWorkflowProbe } = await import('../../../lib/services/transcription-pilot/workflow-probe');
    const result = await startSyntheticWorkflowProbe({ timeoutMs: 90_000 });
    if (result.reason === 'probe_in_progress') return res.status(409).json({ error: 'Synthetic workflow probe is already unresolved' });
    if (!result.started) return res.status(503).json({ error: 'Synthetic workflow probe could not be confirmed', code: 'workflow_probe_start_unconfirmed' });
    if (result.timedOut) {
      return res.status(202).json({ ok: false, runId: result.runId, status: 'pending', proof: null });
    }
    if (!result.completed) {
      return res.status(502).json({ ok: false, runId: result.runId, status: 'failed', proof: null });
    }
    return res.status(200).json({ ok: true, runId: result.runId, status: 'completed', proof: result.proof });
  }
  if (hasRecoveryParameter) {
    if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
    if (req.query.recovery !== '1') return res.status(400).json({ error: 'Invalid recovery request' });
    try {
      const { drainTranscriptionWorkflowDispatches } = await import('../../../lib/services/transcription-pilot/workflow-dispatch');
      const result = await drainTranscriptionWorkflowDispatches({ maxRuns: 20, deadline: Date.now() + 270_000 });
      return res.status(200).json({ ok: true, recovery: result });
    } catch {
      return res.status(500).json({ error: 'Workflow recovery failed', code: 'transcription_workflow_recovery_failed' });
    }
  }
  if (hasPreflightParameter && req.query.preflight !== '1') {
    return res.status(400).json({ error: 'Invalid preflight request' });
  }
  const preflightRequested = req.query?.preflight === '1';
  if (preflightRequested) {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
    const result = await runTranscriptionPreflight();
    return res.status(result.ok ? 200 : 503).json(result);
  }
  try {
    const deadline = Date.now() + 270_000;
    const [worker, store, dispatch] = await Promise.all([
      import('../../../lib/services/transcription-pilot/worker'),
      import('../../../lib/services/transcription-pilot/store'),
      import('../../../lib/services/transcription-pilot/workflow-dispatch'),
    ]);
    const recoveredPreIntent = await store.requeueExpiredPreIntentTranscriptionSubmissions({ limit: 100 });
    const markedUncertain = await store.markExpiredTranscriptionSubmissionsUncertain({ limit: 100 });
    const cleanup = await worker.drainTranscriptionCleanup({ maxJobs: 100 });
    const workflowDispatch = await dispatch.drainTranscriptionWorkflowDispatches({ maxRuns: 20, deadline });
    const summary = {
      recoveredPreIntent: recoveredPreIntent.length,
      markedUncertain: markedUncertain.length,
      cleanup,
      workflowDispatch,
      incomplete: cleanup.incomplete || workflowDispatch.incomplete
        || recoveredPreIntent.length === 100 || markedUncertain.length === 100,
    };
    return res.status(200).json({ ok: true, summary });
  } catch (error) {
    console.error('[transcription-pilot/cron] worker failed:', error?.code || error?.name || 'unknown');
    return res.status(500).json({ error: 'Transcription worker failed', code: 'transcription_worker_failed' });
  }
}
