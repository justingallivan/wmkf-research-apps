import { RetryableError, sleep } from 'workflow';
import {
  checkTranscriptionWorkflowAttempt, expireUnacknowledgedTranscriptionWorkflowDispatch,
  finishTranscriptionWorkflowDispatch, touchTranscriptionWorkflowDispatch,
} from './store';
import { advanceTranscriptionPilotJob } from './worker';

const MAX_CYCLES = 200;
const ACK_POLL_LIMIT = 180;
const MAX_SLEEP_MS = 7 * 24 * 60 * 60 * 1000;
const STEP_RETRY_AFTER_MS = 60_000;
const STEP_MAX_RETRIES = 1_440;

function retryableStepError(message) {
  return new RetryableError(message, { retryAfter: STEP_RETRY_AFTER_MS });
}

async function dispatchStateStep(jobId, attemptNo) {
  'use step';
  try {
    const state = await checkTranscriptionWorkflowAttempt({ jobId, attemptNo });
    if (state === 'running') await touchTranscriptionWorkflowDispatch({ jobId, attemptNo });
    return state;
  } catch {
    throw retryableStepError('transcription_workflow_state_unavailable');
  }
}
dispatchStateStep.maxRetries = STEP_MAX_RETRIES;

async function advanceJobStep(jobId) {
  'use step';
  try {
    const result = await advanceTranscriptionPilotJob(jobId);
    return {
      state: ['complete', 'paused', 'attention', 'wait'].includes(result?.state) ? result.state : 'wait',
      waitMs: Number.isFinite(result?.waitUntil)
        ? Math.max(1_000, Math.min(MAX_SLEEP_MS, Math.trunc(result.waitUntil - Date.now())))
        : 15_000,
    };
  } catch {
    throw retryableStepError('transcription_worker_step_failed');
  }
}
advanceJobStep.maxRetries = STEP_MAX_RETRIES;

async function expireUnacknowledgedStep(jobId, attemptNo) {
  'use step';
  try { await expireUnacknowledgedTranscriptionWorkflowDispatch({ jobId, attemptNo }); }
  catch { throw retryableStepError('transcription_workflow_ack_expiry_failed'); }
}
expireUnacknowledgedStep.maxRetries = STEP_MAX_RETRIES;

async function finishStep(jobId, attemptNo, retryDelayMs) {
  'use step';
  const retryAt = retryDelayMs == null ? null : new Date(Date.now() + retryDelayMs);
  try { await finishTranscriptionWorkflowDispatch({ jobId, attemptNo, retryAt }); }
  catch { throw retryableStepError('transcription_workflow_finish_failed'); }
}
finishStep.maxRetries = STEP_MAX_RETRIES;

async function handoffJobStep(jobId, attemptNo) {
  'use step';
  try {
    await finishTranscriptionWorkflowDispatch({ jobId, attemptNo, retryAt: new Date() });
    const { dispatchQueuedTranscriptionWorkflow } = await import('./workflow-dispatch');
    await dispatchQueuedTranscriptionWorkflow({ jobId });
  } catch {
    throw retryableStepError('transcription_workflow_handoff_failed');
  }
}
handoffJobStep.maxRetries = STEP_MAX_RETRIES;

/** Arguments and results contain only an opaque DB job UUID, attempt number,
 * state labels, and timestamps. All private audio/provider work stays in steps. */
export async function transcriptionPilotWorkflow(jobId, attemptNo) {
  'use workflow';
  if (typeof jobId !== 'string' || !/^[0-9a-f-]{36}$/i.test(jobId)
    || !Number.isInteger(attemptNo) || attemptNo < 1) return;

  let acknowledged = false;
  for (let count = 0; count < ACK_POLL_LIMIT; count++) {
    const state = await dispatchStateStep(jobId, attemptNo);
    if (state === 'running') { acknowledged = true; break; }
    if (state === 'stale') return;
    await sleep(2_000);
  }
  if (!acknowledged) {
    await expireUnacknowledgedStep(jobId, attemptNo);
    return;
  }

  for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
    const state = await dispatchStateStep(jobId, attemptNo);
    if (state !== 'running') return;
    const result = await advanceJobStep(jobId);
    if (result.state === 'complete' || result.state === 'paused' || result.state === 'attention') {
      await finishStep(jobId, attemptNo, null);
      return;
    }
    await sleep(result.waitMs);
  }

  // Bound the run's event log, then create a fresh, independently acknowledged
  // outbox attempt. The next run ID/attempt is stored by the normal dispatcher.
  await handoffJobStep(jobId, attemptNo);
}
