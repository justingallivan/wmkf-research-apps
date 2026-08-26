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
const mockModalProps = [];
jest.mock('../../shared/components/reviewers/InviteEmailModal', () => function InviteEmailModal(props) {
  mockModalProps.push(props);
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
  mockModalProps.length = 0;
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

test('a FAILED flags load opens the modal fail-closed: vipUnknown is true', async () => {
  global.fetch = jest.fn(async (url) => {
    if (String(url).startsWith('/api/review-manager/reviewer-vip-flags')) {
      throw new Error('network down');
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  render(<ReviewerInvitePanel requestId="REQ-1" candidates={[withPerson]} onRefresh={() => {}} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('checkbox', { name: /select dr\. keyed person/i }));
  fireEvent.click(screen.getByRole('button', { name: /^Send invitation/ }));
  await waitFor(() => expect(mockModalProps.length).toBeGreaterThan(0));
  expect(mockModalProps[mockModalProps.length - 1].vipUnknown).toBe(true);
});

test('a successful flags load opens the modal with vipUnknown false and the vip bit set', async () => {
  global.fetch = jest.fn(async (url) => {
    if (String(url).startsWith('/api/review-manager/reviewer-vip-flags')) {
      return { ok: true, status: 200, json: async () => ({ pdSystemUserId: 'pd-1', flaggedPotentialReviewerIds: [PR1] }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  render(<ReviewerInvitePanel requestId="REQ-1" candidates={[withPerson]} onRefresh={() => {}} />);
  const toggle = await screen.findByRole('button', { name: /toggle vip review for dr\. keyed person/i });
  await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));
  fireEvent.click(screen.getByRole('checkbox', { name: /select dr\. keyed person/i }));
  fireEvent.click(screen.getByRole('button', { name: /^Send invitation/ }));
  await waitFor(() => expect(mockModalProps.length).toBeGreaterThan(0));
  const props = mockModalProps[mockModalProps.length - 1];
  expect(props.vipUnknown).toBe(false);
  expect(props.candidates[0].vip).toBe(true);
});

test('a row without a potentialReviewerId renders no VIP toggle', async () => {
  render(<ReviewerInvitePanel requestId="REQ-1" candidates={[withoutPerson]} onRefresh={() => {}} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: /toggle vip review/i })).toBeNull();
});
