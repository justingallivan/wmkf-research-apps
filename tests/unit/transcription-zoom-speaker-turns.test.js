import { reconcileZoomSpeakerTurns, reassignShortUtterances } from '../../lib/services/transcription-pilot/zoom-vtt';
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
  expect(result.alignment.reasons).toEqual({ A: 'mixed_speakers' });
  expect(result.names.C).toBe('Collaborator');
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

test('one contradictory substantial turn does not strip the global label', () => {
  const f = fixture();
  f.cues = f.cues.filter(cue => cue.start !== 60000);
  const result = run(f);
  expect(result.labels[4]).toBe('Presenter');
  expect(result.names.A).toBe('Presenter');
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
  f.verdict.alignment.suggestions.A = ['x'.repeat(65300)];
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

function withShortCorrection(f, target = 'C') {
  const index = f.content.utterances.length;
  const start = 120000;
  const name = f.verdict.names[target];
  const source = target === 'A' ? 'C' : 'A';
  f.content.utterances.push({ speaker: target, start, end: start + 3000, text: 'We should continue this discussion about the proposed methods.' },
    { speaker: source, start: start + 3000, end: start + 3500, text: 'Right.' });
  f.cues.push({ name, start, end: start + 4000, text: 'We should continue this discussion about the proposed methods.' });
  const pass = reassignShortUtterances(f.content.utterances, f.cues, f.verdict.names);
  expect(pass.reassigned[String(index + 1)]).toBe(target);
  f.verdict.alignment.reassigned = pass.reassigned;
  f.verdict.alignment.reassignedCount = pass.reassignedCount;
  return index + 1;
}

test('a corrected short reply does not strip a consistent ID or its uncaptioned turns', () => {
  const f = fixture();
  f.content.utterances = f.content.utterances.slice(0, 4);
  f.cues = f.cues.slice(0, 4);
  f.content.utterances.push({ speaker: 'A', start: 80000, end: 84000, text: 'These uncaptioned remarks should keep the verified presenter name.' });
  const index = withShortCorrection(f);
  const result = run(f);
  expect(result.names).toEqual(f.verdict.names);
  expect(result.labels[4]).toBe('Presenter');
  expect(result.labels[index]).toBe('Collaborator');
  expect(result.alignment.reasons).toEqual({});
});

test('a captioned short contradiction alone does not split an otherwise consistent ID', () => {
  const f = fixture();
  f.content.utterances = f.content.utterances.slice(0, 4);
  f.cues = f.cues.slice(0, 4);
  f.content.utterances.push({ speaker: 'A', text: 'Yes, exactly.', start: 80000, end: 81000 },
    { speaker: 'A', text: 'Uncaptioned remarks retain their existing name.', start: 90000, end: 92000 });
  f.cues.push({ name: 'Collaborator', text: 'Yes, exactly.', start: 80000, end: 81000 });
  const result = run(f);
  expect(result.names).toEqual(f.verdict.names);
  expect(result.labels[4]).toBe('Collaborator');
  expect(result.labels[5]).toBe('Presenter');
  expect(result.alignment.reasons).toEqual({});
});

test('a previous short correction into a mixed ID follows its named split target', () => {
  const f = fixture();
  const index = withShortCorrection(f, 'A');
  const result = run(f);
  expect(result.labels[index]).toBe('Presenter');
  expect(result.content.utterances[index].speaker).toBe(result.content.utterances[0].speaker);
  expect(result.labels[4]).toBe('Late arrival');
});

test('a previous correction out of a mixed ID stays corrected', () => {
  const f = fixture();
  const index = withShortCorrection(f);
  expect(run(f).labels[index]).toBe('Collaborator');
});

test('an incoming correction stays on the unnamed target when its original name has no supported split', () => {
  const f = fixture();
  const index = withShortCorrection(f, 'A');
  f.cues = f.cues.filter(cue => cue.name !== 'Presenter' || cue.start === 120000);
  const result = run(f);
  expect(result.content.utterances[index].speaker).toBe('A');
  expect(result.labels[index]).toBeNull();
  expect(result.labels[4]).toBe('Late arrival');
});

test('budget fallback preserves an incoming short correction even without a split', () => {
  const f = fixture();
  const index = withShortCorrection(f, 'A');
  const result = run(f, { maxAlignmentBytes: 650 });
  expect(result.alignment.reassignedDropped).toBe(true);
  expect(result.content.utterances[index].speaker).toBe('A');
  expect(result.labels[index]).toBeNull();
});

test('vanished IDs leave no suggestions or reasons, surviving mixed IDs keep theirs', () => {
  const f = fixture();
  f.verdict.alignment.suggestions = { A: ['Presenter', 'Late arrival'], C: ['Collaborator'] };
  f.content.utterances.pop();
  const result = run(f);
  expect(result.alignment.suggestions).not.toHaveProperty('A');
  expect(result.alignment.reasons).not.toHaveProperty('A');
  expect(result.alignment.suggestions.C).toEqual(['Collaborator']);
});

test('legacy corrections alone prune an emptied ID and recompute status', () => {
  const f = fixture();
  f.content.utterances = f.content.utterances.slice(0, 4);
  f.cues = f.cues.slice(0, 4);
  f.content.utterances.push({ speaker: 'F', start: 80000, end: 81000, text: 'Right.' });
  f.verdict.alignment.status = 'partial';
  f.verdict.alignment.reassigned = { 4: 'A' };
  f.verdict.alignment.suggestions.F = ['Presenter'];
  f.verdict.alignment.reasons.F = 'conflict';
  const result = run(f);
  expect(result.alignment.status).toBe('applied');
  expect(result.alignment.suggestions).not.toHaveProperty('F');
  expect(result.alignment.reasons).not.toHaveProperty('F');
});

test('an unnamed 3:1 ID recovers its corroborated majority and leaves the singleton unnamed', () => {
  const f = fixture();
  f.content.utterances = f.content.utterances.slice(0, 4).map(row => ({ ...row, speaker: 'A' }));
  f.cues = f.cues.slice(0, 4).map((cue, index) => ({ ...cue, name: index === 3 ? 'Singleton' : 'Presenter' }));
  f.verdict.names = {};
  f.verdict.alignment.speakers = {};
  f.verdict.alignment.status = 'abstained';
  const result = run(f);
  expect(result.labels).toEqual(['Presenter', 'Presenter', 'Presenter', null]);
  expect(result.alignment.status).toBe('partial');
});

// Single-match path: a strong uncorroborated match moves a turn only if the label's own name has no caption there.
function absentFixture(text = 'Superconducting qubits require careful calibration across several cryogenic temperature stages.') {
  const rows = [
    ['A', 'Presenter', 'Our laboratory studies unusual patterns in magnetic materials.'],
    ['A', 'Presenter', 'The next experiment will measure electronic transport across layers.'],
    ['A', 'Visitor', text],
  ];
  const utterances = rows.map(([speaker, , t], index) => ({ speaker, text: t, start: index * 10000, end: index * 10000 + 4000 }));
  const cues = rows.map(([, name, t], index) => ({ name, text: t, start: utterances[index].start, end: utterances[index].end }));
  cues.push({ name: 'Visitor', text: 'A later remark with enough words to count.', start: 60000, end: 64000 });
  const verdict = { names: { A: 'Presenter' }, alignment: {
    status: 'applied', speakers: { A: { name: 'Presenter', confidence: 0.95 } },
    reasons: {}, suggestions: {}, reassigned: {}, reassignedCount: 0,
  } };
  return { content: { text: rows.map(row => row[2]).join(' '), utterances }, cues, verdict };
}

test('a single strong match moves a turn when its label name has no overlapping caption', () => {
  const result = run(absentFixture());
  expect(result.labels).toEqual(['Presenter', 'Presenter', 'Visitor']);
  expect(result.content.utterances[2].speaker).toBe('zoom_1');
  expect(result.alignment.additionalSpeakerIds).toEqual(['zoom_1']);
  expect(result.alignment.reassignedCount).toBe(1);
  expect(result.alignment.status).toBe('applied');
  expect(result.names.A).toBe('Presenter');
});

test('a label-name caption overlapping the turn keeps the two-turn rule', () => {
  const f = absentFixture();
  f.cues.push({ name: 'Presenter', text: 'Talking over the visitor at the same time.', start: 20500, end: 23000 });
  expect(run(f).labels).toEqual(['Presenter', 'Presenter', 'Presenter']);
});

test('a label-name caption just inside the tolerance blocks the move, one beyond it does not', () => {
  const near = absentFixture();
  near.cues.push({ name: 'Presenter', text: 'Earlier remark.', start: 17000, end: 18900 });
  expect(run(near).labels[2]).toBe('Presenter');
  const far = absentFixture();
  far.cues.push({ name: 'Presenter', text: 'Earlier remark.', start: 16000, end: 18400 });
  expect(run(far).labels[2]).toBe('Visitor');
});

test.each([
  ['coverage below 0.85', 'Superconducting qubits require careful calibration across several cryogenic temperature stages indeed truly.',
    'Superconducting qubits require careful calibration across several cryogenic temperature stages.'],
  ['fewer than four shared content words', 'Superconducting qubits require careful calibration across several cryogenic temperature stages.',
    'Superconducting qubits require careful calibration across several cryogenic temperature stages.'],
])('a weak single match does not move the turn: %s', (label, heard, captioned) => {
  const f = absentFixture(heard);
  f.cues[2].text = captioned;
  if (label.startsWith('fewer')) f.content.utterances[2].text = 'Yes so then we are going to see this one and also that.';
  if (label.startsWith('fewer')) f.cues[2].text = 'Yes so then we are going to see this one and also that.';
  expect(run(f).labels[2]).toBe('Presenter');
});

test('a short turn with an absent label name is not moved', () => {
  const f = absentFixture('Calibration looks good.');
  expect(run(f).labels[2]).toBe('Presenter');
});

test('a single strong match moves to an existing speaker ID for that name without creating zoom_N', () => {
  const f = absentFixture();
  f.content.utterances.push({ speaker: 'B', text: 'Unrelated closing sentence without any caption.', start: 30000, end: 34000 });
  f.verdict.names.B = 'Visitor';
  f.verdict.alignment.speakers.B = { name: 'Visitor', confidence: 0.95 };
  const result = run(f);
  expect(result.content.utterances[2].speaker).toBe('B');
  expect(result.alignment.additionalSpeakerIds ?? []).toEqual([]);
  expect(result.labels).toEqual(['Presenter', 'Presenter', 'Visitor', 'Visitor']);
});

test('a name with exactly two substantial cues anywhere (one overlapping) is established; with one it is not', () => {
  expect(run(absentFixture()).labels[2]).toBe('Visitor');
  const f = absentFixture();
  f.cues = f.cues.filter(cue => cue.start !== 60000);
  expect(run(f).labels[2]).toBe('Presenter');
});

test('an absent-label move does not pull a second substantial turn that fails the absence guard', () => {
  const f = absentFixture();
  const first = 'Superconducting qubits require careful calibration across several cryogenic temperature stages.';
  const second = 'Dilution refrigerators maintain stable millikelvin environments throughout extended measurement campaigns.';
  f.cues[2].text = `${first} ${second}`;
  f.cues[2].end = 28000;
  f.content.utterances[2].text = first;
  f.content.utterances[2].end = 24000;
  f.content.utterances.push({ speaker: 'A', text: second, start: 24500, end: 28000 });
  f.cues.push({ name: 'Presenter', text: 'Brief aside.', start: 26500, end: 27500 });
  const result = run(f);
  expect(result.labels).toEqual(['Presenter', 'Presenter', 'Visitor', 'Presenter']);
});
