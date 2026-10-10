/** Bounded, content-bearing attendance decision. Never part of source provenance or video lineage. */
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value);
const instant = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
function fail() { throw new TypeError('invalid_discussion_attribution'); }

export function normalizeDiscussionAttribution(value) {
  if (value == null) return null;
  if (!exact(value, ['version', 'rows', 'excludedSpeakerIds', 'attendance']) || value.version !== 1
    || !Array.isArray(value.rows) || value.rows.length > 6200
    || !exact(value.attendance, ['status', 'fetchedAt'])
    || !['complete', 'partial', 'unavailable'].includes(value.attendance.status)
    || !instant(value.attendance.fetchedAt)) fail();
  const seen = new Set();
  const rows = value.rows.map(row => {
    if (!exact(row, ['displayName', 'kept', 'speakerIds', 'lastLeaveAt', 'kind'])
      || typeof row.displayName !== 'string' || !row.displayName || row.displayName.length > 200
      || /[\u0000-\u001f\u007f]/.test(row.displayName) || typeof row.kept !== 'boolean'
      || !['attendee', 'voice'].includes(row.kind) || !Array.isArray(row.speakerIds)
      || row.speakerIds.some(speaker => !id(speaker) || seen.has(speaker))
      || row.speakerIds.length > 200 || new Set(row.speakerIds).size !== row.speakerIds.length
      || (row.lastLeaveAt !== null && !instant(row.lastLeaveAt))) fail();
    row.speakerIds.forEach(speaker => seen.add(speaker));
    return { displayName: row.displayName, kept: row.kept, speakerIds: [...row.speakerIds].sort(), lastLeaveAt: row.lastLeaveAt, kind: row.kind };
  });
  const excludedSpeakerIds = rows.filter(row => !row.kept).flatMap(row => row.speakerIds).sort();
  if (!Array.isArray(value.excludedSpeakerIds) || JSON.stringify(value.excludedSpeakerIds) !== JSON.stringify(excludedSpeakerIds)) fail();
  const result = { version: 1, rows, excludedSpeakerIds, attendance: { status: value.attendance.status, fetchedAt: value.attendance.fetchedAt } };
  if (JSON.stringify(result).length > 65536) fail();
  return result;
}

export function sameDiscussionAttribution(left, right) {
  try { return JSON.stringify(normalizeDiscussionAttribution(left)) === JSON.stringify(normalizeDiscussionAttribution(right)); }
  catch { return false; }
}

/** Only kept flags are accepted from the browser; names, links and report status come from the server snapshot. */
export function confirmDiscussionAttribution(review, confirmation) {
  if (!review || !(exact(confirmation, ['reviewId', 'kept']) || exact(confirmation, ['reviewId', 'kept', 'sharedSpeakerIds'])) || confirmation.reviewId !== review.id
    || !Array.isArray(confirmation.kept) || confirmation.kept.length !== sharedMicrophoneDecision(review.decision, confirmation.sharedSpeakerIds || []).rows.length
    || confirmation.kept.some(value => typeof value !== 'boolean')) fail();
  const rows = sharedMicrophoneDecision(review.decision, confirmation.sharedSpeakerIds || []).rows.map((row, index) => ({ ...row, kept: confirmation.kept[index] }));
  return normalizeDiscussionAttribution({ ...review.decision, rows,
    excludedSpeakerIds: rows.filter(row => !row.kept).flatMap(row => row.speakerIds).sort() });
}

/** Staff explicitly identify shared microphones; attendance alone cannot identify who spoke into them. */
export function sharedMicrophoneDecision(decision, sharedSpeakerIds = []) {
  const linked = new Set(decision.rows.filter(row => row.kind === 'attendee').flatMap(row => row.speakerIds));
  if (!Array.isArray(sharedSpeakerIds) || new Set(sharedSpeakerIds).size !== sharedSpeakerIds.length
    || sharedSpeakerIds.some(id => !linked.has(id))) fail();
  const shared = new Set(sharedSpeakerIds);
  const rows = decision.rows.map(row => row.kind === 'attendee' ? { ...row, speakerIds: row.speakerIds.filter(id => !shared.has(id)) } : row);
  for (const row of decision.rows) for (const id of row.speakerIds) if (shared.has(id)) {
    rows.push({ displayName: `${row.displayName} (shared microphone)`, kept: true, speakerIds: [id], lastLeaveAt: null, kind: 'voice' });
  }
  return { ...decision, rows, excludedSpeakerIds: rows.filter(row => !row.kept).flatMap(row => row.speakerIds).sort() };
}
