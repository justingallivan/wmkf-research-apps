/**
 * @jest-environment jsdom
 *
 * Per-row VIP toggle on the Invite Reviewers roster (reviewer invitation VIP
 * preview slice): flags load per request on mount, the toggle PUTs the
 * person id with the flag state, and rows without a potentialReviewerId get
 * no toggle at all.
 */

import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewerInvitePanel, { VIP_FLAGS_LOAD_TIMEOUT_MS } from '../../shared/components/reviewers/ReviewerInvitePanel';

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
const PR2 = '33333333-3333-4333-8333-333333333333';

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
const secondPerson = {
  suggestionId: 'S-3',
  potentialReviewerId: PR2,
  name: 'Dr. Second Person',
  email: 'second@example.edu',
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
  await waitFor(() => expect(toggle).not.toBeDisabled());
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

test('toggles are DISABLED until the initial flags GET resolves — a slow load can never be clobbered by a pre-load PUT', async () => {
  let resolveGet;
  global.fetch = jest.fn(async (url) => {
    if (String(url).startsWith('/api/review-manager/reviewer-vip-flags')) {
      return new Promise((resolve) => {
        resolveGet = () => resolve({
          ok: true,
          status: 200,
          json: async () => ({ pdSystemUserId: 'pd-1', flaggedPotentialReviewerIds: [] }),
        });
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  render(<ReviewerInvitePanel requestId="REQ-1" candidates={[withPerson]} onRefresh={() => {}} />);
  const toggle = await screen.findByRole('button', { name: /toggle vip review for dr\. keyed person/i });
  expect(toggle).toBeDisabled();
  // A click while the load is pending must not fire a PUT.
  fireEvent.click(toggle);
  expect(global.fetch.mock.calls.filter(([, opts]) => opts?.method === 'PUT')).toHaveLength(0);
  resolveGet();
  await waitFor(() => expect(toggle).not.toBeDisabled());
});

test('a pending VIP PUT is optimistic for the modal snapshot and disables every star toggle', async () => {
  let resolvePut;
  global.fetch = jest.fn((url, options) => {
    if (options?.method === 'PUT') {
      return new Promise((resolve) => { resolvePut = resolve; });
    }
    if (String(url).startsWith('/api/review-manager/reviewer-vip-flags')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ pdSystemUserId: 'pd-1', flaggedPotentialReviewerIds: [] }),
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  render(<ReviewerInvitePanel requestId="REQ-1" candidates={[withPerson, secondPerson]} onRefresh={() => {}} />);
  const firstToggle = screen.getByRole('button', { name: /toggle vip review for dr\. keyed person/i });
  const secondToggle = screen.getByRole('button', { name: /toggle vip review for dr\. second person/i });
  await waitFor(() => expect(firstToggle).not.toBeDisabled());

  fireEvent.click(firstToggle);
  expect(firstToggle).toHaveAttribute('aria-pressed', 'true');
  expect(firstToggle).toBeDisabled();
  expect(secondToggle).toBeDisabled();

  fireEvent.click(screen.getByRole('checkbox', { name: /select dr\. keyed person/i }));
  fireEvent.click(screen.getByRole('button', { name: /^Send invitation/ }));
  await waitFor(() => expect(mockModalProps.length).toBeGreaterThan(0));
  expect(mockModalProps[mockModalProps.length - 1].candidates[0].vip).toBe(true);
  expect(mockModalProps[mockModalProps.length - 1].vipUnknown).toBe(true);

  resolvePut({ ok: true, status: 200, json: async () => ({}) });
  await waitFor(() => expect(firstToggle).not.toBeDisabled());
});

test('a failed VIP PUT rolls the optimistic star state back', async () => {
  let resolvePut;
  jest.spyOn(window, 'alert').mockImplementation(() => {});
  global.fetch = jest.fn((url, options) => {
    if (options?.method === 'PUT') {
      return new Promise((resolve) => { resolvePut = resolve; });
    }
    if (String(url).startsWith('/api/review-manager/reviewer-vip-flags')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ pdSystemUserId: 'pd-1', flaggedPotentialReviewerIds: [] }),
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  render(<ReviewerInvitePanel requestId="REQ-1" candidates={[withPerson]} onRefresh={() => {}} />);
  const toggle = screen.getByRole('button', { name: /toggle vip review for dr\. keyed person/i });
  await waitFor(() => expect(toggle).not.toBeDisabled());
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-pressed', 'true');

  resolvePut({ ok: false, status: 500, json: async () => ({ error: 'save failed' }) });
  await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'false'));
  expect(window.alert).toHaveBeenCalledWith('Could not update the VIP flag: save failed');
});

test('a failed flags load is explained and stays fail-closed until Retry succeeds', async () => {
  let getAttempts = 0;
  global.fetch = jest.fn(async (url) => {
    if (String(url).startsWith('/api/review-manager/reviewer-vip-flags')) {
      getAttempts += 1;
      if (getAttempts === 1) throw new Error('network down');
      return { ok: true, status: 200, json: async () => ({ pdSystemUserId: 'pd-1', flaggedPotentialReviewerIds: [] }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  render(<ReviewerInvitePanel requestId="REQ-1" candidates={[withPerson]} onRefresh={() => {}} />);
  expect(await screen.findByText(/VIP flags unavailable/)).toBeTruthy();
  const toggle = screen.getByRole('button', { name: /toggle vip review for dr\. keyed person/i });
  expect(toggle).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /select dr\. keyed person/i }));
  fireEvent.click(screen.getByRole('button', { name: /^Send invitation/ }));
  await waitFor(() => expect(mockModalProps.length).toBeGreaterThan(0));
  expect(mockModalProps[mockModalProps.length - 1].vipUnknown).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(toggle).not.toBeDisabled());
  expect(screen.queryByText(/VIP flags unavailable/)).toBeNull();

  const priorModalCount = mockModalProps.length;
  act(() => { mockModalProps[mockModalProps.length - 1].onClose(); });
  fireEvent.click(screen.getByRole('button', { name: /^Send invitation/ }));
  await waitFor(() => expect(mockModalProps.length).toBeGreaterThan(priorModalCount));
  expect(mockModalProps[mockModalProps.length - 1].vipUnknown).toBe(false);
});

test('a hung flags GET aborts at the timeout and exposes Retry', async () => {
  jest.useFakeTimers();
  try {
    global.fetch = jest.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    render(<ReviewerInvitePanel requestId="REQ-1" candidates={[withPerson]} onRefresh={() => {}} />);
    await act(async () => {
      jest.advanceTimersByTime(VIP_FLAGS_LOAD_TIMEOUT_MS);
      await Promise.resolve();
    });
    expect(screen.getByText(/VIP flags unavailable/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /toggle vip review for dr\. keyed person/i })).toBeDisabled();
  } finally {
    jest.useRealTimers();
  }
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
