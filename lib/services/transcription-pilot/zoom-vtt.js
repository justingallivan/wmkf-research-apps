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
  maxChars: 60_000,
  windowMs: 15_000,
  maxCues: 50_000,
  maxNameLength: 80,
  suggestionCap: 5,
  nonDiscriminativeGap: 0.1,
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
 * Attribute one cue to at most one utterance across all speaker IDs: the best wording match that
 * meets the thresholds. A near-tie (within nonDiscriminativeGap) with a candidate of a DIFFERENT
 * speaker attributes to none; a tie within one speaker is harmless and goes to the better one.
 */
function attributeCue(cue, utteranceIndex, tokensOf, settings) {
  const cueTokens = tokenizeTranscriptText(cue.text);
  const matches = [];
  for (const utterance of utteranceIndex.overlapping(cue.start - settings.windowMs, cue.end + settings.windowMs)) {
    const score = scoreTokenSets(tokensOf(utterance), cueTokens, settings);
    if (score.matched) matches.push({ utterance, overlap: score.overlap });
  }
  matches.sort((left, right) => right.overlap - left.overlap || left.utterance.index - right.utterance.index);
  if (!matches.length) return null;
  const rival = matches.find((match) => match.utterance.speakerId !== matches[0].utterance.speakerId);
  if (rival && matches[0].overlap - rival.overlap < settings.nonDiscriminativeGap + EPSILON) return null;
  return matches[0].utterance;
}

/**
 * Name-agnostic, verdict-independent evidence, cue-exclusive. `utterances` is the FULL utterance
 * list (attribution must see every speaker's words). Each distinct cue in the samples' windows is
 * attributed to at most one utterance; a name supports speaker ID X only through cues attributed
 * to X's sampled utterances. count = distinct attributed cues; pairIds = sampled utterances that
 * received at least one. Output: { [speakerId]: { [name]: { count, pairIds } } }.
 */
export function computeNameSupport(samples, utterances, zoomNames, options = {}) {
  const settings = { ...ZOOM_ALIGNMENT_DEFAULTS, ...options };
  if (!Array.isArray(zoomNames)) throw new TypeError('invalid_alignment_input');
  const allowedNames = new Set(zoomNames);
  const utteranceIndex = indexCues(usableUtterances(utterances));
  const tokenCache = new Map();
  const tokensOf = (utterance) => {
    if (!tokenCache.has(utterance)) tokenCache.set(utterance, tokenizeTranscriptText(utterance.text));
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

function supportedNames(supportForSpeaker) {
  return Object.entries(supportForSpeaker || {}).filter(([, entry]) => entry?.count >= 1)
    .sort(([leftName, left], [rightName, right]) => right.count - left.count || leftName.localeCompare(rightName));
}

function validConfidence(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Return the rejection reason for a verdict against verified support, or null when it checks out. */
function verdictRejection(verdictEntry, sole, zoomNames, minVerifiedPairs, maxCitedPairs) {
  if (!verdictEntry || typeof verdictEntry !== 'object') return 'no_verdict';
  if (typeof verdictEntry.name !== 'string' || !zoomNames.has(verdictEntry.name)) return 'name_not_in_zoom_set';
  if (!sole || verdictEntry.name !== sole.name) return 'name_not_supported';
  if (sole.count < minVerifiedPairs) return 'insufficient_support';
  const cited = verdictEntry.pairIds;
  if (!Array.isArray(cited) || cited.length > maxCitedPairs) return 'invalid_citation';
  const allowed = new Set(sole.pairIds);
  if (!cited.every((pairId) => typeof pairId === 'string' && allowed.has(pairId))) return 'invalid_citation';
  if (!validConfidence(verdictEntry.confidence)) return 'invalid_confidence';
  return null;
}

const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value));

/** Shrink in order until the JSON fits: 1 suggestion per ID, no suggestions, no pairIds. */
function fitAlignmentBytes(alignment, limit) {
  const steps = [
    () => { for (const id of Object.keys(alignment.suggestions)) alignment.suggestions[id] = alignment.suggestions[id].slice(0, 1); },
    () => { alignment.suggestions = {}; },
    () => { for (const id of Object.keys(alignment.speakers)) alignment.speakers[id].pairIds = []; },
  ];
  for (const step of steps) {
    if (jsonBytes(alignment) <= limit) break;
    step();
  }
  return alignment;
}

/**
 * Decide per speaker ID. Conflicting verified support (two or more names) abstains before the
 * verdict is read. Otherwise the verdict must name the sole supported name (>= minVerifiedPairs
 * cues), cite only that name's supporting pairs, and carry confidence >= floor to be applied;
 * a valid verdict below floor is a suggestion only. Speaker IDs come from `options.content`;
 * an ID without samples is simply not applied.
 * Required options: zoomNames (array, the closed name set) and content (transcript content).
 * Throws TypeError('invalid_alignment_input') when either is missing.
 * Returns { names, alignment }; alignment carries no excerpt text and stores confidence rounded to
 * 3 decimals, at most minVerifiedPairs + 1 pairIds per applied ID, and 5 suggestions per ID.
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
  const suggest = (id, names) => {
    if (names.length) suggestions.set(id, [...new Set(names)].slice(0, settings.suggestionCap));
  };

  for (const id of speakerIds.filter((speakerId) => withSamples.has(speakerId))) {
    const supported = supportedNames(support?.[id]);
    if (supported.length >= 2) {
      suggest(id, supported.map(([name]) => name));
      continue;
    }
    const sole = supported.length ? { name: supported[0][0], ...supported[0][1] } : null;
    const entry = verdict && typeof verdict === 'object' && Object.hasOwn(verdict, id) ? verdict[id] : null;
    const rejection = verdictRejection(entry, sole, zoomNames, settings.minVerifiedPairs, settings.maxCitedPairs);
    if (rejection) {
      suggest(id, sole ? [sole.name] : []);
      continue;
    }
    if (entry.confidence < settings.floor) { suggest(id, [sole.name]); continue; }
    try {
      normalizeSpeakerNames(content, { [id]: sole.name });
    } catch {
      continue;
    }
    applied.set(id, { name: sole.name, confidence: Math.round(entry.confidence * 1000) / 1000,
      pairIds: sole.pairIds.slice(0, settings.minVerifiedPairs + 1) });
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
  }, settings.maxAlignmentBytes);
  if (jsonBytes(alignment) > settings.maxAlignmentBytes) {
    return { names: {}, alignment: { status: 'abstained', floor: settings.floor, speakers: {}, suggestions: {} } };
  }
  return { names, alignment };
}
