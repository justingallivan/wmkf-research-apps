/** Server-only report projection. Exact display-name grouping is presence evidence, never a person identifier. */
import { getMeetingAttendance } from '../meeting-tracker-recordings/zoom-client';
import { resolveSourceProvenance } from './source-provenance';
import { zoomDisplayNames } from '../transcription-pilot/zoom-vtt';
import { staffDiscussionContent } from './presentation-boundary';
import { normalizeDiscussionAttribution } from './discussion-attribution';

const wholeSecond = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value) && Number.isFinite(Date.parse(value));

export async function buildAttendanceReview({ sourceProvenance, content, speakerNames, endMs }, fetchReport = getMeetingAttendance) {
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
  const discussionIds = [...new Set(staffDiscussionContent(content, endMs).utterances.map(row => row.speaker).filter(Boolean))].sort();
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
  const decision = normalizeDiscussionAttribution({ version: 1, rows, excludedSpeakerIds: [], attendance: { status, fetchedAt: new Date().toISOString() } });
  const z = origin.provenance?.zoom;
  const aligned = z?.audioOnlyFileCount === 1 && Math.abs(Date.parse(z.audioFile.recordingEnd) - Date.parse(z.audioFile.recordingStart) - origin.provenance.audioDurationMs) <= 2000;
  return { decision, waitingRoomOnlyCount: status === 'complete' ? [...people.values()].filter(person => !person.lastLeaveAt).length : 0,
    leftBeforeEnd: rows.map(row => Boolean(aligned && row.lastLeaveAt && Date.parse(row.lastLeaveAt) < Date.parse(z.audioFile.recordingStart) + endMs - 10000)) };
}
