jest.mock('workflow/api', () => ({ getRun: jest.fn(), start: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/workflow', () => ({ transcriptionPilotWorkflow: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/store', () => ({
  acknowledgeTranscriptionWorkflowDispatch: jest.fn(),
  claimTranscriptionWorkflowDispatch: jest.fn(),
  failTranscriptionWorkflowDispatch: jest.fn(),
  getTranscriptionWorkflowDispatch: jest.fn(),
  rearmTranscriptionWorkflowDispatch: jest.fn(),
  listRunningTranscriptionWorkflowDispatches: jest.fn(),
  recoverTerminalTranscriptionWorkflowDispatch: jest.fn(),
  touchTranscriptionWorkflowDispatch: jest.fn(),
}));

import { getRun, start } from 'workflow/api';
import {
  acknowledgeTranscriptionWorkflowDispatch, claimTranscriptionWorkflowDispatch,
  failTranscriptionWorkflowDispatch, getTranscriptionWorkflowDispatch,
  listRunningTranscriptionWorkflowDispatches, recoverTerminalTranscriptionWorkflowDispatch,
  touchTranscriptionWorkflowDispatch,
} from '../../lib/services/transcription-pilot/store';
import {
  dispatchQueuedTranscriptionWorkflow, drainTranscriptionWorkflowDispatches,
  TranscriptionWorkflowDispatchError,
} from '../../lib/services/transcription-pilot/workflow-dispatch';

const jobId = '00000000-0000-4000-8000-000000000001';
const dispatchToken = '00000000-0000-4000-8000-000000000002';

beforeEach(() => {
  jest.useRealTimers();
  jest.resetAllMocks();
  claimTranscriptionWorkflowDispatch.mockResolvedValue(null);
  getTranscriptionWorkflowDispatch.mockResolvedValue(null);
  listRunningTranscriptionWorkflowDispatches.mockResolvedValue([]);
  recoverTerminalTranscriptionWorkflowDispatch.mockResolvedValue(null);
  touchTranscriptionWorkflowDispatch.mockResolvedValue(true);
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
  expect(result).toMatchObject({ checked: 0, recovered: 0, started: 0, failed: 0, incomplete: true });
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

    expect(result).toMatchObject({ checked: 0, recovered: 0, started: 0, failed: 1, incomplete: true });
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

test('recovers only a definitively failed run with the exact persisted generation', async () => {
  listRunningTranscriptionWorkflowDispatches.mockResolvedValue([{
    job_id: jobId, workflow_run_id: 'run_old_4', attempt_no: 4,
  }]);
  getRun.mockReturnValue({ status: Promise.resolve('failed') });
  recoverTerminalTranscriptionWorkflowDispatch.mockResolvedValue({ job_id: jobId, attempt_no: 4 });

  const result = await drainTranscriptionWorkflowDispatches({ maxRuns: 1, deadline: Date.now() + 30_000 });

  expect(result).toMatchObject({ checked: 1, recovered: 1, started: 0, incomplete: true });
  expect(recoverTerminalTranscriptionWorkflowDispatch).toHaveBeenCalledWith({
    jobId, workflowRunId: 'run_old_4', attemptNo: 4, terminalStatus: 'failed',
  });
  expect(touchTranscriptionWorkflowDispatch).not.toHaveBeenCalled();
  expect(claimTranscriptionWorkflowDispatch).toHaveBeenCalledWith({ leaseSeconds: 300 });
});

test.each(['running', 'pending', 'unexpected'])('does not rearm a nonterminal or unknown status (%s)', async status => {
  listRunningTranscriptionWorkflowDispatches.mockResolvedValue([{
    job_id: jobId, workflow_run_id: 'run_sleeping_5', attempt_no: 5,
  }]);
  getRun.mockReturnValue({ status: Promise.resolve(status) });

  const result = await drainTranscriptionWorkflowDispatches({ maxRuns: 2, deadline: Date.now() + 30_000 });

  expect(result).toMatchObject({ checked: 1, recovered: 0, incomplete: status === 'unexpected' });
  expect(recoverTerminalTranscriptionWorkflowDispatch).not.toHaveBeenCalled();
  expect(touchTranscriptionWorkflowDispatch).toHaveBeenCalledWith({
    jobId, workflowRunId: 'run_sleeping_5', attemptNo: 5,
  });
});

test('unknown status lookup errors are no-op for the job and mark the sweep incomplete', async () => {
  listRunningTranscriptionWorkflowDispatches.mockResolvedValue([{
    job_id: jobId, workflow_run_id: 'run_unknown_6', attempt_no: 6,
  }]);
  getRun.mockReturnValue({ status: Promise.reject(new Error('private workflow backend detail')) });

  const result = await drainTranscriptionWorkflowDispatches({ maxRuns: 2, deadline: Date.now() + 30_000 });

  expect(result).toMatchObject({ checked: 1, recovered: 0, incomplete: true });
  expect(recoverTerminalTranscriptionWorkflowDispatch).not.toHaveBeenCalled();
  expect(touchTranscriptionWorkflowDispatch).toHaveBeenCalledWith({
    jobId, workflowRunId: 'run_unknown_6', attemptNo: 6,
  });
});

test('caps checks and starts separately so live runs cannot starve pending dispatches', async () => {
  listRunningTranscriptionWorkflowDispatches.mockResolvedValue(Array.from({ length: 20 }, (_, index) => ({
    job_id: jobId, workflow_run_id: `run_live_${index}`, attempt_no: index + 1,
  })));
  getRun.mockReturnValue({ status: Promise.resolve('running') });
  claimTranscriptionWorkflowDispatch
    .mockResolvedValueOnce({ job_id: jobId, attempt_no: 8, dispatch_token: dispatchToken })
    .mockResolvedValueOnce(null);
  start.mockResolvedValue({ runId: 'run_pending_job' });
  acknowledgeTranscriptionWorkflowDispatch.mockResolvedValue({ state: 'running' });

  const result = await drainTranscriptionWorkflowDispatches({ maxRuns: 20, deadline: Date.now() + 30_000 });

  expect(result).toMatchObject({ checked: 20, recovered: 0, started: 1 });
  expect(getRun).toHaveBeenCalledTimes(20);
  expect(start).toHaveBeenCalledTimes(1);
});
