jest.mock('workflow', () => ({
  getStepMetadata: jest.fn(),
  sleep: jest.fn().mockResolvedValue(undefined),
  RetryableError: class RetryableError extends Error {
    constructor(message, options) { super(message); this.name = 'RetryableError'; this.options = options; }
  },
}));
jest.mock('workflow/api', () => ({ start: jest.fn() }));
jest.mock('node:fs/promises', () => ({ readFile: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/media-inspector', () => ({
  inspectAudioBuffer: jest.fn(),
}));

import { getStepMetadata, RetryableError, sleep } from 'workflow';
import { start } from 'workflow/api';
import { readFile } from 'node:fs/promises';
import { inspectAudioBuffer } from '../../lib/services/transcription-pilot/media-inspector';
import {
  inspectSyntheticFixtureStep, proveWorkflowRetryStep,
  startSyntheticWorkflowProbe, syntheticTranscriptionWorkflowProbe,
} from '../../lib/services/transcription-pilot/workflow-probe';

beforeEach(() => {
  jest.clearAllMocks();
  sleep.mockResolvedValue(undefined);
});

test('synthetic retry step fails once with a one-second durable retry and succeeds on attempt two', async () => {
  getStepMetadata.mockReturnValueOnce({ attempt: 1 }).mockReturnValueOnce({ attempt: 2 });
  const first = await proveWorkflowRetryStep().catch((error) => error);
  expect(first).toBeInstanceOf(RetryableError);
  expect(first.message).toBe('synthetic_workflow_retry');
  expect(first.options).toEqual({ retryAfter: 1_000 });
  await expect(proveWorkflowRetryStep()).resolves.toEqual({ attempt: 2 });
});

test('workflow waits durably and parses only the repository synthetic audio fixture', async () => {
  getStepMetadata.mockReturnValue({ attempt: 2 });
  readFile.mockResolvedValue(Buffer.from('synthetic-audio-bytes'));
  inspectAudioBuffer.mockResolvedValue({ container: 'M4A', codec: 'AAC', durationSeconds: 3.065 });
  await expect(syntheticTranscriptionWorkflowProbe()).resolves.toEqual({
    retryResumed: true, retryAttempts: 2, sleepResumed: true,
    syntheticMediaAccepted: true, syntheticAudioBytes: 21, syntheticAudioDurationSeconds: 3.065,
  });
  expect(sleep).toHaveBeenCalledWith('10s');
  expect(readFile).toHaveBeenCalledWith(expect.stringContaining('tests/fixtures/transcription/synthetic-aac.m4a'));
  expect(inspectAudioBuffer).toHaveBeenCalledWith(Buffer.from('synthetic-audio-bytes'));
});

test('start returns only safe proof and does not pass caller data into the workflow', async () => {
  const proof = { retryResumed: true, retryAttempts: 2, sleepResumed: true,
    syntheticMediaAccepted: true, syntheticAudioBytes: 16863, syntheticAudioDurationSeconds: 3.065 };
  start.mockResolvedValue({ runId: 'safe-run-id', returnValue: Promise.resolve(proof) });
  await expect(startSyntheticWorkflowProbe()).resolves.toEqual({
    started: true, completed: true, timedOut: false, runId: 'safe-run-id', proof,
  });
  expect(start).toHaveBeenCalledWith(syntheticTranscriptionWorkflowProbe, []);
  expect(JSON.stringify(proof)).not.toMatch(/transcript|provider|pathname|token/i);
});

test('an unresolved start times out without opening a second start attempt', async () => {
  start.mockReturnValue(new Promise(() => {}));
  const result = await startSyntheticWorkflowProbe({ timeoutMs: 0 });
  expect(result).toMatchObject({ started: false, completed: false, timedOut: true, runId: null });
  await expect(startSyntheticWorkflowProbe()).resolves.toEqual({ started: false, reason: 'probe_in_progress' });
  expect(start).toHaveBeenCalledTimes(1);
});

test('fixture step does not return audio bytes or parsed content', async () => {
  readFile.mockResolvedValue(Buffer.from('fixture'));
  inspectAudioBuffer.mockResolvedValue({ container: 'M4A', codec: 'AAC', durationSeconds: 3.065 });
  await expect(inspectSyntheticFixtureStep()).resolves.toEqual({ accepted: true, bytes: 7, durationSeconds: 3.065 });
});
