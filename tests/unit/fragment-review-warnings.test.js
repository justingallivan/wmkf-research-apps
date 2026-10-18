/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import FragmentReviewWarnings from '../../shared/components/meeting-tracker/FragmentReviewWarnings';
const content = { utterances: [
  { speaker: 'A', start: 1000, end: 1500, text: 'I' },
  { speaker: 'B', start: 1500, end: 1800, text: 'was' },
  { speaker: 'A', start: 1800, end: 4000, text: 'ready to test the prototype.' },
] };
const props = { content, names: { A: 'Alex Example', B: 'Casey Example' },
  review: { status: 'complete', limited: false, warnings: [{ index: 1, speakerId: 'A', reason: 'The word completes the clause.' }] } };

test('shows passage, proposed speaker and advisory wording without correction controls', () => {
  render(<FragmentReviewWarnings {...props} />);
  expect(screen.getByLabelText('Sentence-fragment review')).toHaveTextContent('Possible speaker for “was”: Alex Example');
  expect(screen.getByText(/no speaker assignments have changed/)).toBeInTheDocument();
  expect(screen.getByText(/ready to test/)).toHaveTextContent('I / was / ready to test the prototype.');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('known boundary and changed transcript suppress obsolete warnings', () => {
  const { rerender } = render(<FragmentReviewWarnings {...props} presentationEndMs={1800} />);
  expect(screen.queryByLabelText('Sentence-fragment review')).not.toBeInTheDocument();
  rerender(<FragmentReviewWarnings {...props} content={{ utterances: [] }} />);
  expect(screen.queryByLabelText('Sentence-fragment review')).not.toBeInTheDocument();
});

test.each(['skipped', 'unavailable'])('%s does not claim a clean check', status => {
  render(<FragmentReviewWarnings {...props} review={{ status }} />);
  expect(screen.getByText(/check did not complete/)).toBeInTheDocument();
});

test('old jobs remain unchanged; capped checks show incomplete coverage', () => {
  const { rerender } = render(<FragmentReviewWarnings {...props} review={undefined} />);
  expect(screen.queryByLabelText('Sentence-fragment review')).not.toBeInTheDocument();
  rerender(<FragmentReviewWarnings {...props} review={{ ...props.review, limited: true }} />);
  expect(screen.getByText(/Only the first 10/)).toBeInTheDocument();
});
