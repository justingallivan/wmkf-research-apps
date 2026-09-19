/**
 * @jest-environment jsdom
 *
 * P0 presentation prerequisites for the reviewer-search workspace move.
 *
 * These cases intentionally exercise the public facade and the named card
 * export.  Existing R6 suites cover the detailed warning copy; this file
 * pins the boundary and the fail-closed remedy contract that extracted views
 * must preserve.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewerSearchSection, {
  CandidateCard,
} from '../../shared/components/reviewers/ReviewerSearchSection';

const BASE_CANDIDATE = {
  name: 'Pat Example',
  affiliation: 'Example University',
  email: 'pat@example.edu',
  emailSource: 'institution_page',
  identityStatus: 'probable',
  publications: [{ title: 'A retrieved paper', year: 2025 }],
};

afterEach(() => {
  jest.clearAllMocks();
});

test('keeps the default facade and named CandidateCard exports public', () => {
  expect(typeof ReviewerSearchSection).toBe('function');
  expect(typeof CandidateCard).toBe('function');
});

test('renders populated identity evidence and routes the explicit remedy to the same candidate', async () => {
  const user = userEvent.setup();
  const onConfirmIdentity = jest.fn();
  const candidate = {
    ...BASE_CANDIDATE,
    identityStatus: 'unresolved',
    contactEnrichment: {
      emailYear: 2024,
      dataverseContactEvidence: {
        status: 'known',
        matchKey: 'email',
        institutions: [
          { value: 'Example University', source: 'primary_affiliation' },
          { value: 'Example Medical Center', source: 'organization' },
        ],
      },
    },
  };

  render(
    <CandidateCard
      candidate={candidate}
      readOnly
      onConfirmIdentity={onConfirmIdentity}
    />,
  );

  await user.click(screen.getByRole('button', { name: 'Show supporting evidence' }));

  expect(screen.getAllByText(/Example University/).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText(/Example Medical Center/)).toBeInTheDocument();
  expect(screen.getByText(/A retrieved paper/)).toBeInTheDocument();
  expect(screen.getByText(/does not confirm this is the person the proposal named/)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Confirm identity for Pat Example' }));
  expect(onConfirmIdentity).toHaveBeenCalledTimes(1);
  expect(onConfirmIdentity).toHaveBeenCalledWith(candidate);
});

test('keeps unknown linked-record status visible and exposes repair and retry only when authorized', async () => {
  const user = userEvent.setup();
  const onRequestRepair = jest.fn();
  const onRetryAddressCheck = jest.fn();
  const candidate = {
    ...BASE_CANDIDATE,
    conflictRecordUnavailable: true,
    applicantKnownReviewer: { status: 'unexpected_status' },
  };

  render(
    <CandidateCard
      candidate={candidate}
      readOnly
      canManage
      onRequestRepair={onRequestRepair}
      onRetryAddressCheck={onRetryAddressCheck}
    />,
  );

  expect(screen.getByText(/the person record could not be loaded/i)).toBeInTheDocument();
  const repair = screen.getByRole('button', { name: 'Create repair request for Pat Example' });
  const retry = screen.getByRole('button', { name: 'Retry conflict check for Pat Example' });
  await user.click(repair);
  await user.click(retry);

  expect(onRequestRepair).toHaveBeenCalledWith(candidate);
  expect(onRetryAddressCheck).toHaveBeenCalledWith(candidate);
});

test('read-only or missing remedy handlers never render dead repair actions', () => {
  const candidate = {
    ...BASE_CANDIDATE,
    conflictRecordUnavailable: true,
    applicantKnownReviewer: { status: 'unexpected_status' },
  };

  const { rerender } = render(
    <CandidateCard
      candidate={candidate}
      readOnly
      canManage={false}
      onRequestRepair={jest.fn()}
      onRetryAddressCheck={jest.fn()}
    />,
  );
  expect(screen.getByText(/the person record could not be loaded/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Create repair request/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Retry conflict check/ })).not.toBeInTheDocument();

  rerender(
    <CandidateCard
      candidate={candidate}
      readOnly
      canManage
    />,
  );
  expect(screen.getByText(/the person record could not be loaded/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Create repair request/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Retry conflict check/ })).not.toBeInTheDocument();
});
