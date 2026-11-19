/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

let findPanelProps = null;
let invitePanelProps = null;
let managePanelProps = null;
const existingKey = 'akoya_request::REQ/Phase I::ProjectDescription.pdf';
const mockReplacementKey = 'akoya_request::REQ/Reviewer Materials::Proposal_1003010.pdf';
jest.mock('../../shared/components/reviewers/ReviewerFindPanel', () => function FindPanelStub(props) {
  findPanelProps = props;
  return (
    <button
      data-testid="persist-proposal"
      data-file-key={props.proposalFileKey || ''}
      onClick={() => props.onProposalFileKeyChange(mockReplacementKey)}
    >persist</button>
  );
});
jest.mock('../../shared/components/reviewers/ReviewerManagePanel', () => function ManagePanelStub(props) {
  managePanelProps = props;
  return null;
});
jest.mock('../../shared/components/reviewers/ReviewerInvitePanel', () => function InvitePanelStub(props) {
  invitePanelProps = props;
  return null;
});
jest.mock('../../shared/components/reviewers/EmailTemplatesModal', () => function EmailTemplatesModalStub() {
  return null;
});
jest.mock('../../shared/components/reviewers/CampaignConfigModal', () => function CampaignConfigModalStub() {
  return null;
});

const mockReplace = jest.fn();
const router = {
  isReady: true,
  pathname: '/workbench/[requestId]',
  query: {
    requestId: 'aaaaaaaa-1111-1111-1111-111111111111',
    tab: 'reviewers',
    sub: 'find',
    proposalFile: existingKey,
  },
  push: jest.fn(),
  replace: mockReplace,
};
jest.mock('next/router', () => ({ useRouter: () => router }));

import ReviewersTab from '../../shared/components/reviewers/ReviewersTab';

const REQ = 'aaaaaaaa-1111-1111-1111-111111111111';

beforeEach(() => {
  findPanelProps = null;
  invitePanelProps = null;
  managePanelProps = null;
  mockReplace.mockClear();
  router.push.mockClear();
  router.query = {
    requestId: REQ,
    tab: 'reviewers',
    sub: 'find',
    proposalFile: existingKey,
  };
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/review-manager/reviewers')) {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, proposals: [] }) });
    }
    if (target.includes('/api/reviewer-finder/my-candidates')) {
      return Promise.resolve({ ok: true, json: async () => ({ proposals: [] }) });
    }
    if (target.includes('/api/workbench/decline-referrals')) {
      return Promise.resolve({ ok: true, json: async () => ({ referrals: [] }) });
    }
    throw new Error(`unexpected fetch ${target}`);
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('passes the URL-backed proposal file key into Find and replaces it without dropping other navigation state', async () => {
  render(<ReviewersTab requestId={REQ} />);

  const persist = await screen.findByTestId('persist-proposal');
  expect(persist).toHaveAttribute('data-file-key', existingKey);
  expect(findPanelProps.proposalBindingReady).toBe(true);

  persist.click();

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(
    {
      pathname: '/workbench/[requestId]',
      query: expect.objectContaining({
        requestId: REQ,
        tab: 'reviewers',
        sub: 'find',
        proposalFile: mockReplacementKey,
      }),
    },
    undefined,
    { shallow: true },
  ));
});

test('ignores a repeated/malformed proposalFile query instead of granting it file authority', async () => {
  router.query = {
    requestId: REQ,
    tab: 'reviewers',
    sub: 'find',
    proposalFile: [existingKey, 'other-key'],
  };

  render(<ReviewersTab requestId={REQ} />);

  expect(await screen.findByTestId('persist-proposal')).toHaveAttribute('data-file-key', '');
  expect(findPanelProps.proposalFileKey).toBeNull();
});

test('passes a repair deep-link candidate key into the Find panel', async () => {
  router.query = {
    requestId: REQ,
    tab: 'reviewers',
    sub: 'find',
    repairCandidate: 'candidate:reviewer-name|email:-',
  };

  render(<ReviewersTab requestId={REQ} />);

  await screen.findByTestId('persist-proposal');
  expect(findPanelProps.repairCandidateKey).toBe('candidate:reviewer-name|email:-');
});

test('passes an Invite-origin repair suggestion into the Invite panel', async () => {
  router.query = {
    requestId: REQ,
    tab: 'reviewers',
    sub: 'candidates',
    repairSuggestion: 'suggestion-guid',
  };

  render(<ReviewersTab requestId={REQ} />);

  await waitFor(() => expect(invitePanelProps).not.toBeNull());
  expect(invitePanelProps.repairSuggestionId).toBe('suggestion-guid');
});

test('makes reviewer follow-up available in Track Reviewers', async () => {
  router.query = {
    requestId: REQ,
    tab: 'reviewers',
    sub: 'track',
  };

  render(<ReviewersTab requestId={REQ} />);

  await waitFor(() => expect(managePanelProps).not.toBeNull());
  expect(managePanelProps.mode).toBe('track');
  expect(managePanelProps.showReviewReminderAction).toBe(true);
});


test('J27 opens on one roster with invitation, response and review progress, and opens Finder on demand', async () => {
  router.query = { requestId: REQ, tab: 'peer-review', section: 'panel', proposalFile: existingKey };
  const originalFetch = global.fetch;
  const accepted = { suggestionId: 'a', name: 'Accepted reviewer', invited: true };
  const receivedWithoutInvite = {
    suggestionId: 'r', name: 'Received without invite', invited: false, accepted: false,
    reviewReceivedAt: '2026-11-07T12:00:00Z', canRemove: false,
  };
  const candidates = [
    { suggestionId: 'p', name: 'Pending reviewer', invited: true },
    { suggestionId: 'd', name: 'Declined reviewer', invited: true, responseType: 'declined' },
    { suggestionId: 's', name: 'Saved candidate' },
    accepted,
    receivedWithoutInvite,
  ];
  global.fetch = jest.fn((url) => {
    if (url.includes('/api/reviewer-finder/my-candidates')) {
      return Promise.resolve({ ok: true, json: async () => ({ proposals: [{ candidates }] }) });
    }
    if (url.includes('/api/review-manager/reviewers')) {
      return Promise.resolve({ ok: true, json: async () => ({
        success: true,
        proposals: [{ reviewers: [
          { ...accepted, reviewStatus: 'review_received' },
          { ...receivedWithoutInvite, reviewStatus: 'review_received' },
        ] }],
      }) });
    }
    return originalFetch(url);
  });

  const { rerender } = render(<ReviewersTab requestId={REQ} phaseLayout />);
  // With no view in the address it opens where work is waiting: reviews are out, so Track.
  const views = await screen.findByRole('navigation', { name: 'Reviewer panel views' });
  await waitFor(() => expect(within(views).getByRole('button', { name: /^Track/ })).toHaveAttribute('aria-current', 'page'));
  expect(screen.queryByRole('table', { name: 'Reviewer roster' })).toBeNull();
  router.query = { ...router.query, sub: 'roster' };
  rerender(<ReviewersTab requestId={REQ} phaseLayout />);
  const table = await screen.findByRole('table', { name: 'Reviewer roster' });
  const cells = (name) => within(within(table).getByRole('row', { name })).getAllByRole('cell').map((cell) => cell.textContent);
  expect(cells(/Pending reviewer/)).toEqual(['Invited', 'Awaiting response', '—']);
  expect(cells(/Declined reviewer/)).toEqual(['Invited', 'Declined', '—']);
  expect(cells(/Saved candidate/)).toEqual(['Not invited', '—', '—']);
  expect(cells(/Accepted reviewer/)).toEqual(['Invited', 'Accepted', 'Review Received']);
  expect(cells(/Received without invite/)).toEqual(['Unconfirmed', 'Accepted', 'Review Received']);
  expect(findPanelProps).toBeNull();

  const navigation = screen.getByRole('navigation', { name: 'Reviewer panel views' });
  const order = () => within(navigation).getAllByRole('button').map(button => button.firstChild.textContent);
  // Owner, 2026-11-11: the work views in order, then the read-only roster summary.
  expect(order()).toEqual(['Find', 'Invite', 'Track', 'Roster']);
  expect(within(navigation).getByRole('button', { name: 'Invite 1' })).toBeInTheDocument();
  expect(within(navigation).getByRole('button', { name: 'Roster' })).toHaveAttribute('aria-current', 'page');

  fireEvent.click(within(navigation).getByRole('button', { name: 'Find' }));
  const [{ query }] = router.push.mock.lastCall;
  expect(query).toEqual({ ...router.query, sub: 'find' });

  router.query = query;
  rerender(<ReviewersTab requestId={REQ} phaseLayout />);
  expect(await screen.findByTestId('persist-proposal')).toHaveAttribute('data-file-key', existingKey);
  expect(order()).toEqual(['Find', 'Invite', 'Track', 'Roster']);
  expect(within(navigation).getByRole('button', { name: 'Find' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('button', { name: /Campaign settings/ })).toBeNull();
  fireEvent.click(within(navigation).getByRole('button', { name: 'Roster' }));
  expect(router.push.mock.lastCall[0].query).toEqual({
    requestId: REQ, tab: 'peer-review', section: 'panel', proposalFile: existingKey, sub: 'roster',
  });
  router.query = { ...router.query, sub: 'candidates' };
  rerender(<ReviewersTab requestId={REQ} phaseLayout />);
  expect(invitePanelProps.candidates.map((candidate) => candidate.suggestionId)).toEqual(['p', 'd', 's', 'a']);
});

test('J27 opens on Invite when saved candidates wait and nobody has accepted, and stays there after inviting', async () => {
  router.query = { requestId: REQ, tab: 'peer-review', section: 'panel' };
  const originalFetch = global.fetch;
  let candidates = [{ suggestionId: 's', name: 'Saved candidate' }];
  global.fetch = jest.fn((url) => {
    if (url.includes('/api/reviewer-finder/my-candidates')) {
      return Promise.resolve({ ok: true, json: async () => ({ proposals: [{ candidates }] }) });
    }
    if (url.includes('/api/review-manager/reviewers')) {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, proposals: [{ reviewers: [] }] }) });
    }
    return originalFetch(url);
  });
  render(<ReviewersTab requestId={REQ} phaseLayout />);
  const views = await screen.findByRole('navigation', { name: 'Reviewer panel views' });
  await waitFor(() => expect(within(views).getByRole('button', { name: /^Invite/ })).toHaveAttribute('aria-current', 'page'));
  expect(invitePanelProps.candidates.map((candidate) => candidate.suggestionId)).toEqual(['s']);
  expect(findPanelProps).toBeNull();

  // The candidate list reloads after an invitation; the opening view does not move to Find.
  candidates = [{ suggestionId: 's', name: 'Saved candidate', invited: true }];
  await act(async () => { await invitePanelProps.onRefresh(); });
  await waitFor(() => expect(invitePanelProps.candidates[0].invited).toBe(true));
  expect(within(views).getByRole('button', { name: /^Invite/ })).toHaveAttribute('aria-current', 'page');
  expect(findPanelProps).toBeNull();
});

test('J27 opens on Find when every saved candidate is already invited', async () => {
  router.query = { requestId: REQ, tab: 'peer-review', section: 'panel' };
  const originalFetch = global.fetch;
  global.fetch = jest.fn((url) => {
    if (url.includes('/api/reviewer-finder/my-candidates')) {
      return Promise.resolve({ ok: true, json: async () => ({ proposals: [{ candidates: [{ suggestionId: 'p', name: 'Pending', invited: true }] }] }) });
    }
    if (url.includes('/api/review-manager/reviewers')) {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, proposals: [{ reviewers: [] }] }) });
    }
    return originalFetch(url);
  });
  render(<ReviewersTab requestId={REQ} phaseLayout />);
  const views = await screen.findByRole('navigation', { name: 'Reviewer panel views' });
  await waitFor(() => expect(within(views).getByRole('button', { name: 'Find' })).toHaveAttribute('aria-current', 'page'));
});

test('earlier cycles keep opening on Find even with saved candidates waiting', async () => {
  router.query = { requestId: REQ, tab: 'reviewers' };
  const originalFetch = global.fetch;
  global.fetch = jest.fn((url) => {
    if (url.includes('/api/reviewer-finder/my-candidates')) {
      return Promise.resolve({ ok: true, json: async () => ({ proposals: [{ candidates: [{ suggestionId: 's', name: 'Saved candidate' }] }] }) });
    }
    if (url.includes('/api/review-manager/reviewers')) {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, proposals: [{ reviewers: [] }] }) });
    }
    return originalFetch(url);
  });
  render(<ReviewersTab requestId={REQ} />);
  await screen.findByTestId('persist-proposal');
  expect(invitePanelProps).toBeNull();
});
