import { sleep } from 'workflow';
import {
  checkTranscriptionWorkflowAttempt, expireUnacknowledgedTranscriptionWorkflowDispatch,
  finishTranscriptionWorkflowDispatch, touchTranscriptionWorkflowDispatch,
} from './store';
import { advanceTranscriptionPilotJob } from './worker';

const MAX_CYCLES = 1_000;
const ACK_POLL_LIMIT = 180;
const FALLBACK_DELAY_MS = 24 * 60 * 60 * 1000;
const MAX_SLEEP_MS = 7 * 24 * 60 * 60 * 1000;

async function dispatchStateStep(jobId, attemptNo) {
  'use step';
  try {
    const state = await checkTranscriptionWorkflowAttempt({ jobId, attemptNo });
    if (state === 'running') await touchTranscriptionWorkflowDispatch({ jobId, attemptNo });
    return state;
  } catch {
    throw new Error('transcription_workflow_state_unavailable');
  }
}

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
    throw new Error('transcription_worker_step_failed');
  }
}

async function expireUnacknowledgedStep(jobId, attemptNo) {
  'use step';
  try { await expireUnacknowledgedTranscriptionWorkflowDispatch({ jobId, attemptNo }); }
  catch { throw new Error('transcription_workflow_ack_expiry_failed'); }
}

async function finishStep(jobId, attemptNo, retryDelayMs) {
  'use step';
  const retryAt = retryDelayMs == null ? null : new Date(Date.now() + retryDelayMs);
  try { await finishTranscriptionWorkflowDispatch({ jobId, attemptNo, retryAt }); }
  catch { throw new Error('transcription_workflow_finish_failed'); }
}

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

  // Bound event growth and active polling. The daily recovery route may enqueue
  // a fresh attempt; user retries can also re-arm queued jobs immediately.
  await finishStep(jobId, attemptNo, FALLBACK_DELAY_MS);
}
