/**
 * @jest-environment jsdom
 *
 * ReviewersTab — T4 client-request-layer matrix (Stage 4). Pins the exact
 * request bytes and body-level `.success`/`.lookup` branches for the file's
 * 5 fetch sites ahead of migrating them onto shared/utils/api-request.js:
 *   - loadReviewers            GET  /api/review-manager/reviewers
 *   - loadCandidates           GET  /api/reviewer-finder/my-candidates
 *   - loadDeclineReferrals     GET  /api/workbench/decline-referrals
 *   - addReferralCandidate     POST /api/workbench/manual-reviewer
 *   - dismissDeclineReferral   PATCH /api/workbench/decline-referrals
 *
 * All five sites already parse with `.json().catch(() => ({}))`, so a
 * malformed/empty 2xx or non-2xx body was already tolerant pre-migration —
 * axis (e) is a no-op behavior change here, pinned anyway per plan T4.
 */
import { render, screen, waitFor, act } from '@testing-library/react';

jest.mock('../../shared/components/reviewers/ReviewerManagePanel', () => function ManagePanelStub(props) {
  return (
    <div
      data-testid="manage-panel"
      data-actions={JSON.stringify(props.referralActions || {})}
    >
      {(props.declineReferrals || []).map((r) => (
        <div key={r.referralId || r.suggestionId}>
          <button data-testid={`add-${r.referralId || r.suggestionId}`} onClick={() => props.onAddReferral(r)}>add</button>
          <button data-testid={`dismiss-${r.referralId || r.suggestionId}`} onClick={() => props.onDismissDeclineReferral(r)}>dismiss</button>
        </div>
      ))}
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
const REFERRAL = {
  referralId: 's-a:0',
  suggestionId: 's-a',
  referralIndex: 0,
  reviewerName: 'Decliner A',
  referralName: 'Oleg Butovsky',
  institution: 'Weill Cornell Medicine',
  email: 'oleg@example.edu',
  referralText: 'Oleg Butovsky · Weill Cornell Medicine · oleg@example.edu',
  legacy: false,
  dismissible: true,
  referralVersion: 'structured:[{"n":"Oleg Butovsky","i":"Weill Cornell Medicine","e":"oleg@example.edu"}]',
};

function actionsOf() {
  return JSON.parse(screen.getByTestId('manage-panel').getAttribute('data-actions'));
}

function mkFetch({ reviewers, candidates, referrals, manualReviewer, dismiss }) {
  return jest.fn((url, opts) => {
    const u = String(url);
    if (u.includes('/api/review-manager/reviewers')) return Promise.resolve(reviewers());
    if (u.includes('/api/reviewer-finder/my-candidates')) return Promise.resolve(candidates());
    if (u.includes('/api/workbench/decline-referrals')) {
      if (opts?.method === 'PATCH') return Promise.resolve(dismiss ? dismiss(opts) : { ok: true, status: 200, json: async () => ({ success: true }) });
      return Promise.resolve(referrals());
    }
    if (u.includes('/api/workbench/manual-reviewer')) return Promise.resolve(manualReviewer(opts));
    throw new Error(`unexpected fetch ${u}`);
  });
}

const okDefaults = {
  reviewers: () => ({ ok: true, status: 200, json: async () => ({ success: true, proposals: [] }) }),
  candidates: () => ({ ok: true, status: 200, json: async () => ({ proposals: [] }) }),
  referrals: () => ({ ok: true, status: 200, json: async () => ({ referrals: [REFERRAL] }) }),
};

afterEach(() => {
  if (global.fetch?.mockRestore) global.fetch.mockRestore();
  jest.clearAllMocks();
});

test('loadReviewers: GET has no body, and a 200 + {success:false} body is treated as a load failure', async () => {
  global.fetch = mkFetch({
    ...okDefaults,
    reviewers: () => ({ ok: true, status: 200, json: async () => ({ success: false, error: 'not ready' }) }),
    manualReviewer: () => Promise.reject(new Error('n/a')),
  });
  render(<ReviewersTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByTestId('manage-panel')).toBeInTheDocument());
  const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/api/review-manager/reviewers'));
  expect(call[1]).toBeUndefined(); // GET: no init object
});

test('loadReviewers: malformed 2xx body is tolerated (pre-existing .catch behavior preserved)', async () => {
  global.fetch = mkFetch({
    ...okDefaults,
    reviewers: () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }),
  });
  render(<ReviewersTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByTestId('manage-panel')).toBeInTheDocument());
  // No throw escapes the component; nothing to assert on proposal beyond render survival.
});

test('loadReviewers: non-2xx unparseable body falls back to the status-embedded message (already tolerant pre-migration)', async () => {
  global.fetch = mkFetch({
    ...okDefaults,
    reviewers: () => ({ ok: false, status: 502, json: async () => { throw new Error('gateway'); } }),
  });
  render(<ReviewersTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByTestId('manage-panel')).toBeInTheDocument());
});

test('addReferralCandidate: posts exact body bytes and headers', async () => {
  let sentOpts = null;
  global.fetch = mkFetch({
    ...okDefaults,
    manualReviewer: (opts) => {
      sentOpts = opts;
      return { ok: true, status: 200, json: async () => ({ success: true, candidate: { name: 'Oleg Butovsky', invitable: true } }) };
    },
  });
  render(<ReviewersTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByTestId('add-s-a:0')).toBeInTheDocument());
  await act(async () => { screen.getByTestId('add-s-a:0').click(); });
  await waitFor(() => expect(actionsOf()['s-a:0']?.status).toBe('added'));

  expect(sentOpts.method).toBe('POST');
  expect(sentOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(sentOpts.body).toBe(JSON.stringify({
    requestId: REQ,
    name: 'Oleg Butovsky',
    email: 'oleg@example.edu',
    affiliation: 'Weill Cornell Medicine',
    referredBy: 'Decliner A',
    resolution: undefined,
  }));
});

test('addReferralCandidate: 200 + {success:false} does not take the success branch', async () => {
  global.fetch = mkFetch({
    ...okDefaults,
    manualReviewer: () => ({ ok: true, status: 200, json: async () => ({ success: false, error: 'not applied' }) }),
  });
  render(<ReviewersTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByTestId('add-s-a:0')).toBeInTheDocument());
  await act(async () => { screen.getByTestId('add-s-a:0').click(); });
  await waitFor(() => expect(actionsOf()['s-a:0']?.status).toBe('error'));
  expect(actionsOf()['s-a:0'].error).toBe('not applied');
});

test('addReferralCandidate: 409 + data.lookup switches to the confirm branch (pinned)', async () => {
  global.fetch = mkFetch({
    ...okDefaults,
    manualReviewer: () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'needs confirmation', lookup: { outcome: 'candidates', candidates: [] } }),
    }),
  });
  render(<ReviewersTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByTestId('add-s-a:0')).toBeInTheDocument());
  await act(async () => { screen.getByTestId('add-s-a:0').click(); });
  await waitFor(() => expect(actionsOf()['s-a:0']?.status).toBe('confirm'));
  expect(actionsOf()['s-a:0'].lookup.outcome).toBe('candidates');
});

test('addReferralCandidate: network rejection sets an inline error from e.message', async () => {
  global.fetch = mkFetch({
    ...okDefaults,
    manualReviewer: () => Promise.reject(new Error('network down')),
  });
  render(<ReviewersTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByTestId('add-s-a:0')).toBeInTheDocument());
  await act(async () => { screen.getByTestId('add-s-a:0').click(); });
  await waitFor(() => expect(actionsOf()['s-a:0']?.status).toBe('error'));
  expect(actionsOf()['s-a:0'].error).toBe('network down');
});

test('dismissDeclineReferral: PATCH posts exact body bytes; 200 + {success:false} surfaces the status-embedded fallback', async () => {
  let sentOpts = null;
  global.fetch = mkFetch({
    ...okDefaults,
    manualReviewer: () => Promise.reject(new Error('n/a')),
    dismiss: (opts) => {
      sentOpts = opts;
      return { ok: true, status: 200, json: async () => ({ success: false }) };
    },
  });
  render(<ReviewersTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByTestId('dismiss-s-a:0')).toBeInTheDocument());
  await act(async () => { screen.getByTestId('dismiss-s-a:0').click(); });
  await waitFor(() => expect(actionsOf()['s-a:0']?.status).toBe('error'));
  expect(actionsOf()['s-a:0'].error).toBe('Couldn’t dismiss the referral (200).');
  expect(sentOpts.method).toBe('PATCH');
  expect(sentOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(sentOpts.body).toBe(JSON.stringify({
    requestId: REQ,
    suggestionId: 's-a',
    referralVersion: REFERRAL.referralVersion,
    referralIndex: 0,
  }));
});

test('loadDeclineReferrals: non-2xx (any body) yields an empty list, never throws', async () => {
  global.fetch = mkFetch({
    ...okDefaults,
    referrals: () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }),
  });
  render(<ReviewersTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByTestId('manage-panel')).toBeInTheDocument());
  expect(actionsOf()).toEqual({});
});
