import {
  formatTranscriptMinuteHeading, formatTranscriptText, formatTranscriptVtt,
  getTranscriptSpeakers, groupTranscriptByMinute, normalizeSpeakerNames, normalizeUtteranceWordTimings,
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
    expect(formatTranscriptText(transcript, { A: 'Host' })).toBe(
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
    expect(formatTranscriptText(long, { A: 'Host' })).toBe(
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

  it('uses own-property lookup and falls back for inherited labels', () => {
    const names = Object.create({ A: 'inherited' });
    expect(formatTranscriptText({ utterances: [{ start: 0, end: 10, speaker: 'A', text: 'Hello' }] }, names))
      .toBe('0:00\nSpeaker A: Hello\n');
  });
});
