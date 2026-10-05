/** @jest-environment node */
import {
  buildPresentationTranscriptText, buildStaffDiscussionTranscriptText, classifySpeakers, isFoundationCandidate,
  presentationContent, proposePresentationEnd, staffDiscussionContent,
} from '../../lib/services/meeting-tracker-transcription/presentation-boundary.js';

const candidates = [
  { id: 'pi:c1', source: 'pi', displayName: 'Dana Reyes' },
  { id: 'co_pi:c2', source: 'co_pi', displayName: 'Lee Park' },
  { id: 'attendee:staff:7', source: 'saved_staff', displayName: 'Maria Lopez' },
  { id: 'attendee:roster:3', source: 'saved_attendee', displayName: 'Board Member' },
  { id: 'attendee:manual:v:0', source: 'saved_attendee', displayName: 'Guest Dean' },
];
const utterances = [
  { speaker: 'A', start: 0, end: 10_000, text: 'Welcome.' },
  { speaker: 'B', start: 10_000, end: 60_000, text: 'Our results.' },
  { speaker: 'C', start: 60_000, end: 65_000, text: 'Any questions for us?' },
  { speaker: 'B', start: 65_000, end: 70_000, text: 'Thank you.' },
  { speaker: 'A', start: 70_000, end: 90_000, text: 'Now, among ourselves.' },
  { speaker: 'D', start: 90_000, end: 95_000, text: 'Agreed.' },
];

test('foundation candidates are saved staff and roster attendees; PI, co-PI, and manual attendees are outside', () => {
  expect(candidates.map(isFoundationCandidate)).toEqual([false, false, true, true, false]);
  expect(isFoundationCandidate({ id: 'x', source: 'staff', displayName: 'S' })).toBe(true);
  expect(isFoundationCandidate(null)).toBe(false);
});

test('speakers classify by applied name, case and whitespace insensitive; unnamed speakers are neither', () => {
  const classes = classifySpeakers({ speakerNames: { A: 'maria  lopez', B: 'Dana Reyes', C: 'board member', D: '', E: 'Nobody Known' }, candidates });
  expect(Object.fromEntries(classes)).toEqual({ A: 'foundation', B: 'outside', C: 'foundation', D: 'unnamed', E: 'outside' });
});

test('the proposal is the end of the last turn by a named outside speaker', () => {
  const proposal = proposePresentationEnd({ utterances, speakerNames: { A: 'Maria Lopez', B: 'Dana Reyes', C: 'Board Member', D: 'Maria Lopez' }, candidates });
  expect(proposal).toEqual({ endMs: 70_000, speakerId: 'B', utteranceIndex: 3 });
});

test('no proposal when no name is applied or every named speaker is inside the foundation', () => {
  expect(proposePresentationEnd({ utterances, speakerNames: {}, candidates })).toBeNull();
  expect(proposePresentationEnd({ utterances, speakerNames: { A: 'Maria Lopez', D: 'Board Member' }, candidates })).toBeNull();
  expect(proposePresentationEnd({ utterances: [], speakerNames: { B: 'Dana Reyes' }, candidates })).toBeNull();
});

test('a name that matches no candidate counts as outside (a presenter staff did not pre-register still ends the presentation)', () => {
  expect(proposePresentationEnd({ utterances, speakerNames: { D: 'Visiting Postdoc' }, candidates })).toEqual({ endMs: 95_000, speakerId: 'D', utteranceIndex: 5 });
});

test('presentation content keeps only utterances ending at or before the boundary and drops the full text', () => {
  const content = presentationContent({ text: 'everything', utterances }, 70_000);
  expect(content.text).toBe('');
  expect(content.utterances.map(row => row.end)).toEqual([10_000, 60_000, 65_000, 70_000]);
  expect(() => presentationContent({ utterances }, -1)).toThrow('invalid_presentation_end');
  expect(() => presentationContent({ utterances }, '70000')).toThrow('invalid_presentation_end');
});

test('the presentation TXT uses the turn layout and ends at the boundary', () => {
  const text = buildPresentationTranscriptText({ text: 'everything', utterances }, { A: 'Maria Lopez', B: 'Dana Reyes' }, 70_000);
  expect(text).toBe('[00:00] Maria Lopez: Welcome.\n\n[00:10] Dana Reyes: Our results.\n\n[01:00] Speaker C: Any questions for us?\n\n[01:05] Dana Reyes: Thank you.\n');
  expect(text).not.toContain('among ourselves');
});

test('the staff discussion is the exact complement: the two halves are disjoint and reassemble every utterance in order', () => {
  for (const endMs of [0, 10_000, 65_000, 70_000, 95_000]) {
    const before = presentationContent({ text: 'all', utterances }, endMs).utterances;
    const after = staffDiscussionContent({ text: 'all', utterances }, endMs).utterances;
    expect(before.filter(row => after.includes(row))).toEqual([]);
    expect([...before, ...after].sort((a, b) => a.start - b.start)).toEqual(utterances);
  }
  expect(staffDiscussionContent({ text: 'all', utterances }, 70_000).text).toBe('');
  expect(() => staffDiscussionContent({ utterances }, -1)).toThrow('invalid_presentation_end');
});

test('the staff discussion TXT starts after the boundary, and is null when nothing follows it', () => {
  const text = buildStaffDiscussionTranscriptText({ text: 'everything', utterances }, { A: 'Maria Lopez', B: 'Dana Reyes' }, 70_000);
  expect(text).toBe('[01:10] Maria Lopez: Now, among ourselves.\n\n[01:30] Speaker D: Agreed.\n');
  expect(text).not.toContain('Thank you.');
  expect(buildStaffDiscussionTranscriptText({ text: 'everything', utterances }, {}, 95_000)).toBeNull();
});

