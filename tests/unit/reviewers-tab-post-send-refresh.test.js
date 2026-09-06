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
 *
 * ReviewerManagePanel is NOT stubbed (unlike the other child panels) — the
 * post-send/failing-refresh test below drives the real panel and its nested
 * ReleaseMaterialsModal so the modal-session assertions are meaningful. This
 * is safe for every other test in this file: they all run with `mockSub` at
 * 'candidates' or 'find', so `current` never routes to ManagePanel.
 */
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { TextDecoder as NodeTextDecoder } from 'util';

jest.mock('@vercel/blob/client', () => ({ upload: jest.fn() }));
jest.mock('../../shared/components/reviewers/email-template-store', () => {
  const actual = jest.requireActual('../../shared/components/reviewers/email-template-store');
  return {
    ...actual,
    loadEmailTemplates: jest.fn(async () => actual.EMPTY_TEMPLATES),
    saveEmailTemplates: jest.fn(async () => true),
  };
});

if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = NodeTextDecoder;
}

jest.mock('../../shared/components/reviewers/ReviewerFindPanel', () => function FindPanelStub(props) {
  return <div data-testid="find-panel" data-saved-pool={JSON.stringify(props.savedPool || [])} />;
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
let mockSub = 'candidates';
jest.mock('next/router', () => ({
  useRouter: () => ({ query: { sub: mockSub }, pathname: '/workbench/[requestId]', push: mockPush }),
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
  mockSub = 'candidates';
  jest.clearAllMocks();
});

const STALE_ROWS = [
  { suggestionId: 's-1', name: 'Just Invited', invited: false, emailSentAt: null },
  { suggestionId: 's-2', name: 'Still Invitable', invited: false, emailSentAt: null },
];

test('Find receives active candidates plus declined removed rows, but not staff-removed rows', async () => {
  mockSub = 'find';
  const active = { suggestionId: 's-active', name: 'Active Candidate' };
  const declined = { suggestionId: 's-declined', name: 'Declined Candidate', declined: true };
  const responseDeclined = { suggestionId: 's-response-declined', name: 'Response Declined', responseType: 'declined' };
  const staffRemoved = { suggestionId: 's-removed', name: 'Staff Removed', declined: false, responseType: null };
  mockFetchWithCandidates(() => Promise.resolve({
    ok: true,
    json: async () => ({
      proposals: [{
        proposalId: REQ,
        candidates: [active],
        removedCandidates: [declined, responseDeclined, staffRemoved],
      }],
    }),
  }));

  render(<ReviewersTab requestId={REQ} />);

  await waitFor(() => {
    const pool = JSON.parse(screen.getByTestId('find-panel').getAttribute('data-saved-pool'));
    expect(pool).toEqual([active, declined, responseDeclined]);
  });
});

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

test('a delayed overlay response paints before its reconcile window starts', async () => {
  jest.useFakeTimers();
  const overlayResponse = deferred();
  let call = 0;
  mockFetchWithCandidates(() => {
    call += 1;
    if (call === 2) return overlayResponse.promise;
    return Promise.resolve({ ok: true, json: async () => candidatesPayload(STALE_ROWS) });
  });

  render(<ReviewersTab requestId={REQ} />);
  await waitFor(() => expect(candidatesOf()).toHaveLength(2));

  fireEvent.click(screen.getByRole('button', { name: 'refresh-confirmed' }));

  // The overlay request remains in flight beyond the full reconcile interval.
  // Its own timer must not start until the guarded response actually paints.
  await act(async () => {
    jest.advanceTimersByTime(4100);
  });

  await act(async () => {
    overlayResponse.resolve({ ok: true, json: async () => candidatesPayload(STALE_ROWS) });
  });
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

// ── Stage 6B3d: a transient refetch error after a confirmed send must not
// blank the panel or invalidate the open materials-modal session ──────────

describe('a confirmed materials send followed by a failing reviewers refetch', () => {
  const PROPOSAL_TRACK = {
    proposalId: REQ,
    proposalTitle: 'Proposal Under Review',
    reviewDeadline: '2026-07-22',
    proposalAbstract: 'Original abstract text.',
    proposalAuthors: 'Dr. Original PI',
    proposalInstitution: 'Original University',
  };
  const REVIEWER_A = {
    suggestionId: 'aaaaaaaa-0000-0000-0000-000000000001',
    name: 'Accepted A',
    email: 'a@example.org',
    reviewStatus: 'accepted',
  };

  function mockJson(data, ok = true, status = ok ? 200 : 500) {
    return { ok, status, json: async () => data };
  }

  // Chunk-controlled SSE reader, copied (not imported) from
  // reviewer-materials-modal-lifetimes.test.js's controlledSse/sseChunk.
  function controlledSse() {
    const queued = [];
    let waiting = null;
    let ended = false;
    const cancel = jest.fn(() => Promise.resolve());
    return {
      response: {
        ok: true,
        body: {
          getReader: () => ({
            read: () => new Promise((resolve) => {
              if (queued.length > 0) {
                resolve({ value: Buffer.from(queued.shift()), done: false });
              } else if (ended) {
                resolve({ done: true, value: undefined });
              } else {
                waiting = resolve;
              }
            }),
            cancel,
          }),
        },
      },
      push(chunk) {
        if (waiting) {
          const r = waiting;
          waiting = null;
          r({ value: Buffer.from(chunk), done: false });
        } else {
          queued.push(chunk);
        }
      },
      finish() {
        ended = true;
        if (waiting) {
          const r = waiting;
          waiting = null;
          r({ done: true, value: undefined });
        }
      },
    };
  }

  function sseChunk(event, data) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockSub = 'track';
    jest.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    window.confirm.mockRestore();
  });

  test('keeps the sent summary visible and shows the load error', async () => {
    const sse = controlledSse();
    let reviewersCall = 0;
    global.fetch = jest.fn((url, init) => {
      const u = String(url);
      if (u.includes('/api/review-manager/reviewers')) {
        reviewersCall += 1;
        if (reviewersCall === 1) {
          return Promise.resolve(mockJson({
            success: true,
            proposals: [{ ...PROPOSAL_TRACK, reviewers: [REVIEWER_A] }],
          }));
        }
        return Promise.resolve(mockJson({ success: false, error: 'boom' }, false, 500));
      }
      if (u.includes('/api/reviewer-finder/my-candidates')) {
        return Promise.resolve(mockJson({ proposals: [] }));
      }
      if (u.includes('/api/workbench/decline-referrals')) {
        return Promise.resolve(mockJson({ referrals: [] }));
      }
      if (u === '/api/review-manager/release-settings') {
        return Promise.resolve(mockJson({ attachProposalEmail: false }));
      }
      if (u.startsWith('/api/review-manager/materials-preflight')) {
        return Promise.resolve(mockJson({ ok: true, fileCount: 3 }));
      }
      if (u === '/api/review-manager/render-emails') {
        return Promise.resolve(mockJson({
          drafts: [{
            suggestionId: REVIEWER_A.suggestionId,
            candidateName: REVIEWER_A.name,
            candidateEmail: REVIEWER_A.email,
            subject: 'S',
            body: 'B',
          }],
        }));
      }
      if (u === '/api/review-manager/send-emails') {
        return Promise.resolve(sse.response);
      }
      throw new Error(`unexpected fetch ${u} ${init ? JSON.stringify(init) : ''}`);
    });

    render(<ReviewersTab requestId={REQ} />);

    const releaseBtn = await screen.findByRole('button', { name: /release proposal to reviewers \(1\)/i });
    fireEvent.click(releaseBtn);
    fireEvent.click(await screen.findByRole('button', { name: /preview 1 email/i }));
    fireEvent.click(await screen.findByRole('button', { name: /send 1 email/i }));
    await waitFor(() => expect(
      global.fetch.mock.calls.filter(([u]) => String(u) === '/api/review-manager/send-emails').length,
    ).toBe(1));

    sse.push(sseChunk('result', {
      sent: [{ suggestionId: REVIEWER_A.suggestionId, candidateName: REVIEWER_A.name, candidateEmail: REVIEWER_A.email }],
      failed: [],
      skipped: [],
    }));
    sse.push(sseChunk('complete', { message: 'done' }));
    sse.finish();

    // The completion handshake calls onRefresh, which re-triggers the reviewers
    // refetch — that refetch is the SECOND call, and fails. Wait for the error
    // banner (it lands after the completion handshake settles) before asserting
    // the sent summary is still intact.
    await waitFor(() => expect(screen.getByText(/Couldn.t load reviewers: boom/)).toBeInTheDocument());

    expect(screen.getByText('1 sent')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /preview 0 email/i })).toBeNull();
  });
});
