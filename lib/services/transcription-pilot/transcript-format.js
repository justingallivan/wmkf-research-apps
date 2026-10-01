const MAX_SPEAKERS = 200;
const MAX_SPEAKER_NAME_LENGTH = 80;
const SPEAKER_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

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

function speakerNameFor(id, speakerNames) {
  return id && speakerNames && Object.hasOwn(speakerNames, id) && speakerNames[id]
    ? speakerNames[id] : (id ? `Speaker ${id}` : null);
}

/** Group whole utterances by the minute in which each utterance starts. */
export function groupTranscriptByMinute(content, speakerNames = {}) {
  const groups = new Map();
  for (const utterance of Array.isArray(content?.utterances) ? content.utterances : []) {
    const start = Number(utterance?.start);
    if (!Number.isFinite(start) || start < 0) continue;
    const minute = Math.floor(start / 60_000);
    if (!groups.has(minute)) groups.set(minute, []);
    groups.get(minute).push({
      start: utterance.start,
      end: utterance.end,
      speaker: utterance.speaker ?? null,
      speakerName: speakerNameFor(utterance.speaker, speakerNames),
      text: typeof utterance.text === 'string' ? utterance.text : '',
    });
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

function safePlainText(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
}

function safeVttText(value) {
  return safePlainText(value).replace(/-->/g, '—>').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Readable plain-text export with explicit one-minute sections and speaker turns. */
export function formatTranscriptText(content, speakerNames = {}) {
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
