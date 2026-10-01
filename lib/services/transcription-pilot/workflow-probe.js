import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getStepMetadata, RetryableError, sleep } from 'workflow';
import { start } from 'workflow/api';
import { inspectAudioBuffer } from './media-inspector';

const PROBE_TIMEOUT_MS = 90_000;
let probeInFlight = false;

/** A provider-free, content-free Workflow SDK canary for the isolated Preview. */
export async function syntheticTranscriptionWorkflowProbe() {
  'use workflow';
  const retry = await proveWorkflowRetryStep();
  await sleep('10s');
  const media = await inspectSyntheticFixtureStep();
  return {
    retryResumed: retry.attempt === 2,
    retryAttempts: retry.attempt,
    sleepResumed: true,
    syntheticMediaAccepted: media.accepted,
    syntheticAudioBytes: media.bytes,
    syntheticAudioDurationSeconds: media.durationSeconds,
  };
}

export async function proveWorkflowRetryStep() {
  'use step';
  const { attempt } = getStepMetadata();
  if (attempt === 1) throw new RetryableError('synthetic_workflow_retry', { retryAfter: 1_000 });
  if (attempt !== 2) throw new Error('synthetic_workflow_retry_attempt_invalid');
  return { attempt };
}

export async function inspectSyntheticFixtureStep() {
  'use step';
  const fixturePath = path.join(process.cwd(), 'tests/fixtures/transcription/synthetic-aac.m4a');
  const input = await readFile(fixturePath);
  const inspected = await inspectAudioBuffer(input);
  return {
    accepted: Boolean(inspected.container && inspected.codec && inspected.durationSeconds > 0),
    bytes: input.byteLength,
    durationSeconds: inspected.durationSeconds,
  };
}

/** Starts at most one unresolved canary per function instance and never cancels it. */
export async function startSyntheticWorkflowProbe({ timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  if (probeInFlight) return { started: false, reason: 'probe_in_progress' };
  probeInFlight = true;
  let timer;
  let runId = null;
  try {
    const operation = (async () => {
      const run = await start(syntheticTranscriptionWorkflowProbe, []);
      runId = run.runId;
      return run.returnValue;
    })();
    const observed = operation.then(
      (value) => ({ value }),
      () => ({ failed: true })
    );
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    });
    const result = await Promise.race([observed, timeout]);
    if (result.timedOut) {
      // Outcome is uncertain. Keep the local guard closed; do not start a duplicate.
      return { started: runId !== null, completed: false, timedOut: true, runId };
    }
    if (!result.failed) probeInFlight = false;
    return result.failed
      ? { started: runId !== null, completed: false, timedOut: false, runId }
      : { started: true, completed: true, timedOut: false, runId, proof: result.value };
  } catch {
    // The SDK may have accepted the run before a transport failure surfaced.
    // Keep the process-local guard closed rather than risk a duplicate start.
    return { started: false, reason: 'workflow_start_failed' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
