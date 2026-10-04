// Forces a tiny speaker_samples budget so the budget-overflow terminal paths are exercised end to end.
jest.mock('../../lib/services/execute-prompt.js', () => ({ executePrompt: jest.fn() }));
jest.mock('../../lib/services/model-override-loader.js', () => ({ loadModelOverrides: jest.fn(async () => {}) }));
jest.mock('../../lib/dataverse/core/context.js', () => ({ withDalContext: (_name, fn) => fn() }));
jest.mock('../../lib/services/transcription-pilot/runtime.js', () => ({
  MAX_ZOOM_TRANSCRIPT_BYTES: 4_000_000, readPrivateContentIfPresent: jest.fn(),
}));
jest.mock('../../lib/services/transcription-pilot/store.js', () => ({
  claimTranscriptionJobForAlignment: jest.fn(), completeTranscriptionAlignment: jest.fn(),
  failTranscriptionAlignment: jest.fn(), claimNextPendingTranscriptionAlignmentJob: jest.fn(),
  expireExhaustedTranscriptionAlignments: jest.fn(),
}));
jest.mock('../../shared/config/prompts/meeting-speaker-alignment.js', () => {
  const actual = jest.requireActual('../../shared/config/prompts/meeting-speaker-alignment.js');
  return {
    ...actual,
    PROMPT_VARIABLES: { variables: actual.PROMPT_VARIABLES.variables.map(variable => (
      variable.name === 'speaker_samples' ? { ...variable, maxChars: global.__SAMPLES_BUDGET__ ?? 400 } : variable)) },
  };
});

import crypto from 'node:crypto';
import { executePrompt } from '../../lib/services/execute-prompt.js';
import * as runtime from '../../lib/services/transcription-pilot/runtime.js';
import * as store from '../../lib/services/transcription-pilot/store.js';
import { alignMeetingTranscriptionSpeakers } from '../../lib/services/meeting-tracker-transcription/alignment-service.js';

const jobId = '11111111-1111-4111-8111-111111111111';
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const ts = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;

function arrange(content, vtt) {
  const row = { id: jobId, version: 3, output_pathname: 'o', output_sha256: sha(content),
    zoom_transcript_pathname: 'z', zoom_transcript_sha256: sha(vtt) };
  store.claimTranscriptionJobForAlignment.mockResolvedValue({ job: row, leaseToken: '22222222-2222-4222-8222-222222222222' });
  runtime.readPrivateContentIfPresent.mockImplementation(async p => ({ buffer: Buffer.from(p === 'o' ? content : vtt) }));
  store.failTranscriptionAlignment.mockResolvedValue({});
}
beforeEach(() => { jest.clearAllMocks(); jest.spyOn(console, 'warn').mockImplementation(() => {}); });

test('reserved samples that exceed the budget fail terminally with samples_over_budget', async () => {
  const utterances = []; const cues = [];
  for (let i = 0; i < 8; i++) {
    const text = `utterance ${i} ${'padding words here '.repeat(10)}`;
    utterances.push({ speaker: 'A', start: i * 5000, end: i * 5000 + 4000, text });
    cues.push(`${ts(i * 5000)} --> ${ts(i * 5000 + 4000)}\nAlice Example: ${text}`);
  }
  arrange(JSON.stringify({ utterances }), `WEBVTT\n\n${cues.join('\n\n')}\n`);
  await alignMeetingTranscriptionSpeakers({ jobId });
  expect(store.failTranscriptionAlignment).toHaveBeenCalledWith(expect.objectContaining({ terminal: true, code: 'samples_over_budget' }));
  expect(executePrompt).not.toHaveBeenCalled();
});

test('rendered labels can push even the first sample over budget while sampler text fits: speaker dropped, terminal', async () => {
  // Sampler cost counts utterance and cue TEXT only; many one-character cues with long names
  // inflate the rendering, so the reserved samples fit the sampler but nothing fits the render.
  const name = n => `Participant ${n} ${'N'.repeat(55)}`;
  const utterances = []; const cues = [];
  for (let i = 0; i < 4; i++) {
    utterances.push({ speaker: 'A', start: i * 100_000, end: i * 100_000 + 4000, text: `short remark ${i}` });
    for (let c = 0; c < 8; c++) cues.push(`${ts(i * 100_000 + c * 400)} --> ${ts(i * 100_000 + c * 400 + 300)}\n${name(c)}: x`);
  }
  arrange(JSON.stringify({ utterances }), `WEBVTT\n\n${cues.join('\n\n')}\n`);
  await alignMeetingTranscriptionSpeakers({ jobId });
  expect(store.failTranscriptionAlignment).toHaveBeenCalledWith(expect.objectContaining({ terminal: true, code: 'samples_over_budget' }));
  expect(executePrompt).not.toHaveBeenCalled();
});

test('the runtime serializer and the natively importable alignment-samples module are the same function (probe parity)', async () => {
  // Codex review 2026-10-04: the diagnostic probe once treated every sampled pair as visible and
  // reported "applied" where runAlignment would fail samples_over_budget. The probe now imports
  // serializeSpeakerSamples from alignment-samples.js; this pins that the service re-exports the
  // identical function so the two can never diverge silently.
  const service = await import('../../lib/services/meeting-tracker-transcription/alignment-service.js');
  const samples = await import('../../lib/services/meeting-tracker-transcription/alignment-samples.js');
  expect(service.serializeSpeakerSamples).toBe(samples.serializeSpeakerSamples);
  expect(samples.VARIABLE_MAX.speaker_samples).toBe(400); // this suite mocks the prompt budget to 400 chars
});
