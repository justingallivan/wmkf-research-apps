import {
  formatTranscriptMinuteHeading, formatTranscriptText, formatTranscriptTurnTime, formatTranscriptVtt,
  getTranscriptSpeakers, groupTranscriptByMinute, groupTranscriptByTurn, normalizeSpeakerNames,
  normalizeUtteranceWordTimings, TRANSCRIPT_FORMATTER_VERSION, TRANSCRIPT_FORMATTER_VERSIONS,
} from '../../lib/services/transcription-pilot/transcript-format';

const transcript = {
  text: 'First. Second. Third.',
  utterances: [
    { start: 58_000, end: 62_000, speaker: 'A', text: 'First.' },
    { start: 62_000, end: 65_000, speaker: 'B', text: 'Second.' },
    { start: 10_000, end: 12_000, speaker: 'A', text: 'Earlier.' },
  ],
};

describe('transcription speaker overlay and one-minute formatting', () => {
  it('finds speaker IDs once in first-appearance order and preserves legacy whole-utterance grouping without word timings', () => {
    expect(getTranscriptSpeakers(transcript)).toEqual(['A', 'B']);
    expect(groupTranscriptByMinute(transcript, { A: 'Host' })).toEqual([
      { minute: 0, utterances: [
        { ...transcript.utterances[0], speakerName: 'Host' },
        { ...transcript.utterances[2], speakerName: 'Host' },
      ] },
      { minute: 1, utterances: [{ ...transcript.utterances[1], speakerName: 'Speaker B' }] },
    ]);
    expect(formatTranscriptMinuteHeading(61)).toBe('61:00');
  });

  it('accepts explicit blank resets and rejects unknown IDs, oversized names and controls', () => {
    expect(normalizeSpeakerNames(transcript, { A: ' Chair ', B: '' })).toEqual({ A: 'Chair' });
    expect(() => normalizeSpeakerNames(transcript, { C: 'Unknown' })).toThrow('invalid_speaker_names');
    expect(() => normalizeSpeakerNames(transcript, { A: 'x'.repeat(81) })).toThrow('invalid_speaker_names');
    expect(() => normalizeSpeakerNames(transcript, { A: 'Chair\nInjected' })).toThrow('invalid_speaker_names');
    expect(() => normalizeSpeakerNames(transcript, Object.assign(Object.create({ inherited: 'unsafe' }), { A: 'Chair' })))
      .toThrow('invalid_speaker_names');
  });

  it('formats TXT as minute headings plus speaker paragraphs without utterance-time noise', () => {
    expect(formatTranscriptText(transcript, { A: 'Host' }, { layout: 'minute' })).toBe(
      '0:00\nHost: First.\n\nHost: Earlier.\n\n1:00\nSpeaker B: Second.\n',
    );
  });

  it('splits a long utterance at timed word minute boundaries without losing text or changing VTT cues', () => {
    const long = { text: 'Intro. Hello, there! Again.', utterances: [{
      start: 0, end: 180_000, speaker: 'A', text: 'Hello, there! Again.',
      words: [
        { start: 58_000, end: 59_000, text: 'Hello' },
        { start: 61_000, end: 62_000, text: 'there!' },
        { start: 121_000, end: 122_000, text: 'Again.' },
      ],
    }] };
    expect(groupTranscriptByMinute(long, { A: 'Host' })).toEqual([
      { minute: 0, utterances: [{ start: 58_000, end: 59_000, speaker: 'A', speakerName: 'Host', text: 'Hello, ' }] },
      { minute: 1, utterances: [{ start: 61_000, end: 62_000, speaker: 'A', speakerName: 'Host', text: 'there! ' }] },
      { minute: 2, utterances: [{ start: 121_000, end: 122_000, speaker: 'A', speakerName: 'Host', text: 'Again.' }] },
    ]);
    expect(formatTranscriptText(long, { A: 'Host' }, { layout: 'minute' })).toBe(
      '0:00\nHost: Hello,\n\n1:00\nHost: there!\n\n2:00\nHost: Again.\n',
    );
    expect(formatTranscriptVtt(long, { A: 'Host' })).toBe(
      'WEBVTT\n\n00:00:00.000 --> 00:03:00.000\nHost: Hello, there! Again.\n',
    );
  });

  it('falls back to the original utterance when optional word timings do not align', () => {
    const misaligned = { utterances: [{ start: 0, end: 180_000, speaker: 'A', text: 'Complete, exact text.',
      words: [{ start: 61_000, end: 62_000, text: 'missing' }] }] };
    expect(groupTranscriptByMinute(misaligned)).toEqual([
      { minute: 0, utterances: [{ start: 0, end: 180_000, speaker: 'A', speakerName: 'Speaker A', text: 'Complete, exact text.' }] },
    ]);
  });

  it('rejects incomplete word coverage instead of assigning omitted text to a timed minute', () => {
    const utterance = (text, words) => ({ start: 0, end: 120_000, text, words });
    expect(normalizeUtteranceWordTimings(utterance('hello many missing words world', [
      { start: 0, end: 500, text: 'hello' }, { start: 61_000, end: 62_000, text: 'world' },
    ]))).toBeNull();
    expect(normalizeUtteranceWordTimings(utterance('missing hello world', [
      { start: 0, end: 500, text: 'hello' }, { start: 61_000, end: 62_000, text: 'world' },
    ]))).toBeNull();
    expect(normalizeUtteranceWordTimings(utterance('hello world trailing words', [
      { start: 0, end: 500, text: 'hello' }, { start: 61_000, end: 62_000, text: 'world' },
    ]))).toBeNull();
    const punctuation = utterance('“hello,” … world!', [
      { start: 0, end: 500, text: 'hello' }, { start: 61_000, end: 62_000, text: 'world' },
    ]);
    expect(normalizeUtteranceWordTimings(punctuation)).not.toBeNull();
    const grouped = groupTranscriptByMinute({ utterances: [punctuation] });
    expect(grouped.flatMap(group => group.utterances.map(item => item.text)).join('')).toBe(punctuation.text);
    expect(grouped.map(group => group.minute)).toEqual([0, 1]);
  });

  it('keeps VTT utterance order and exact times while escaping overlay names and cue text', () => {
    const sourceOrder = { utterances: [
      { start: 62_345, end: 65_678, speaker: 'A', text: 'Second --> cue' },
      { start: 58_001, end: 62_000, speaker: 'A', text: '<first>' },
    ] };
    expect(formatTranscriptVtt(sourceOrder, { A: 'Host & <Lead>' })).toBe(
      'WEBVTT\n\n00:01:02.345 --> 00:01:05.678\nHost &amp; &lt;Lead&gt;: Second —&gt; cue\n\n00:00:58.001 --> 00:01:02.000\nHost &amp; &lt;Lead&gt;: &lt;first&gt;\n',
    );
  });

  it('neutralizes WebVTT cue delimiters with an exclamation mark in names and transcript text', () => {
    const adversarial = { utterances: [
      { start: 0, end: 1000, speaker: 'A', text: 'untrusted --!> cue --> text & <tag>' },
    ] };
    expect(formatTranscriptVtt(adversarial, { A: 'Host --!> & <Lead>' })).toBe(
      'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHost —&gt; &amp; &lt;Lead&gt;: untrusted —&gt; cue —&gt; text &amp; &lt;tag&gt;\n',
    );
  });

  it('uses own-property lookup and falls back for inherited labels', () => {
    const names = Object.create({ A: 'inherited' });
    expect(formatTranscriptText({ utterances: [{ start: 0, end: 10, speaker: 'A', text: 'Hello' }] }, names, { layout: 'minute' }))
      .toBe('0:00\nSpeaker A: Hello\n');
    expect(formatTranscriptText({ utterances: [{ start: 0, end: 10, speaker: 'A', text: 'Hello' }] }, names))
      .toBe('[00:00] Speaker A: Hello\n');
  });
});

describe('formatter v3: one paragraph per speaker turn (owner decision 2026-10-04)', () => {
  // A four-minute monologue chopped at minute marks read worse than one paragraph (Oregon State rehearsal).
  const monologue = {
    text: '',
    utterances: [
      { start: 20 * 60_000 + 50_000, end: 22 * 60_000, speaker: 'A', text: 'We begin here.' },
      { start: 22 * 60_000, end: 24 * 60_000 + 30_000, speaker: 'A', text: 'We continue for a while.' },
      { start: 24 * 60_000 + 30_000, end: 25 * 60_000 + 10_000, speaker: 'A', text: 'And we finish.' },
      { start: 25 * 60_000 + 12_000, end: 25 * 60_000 + 20_000, speaker: 'B', text: 'A question.' },
      { start: 25 * 60_000 + 21_000, end: 25 * 60_000 + 40_000, speaker: 'A', text: 'An answer.' },
    ],
  };

  test('version constants', () => {
    expect(TRANSCRIPT_FORMATTER_VERSIONS).toEqual(['1', '2', '3']);
    expect(TRANSCRIPT_FORMATTER_VERSION).toBe('3');
  });

  test('consecutive utterances by one speaker merge into a single turn spanning several minutes', () => {
    const turns = groupTranscriptByTurn(monologue, { A: 'Andrea Balbas', B: 'Beth Pruitt' });
    expect(turns.map((turn) => [turn.speakerName, turn.text])).toEqual([
      ['Andrea Balbas', 'We begin here. We continue for a while. And we finish.'],
      ['Beth Pruitt', 'A question.'],
      ['Andrea Balbas', 'An answer.'],
    ]);
    expect(turns[0]).toMatchObject({ start: 20 * 60_000 + 50_000, end: 25 * 60_000 + 10_000, speaker: 'A' });
  });

  test('TXT has one paragraph per turn with its start time and no minute headings', () => {
    expect(formatTranscriptText(monologue, { A: 'Andrea Balbas', B: 'Beth Pruitt' })).toBe(
      '[20:50] Andrea Balbas: We begin here. We continue for a while. And we finish.\n\n'
      + '[25:12] Beth Pruitt: A question.\n\n'
      + '[25:21] Andrea Balbas: An answer.\n',
    );
    expect(formatTranscriptText(monologue, { A: 'Andrea Balbas', B: 'Beth Pruitt' })).not.toMatch(/^\d+:00$/m);
  });

  test('utterances are ordered by start before merging; same-speaker turns merge across a silence gap', () => {
    // Fails if input order is trusted: "Earlier." (10 s) would otherwise be glued after Speaker B's 62 s turn.
    expect(formatTranscriptText(transcript, { A: 'Host' })).toBe(
      '[00:10] Host: Earlier. First.\n\n[01:02] Speaker B: Second.\n',
    );
  });

  test('a speaker-less utterance never merges and gets no label; hours appear only when non-zero', () => {
    const content = { utterances: [
      { start: 0, end: 1000, speaker: null, text: 'Unattributed one.' },
      { start: 1000, end: 2000, speaker: null, text: 'Unattributed two.' },
      { start: 3_600_000 + 5000, end: 3_600_000 + 9000, speaker: 'A', text: 'Into the second hour.' },
    ] };
    expect(groupTranscriptByTurn(content)).toHaveLength(3);
    expect(formatTranscriptText(content)).toBe('[00:00] Unattributed one.\n\n[00:01] Unattributed two.\n\n[1:00:05] Speaker A: Into the second hour.\n');
    expect(formatTranscriptTurnTime(3_600_000 + 5000)).toBe('1:00:05');
  });

  test('plain text fallback and control-character scrubbing still apply', () => {
    expect(formatTranscriptText({ text: 'Only\u0007 text', utterances: [] })).toBe('Only  text\n');
    expect(formatTranscriptText({ utterances: [{ start: 0, end: 5, speaker: 'A', text: 'Line\nbreak' }] })).toBe('[00:00] Speaker A: Line break\n');
  });
});
