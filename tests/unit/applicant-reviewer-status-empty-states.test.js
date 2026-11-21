/**
 * @jest-environment jsdom
 *
 * ApplicantReviewerStatus must only claim "the applicant did not list any
 * recommended reviewers" when nothing failed: not when the existing
 * applicant-recommended rows could not be read, and not when rows exist but
 * their linked person is missing (J27 intake writes rows, not slots).
 */
import { render, screen } from '@testing-library/react';
import ApplicantReviewerStatus from '../../shared/components/reviewers/search/ApplicantReviewerStatus';

const EMPTY = 'The applicant did not list any recommended reviewers for this request.';

const base = {
  canManage: true,
  terminalApplicantKeys: new Set(),
  busy: false,
  ingestLoading: false,
  recPhase: 'idle',
  ingestError: null,
  onRetryIngestion: () => {},
  recommended: [],
  recommendedFailed: [],
  slotsPopulated: 0,
  knownLookupFailed: [],
  blobUrl: null,
  recCount: 0,
  recProgress: [],
  enrichRecommended: () => {},
  proposalKey: null,
};

test('genuine empty: no slots, rows read fine, nothing failed', () => {
  render(<ApplicantReviewerStatus {...base} />);
  expect(screen.getByText(EMPTY)).toBeTruthy();
});

test('rows read failure shows retry, never the empty state', () => {
  render(<ApplicantReviewerStatus {...base} applicantRowsReadFailed />);
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.getByText(/Couldn't confirm the applicant's recommended reviewers/)).toBeTruthy();
});

test('rows with a missing linked person show the lookup warning, not the empty state', () => {
  render(<ApplicantReviewerStatus
    {...base}
    knownLookupFailed={[{ slot: null, potentialReviewerId: null, suggestionId: 'row-1', code: 'person_unavailable' }]}
  />);
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.getByText(/could not be safely hydrated/)).toBeTruthy();
});
