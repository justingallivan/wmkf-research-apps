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

// ---- Reserved-sample loss and full-set conflict detection (Codex adversarial review) ----
function genFixture({ per = 4, textWords = 12, cuesPerSample = 2, contrary = false, fillerNameLen = 60, fillerPad = 0, mute = null, contraryCount = 1 }) {
  const names = Array.from({ length: 8 }, (_, s) => `Speaker Person ${s}`);
  const utterances = []; const cues = []; const verdict = {};
  for (let s = 0; s < 8; s++) {
    for (let i = 0; i < per; i++) {
      const t0 = (s * per + i) * 60_000;
      const text = Array.from({ length: textWords }, (_, k) => `term${s}x${i}x${k}`).join(' ');
      const index = utterances.length;
      utterances.push({ speaker: `S${s}`, start: t0, end: t0 + 4000, text });
      const cueName = contrary && i >= per - contraryCount ? names[(s + 1) % 8] : names[s];
      // A muted cue keeps its name and byte length but no longer matches the utterance wording.
      const cueText = mute && mute(s, index) ? text.replace(/term/g, 'zzzz') : text;
      cues.push(`${ts(t0)} --> ${ts(t0 + 4000)}\n${cueName}: ${cueText}`);
      for (let k = 0; k < cuesPerSample - 1; k++) {
        cues.push(`${ts(t0 + 5000 + k * 400)} --> ${ts(t0 + 5300 + k * 400)}\nFiller ${k} ${'F'.repeat(fillerNameLen)}: noise${s}x${i}x${k} unrelated${'.'.repeat(fillerPad)}`);
      }
      (verdict[`S${s}`] ||= { name: names[s], confidence: 0.99, pairIds: [] }).pairIds.push(`S${s}-${index}`);
    }
  }
  return { content: JSON.stringify({ utterances }), vtt: `WEBVTT\n\n${cues.join('\n\n')}\n`, verdict, names };
}

test('(a) 8 speakers x 4 reserved, 25 long-name cues per sample, contrary fourth sample: never applies names; terminal when a reserved sample cannot be kept', async () => {
  const { content, vtt, verdict } = genFixture({ textWords: 200, cuesPerSample: 25, contrary: true, fillerNameLen: 70, fillerPad: 90 });
  arrange({ content, vtt });
  executePrompt.mockResolvedValue({ blocked: false, parsed: verdict });
  await alignMeetingTranscriptionSpeakers({ jobId });
  expect(store.completeTranscriptionAlignment).not.toHaveBeenCalled();
  expect(executePrompt).not.toHaveBeenCalled();
  expect(store.failTranscriptionAlignment).toHaveBeenCalledWith(expect.objectContaining({ terminal: true, code: 'samples_over_budget' }));
});

test('(a2) when every reserved sample is kept, 3:1 contrary names abstain with both suggestions even at confidence 0.99', async () => {
  const { content, vtt, verdict, names } = genFixture({ contrary: true });
  arrange({ content, vtt });
  executePrompt.mockResolvedValue({ blocked: false, parsed: verdict });
  await alignMeetingTranscriptionSpeakers({ jobId });
  const { speakerNames, alignment } = store.completeTranscriptionAlignment.mock.calls[0][0];
  expect(speakerNames).toEqual({});
  expect(alignment.status).toBe('abstained');
  expect(alignment.suggestions.S0).toEqual(expect.arrayContaining([names[0], names[1]]));
});

test('(b) control: same fixture without contrary names applies all eight names', async () => {
  const { content, vtt, verdict, names } = genFixture({ contrary: false });
  arrange({ content, vtt });
  executePrompt.mockResolvedValue({ blocked: false, parsed: verdict });
  await alignMeetingTranscriptionSpeakers({ jobId });
  const { speakerNames } = store.completeTranscriptionAlignment.mock.calls[0][0];
  expect(speakerNames).toEqual(Object.fromEntries(names.map((name, s) => [`S${s}`, name])));
});

test('(c) only extras drop: the run proceeds and every speaker keeps its reserved samples', async () => {
  const { content, vtt, verdict } = genFixture({ per: 10, textWords: 190, cuesPerSample: 15, fillerNameLen: 70 });
  arrange({ content, vtt });
  executePrompt.mockResolvedValue({ blocked: false, parsed: verdict });
  await alignMeetingTranscriptionSpeakers({ jobId });
  expect(store.failTranscriptionAlignment).not.toHaveBeenCalled();
  const text = executePrompt.mock.calls[0][0].overrideVariables.speaker_samples;
  const shown = text.match(/^\[S\d+-\d+\]/gm);
  expect(text.length).toBeLessThanOrEqual(160000);
  expect(shown.length).toBeLessThan(80);
  for (let s = 0; s < 8; s++) expect(shown.filter(id => id.startsWith(`[S${s}-`)).length).toBeGreaterThanOrEqual(4);
});

test.each([['null', null], ['an array', []], ['a non-object entry', { S0: 'x' }]])('a malformed verdict (%s) does not throw; verified names apply on the support basis', async (_label, parsed) => {
  // The model is a veto, not a gate (2026-10-04): a useless verdict cannot withhold verified names.
  arrange(fixture());
  executePrompt.mockResolvedValue({ blocked: false, parsed });
  await alignMeetingTranscriptionSpeakers({ jobId });
  const { speakerNames, alignment } = store.completeTranscriptionAlignment.mock.calls[0][0];
  expect(Object.keys(speakerNames).length).toBeGreaterThan(0);
  expect(Object.values(alignment.speakers).every(v => v.basis === 'support')).toBe(true);
});

const EXTRA_FIXTURE = { per: 6, textWords: 70, cuesPerSample: 25, contrary: true, fillerNameLen: 70 };
const shownIds = text => (text.match(/^\[S\d+-\d+\]/gm) || []).map(id => id.slice(1, -1));

test('contrary evidence on a dropped EXTRA sample still forces abstention (support is computed on the full sampled set)', async () => {
  // Two contrary samples of six (4:2) stay a conflict under dominanceRatio 0.2; one of six (5:1) would not.
  const { content, vtt, verdict, names } = genFixture({ ...EXTRA_FIXTURE, contraryCount: 2 });
  arrange({ content, vtt });
  executePrompt.mockResolvedValue({ blocked: false, parsed: verdict });
  await alignMeetingTranscriptionSpeakers({ jobId });
  expect(store.failTranscriptionAlignment).not.toHaveBeenCalled();
  const shown = shownIds(executePrompt.mock.calls[0][0].overrideVariables.speaker_samples);
  const contraryIds = Object.values(verdict).map(v => v.pairIds.at(-1));
  expect(shown.length).toBeLessThan(48);
  expect(contraryIds.some(id => !shown.includes(id))).toBe(true);
  const { speakerNames, alignment } = store.completeTranscriptionAlignment.mock.calls[0][0];
  const droppedSpeakers = Object.entries(verdict).filter(([, v]) => !shown.includes(v.pairIds.at(-1))).map(([id]) => id);
  for (const id of droppedSpeakers) {
    expect(speakerNames).not.toHaveProperty(id);
    const index = Number(id.slice(1));
    expect(alignment.suggestions[id]).toEqual(expect.arrayContaining([names[index], names[(index + 1) % 8]]));
  }
});

test('a verdict citing a real but unshown pair loses the model basis; the verified name still applies on support', async () => {
  const { content, vtt, verdict, names } = genFixture({ ...EXTRA_FIXTURE, contrary: false });
  arrange({ content, vtt });
  executePrompt.mockImplementation(async ({ overrideVariables }) => {
    const shown = shownIds(overrideVariables.speaker_samples);
    const hidden = Object.values(verdict).flatMap(v => v.pairIds).filter(id => !shown.includes(id));
    expect(hidden.length).toBeGreaterThan(0);
    const speaker = hidden[0].split('-')[0];
    const seenOnly = Object.fromEntries(Object.entries(verdict).map(([id, v]) => [id, { ...v, pairIds: v.pairIds.filter(pid => shown.includes(pid)) }]));
    seenOnly[speaker] = { ...seenOnly[speaker], pairIds: [...seenOnly[speaker].pairIds, hidden[0]] };
    return { blocked: false, parsed: seenOnly };
  });
  await alignMeetingTranscriptionSpeakers({ jobId });
  const { speakerNames, alignment } = store.completeTranscriptionAlignment.mock.calls[0][0];
  // The unseen citation neutralises the model's verdict for that speaker; verified support still
  // applies the name, but on the support basis rather than the model's 0.99.
  expect(Object.keys(speakerNames)).toHaveLength(8);
  const supportBased = Object.entries(alignment.speakers).filter(([, v]) => v.basis === 'support').map(([id]) => id);
  expect(supportBased).toHaveLength(1);
  expect(speakerNames[supportBased[0]]).toBe(names[Number(supportBased[0].slice(1))]);
  expect(Object.entries(alignment.speakers).filter(([, v]) => v.basis === 'model')).toHaveLength(7);
});

test('Codex round 2: a speaker whose ONLY name support sits on trimmed samples is not applied on an empty-citation 0.99 verdict', async () => {
  // Pass 1 (control) learns which pair ids the serializer trims; pass 2 mutes the wording of the target
  // speaker's VISIBLE cues (same name, same byte length, so sampling is identical), leaving its only
  // matching cues on trimmed samples.
  const control = genFixture({ ...EXTRA_FIXTURE, contrary: false });
  arrange(control);
  executePrompt.mockResolvedValue({ blocked: false, parsed: control.verdict });
  await alignMeetingTranscriptionSpeakers({ jobId });
  const shown = new Set(shownIds(executePrompt.mock.calls[0][0].overrideVariables.speaker_samples));
  const hiddenBySpeaker = new Map();
  for (const [id, v] of Object.entries(control.verdict)) hiddenBySpeaker.set(id, v.pairIds.filter(pid => !shown.has(pid)));
  const target = [...hiddenBySpeaker.entries()].find(([, hidden]) => hidden.length >= 2)?.[0];
  expect(target).toBeDefined();
  const hidden = new Set(hiddenBySpeaker.get(target));
  jest.clearAllMocks();

  const fixture2 = genFixture({ ...EXTRA_FIXTURE, contrary: false, mute: (s, index) => `S${s}` === target && !hidden.has(`S${s}-${index}`) });
  arrange(fixture2);
  const verdict = Object.fromEntries(Object.entries(fixture2.verdict).map(([id, v]) => [id,
    id === target ? { name: v.name, confidence: 0.99, pairIds: [] } : { ...v, pairIds: v.pairIds.filter(pid => shown.has(pid)) }]));
  executePrompt.mockResolvedValue({ blocked: false, parsed: verdict });
  await alignMeetingTranscriptionSpeakers({ jobId });
  expect(store.failTranscriptionAlignment).not.toHaveBeenCalled();
  expect(new Set(shownIds(executePrompt.mock.calls[0][0].overrideVariables.speaker_samples))).toEqual(shown);
  const { speakerNames, alignment } = store.completeTranscriptionAlignment.mock.calls[0][0];
  expect(speakerNames).not.toHaveProperty(target);
  expect(alignment.suggestions[target]).toBeUndefined();
  expect(Object.keys(speakerNames)).toHaveLength(7);
});

// ---- Codex round 3: wording past the rendered 1,500-char slice is not visible evidence ----
function tailFixture({ matchAtStart = false } = {}) {
  const names = ['Speaker Person 0', 'Speaker Person 1'];
  const utterances = []; const cues = []; const verdict = {};
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < 4; i++) {
      const t0 = (s * 4 + i) * 120_000;
      const words = Array.from({ length: 9 }, (_, k) => `term${s}x${i}x${k}`);
      const noise = Array.from({ length: 130 }, (_, k) => `noise${s}x${i}x${k}pad`).join(' ');
      const text = matchAtStart ? `${words.join(' ')} ${noise}` : `${noise} ${words.join(' ')}`;
      const index = utterances.length;
      utterances.push({ speaker: `S${s}`, start: t0, end: t0 + 60_000, text });
      cues.push(`${ts(t0 + 50_000)} --> ${ts(t0 + 58_000)}\n${names[s]}: ${words.join(' ')}`);
      (verdict[`S${s}`] ||= { name: names[s], confidence: 0.99, pairIds: [] }).pairIds.push(`S${s}-${index}`);
    }
  }
  return { content: JSON.stringify({ utterances }), vtt: `WEBVTT\n\n${cues.join('\n\n')}\n`, verdict, names };
}

test('Codex rounds 3-4: cues matching only wording past the rendered slice do not apply a name even with visible citations at 0.99', async () => {
  const { content, vtt, verdict } = tailFixture();
  arrange({ content, vtt });
  executePrompt.mockResolvedValue({ blocked: false, parsed: verdict });
  await alignMeetingTranscriptionSpeakers({ jobId });
  expect(store.failTranscriptionAlignment).not.toHaveBeenCalled();
  const text = executePrompt.mock.calls[0][0].overrideVariables.speaker_samples;
  expect(text).toMatch(/^ {2}cue Speaker Person 0: term0x0x0 /m); // the cue IS shown
  expect(text).not.toMatch(/^\[S0-0\] speaker S0: [^\n]*term0x0x8/m); // the matching utterance tail is NOT
  const { speakerNames, alignment } = store.completeTranscriptionAlignment.mock.calls[0][0];
  expect(speakerNames).toEqual({});
  expect(alignment.status).toBe('abstained');
});

test('control: the same cues matching wording inside the slice apply both names', async () => {
  const { content, vtt, verdict, names } = tailFixture({ matchAtStart: true });
  arrange({ content, vtt });
  executePrompt.mockResolvedValue({ blocked: false, parsed: verdict });
  await alignMeetingTranscriptionSpeakers({ jobId });
  const { speakerNames, alignment } = store.completeTranscriptionAlignment.mock.calls[0][0];
  expect(speakerNames).toEqual({ S0: names[0], S1: names[1] });
  expect(alignment.status).toBe('applied');
});

test('records Zoom-evidence reassignment of a misdiarized one-word utterance alongside the applied names', async () => {
  // "Right." at 3.0-3.4 s is labelled B by the diarizer but sits inside A's caption between A's words.
  const { content, vtt } = fixture();
  const parsed = JSON.parse(content);
  parsed.utterances.splice(1, 0, { speaker: 'B', start: 3000, end: 3400, text: 'Right.' });
  arrange({ content: JSON.stringify(parsed), vtt });
  executePrompt.mockResolvedValue({ blocked: false, parsed: {} });
  await alignMeetingTranscriptionSpeakers({ jobId });
  const { speakerNames, alignment } = store.completeTranscriptionAlignment.mock.calls[0][0];
  expect(speakerNames).toEqual({ A: NAME_A, B: NAME_B });
  expect(alignment.reassigned).toEqual({ 1: 'A' });
  expect(alignment.reassignedCount).toBe(1);
});
