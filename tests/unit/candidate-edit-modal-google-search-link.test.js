/**
 * @jest-environment jsdom
 *
 * One-click Google search link for the candidate name + notional institution
 * (owner request, `outputs/fuzzy-matching-owner-answers-2026-08-06.md` Q2),
 * placed in the confirm-reviewer modal so staff adjudicating a suggestion
 * don't have to hand-compose the search they already run manually.
 */

import { render, screen } from '@testing-library/react';
import CandidateEditModal from '../../shared/components/reviewers/CandidateEditModal';

test('renders a "Search Google" link with the encoded name + affiliation as href', () => {
  const candidate = {
    name: 'Jane Shih',
    affiliation: 'Dana-Farber Cancer Institute',
    email: 'jane.shih@example.edu',
    website: '',
  };
  render(<CandidateEditModal candidate={candidate} onApply={jest.fn()} onClose={jest.fn()} />);

  const link = screen.getByRole('link', { name: /Search Google/ });
  expect(link).toHaveAttribute(
    'href',
    'https://www.google.com/search?q=%22Jane+Shih%22+%22Dana-Farber+Cancer+Institute%22',
  );
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('omits the institution from the query when affiliation is empty', () => {
  const candidate = { name: 'Jane Shih', affiliation: '', email: '', website: '' };
  render(<CandidateEditModal candidate={candidate} onApply={jest.fn()} onClose={jest.fn()} />);

  const link = screen.getByRole('link', { name: /Search Google/ });
  expect(link).toHaveAttribute('href', 'https://www.google.com/search?q=%22Jane+Shih%22');
});
