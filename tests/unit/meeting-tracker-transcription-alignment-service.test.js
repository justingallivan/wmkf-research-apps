import crypto from 'node:crypto';

jest.mock('../../lib/services/execute-prompt.js', () => ({ executePrompt: jest.fn() }));
jest.mock('../../lib/services/model-override-loader.js', () => ({ loadModelOverrides: jest.fn(async () => {}) }));
jest.mock('../../lib/dataverse/core/context.js', () => ({ withDalContext: (_name, fn) => fn() }));
jest.mock('../../lib/services/transcription-pilot/runtime.js', () => ({
  MAX_ZOOM_TRANSCRIPT_BYTES: 4_000_000,
  readPrivateContentIfPresent: jest.fn(),
}));
jest.mock('../../lib/services/transcription-pilot/store.js', () => ({
  claimTranscriptionJobForAlignment: jest.fn(),
  completeTranscriptionAlignment: jest.fn(),
  failTranscriptionAlignment: jest.fn(),
  claimNextPendingTranscriptionAlignmentJob: jest.fn(),
  expireExhaustedTranscriptionAlignments: jest.fn(),
}));

import { executePrompt } from '../../lib/services/execute-prompt.js';
import * as runtime from '../../lib/services/transcription-pilot/runtime.js';
import * as store from '../../lib/services/transcription-pilot/store.js';
import {
  alignMeetingTranscriptionSpeakers, recoverPendingAlignments, serializeSpeakerSamples,
} from '../../lib/services/meeting-tracker-transcription/alignment-service.js';

const jobId = '11111111-1111-4111-8111-111111111111';
const SENTINEL = 'ZZSENTINELZZ';
const NAME_A = 'Alice Examplar';
const NAME_B = 'Bob Sampleton';
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const ts = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;

const LINES = {
  A: ['we should absolutely revisit the budget allocation before the quarter closes',
    'the pilot cohort showed remarkable retention across every participating campus',
    'our evaluation partner recommends extending the observation period considerably'],
  B: ['the committee requested clearer milestones regarding community outreach activities',
    'staffing constraints delayed the procurement process throughout the spring term',
    'independent auditors confirmed the expenditure records without any discrepancies'],
};
function fixture({ extra = '' } = {}) {
  const utterances = []; const cues = [];
  let t = 1000;
  for (let i = 0; i < 3; i++) {
    for (const [speaker, name] of [['A', NAME_A], ['B', NAME_B]]) {
      utterances.push({ speaker, start: t, end: t + 4000, text: `${LINES[speaker][i]}${extra}` });
      cues.push(`${ts(t)} --> ${ts(t + 4000)}\n${name}: ${LINES[speaker][i]}`);
      t += 6000;
    }
  }
  const content = JSON.stringify({ utterances });
  const vtt = `WEBVTT\n\n${cues.join('\n\n')}\n`;
  return { content, vtt };
}

function arrange({ content, vtt }, rowExtra = {}) {
  const row = {
    id: jobId, lease_token: '22222222-2222-4222-8222-222222222222', version: 7,
    output_pathname: 'p/out.json', output_sha256: sha(content),
    zoom_transcript_pathname: 'p/zoom.vtt', zoom_transcript_sha256: sha(vtt), ...rowExtra,
  };
  store.claimTranscriptionJobForAlignment.mockResolvedValue({ job: row, leaseToken: row.lease_token });
  runtime.readPrivateContentIfPresent.mockImplementation(async (pathname) => {
    if (pathname === 'p/out.json') return { buffer: Buffer.from(content) };
    if (pathname === 'p/zoom.vtt') return { buffer: Buffer.from(vtt) };
    return null;
  });
  store.completeTranscriptionAlignment.mockResolvedValue({ id: jobId });
  store.failTranscriptionAlignment.mockResolvedValue({ id: jobId });
  return row;
}
const goodVerdict = {
  A: { name: NAME_A, confidence: 0.95, pairIds: ['A-0', 'A-2'] },
  B: { name: NAME_B, confidence: 0.95, pairIds: ['B-1', 'B-3'] },
};

let warn;
beforeEach(() => {
  jest.resetAllMocks();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

function expectNoLeak(...needles) {
  const logged = JSON.stringify(warn.mock.calls);
  for (const needle of needles) expect(logged).not.toContain(needle);
}

test('happy path applies verified names through the fenced write with content-free, no-persistence options', async () => {
  const row = arrange(fixture());
  executePrompt.mockResolvedValue({ blocked: false, parsed: goodVerdict });
  const deadlineMs = Date.now() + 100_000;
  const result = await alignMeetingTranscriptionSpeakers({ jobId, deadlineMs });
  expect(result.outcome).toBe('applied');
  expect(executePrompt).toHaveBeenCalledWith(expect.objectContaining({
    promptName: 'meeting-transcript.speaker-alignment', requireNoPersistence: true,
    auditRetention: 'content-free', forceOverwrite: true, deadlineMs,
  }));
  const vars = executePrompt.mock.calls[0][0].overrideVariables;
  expect(Object.keys(vars).sort()).toEqual(['prior', 'speaker_samples', 'zoom_names']);
  expect(JSON.parse(vars.zoom_names)).toEqual([NAME_A, NAME_B]);
  expect(JSON.parse(vars.prior)).toEqual(expect.objectContaining({ A: [NAME_A], B: [NAME_B] }));
  expect(store.completeTranscriptionAlignment).toHaveBeenCalledWith(expect.objectContaining({
    jobId, leaseToken: row.lease_token, expectedVersion: 7,
    speakerNames: { A: NAME_A, B: NAME_B },
    alignment: expect.objectContaining({ status: 'applied' }),
  }));
  expect(store.failTranscriptionAlignment).not.toHaveBeenCalled();
});

test('an unclaimable job is not_claimed and nothing is read or called', async () => {
  store.claimTranscriptionJobForAlignment.mockResolvedValue(null);
  expect(await alignMeetingTranscriptionSpeakers({ jobId })).toEqual({ outcome: 'not_claimed' });
  expect(runtime.readPrivateContentIfPresent).not.toHaveBeenCalled();
  expect(executePrompt).not.toHaveBeenCalled();
});

test('zero rows from the fenced write is superseded and does not throw', async () => {
  arrange(fixture());
  executePrompt.mockResolvedValue({ blocked: false, parsed: goodVerdict });
  store.completeTranscriptionAlignment.mockResolvedValue(null);
  expect(await alignMeetingTranscriptionSpeakers({ jobId })).toEqual({ outcome: 'superseded' });
  expect(store.failTranscriptionAlignment).not.toHaveBeenCalled();
});

test.each([
  ['claude_output_schema_invalid', true], ['claude_output_invalid_json', true], ['claude_output_refused', true],
  ['claude_output_incomplete', true], ['claude_context_window_exceeded', true], ['claude_output_truncated', true],
  ['executor_deadline_exhausted', false], ['some_transport_failure', false],
])('executor error %s is classified terminal=%s with an allowlisted code', async (code, terminal) => {
  arrange(fixture());
  executePrompt.mockRejectedValue(Object.assign(new Error(`${SENTINEL} detail`), { code }));
  const result = await alignMeetingTranscriptionSpeakers({ jobId });
  const expectedCode = terminal || code === 'executor_deadline_exhausted' ? code : 'alignment_unavailable';
  expect(store.failTranscriptionAlignment).toHaveBeenCalledWith(expect.objectContaining({
    jobId, expectedVersion: 7, terminal, code: expectedCode,
  }));
  expect(result.outcome).toBe(terminal ? 'failed' : 'retry');
  expect(store.completeTranscriptionAlignment).not.toHaveBeenCalled();
  expectNoLeak(SENTINEL, 'detail');
});

test('a blocked Executor result is a terminal alignment_blocked failure', async () => {
  arrange(fixture());
  executePrompt.mockResolvedValue({ blocked: true, parsed: goodVerdict });
  await alignMeetingTranscriptionSpeakers({ jobId });
  expect(store.failTranscriptionAlignment).toHaveBeenCalledWith(expect.objectContaining({ terminal: true, code: 'alignment_blocked' }));
});

test.each([
  ['transcript', { output_sha256: 'f'.repeat(64) }, 'transcript_hash_mismatch'],
  ['zoom transcript', { zoom_transcript_sha256: 'f'.repeat(64) }, 'zoom_transcript_hash_mismatch'],
])('a %s hash mismatch is terminal and never reaches the model', async (_label, rowExtra, code) => {
  arrange(fixture(), rowExtra);
  await alignMeetingTranscriptionSpeakers({ jobId });
  expect(store.failTranscriptionAlignment).toHaveBeenCalledWith(expect.objectContaining({ terminal: true, code }));
  expect(executePrompt).not.toHaveBeenCalled();
});

test('a missing VTT blob is a terminal zoom_transcript_missing failure', async () => {
  arrange(fixture());
  runtime.readPrivateContentIfPresent.mockImplementation(async (pathname) => (pathname === 'p/out.json'
    ? { buffer: Buffer.from(fixture().content) } : null));
  await alignMeetingTranscriptionSpeakers({ jobId });
  expect(store.failTranscriptionAlignment).toHaveBeenCalledWith(expect.objectContaining({ terminal: true, code: 'zoom_transcript_missing' }));
});

test('no console.warn argument carries transcript text, names, or error messages', async () => {
  const data = fixture({ extra: ` ${SENTINEL}` });
  arrange(data);
  executePrompt.mockRejectedValue(Object.assign(new Error(`${SENTINEL} ${NAME_A}`), { code: 'claude_output_refused' }));
  await alignMeetingTranscriptionSpeakers({ jobId });
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]).toEqual(['[meeting transcription alignment] failed:', 'claude_output_refused']);
  expectNoLeak(SENTINEL, NAME_A, NAME_B, 'budget');
});

test('the prompt receives every pairId and cue name verbatim, within each variable limit', async () => {
  arrange(fixture());
  executePrompt.mockResolvedValue({ blocked: false, parsed: goodVerdict });
  await alignMeetingTranscriptionSpeakers({ jobId });
  const { speaker_samples: samples, zoom_names: names, prior } = executePrompt.mock.calls[0][0].overrideVariables;
  for (const pairId of ['A-0', 'A-2', 'A-4', 'B-1', 'B-3', 'B-5']) expect(samples).toContain(`[${pairId}]`);
  expect(samples).toContain(`cue ${NAME_A}:`);
  expect(samples).toContain(`cue ${NAME_B}:`);
  expect(samples).toContain(LINES.A[0]);
  expect(samples.length).toBeLessThanOrEqual(160000);
  expect(names.length).toBeLessThanOrEqual(20000);
  expect(prior.length).toBeLessThanOrEqual(4000);
});

test('sample serialization is round-robin by speaker rank and renders in original order', () => {
  const sample = (speakerId, n) => ({ pairId: `${speakerId}-${n}`, speakerId, start: n, end: n + 1, text: 'x'.repeat(100),
    cues: [{ name: 'Casey Name', start: 0, end: 1, text: 'y'.repeat(100) }] });
  const samples = [sample('A', 1), sample('A', 2), sample('A', 3), sample('B', 4), sample('C', 5)];
  const full = serializeSpeakerSamples(samples, 100_000);
  expect(full.kept).toHaveLength(5);
  expect(full.droppedSpeaker).toBe(false);
  const one = full.text.split('\n\n')[0].length;
  const cut = serializeSpeakerSamples(samples, one * 3 + 4);
  expect(cut.kept.map(s => s.pairId)).toEqual(['A-1', 'B-4', 'C-5']);
  expect(cut.droppedSpeaker).toBe(false);
  const starved = serializeSpeakerSamples(samples, one * 2 + 2);
  expect(starved.droppedSpeaker).toBe(true);
});

test('eight speakers (seven chatty, one late low-talk) succeed with every speaker keeping at least 4 samples', async () => {
  const utterances = []; const cues = [];
  let t = 1000;
  for (let i = 0; i < 60; i++) {
    for (let sp = 0; sp < 7; sp++) {
      const text = `speaker${sp} utterance ${i} ${'wordy filler content '.repeat(40)}`;
      utterances.push({ speaker: `S${sp}`, start: t, end: t + 4000, text });
      cues.push(`${ts(t)} --> ${ts(t + 4000)}\nPerson ${sp}: ${text}`);
      t += 5000;
    }
  }
  for (let i = 0; i < 4; i++) {
    utterances.push({ speaker: 'LATE', start: t, end: t + 4000, text: `quiet late contribution number ${i} about the evaluation timeline` });
    t += 5000;
  }
  arrange({ content: JSON.stringify({ utterances }), vtt: `WEBVTT\n\n${cues.join('\n\n')}\n` });
  executePrompt.mockResolvedValue({ blocked: false, parsed: {} });
  await alignMeetingTranscriptionSpeakers({ jobId });
  expect(store.failTranscriptionAlignment).not.toHaveBeenCalled();
  const { speaker_samples: text } = executePrompt.mock.calls[0][0].overrideVariables;
  expect(text.length).toBeLessThanOrEqual(160000);
  for (const id of ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'LATE']) {
    expect(text.split(`[${id}-`).length - 1).toBeGreaterThanOrEqual(4);
  }
});

test('a Zoom name list over the prompt budget fails terminally before any model call', async () => {
  const names = Array.from({ length: 300 }, (_, i) => `Participant ${String(i).padStart(2, '0')} ${'N'.repeat(60)}`);
  const utterances = names.map((_, i) => ({ speaker: `S${i % 3}`, start: 1000 + i * 5000, end: 5000 + i * 5000, text: `alpha beta gamma delta epsilon zeta number ${i}` }));
  const cues = names.map((name, i) => `${ts(1000 + i * 5000)} --> ${ts(5000 + i * 5000)}\n${name}: alpha beta gamma delta epsilon zeta number ${i}`);
  arrange({ content: JSON.stringify({ utterances }), vtt: `WEBVTT\n\n${cues.join('\n\n')}\n` });
  await alignMeetingTranscriptionSpeakers({ jobId });
  expect(store.failTranscriptionAlignment).toHaveBeenCalledWith(expect.objectContaining({ terminal: true, code: 'zoom_names_over_budget' }));
  expect(executePrompt).not.toHaveBeenCalled();
});

test.each(['claude_output_missing_field', 'claude_output_empty', 'content_too_large'])('%s is terminal', async (code) => {
  arrange(fixture());
  executePrompt.mockRejectedValue(Object.assign(new Error('x'), { code }));
  await alignMeetingTranscriptionSpeakers({ jobId });
  expect(store.failTranscriptionAlignment).toHaveBeenCalledWith(expect.objectContaining({ terminal: true, code }));
});

test('the Executor deadline is capped inside the 180 s lease even when recovery offers 240 s', async () => {
  arrange(fixture());
  store.expireExhaustedTranscriptionAlignments.mockResolvedValue([]);
  store.claimNextPendingTranscriptionAlignmentJob.mockResolvedValue([jobId]);
  executePrompt.mockResolvedValue({ blocked: false, parsed: goodVerdict });
  const now = Date.now();
  await recoverPendingAlignments({ limit: 5, deadlineMs: now + 240_000 });
  expect(executePrompt.mock.calls[0][0].deadlineMs).toBeLessThanOrEqual(Date.now() + 150_000);
});

test('the five alignment functions the service imports exist on the REAL store module', () => {
  const real = jest.requireActual('../../lib/services/transcription-pilot/store.js');
  for (const name of ['claimTranscriptionJobForAlignment', 'completeTranscriptionAlignment', 'failTranscriptionAlignment',
    'claimNextPendingTranscriptionAlignmentJob', 'expireExhaustedTranscriptionAlignments']) {
    expect(typeof real[name]).toBe('function');
  }
});

test('recoverPendingAlignments expires exhausted jobs first, then claims and aligns each id', async () => {
  const order = [];
  store.expireExhaustedTranscriptionAlignments.mockImplementation(async () => { order.push('expire'); return [{ id: 'x' }]; });
  store.claimNextPendingTranscriptionAlignmentJob.mockImplementation(async () => { order.push('scan'); return ['j1', 'j2']; });
  store.claimTranscriptionJobForAlignment.mockImplementation(async ({ jobId: id }) => { order.push(`claim:${id}`); return null; });
  const counts = await recoverPendingAlignments({ limit: 5, deadlineMs: Date.now() + 200_000 });
  expect(order).toEqual(['expire', 'scan', 'claim:j1', 'claim:j2']);
  expect(store.expireExhaustedTranscriptionAlignments).toHaveBeenCalledWith({ limit: 5 });
  expect(store.claimNextPendingTranscriptionAlignmentJob).toHaveBeenCalledWith({ limit: 5 });
  expect(counts).toEqual({ expired: 1, attempted: 2, outcomes: { not_claimed: 2 } });
});

test('recoverPendingAlignments stops claiming when the remaining budget is too small', async () => {
  store.expireExhaustedTranscriptionAlignments.mockResolvedValue([]);
  store.claimNextPendingTranscriptionAlignmentJob.mockResolvedValue(['j1']);
  const counts = await recoverPendingAlignments({ limit: 5, deadlineMs: Date.now() + 1_000 });
  expect(store.claimTranscriptionJobForAlignment).not.toHaveBeenCalled();
  expect(counts.attempted).toBe(0);
});
