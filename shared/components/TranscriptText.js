/**
 * Shows a published plain-text transcript as speaker turns. The meeting transcript formatter
 * (lib/services/transcription-pilot/transcript-format.js) writes one paragraph per turn,
 * `[MM:SS] Speaker: words` (or `[H:MM:SS]`), separated by blank lines; formatter v1/v2 wrote
 * `M:00` minute headings followed by `Speaker: words` paragraphs. Anything else reads as paragraphs.
 */

const TIMED_TURN = /^\[((?:\d{1,2}:)?\d{1,2}:\d{2})\]\s+(.*)$/s;
const MINUTE_HEADING = /^(\d{1,3}:00)$/;
// A speaker label is short and ends at its colon. Periods are allowed only after an initial or a
// title ("A. Smith", "Dr. Lee"); a word ending a sentence ("clear. Results:") is not a speaker.
const SPEAKER = /^([^:?!\n]{1,60}):\s+(.+)$/s;
const SENTENCE_END = /\b(?!(?:dr|mr|mrs|ms|prof|jr|sr)\.)[a-z]{2,}\.(?:\s|$)/i;

function splitSpeaker(text) {
  const match = SPEAKER.exec(text);
  if (!match || SENTENCE_END.test(match[1])) return { speaker: null, text: text.trim() };
  return { speaker: match[1].trim(), text: match[2].trim() };
}

export function parseTranscriptText(text) {
  const paragraphs = String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim()).filter(Boolean);
  const turns = [];
  let minute = null;
  for (const paragraph of paragraphs) {
    const lines = paragraph.split('\n');
    // A v1/v2 minute heading may share a paragraph with the turn under it.
    if (MINUTE_HEADING.test(lines[0].trim())) {
      minute = lines[0].trim();
      const rest = lines.slice(1).join('\n').trim();
      if (!rest) continue;
      turns.push({ time: minute, ...splitSpeaker(rest) });
      minute = null;
      continue;
    }
    const timed = TIMED_TURN.exec(paragraph);
    if (timed) {
      turns.push({ time: timed[1], ...splitSpeaker(timed[2]) });
      continue;
    }
    turns.push({ time: minute, ...splitSpeaker(paragraph) });
    minute = null;
  }
  return turns;
}

export default function TranscriptText({ text }) {
  const turns = parseTranscriptText(text);
  const timed = turns.some((turn) => turn.time);
  return (
    <ol className="space-y-5">
      {turns.map((turn, index) => (
        <li key={index} className={timed ? 'grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4' : ''}>
          {timed && (
            <span className="pt-0.5 text-sm tabular-nums text-gray-500">{turn.time || ''}</span>
          )}
          <div>
            {turn.speaker && <p className="text-sm font-semibold text-gray-900">{turn.speaker}</p>}
            <p className="whitespace-pre-line text-base leading-7 text-gray-800">{turn.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
