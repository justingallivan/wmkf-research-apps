/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import TranscriptText, { parseTranscriptText } from '../../shared/components/TranscriptText.js';

test('timed turns (formatter v3+) split into time, speaker and words, including past one hour', () => {
  const text = '[00:00] Jane Doe: Thank you all.\n\n[01:12] A. Smith: Could you say more?\nOn the budget.\n\n[1:02:05] Jane Doe: Yes.';
  expect(parseTranscriptText(text)).toEqual([
    { time: '00:00', speaker: 'Jane Doe', text: 'Thank you all.' },
    { time: '01:12', speaker: 'A. Smith', text: 'Could you say more?\nOn the budget.' },
    { time: '1:02:05', speaker: 'Jane Doe', text: 'Yes.' },
  ]);
});

test('minute headings (formatter v1/v2) time the next turn', () => {
  expect(parseTranscriptText('0:00\n\nJane Doe: Hello.\n\nA. Smith: Hi.\n\n1:00\nJane Doe: Next.')).toEqual([
    { time: '0:00', speaker: 'Jane Doe', text: 'Hello.' },
    { time: null, speaker: 'A. Smith', text: 'Hi.' },
    { time: '1:00', speaker: 'Jane Doe', text: 'Next.' },
  ]);
});

test('plain text and sentence colons are not mistaken for speakers', () => {
  expect(parseTranscriptText('Note: this is plain.\n\nThe aim is clear. Results: good.')).toEqual([
    { time: null, speaker: 'Note', text: 'this is plain.' },
    { time: null, speaker: null, text: 'The aim is clear. Results: good.' },
  ]);
  expect(parseTranscriptText('')).toEqual([]);
});

test('renders one list item per turn with a time gutter only when the transcript is timed', () => {
  const { container, rerender } = render(<TranscriptText text={'[00:05] Jane Doe: Hello.\n\n[00:09] A. Smith: Hi.'} />);
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByText('00:05')).toBeInTheDocument();
  expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  rerender(<TranscriptText text={'Just words.'} />);
  expect(container.querySelector('.tabular-nums')).toBeNull();
});

test('initials and titles are allowed in speaker labels', () => {
  expect(parseTranscriptText('Dr. Lee: Welcome.')[0]).toEqual({ time: null, speaker: 'Dr. Lee', text: 'Welcome.' });
  expect(parseTranscriptText('[00:01] Speaker 2: Ok.')[0]).toEqual({ time: '00:01', speaker: 'Speaker 2', text: 'Ok.' });
});
