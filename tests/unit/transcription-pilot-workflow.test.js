jest.mock('workflow', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  RetryableError: class RetryableError extends Error {
    constructor(message, options) { super(message); this.name = 'RetryableError'; this.options = options; }
  },
}));
jest.mock('../../lib/services/transcription-pilot/store', () => ({
  checkTranscriptionWorkflowAttempt: jest.fn(),
  expireUnacknowledgedTranscriptionWorkflowDispatch: jest.fn(),
  finishTranscriptionWorkflowDispatch: jest.fn(),
  touchTranscriptionWorkflowDispatch: jest.fn(),
}));
jest.mock('../../lib/services/transcription-pilot/worker', () => ({ advanceTranscriptionPilotJob: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/workflow-dispatch', () => ({
  dispatchQueuedTranscriptionWorkflow: jest.fn().mockResolvedValue({ started: true, state: 'running' }),
}));

import { RetryableError, sleep } from 'workflow';
import {
  checkTranscriptionWorkflowAttempt, expireUnacknowledgedTranscriptionWorkflowDispatch,
  finishTranscriptionWorkflowDispatch, touchTranscriptionWorkflowDispatch,
} from '../../lib/services/transcription-pilot/store';
import { advanceTranscriptionPilotJob } from '../../lib/services/transcription-pilot/worker';
import { dispatchQueuedTranscriptionWorkflow } from '../../lib/services/transcription-pilot/workflow-dispatch';
import { transcriptionPilotWorkflow } from '../../lib/services/transcription-pilot/workflow';

const jobId = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  jest.resetAllMocks();
  sleep.mockResolvedValue(undefined);
  checkTranscriptionWorkflowAttempt.mockResolvedValue('running');
  touchTranscriptionWorkflowDispatch.mockResolvedValue(true);
  advanceTranscriptionPilotJob.mockResolvedValue({ state: 'complete' });
  dispatchQueuedTranscriptionWorkflow.mockResolvedValue({ started: true, state: 'running' });
});

test('ready or paused work finishes without an idle retention sleep', async () => {
  await transcriptionPilotWorkflow(jobId, 1);
  expect(advanceTranscriptionPilotJob).toHaveBeenCalledWith(jobId);
  expect(finishTranscriptionWorkflowDispatch).toHaveBeenCalledWith({ jobId, attemptNo: 1, retryAt: null });
  expect(sleep).not.toHaveBeenCalled();
});

test('a superseded dispatch cannot advance a job', async () => {
  checkTranscriptionWorkflowAttempt.mockResolvedValue('stale');
  await transcriptionPilotWorkflow(jobId, 1);
  expect(advanceTranscriptionPilotJob).not.toHaveBeenCalled();
  expect(finishTranscriptionWorkflowDispatch).not.toHaveBeenCalled();
});

test('acknowledgement timeout waits beyond the five-minute dispatch lease', async () => {
  checkTranscriptionWorkflowAttempt.mockResolvedValue('waiting');
  await transcriptionPilotWorkflow(jobId, 1);
  const delay = sleep.mock.calls.reduce((sum, [ms]) => sum + ms, 0);
  expect(delay).toBeGreaterThan(300_000);
  expect(expireUnacknowledgedTranscriptionWorkflowDispatch).toHaveBeenCalledWith({ jobId, attemptNo: 1 });
  expect(advanceTranscriptionPilotJob).not.toHaveBeenCalled();
});

test.each([
  ['state', () => checkTranscriptionWorkflowAttempt.mockRejectedValue(new Error('private database detail')), 'transcription_workflow_state_unavailable'],
  ['advance', () => advanceTranscriptionPilotJob.mockRejectedValue(new Error('private transcript detail')), 'transcription_worker_step_failed'],
  ['finish', () => finishTranscriptionWorkflowDispatch.mockRejectedValue(new Error('private database detail')), 'transcription_workflow_finish_failed'],
  ['ack expiry', () => {
    checkTranscriptionWorkflowAttempt.mockResolvedValue('waiting');
    expireUnacknowledgedTranscriptionWorkflowDispatch.mockRejectedValue(new Error('private database detail'));
  }, 'transcription_workflow_ack_expiry_failed'],
])('%s step serializes only a fixed error without a private cause', async (_label, arrange, message) => {
  arrange();
  const error = await transcriptionPilotWorkflow(jobId, 1).catch(value => value);
  expect(error).toBeInstanceOf(RetryableError);
  expect(error.name).toBe('RetryableError');
  expect(error.message).toBe(message);
  expect(error.options).toEqual({ retryAfter: 60_000 });
  expect(error.cause).toBeUndefined();
  expect(JSON.stringify(error)).not.toContain('private');
});

test('bounded work hands off through a new outbox attempt instead of parking for a day', async () => {
  advanceTranscriptionPilotJob.mockResolvedValue({ state: 'wait', waitUntil: Date.now() + 15_000 });
  await transcriptionPilotWorkflow(jobId, 7);
  expect(advanceTranscriptionPilotJob).toHaveBeenCalledTimes(200);
  expect(finishTranscriptionWorkflowDispatch).toHaveBeenLastCalledWith({
    jobId, attemptNo: 7, retryAt: expect.any(Date),
  });
  expect(dispatchQueuedTranscriptionWorkflow).toHaveBeenCalledWith({ jobId });
  expect(finishTranscriptionWorkflowDispatch.mock.invocationCallOrder.at(-1))
    .toBeLessThan(dispatchQueuedTranscriptionWorkflow.mock.invocationCallOrder[0]);
  expect(sleep).toHaveBeenCalledTimes(200);
});

test('a transient handoff failure is retried with only a fixed message and delay', async () => {
  advanceTranscriptionPilotJob.mockResolvedValue({ state: 'wait', waitUntil: Date.now() + 15_000 });
  dispatchQueuedTranscriptionWorkflow.mockRejectedValue(new Error('private workflow backend detail'));
  const error = await transcriptionPilotWorkflow(jobId, 2).catch(value => value);
  expect(finishTranscriptionWorkflowDispatch).toHaveBeenCalledWith({
    jobId, attemptNo: 2, retryAt: expect.any(Date),
  });
  expect(finishTranscriptionWorkflowDispatch.mock.invocationCallOrder.at(-1))
    .toBeLessThan(dispatchQueuedTranscriptionWorkflow.mock.invocationCallOrder[0]);
  expect(error).toBeInstanceOf(RetryableError);
  expect(error.message).toBe('transcription_workflow_handoff_failed');
  expect(error.options).toEqual({ retryAfter: 60_000 });
  expect(JSON.stringify(error)).not.toContain('private');
});
