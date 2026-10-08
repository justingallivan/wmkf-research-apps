const MAX_SPEAKERS = 200;
/**
 * Transcript formatter versions. '1' = whole-utterance minute sections; '2' = minute sections that may
 * split a long utterance at timed word boundaries; '3' (2026-10-04, owner decision after the Oregon
 * State rehearsal) = one paragraph per speaker TURN with the turn's start time, no minute sections,
 * because a four-minute monologue chopped at minute marks read worse than one paragraph. Published
 * bundles record their version so earlier publications rebuild byte-for-byte.
 */
export const TRANSCRIPT_FORMATTER_VERSIONS = Object.freeze(['1', '2', '3', '4', '5']);
// v4: same turn layout as v3; the bundle source and manifest carry the confirmed
// presentation end (lib/services/meeting-tracker-transcription/bundle.js).
// v5: same as v4, and the published TXT starts with a UTF-8 byte-order mark so
// SharePoint and browsers do not misread non-ASCII text as Windows-1252.
export const TRANSCRIPT_FORMATTER_VERSION = '5';
/** UTF-8 byte-order mark prefixed to published TXT files from formatter v5 on. */
export const UTF8_BOM = Object.freeze([0xef, 0xbb, 0xbf]);
const MAX_SPEAKER_NAME_LENGTH = 80;
const MAX_WORD_TIMINGS_PER_UTTERANCE = 20_000;
const SPEAKER_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;
const WORD_ALIGNMENT_GAP_PATTERN = /^[\s\p{P}]*$/u;

/** Return provider speaker IDs once each, in first-appearance order. */
export function getTranscriptSpeakers(content) {
  const seen = new Set();
  const speakers = [];
  for (const utterance of Array.isArray(content?.utterances) ? content.utterances : []) {
    const id = utterance?.speaker;
    if (typeof id === 'string' && id && !seen.has(id)) {
      seen.add(id);
      speakers.push(id);
    }
  }
  return speakers;
}

/** Validate a client overlay against IDs in the already-verified transcript. */
export function normalizeSpeakerNames(content, speakerNames) {
  if (!speakerNames || typeof speakerNames !== 'object' || Array.isArray(speakerNames)) {
    throw new TypeError('invalid_speaker_names');
  }
  const prototype = Object.getPrototypeOf(speakerNames);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('invalid_speaker_names');
  const entries = Object.entries(speakerNames);
  if (entries.length > MAX_SPEAKERS) throw new TypeError('invalid_speaker_names');
  const allowed = new Set(getTranscriptSpeakers(content));
  const normalized = [];
  for (const [id, rawName] of entries) {
    if (!SPEAKER_ID_PATTERN.test(id) || !allowed.has(id)
      || typeof rawName !== 'string' || rawName.length > MAX_SPEAKER_NAME_LENGTH
      || CONTROL_CHARACTER_PATTERN.test(rawName)) {
      throw new TypeError('invalid_speaker_names');
    }
    const name = rawName.trim();
    if (name) normalized.push([id, name]);
  }
  return Object.fromEntries(normalized);
}

/**
 * Apply per-utterance speaker reassignments ({ [utteranceIndex]: speakerId }) recorded by the Zoom
 * alignment, including server-recorded additional `zoom_N` IDs for split identities. Returns a new
 * content object; the stored transcript Blob is never rewritten. Invalid
 * entries (bad index, unknown speaker ID, malformed shape) are ignored rather than thrown, so a
 * corrupt map can never make a transcript unreadable.
 */
export function applySpeakerReassignments(content, reassigned, additionalSpeakerIds = []) {
  if (!content || typeof content !== 'object' || !Array.isArray(content.utterances)
    || !reassigned || typeof reassigned !== 'object' || Array.isArray(reassigned)) return content;
  const known = new Set(getTranscriptSpeakers(content));
  // Only server-recorded Zoom identities may extend the provider's speaker set.
  if (Array.isArray(additionalSpeakerIds) && additionalSpeakerIds.length <= MAX_SPEAKERS) {
    for (const id of additionalSpeakerIds) {
      if (typeof id === 'string' && /^zoom_[0-9]+$/.test(id) && id.length <= 32 && known.size < MAX_SPEAKERS) known.add(id);
    }
  }
  let changed = false;
  const utterances = content.utterances.slice();
  for (const [key, speaker] of Object.entries(reassigned)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= utterances.length || typeof speaker !== 'string'
      || !known.has(speaker) || !utterances[index] || utterances[index].speaker === speaker) continue;
    utterances[index] = { ...utterances[index], speaker };
    changed = true;
  }
  return changed ? { ...content, utterances } : content;
}

function speakerNameFor(id, speakerNames) {
  return id && speakerNames && Object.hasOwn(speakerNames, id) && speakerNames[id]
    ? speakerNames[id] : (id ? `Speaker ${id}` : null);
}

/** Return timing words only when they align in order with the exact utterance text. */
export function normalizeUtteranceWordTimings(utterance) {
  const input = utterance?.words;
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_WORD_TIMINGS_PER_UTTERANCE
    || typeof utterance?.text !== 'string'
    || !Number.isFinite(utterance.start) || !Number.isFinite(utterance.end)) return null;
  let cursor = 0;
  let priorStart = utterance.start;
  const words = [];
  for (const word of input) {
    if (!word || !Number.isFinite(word.start) || !Number.isFinite(word.end)
      || word.start < utterance.start || word.end > utterance.end || word.end < word.start
      || word.start < priorStart || typeof word.text !== 'string' || !word.text.length || word.text.length > 1000) return null;
    const spanStart = utterance.text.indexOf(word.text, cursor);
    if (spanStart < cursor
      || !WORD_ALIGNMENT_GAP_PATTERN.test(utterance.text.slice(cursor, spanStart))) return null;
    const spanEnd = spanStart + word.text.length;
    words.push({ start: Math.round(word.start), end: Math.round(word.end), text: word.text, spanStart, spanEnd });
    cursor = spanEnd;
    priorStart = word.start;
  }
  if (!WORD_ALIGNMENT_GAP_PATTERN.test(utterance.text.slice(cursor))) return null;
  return words;
}

function minuteSegments(utterance) {
  const words = normalizeUtteranceWordTimings(utterance);
  if (!words) return [{ minute: Math.floor(utterance.start / 60_000), start: utterance.start,
    end: utterance.end, text: utterance.text }];
  const segments = [];
  let minute = Math.floor(words[0].start / 60_000);
  let textStart = 0;
  let start = words[0].start;
  let end = words[0].end;
  for (let index = 1; index < words.length; index++) {
    const word = words[index];
    const wordMinute = Math.floor(word.start / 60_000);
    if (wordMinute !== minute) {
      segments.push({ minute, start, end, text: utterance.text.slice(textStart, word.spanStart) });
      minute = wordMinute;
      textStart = word.spanStart;
      start = word.start;
    }
    end = word.end;
  }
  segments.push({ minute, start, end, text: utterance.text.slice(textStart) });
  return segments;
}

/** Group exact utterance text slices by each minute containing timed words. */
export function groupTranscriptByMinute(content, speakerNames = {}) {
  const groups = new Map();
  for (const utterance of Array.isArray(content?.utterances) ? content.utterances : []) {
    const start = Number(utterance?.start);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(Number(utterance?.end))
      || typeof utterance?.text !== 'string') continue;
    for (const segment of minuteSegments(utterance)) {
      if (!groups.has(segment.minute)) groups.set(segment.minute, []);
      groups.get(segment.minute).push({
        start: segment.start,
        end: segment.end,
        speaker: utterance.speaker ?? null,
        speakerName: speakerNameFor(utterance.speaker, speakerNames),
        text: segment.text,
      });
    }
  }
  return [...groups.entries()].sort(([left], [right]) => left - right)
    .map(([minute, utterances]) => ({ minute, utterances }));
}

function clockTime(milliseconds, includeMilliseconds = false) {
  const ms = Math.max(0, Math.round(Number(milliseconds) || 0));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const remainder = ms % 1000;
  const time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return includeMilliseconds ? `${time}.${String(remainder).padStart(3, '0')}` : time;
}

export function formatTranscriptMinuteHeading(minute) {
  return `${minute}:00`;
}

/** MM:SS label for a turn start, or H:MM:SS once the recording passes one hour. */
export function formatTranscriptTurnTime(milliseconds) {
  const ms = Math.max(0, Math.round(Number(milliseconds) || 0));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0');
  const seconds = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0');
  return hours ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

/**
 * Merge consecutive utterances by the same speaker ID into one turn. Text is joined with a single
 * space; utterance boundaries inside a turn are not marked. Speaker null never merges with an ID.
 */
export function groupTranscriptByTurn(content, speakerNames = {}) {
  const turns = [];
  const ordered = (Array.isArray(content?.utterances) ? content.utterances : [])
    .map((utterance, index) => ({ utterance, index }))
    .filter(({ utterance }) => Number.isFinite(Number(utterance?.start)) && Number(utterance.start) >= 0
      && Number.isFinite(Number(utterance?.end)) && typeof utterance?.text === 'string')
    .sort((left, right) => Number(left.utterance.start) - Number(right.utterance.start) || left.index - right.index);
  for (const { utterance } of ordered) {
    const start = Number(utterance.start);
    const end = Number(utterance.end);
    const speaker = utterance.speaker ?? null;
    const text = utterance.text.trim();
    const last = turns[turns.length - 1];
    if (last && speaker !== null && last.speaker === speaker) {
      last.end = Math.max(last.end, end);
      if (text) last.text = last.text ? `${last.text} ${text}` : text;
      continue;
    }
    turns.push({ start, end, speaker, speakerName: speakerNameFor(speaker, speakerNames), text });
  }
  return turns;
}

function safePlainText(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
}

function safeVttText(value) {
  return safePlainText(value).replace(/--!?>/g, '—>').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Readable plain-text export. layout 'turn' (formatter v3, default): one paragraph per speaker turn,
 * each prefixed with its start time. layout 'minute' (formatter v1/v2): one-minute sections.
 */
export function formatTranscriptText(content, speakerNames = {}, { layout = 'turn' } = {}) {
  if (layout === 'turn') {
    const turns = groupTranscriptByTurn(content, speakerNames);
    if (!turns.length) return `${safePlainText(content?.text)}\n`;
    return turns.map((turn) => {
      const speaker = turn.speakerName ? `${turn.speakerName}: ` : '';
      return `[${formatTranscriptTurnTime(turn.start)}] ${speaker}${safePlainText(turn.text)}`;
    }).join('\n\n') + '\n';
  }
  const groups = groupTranscriptByMinute(content, speakerNames);
  if (!groups.length) return `${safePlainText(content?.text)}\n`;
  return groups.map(({ minute, utterances }) => {
    const paragraphs = utterances.map((utterance) => {
      const speaker = utterance.speakerName ? `${utterance.speakerName}: ` : '';
      return `${speaker}${safePlainText(utterance.text)}`;
    });
    return `${formatTranscriptMinuteHeading(minute)}\n${paragraphs.join('\n\n')}`;
  }).join('\n\n') + '\n';
}

/** WebVTT export preserves provider timestamps while applying safe display names. */
export function formatTranscriptVtt(content, speakerNames = {}) {
  const cues = [];
  for (const utterance of Array.isArray(content?.utterances) ? content.utterances : []) {
    const speakerName = speakerNameFor(utterance.speaker, speakerNames);
    const speaker = speakerName ? `${safeVttText(speakerName)}: ` : '';
    cues.push(`${clockTime(utterance.start, true)} --> ${clockTime(utterance.end, true)}\n${speaker}${safeVttText(utterance.text)}`);
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}
