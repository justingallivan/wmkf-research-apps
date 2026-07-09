/**
 * @jest-environment jsdom
 *
 * ReviewersTab — stale-request guard regression (Codex adversarial review,
 * finding 2). ReviewersTab is NOT keyed by requestId (the [requestId].js key
 * is on AwardeeTab), so the instance is reused across request navigations. An
 * in-flight decline-referrals fetch from the PRIOR request must not paint its
 * referrals onto the NEW request — otherwise the Track callout/badge, and the
 * "Add as candidate" action, would apply the wrong request's data.
 *
 * The child panels are mocked to stubs so ReviewersTab renders in isolation and
 * its children don't fire their own fetches; ReviewerManagePanel echoes the
 * declineReferrals prop it receives so we can assert what the Track callout
 * would show.
 */
import { render, screen, waitFor, act } from '@testing-library/react';

jest.mock('../../shared/components/reviewers/ReviewerManagePanel', () => function ManagePanelStub(props) {
  return <div data-testid="manage-panel" data-referrals={JSON.stringify(props.declineReferrals || [])} />;
});
jest.mock('../../shared/components/reviewers/ReviewerFindPanel', () => function FindPanelStub() {
  return <div data-testid="find-panel" />;
});
jest.mock('../../shared/components/reviewers/ReviewerInvitePanel', () => function InvitePanelStub() {
  return <div data-testid="invite-panel" />;
});
jest.mock('../../shared/components/reviewers/EmailTemplatesModal', () => function EmailTemplatesModalStub() {
  return null;
});
jest.mock('../../shared/components/reviewers/CampaignConfigModal', () => function CampaignConfigModalStub() {
  return null;
});

const mockPush = jest.fn();
jest.mock('next/router', () => ({
  useRouter: () => ({ query: { sub: 'track' }, pathname: '/workbench/[requestId]', push: mockPush }),
}));

import ReviewersTab from '../../shared/components/reviewers/ReviewersTab';

const REQ_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const REQ_B = 'bbbbbbbb-2222-2222-2222-222222222222';
const REFERRALS_A = [{ suggestionId: 's-a', reviewerName: 'Decliner A', referralText: 'A-referral-text', declinedAt: null }];
const REFERRALS_B = [{ suggestionId: 's-b', reviewerName: 'Decliner B', referralText: 'B-referral-text', declinedAt: null }];

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function referralsOf() {
  return JSON.parse(screen.getByTestId('manage-panel').getAttribute('data-referrals'));
}

afterEach(() => {
  if (global.fetch?.mockRestore) global.fetch.mockRestore();
  jest.clearAllMocks();
});

test('a late decline-referrals response from the prior request does NOT overwrite the new request', async () => {
  // Request A's decline-referrals fetch is held open; every other fetch (and
  // request B's referrals) resolves immediately.
  const declineA = deferred();
  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (u.includes('/api/review-manager/reviewers')) {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, proposals: [] }) });
    }
    if (u.includes('/api/reviewer-finder/my-candidates')) {
      return Promise.resolve({ ok: true, json: async () => ({ proposals: [] }) });
    }
    if (u.includes('/api/workbench/decline-referrals')) {
      if (u.includes(REQ_A)) return declineA.promise; // held — resolves AFTER we navigate to B
      if (u.includes(REQ_B)) return Promise.resolve({ ok: true, json: async () => ({ referrals: REFERRALS_B }) });
    }
    throw new Error(`unexpected fetch ${u}`);
  });

  const { rerender } = render(<ReviewersTab requestId={REQ_A} />);

  // Navigate to request B while A's referral fetch is still pending.
  await act(async () => {
    rerender(<ReviewersTab requestId={REQ_B} />);
  });

  // B's referrals land.
  await waitFor(() => expect(referralsOf()).toEqual(REFERRALS_B));

  // Now the stale request-A response finally arrives.
  await act(async () => {
    declineA.resolve({ ok: true, json: async () => ({ referrals: REFERRALS_A }) });
    await declineA.promise;
  });

  // The guard must have dropped it: still B's referrals, never A's.
  expect(referralsOf()).toEqual(REFERRALS_B);
  expect(referralsOf()).not.toContainEqual(expect.objectContaining({ suggestionId: 's-a' }));
});

test('referrals are cleared immediately on request change (no stale flash)', async () => {
  // Both requests hold their decline-referrals fetch open so we can observe the
  // interim state right after navigation, before either resolves.
  const declineA = deferred();
  const declineB = deferred();
  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (u.includes('/api/review-manager/reviewers')) {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, proposals: [] }) });
    }
    if (u.includes('/api/reviewer-finder/my-candidates')) {
      return Promise.resolve({ ok: true, json: async () => ({ proposals: [] }) });
    }
    if (u.includes('/api/workbench/decline-referrals')) {
      if (u.includes(REQ_A)) return declineA.promise;
      if (u.includes(REQ_B)) return declineB.promise;
    }
    throw new Error(`unexpected fetch ${u}`);
  });

  const { rerender } = render(<ReviewersTab requestId={REQ_A} />);
  await act(async () => {
    declineA.resolve({ ok: true, json: async () => ({ referrals: REFERRALS_A }) });
    await declineA.promise;
  });
  await waitFor(() => expect(referralsOf()).toEqual(REFERRALS_A));

  // Navigate to B; B's fetch is still pending, so the callout must show nothing
  // (cleared), NOT request A's stale referrals.
  await act(async () => {
    rerender(<ReviewersTab requestId={REQ_B} />);
  });
  expect(referralsOf()).toEqual([]);

  // B resolves → its own referrals appear.
  await act(async () => {
    declineB.resolve({ ok: true, json: async () => ({ referrals: REFERRALS_B }) });
    await declineB.promise;
  });
  await waitFor(() => expect(referralsOf()).toEqual(REFERRALS_B));
});
