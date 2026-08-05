/**
 * @jest-environment jsdom
 *
 * ReviewersTab — post-invite-send refresh contract (S400 finding 2: after a
 * send, just-invited candidates re-rendered as still invitable until a manual
 * page reload).
 *
 * Two protections under test:
 *   1. Confirmed-invite overlay: refreshAll({ invitedSuggestionIds, sentAt })
 *      paints those rows invited on top of whatever the my-candidates refetch
 *      returns — the send stream already confirmed the wmkf_invited stamp
 *      committed, so even a read that lags the write cannot show the rows as
 *      invitable. Anything that isn't that exact payload shape (e.g. a click
 *      event, since refreshAll is handed around as a bare callback) is ignored.
 *   2. Same-request newest-wins guard: an older in-flight my-candidates
 *      response must not repaint over a newer one (the pre-existing
 *      stale-request guard only covered cross-request navigation).
 *
 * Child panels are mocked to stubs so ReviewersTab renders in isolation;
 * ReviewerInvitePanel echoes its candidates prop and exposes buttons that
 * exercise onRefresh the way the real panel's afterSent does.
 */
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

jest.mock('../../shared/components/reviewers/ReviewerManagePanel', () => function ManagePanelStub() {
  return <div data-testid="manage-panel" />;
});
jest.mock('../../shared/components/reviewers/ReviewerFindPanel', () => function FindPanelStub() {
  return <div data-testid="find-panel" />;
});
jest.mock('../../shared/components/reviewers/ReviewerInvitePanel', () => function InvitePanelStub(props) {
  return (
    <div data-testid="invite-panel" data-candidates={JSON.stringify(props.candidates || [])}>
      <button
        type="button"
        onClick={() => props.onRefresh({ invitedSuggestionIds: ['s-1'], sentAt: '2026-08-04T12:00:00Z' })}
      >
        refresh-confirmed
      </button>
      {/* afterSent forwards whatever the modal passed; a non-payload arg (or a
          click event when refreshAll is bound directly) must be ignored. */}
      <button type="button" onClick={(e) => props.onRefresh(e)}>refresh-event-arg</button>
      <button type="button" onClick={() => props.onRefresh()}>refresh-plain</button>
    </div>
  );
});
jest.mock('../../shared/components/reviewers/EmailTemplatesModal', () => function EmailTemplatesModalStub() {
  return null;
});
jest.mock('../../shared/components/reviewers/CampaignConfigModal', () => function CampaignConfigModalStub() {
  return null;
});

const mockPush = jest.fn();
jest.mock('next/router', () => ({
  useRouter: () => ({ query: { sub: 'candidates' }, pathname: '/workbench/[requestId]', push: mockPush }),
}));

import ReviewersTab from '../../shared/components/reviewers/ReviewersTab';

const REQ = 'aaaaaaaa-1111-1111-1111-111111111111';

function candidatesPayload(rows) {
  return { proposals: [{ proposalId: REQ, candidates: rows }] };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function candidatesOf() {
  return JSON.parse(screen.getByTestId('invite-panel').getAttribute('data-candidates'));
}

function mockFetchWithCandidates(candidatesImpl) {
  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (u.includes('/api/review-manager/reviewers')) {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, proposals: [] }) });
    }
    if (u.includes('/api/workbench/decline-referrals')) {
      return Promise.resolve({ ok: true, json: async () => ({ referrals: [] }) });
    }
    if (u.includes('/api/reviewer-finder/my-candidates')) {
      return candidatesImpl();
    }
    throw new Error(`unexpected fetch ${u}`);
  });
}

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

const STALE_ROWS = [
  { suggestionId: 's-1', name: 'Just Invited', invited: false, emailSentAt: null },
  { suggestionId: 's-2', name: 'Still Invitable', invited: false, emailSentAt: null },
];

test('a confirmed-invite refresh paints the sent rows invited even when the refetch returns a stale read', async () => {
  // The server read NEVER reflects the send in this test — the overlay alone
  // must carry the confirmed facts.
  mockFetchWithCandidates(() => Promise.resolve({ ok: true, json: async () => candidatesPayload(STALE_ROWS) }));

  render(<ReviewersTab requestId={REQ} />);
  await waitFor(() => expect(candidatesOf()).toHaveLength(2));

  fireEvent.click(screen.getByRole('button', { name: 'refresh-confirmed' }));

  await waitFor(() => {
    const rows = candidatesOf();
    expect(rows.find((c) => c.suggestionId === 's-1')).toMatchObject({
      invited: true,
      emailSentAt: '2026-08-04T12:00:00Z',
    });
    expect(rows.find((c) => c.suggestionId === 's-2')).toMatchObject({ invited: false });
  });
});

test('a non-payload onRefresh argument (click event) is ignored — no overlay, no crash', async () => {
  mockFetchWithCandidates(() => Promise.resolve({ ok: true, json: async () => candidatesPayload(STALE_ROWS) }));

  render(<ReviewersTab requestId={REQ} />);
  await waitFor(() => expect(candidatesOf()).toHaveLength(2));

  fireEvent.click(screen.getByRole('button', { name: 'refresh-event-arg' }));

  await waitFor(() => expect(global.fetch.mock.calls.filter(([u]) => String(u).includes('my-candidates')).length).toBeGreaterThan(1));
  await waitFor(() => {
    expect(candidatesOf().every((c) => c.invited === false)).toBe(true);
  });
});

test('server truth reasserts after the overlay window (Codex S401: concurrent reset must not stay painted invited)', async () => {
  jest.useFakeTimers();
  // The refetch NEVER reflects the send — as if a concurrent remove → restore
  // legitimately reset the row (ENGAGEMENT_STAMP_RESET clears wmkf_invited)
  // while the send/refresh was in flight. The overlay may paint the row
  // invited for the moment, but the reconciling refetch must repaint the
  // server's reset state instead of letting the stale send fact stand.
  mockFetchWithCandidates(() => Promise.resolve({ ok: true, json: async () => candidatesPayload(STALE_ROWS) }));

  render(<ReviewersTab requestId={REQ} />);
  await waitFor(() => expect(candidatesOf()).toHaveLength(2));

  fireEvent.click(screen.getByRole('button', { name: 'refresh-confirmed' }));
  await waitFor(() => expect(candidatesOf().find((c) => c.suggestionId === 's-1')?.invited).toBe(true));

  await act(async () => {
    jest.advanceTimersByTime(4100);
  });

  await waitFor(() => expect(candidatesOf().find((c) => c.suggestionId === 's-1')?.invited).toBe(false));
});

test('an older in-flight my-candidates response does not repaint over a newer one (same request)', async () => {
  const first = deferred();
  let call = 0;
  mockFetchWithCandidates(() => {
    call += 1;
    if (call === 1) return first.promise; // mount load — held until after the refresh lands
    return Promise.resolve({
      ok: true,
      json: async () => candidatesPayload([
        { suggestionId: 's-1', name: 'Just Invited', invited: true, emailSentAt: '2026-08-04T12:00:00Z' },
      ]),
    });
  });

  render(<ReviewersTab requestId={REQ} />);

  // Trigger the newer load while the mount load is still in flight.
  fireEvent.click(screen.getByRole('button', { name: 'refresh-plain' }));
  await waitFor(() => expect(candidatesOf().find((c) => c.suggestionId === 's-1')?.invited).toBe(true));

  // The stale mount response resolves LAST — it must be dropped, not painted.
  await act(async () => {
    first.resolve({ ok: true, json: async () => candidatesPayload(STALE_ROWS) });
  });

  const rows = candidatesOf();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ suggestionId: 's-1', invited: true });
});
