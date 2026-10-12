/**
 * Shows a published plain-text summary with its structure: known section headings become
 * headings, each non-empty line a paragraph, and lines under a list heading a bulleted list.
 * Summaries are plain text by prompt contract (no Markdown), and staff may edit a draft before
 * it is published, so text without the expected headings still reads as paragraphs.
 */

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

function headingKey(line) {
  return line.trim().replace(/:$/, '').trim().toLowerCase();
}

export function parseSummaryText(text, { headings = [], listHeadings = [] } = {}) {
  const byKey = new Map(headings.map((heading) => [heading.toLowerCase(), heading]));
  const listKeys = new Set(listHeadings.map((heading) => heading.toLowerCase()));
  const sections = [];
  let current = null;
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const key = headingKey(line);
    if (byKey.has(key)) {
      current = { heading: byKey.get(key), list: listKeys.has(key), lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { heading: null, list: false, lines: [] };
      sections.push(current);
    }
    current.lines.push(current.list ? line.replace(BULLET, '') : line);
  }
  return sections.filter((section) => section.heading || section.lines.length > 0);
}

// `reading` is the Board page's reading size; `compact` sits inside dense staff panels.
const SIZES = {
  reading: {
    stack: 'space-y-10',
    heading: 'text-xl font-semibold text-gray-900 text-balance',
    gap: 'mt-4',
    list: 'list-disc space-y-2 pl-6 text-lg leading-8 text-gray-800 marker:text-gray-400',
    paragraphs: 'space-y-5 text-lg leading-8 text-gray-800',
  },
  compact: {
    stack: 'space-y-4',
    heading: 'text-sm font-semibold text-gray-600',
    gap: 'mt-1',
    list: 'list-disc space-y-1 pl-5 text-sm leading-6 text-gray-800 marker:text-gray-400',
    paragraphs: 'space-y-2 text-sm leading-6 text-gray-800',
  },
};

export default function SummaryText({ text, headings, listHeadings, headingLevel = 3, size = 'reading' }) {
  const Heading = `h${headingLevel}`;
  const classes = SIZES[size] || SIZES.reading;
  const sections = parseSummaryText(text, { headings, listHeadings });
  return (
    <div className={classes.stack}>
      {sections.map((section, index) => (
        <section key={`${section.heading || 'text'}-${index}`}>
          {section.heading && (
            <Heading className={classes.heading}>{section.heading}</Heading>
          )}
          {section.list ? (
            <ul className={`${section.heading ? classes.gap : ''} ${classes.list}`}>
              {section.lines.map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}
            </ul>
          ) : (
            <div className={`${section.heading ? classes.gap : ''} ${classes.paragraphs}`}>
              {section.lines.map((line, lineIndex) => <p key={lineIndex}>{line}</p>)}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
