/**
 * Presentation end (boundary) for a Site Visit transcript. Pure.
 *
 * One recording holds the research presentation and, after the applicants
 * leave, the staff discussion (plan §3 decision 1). The boundary is the end of
 * the last turn by someone outside the foundation (decision 4). It is proposed
 * here from the applied speaker names and the name candidates, and confirmed
 * by a person before anything downstream treats the transcript as split
 * (plan §4.1). Candidate classes (binding.js): `pi` and `co_pi` are outside;
 * `saved_staff` and saved roster attendees (`attendee:roster:` ids) are inside;
 * manual attendees (`attendee:manual:` ids) are outside. The inside rule for
 * roster attendees is unconfirmed on a real visit (handoff S575 §9), which is
 * why the proposal is advisory.
 */
import { formatTranscriptText } from '../transcription-pilot/transcript-format';

const FOUNDATION_SOURCES = new Set(['staff', 'saved_staff']);

function nameKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isFoundationCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return false;
  if (FOUNDATION_SOURCES.has(candidate.source)) return true;
  return typeof candidate.id === 'string' && candidate.id.startsWith('attendee:roster:');
}

/** speakerId → 'foundation' | 'outside' | 'unnamed'. A name matching any foundation candidate is inside. */
export function classifySpeakers({ speakerNames, candidates }) {
  const foundation = new Set((Array.isArray(candidates) ? candidates : [])
    .filter(isFoundationCandidate).map(candidate => nameKey(candidate.displayName)).filter(Boolean));
  const classes = new Map();
  for (const [speakerId, name] of Object.entries(speakerNames && typeof speakerNames === 'object' ? speakerNames : {})) {
    const key = nameKey(name);
    classes.set(speakerId, !key ? 'unnamed' : foundation.has(key) ? 'foundation' : 'outside');
  }
  return classes;
}

/** A short applicant line ("Same.", "Yes.") counts as possibly misattributed only when isolated. */
export const STRAY_LINE_MAX_WORDS = 3;
export const STRAY_LINE_MIN_GAP_MS = 120_000;

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * The end of the last utterance whose speaker is named and outside the
 * foundation, or null when no speaker is named or every named speaker is inside.
 * `utterances` use the parsed content shape ({ speaker, start, end, text }).
 *
 * Diarization sometimes attributes one short staff line to an applicant voice
 * deep in the staff discussion (1003222, 2026-10-05: "Same." more than ten
 * minutes after the presentation ended). A short outside line is therefore
 * skipped when it starts more than STRAY_LINE_MIN_GAP_MS after the previous
 * substantive (more than STRAY_LINE_MAX_WORDS words) outside line. A closing
 * "Thank you" sits next to the applicants' other speech and is kept. Every
 * skipped line is returned in `skipped` so the editor can show it and offer it;
 * the proposal never moves the boundary later on its own.
 */
export function proposePresentationEnd({ utterances, speakerNames, candidates }) {
  const classes = classifySpeakers({ speakerNames, candidates });
  const rows = Array.isArray(utterances) ? utterances : [];
  const outside = rows.map((row, index) => ({ row, index }))
    .filter(({ row }) => row && Number.isSafeInteger(row.end) && row.end >= 0
      && classes.get(String(row.speaker ?? '')) === 'outside');
  const skipped = [];
  for (let position = outside.length - 1; position >= 0; position -= 1) {
    const { row, index } = outside[position];
    if (wordCount(row.text) <= STRAY_LINE_MAX_WORDS) {
      const previous = outside.slice(0, position).reverse().find(({ row: earlier }) => wordCount(earlier.text) > STRAY_LINE_MAX_WORDS);
      const gapMs = previous && Number.isSafeInteger(row.start) ? row.start - previous.row.end : null;
      if (gapMs !== null && gapMs > STRAY_LINE_MIN_GAP_MS) {
        skipped.unshift({ endMs: row.end, startMs: row.start, speakerId: row.speaker ?? null, utteranceIndex: index,
          text: String(row.text || '').trim(), gapMs });
        continue;
      }
    }
    return { endMs: row.end, speakerId: row.speaker ?? null, utteranceIndex: index, skipped };
  }
  return null;
}

/** Content restricted to utterances that end at or before the boundary; the full text is not carried. */
export function presentationContent(content, endMs) {
  if (!Number.isSafeInteger(endMs) || endMs < 0) throw new TypeError('invalid_presentation_end');
  const utterances = (Array.isArray(content?.utterances) ? content.utterances : [])
    .filter(row => Number.isSafeInteger(row?.end) && row.end <= endMs);
  return { text: '', utterances };
}

/**
 * The staff discussion: the exact complement of presentationContent (utterances
 * that end after the boundary), so the two halves partition the transcript with
 * nothing lost or repeated. Empty when the boundary is the last utterance.
 */
export function staffDiscussionContent(content, endMs) {
  if (!Number.isSafeInteger(endMs) || endMs < 0) throw new TypeError('invalid_presentation_end');
  const utterances = (Array.isArray(content?.utterances) ? content.utterances : [])
    .filter(row => !(Number.isSafeInteger(row?.end) && row.end <= endMs));
  return { text: '', utterances };
}

/** The staff-discussion TXT, or null when nothing follows the boundary. */
export function buildStaffDiscussionTranscriptText(content, speakerNames, endMs) {
  const discussion = staffDiscussionContent(content, endMs);
  if (!discussion.utterances.length) return null;
  return formatTranscriptText(discussion, speakerNames, { layout: 'turn' });
}

/** The presentation-only TXT, same turn layout as the full transcript. */
export function buildPresentationTranscriptText(content, speakerNames, endMs) {
  return formatTranscriptText(presentationContent(content, endMs), speakerNames, { layout: 'turn' });
}
