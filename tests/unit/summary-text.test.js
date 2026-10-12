/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import SummaryText, { parseSummaryText } from '../../shared/components/SummaryText.js';
import {
  DISCUSSION_SUMMARY_HEADINGS, DISCUSSION_SUMMARY_LIST_HEADINGS, PRESENTATION_SUMMARY_HEADINGS, PRESENTATION_SUMMARY_LIST_HEADINGS,
} from '../../shared/config/transcriptSummary.js';
import { SYSTEM_PROMPT } from '../../shared/config/prompts/meeting-presentation-summary.js';
import { SYSTEM_PROMPT as DISCUSSION_PROMPT } from '../../shared/config/prompts/meeting-staff-discussion-summary.js';

const OPTIONS = { headings: PRESENTATION_SUMMARY_HEADINGS, listHeadings: PRESENTATION_SUMMARY_LIST_HEADINGS };
const SAMPLE = [
  'What was presented', 'The team studies X.', '', 'They propose Y.', '',
  'Questions and answers', 'A staff member asked about cost. The PI said Z.', '',
  'Open points:', '- Send the budget breakdown.', 'Confirm the start date.',
].join('\r\n');

test('the reader headings are exactly the ones the summary prompt asks for, in order', () => {
  const positions = PRESENTATION_SUMMARY_HEADINGS.map((heading) => SYSTEM_PROMPT.indexOf(`\n${heading}\n`));
  expect(positions.every((position) => position > 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
});

test('headings become sections, lines become paragraphs, and list-heading lines become items without bullets', () => {
  expect(parseSummaryText(SAMPLE, OPTIONS)).toEqual([
    { heading: 'What was presented', list: false, lines: ['The team studies X.', 'They propose Y.'] },
    { heading: 'Questions and answers', list: false, lines: ['A staff member asked about cost. The PI said Z.'] },
    { heading: 'Open points', list: true, lines: ['Send the budget breakdown.', 'Confirm the start date.'] },
  ]);
});

test('text without the expected headings (an edited draft) still reads as paragraphs', () => {
  expect(parseSummaryText('First point.\n\nSecond point.', OPTIONS)).toEqual([
    { heading: null, list: false, lines: ['First point.', 'Second point.'] },
  ]);
  expect(parseSummaryText('', OPTIONS)).toEqual([]);
});

test('renders headings at the requested level, paragraphs and a list', () => {
  render(<SummaryText text={SAMPLE} {...OPTIONS} headingLevel={3} />);
  expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(PRESENTATION_SUMMARY_HEADINGS);
  expect(screen.getByText('They propose Y.').tagName).toBe('P');
  expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Send the budget breakdown.', 'Confirm the start date.']);
});

test('the discussion headings are exactly the ones the staff discussion prompt asks for, in order', () => {
  const positions = DISCUSSION_SUMMARY_HEADINGS.map((heading) => DISCUSSION_PROMPT.indexOf(`\n${heading}\n`));
  expect(positions.every((position) => position > 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  expect(DISCUSSION_SUMMARY_LIST_HEADINGS.every((heading) => DISCUSSION_SUMMARY_HEADINGS.includes(heading))).toBe(true);
});

test('compact size uses the small type scale', () => {
  const { container } = render(<SummaryText text={SAMPLE} {...OPTIONS} size="compact" />);
  expect(container.innerHTML).toMatch(/text-sm/);
  expect(container.innerHTML).not.toMatch(/text-lg/);
});
