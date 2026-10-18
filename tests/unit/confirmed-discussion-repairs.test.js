/** @jest-environment node */
import { applyDiscussionRepairPlan, applyConfirmedDiscussionRepair } from '../../lib/services/meeting-tracker-transcription/confirmed-discussion-repairs';
import { buildMeetingTranscriptFiles, parseVerifiedMeetingTranscriptSource } from '../../lib/services/meeting-tracker-transcription/bundle';
import { formatTranscriptText } from '../../lib/services/transcription-pilot/transcript-format';

const plan = { endMs: 100, excluded: ['P'], turns: [
  { index: 1, from: 'P', to: 'J', firstWords: 2 }, { index: 3, from: 'J', to: 'B' },
] };
function fixture() {
  return { text: 'Original transcript.', utterances: [
    { speaker: 'P', start: 0, end: 100, text: 'Presentation.' },
    { speaker: 'P', start: 110, end: 140, text: 'Confirmed sentence. Other voice.', words: [
      { start: 110, end: 115, text: 'Confirmed' }, { start: 115, end: 120, text: 'sentence.' },
      { start: 120, end: 130, text: 'Other' }, { start: 130, end: 140, text: 'voice.' },
    ] },
    { speaker: 'B', start: 150, end: 151, text: 'I' },
    { speaker: 'J', start: 151, end: 152, text: 'was' },
    { speaker: 'B', start: 152, end: 160, text: 'impressed.' },
    { speaker: 'P', start: 170, end: 180, text: 'Uncertain speech.' },
  ] };
}
const names = { P: 'Presenter', J: 'Justin', B: 'Beth', repair_unknown_1: 'Unidentified speaker', repair_unknown_5: 'Unidentified speaker' };

test('repairs only the confirmed fragment, joins Beth naturally, and preserves presentation, words and input', () => {
  const source = fixture();
  const before = JSON.stringify(source);
  const fixed = applyDiscussionRepairPlan(source, plan);
  expect(JSON.stringify(source)).toBe(before);
  expect(fixed.utterances[0]).toBe(source.utterances[0]);
  expect(fixed.utterances.flatMap(row => row.words || [])).toEqual(source.utterances.flatMap(row => row.words || []));
  expect(fixed.utterances.map(row => row.text).join(' ')).toBe(source.utterances.map(row => row.text).join(' '));
  expect(fixed.utterances.slice(1, 3).map(({ speaker, start, end }) => ({ speaker, start, end }))).toEqual([
    { speaker: 'J', start: 110, end: 120 }, { speaker: 'repair_unknown_1', start: 120, end: 140 },
  ]);
  const text = formatTranscriptText({ utterances: fixed.utterances.slice(1) }, names);
  expect(text).toContain('Beth: I was impressed.');
  expect(text).toContain('Justin: Confirmed sentence.');
  expect(text).toContain('Unidentified speaker: Other voice.');
  expect(text).not.toContain('Presenter:');
});

test('repaired names and split word timings survive bundle publication and reread', () => {
  const identity = { requestId: '11111111-1111-4111-8111-111111111111', siteVisitActivityId: '22222222-2222-4222-8222-222222222222',
    revisionId: '33333333-3333-4333-8333-333333333333', operationId: '33333333-3333-4333-8333-333333333333',
    presentationEnd: { endMs: 100, confirmedBy: 17, confirmedAt: '2026-10-18T00:00:00.000Z' }, sourceProvenance: null,
    discussionAttribution: null };
  const content = applyDiscussionRepairPlan(fixture(), plan);
  const built = buildMeetingTranscriptFiles({ content, speakerNames: names, identity });
  const file = built.files.source;
  const reread = parseVerifiedMeetingTranscriptSource(file.bytes, { size: file.bytes.length, sha256: file.sha256 }, identity);
  expect(reread.content).toEqual(content);
  expect(reread.speakerNames).toEqual(names);
  expect(built.files.txt.bytes.toString()).toContain('Beth: I was impressed.');
});

test.each(['wrong-speaker', 'presentation', 'no-words', 'bad-split', 'text-mismatch', 'overlap'])('fails closed on %s', kind => {
  const source = fixture();
  if (kind === 'wrong-speaker') source.utterances[1].speaker = 'B';
  if (kind === 'presentation') source.utterances[1].start = 99;
  if (kind === 'no-words') delete source.utterances[1].words;
  if (kind === 'bad-split') source.utterances[1].words = source.utterances[1].words.slice(0, 2);
  if (kind === 'text-mismatch') source.utterances[1].text = 'Different words.';
  if (kind === 'overlap') source.utterances[1].words[2].start = 119;
  expect(() => applyDiscussionRepairPlan(source, plan)).toThrow('does not match');
});

test('unlisted requests and later revisions are untouched, and a listed revision rejects changed bytes', () => {
  const args = { requestId: '8a0efbb3-8d45-f111-88b4-000d3a306da2', revisionId: 'a1b794c3-a2d4-49f3-bb4a-8d8e5b1b926a',
    sourceBytes: Buffer.from('changed'), source: { content: fixture(), presentationEnd: { endMs: 3456916 } } };
  expect(() => applyConfirmedDiscussionRepair(args)).toThrow('does not match');
  expect(applyConfirmedDiscussionRepair({ ...args, revisionId: 'later' }).content).toBe(args.source.content);
  expect(applyConfirmedDiscussionRepair({ ...args, requestId: 'other' }).repairId).toBeNull();
});
