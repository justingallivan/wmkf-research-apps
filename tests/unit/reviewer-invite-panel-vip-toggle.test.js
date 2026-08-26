/**
 * @jest-environment jsdom
 *
 * Per-row VIP toggle on the Invite Reviewers roster (reviewer invitation VIP
 * preview slice): flags load per request on mount, the toggle PUTs the
 * person id with the flag state, and rows without a potentialReviewerId get
 * no toggle at all.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewerInvitePanel from '../../shared/components/reviewers/ReviewerInvitePanel';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/reviewers/InviteEmailModal', () => function InviteEmailModal() {
  return null;
});
jest.mock('../../shared/components/reviewers/CandidateEditModal', () => function CandidateEditModal() {
  return null;
});
jest.mock('../../shared/components/reviewers/ReleaseEmailModal', () => function ReleaseEmailModal() {
  return null;
});

const PR1 = '22222222-2222-4222-8222-222222222222';

const withPerson = {
  suggestionId: 'S-1',
  potentialReviewerId: PR1,
  name: 'Dr. Keyed Person',
  email: 'keyed@example.edu',
  invited: false,
  accepted: false,
  declined: false,
};
const withoutPerson = {
  suggestionId: 'S-2',
  potentialReviewerId: null,
  name: 'Unkeyed Row',
  email: 'unkeyed@example.edu',
  invited: false,
  accepted: false,
  declined: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(async (url) => {
    if (String(url).startsWith('/api/review-manager/reviewer-vip-flags')) {
      return { ok: true, status: 200, json: async () => ({ pdSystemUserId: 'pd-1', flaggedPotentialReviewerIds: [] }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
});

test('flags load for the request on mount; toggle PUTs the person id and flips visual state', async () => {
  render(<ReviewerInvitePanel requestId="REQ-1" candidates={[withPerson]} onRefresh={() => {}} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/review-manager/reviewer-vip-flags?requestId=REQ-1',
    expect.anything(),
  ));
  const toggle = screen.getByRole('button', { name: /toggle vip review for dr\. keyed person/i });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(toggle);
  await waitFor(() => {
    const put = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'PUT');
    expect(put).toBeTruthy();
    expect(JSON.parse(put[1].body)).toEqual({
      requestId: 'REQ-1',
      potentialReviewerId: PR1,
      flagged: true,
    });
  });
  await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));
});

test('a row without a potentialReviewerId renders no VIP toggle', async () => {
  render(<ReviewerInvitePanel requestId="REQ-1" candidates={[withoutPerson]} onRefresh={() => {}} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: /toggle vip review/i })).toBeNull();
});
