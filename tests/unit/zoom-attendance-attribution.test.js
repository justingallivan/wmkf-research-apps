/** @jest-environment node */
import baseline from '../fixtures/zoom-attendance-legacy-baseline.json';
import { buildAttendanceReview } from '../../lib/services/meeting-tracker-transcription/attendance-service';
import { normalizeDiscussionAttribution, sharedMicrophoneDecision, confirmDiscussionAttribution } from '../../lib/services/meeting-tracker-transcription/discussion-attribution';
import { resolveDiscussionAttribution, proposePresentationEnd, buildStaffDiscussionTranscriptText } from '../../lib/services/meeting-tracker-transcription/presentation-boundary';
import { buildMeetingTranscriptFiles, parseVerifiedMeetingTranscriptSource } from '../../lib/services/meeting-tracker-transcription/bundle';
import { formatTranscriptText, formatTranscriptVtt, groupTranscriptByTurn } from '../../lib/services/transcription-pilot/transcript-format';

const guid = '11111111-1111-4111-8111-111111111111';
const provenance = { version: 1, sourceId: guid, kind: 'zoom', audioSha256: 'a'.repeat(64), audioBytes: 10, audioDurationMs: 60000,
  zoom: { importId: guid, meetingUuid: '/frozen/occurrence==', hostId: 'host', audioOnlyFileCount: 1, transcriptFile: null,
    audioFile: { fileId: 'audio', recordingType: 'audio_only', bytes: 10, sha256: 'a'.repeat(64), recordingStart: '2026-10-09T16:00:00Z', recordingEnd: '2026-10-09T16:01:00Z' } } };
const content = { text: '', utterances: [
  { speaker: 'A', start: 0, end: 30000, text: 'Presentation words.' },
  { speaker: 'A', start: 30000, end: 40000, text: 'Discussion words.' },
  { speaker: 'B', start: 40000, end: 50000, text: 'Another voice.' },
] };
const names = { A: 'Alex Example', B: 'Speaker B' };
const row = (name, status = 'in_meeting', leave = '2026-10-09T16:00:15Z') => ({ name, status, join_time: '2026-10-09T15:45:16Z', leave_time: leave, duration: 899 });
const args = { sourceProvenance: provenance, content, speakerNames: names, endMs: 30000 };
const report = participants => jest.fn(async () => ({ status: 'complete', participants }));
const identity = { requestId: guid, siteVisitActivityId: guid, revisionId: guid, operationId: guid,
  presentationEnd: { endMs: 30000, confirmedBy: 1, confirmedAt: '2026-10-09T17:00:00Z' } };

it('groups exact names across waiting/admitted rows, hides waiting-only, links display forms and includes silent attendees', async () => {
  const fetch = report([row('Example, Alex', 'in_waiting_room'), row('Example, Alex'), row('Example, Alex', 'in_meeting', '2026-10-09T16:00:18Z'), row('Example, Alex'), row('Silent'), row('Waiting', 'in_waiting_room')]);
  const review = await buildAttendanceReview(args, fetch);
  expect(fetch).toHaveBeenCalledWith(provenance.zoom.meetingUuid);
  expect(review.decision.rows).toEqual([
    { displayName: 'Alex Example', kept: true, speakerIds: ['A'], lastLeaveAt: '2026-10-09T16:00:18Z', kind: 'attendee' },
    { displayName: 'Silent', kept: true, speakerIds: [], lastLeaveAt: '2026-10-09T16:00:15Z', kind: 'attendee' },
    { displayName: 'Speaker B', kept: true, speakerIds: ['B'], lastLeaveAt: null, kind: 'voice' },
  ]);
  expect(review.waitingRoomOnlyCount).toBe(1);
  expect(review.leftBeforeEnd).toEqual([true, true, false]);
});

it('uses collision-aware display names and exact names only; staff renames become other voices', async () => {
  const review = await buildAttendanceReview({ ...args, speakerNames: { A: 'Alex Example', B: 'Renamed' } }, report([row('Example, Alex'), row('Alex Example'), row('Speaker B')]));
  expect(review.decision.rows.map(r => [r.displayName, r.speakerIds])).toEqual([
    ['Example, Alex', []], ['Alex Example', ['A']], ['Speaker B', []], ['Renamed', ['B']],
  ]);
});

it.each([null, { invalid: true }, { ...provenance, kind: 'upload', zoom: null }])('falls back without a report call for untrusted or non-Zoom provenance', async sourceProvenance => {
  const fetch = report([]);
  const review = await buildAttendanceReview({ ...args, sourceProvenance }, fetch);
  expect(fetch).not.toHaveBeenCalled();
  expect(review.decision.attendance.status).toBe('unavailable');
  expect(review.decision.rows.map(r => r.speakerIds)).toEqual([['A'], ['B']]);
});

it('partial/error reports use checked manual voices, never a partial roster', async () => {
  for (const fetch of [jest.fn(async () => ({ status: 'partial', participants: [row('Alex Example')] })), jest.fn(async () => { throw Error('report not ready'); })]) {
    const review = await buildAttendanceReview(args, fetch);
    expect(review.decision.rows.every(r => r.kind === 'voice' && r.kept)).toBe(true);
    expect(review.decision.rows).toHaveLength(2);
  }
});

it.each([
  { ...provenance, zoom: { ...provenance.zoom, audioOnlyFileCount: 2 } },
  { ...provenance, audioDurationMs: 57000 },
])('withholds clock hints when synchronization prerequisites fail', async sourceProvenance => {
  expect((await buildAttendanceReview({ ...args, sourceProvenance }, report([row('Alex Example')]))).leftBeforeEnd).toEqual([false, false]);
});

it('uses recording start and a strict ten-second margin, never auto-unchecks', async () => {
  const review = await buildAttendanceReview(args, report([row('Alex Example', 'in_meeting', '2026-10-09T16:00:20Z')]));
  expect(review.leftBeforeEnd[0]).toBe(false);
  expect(review.decision.rows.every(r => r.kept)).toBe(true);
});

it('excludes discussion only, preserves separate IDs, names, boundaries, words and all output consumers', async () => {
  const review = { id: 'review', ...await buildAttendanceReview(args, report([row('Example, Alex'), row('Silent')])) };
  const decision = confirmDiscussionAttribution(review, { reviewId: 'review', kept: [false, false, false] });
  const before = JSON.stringify({ content, names });
  const resolved = resolveDiscussionAttribution(content, 30000, decision);
  expect(resolved.utterances.map(u => u.unidentifiedSpeaker || false)).toEqual([false, true, true]);
  expect(groupTranscriptByTurn(resolved, names)).toHaveLength(3);
  expect(JSON.stringify({ content, names })).toBe(before);
  expect(resolved.utterances.map(({ unidentifiedSpeaker, ...u }) => u)).toEqual(content.utterances);
  expect(proposePresentationEnd({ utterances: resolved.utterances, speakerNames: names, candidates: [] })).toEqual(proposePresentationEnd({ utterances: content.utterances, speakerNames: names, candidates: [] }));
  const generated = buildMeetingTranscriptFiles({ content, speakerNames: names, identity: { ...identity, discussionAttribution: decision } });
  expect(generated.files.txt.bytes.toString()).toContain('Alex Example: Presentation words.');
  expect(generated.files.txt.bytes.toString()).toContain('Unidentified speaker: Discussion words.');
  expect(generated.files.vtt.bytes.toString()).toContain('Unidentified speaker: Another voice.');
  expect(buildStaffDiscussionTranscriptText(resolved, names, 30000)).not.toContain('Alex Example');
  expect(JSON.parse(generated.files.source.bytes).speakerNames).toEqual(names);
  expect(JSON.parse(generated.files.source.bytes).utterances[1]).not.toHaveProperty('unidentifiedSpeaker');
  expect(() => parseVerifiedMeetingTranscriptSource(generated.files.source.bytes, { size: generated.files.source.bytes.length, sha256: generated.files.source.sha256 }, { ...identity, discussionAttribution: null })).toThrow('invalid_transcript_bundle');
});

it('records silent exclusions without changing rendered output; rejects replay and injected rows', async () => {
  const review = { id: 'current', ...await buildAttendanceReview(args, report([row('Silent')])) };
  const decision = confirmDiscussionAttribution(review, { reviewId: 'current', kept: [false, true, true] });
  expect(decision.rows[0].kept).toBe(false);
  expect(decision.excludedSpeakerIds).toEqual([]);
  expect(formatTranscriptText(resolveDiscussionAttribution(content, 30000, decision), names)).toBe(formatTranscriptText(content, names));
  expect(() => confirmDiscussionAttribution(review, { reviewId: 'old', kept: [true, true, true] })).toThrow();
  expect(() => normalizeDiscussionAttribution({ ...decision, rawRows: [] })).toThrow();
});

it.each(['1','2','3','4','5','6'])('v%s rejects the policy and rebuilds source and render bytes exactly', formatterVersion => {
  const oldIdentity = { ...identity, formatterVersion, ...(Number(formatterVersion) < 4 ? { presentationEnd: null } : {}) };
  const built = buildMeetingTranscriptFiles({ content, speakerNames: names, identity: oldIdentity });
  const parsed = parseVerifiedMeetingTranscriptSource(built.files.source.bytes, { size: built.files.source.bytes.length, sha256: built.files.source.sha256 }, identity);
  const replay = buildMeetingTranscriptFiles({ content: parsed.content, speakerNames: parsed.speakerNames, identity: oldIdentity });
  for (const role of ['txt', 'vtt', 'source']) {
    expect(replay.files[role].bytes).toEqual(built.files[role].bytes);
    expect(built.files[role].bytes.toString('base64')).toBe(baseline.versions[formatterVersion][role]);
  }
  expect(() => buildMeetingTranscriptFiles({ content, speakerNames: names, identity: { ...oldIdentity, discussionAttribution: null } })).toThrow();
  if (formatterVersion === '6') {
    expect(built.files.txt.bytes.toString().slice(1)).toBe(formatTranscriptText(content, names));
    expect(built.files.vtt.bytes.toString()).toBe(formatTranscriptVtt(content, names));
  }
});


it('pilot text/VTT remain byte-identical to the pre-v7 baseline', () => {
  expect(formatTranscriptText(content, names)).toBe(baseline.pilot.txt);
  expect(formatTranscriptVtt(content, names)).toBe(baseline.pilot.vtt);
});

it('shared microphone is controlled only by its own voice row, independent of either attendee', async () => {
  const review = { id: 'shared', ...await buildAttendanceReview(args, report([row('Alex Example'), row('Silent')])) };
  const split = sharedMicrophoneDecision(review.decision, ['A']);
  expect(split.rows.map(row => row.speakerIds)).toEqual([[], [], ['B'], ['A']]);
  const peopleOnly = confirmDiscussionAttribution(review, { reviewId: 'shared', sharedSpeakerIds: ['A'], kept: [false, false, true, true] });
  expect(peopleOnly.excludedSpeakerIds).toEqual([]);
  const mic = confirmDiscussionAttribution(review, { reviewId: 'shared', sharedSpeakerIds: ['A'], kept: [true, true, true, false] });
  expect(mic.excludedSpeakerIds).toEqual(['A']);
  expect(() => sharedMicrophoneDecision(review.decision, ['unknown'])).toThrow();
});

it('never claims waiting-only attendance from incomplete pages', async () => {
  const review = await buildAttendanceReview(args, async () => ({ status: 'partial', participants: [row('Waiting', 'in_waiting_room')] }));
  expect(review.waitingRoomOnlyCount).toBe(0);
});
