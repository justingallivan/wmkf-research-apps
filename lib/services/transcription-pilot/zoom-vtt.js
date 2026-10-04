/**
 * Zoom VTT speaker alignment: pure functions, no I/O.
 *
 * Contract (plan ZOOM_VTT_SPEAKER_MAPPING_PLAN_2026-10-04, section 2):
 * - A Zoom VTT carries `Display Name: text` cues. AssemblyAI utterances carry anonymous speaker IDs.
 * - Time overlap only ORDERS candidates (`buildAlignmentPrior`); it is never evidence.
 * - The decision rests on matching WORDING between an utterance and a cue carrying a name
 *   (`computeNameSupport`), computed without consulting the model. Each Zoom cue is attributed to
 *   at most ONE utterance across all speaker IDs (best wording match; a near-tie between speakers
 *   attributes to none), so a neighbour's or an echoing speaker's words cannot earn a name.
 * - `verifyAlignmentVerdict` applies a model verdict only when it agrees with that verified
 *   support. Conflicting support abstains BEFORE the verdict is read, so selective citation
 *   cannot hide a conflict. The guarantee is bounded to the sampled evidence.
 * - Output names pass through `normalizeSpeakerNames`; `alignment` never carries excerpt text.
 * - Name-keyed maps are built with Object.fromEntries so a hostile name such as `__proto__`
 *   becomes an ordinary own key.
 */
import { getTranscriptSpeakers, normalizeSpeakerNames } from './transcript-format.js';

/** Initial constants; calibrated on the owner's sample pair before the floor is finalized. */
export const ZOOM_ALIGNMENT_DEFAULTS = Object.freeze({
  floor: 0.8,
  minContentWords: 6,
  minTokenOverlap: 0.5,
  minVerifiedPairs: 2,
  minPerSpeaker: 4,
  maxPerSpeaker: 10,
  maxChars: 160_000,
  windowMs: 15_000,
  maxCues: 50_000,
  maxNameLength: 80,
  suggestionCap: 5,
  ambiguityShareRatio: 0.65,
  dominanceRatio: 0.2,
  reassignMaxWords: 3,
  reassignToleranceMs: 500,
  reassignMaxCount: 2000,
  supportConfidenceStep: 0.015,
  supportConfidenceCap: 0.95,
  maxSampleUtteranceChars: 1500,
  maxSampleCueChars: 600,
  maxSampleCueTotalChars: 3000,
  maxAlignmentBytes: 65_536,
  maxCitedPairs: 100,
});

const TIMESTAMP = '(?:\\d{1,3}:)?\\d{1,2}:\\d{2}\\.\\d{3}';
const CUE_TIMING_LINE = new RegExp(`^\\s*(${TIMESTAMP})\\s+-->\\s+(${TIMESTAMP})(?:\\s.*)?$`);
const HEADER_LINE = /^WEBVTT(?:[ \t]|$)/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const NAME_DELIMITER = ': ';
const EPSILON = 1e-9;

/** Small English stop-word list; matching relies on content words only. */
const STOP_WORDS = new Set((
  'a about above after again all also am an and any are as at be because been before being below but by '
  + 'can could did do does doing down during each few for from further had has have having he her here hers '
  + 'him his how i if in into is it its just me more most my no nor not now of off on once only or other our '
  + 'ours out over own same she should so some such than that the their theirs them then there these they this '
  + 'those through to too under until up very was we were what when where which while who whom why will with '
  + 'would you your yours yeah yes okay ok um uh oh well like really going get got'
).split(' '));

function cleanText(value) {
  return String(value ?? '').replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
}

function parseTimestamp(value) {
  const parts = value.split(':');
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
}

function splitSpeakerPrefix(firstLine, maxNameLength) {
  const at = firstLine.indexOf(NAME_DELIMITER);
  if (at < 1) return { name: null, rest: firstLine };
  const name = firstLine.slice(0, at).trim();
  if (!name || name.length > maxNameLength) return { name: null, rest: firstLine };
  return { name, rest: firstLine.slice(at + NAME_DELIMITER.length) };
}

/**
 * Parse Zoom WebVTT into millisecond cues and the distinct display names (first-appearance order).
 * Tolerates BOM, CRLF, header metadata, missing index lines, `MM:SS.mmm` times, multi-line bodies.
 * The name delimiter is the first `: ` of the cue's first text line. Throws TypeError('invalid_vtt').
 */
export function parseZoomVtt(text, { maxCues = ZOOM_ALIGNMENT_DEFAULTS.maxCues,
  maxNameLength = ZOOM_ALIGNMENT_DEFAULTS.maxNameLength } = {}) {
  if (typeof text !== 'string') throw new TypeError('invalid_vtt');
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  if (!HEADER_LINE.test(lines[0])) throw new TypeError('invalid_vtt');
  const cues = [];
  const names = new Set();
  let seen = 0;
  let i = 1;
  while (i < lines.length) {
    const timing = CUE_TIMING_LINE.exec(lines[i]);
    i += 1;
    if (!timing) continue;
    seen += 1;
    if (seen > maxCues) throw new TypeError('invalid_vtt');
    const body = [];
    while (i < lines.length && lines[i].trim() !== '' && !CUE_TIMING_LINE.test(lines[i])) {
      body.push(lines[i]);
      i += 1;
    }
    const start = parseTimestamp(timing[1]);
    const end = parseTimestamp(timing[2]);
    if (end < start || !body.length) continue;
    const { name, rest } = splitSpeakerPrefix(cleanText(body[0]), maxNameLength);
    const cueText = cleanText([rest, ...body.slice(1)].join(' '));
    if (!cueText) continue;
    cues.push({ start, end, name, text: cueText });
    if (name) names.add(name);
  }
  return { cues, names: [...names] };
}

function usableUtterances(utterances) {
  const usable = [];
  (Array.isArray(utterances) ? utterances : []).forEach((utterance, index) => {
    if (typeof utterance?.speaker === 'string' && utterance.speaker
      && Number.isFinite(utterance.start) && Number.isFinite(utterance.end)
      && typeof utterance.text === 'string' && utterance.text.trim()) {
      usable.push({ index, speakerId: utterance.speaker, start: utterance.start,
        end: utterance.end, text: utterance.text.trim() });
    }
  });
  return usable;
}

/** Cues sorted by start, with a lookup for those overlapping a time range. */
function indexCues(cues) {
  const sorted = (Array.isArray(cues) ? cues : [])
    .filter((cue) => Number.isFinite(cue?.start) && Number.isFinite(cue?.end)
      && typeof cue.text === 'string')
    .sort((left, right) => left.start - right.start);
  const maxDuration = sorted.reduce((max, cue) => Math.max(max, cue.end - cue.start), 0);
  function overlapping(from, to) {
    let low = 0;
    let high = sorted.length;
    const floorStart = from - maxDuration;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (sorted[mid].start < floorStart) low = mid + 1; else high = mid;
    }
    const found = [];
    for (let at = low; at < sorted.length && sorted[at].start <= to; at++) {
      if (sorted[at].end >= from) found.push(sorted[at]);
    }
    return found;
  }
  return { overlapping };
}

/**
 * Per speaker ID, overlapped milliseconds per Zoom name, sorted descending.
 * ORDERING ONLY: a shifted VTT yields a confidently wrong prior, which is why wording decides.
 */
export function buildAlignmentPrior(utterances, cues) {
  const { overlapping } = indexCues(cues);
  const bySpeaker = new Map();
  for (const utterance of usableUtterances(utterances)) {
    for (const cue of overlapping(utterance.start, utterance.end)) {
      if (!cue.name) continue;
      const overlap = Math.min(utterance.end, cue.end) - Math.max(utterance.start, cue.start);
      if (overlap <= 0) continue;
      if (!bySpeaker.has(utterance.speakerId)) bySpeaker.set(utterance.speakerId, new Map());
      const totals = bySpeaker.get(utterance.speakerId);
      totals.set(cue.name, (totals.get(cue.name) || 0) + overlap);
    }
  }
  return Object.fromEntries([...bySpeaker].map(([speakerId, totals]) => [
    speakerId,
    [...totals].map(([name, overlapMs]) => ({ name, overlapMs }))
      .sort((left, right) => right.overlapMs - left.overlapMs || left.name.localeCompare(right.name)),
  ]));
}

/** Evenly spaced buckets over time-ordered utterances; the longest in each bucket wins. */
function pickSpread(list, count) {
  if (list.length <= count) return list.slice();
  const picked = [];
  for (let bucket = 0; bucket < count; bucket++) {
    const from = Math.floor((bucket * list.length) / count);
    const to = Math.floor(((bucket + 1) * list.length) / count);
    let best = list[from];
    for (let at = from + 1; at < to; at++) if (list[at].text.length > best.text.length) best = list[at];
    picked.push(best);
  }
  return picked;
}

function cueGap(cue, start, end) {
  if (cue.end < start) return start - cue.end;
  return cue.start > end ? cue.start - end : 0;
}

/** Cues near the kept span, closest first until the per-sample cue budget is spent, in time order. */
function nearestCues(cues, start, end, maxChars) {
  const kept = [];
  let chars = 0;
  for (const cue of cues.map((item) => ({ item, gap: cueGap(item, start, end) }))
    .sort((left, right) => left.gap - right.gap || left.item.start - right.item.start)) {
    if (chars + cue.item.text.length > maxChars) break;
    chars += cue.item.text.length;
    kept.push(cue.item);
  }
  return kept.sort((left, right) => left.start - right.start);
}

function buildSample(utterance, cueIndex, { windowMs, maxSampleUtteranceChars, maxSampleCueChars,
  maxSampleCueTotalChars }) {
  const keptShare = Math.min(1, maxSampleUtteranceChars / utterance.text.length);
  const keptEnd = utterance.start + (utterance.end - utterance.start) * keptShare;
  const nearby = cueIndex.overlapping(utterance.start - windowMs, keptEnd + windowMs)
    .filter((cue) => cue.name)
    .map((cue) => ({ name: cue.name, start: cue.start, end: cue.end, text: cue.text.slice(0, maxSampleCueChars) }));
  return {
    pairId: `${utterance.speakerId}-${utterance.index}`,
    speakerId: utterance.speakerId,
    start: utterance.start,
    end: utterance.end,
    text: utterance.text.slice(0, maxSampleUtteranceChars),
    cues: nearestCues(nearby, utterance.start, keptEnd, maxSampleCueTotalChars),
  };
}

function sampleCost(sample) {
  return sample.text.length + sample.cues.reduce((sum, cue) => sum + cue.text.length, 0);
}

/**
 * Pick utterances for the model and for support checks. Every speaker ID first receives
 * `minPerSpeaker` samples spread across the recording (longer utterances preferred); the rest
 * fill round-robin up to `maxPerSpeaker` until `maxChars`. The reserved minimum is never dropped:
 * `truncated` means extras were left out for budget, `reservedOverBudget` means the reserved
 * samples alone exceed `maxChars`. Each sample is bounded (kept text span, per-sample cue chars).
 */
export function sampleAlignmentPairs(utterances, cues, options = {}) {
  const settings = { ...ZOOM_ALIGNMENT_DEFAULTS, ...options };
  const cueIndex = indexCues(cues);
  const bySpeaker = new Map();
  for (const utterance of usableUtterances(utterances)) {
    if (!bySpeaker.has(utterance.speakerId)) bySpeaker.set(utterance.speakerId, []);
    bySpeaker.get(utterance.speakerId).push(utterance);
  }
  const chosen = new Map();
  let chars = 0;
  const take = (utterance) => {
    const sample = buildSample(utterance, cueIndex, settings);
    chosen.set(sample.pairId, sample);
    chars += sampleCost(sample);
  };
  const extras = new Map();
  for (const [speakerId, list] of bySpeaker) {
    const reserved = pickSpread(list, settings.minPerSpeaker);
    reserved.forEach(take);
    const reservedSet = new Set(reserved);
    extras.set(speakerId, list.filter((utterance) => !reservedSet.has(utterance))
      .sort((left, right) => right.text.length - left.text.length || left.index - right.index));
  }
  const reservedOverBudget = chars > settings.maxChars;
  let truncated = false;
  const room = Math.max(0, settings.maxPerSpeaker - settings.minPerSpeaker);
  fill: for (let round = 0; round < room; round++) {
    for (const [speakerId] of bySpeaker) {
      const utterance = extras.get(speakerId)[round];
      if (!utterance) continue;
      const cost = sampleCost(buildSample(utterance, cueIndex, settings));
      if (chars + cost > settings.maxChars) { truncated = true; break fill; }
      take(utterance);
    }
  }
  const order = [...bySpeaker.keys()];
  const samples = [...chosen.values()].sort((left, right) => order.indexOf(left.speakerId)
    - order.indexOf(right.speakerId) || left.start - right.start || (left.pairId < right.pairId ? -1 : 1));
  return { samples, truncated, reservedOverBudget };
}

/** Lowercased content words (punctuation and stop words removed) as a Set. */
export function tokenizeTranscriptText(text) {
  const words = new Set();
  const cleaned = String(text ?? '').toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ');
  for (const word of cleaned.split(' ')) if (word.length > 1 && !STOP_WORDS.has(word)) words.add(word);
  return words;
}

/**
 * Compare two texts by shared content words. overlap = shared / min(|A|, |B|) so caption and ASR
 * length differences do not penalize a true match. matched needs both thresholds.
 */
export function scoreTextMatch(left, right, { minContentWords = ZOOM_ALIGNMENT_DEFAULTS.minContentWords,
  minTokenOverlap = ZOOM_ALIGNMENT_DEFAULTS.minTokenOverlap } = {}) {
  return scoreTokenSets(tokenizeTranscriptText(left), tokenizeTranscriptText(right), { minContentWords, minTokenOverlap });
}

function scoreTokenSets(a, b, { minContentWords, minTokenOverlap }) {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  const smaller = Math.min(a.size, b.size);
  const overlap = smaller ? shared / smaller : 0;
  return { shared, overlap, matched: shared >= minContentWords && overlap >= minTokenOverlap };
}

/**
 * Attribute one cue to at most one utterance across all speaker IDs. Candidates meeting the
 * eligibility thresholds are ranked by ABSOLUTE shared content words first (a short echo cannot
 * outrank the fuller original on overlap alone), then by overlap. The cue is attributed to NONE
 * when any candidate of a DIFFERENT speaker has shared >= ambiguityShareRatio x best.shared.
 * Overlap is not an ambiguity signal: a short echo scores overlap 1.0 against a long caption.
 * Candidates of the same speaker never conflict.
 * Once ambiguous, time is a TIE-BREAKER among ALL wording-eligible candidates (every speaker,
 * including the best speaker's other utterances), never evidence by itself: when every candidate
 * whose span truly overlaps the cue span (not the +/- window) belongs to ONE speaker ID, the
 * top-ranked overlapping utterance takes the cue; two or more overlapping identities, or none, is none.
 * (Codex round 2, 2026-10-04: filtering only rivals let a concurrent same-speaker utterance vanish
 * from the time check, handing the cue to the other speaker.)
 */
function attributeCue(cue, utteranceIndex, tokensOf, settings) {
  const cueTokens = tokenizeTranscriptText(cue.text);
  const matches = [];
  for (const utterance of utteranceIndex.overlapping(cue.start - settings.windowMs, cue.end + settings.windowMs)) {
    const score = scoreTokenSets(tokensOf(utterance), cueTokens, settings);
    if (score.matched) matches.push({ utterance, shared: score.shared, overlap: score.overlap });
  }
  matches.sort((left, right) => right.shared - left.shared || right.overlap - left.overlap
    || left.utterance.index - right.utterance.index);
  if (!matches.length) return null;
  const [best] = matches;
  const rivals = matches.filter((match) => match.utterance.speakerId !== best.utterance.speakerId
    && match.shared >= settings.ambiguityShareRatio * best.shared - EPSILON);
  if (!rivals.length) return best.utterance;
  const overlapping = matches.filter(({ utterance }) => utterance.start < cue.end && utterance.end > cue.start);
  const identities = new Set(overlapping.map(({ utterance }) => utterance.speakerId));
  return identities.size === 1 ? overlapping[0].utterance : null;
}

/**
 * Name-agnostic, verdict-independent evidence, cue-exclusive. `utterances` is the FULL utterance
 * list (attribution must see every speaker's words). Each distinct cue in the samples' windows is
 * attributed to at most one utterance; a name supports speaker ID X only through cues attributed
 * to X's sampled utterances. count = distinct attributed cues; pairIds = sampled utterances that
 * received at least one. Output: { [speakerId]: { [name]: { count, pairIds } } }.
 * Every utterance (sampled or not) is tokenized from its first `maxSampleUtteranceChars` only, the
 * same slice buildSample renders, so no word the model could not see can win, lose, or break a tie
 * (Codex rounds 3 and 4, 2026-10-04: full-text attribution let wording past the slice earn support,
 * then out-rank an otherwise identical visible rival).
 */
export function computeNameSupport(samples, utterances, zoomNames, options = {}) {
  const settings = { ...ZOOM_ALIGNMENT_DEFAULTS, ...options };
  if (!Array.isArray(zoomNames)) throw new TypeError('invalid_alignment_input');
  const allowedNames = new Set(zoomNames);
  const utteranceIndex = indexCues(usableUtterances(utterances));
  const tokenCache = new Map();
  const tokensOf = (utterance) => {
    if (!tokenCache.has(utterance)) {
      tokenCache.set(utterance, tokenizeTranscriptText(utterance.text.slice(0, settings.maxSampleUtteranceChars)));
    }
    return tokenCache.get(utterance);
  };
  const sampled = new Set((Array.isArray(samples) ? samples : []).map((sample) => sample.pairId));
  const bySpeaker = new Map();
  const seenCues = new Set();
  for (const sample of Array.isArray(samples) ? samples : []) {
    if (!bySpeaker.has(sample.speakerId)) bySpeaker.set(sample.speakerId, new Map());
    for (const cue of sample.cues) {
      if (!allowedNames.has(cue.name)) continue;
      const key = JSON.stringify([cue.name, cue.start, cue.end, cue.text]);
      if (seenCues.has(key)) continue;
      seenCues.add(key);
      const winner = attributeCue(cue, utteranceIndex, tokensOf, settings);
      const pairId = winner && `${winner.speakerId}-${winner.index}`;
      if (!pairId || !sampled.has(pairId)) continue;
      if (!bySpeaker.has(winner.speakerId)) bySpeaker.set(winner.speakerId, new Map());
      const entries = bySpeaker.get(winner.speakerId);
      if (!entries.has(cue.name)) entries.set(cue.name, { count: 0, pairIds: new Set() });
      const entry = entries.get(cue.name);
      entry.count += 1;
      entry.pairIds.add(pairId);
    }
  }
  return Object.fromEntries([...bySpeaker].map(([speakerId, entries]) => [speakerId, Object.fromEntries(
    [...entries].map(([name, entry]) => [name, { count: entry.count, pairIds: [...entry.pairIds] }]))]));
}

const NAME_SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'phd', 'ph.d.', 'md', 'm.d.', 'esq', 'esq.', 'dds', 'do']);
const NAME_PART = /^\p{L}[\p{L}\p{M}'’. -]*$/u;

/**
 * Display form of a Zoom display name. Zoom participants type their own names, and some use
 * "Surname, Given"; staff names in this system read "Given Surname". Exactly one comma, two
 * alphabetic parts, and a second part that is not a suffix (Jr, PhD, ...) is reordered; anything
 * else is returned unchanged. The Zoom original stays in the stored alignment as `zoomName`
 * (owner request 2026-10-04 after the Oregon State rehearsal rendered "Balbas, Andrea").
 */
export function zoomDisplayName(name) {
  if (typeof name !== 'string') return name;
  const match = name.trim().match(/^([^,]+),([^,]+)$/);
  if (!match) return name;
  const surname = match[1].trim();
  const given = match[2].trim();
  if (!surname || !given || !NAME_PART.test(surname) || !NAME_PART.test(given)) return name;
  if (NAME_SUFFIXES.has(given.toLowerCase())) return name;
  return `${given} ${surname}`;
}

/**
 * Display form for every name in a closed Zoom set, collision-aware: when two DISTINCT Zoom names
 * would share a display form (e.g. "Lee, Jordan" and "Jordan Lee"), every member of that group
 * keeps its original so distinct participants stay distinguishable in published transcripts
 * (Codex review, 2026-10-04). Returns Map<original, display>.
 */
export function zoomDisplayNames(zoomNames) {
  const display = new Map();
  const owners = new Map();
  for (const name of new Set(Array.isArray(zoomNames) ? zoomNames : [])) {
    if (typeof name !== 'string') continue;
    const shown = zoomDisplayName(name);
    display.set(name, shown);
    if (!owners.has(shown)) owners.set(shown, new Set());
    owners.get(shown).add(name);
  }
  for (const [name, shown] of display) if (owners.get(shown).size > 1) display.set(name, name);
  return display;
}

/**
 * Diarizers hand very short utterances ("Right.", "Yeah.") to the wrong voice. A short provider
 * utterance (<= reassignMaxWords words) is reassigned only on AFFIRMATIVE Zoom evidence:
 *   - its span is covered CONTINUOUSLY (gaps/edges within reassignToleranceMs) by Zoom cues that all
 *     carry one name; the bounding span of separate cues is not coverage,
 *   - unless every word is a meaning-free backchannel (BACKCHANNEL_WORDS: right, yeah, okay...),
 *     every word of the utterance appears in those cues' text. Zoom routinely drops backchannels
 *     (it dropped Andrea's "right" at the rehearsal's 41:25), so for those containment is enough:
 *     misplacing a listener's "uh-huh" costs nothing. A content word ("No.", "Wait.") can change a
 *     transcript's meaning, so it moves only when Zoom demonstrably captioned it from that
 *     participant (Codex review 2026-10-04: an uncaptioned dial-in interjection must never be
 *     handed to whoever was captioned nearby),
 *   - that name is applied to exactly one OTHER speaker ID,
 *   - and the utterance's time neighbour (previous or next) belongs to that ID.
 * Two names captioning that moment, a name applied to two IDs (diarization split), no applied ID,
 * a word missing from the captions, or a span outside the cues all leave the utterance alone.
 * Owner decision 2026-10-04 (Oregon State rehearsal, 41:25).
 * `appliedZoomNames` is { speakerId: Zoom original name }. Returns { reassigned: { [utteranceIndex]:
 * speakerId }, considered, reassignedCount } with indices into the ORIGINAL utterance array.
 */
/**
 * Listener backchannels. Exempt from the captioned-word test ONLY while the captioned speaker is
 * continuously talking through them (see coverage below), which is what a backchannel is. Evaluative
 * words (correct, absolutely, good, great...) are deliberately absent: they can be substantive
 * (Codex review round 2, 2026-10-04). Residual, owner-accepted risk: a simultaneous "yes" spoken over
 * someone's uninterrupted speech is treated as a backchannel.
 */
const BACKCHANNEL_WORDS = new Set(['right', 'yeah', 'yes', 'yep', 'okay', 'ok', 'sure', 'exactly',
  'mhm', 'mm', 'hmm', 'hm', 'mmhmm', 'uhhuh', 'uh', 'um', 'oh', 'ah']);

/**
 * True when the cue intervals cover [start, end] continuously. Gaps between cues may be at most
 * `tolerance` ms; the allowance at either edge is capped at half the utterance's duration, so a
 * cue that ends before a short utterance begins can never count as covering it. The bounding span
 * of several cues is NOT coverage: two cues with a silent gap between them must not bridge an
 * utterance nobody captioned (Codex review round 2, 2026-10-04).
 */
function cuesCoverSpan(cues, start, end, tolerance) {
  const edge = Math.min(tolerance, Math.max(0, (end - start) / 2));
  let reached = start;
  for (const cue of [...cues].sort((left, right) => left.start - right.start)) {
    if (cue.end <= reached) continue;
    if (cue.start > reached + (reached === start ? edge : tolerance)) return false;
    reached = cue.end;
    if (reached >= end - edge) return true;
  }
  return reached >= end - edge;
}

/** Lower-cased letter/digit words with no stop-word filtering ("right", "no", "yes" must count). */
function rawWords(text) {
  return String(text ?? '').toLowerCase().replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
}

export function reassignShortUtterances(utterances, cues, appliedZoomNames, options = {}) {
  const settings = { ...ZOOM_ALIGNMENT_DEFAULTS, ...options };
  const idsByName = new Map();
  for (const [id, name] of Object.entries(appliedZoomNames || {})) {
    if (typeof name !== 'string' || !name) continue;
    if (!idsByName.has(name)) idsByName.set(name, new Set());
    idsByName.get(name).add(id);
  }
  const list = (Array.isArray(utterances) ? utterances : []).map((utterance, index) => ({ utterance, index }))
    .filter(({ utterance }) => utterance && Number.isFinite(Number(utterance.start)) && Number.isFinite(Number(utterance.end))
      && typeof utterance.text === 'string' && typeof utterance.speaker === 'string');
  const ordered = [...list].sort((a, b) => Number(a.utterance.start) - Number(b.utterance.start) || a.index - b.index);
  const position = new Map(ordered.map((entry, at) => [entry.index, at]));
  const namedCues = (Array.isArray(cues) ? cues : []).filter((cue) => cue && cue.name && Number.isFinite(cue.start) && Number.isFinite(cue.end));
  const reassigned = {};
  let considered = 0;
  let count = 0;
  for (const { utterance, index } of list) {
    const words = utterance.text.trim().split(/\s+/).filter(Boolean).length;
    if (!words || words > settings.reassignMaxWords) continue;
    considered += 1;
    const start = Number(utterance.start) - settings.reassignToleranceMs;
    const end = Number(utterance.end) + settings.reassignToleranceMs;
    const covering = namedCues.filter((cue) => cue.start < end && cue.end > start);
    const names = new Set(covering.map((cue) => cue.name));
    if (names.size !== 1) continue;
    // Coverage: the cues of that one name must cover the whole utterance continuously (not merely touch it).
    if (!cuesCoverSpan(covering, Number(utterance.start), Number(utterance.end), settings.reassignToleranceMs)) continue;
    // Wording: every word the diarizer heard must appear in what Zoom captioned for that participant.
    const captioned = new Set(covering.flatMap((cue) => rawWords(cue.text)));
    const heard = rawWords(utterance.text);
    if (!heard.length) continue;
    if (!heard.every((word) => BACKCHANNEL_WORDS.has(word) || captioned.has(word))) continue;
    const ids = idsByName.get([...names][0]);
    if (!ids || ids.size !== 1) continue;
    const [target] = ids;
    if (target === utterance.speaker) continue;
    const at = position.get(index);
    const prev = ordered[at - 1]?.utterance.speaker;
    const next = ordered[at + 1]?.utterance.speaker;
    if (prev !== target && next !== target) continue;
    if (count >= settings.reassignMaxCount) break;
    reassigned[String(index)] = target;
    count += 1;
  }
  return { reassigned, considered, reassignedCount: count };
}

function supportedNames(supportForSpeaker) {
  return Object.entries(supportForSpeaker || {}).filter(([, entry]) => entry?.count >= 1)
    .sort(([leftName, left], [rightName, right]) => right.count - left.count || leftName.localeCompare(rightName));
}

function validConfidence(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Pick the dominant name from one speaker's support table, or explain why there is none.
 * Dominant: leader.count >= minVerifiedPairs AND runnerUp.count <= dominanceRatio x leader.count.
 * A 3:1 split is a conflict (1 > 0.6); 30:4 and 50:1 are dominant (Oregon State rehearsal,
 * 2026-10-04: one stray crosstalk cue was blocking a 50:1 result under the old any-second-name rule).
 */
function dominantName(supportForSpeaker, { minVerifiedPairs, dominanceRatio }) {
  const ranked = supportedNames(supportForSpeaker);
  if (!ranked.length) return { reason: 'no_support', ranked };
  const [[name, leader], runnerUp] = ranked;
  if (runnerUp && runnerUp[1].count > dominanceRatio * leader.count + EPSILON) return { reason: 'conflict', ranked };
  if (leader.count < minVerifiedPairs) return { reason: 'insufficient_support', ranked };
  return { name, count: leader.count, pairIds: leader.pairIds, ranked };
}

/** Confidence derived from verified wording support alone: floor at minVerifiedPairs, rising per extra cue. */
function supportConfidence(count, settings) {
  return Math.min(settings.supportConfidenceCap, settings.floor + settings.supportConfidenceStep * Math.max(0, count - settings.minVerifiedPairs));
}

/**
 * Classify the model's verdict for one speaker against the dominant name.
 *   agree     -> name matches; confidence is the model's when valid
 *   veto      -> a DIFFERENT closed-list name at or above floor; the speaker abstains
 *   abstain   -> null, missing, malformed, not in the closed list, or a different name below floor
 */
function classifyVerdict(entry, dominant, zoomNames, floor) {
  if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !zoomNames.has(entry.name)) return { kind: 'abstain' };
  if (entry.name === dominant) return { kind: 'agree', confidence: validConfidence(entry.confidence) ? entry.confidence : null };
  if (validConfidence(entry.confidence) && entry.confidence >= floor) return { kind: 'veto', name: entry.name };
  return { kind: 'abstain' };
}

const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value));

/** Shrink in order until the JSON fits: 1 suggestion per ID, no suggestions, no pairIds, no reasons, no basis. */
function fitAlignmentBytes(alignment, limit) {
  const steps = [
    () => { for (const id of Object.keys(alignment.suggestions)) alignment.suggestions[id] = alignment.suggestions[id].slice(0, 1); },
    () => { alignment.suggestions = {}; },
    () => { for (const id of Object.keys(alignment.speakers)) alignment.speakers[id].pairIds = []; },
    () => { alignment.reasons = {}; },
    () => { for (const id of Object.keys(alignment.speakers)) delete alignment.speakers[id].basis; },
  ];
  for (const step of steps) {
    if (jsonBytes(alignment) <= limit) break;
    step();
  }
  return alignment;
}

/**
 * Decide per speaker ID. Our own verified wording support decides; the model is a VETO, not a gate
 * (owner decision 2026-10-04 after the Oregon State rehearsal, where the model declined two speakers
 * whose names our code had verified 11 and 12 times over).
 *   1. Dominance on `options.conflictSupport` (support over the FULL sampled set; defaults to
 *      `support`): a runner-up above dominanceRatio x leader is a conflict -> abstain, both names
 *      suggested. Conflicts present only in trimmed samples therefore still block.
 *   2. Dominance on `support` (samples the model actually saw): the leader must be the same name
 *      with count >= minVerifiedPairs, or the speaker abstains (insufficient_support / no_support).
 *   3. The verdict: agree -> applied with the model's confidence (basis 'model'); a different
 *      closed-list name at or above floor -> veto, abstain with both names suggested; anything else
 *      (null, missing, malformed, below-floor disagreement) -> applied with a support-derived
 *      confidence (basis 'support'). Citations no longer gate application; the service still
 *      neutralises citations of unseen pairs before calling this.
 * Speaker IDs come from `options.content`; an ID without samples is simply not applied.
 * Required options: zoomNames (array, the closed name set) and content (transcript content).
 * Throws TypeError('invalid_alignment_input') when either is missing.
 * Applied and suggested names pass through zoomDisplayNames(options.zoomNames) ("Surname, Given" ->
 * "Given Surname", except where two distinct Zoom names would collide, which keep their originals);
 * when that changed the name, the applied entry also carries the original as `zoomName`.
 * Returns { names, alignment }; alignment carries no excerpt text and stores confidence rounded to
 * 3 decimals, at most minVerifiedPairs + 1 pairIds per applied ID, `basis` per applied ID,
 * `reasons` (speaker ID -> code) for every sampled ID that was not applied, and 5 suggestions per ID.
 * Byte bound (maxAlignmentBytes): trim suggestions to 1 per ID, then drop suggestions, then drop
 * pairIds. If the JSON is STILL too large, fail closed: names {} and alignment
 * { status: 'abstained', speakers: {}, suggestions: {} }. Status changes only in that final step.
 */
export function verifyAlignmentVerdict(samples, support, verdict, options = {}) {
  if (!Array.isArray(options.zoomNames) || !options.content || typeof options.content !== 'object') {
    throw new TypeError('invalid_alignment_input');
  }
  const settings = { ...ZOOM_ALIGNMENT_DEFAULTS, ...options };
  const { content } = options;
  const speakerIds = getTranscriptSpeakers(content);
  const withSamples = new Set((Array.isArray(samples) ? samples : []).map((sample) => sample.speakerId));
  const zoomNames = new Set(options.zoomNames);
  const applied = new Map();
  const suggestions = new Map();
  const displayNames = zoomDisplayNames(options.zoomNames);
  const shown = (name) => displayNames.get(name) ?? name;
  const suggest = (id, names) => {
    if (names.length) suggestions.set(id, [...new Set(names.map(shown))].slice(0, settings.suggestionCap));
  };

  const conflictSupport = options.conflictSupport || support;
  const reasons = new Map();
  for (const id of speakerIds.filter((speakerId) => withSamples.has(speakerId))) {
    const full = dominantName(conflictSupport?.[id], settings);
    if (full.reason === 'conflict') {
      reasons.set(id, 'conflict');
      suggest(id, full.ranked.map(([name]) => name));
      continue;
    }
    const visible = dominantName(support?.[id], settings);
    if (visible.name && !zoomNames.has(visible.name)) {
      reasons.set(id, 'name_not_in_zoom_set');
      continue;
    }
    if (visible.reason || (full.name && visible.name !== full.name)) {
      reasons.set(id, visible.reason === 'conflict' ? 'conflict' : visible.reason || 'insufficient_support');
      suggest(id, visible.ranked.map(([name]) => name));
      continue;
    }
    const entry = verdict && typeof verdict === 'object' && Object.hasOwn(verdict, id) ? verdict[id] : null;
    const classified = classifyVerdict(entry, visible.name, zoomNames, settings.floor);
    if (classified.kind === 'veto') {
      reasons.set(id, 'model_veto');
      suggest(id, [visible.name, classified.name]);
      continue;
    }
    const displayName = shown(visible.name);
    try {
      normalizeSpeakerNames(content, { [id]: displayName });
    } catch {
      reasons.set(id, 'invalid_name');
      continue;
    }
    const fromModel = classified.kind === 'agree' && classified.confidence !== null && classified.confidence >= settings.floor;
    const confidence = fromModel ? classified.confidence : supportConfidence(visible.count, settings);
    applied.set(id, { name: displayName, confidence: Math.round(confidence * 1000) / 1000,
      basis: fromModel ? 'model' : 'support', pairIds: visible.pairIds.slice(0, settings.minVerifiedPairs + 1),
      ...(displayName !== visible.name ? { zoomName: visible.name } : {}) });
  }

  const names = normalizeSpeakerNames(content, Object.fromEntries([...applied].map(([id, value]) => [id, value.name])));
  let status = 'abstained';
  if (!zoomNames.size) status = 'no_speakers';
  else if (applied.size && applied.size === speakerIds.length) status = 'applied';
  else if (applied.size) status = 'partial';
  const alignment = fitAlignmentBytes({
    status,
    floor: settings.floor,
    speakers: Object.fromEntries(applied),
    suggestions: Object.fromEntries(suggestions),
    reasons: Object.fromEntries(reasons),
  }, settings.maxAlignmentBytes);
  if (jsonBytes(alignment) > settings.maxAlignmentBytes) {
    return { names: {}, alignment: { status: 'abstained', floor: settings.floor, speakers: {}, suggestions: {}, reasons: {} } };
  }
  return { names, alignment };
}
