jest.mock('../../lib/services/execute-prompt.js', () => ({ executePrompt: jest.fn() }));
import { executePrompt } from '../../lib/services/execute-prompt.js';
import { reviewSentenceFragments } from '../../lib/services/meeting-tracker-transcription/fragment-review';
import { collectFragmentCandidates } from '../../shared/utils/transcript-fragment-review';
import { projectOwnerTranscriptionJob } from '../../lib/services/transcription-pilot/model';
import { PROMPT_VARIABLES, PROMPT_OUTPUT_SCHEMA } from '../../shared/config/prompts/meeting-fragment-review';
import { validateAiJson } from '../../lib/utils/ai-output-schema';

const names = { A: 'Alex Example', B: 'Casey Example' };
const fixture = (middle = 'was') => ({ text: `I ${middle} ready to test`, utterances: [
  { speaker: 'A', start: 1000, end: 1500, text: 'I', words: [{ text: 'I', start: 1000, end: 1500 }] },
  { speaker: 'B', start: 1500, end: 1800, text: middle },
  { speaker: 'A', start: 1800, end: 4000, text: 'ready to test the prototype after lunch.' },
] });
const verdict = () => ({ names, alignment: { status: 'applied', speakers: {
  A: { name: names.A }, B: { name: names.B },
}, reassigned: {}, reassignedCount: 0 } });
const result = classification => ({ parsed: { 1: { classification, reason: 'The middle word completes the surrounding clause.' } } });
const run = (content = fixture(), v = verdict(), deadline = Date.now() + 60000) => reviewSentenceFragments(content, v, deadline);
beforeEach(() => jest.resetAllMocks());

test('Synthetic fixture: warns without changing any words, timestamps, names, overlays or source objects', async () => {
  const content = fixture(); const v = verdict(); const before = JSON.stringify({ content, v });
  executePrompt.mockResolvedValue(result('sentence_fragment'));
  const out = await run(content, v);
  expect(out.alignment.fragmentReview.warnings).toEqual([{ index: 1, speakerId: 'A', reason: expect.any(String) }]);
  expect(JSON.stringify({ content, v })).toBe(before);
  const { fragmentReview, ...alignment } = out.alignment;
  expect(alignment).toEqual(v.alignment); expect(out.names).toEqual(v.names);
  expect(executePrompt).toHaveBeenCalledTimes(1);
  expect(executePrompt).toHaveBeenCalledWith(expect.objectContaining({
    promptName: 'meeting-transcript.fragment-review', requireNoPersistence: true, auditRetention: 'content-free', maxTokensOverride: 2048,
  }));
  expect(executePrompt.mock.calls[0][0].deadlineMs).toBeLessThanOrEqual(Date.now() + 20000);
});

test.each(['yes', 'no'])('a real %s reply is reviewed but not flagged; integrated use can be flagged', async word => {
  const content = fixture(word); content.utterances[0].text = 'Do you agree?'; content.utterances[2].text = 'Thank you for explaining.';
  executePrompt.mockResolvedValue(result('interjection'));
  expect((await run(content)).alignment.fragmentReview.warnings).toEqual([]);
  expect(JSON.parse(executePrompt.mock.calls[0][0].overrideVariables.passages)[0].middle).toBe(word);
  executePrompt.mockResolvedValue(result('sentence_fragment'));
  expect((await run(fixture(word))).alignment.fragmentReview.warnings).toHaveLength(1);
});

test('uncertain context produces no warning', async () => {
  executePrompt.mockResolvedValue(result('uncertain'));
  expect((await run()).alignment.fragmentReview.warnings).toEqual([]);
});

test.each(['overlap', 'gap', 'long', 'multiword', 'unknown', 'notABA', 'badTime'])('%s is excluded before calling AI', async kind => {
  const content = fixture(); const v = verdict();
  if (kind === 'overlap') content.utterances[1].start = 1400;
  if (kind === 'gap') content.utterances[2].start = 3000;
  if (kind === 'long') content.utterances[1].end = 3800;
  if (kind === 'multiword') content.utterances[1].text = 'yes indeed';
  if (kind === 'unknown') v.alignment.speakers.A.name = null;
  if (kind === 'notABA') content.utterances[2].speaker = 'C';
  if (kind === 'badTime') content.utterances[1].start = NaN;
  expect((await run(content, v)).alignment.fragmentReview.warnings).toEqual([]);
  expect(executePrompt).not.toHaveBeenCalled();
});

test('a known presentation split excludes the triplet', () => {
  expect(collectFragmentCandidates(fixture(), names, 1800).candidates).toEqual([]);
  expect(collectFragmentCandidates(fixture(), names, 4000).candidates).toHaveLength(1);
});

test('uses the final overlay, so a previously repaired middle word is not checked', async () => {
  const v = verdict(); v.alignment.reassigned = { 1: 'A' };
  await run(fixture(), v); expect(executePrompt).not.toHaveBeenCalled();
});

test('caps at ten candidates in one call and bounds context size', async () => {
  const content = { utterances: Array.from({ length: 12 }, (_, i) => fixture().utterances.map(u => ({ ...u,
    start: u.start + i * 10000, end: u.end + i * 10000,
    text: u.speaker === 'A' ? 'context '.repeat(100) : u.text }))).flat() };
  executePrompt.mockImplementation(async ({ overrideVariables }) => ({ parsed: Object.fromEntries(
    JSON.parse(overrideVariables.passages).map(c => [c.id, { classification: 'uncertain', reason: 'Ambiguous.' }])) }));
  const out = await run(content);
  expect(out.alignment.fragmentReview.limited).toBe(true);
  expect(executePrompt).toHaveBeenCalledTimes(1);
  const passages = JSON.parse(executePrompt.mock.calls[0][0].overrideVariables.passages);
  expect(passages).toHaveLength(10); expect(passages[0].before.split(' ')).toHaveLength(40);
});

test.each([null, {}, { parsed: {} }, { blocked: true }, { parsed: { 999: { classification: 'sentence_fragment', reason: 'Invented ID' } } },
  { parsed: { 1: { classification: 'other', reason: 'Invalid' } } },
  { parsed: { 1: { classification: 'sentence_fragment', reason: 'x'.repeat(241) } } },
])('malformed, missing, unknown or blocked verdict is advisory failure %#', async response => {
  executePrompt.mockResolvedValue(response);
  expect((await run()).alignment.fragmentReview).toMatchObject({ status: 'unavailable', warnings: [] });
});

test('timeout is contained without logging private errors; exhausted budget makes no call', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  executePrompt.mockRejectedValue(new Error('PRIVATE timeout'));
  expect((await run()).alignment.fragmentReview.status).toBe('unavailable');
  expect(warn).not.toHaveBeenCalled(); warn.mockRestore();
  executePrompt.mockClear();
  expect((await run(fixture(), verdict(), Date.now() + 3000)).alignment.fragmentReview.status).toBe('skipped');
  expect(executePrompt).not.toHaveBeenCalled();
});

test('optional results cannot overflow the alignment row', async () => {
  const v = verdict(); v.alignment.padding = 'x'.repeat(65300);
  executePrompt.mockResolvedValue(result('sentence_fragment'));
  expect(await run(fixture(), v)).toBe(v);
});

test('projection exposes only bounded references and inherits purge/expiry suppression', () => {
  const review = { status: 'complete', warnings: [{ index: 1, speakerId: 'A', reason: 'Review continuity.', text: 'SECRET' }], raw: 'SECRET' };
  const row = { status: 'ready', speaker_alignment: { status: 'applied', fragmentReview: review } };
  expect(projectOwnerTranscriptionJob(row).speaker_alignment.fragmentReview.warnings).toEqual([{ index: 1, speakerId: 'A', reason: 'Review continuity.' }]);
  expect(JSON.stringify(projectOwnerTranscriptionJob(row))).not.toContain('SECRET');
  expect(projectOwnerTranscriptionJob({ ...row, cleanup_requested_at: new Date() }).speaker_alignment).toBeNull();
  expect(projectOwnerTranscriptionJob({ ...row, expires_at: new Date(0) }).speaker_alignment).toBeNull();
});

test('prompt declarations enforce untrusted inputs and bounded nonpersistent outputs', () => {
  expect(PROMPT_VARIABLES.variables[0]).toMatchObject({ untrusted: true, dataClass: 'meeting_transcript', maxChars: 40000 });
  expect(PROMPT_OUTPUT_SCHEMA).toMatchObject({ rawOutputRetention: 'none', outputs: [{ target: { kind: 'none' } }] });
  expect(validateAiJson(result('sentence_fragment').parsed, PROMPT_OUTPUT_SCHEMA.validationSchema).ok).toBe(true);
  expect(validateAiJson({ 1: { classification: 'bogus', reason: 'No' } }, PROMPT_OUTPUT_SCHEMA.validationSchema).ok).toBe(false);
});
