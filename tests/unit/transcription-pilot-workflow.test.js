jest.mock('workflow', () => ({ sleep: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../lib/services/transcription-pilot/store', () => ({
  checkTranscriptionWorkflowAttempt: jest.fn(),
  expireUnacknowledgedTranscriptionWorkflowDispatch: jest.fn(),
  finishTranscriptionWorkflowDispatch: jest.fn(),
  touchTranscriptionWorkflowDispatch: jest.fn(),
}));
jest.mock('../../lib/services/transcription-pilot/worker', () => ({ advanceTranscriptionPilotJob: jest.fn() }));

import { sleep } from 'workflow';
import {
  checkTranscriptionWorkflowAttempt, expireUnacknowledgedTranscriptionWorkflowDispatch,
  finishTranscriptionWorkflowDispatch, touchTranscriptionWorkflowDispatch,
} from '../../lib/services/transcription-pilot/store';
import { advanceTranscriptionPilotJob } from '../../lib/services/transcription-pilot/worker';
import { transcriptionPilotWorkflow } from '../../lib/services/transcription-pilot/workflow';

const jobId = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  jest.resetAllMocks();
  sleep.mockResolvedValue(undefined);
  checkTranscriptionWorkflowAttempt.mockResolvedValue('running');
  touchTranscriptionWorkflowDispatch.mockResolvedValue(true);
  advanceTranscriptionPilotJob.mockResolvedValue({ state: 'complete' });
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
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe(message);
  expect(error.cause).toBeUndefined();
  expect(JSON.stringify(error)).not.toContain('private');
});
