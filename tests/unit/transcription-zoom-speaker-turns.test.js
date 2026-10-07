import { reconcileZoomSpeakerTurns } from '../../lib/services/transcription-pilot/zoom-vtt';
import { applySpeakerReassignments, formatTranscriptVtt } from '../../lib/services/transcription-pilot/transcript-format';
import { buildMeetingTranscriptFiles } from '../../lib/services/meeting-tracker-transcription/bundle';

// Synthetic reproduction of a late arrival spread across two earlier participants' audio IDs.
// Invariants: local evidence beats a global name; uncertain turns abstain; content stays identical;
// the persisted overlay reconstructs the same identities in preview, downloads and publication.
function fixture() {
  const rows = [
    ['A', 'Presenter', 'Our laboratory studies unusual patterns in magnetic materials.'],
    ['C', 'Collaborator', 'We prepare the samples using established chemical synthesis methods.'],
    ['A', 'Presenter', 'The next experiment will measure electronic transport across layers.'],
    ['C', 'Collaborator', 'Different ligands should change the resulting crystal structure considerably.'],
    ['A', 'Late arrival', 'I think I can leave this conference call right now.'],
    ['C', 'Late arrival', 'Wow.'],
    ['A', 'Late arrival', 'I am returning to our investment discussion for today.'],
    ['A', null, 'This unmatched sentence must not inherit either person.'],
  ];
  const utterances = rows.map(([speaker, , text], index) => ({ speaker, text, start: index * 10000, end: index * 10000 + 4000 }));
  const cues = rows.flatMap(([, name, text], index) => name ? [{ name, text, start: utterances[index].start, end: utterances[index].end }] : []);
  const verdict = { names: { A: 'Presenter', C: 'Collaborator' }, alignment: {
    status: 'applied', speakers: { A: { name: 'Presenter', confidence: 0.95 }, C: { name: 'Collaborator', confidence: 0.95 } },
    reasons: {}, suggestions: {}, reassigned: {}, reassignedCount: 0,
  } };
  return { content: { text: rows.map(row => row[2]).join(' '), utterances }, cues, verdict };
}

function run(f = fixture(), options) {
  const result = reconcileZoomSpeakerTurns(f.content, f.cues, f.verdict, options);
  const content = applySpeakerReassignments(f.content, result.alignment.reassigned, result.alignment.additionalSpeakerIds);
  return { ...result, content, labels: content.utterances.map(row => result.names[row.speaker] ?? null) };
}

test('splits reused IDs, unifies the late arrival, preserves earlier speakers and abstains on unresolved turns', () => {
  const f = fixture();
  const before = JSON.stringify(f);
  const result = run(f);
  expect(result.labels).toEqual(['Presenter', 'Collaborator', 'Presenter', 'Collaborator', 'Late arrival', 'Late arrival', 'Late arrival', null]);
  expect(result.content.utterances[4].speaker).toBe(result.content.utterances[5].speaker);
  expect(result.alignment.status).toBe('partial');
  expect(result.alignment.reasons).toMatchObject({ A: 'mixed_speakers', C: 'mixed_speakers' });
  expect(JSON.stringify(f)).toBe(before);
  expect(result.content.utterances.map(({ speaker: _speaker, ...row }) => row)).toEqual(f.content.utterances.map(({ speaker: _speaker, ...row }) => row));
  expect(result.content.text).toBe(f.content.text);
});

test('a recording with one supported identity per ID keeps the existing result', () => {
  const f = fixture();
  f.content.utterances = f.content.utterances.slice(0, 4);
  f.cues = f.cues.slice(0, 4);
  expect(reconcileZoomSpeakerTurns(f.content, f.cues, f.verdict)).toBe(f.verdict);
});

test.each(['unrelated wording', 'shifted timing', 'concurrent captions', 'uncaptioned words', 'internal silence'])('%s cannot name the late arrival', mode => {
  const f = fixture();
  const late = f.cues.filter(cue => cue.name === 'Late arrival');
  if (mode === 'unrelated wording') late.forEach(cue => { cue.text = 'A completely unrelated subject with different words entirely.'; });
  if (mode === 'shifted timing') late.forEach(cue => { cue.start += 100000; cue.end += 100000; });
  if (mode === 'concurrent captions') late.forEach(cue => { f.cues.push({ ...cue, name: 'Other person' }); });
  if (mode === 'uncaptioned words') late.forEach(cue => { cue.text = 'Yes.'; });
  if (mode === 'internal silence') late.forEach(cue => { const end = cue.end; cue.end = cue.start + 500; f.cues.push({ ...cue, start: end - 500, end }); });
  expect(Object.values(run(f).names)).not.toContain('Late arrival');
});

test('an overlapping short interjection does not split the listener just because its word occurs in another caption', () => {
  const f = fixture();
  f.content.utterances = f.content.utterances.slice(0, 4);
  f.cues = f.cues.slice(0, 4);
  f.cues[0].text += ' right';
  f.content.utterances.push({ speaker: 'C', text: 'Right.', start: 1000, end: 1500 });
  expect(reconcileZoomSpeakerTurns(f.content, f.cues, f.verdict)).toBe(f.verdict);
});

test('a later echoed phrase cannot borrow words from an earlier long caption', () => {
  const f = fixture();
  f.content.utterances = f.content.utterances.slice(0, 4);
  f.cues = f.cues.slice(0, 4);
  f.cues.push({ name: 'Presenter', start: 40000, end: 50000, text: 'I agree with you about the planned experimental approach.' });
  f.content.utterances.push({ speaker: 'A', start: 40000, end: 46000, text: 'I agree with you about the planned experimental approach.' },
    { speaker: 'C', start: 47000, end: 48000, text: 'I agree with you.' });
  expect(reconcileZoomSpeakerTurns(f.content, f.cues, f.verdict)).toBe(f.verdict);
});

test('neighboring caption timing spillover does not override exclusive wording evidence', () => {
  const f = fixture();
  f.cues.push({ name: 'Other person', start: 39500, end: 40450, text: 'Twelve minutes.' });
  f.cues[4].start = 40450;
  const result = run(f);
  expect(result.labels[4]).toBe('Late arrival');
  expect(result.labels[5]).toBe('Late arrival');
});

test('two sequential substantive echoes cannot consume the same caption wording twice', () => {
  const f = fixture();
  f.content.utterances = f.content.utterances.slice(0, 4);
  f.cues = f.cues.slice(0, 4);
  const text = 'The coastal funding program supports local schools.';
  f.content.utterances.push({ speaker: 'A', start: 40000, end: 44000, text }, { speaker: 'C', start: 44000, end: 48000, text });
  f.cues.push({ name: 'Presenter', start: 40000, end: 48000, text });
  expect(reconcileZoomSpeakerTurns(f.content, f.cues, f.verdict)).toBe(f.verdict);
});

test('distinct consecutive phrases within one Zoom cue can belong to the same newly discovered person', () => {
  const f = fixture();
  f.content.utterances.push({ speaker: 'C', start: 54000, end: 58000, text: 'We can resume the planning discussion tomorrow.' });
  f.cues.find(cue => cue.start === 50000).end = 58000;
  f.cues.find(cue => cue.start === 50000).text += ' We can resume the planning discussion tomorrow.';
  const result = run(f);
  expect(result.labels[5]).toBe('Late arrival');
  expect(result.labels.at(-1)).toBe('Late arrival');
});

test('one contradictory substantial turn removes the global label without inventing an uncorroborated identity', () => {
  const f = fixture();
  f.cues = f.cues.filter(cue => cue.start !== 60000);
  const result = run(f);
  expect(result.labels[4]).toBeNull();
  expect(result.names).not.toHaveProperty('A');
  expect(Object.values(result.names)).not.toContain('Late arrival');
});

test('budget overflow drops the split atomically and keeps mixed speaker IDs unnamed', () => {
  const result = run(fixture(), { maxAlignmentBytes: 300 });
  expect(result.alignment.additionalSpeakerIds).toEqual([]);
  expect(result.alignment.reassigned).toEqual({});
  expect(result.names).toEqual({});
  expect(result.alignment.status).toBe('abstained');
  expect(Buffer.byteLength(JSON.stringify(result.alignment))).toBeLessThanOrEqual(300);
});

test('a near-limit existing alignment cannot make the fallback exceed its storage bound', () => {
  const f = fixture();
  f.verdict.alignment.suggestions.large = ['x'.repeat(65300)];
  const result = run(f);
  expect(Buffer.byteLength(JSON.stringify(result.alignment))).toBeLessThanOrEqual(32768);
  expect(result.names).toEqual({});
});

test('the combined reassignment map remains capped even when compact JSON would fit', () => {
  const f = fixture();
  const base = f.content.utterances.length;
  for (let i = 0; i < 2100; i++) {
    const start = (base + i) * 10000;
    const text = 'The next experiment will measure electronic transport across layers.';
    f.content.utterances.push({ speaker: 'A', start, end: start + 4000, text });
    f.cues.push({ name: 'Presenter', start, end: start + 4000, text });
  }
  const result = run(f);
  expect(result.alignment.reassignedDropped).toBe(true);
  expect(result.alignment.additionalSpeakerIds).toEqual([]);
  expect(result.names).not.toHaveProperty('A');
});

test('new IDs never collide with an existing provider ID', () => {
  const f = fixture();
  f.content.utterances.push({ speaker: 'zoom_1', text: 'Unmatched.', start: 100000, end: 101000 });
  const result = run(f);
  expect(result.alignment.additionalSpeakerIds).not.toContain('zoom_1');
  expect(result.content.utterances.at(-1).speaker).toBe('zoom_1');
});

test('the durable overlay survives JSON serialization and reaches labeled VTT and frozen publication source', () => {
  const f = fixture();
  const saved = JSON.parse(JSON.stringify(reconcileZoomSpeakerTurns(f.content, f.cues, f.verdict)));
  const content = applySpeakerReassignments(f.content, saved.alignment.reassigned, saved.alignment.additionalSpeakerIds);
  const vtt = formatTranscriptVtt(content, saved.names);
  expect(vtt).toContain('Late arrival: Wow.');
  expect(vtt).not.toContain('Collaborator: Wow.');
  const identity = { requestId: '11111111-1111-4111-8111-111111111111', siteVisitActivityId: '22222222-2222-4222-8222-222222222222',
    revisionId: '33333333-3333-4333-8333-333333333333', operationId: '44444444-4444-4444-8444-444444444444' };
  const files = buildMeetingTranscriptFiles({ content, speakerNames: saved.names, identity });
  expect(files.publishable).toBe(true);
  expect(files.files.vtt.bytes.toString()).toContain('Late arrival: Wow.');
  expect(files.sourceContent.speakerNames[files.sourceContent.utterances[5].speakerId]).toBe('Late arrival');
});

test('a persisted reassignment cannot introduce IDs without the server-recorded allowlist', () => {
  const f = fixture();
  expect(applySpeakerReassignments(f.content, { 0: 'zoom_42' }).utterances[0].speaker).toBe('A');
  expect(applySpeakerReassignments(f.content, { 0: 'bad id' }, ['bad id']).utterances[0].speaker).toBe('A');
});
