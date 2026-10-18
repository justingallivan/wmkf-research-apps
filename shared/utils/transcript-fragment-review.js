/** Review-only one-word A–B–A candidates. No text, timing, boundary or speaker mutations. */
export const FRAGMENT_CANDIDATE_LIMIT = 10;
const words = text => typeof text === 'string' ? text.trim().split(/\s+/).filter(Boolean) : [];
const knownName = value => typeof value === 'string' && value.trim() && value.length <= 80
  && !/^(?:unidentified speaker|speaker\s+\S+)$/i.test(value.trim());

export function fragmentCandidateAt(content, names, index, presentationEndMs = null) {
  const rows = content?.utterances;
  if (!Array.isArray(rows) || !Number.isInteger(index) || index < 1 || index >= rows.length - 1) return null;
  const [a, b, c] = rows.slice(index - 1, index + 2);
  if (![a, b, c].every(row => row && typeof row.speaker === 'string'
    && Number.isFinite(row.start) && Number.isFinite(row.end) && row.start >= 0 && row.end >= row.start)) return null;
  if (a.speaker !== c.speaker || a.speaker === b.speaker || !b.speaker
    || !knownName(names?.[a.speaker]) || names?.[a.speaker] === names?.[b.speaker]) return null;
  if (b.end - b.start > 2000 || b.start < a.end || c.start < b.end
    || b.start - a.end > 500 || c.start - b.end > 500) return null;
  // A confirmed split must not be bridged. Before publication the split may not yet exist.
  if (Number.isFinite(presentationEndMs) && a.start < presentationEndMs && c.end > presentationEndMs) return null;
  const middle = words(b.text);
  if (middle.length !== 1 || middle[0].length > 80 || !/[\p{L}\p{N}]/u.test(middle[0])) return null;
  const before = words(a.text).slice(-40).join(' ');
  const after = words(c.text).slice(0, 40).join(' ');
  if (!before || !after || before.length > 1600 || after.length > 1600) return null;
  return { id: String(index), index, speakerId: a.speaker, start: b.start,
    before, middle: middle[0], after };
}

export function collectFragmentCandidates(content, names, presentationEndMs = null) {
  const candidates = [];
  for (let i = 1; i < (content?.utterances?.length || 0) - 1; i++) {
    const candidate = fragmentCandidateAt(content, names, i, presentationEndMs);
    if (!candidate) continue;
    if (candidates.length === FRAGMENT_CANDIDATE_LIMIT) return { candidates, limited: true };
    candidates.push(candidate);
  }
  return { candidates, limited: false };
}

/** Closed DTO: only bounded references and explanations; passages remain in the private draft. */
export function projectFragmentReview(review) {
  if (!review || !['complete', 'unavailable', 'skipped'].includes(review.status)) return null;
  const warnings = review.status === 'complete' && Array.isArray(review.warnings)
    ? review.warnings.slice(0, FRAGMENT_CANDIDATE_LIMIT).filter(w => Number.isInteger(w?.index) && w.index > 0
      && typeof w.speakerId === 'string' && w.speakerId.length <= 64
      && typeof w.reason === 'string' && w.reason.length <= 240)
      .map(w => ({ index: w.index, speakerId: w.speakerId, reason: w.reason })) : [];
  return { status: review.status, limited: review.limited === true, warnings };
}
