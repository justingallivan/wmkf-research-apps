/** Server-only report projection. Exact display-name grouping is presence evidence, never a person identifier. */
import { getMeetingAttendance } from '../meeting-tracker-recordings/zoom-client';
import { resolveSourceProvenance } from './source-provenance';
import { zoomDisplayNames } from '../transcription-pilot/zoom-vtt';
import { staffDiscussionContent } from './presentation-boundary';
import { normalizeDiscussionAttribution } from './discussion-attribution';

const wholeSecond = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value) && Number.isFinite(Date.parse(value));

export async function buildAttendanceReview({ sourceProvenance, content, speakerNames, endMs, speakerAlignment = null }, fetchReport = getMeetingAttendance) {
  const origin = resolveSourceProvenance(sourceProvenance);
  let report = { status: 'unavailable', participants: [] };
  if (origin.status === 'verified_zoom') {
    try { report = await fetchReport(origin.provenance.zoom.meetingUuid); } catch { /* explicit manual fallback */ }
  }
  const people = new Map();
  let malformed = false;
  for (const row of report.participants) {
    if (typeof row?.name !== 'string' || !row.name || row.name.length > 200 || /[\u0000-\u001f\u007f]/.test(row.name)
      || !['in_meeting', 'in_waiting_room'].includes(row.status)
      || !wholeSecond(row.join_time) || !wholeSecond(row.leave_time)
      || Date.parse(row.leave_time) < Date.parse(row.join_time) || !Number.isSafeInteger(row.duration) || row.duration < 0) { malformed = true; continue; }
    if (!people.has(row.name)) people.set(row.name, { name: row.name, lastLeaveAt: null });
    const person = people.get(row.name);
    if (row.status === 'in_meeting' && (!person.lastLeaveAt || row.leave_time > person.lastLeaveAt)) person.lastLeaveAt = row.leave_time;
  }
  let status = malformed ? 'partial' : report.status;
  const display = zoomDisplayNames([...people.keys()]);
  const discussionTurns = staffDiscussionContent(content, endMs).utterances;
  const discussionIds = [...new Set(discussionTurns.map(row => row.speaker).filter(Boolean))].sort();
  const linked = new Set();
  // Partial reports never masquerade as a complete roster: use the manual voices fallback.
  let rows = status === 'complete' ? [...people.values()].filter(person => person.lastLeaveAt).map(person => {
    const speakerIds = discussionIds.filter(id => speakerNames[id] === display.get(person.name) || speakerNames[id] === person.name);
    speakerIds.forEach(id => linked.add(id));
    return { displayName: display.get(person.name), kept: true, speakerIds, lastLeaveAt: person.lastLeaveAt, kind: 'attendee' };
  }) : [];
  // An ID linked to more than one attendee is controlled only by its own voice row (shared microphone).
  const counts = new Map();
  rows.forEach(row => row.speakerIds.forEach(id => counts.set(id, (counts.get(id) || 0) + 1)));
  rows.forEach(row => { row.speakerIds = row.speakerIds.filter(id => counts.get(id) === 1); });
  for (const id of discussionIds) if (!linked.has(id) || counts.get(id) > 1) rows.push({ displayName: speakerNames[id] || `Speaker ${id}`, kept: true, speakerIds: [id], lastLeaveAt: null, kind: 'voice' });
  if (JSON.stringify(rows).length > 60000) {
    status = 'partial';
    rows = discussionIds.map(id => ({ displayName: speakerNames[id] || `Speaker ${id}`, kept: true, speakerIds: [id], lastLeaveAt: null, kind: 'voice' }));
  }
  const z = origin.provenance?.zoom;
  const aligned = z?.audioOnlyFileCount === 1 && Math.abs(Date.parse(z.audioFile.recordingEnd) - Date.parse(z.audioFile.recordingStart) - origin.provenance.audioDurationMs) <= 2000;
  const leftBeforeEnd = rows.map(row => Boolean(aligned && row.lastLeaveAt && Date.parse(row.lastLeaveAt) < Date.parse(z.audioFile.recordingStart) + endMs - 10000));
  // Zoom leave times have whole-second precision. Allow two seconds at the edge;
  // only aligned recordings and turns starting clearly after departure are evidence.
  const spokeAfterDeparture = rows.map(row => Boolean(aligned && row.lastLeaveAt && discussionTurns.some(turn =>
    row.speakerIds.includes(turn.speaker) && Number.isSafeInteger(turn.start) && turn.start >= 0
    && Date.parse(z.audioFile.recordingStart) + turn.start > Date.parse(row.lastLeaveAt) + 2000)));
  // Unmatched/shared voices and mixed-speaker labels need explicit confirmation.
  // Missing alignment evidence (including cleaned-up jobs) cannot establish identity.
  const identityUncertain = rows.map(row => row.kind === 'voice' || row.speakerIds.some(id =>
    !speakerAlignment || speakerAlignment.reasons?.[id] === 'mixed_speakers'));
  rows.forEach((row, index) => { row.kept = !leftBeforeEnd[index] && !spokeAfterDeparture[index] && !identityUncertain[index]; });
  const excludedSpeakerIds = rows.filter(row => !row.kept).flatMap(row => row.speakerIds).sort();
  const decision = normalizeDiscussionAttribution({ version: 1, rows, excludedSpeakerIds, attendance: { status, fetchedAt: new Date().toISOString() } });
  return { decision, waitingRoomOnlyCount: status === 'complete' ? [...people.values()].filter(person => !person.lastLeaveAt).length : 0,
    leftBeforeEnd, spokeAfterDeparture, identityUncertain };
}

/** Picker-only display suggestions. Never person identities or boundary/attendance decisions. */
export async function getZoomSpeakerCandidates(sourceProvenance, fetchReport = uuid => getMeetingAttendance(uuid, { timeoutMs: 5_000 })) {
  const origin = resolveSourceProvenance(sourceProvenance);
  if (origin.status !== 'verified_zoom') return { zoomCandidates: [], zoomCandidateStatus: 'not_applicable' };
  let report;
  try { report = await fetchReport(origin.provenance.zoom.meetingUuid); }
  catch { return { zoomCandidates: [], zoomCandidateStatus: 'unavailable' }; }
  if (report?.status !== 'complete' || !Array.isArray(report.participants) || report.participants.length > 300) {
    return { zoomCandidates: [], zoomCandidateStatus: report?.status === 'partial' ? 'partial' : 'unavailable' };
  }
  const names = [...new Set(report.participants.filter(row => row?.status === 'in_meeting'
    && typeof row.name === 'string' && row.name.trim() && row.name.length <= 80
    && !/[@\u0000-\u001f\u007f]/.test(row.name)).map(row => row.name.trim()))].sort();
  const display = zoomDisplayNames(names);
  return { zoomCandidateStatus: 'complete', zoomCandidates: names.map((name, index) => ({
    id: `zoom:${index}`, source: 'zoom_participant', displayName: display.get(name),
  })) };
}
