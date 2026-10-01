import { start } from 'workflow/api';
import {
  acknowledgeTranscriptionWorkflowDispatch, claimTranscriptionWorkflowDispatch,
  failTranscriptionWorkflowDispatch, getTranscriptionWorkflowDispatch,
  rearmTranscriptionWorkflowDispatch, recoverStaleTranscriptionWorkflowDispatches,
} from './store';
import { transcriptionPilotWorkflow } from './workflow';

const DEFAULT_DISPATCH_BUDGET_MS = 15_000;
const DISPATCH_START_HEADROOM_MS = 10_000;

export class TranscriptionWorkflowDispatchError extends Error {
  constructor() {
    super('The transcription request is queued and will need a retry to start processing.');
    this.name = 'TranscriptionWorkflowDispatchError';
    this.code = 'transcription_dispatch_pending';
    this.status = 503;
    this.retryable = true;
  }
}

/** Start a job-scoped durable run using the DB outbox as the authority. */
export async function dispatchQueuedTranscriptionWorkflow({ jobId, ownerProfileId, manual = false, deadline = Date.now() + DEFAULT_DISPATCH_BUDGET_MS }) {
  try {
    if (manual) await rearmTranscriptionWorkflowDispatch({ jobId });
    const claimed = await claimTranscriptionWorkflowDispatch({ jobId, ownerProfileId, manual });
    if (!claimed) {
      const current = await getTranscriptionWorkflowDispatch({ jobId });
      if (current?.state === 'running' || current?.state === 'dispatching') return { started: false, state: current.state };
      throw new TranscriptionWorkflowDispatchError();
    }

    const started = await startClaimedDispatch(claimed, deadline);
    if (!started) throw new TranscriptionWorkflowDispatchError();
    return { started: true, state: 'running' };
  } catch (error) {
    if (error instanceof TranscriptionWorkflowDispatchError) throw error;
    throw new TranscriptionWorkflowDispatchError();
  }
}

async function startClaimedDispatch(claimed, deadline) {
  const remainingMs = deadline - Date.now();
  if (remainingMs < DISPATCH_START_HEADROOM_MS) {
    await failTranscriptionWorkflowDispatch({ jobId: claimed.job_id, dispatchToken: claimed.dispatch_token,
      attemptNo: Number(claimed.attempt_no), errorCode: 'workflow_start_deferred', retryAfterSeconds: 300 }).catch(() => {});
    return false;
  }

  let timeoutId;
  let timedOut = false;
  try {
    const startPromise = start(transcriptionPilotWorkflow, [claimed.job_id, Number(claimed.attempt_no)]);
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        reject(new Error('workflow_start_timeout'));
      }, remainingMs - DISPATCH_START_HEADROOM_MS);
    });
    const run = await Promise.race([startPromise, timeoutPromise]);
    const acknowledged = await acknowledgeTranscriptionWorkflowDispatch({
      jobId: claimed.job_id, dispatchToken: claimed.dispatch_token,
      attemptNo: Number(claimed.attempt_no), workflowRunId: run.runId,
    });
    return Boolean(acknowledged);
  } catch {
    await failTranscriptionWorkflowDispatch({ jobId: claimed.job_id, dispatchToken: claimed.dispatch_token,
      attemptNo: Number(claimed.attempt_no), errorCode: timedOut ? 'workflow_start_timeout' : 'workflow_start_failed',
      ...(timedOut ? { retryAfterSeconds: 300 } : {}),
    }).catch(() => {});
    return false;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/** Daily bounded recovery for failed/expired Workflow dispatches. */
export async function drainTranscriptionWorkflowDispatches({ maxRuns = 20, deadline = Date.now() + DEFAULT_DISPATCH_BUDGET_MS } = {}) {
  if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 100) throw new Error('invalid_workflow_dispatch_batch');
  const recovered = await recoverStaleTranscriptionWorkflowDispatches({ limit: maxRuns });
  let started = 0;
  let failed = 0;
  let noHeadroom = false;
  for (; started + failed < maxRuns; ) {
    if (deadline - Date.now() < DISPATCH_START_HEADROOM_MS) { noHeadroom = true; break; }
    const claimed = await claimTranscriptionWorkflowDispatch({ leaseSeconds: 300 });
    if (!claimed) break;
    if (await startClaimedDispatch(claimed, deadline)) started++;
    else { failed++; break; }
  }
  return { recovered: recovered.length, started, failed,
    incomplete: failed > 0 || started >= maxRuns || noHeadroom || deadline - Date.now() < DISPATCH_START_HEADROOM_MS };
}
