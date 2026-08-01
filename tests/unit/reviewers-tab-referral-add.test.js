/**
 * @jest-environment jsdom
 *
 * ReviewersTab — one-click decline-referral add (S354). Clicking "Add as
 * candidate" on the Track Reviewers referral callout now adds the suggested
 * person straight into the request's candidate pool via POST
 * /api/workbench/manual-reviewer (no tab hop). The server resolves identity
 * itself:
 *   - 200            → row shows an "added" action + we land on Invite Reviewers.
 *   - 409 + lookup   → row switches to an inline identity-confirm picker;
 *                      choosing a resolution re-POSTs with it.
 *   - other error    → row shows an error.
 *
 * ReviewerManagePanel is stubbed to a harness that echoes referralActions and
 * exposes onAddReferral so we can drive the flow and assert what the parent
 * does with the response.
 */
import { render, screen, waitFor, act } from '@testing-library/react';

jest.mock('../../shared/components/reviewers/ReviewerManagePanel', () => function ManagePanelStub(props) {
  return (
    <div data-testid="manage-panel" data-actions={JSON.stringify(props.referralActions || {})}>
      {(props.declineReferrals || []).map((r) => (
        <button
          key={r.suggestionId}
          data-testid={`add-${r.suggestionId}`}
          onClick={() => props.onAddReferral(r)}
        >add</button>
      ))}
      <button
        data-testid="choose-create-new"
        onClick={() => props.onAddReferral(
          { suggestionId: 's-a', referralText: 'Oleg Butovsky', reviewerName: 'Decliner A' },
          { mode: 'create_new' },
        )}
      >choose</button>
    </div>
  );
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

const REQ = 'aaaaaaaa-1111-1111-1111-111111111111';
const REFERRALS = [{ suggestionId: 's-a', reviewerName: 'Decliner A', referralText: 'Oleg Butovsky', declinedAt: null }];

function actionsOf() {
  return JSON.parse(screen.getByTestId('manage-panel').getAttribute('data-actions'));
}

function baseFetch(manualReviewerResponder) {
  return jest.fn((url, opts) => {
    const u = String(url);
    if (u.includes('/api/review-manager/reviewers')) {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, proposals: [] }) });
    }
    if (u.includes('/api/reviewer-finder/my-candidates')) {
      return Promise.resolve({ ok: true, json: async () => ({ proposals: [] }) });
    }
    if (u.includes('/api/workbench/decline-referrals')) {
      return Promise.resolve({ ok: true, json: async () => ({ referrals: REFERRALS }) });
    }
    if (u.includes('/api/workbench/manual-reviewer')) {
      return manualReviewerResponder(opts);
    }
    throw new Error(`unexpected fetch ${u}`);
  });
}

afterEach(() => {
  if (global.fetch?.mockRestore) global.fetch.mockRestore();
  jest.clearAllMocks();
});

test('a confident/new add posts name+referredBy, marks the row added, and lands on Invite Reviewers', async () => {
  let sentBody = null;
  global.fetch = baseFetch((opts) => {
    sentBody = JSON.parse(opts.body);
    return Promise.resolve({ ok: true, json: async () => ({ success: true, candidate: { name: 'Oleg Butovsky', invitable: true } }) });
  });

  render(<ReviewersTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByTestId('add-s-a')).toBeInTheDocument());

  await act(async () => { screen.getByTestId('add-s-a').click(); });

  await waitFor(() => expect(actionsOf()['s-a']?.status).toBe('added'));
  expect(actionsOf()['s-a'].addedName).toBe('Oleg Butovsky');
  // No resolution on the first attempt — the server resolves identity itself.
  expect(sentBody).toMatchObject({ requestId: REQ, name: 'Oleg Butovsky', referredBy: 'Decliner A' });
  expect(sentBody.resolution).toBeUndefined();
  // Landed on the Invite Reviewers sub-tab.
  expect(mockPush).toHaveBeenCalledWith(
    expect.objectContaining({ query: expect.objectContaining({ sub: 'candidates' }) }),
    undefined,
    { shallow: true },
  );
});

test('an ambiguous identity (409 + lookup) switches the row to confirm; choosing a resolution re-posts it', async () => {
  const calls = [];
  global.fetch = baseFetch((opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    if (!body.resolution) {
      return Promise.resolve({
        ok: false,
        status: 409,
        json: async () => ({
          error: 'needs confirmation',
          code: 'resolution_required',
          lookup: { outcome: 'candidates', candidates: [{ source: 'reviewer', reviewerId: 'r-1', context: { name: 'Oleg Butovsky' } }] },
        }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({ success: true, candidate: { name: 'Oleg Butovsky', invitable: false } }) });
  });

  render(<ReviewersTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByTestId('add-s-a')).toBeInTheDocument());

  await act(async () => { screen.getByTestId('add-s-a').click(); });
  await waitFor(() => expect(actionsOf()['s-a']?.status).toBe('confirm'));
  expect(actionsOf()['s-a'].lookup.outcome).toBe('candidates');

  await act(async () => { screen.getByTestId('choose-create-new').click(); });
  await waitFor(() => expect(actionsOf()['s-a']?.status).toBe('added'));

  expect(calls).toHaveLength(2);
  expect(calls[0].resolution).toBeUndefined();
  expect(calls[1].resolution).toEqual({ mode: 'create_new' });
});

test('an excluded reviewer surfaces a clear inline error', async () => {
  global.fetch = baseFetch(() => Promise.resolve({
    ok: false,
    status: 409,
    json: async () => ({ error: 'excluded', code: 'applicant_excluded' }),
  }));

  render(<ReviewersTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByTestId('add-s-a')).toBeInTheDocument());

  await act(async () => { screen.getByTestId('add-s-a').click(); });
  await waitFor(() => expect(actionsOf()['s-a']?.status).toBe('error'));
  expect(actionsOf()['s-a'].error).toMatch(/excluded/i);
});

test.each(['promotion_required', 'restore_required', 'already_handled'])('typed %s response renders a remedy and does not falsely navigate to Invite', async (outcome) => {
  global.fetch = baseFetch(() => Promise.resolve({
    ok: true,
    json: async () => ({
      success: true,
      outcome,
      suggestionId: 's-existing',
      stage: outcome === 'restore_required' ? 'declined' : outcome === 'already_handled' ? 'invited' : 'recommended',
      remedy: outcome === 'restore_required'
        ? 'Restore this previously declined reviewer from Removed.'
        : outcome === 'already_handled'
          ? 'Open Track Reviewers to continue from the current engagement stage.'
          : 'Promote this applicant-recommended reviewer from Find.',
    }),
  }));

  render(<ReviewersTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByTestId('add-s-a')).toBeInTheDocument());
  await act(async () => { screen.getByTestId('add-s-a').click(); });

  await waitFor(() => expect(actionsOf()['s-a']?.status).toBe('remedy'));
  expect(actionsOf()['s-a']).toMatchObject({ outcome, suggestionId: 's-existing' });
  expect(mockPush).not.toHaveBeenCalled();
});
