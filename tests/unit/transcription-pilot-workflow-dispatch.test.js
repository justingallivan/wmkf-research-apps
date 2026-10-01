jest.mock('workflow/api', () => ({ start: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/workflow', () => ({ transcriptionPilotWorkflow: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/store', () => ({
  acknowledgeTranscriptionWorkflowDispatch: jest.fn(),
  claimTranscriptionWorkflowDispatch: jest.fn(),
  failTranscriptionWorkflowDispatch: jest.fn(),
  getTranscriptionWorkflowDispatch: jest.fn(),
  rearmTranscriptionWorkflowDispatch: jest.fn(),
  recoverStaleTranscriptionWorkflowDispatches: jest.fn(),
}));

import { start } from 'workflow/api';
import {
  acknowledgeTranscriptionWorkflowDispatch, claimTranscriptionWorkflowDispatch,
  failTranscriptionWorkflowDispatch, getTranscriptionWorkflowDispatch,
  recoverStaleTranscriptionWorkflowDispatches,
} from '../../lib/services/transcription-pilot/store';
import {
  dispatchQueuedTranscriptionWorkflow, drainTranscriptionWorkflowDispatches,
  TranscriptionWorkflowDispatchError,
} from '../../lib/services/transcription-pilot/workflow-dispatch';

const jobId = '00000000-0000-4000-8000-000000000001';
const dispatchToken = '00000000-0000-4000-8000-000000000002';

beforeEach(() => {
  jest.clearAllMocks();
  recoverStaleTranscriptionWorkflowDispatches.mockResolvedValue([]);
});

test('starts only with an outbox claim and acknowledges the opaque run id', async () => {
  claimTranscriptionWorkflowDispatch.mockResolvedValue({ job_id: jobId, attempt_no: 2, dispatch_token: dispatchToken });
  start.mockResolvedValue({ runId: 'run_fixture_2' });
  acknowledgeTranscriptionWorkflowDispatch.mockResolvedValue({ state: 'running' });

  await expect(dispatchQueuedTranscriptionWorkflow({ jobId, ownerProfileId: 7 })).resolves.toEqual({ started: true, state: 'running' });
  expect(start).toHaveBeenCalledWith(expect.any(Function), [jobId, 2]);
  expect(acknowledgeTranscriptionWorkflowDispatch).toHaveBeenCalledWith({
    jobId, dispatchToken, attemptNo: 2, workflowRunId: 'run_fixture_2',
  });
});

test('returns accepted when a run is already active instead of creating duplicates', async () => {
  claimTranscriptionWorkflowDispatch.mockResolvedValue(null);
  getTranscriptionWorkflowDispatch.mockResolvedValue({ state: 'running' });

  await expect(dispatchQueuedTranscriptionWorkflow({ jobId, ownerProfileId: 7 })).resolves.toEqual({ started: false, state: 'running' });
  expect(start).not.toHaveBeenCalled();
});

test('normalizes outbox claim failures to the retryable dispatch response contract', async () => {
  claimTranscriptionWorkflowDispatch.mockRejectedValue(new Error('sensitive database connection detail'));
  let caught;
  try { await dispatchQueuedTranscriptionWorkflow({ jobId, ownerProfileId: 7 }); } catch (error) { caught = error; }
  expect(caught).toMatchObject({
    name: 'TranscriptionWorkflowDispatchError', code: 'transcription_dispatch_pending', status: 503, retryable: true,
  });
  expect(caught.message).not.toContain('sensitive database connection detail');
  expect(start).not.toHaveBeenCalled();
});

test('makes failed starts retryable without leaking SDK error text', async () => {
  claimTranscriptionWorkflowDispatch.mockResolvedValue({ job_id: jobId, attempt_no: 1, dispatch_token: dispatchToken });
  start.mockRejectedValue(new Error('sensitive workflow backend detail'));
  failTranscriptionWorkflowDispatch.mockResolvedValue({ state: 'pending' });

  await expect(dispatchQueuedTranscriptionWorkflow({ jobId, ownerProfileId: 7 })).rejects.toMatchObject({
    name: 'TranscriptionWorkflowDispatchError', code: 'transcription_dispatch_pending', status: 503, retryable: true,
  });
  expect(failTranscriptionWorkflowDispatch).toHaveBeenCalledWith({
    jobId, dispatchToken, attemptNo: 1, errorCode: 'workflow_start_failed',
  });
  expect(failTranscriptionWorkflowDispatch.mock.calls[0][0]).not.toHaveProperty('message');
  expect(TranscriptionWorkflowDispatchError).toBeTruthy();
});

test('does not claim new work when less than ten seconds remain', async () => {
  const result = await drainTranscriptionWorkflowDispatches({ maxRuns: 2, deadline: Date.now() + 9_999 });
  expect(result).toEqual({ recovered: 0, started: 0, failed: 0, incomplete: true });
  expect(claimTranscriptionWorkflowDispatch).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});

test('bounds a hanging SDK start and never acknowledges its late result', async () => {
  jest.useFakeTimers();
  try {
    claimTranscriptionWorkflowDispatch.mockResolvedValue({ job_id: jobId, attempt_no: 4, dispatch_token: dispatchToken });
    failTranscriptionWorkflowDispatch.mockResolvedValue({ state: 'pending' });
    let resolveLateStart;
    start.mockImplementation(() => new Promise((resolve) => { resolveLateStart = resolve; }));

    const deadline = Date.now() + 12_000;
    const draining = drainTranscriptionWorkflowDispatches({ maxRuns: 1, deadline });
    await jest.advanceTimersByTimeAsync(2_000);
    const result = await draining;

    expect(result).toEqual({ recovered: 0, started: 0, failed: 1, incomplete: true });
    expect(failTranscriptionWorkflowDispatch).toHaveBeenCalledWith({
      jobId, dispatchToken, attemptNo: 4, errorCode: 'workflow_start_timeout', retryAfterSeconds: 300,
    });
    expect(acknowledgeTranscriptionWorkflowDispatch).not.toHaveBeenCalled();

    resolveLateStart({ runId: 'late_run_fixture' });
    await Promise.resolve();
    expect(acknowledgeTranscriptionWorkflowDispatch).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
