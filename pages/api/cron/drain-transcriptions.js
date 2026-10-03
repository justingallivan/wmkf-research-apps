import { verifyTranscriptionCronSecret } from '../../../lib/utils/cron-auth';
import { runTranscriptionPreflight } from '../../../lib/services/transcription-pilot/preflight';
import AlertService from '../../../lib/services/alert-service';
import NotificationService from '../../../lib/services/notification-service';
import { withDalContext } from '../../../lib/dataverse/core/context';

export const config = { maxDuration: 300 };

const DAILY_INCOMPLETE_ALERT_KEY = 'transcription:daily-drain:incomplete';
const DAILY_WORKFLOW_INCOMPLETE_ALERT_KEY = 'transcription:daily-workflow:incomplete';
const WORKFLOW_RECOVERY_INCOMPLETE_ALERT_KEY = 'transcription:hourly-recovery:incomplete';
const DAILY_FAILURE_ALERT_KEY = 'transcription:daily-drain:failed';
const WORKFLOW_RECOVERY_FAILURE_ALERT_KEY = 'transcription:workflow-recovery:failed';

async function notifyOps(options) {
  try {
    await withDalContext('notification-email', () => NotificationService.notify({
      ...options,
      category: 'ops',
    }));
  } catch (error) {
    // Alerting is best-effort and must not replace the cron's worker result.
    console.error('[transcription-pilot/cron] alert failed:', error?.code || error?.name || 'unknown');
  }
}

async function reportIncomplete(autoResolveKey, title, message, stage) {
  await notifyOps({
    type: 'transcription_cron_incomplete',
    severity: 'warning',
    title,
    message,
    source: 'cron/drain-transcriptions',
    autoResolveKey,
    emailAdmins: true,
    operationalEvent: { stage, transient: true },
  });
}

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
      if (result.incomplete) {
        await reportIncomplete(
          WORKFLOW_RECOVERY_INCOMPLETE_ALERT_KEY,
          'Hourly transcription workflow recovery is incomplete',
          'The bounded recovery pass left work unresolved or reached its batch/time limit.',
          'workflow_recovery',
        );
      } else {
        await AlertService.autoResolve(WORKFLOW_RECOVERY_INCOMPLETE_ALERT_KEY);
      }
      return res.status(200).json({ ok: true, recovery: result });
    } catch {
      await notifyOps({
        type: 'transcription_workflow_recovery_failed',
        severity: 'error',
        title: 'Hourly transcription workflow recovery failed',
        message: 'The scheduled recovery pass could not complete.',
        source: 'cron/drain-transcriptions',
        autoResolveKey: WORKFLOW_RECOVERY_FAILURE_ALERT_KEY,
      });
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
    const dailyIncomplete = cleanup.incomplete
      || recoveredPreIntent.length === 100 || markedUncertain.length === 100;
    if (dailyIncomplete) {
      await reportIncomplete(
        DAILY_INCOMPLETE_ALERT_KEY,
        'Daily transcription cleanup or lease recovery is incomplete',
        'The bounded daily pass left cleanup or lease-recovery work unresolved or reached its batch limit.',
        'cleanup',
      );
    } else {
      await AlertService.autoResolve(DAILY_INCOMPLETE_ALERT_KEY);
    }
    if (workflowDispatch.incomplete) {
      await reportIncomplete(
        DAILY_WORKFLOW_INCOMPLETE_ALERT_KEY,
        'Transcription workflow dispatch or recovery is incomplete',
        'The bounded workflow pass left dispatch or recovery work unresolved or reached its batch/time limit.',
        'workflow_recovery',
      );
    } else {
      await AlertService.autoResolve(DAILY_WORKFLOW_INCOMPLETE_ALERT_KEY);
    }
    return res.status(200).json({ ok: true, summary });
  } catch (error) {
    console.error('[transcription-pilot/cron] worker failed:', error?.code || error?.name || 'unknown');
    await notifyOps({
      type: 'transcription_daily_drain_failed',
      severity: 'error',
      title: 'Daily transcription cleanup or dispatch failed',
      message: 'The scheduled transcription pass could not complete.',
      source: 'cron/drain-transcriptions',
      autoResolveKey: DAILY_FAILURE_ALERT_KEY,
    });
    return res.status(500).json({ error: 'Transcription worker failed', code: 'transcription_worker_failed' });
  }
}
