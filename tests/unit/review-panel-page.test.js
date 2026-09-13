/**
 * @jest-environment jsdom
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  deriveLaunchState,
  formatReservationBound,
  isRunUnsettled,
  launchSelectionSignature,
  default as ReviewPanelPage,
  ReviewPanelWorkspace,
} from '../../pages/review-panel';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <main>{children}</main>,
  Button: ({ children, loading, ...props }) => <button {...props}>{loading ? 'Loading…' : children}</button>,
  Card: ({ children }) => <section>{children}</section>,
  PageHeader: ({ title, subtitle }) => <header><h1>{title}</h1><p>{subtitle}</p></header>,
}));
jest.mock('../../shared/components/RequireAuth', () => ({ __esModule: true, default: ({ children }) => children }));

const candidates = [
  { requestId: 'a', requestNumber: '101', title: 'Alpha' },
  { requestId: 'b', requestNumber: '102', title: 'Beta' },
];

function pageResponse(extra = {}) {
  return {
    panel: { id: 'p1', selection: null },
    candidates,
    runs: [],
    configuration: { ready: true, seats: [{ seatKey: 'seat.claude', provider: 'anthropic', model: 'claude-fable-5-1' }], chair: { provider: 'anthropic', model: 'claude-opus-5' }, reservationPerEntry: { lowUsd: 0.5, highUsd: 1.5 } },
    control: { stopRequested: false, reason: null },
    ...extra,
  };
}

function response(body) { return { ok: true, status: 200, json: async () => body }; }

describe('deriveLaunchState — mirrors the server own launch preconditions', () => {
  test('disabled while configuration is loading', () => {
    expect(deriveLaunchState({ configuration: null, selectedCount: 1, launching: false })).toMatchObject({ disabled: true });
  });
  test('disabled with the server error when configuration is not ready — Launch must never render enabled here', () => {
    const state = deriveLaunchState({ configuration: { ready: false, error: 'Published review panel prompts are not ready.' }, selectedCount: 2, launching: false });
    expect(state).toEqual({ disabled: true, reason: 'Published review panel prompts are not ready.' });
  });
  test('disabled when nothing is selected, even with ready configuration', () => {
    expect(deriveLaunchState({ configuration: { ready: true }, selectedCount: 0, launching: false })).toMatchObject({ disabled: true });
  });
  test('enabled once ready and at least one request is selected', () => {
    expect(deriveLaunchState({ configuration: { ready: true }, selectedCount: 1, launching: false })).toEqual({ disabled: false, reason: null });
  });
  test('disabled (no reason) while a launch is already in flight', () => {
    expect(deriveLaunchState({ configuration: { ready: true }, selectedCount: 1, launching: true })).toEqual({ disabled: true, reason: null });
  });
  test('smoke mode with more than one selection is disabled with inline copy, mirroring the server\'s own rejection', () => {
    const state = deriveLaunchState({ configuration: { ready: true, mode: 'smoke' }, selectedCount: 2, launching: false });
    expect(state).toEqual({ disabled: true, reason: 'Smoke mode requires exactly one selected request.' });
  });
  test('smoke mode with exactly one selection is enabled', () => {
    expect(deriveLaunchState({ configuration: { ready: true, mode: 'smoke' }, selectedCount: 1, launching: false })).toEqual({ disabled: false, reason: null });
  });
  test('pilot mode (or mode absent) never applies the one-selection rule', () => {
    expect(deriveLaunchState({ configuration: { ready: true, mode: 'pilot' }, selectedCount: 3, launching: false })).toEqual({ disabled: false, reason: null });
  });
});

describe('formatReservationBound — D6: a bound only, never a "typical cost" figure', () => {
  test('renders the bound label', () => {
    expect(formatReservationBound({ highUsd: 12.5 })).toBe('up to $12.50 (reservation bound)');
  });
  test('never fabricates a figure when pricing is unavailable', () => {
    expect(formatReservationBound({ highUsd: null })).toBe('Unavailable');
    expect(formatReservationBound(null)).toBe('Unavailable');
  });
});

describe('isRunUnsettled', () => {
  test('queued and running are unsettled; everything else is not', () => {
    expect(isRunUnsettled('queued')).toBe(true);
    expect(isRunUnsettled('running')).toBe(true);
    expect(isRunUnsettled('completed')).toBe(false);
    expect(isRunUnsettled('failed')).toBe(false);
    expect(isRunUnsettled(undefined)).toBe(false);
  });
});

describe('ReviewPanelWorkspace', () => {
  afterEach(() => jest.restoreAllMocks());

  test('Launch is disabled with the server error surfaced beside it when the rollout configuration is not ready', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(pageResponse({ configuration: { ready: false, error: 'The review panel is awaiting activation.' } })));
    render(<ReviewPanelWorkspace />);
    await waitFor(() => expect(screen.getByText(/The review panel is awaiting activation\./)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Launch/i })).toBeDisabled();
  });

  test('Launch is enabled once the roster loads with ready configuration and a default selection', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(pageResponse()));
    render(<ReviewPanelWorkspace />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Launch/i })).not.toBeDisabled());
  });

  test('the Progress tab is shown by default when the latest run is unsettled', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(pageResponse({ runs: [{ id: 'run-1', status: 'running', entries: [] }] })));
    render(<ReviewPanelWorkspace />);
    await waitFor(() => expect(screen.getByText(/running/i)).toBeInTheDocument());
  });

  test('Include all / Exclude all toggle every candidate checkbox', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(pageResponse()));
    render(<ReviewPanelWorkspace />);
    await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBe(2));
    fireEvent.click(screen.getByText('Exclude all'));
    screen.getAllByRole('checkbox').forEach((box) => expect(box).not.toBeChecked());
    fireEvent.click(screen.getByText('Include all'));
    screen.getAllByRole('checkbox').forEach((box) => expect(box).toBeChecked());
  });

  test('per-row Word/PDF links only appear for an entry with a saved report', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(pageResponse({
      runs: [{ id: 'run-1', status: 'completed', entries: [
        { id: 'entry-1', requestNumber: '101', status: 'completed', hasReport: true },
        { id: 'entry-2', requestNumber: '102', status: 'failed', hasReport: false, error: 'boom' },
      ] }],
    })));
    render(<ReviewPanelWorkspace />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Progress' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Progress' }));
    await waitFor(() => expect(screen.getByText(/#101/)).toBeInTheDocument());
    expect(screen.getAllByTestId('review-panel-entry-links')).toHaveLength(1);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  test('a second click with an IDENTICAL selection after a failed first response sends the SAME idempotencyKey (mirrors cycle-dossier.js launchKeyRef) — a changed selection then sends a new one', async () => {
    const postBodies = [];
    global.fetch = jest.fn((url, options) => {
      if (options?.method === 'POST') {
        postBodies.push(JSON.parse(options.body));
        if (postBodies.length === 1) return Promise.reject(new Error('network error'));
        return Promise.resolve(response({ run: { id: 'run-1', status: 'queued' } }));
      }
      return Promise.resolve(response(pageResponse()));
    });
    render(<ReviewPanelWorkspace />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Launch/i })).not.toBeDisabled());

    // First click: the POST rejects (lost response / network error).
    fireEvent.click(screen.getByRole('button', { name: /Launch/i }));
    await waitFor(() => expect(postBodies.length).toBe(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /Launch/i })).not.toBeDisabled());

    // Second click, SAME selection: must reuse the same idempotencyKey.
    fireEvent.click(screen.getByRole('button', { name: /Launch/i }));
    await waitFor(() => expect(postBodies.length).toBe(2));
    expect(postBodies[1].idempotencyKey).toBe(postBodies[0].idempotencyKey);

    // The confirmed success switched to the Progress tab; go back to Requests
    // to change the selection and launch again.
    fireEvent.click(screen.getByRole('button', { name: 'Requests' }));
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Launch/i }));
    await waitFor(() => expect(postBodies.length).toBe(3));
    expect(postBodies[2].idempotencyKey).not.toBe(postBodies[1].idempotencyKey);
  });

  test('launch fails on selection S1; changing to S2 with NO intervening success still mints a new idempotencyKey (retrying S1 unchanged still reuses it)', async () => {
    const postBodies = [];
    global.fetch = jest.fn((url, options) => {
      if (options?.method === 'POST') {
        postBodies.push(JSON.parse(options.body));
        return Promise.reject(new Error('network error')); // every launch in this test fails — no success ever occurs
      }
      return Promise.resolve(response(pageResponse()));
    });
    render(<ReviewPanelWorkspace />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Launch/i })).not.toBeDisabled());

    // First click on selection S1 (the default: both candidates included) — fails.
    fireEvent.click(screen.getByRole('button', { name: /Launch/i }));
    await waitFor(() => expect(postBodies.length).toBe(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /Launch/i })).not.toBeDisabled());

    // Retry with the SAME selection S1 (no intervening success) — must reuse the same key.
    fireEvent.click(screen.getByRole('button', { name: /Launch/i }));
    await waitFor(() => expect(postBodies.length).toBe(2));
    expect(postBodies[1].idempotencyKey).toBe(postBodies[0].idempotencyKey);

    // Change the selection to S2 — still no launch has ever succeeded. A
    // failed launch must not pin the idempotency key to the old selection
    // forever: the changed selection must mint a NEW key.
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Launch/i }));
    await waitFor(() => expect(postBodies.length).toBe(3));
    expect(postBodies[2].idempotencyKey).not.toBe(postBodies[1].idempotencyKey);
  });
});

describe('Progress tab polling — mirrors pages/cycle-dossier.js\'s runActive effect', () => {
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  test('polls every 4s while the latest run is unsettled, and stops once it settles', async () => {
    jest.useFakeTimers();
    let call = 0;
    global.fetch = jest.fn(() => {
      call += 1;
      // First load, then two polls while queued, then the run settles.
      const status = call <= 3 ? 'queued' : 'completed';
      return Promise.resolve(response(pageResponse({ runs: [{ id: 'run-1', status, entries: [] }] })));
    });
    render(<ReviewPanelWorkspace />);
    await act(async () => { await Promise.resolve(); }); // flush the initial load()
    expect(call).toBe(1);

    await act(async () => { await jest.advanceTimersByTimeAsync(4000); });
    expect(call).toBe(2); // first poll while queued

    await act(async () => { await jest.advanceTimersByTimeAsync(4000); });
    expect(call).toBe(3); // second poll — still queued

    await act(async () => { await jest.advanceTimersByTimeAsync(4000); });
    expect(call).toBe(4); // poll observes the run settled to completed

    const callsAtSettle = call;
    await act(async () => { await jest.advanceTimersByTimeAsync(8000); });
    expect(call).toBe(callsAtSettle); // no further polling once settled
  });

  test('a poll response cannot clobber state after a user action (stale-generation guard)', async () => {
    jest.useFakeTimers();
    let getCall = 0;
    let resolveStalePoll;
    const stalePollPromise = new Promise((resolve) => { resolveStalePoll = resolve; });
    global.fetch = jest.fn((url, options) => {
      if (options?.method === 'POST') return Promise.resolve(response({ control: { stopRequested: true, reason: null } }));
      getCall += 1;
      if (getCall === 1) return Promise.resolve(response(pageResponse({ runs: [{ id: 'run-1', status: 'running', entries: [] }] })));
      if (getCall === 2) return stalePollPromise; // the poll fired by the interval — held pending until resolved below, AFTER the action's own load() below
      // load() triggered by the user's operator-stop action: arrives after the poll started, but resolves first.
      return Promise.resolve(response(pageResponse({
        runs: [{ id: 'run-1', status: 'completed', entries: [{ id: 'entry-done', requestNumber: '999', status: 'completed', seats: [] }] }],
        control: { stopRequested: true, reason: null },
      })));
    });
    render(<ReviewPanelWorkspace />);
    await act(async () => { await Promise.resolve(); }); // flush the initial load (getCall === 1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Progress' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Progress' }));

    // Advance to fire the poll — it's held pending by stalePollPromise (getCall === 2).
    await act(async () => { await jest.advanceTimersByTimeAsync(4000); });

    // While that poll is still in flight, the user takes an action: operator-stop
    // POSTs, then calls load() — which bumps requestSeq and resolves (getCall === 3)
    // BEFORE the stale poll below is ever resolved.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Operator stop|Resume/i }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText(/#999/)).toBeInTheDocument());

    // NOW resolve the stale poll with OLDER data — it must be dropped, not applied on top.
    await act(async () => {
      resolveStalePoll(response(pageResponse({ runs: [{ id: 'run-1', status: 'running', entries: [{ id: 'stale-entry', requestNumber: '111', status: 'running', seats: [] }] }] })));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(screen.getByText(/#999/)).toBeInTheDocument();
    expect(screen.queryByText(/#111/)).not.toBeInTheDocument();
  });
});

describe('Progress tab waiting copy — the worker materializes entries on claim, so a fresh run has none yet', () => {
  test('queued with no entries: waiting-for-worker copy', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(pageResponse({ runs: [{ id: 'run-1', status: 'queued', entries: [] }] })));
    render(<ReviewPanelWorkspace />);
    await waitFor(() => expect(screen.getByText(/Waiting for the worker to pick up the run \(runs every minute\)\./)).toBeInTheDocument());
  });

  test('running with no entries yet: preparing-requests copy', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(pageResponse({ runs: [{ id: 'run-1', status: 'running', entries: [] }] })));
    render(<ReviewPanelWorkspace />);
    await waitFor(() => expect(screen.getByText('Preparing requests…')).toBeInTheDocument());
  });

  test('once entries exist, the waiting copy is gone', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(pageResponse({
      runs: [{ id: 'run-1', status: 'running', entries: [{ id: 'entry-1', requestNumber: '101', status: 'running', seats: [] }] }],
    })));
    render(<ReviewPanelWorkspace />);
    await waitFor(() => expect(screen.getByText(/#101/)).toBeInTheDocument());
    expect(screen.queryByText(/Preparing requests/)).not.toBeInTheDocument();
  });
});

describe('per-seat pills in the Progress tab', () => {
  test('renders label · model · state, cost as $0.16 when known, "cost unknown" when unknown, "pending" for a seat with no attempt, and the failed seat\'s error text', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(pageResponse({
      runs: [{
        id: 'run-1',
        status: 'failed',
        entries: [{
          id: 'entry-1',
          requestNumber: '101',
          status: 'failed',
          seats: [
            { seatKey: 'seat.claude', label: 'Claude reviewer', provider: 'anthropic', model: 'claude-fable-5-1', state: 'completed', costCents: 16, costState: 'known', error: null },
            { seatKey: 'seat.openai', label: 'OpenAI reviewer', provider: 'openai', model: 'gpt-5.6-sol', state: 'failed', costCents: null, costState: 'unknown', error: 'The OpenAI reviewer declined to review this proposal (the model returned a refusal); no review was produced.' },
            { seatKey: 'chair', label: 'Chair', provider: null, model: null, state: 'pending', costCents: null, costState: null, error: null },
          ],
        }],
      }],
    })));
    render(<ReviewPanelWorkspace />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Progress' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Progress' }));
    await waitFor(() => expect(screen.getByText(/#101/)).toBeInTheDocument());

    expect(screen.getByText('Claude reviewer · claude-fable-5-1 · completed · $0.16')).toBeInTheDocument();
    expect(screen.getByText('OpenAI reviewer · gpt-5.6-sol · failed · cost unknown')).toBeInTheDocument();
    expect(screen.getByText('Chair · pending')).toBeInTheDocument();
    expect(screen.getByText(/declined to review this proposal/)).toBeInTheDocument();
  });
});

test('the default export wraps the workspace in RequireAuth without crashing', async () => {
  global.fetch = jest.fn().mockResolvedValue(response(pageResponse()));
  render(<ReviewPanelPage />);
  await waitFor(() => expect(screen.getByText('Review Panel')).toBeInTheDocument());
});
