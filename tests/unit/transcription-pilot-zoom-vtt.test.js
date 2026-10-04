import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ZOOM_ALIGNMENT_DEFAULTS, buildAlignmentPrior, computeNameSupport, parseZoomVtt, sampleAlignmentPairs,
  scoreTextMatch, tokenizeTranscriptText, verifyAlignmentVerdict,
} from '../../lib/services/transcription-pilot/zoom-vtt';

// All names and text are synthetic.
const fixture = (name) => readFileSync(path.join(__dirname, '../fixtures/zoom-vtt', name), 'utf8');
const AVERY = 'Avery Lin';
const JORDAN = 'Park, Jordan';
const RILEY = 'Riley Stone';
const ids = { [AVERY]: 'A', [JORDAN]: 'B', [RILEY]: 'C' };
const cue = (start, end, name, text) => ({ start, end, name, text });

// Distinct nine-word sentence per k; no word repeats across k, so no accidental overlap.
const BASES = ['ledger', 'harbor', 'meadow', 'compass', 'lantern', 'orchard', 'quarry', 'beacon', 'thistle'];
const sentence = (k) => BASES.map((base) => `${base}${k}`).join(' ');

/** One utterance per entry, 60 s apart, with a caption cue of the same words under `zoomName`. */
function scenario(entries) {
  const utterances = [];
  const cues = [];
  entries.forEach(([speaker, zoomName, k, asrText], index) => {
    const start = index * 60_000;
    utterances.push({ start, end: start + 10_000, speaker, text: asrText ?? sentence(k) });
    if (zoomName) cues.push(cue(start, start + 10_000, zoomName, sentence(k)));
  });
  return { utterances, cues };
}

function pipeline(entries, zoomNames, options = {}) {
  const { utterances, cues } = scenario(entries);
  const { samples } = sampleAlignmentPairs(utterances, cues, options);
  const support = computeNameSupport(samples, utterances, zoomNames);
  return { utterances, cues, samples, support, content: { utterances }, opts: { zoomNames, content: { utterances } } };
}

const cite = (support, id, name) => support[id][name].pairIds;

describe('parseZoomVtt', () => {
  const body = '1\n00:00:01.000 --> 00:00:02.500\nAvery Lin: Hello there.\n\n';

  test.each([
    ['BOM', `﻿WEBVTT\n\n${body}`],
    ['CRLF', `WEBVTT\r\n\r\n${body.replace(/\n/g, '\r\n')}`],
    ['header metadata', `WEBVTT - exported by a meeting tool\nKind: captions\n\n${body}`],
  ])('accepts header variant: %s', (_label, text) => {
    // Fails if the BOM strip, line-ending split, or header regex is removed.
    expect(parseZoomVtt(text).cues).toEqual([cue(1000, 2500, AVERY, 'Hello there.')]);
  });

  test('tolerates missing index lines, MM:SS.mmm times, and multi-line cue bodies', () => {
    // Fails if the parser requires an index line, an HH: prefix, or stops at the first body line.
    const text = 'WEBVTT\n\n00:01.000 --> 00:03.000\nAvery Lin: First line\nsecond line\n\n'
      + '3\n00:00:04.000 --> 00:00:05.000\nJordan Park: Next.\n';
    expect(parseZoomVtt(text).cues).toEqual([
      cue(1000, 3000, AVERY, 'First line second line'),
      cue(4000, 5000, 'Jordan Park', 'Next.'),
    ]);
  });

  test('keeps commas in names and splits only on the first colon-space', () => {
    // Fails if the delimiter is the last ": ", or if the name stops at a comma.
    const text = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nPark, Jordan: Plan: confirm the date: Friday.\n';
    expect(parseZoomVtt(text).cues[0]).toEqual(cue(0, 2000, JORDAN, 'Plan: confirm the date: Friday.'));
  });

  test('cue without a name prefix yields name null and no names', () => {
    // Fails if lines without "Name: " are dropped or given a fabricated name.
    const parsed = parseZoomVtt('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nJust some words\n');
    expect(parsed).toEqual({ cues: [cue(0, 2000, null, 'Just some words')], names: [] });
  });

  test('dedupes names in first-appearance order and drops over-long names to null', () => {
    // Fails if names are not deduped/ordered or maxNameLength is not enforced.
    const longName = 'N'.repeat(81);
    const text = `WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nRiley Stone: a\n\n00:00:01.000 --> 00:00:02.000\n${AVERY}: b\n\n`
      + `00:00:02.000 --> 00:00:03.000\nRiley Stone: c\n\n00:00:03.000 --> 00:00:04.000\n${longName}: d\n`;
    const parsed = parseZoomVtt(text);
    expect(parsed.names).toEqual([RILEY, AVERY]);
    expect(parsed.cues[3].name).toBeNull();
  });

  test('strips control characters and skips cues that end before they start', () => {
    // Fails if control characters survive in names/text or backwards cues are kept.
    const text = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nAve\u0007ry Lin: he\u0000llo\n\n'
      + '00:00:05.000 --> 00:00:03.000\nAvery Lin: backwards\n';
    const parsed = parseZoomVtt(text);
    expect(parsed.cues).toHaveLength(1);
    expect(parsed.cues[0].name).toBe('Ave ry Lin');
    expect(parsed.cues[0].text).toBe('he llo');
  });

  test('rejects a missing header, non-strings, and too many cues', () => {
    // Fails if any of the three guards is removed.
    expect(() => parseZoomVtt('00:00:00.000 --> 00:00:01.000\nA: b\n')).toThrow(new TypeError('invalid_vtt'));
    expect(() => parseZoomVtt('NOTWEBVTT\n')).toThrow(TypeError);
    expect(() => parseZoomVtt(null)).toThrow(TypeError);
    const three = 'WEBVTT\n\n'.concat([0, 1, 2].map((i) => `00:00:0${i}.000 --> 00:00:0${i}.500\nA B: x${i}\n\n`).join(''));
    expect(parseZoomVtt(three, { maxCues: 3 }).cues).toHaveLength(3);
    expect(() => parseZoomVtt(three, { maxCues: 2 })).toThrow(new TypeError('invalid_vtt'));
  });

  test('the synthetic fixture parses to 12 cues and three names', () => {
    const parsed = parseZoomVtt(fixture('meeting.vtt'));
    expect(parsed.cues).toHaveLength(12);
    expect(parsed.names).toEqual([AVERY, JORDAN, RILEY]);
    expect(parsed.cues[7].text).toContain('next phase: confirm');
  });
});

describe('buildAlignmentPrior', () => {
  test('orders names by overlapped milliseconds', () => {
    // Fails if overlap is miscomputed (e.g. whole-cue length) or the sort is not descending.
    const utterances = [{ start: 0, end: 10_000, speaker: 'A', text: 'x' }];
    const cues = [cue(0, 7000, AVERY, 'a'), cue(7000, 12_000, JORDAN, 'b'), cue(20_000, 30_000, RILEY, 'c')];
    expect(buildAlignmentPrior(utterances, cues)).toEqual({
      A: [{ name: AVERY, overlapMs: 7000 }, { name: JORDAN, overlapMs: 3000 }],
    });
  });

  test('a VTT shifted by 30 s on alternating turns yields the WRONG prior (why it only orders)', () => {
    // This documents that timing alone is misleading; the decision must come from wording.
    const { cues } = parseZoomVtt(fixture('meeting.vtt'));
    const utterances = cues.map((c, i) => ({ start: c.start, end: c.end, speaker: ids[c.name], text: `u${i}` }));
    const right = buildAlignmentPrior(utterances, cues);
    const shifted = buildAlignmentPrior(utterances, cues.map((c) => ({ ...c, start: c.start + 30_000, end: c.end + 30_000 })));
    expect(right.A[0].name).toBe(AVERY);
    expect(shifted.A[0].name).not.toBe(AVERY);
    expect(shifted.A[0].overlapMs).toBeGreaterThan(0);
  });
});

describe('sampleAlignmentPairs', () => {
  const dominant = () => {
    const entries = [];
    for (let i = 0; i < 100; i++) entries.push(['A', AVERY, i]);
    'BCDEFGH'.split('').forEach((speaker, s) => {
      for (let i = 0; i < 4 + (s % 2); i++) entries.push([speaker, null, 1000 + s * 10 + i]);
    });
    return scenario(entries);
  };
  const countBy = (samples) => samples.reduce((acc, s) => ({ ...acc, [s.speakerId]: (acc[s.speakerId] || 0) + 1 }), {});

  test('eight speakers, one dominant: every ID gets at least minPerSpeaker, capped at maxPerSpeaker', () => {
    // Fails if reservation is global (dominant speaker crowds out the rest) or the cap is removed.
    const { utterances, cues } = dominant();
    const { samples, truncated } = sampleAlignmentPairs(utterances, cues);
    const counts = countBy(samples);
    expect(Object.keys(counts)).toHaveLength(8);
    for (const count of Object.values(counts)) expect(count).toBeGreaterThanOrEqual(ZOOM_ALIGNMENT_DEFAULTS.minPerSpeaker);
    expect(counts.A).toBe(ZOOM_ALIGNMENT_DEFAULTS.maxPerSpeaker);
    expect(truncated).toBe(false);
  });

  test('reserved picks are spread across the recording and pairIds are deterministic', () => {
    // Fails if reserved samples are the first N utterances instead of evenly spaced.
    const { utterances, cues } = dominant();
    const first = sampleAlignmentPairs(utterances, cues, { maxPerSpeaker: 4 });
    const again = sampleAlignmentPairs(utterances, cues, { maxPerSpeaker: 4 });
    expect(again).toEqual(first);
    const picks = first.samples.filter((s) => s.speakerId === 'A').map((s) => Number(s.pairId.split('-')[1]));
    expect(picks).toHaveLength(4);
    expect(Math.min(...picks)).toBeLessThan(25);
    expect(Math.max(...picks)).toBeGreaterThanOrEqual(75);
  });

  test('maxChars truncates extras, sets truncated, and keeps the reserved minimum', () => {
    // Fails if the budget also drops reserved samples, or truncated is never reported.
    const { utterances, cues } = dominant();
    const { samples, truncated, reservedOverBudget } = sampleAlignmentPairs(utterances, cues, { maxChars: 50 });
    expect(truncated).toBe(true);
    expect(reservedOverBudget).toBe(true);
    const counts = countBy(samples);
    expect(Object.keys(counts)).toHaveLength(8);
    for (const count of Object.values(counts)) expect(count).toBe(ZOOM_ALIGNMENT_DEFAULTS.minPerSpeaker);
  });

  test('reservedOverBudget is reported separately from truncated', () => {
    // Fails if the two flags are conflated: nothing extra exists here, so truncated stays false.
    const utterances = [{ start: 0, end: 10_000, speaker: 'A', text: sentence(1) }];
    const result = sampleAlignmentPairs(utterances, [], { maxChars: 10 });
    expect(result.reservedOverBudget).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.samples).toHaveLength(1);
  });

  test('each sample carries only cues inside the window, on both sides', () => {
    // Fails if the window filter is removed (far cues appear) or too narrow (near cues vanish).
    const utterances = [{ start: 100_000, end: 110_000, speaker: 'A', text: 'hello there' }];
    const cues = [cue(80_000, 90_000, AVERY, 'near'), cue(10_000, 20_000, JORDAN, 'far'),
      cue(120_000, 125_000, RILEY, 'after'), cue(0, 60_000, 'X', 'long ago'),
      cue(70_000, 75_000, 'Y', 'just before the window'), cue(130_000, 135_000, 'Z', 'just after the window')];
    const { samples } = sampleAlignmentPairs(utterances, cues, { windowMs: 15_000 });
    expect(samples[0].cues.map((c) => c.name)).toEqual([AVERY, RILEY]);
  });

  test('the cue window follows the kept text span: a cue just before the start beats a far cue inside the full span', () => {
    // Fails if the window uses the full utterance end (keptShare = 1): the far cue (gap 0) would
    // out-rank the before-start cues for the cue budget and appear in the sample.
    const filler = 'word '.repeat(150);
    const cues = [90, 91, 92, 93, 94].map((t) => cue(t * 1000, (t + 5) * 1000, AVERY, filler));
    cues.push(cue(300_000, 305_000, 'Far', filler));
    const utterances = [{ start: 100_000, end: 400_000, speaker: 'A', text: 'x '.repeat(3000) }];
    const { samples } = sampleAlignmentPairs(utterances, cues);
    expect(samples[0].cues.map((c) => c.name)).toEqual(Array(5).fill(AVERY));
  });

  test('a 5-minute utterance with a cue every 3 s yields one bounded sample', () => {
    // Fails if the utterance text, the window, or the per-sample cue total is left unbounded.
    const cues = [];
    for (let t = 0; t < 330_000; t += 3000) cues.push(cue(t, t + 3000, AVERY, 'word '.repeat(150)));
    const utterances = [{ start: 15_000, end: 315_000, speaker: 'A', text: 'x '.repeat(3000) }];
    const { samples, reservedOverBudget } = sampleAlignmentPairs(utterances, cues);
    expect(samples).toHaveLength(1);
    const cueChars = samples[0].cues.reduce((sum, c) => sum + c.text.length, 0);
    expect(samples[0].text.length).toBeLessThanOrEqual(ZOOM_ALIGNMENT_DEFAULTS.maxSampleUtteranceChars);
    expect(cueChars).toBeLessThanOrEqual(ZOOM_ALIGNMENT_DEFAULTS.maxSampleCueTotalChars);
    expect(samples[0].cues.length).toBeGreaterThan(0);
    expect(reservedOverBudget).toBe(false);
  });
});

describe('tokenizer and scoreTextMatch', () => {
  test('lowercases, strips punctuation and stop words', () => {
    expect([...tokenizeTranscriptText("The Budget, isn't it? Yes! Forecast.")]).toEqual(['budget', 'isnt', 'forecast']);
  });

  test('ASR wording differences within threshold still match (7 of 9 content words)', () => {
    // Fails if the thresholds are removed or the denominator changes (shared and overlap are pinned).
    const caption = 'quarterly budget forecast requires careful review approving additional regional';
    const asr = 'quarterly budget forecast requires careful review approving extra local';
    const score = scoreTextMatch(asr, caption);
    expect(score.shared).toBe(7);
    expect(score.overlap).toBeCloseTo(7 / 9, 5);
    expect(score.matched).toBe(true);
  });

  test('overlap uses the smaller set, so a short true quote inside long caption text matches', () => {
    // Fails if the denominator becomes max(|A|,|B|) (overlap would be 0.33).
    const short = sentence(1);
    const long = `${short} ${Array.from({ length: 18 }, (_, i) => `filler${i}x`).join(' ')}`;
    expect(scoreTextMatch(short, long).matched).toBe(true);
  });
});

describe('computeNameSupport (cue-exclusive)', () => {
  test('exact-wording matches count per name with their pairIds', () => {
    // Fails if matching is not computed or pairIds are not recorded.
    const { support } = pipeline([['A', AVERY, 1], ['A', AVERY, 2], ['A', AVERY, 3]], [AVERY]);
    expect(support.A[AVERY].count).toBe(3);
    expect(support.A[AVERY].pairIds).toHaveLength(3);
  });

  test('caption-vs-ASR wording differences still count', () => {
    // Fails if the match requires exact text.
    const caption = 'quarterly budget forecast requires careful review approving additional regional';
    const asr = 'quarterly budget forecast requires careful review approving extra local';
    const utterances = [{ start: 0, end: 10_000, speaker: 'A', text: asr }];
    const { samples } = sampleAlignmentPairs(utterances, [cue(0, 10_000, AVERY, caption)]);
    expect(computeNameSupport(samples, utterances, [AVERY]).A[AVERY].count).toBe(1);
  });

  test('a repeated short phrase does not count (below minContentWords)', () => {
    // Fails if minContentWords is dropped: "yes thank you" style phrases would give support.
    const phrase = 'Yes, thank you very much, great point.';
    const { utterances } = scenario([0, 1, 2, 3, 4].map((i) => ['A', AVERY, i, phrase]));
    const cues = utterances.map((u) => cue(u.start, u.end, AVERY, phrase));
    const { samples } = sampleAlignmentPairs(utterances, cues);
    expect(computeNameSupport(samples, utterances, [AVERY])).toEqual({ A: {} });
  });

  test('a cue matching two speakers at near-equal overlap is attributed to neither', () => {
    // Fails if the near-tie rule is removed (the cue would go to one speaker).
    const utterances = [{ start: 0, end: 10_000, speaker: 'A', text: sentence(1) },
      { start: 2000, end: 9000, speaker: 'B', text: sentence(1) }];
    const cues = [cue(0, 10_000, AVERY, sentence(1))];
    const { samples } = sampleAlignmentPairs(utterances, cues);
    expect(computeNameSupport(samples, utterances, [AVERY])).toEqual({ A: {}, B: {} });
  });

  test('a clearly better match (gap above 0.1) is attributed to that speaker only', () => {
    // Fails if the tie rule discards every multi-candidate cue.
    const partial = `${BASES.slice(0, 6).map((b) => `${b}1`).join(' ')} extra1x extra2x extra3x extra4x`;
    const utterances = [{ start: 0, end: 10_000, speaker: 'A', text: sentence(1) },
      { start: 2000, end: 9000, speaker: 'B', text: partial }];
    const { samples } = sampleAlignmentPairs(utterances, [cue(0, 10_000, AVERY, sentence(1))]);
    const support = computeNameSupport(samples, utterances, [AVERY]);
    expect(support.A[AVERY].count).toBe(1);
    expect(support.B).toEqual({});
  });

  test('a tie between two utterances of the SAME speaker still attributes to that speaker', () => {
    // Fails if same-speaker candidates are treated as a cross-speaker conflict.
    const utterances = [{ start: 0, end: 5000, speaker: 'A', text: sentence(1) },
      { start: 5000, end: 10_000, speaker: 'A', text: sentence(2) }];
    const cues = [cue(0, 10_000, AVERY, `${sentence(1)} ${sentence(2)}`)];
    const { samples } = sampleAlignmentPairs(utterances, cues);
    expect(computeNameSupport(samples, utterances, [AVERY]).A[AVERY].count).toBe(1);
  });

  test('a cue best matching an UNSAMPLED utterance credits nothing, even if that speaker has other samples', () => {
    // Fails if the sampled-only filter is removed: B-1 would be credited with a count and a pairId.
    const utterances = [
      { start: 0, end: 10_000, speaker: 'B', text: `${sentence(2)} ${Array.from({ length: 12 }, (_, i) => `padding${i}x`).join(' ')}` },
      { start: 20_000, end: 30_000, speaker: 'B', text: sentence(1) },
    ];
    const cues = [cue(20_000, 30_000, AVERY, sentence(1))];
    const { samples } = sampleAlignmentPairs(utterances, cues, { minPerSpeaker: 1, maxPerSpeaker: 1 });
    expect(samples.map((x) => x.pairId)).toEqual(['B-0']);
    expect(samples[0].cues).toHaveLength(1);
    expect(computeNameSupport(samples, utterances, [AVERY])).toEqual({ B: {} });
  });

  test('zoomNames is required', () => {
    expect(() => computeNameSupport([], [], undefined)).toThrow(new TypeError('invalid_alignment_input'));
  });

  test('cues outside zoomNames are ignored', () => {
    // Fails if the closed name set is not applied when counting support.
    const { samples, utterances } = pipeline([['A', AVERY, 1]], [AVERY]);
    expect(computeNameSupport(samples, utterances, ['Someone Else'])).toEqual({ A: {} });
  });
});

describe('verifyAlignmentVerdict', () => {
  const ok = (support, id, name, confidence = 0.9) => ({ name, confidence, pairIds: cite(support, id, name) });
  const contentFor = (...speakers) => ({ utterances: speakers.map((speaker) => ({ speaker })) });

  test('requires zoomNames and content', () => {
    // Fails if the required-options guard is removed (silent derivation of the closed set or IDs).
    const { samples, support, content } = pipeline([['A', AVERY, 1], ['A', AVERY, 2]], [AVERY]);
    expect(() => verifyAlignmentVerdict(samples, support, {}, { content })).toThrow(new TypeError('invalid_alignment_input'));
    expect(() => verifyAlignmentVerdict(samples, support, {}, { zoomNames: [AVERY] })).toThrow(new TypeError('invalid_alignment_input'));
    expect(() => verifyAlignmentVerdict(samples, support, {}, { zoomNames: 'x', content })).toThrow(TypeError);
  });

  test('an ID from content with no samples is not applied, giving status partial', () => {
    // Fails if speaker IDs come from the samples (status would be applied) or the ID is auto-named.
    const p = pipeline([['A', AVERY, 1], ['A', AVERY, 2], ['B', null, 3]], [AVERY]);
    const samples = p.samples.filter((s) => s.speakerId === 'A');
    const result = verifyAlignmentVerdict(samples, p.support, { A: ok(p.support, 'A', AVERY), B: { name: AVERY, confidence: 1, pairIds: [] } },
      p.opts);
    expect(result.names).toEqual({ A: AVERY });
    expect(result.alignment.status).toBe('partial');
  });

  test('split: one name across two IDs, each with verified support, applies to both', () => {
    // Fails if a name may be used once only, or per-ID support is not evaluated independently.
    const entries = [];
    for (let i = 0; i < 4; i++) entries.push(['A', AVERY, i], ['B', AVERY, 10 + i]);
    const p = pipeline(entries, [AVERY]);
    const result = verifyAlignmentVerdict(p.samples, p.support, { A: ok(p.support, 'A', AVERY), B: ok(p.support, 'B', AVERY) }, p.opts);
    expect(result.names).toEqual({ A: AVERY, B: AVERY });
    expect(result.alignment.status).toBe('applied');
    expect(result.alignment.speakers.A.pairIds).toHaveLength(ZOOM_ALIGNMENT_DEFAULTS.minVerifiedPairs + 1);
    expect(JSON.stringify(result.alignment)).not.toContain('ledger');
  });

  test.each([[2, 2], [3, 1]])('merge %i:%i abstains with both suggested, even at 0.99 citing only the majority', (a, b) => {
    // Fails if conflict detection moves after the verdict, or uses minVerifiedPairs as the conflict threshold.
    const entries = [];
    for (let i = 0; i < a; i++) entries.push(['A', AVERY, i]);
    for (let i = 0; i < b; i++) entries.push(['A', JORDAN, 20 + i]);
    const p = pipeline(entries, [AVERY, JORDAN]);
    const result = verifyAlignmentVerdict(p.samples, p.support, { A: ok(p.support, 'A', AVERY, 0.99) }, p.opts);
    expect(result.names).toEqual({});
    expect(result.alignment.status).toBe('abstained');
    expect(result.alignment.suggestions.A.sort()).toEqual([AVERY, JORDAN].sort());
  });

  test('fabricated citation (pair whose cue does not match) is rejected', () => {
    // Fails if citations are not checked against the verified supporting pairs.
    const entries = [['A', AVERY, 1], ['A', AVERY, 2], ['A', AVERY, 3], ['A', JORDAN, 4]];
    const { utterances, cues } = scenario(entries);
    cues[3] = cue(180_000, 190_000, JORDAN, sentence(99)); // caption wording differs from the utterance
    const { samples } = sampleAlignmentPairs(utterances, cues);
    const support = computeNameSupport(samples, utterances, [AVERY, JORDAN]);
    expect(Object.keys(support.A)).toEqual([AVERY]);
    const opts = { zoomNames: [AVERY, JORDAN], content: { utterances } };
    const unsupported = samples.map((s) => s.pairId).find((id) => !support.A[AVERY].pairIds.includes(id));
    const verdict = { A: { name: AVERY, confidence: 0.99, pairIds: [...support.A[AVERY].pairIds.slice(0, 2), unsupported] } };
    const result = verifyAlignmentVerdict(samples, support, verdict, opts);
    expect(result.names).toEqual({});
    expect(result.alignment.suggestions.A).toEqual([AVERY]);
    for (const bad of ['A-999', 'B-0', 42]) {
      const other = verifyAlignmentVerdict(samples, support, { A: { name: AVERY, confidence: 0.99, pairIds: [bad] } }, opts);
      expect(other.names).toEqual({});
    }
  });

  test('a cited pair belonging to another speaker is rejected', () => {
    // Fails if citations are matched by id existence only.
    const p = pipeline([['A', AVERY, 1], ['A', AVERY, 2], ['B', AVERY, 3], ['B', AVERY, 4]], [AVERY]);
    const verdict = { A: { name: AVERY, confidence: 0.95, pairIds: [cite(p.support, 'B', AVERY)[0]] } };
    expect(verifyAlignmentVerdict(p.samples, p.support, verdict, p.opts).names).toEqual({});
  });

  test('more than 100 cited pairIds is rejected', () => {
    // Fails if the citation-count cap is removed (a valid id repeated 101 times would pass).
    const p = pipeline([['A', AVERY, 1], ['A', AVERY, 2], ['A', AVERY, 3]], [AVERY]);
    const [valid] = cite(p.support, 'A', AVERY);
    const run = (n) => verifyAlignmentVerdict(p.samples, p.support,
      { A: { name: AVERY, confidence: 0.99, pairIds: Array(n).fill(valid) } }, p.opts);
    expect(run(100).names).toEqual({ A: AVERY });
    expect(run(101).names).toEqual({});
  });

  test('a verdict name outside the closed Zoom name set is rejected even if support names it', () => {
    // Fails if the closed-set check is removed: the hand-built support below names Casey Rowe.
    const support = { A: { 'Casey Rowe': { count: 3, pairIds: ['A-0', 'A-1', 'A-2'] } } };
    const samples = [{ pairId: 'A-0', speakerId: 'A' }];
    const verdict = { A: { name: 'Casey Rowe', confidence: 0.99, pairIds: ['A-0'] } };
    const result = verifyAlignmentVerdict(samples, support, verdict, { zoomNames: [AVERY], content: contentFor('A') });
    expect(result.names).toEqual({});
  });

  test('verdict name differing from the sole supported name is rejected', () => {
    // Fails if the verdict name is trusted over the verified support.
    const p = pipeline([['A', AVERY, 1], ['A', AVERY, 2], ['A', AVERY, 3]], [AVERY, JORDAN]);
    const verdict = { A: { name: JORDAN, confidence: 0.99, pairIds: cite(p.support, 'A', AVERY) } };
    const result = verifyAlignmentVerdict(p.samples, p.support, verdict, p.opts);
    expect(result.names).toEqual({});
    expect(result.alignment.suggestions.A).toEqual([AVERY]);
  });

  test('a sole supported name below minVerifiedPairs is not applied', () => {
    // Fails if minVerifiedPairs is not enforced.
    const p = pipeline([['A', AVERY, 1], ['A', null, 2], ['A', null, 3]], [AVERY]);
    expect(p.support.A[AVERY].count).toBe(1);
    const result = verifyAlignmentVerdict(p.samples, p.support, { A: ok(p.support, 'A', AVERY, 0.99) }, p.opts);
    expect(result.names).toEqual({});
  });

  test('confidence below the floor is a suggestion only (0.6 and 0.3); invalid confidence is rejected', () => {
    // Fails if the floor is not applied, a sub-0.5 verdict loses its suggestion, or NaN/out-of-range passes.
    const p = pipeline([['A', AVERY, 1], ['A', AVERY, 2], ['A', AVERY, 3]], [AVERY]);
    const run = (confidence) => verifyAlignmentVerdict(p.samples, p.support, { A: ok(p.support, 'A', AVERY, confidence) }, p.opts);
    for (const low of [0.6, 0.3]) {
      expect(run(low).names).toEqual({});
      expect(run(low).alignment.suggestions.A).toEqual([AVERY]);
    }
    expect(run(0.8).names).toEqual({ A: AVERY });
    expect(run(1.5).names).toEqual({});
    expect(run(Number.NaN).names).toEqual({});
  });

  describe('end to end on the synthetic fixtures', () => {
    const zoomNames = [AVERY, JORDAN, RILEY];
    const parsed = parseZoomVtt(fixture('meeting.vtt')).cues;
    const utterances = parsed.map((c) => ({ start: c.start, end: c.end, speaker: ids[c.name],
      text: c.text.toLowerCase().replace(/[,.:]/g, '') }));
    const run = (cues, verdictFor) => {
      const { samples } = sampleAlignmentPairs(utterances, cues);
      const support = computeNameSupport(samples, utterances, zoomNames);
      const prior = buildAlignmentPrior(utterances, cues);
      const verdict = Object.fromEntries(['A', 'B', 'C'].map((id) => [id, verdictFor(id, support, prior)]));
      return { support, prior, result: verifyAlignmentVerdict(samples, support, verdict, { zoomNames, content: { utterances } }) };
    };
    const supportedVerdict = (id, support) => {
      const name = Object.keys(support[id])[0] ?? AVERY;
      return { name, confidence: 0.9, pairIds: support[id][name]?.pairIds ?? [] };
    };
    const shift = (ms) => parsed.map((c) => ({ ...c, start: c.start + ms, end: c.end + ms }));

    test('control: the aligned fixture applies all three names', () => {
      // Guards the negative tests below: proves the fixture succeeds when aligned.
      const { result, prior } = run(parsed, supportedVerdict);
      expect(result.names).toEqual({ A: AVERY, B: JORDAN, C: RILEY });
      expect(result.alignment.status).toBe('applied');
      expect(prior.A[0].name).toBe(AVERY);
    });

    test('a shift inside the window keeps the correct names', () => {
      // Fails if wording support depended on exact timing instead of the +/- window.
      const { result } = run(shift(5000), supportedVerdict);
      expect(result.names).toEqual({ A: AVERY, B: JORDAN, C: RILEY });
    });

    test.each([30_000, 45_000])('a %i ms shift (beyond window plus inter-turn gap) abstains even if the verdict follows the wrong prior', (ms) => {
      // Invariant: when the VTT time base is off by more than windowMs + the gap between turns, a
      // confident time-following verdict must still abstain. Fails if the prior or verdict can apply a name.
      const { result, support, prior } = run(shift(ms), (id, _support, p) => ({ name: p[id]?.[0]?.name ?? AVERY, confidence: 0.95, pairIds: [] }));
      expect(Object.values(support).every((entries) => Object.keys(entries).length === 0)).toBe(true);
      expect(prior.A?.[0]?.name).not.toBe(AVERY); // wrong at 30 s, absent at 45 s
      expect(result.names).toEqual({});
      expect(result.alignment.status).toBe('abstained');
    });

    test('unrelated fixture (different text, same timing) abstains', () => {
      // Fails if timing alone can produce support.
      const { result } = run(parseZoomVtt(fixture('unrelated.vtt')).cues, () => ({ name: AVERY, confidence: 0.99, pairIds: [] }));
      expect(result.names).toEqual({});
      expect(result.alignment.status).toBe('abstained');
    });
  });

  describe('cue-exclusive attribution (neighbour cues cannot earn a name)', () => {
    test('an uncaptioned speaker echoing a captioned speaker gets no name; the captioned one does', () => {
      // Fails without cue-exclusive attribution: B's echo would match A's cues and B would be named Avery.
      const utterances = [];
      const cues = [];
      for (let i = 0; i < 4; i++) {
        const t = i * 60_000;
        const a = `facilities committee approved replacing aging laboratory ventilation equipment summer closure item${i}`;
        utterances.push({ start: t, end: t + 8000, speaker: 'A', text: a });
        cues.push(cue(t, t + 8000, AVERY, a));
        utterances.push({ start: t + 9000, end: t + 14_000, speaker: 'B',
          text: `so the committee approved replacing laboratory ventilation equipment this summer vendor invoices payroll${i}` });
      }
      const { samples } = sampleAlignmentPairs(utterances, cues);
      const support = computeNameSupport(samples, utterances, [AVERY]);
      expect(support.A[AVERY].count).toBe(4);
      expect(support.B).toEqual({});
      const verdict = { A: { name: AVERY, confidence: 0.9, pairIds: support.A[AVERY].pairIds },
        B: { name: AVERY, confidence: 0.95, pairIds: [] } };
      const result = verifyAlignmentVerdict(samples, support, verdict, { zoomNames: [AVERY], content: { utterances } });
      expect(result.names).toEqual({ A: AVERY });
      expect(result.alignment.status).toBe('partial');
    });

    const noisy = (captionB) => {
      const utterances = [];
      const cues = [];
      for (let i = 0; i < 4; i++) {
        const t = i * 60_000;
        const a1 = `regional hiring budget forecast quarterly review lab${i} ventilation`;
        const a2 = `committee approval december summer equipment closure lab${i} procurement`;
        utterances.push({ start: t, end: t + 5000, speaker: 'A', text: a1 }, { start: t + 5000, end: t + 10_000, speaker: 'A', text: a2 });
        cues.push(cue(t, t + 5000, AVERY, a1), cue(t + 5000, t + 10_000, AVERY, a2));
        const bAsr = `regional hiring budget forecast committee approval december lab${i} summer equipment`;
        utterances.push({ start: t + 10_000, end: t + 15_000, speaker: 'B', text: bAsr });
        cues.push(cue(t + 10_000, t + 15_000, JORDAN, captionB(bAsr, i)));
      }
      const { samples } = sampleAlignmentPairs(utterances, cues);
      const support = computeNameSupport(samples, utterances, [AVERY, JORDAN]);
      return { samples, support, opts: { zoomNames: [AVERY, JORDAN], content: { utterances } } };
    };

    test('B whose own cue is missed by ASR noise is not named from the neighbour\'s cues', () => {
      // Fails without cue-exclusive attribution: A's concatenated window covers B's words and names B Avery.
      const { samples, support, opts } = noisy((_asr, i) => `regional hiring budgets forecasts committees approve decembers lab${i} summer equipment`);
      expect(support.B).toEqual({});
      expect(support.A[AVERY].count).toBe(8);
      const verdict = { A: { name: AVERY, confidence: 0.9, pairIds: support.A[AVERY].pairIds }, B: { name: AVERY, confidence: 0.95, pairIds: [] } };
      const result = verifyAlignmentVerdict(samples, support, verdict, opts);
      expect(result.names).toEqual({ A: AVERY });
    });

    test('positive control: the same B with a correct caption still gets its own name', () => {
      // Fails if attribution is so strict that a correctly captioned speaker is lost.
      const { samples, support, opts } = noisy((asr) => asr);
      expect(support.B[JORDAN].count).toBe(4);
      const verdict = { A: { name: AVERY, confidence: 0.9, pairIds: support.A[AVERY].pairIds },
        B: { name: JORDAN, confidence: 0.9, pairIds: support.B[JORDAN].pairIds } };
      expect(verifyAlignmentVerdict(samples, support, verdict, opts).names).toEqual({ A: AVERY, B: JORDAN });
    });
  });

  test('no-speaker VTT yields status no_speakers', () => {
    // Fails if an empty Zoom name set is reported as abstained or applied.
    const parsed = parseZoomVtt('WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nlots of words here without any label\n');
    const utterances = [{ start: 0, end: 10_000, speaker: 'A', text: 'lots of words here without any label' }];
    const { samples } = sampleAlignmentPairs(utterances, parsed.cues);
    const support = computeNameSupport(samples, utterances, parsed.names);
    const result = verifyAlignmentVerdict(samples, support, {}, { zoomNames: parsed.names, content: { utterances } });
    expect(result.alignment.status).toBe('no_speakers');
    expect(result.names).toEqual({});
  });

  test('partial status when only some IDs are named; suggestions are capped at five', () => {
    // Fails if status ignores unnamed IDs or the suggestion cap is removed.
    const p = pipeline([['A', AVERY, 1], ['A', AVERY, 2], ['A', AVERY, 3], ['B', null, 4]], [AVERY]);
    const partial = verifyAlignmentVerdict(p.samples, p.support, { A: ok(p.support, 'A', AVERY) }, p.opts);
    expect(partial.alignment.status).toBe('partial');
    const many = Array.from({ length: 8 }, (_, i) => `Person ${i}`);
    const crowded = { A: Object.fromEntries(many.map((name) => [name, { count: 1, pairIds: ['A-0'] }])) };
    const result = verifyAlignmentVerdict([{ pairId: 'A-0', speakerId: 'A' }], crowded, {}, { zoomNames: many, content: contentFor('A') });
    expect(result.alignment.suggestions.A).toHaveLength(5);
  });

  test('names pass normalizeSpeakerNames: an 81-character name is never applied, 80 is', () => {
    // Fails if the output bypasses normalizeSpeakerNames / its length bound (or throws instead of rejecting).
    const run = (name) => {
      const support = { A: { [name]: { count: 3, pairIds: ['A-0', 'A-1', 'A-2'] } } };
      return verifyAlignmentVerdict([{ pairId: 'A-0', speakerId: 'A' }], support,
        { A: { name, confidence: 0.99, pairIds: ['A-0'] } }, { zoomNames: [name], content: contentFor('A') });
    };
    expect(run('N'.repeat(81)).names).toEqual({});
    expect(run('N'.repeat(81)).alignment.status).toBe('abstained');
    expect(run('N'.repeat(80)).names).toEqual({ A: 'N'.repeat(80) });
  });

  test('a hostile Zoom name such as __proto__ stays an ordinary key', () => {
    const p = pipeline([['A', '__proto__', 1], ['A', '__proto__', 2], ['A', '__proto__', 3]], ['__proto__']);
    expect(Object.hasOwn(p.support.A, '__proto__')).toBe(true);
    const verdict = { A: { name: '__proto__', confidence: 0.9, pairIds: p.support.A.__proto__.pairIds } };
    expect(verifyAlignmentVerdict(p.samples, p.support, verdict, p.opts).names.A).toBe('__proto__');
  });

  describe('stored alignment is bounded to 64 KiB', () => {
    const LIMIT = 65_536;
    const speakerIds = Array.from({ length: 200 }, (_, i) => `S${String(i).padStart(31, '0')}`);
    const content = { utterances: speakerIds.map((speaker) => ({ speaker })) };
    const samples = speakerIds.map((id) => ({ pairId: `${id}-0`, speakerId: id }));
    const longName = (tag) => `${tag}${'n'.repeat(79)}`;

    test('200 IDs x 80-char CJK names x long-decimal confidence stays within the limit (fail-closed if not)', () => {
      // Fails if confidence is not rounded or the final fail-closed step is removed.
      const name = '\u6f22'.repeat(80);
      const support = Object.fromEntries(speakerIds.map((id) => [id, { [name]: { count: 3, pairIds: [`${id}-0`] } }]));
      const confidence = 0.8123456789012345;
      const verdict = Object.fromEntries(speakerIds.map((id) => [id, { name, confidence, pairIds: [] }]));
      const { names, alignment } = verifyAlignmentVerdict(samples, support, verdict, { zoomNames: [name], content });
      const bytes = Buffer.byteLength(JSON.stringify(alignment));
      expect(bytes).toBeLessThanOrEqual(LIMIT);
      // Arithmetic: with pairIds the JSON is ~71 KB (over); once pairIds are dropped it is 63,862 bytes.
      expect(bytes).toBe(63_862);
      expect(alignment.status).toBe('applied');
      expect(Object.keys(names)).toHaveLength(200);
      expect(alignment.speakers[speakerIds[0]]).toEqual({ name, confidence: 0.812, pairIds: [] });
    });

    test('fail-closed: still too large after all trimming returns the empty abstained result', () => {
      // Fails if the final step is removed: an oversized applied alignment would be returned.
      const name = '\u6f22'.repeat(80);
      const support = Object.fromEntries(speakerIds.map((id) => [id, { [name]: { count: 3, pairIds: [`${id}-0`] } }]));
      const verdict = Object.fromEntries(speakerIds.map((id) => [id, { name, confidence: 0.9, pairIds: [] }]));
      const result = verifyAlignmentVerdict(samples, support, verdict, { zoomNames: [name], content, maxAlignmentBytes: 1000 });
      expect(result.names).toEqual({});
      expect(result.alignment).toEqual({ status: 'abstained', floor: 0.8, speakers: {}, suggestions: {} });
    });

    test('applied shape (200 IDs x 32-char IDs x 80-char names x long pairIds)', () => {
      // Fails if the byte fit is removed: the raw alignment is larger than the limit.
      const name = longName('a');
      const support = Object.fromEntries(speakerIds.map((id) => [id, { [name]: { count: 5,
        pairIds: Array.from({ length: 5 }, (_, j) => `${id}-${String(j).padStart(60, '0')}`) } }]));
      const verdict = Object.fromEntries(speakerIds.map((id) => [id, { name, confidence: 0.9, pairIds: [] }]));
      const { names, alignment } = verifyAlignmentVerdict(samples, support, verdict, { zoomNames: [name], content });
      expect(Object.keys(names)).toHaveLength(200);
      expect(Buffer.byteLength(JSON.stringify(alignment))).toBeLessThanOrEqual(LIMIT);
      expect(alignment.status).toBe('applied');
      expect(alignment.speakers[speakerIds[0]]).not.toHaveProperty('prior');
    });

    test('suggestion-only shape (200 IDs x 5 names of 80 chars)', () => {
      // Fails if suggestions are not shrunk: 200 x 5 x 80 chars exceeds the limit.
      const names = Array.from({ length: 5 }, (_, j) => longName(String(j)));
      const support = Object.fromEntries(speakerIds.map((id) => [id,
        Object.fromEntries(names.map((name, j) => [name, { count: 1, pairIds: [`${id}-${j}`] }]))]));
      const { names: applied, alignment } = verifyAlignmentVerdict(samples, support, {}, { zoomNames: names, content });
      expect(applied).toEqual({});
      expect(Buffer.byteLength(JSON.stringify(alignment))).toBeLessThanOrEqual(LIMIT);
      expect(Object.keys(alignment.suggestions).length === 0
        || Object.values(alignment.suggestions).every((list) => list.length === 1)).toBe(true);
    });
  });
});
