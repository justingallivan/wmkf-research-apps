/**
 * @jest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ReviewPanelTab from '../../shared/components/workbench/ReviewPanelTab';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  Button: ({ children, loading, ...props }) => <button {...props}>{loading ? 'Loading…' : children}</button>,
  Card: ({ children }) => <section>{children}</section>,
}));

const REQ = '11111111-1111-4111-8111-111111111111';
function body(extra = {}) {
  return {
    request: { requestId: REQ, requestNumber: '1002852', inRoster: true },
    launchable: { ok: true, reason: null },
    activeRunId: null,
    configuration: { ready: true, mode: 'access', seats: [{ seatKey: 'seat.claude', label: 'Claude seat', provider: 'anthropic', model: 'claude-opus-5' }], chair: { provider: 'anthropic', model: 'claude-opus-5' }, reservationPerEntry: { lowUsd: 0.5, highUsd: 1.5 } },
    control: { stopRequested: false, reason: null },
    runs: [],
    ...extra,
  };
}
function entry(overrides = {}) {
  return { id: 'e1', requestId: REQ, requestNumber: '1002852', status: 'completed', hasReport: true, retryRequested: false, rerender: null, rerenderCount: 0, seats: [], error: null, ...overrides };
}
function run(overrides = {}) {
  return { id: 'r1', status: 'completed', createdAt: '2026-09-13T10:00:00Z', timeline: [], entries: [entry()], failures: [], pending: false, owner: { profileId: 7, name: 'Pat', isMine: false }, ...overrides };
}
const ok = (json) => ({ ok: true, status: 200, json: async () => json });

beforeEach(() => { global.fetch = jest.fn(); });

test('fetches the per-request read and renders Launch enabled only when the server says launchable', async () => {
  global.fetch.mockResolvedValue(ok(body()));
  render(<ReviewPanelTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Launch panel' })).not.toBeDisabled());
  expect(global.fetch).toHaveBeenCalledWith(`/api/review-panel?requestId=${REQ}`);
  expect(screen.getByTestId('review-panel-state-sentence')).toHaveTextContent('No panel has been run for this request yet.');
  expect(screen.getByText('Nothing here yet. Launch a panel to review this proposal narrative.')).toBeInTheDocument();
  expect(screen.getByText('up to $1.50 (reservation bound)')).toBeInTheDocument(); // D6 bound, never a typical cost
});

test('Launch is disabled with the server reason verbatim — the tab never re-derives preconditions', async () => {
  global.fetch.mockResolvedValue(ok(body({ launchable: { ok: false, reason: 'This request is outside the review panel roster.' } })));
  render(<ReviewPanelTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This request is outside the review panel roster.'));
  expect(screen.getByRole('button', { name: 'Launch panel' })).toBeDisabled();
});

test("another launcher's completed run is visible with its editions (T3), but Stop/Retry/Re-render never render for it", async () => {
  global.fetch.mockResolvedValue(ok(body({ runs: [run({ status: 'failed', entries: [entry({ status: 'failed', hasReport: false, error: 'boom' })] })] })));
  render(<ReviewPanelTab requestId={REQ} />);
  const card = await screen.findByTestId('review-panel-run');
  expect(within(card).getByText(/by Pat/)).toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: 'Retry failed' })).toBeNull();
  expect(within(card).queryByRole('button', { name: 'Stop' })).toBeNull();
  expect(within(card).getByText('boom')).toBeInTheDocument();
});

test("the viewer's own settled failed run offers Retry; a completed one offers Re-render; a running one offers Stop", async () => {
  const mine = { profileId: 1, name: 'Me', isMine: true };
  global.fetch.mockResolvedValue(ok(body({
    activeRunId: 'r3',
    runs: [
      run({ id: 'r1', status: 'failed', owner: mine, entries: [entry({ id: 'e1', status: 'failed', hasReport: false })] }),
      run({ id: 'r2', status: 'completed', owner: mine, entries: [entry({ id: 'e2' })] }),
      run({ id: 'r3', status: 'running', owner: mine, entries: [entry({ id: 'e3', status: 'running', hasReport: false })] }),
    ],
    launchable: { ok: false, reason: 'A panel is already running for request #1002852. Wait for it to settle before launching another.' },
  })));
  render(<ReviewPanelTab requestId={REQ} />);
  const cards = await screen.findAllByTestId('review-panel-run');
  expect(within(cards[0]).getByRole('button', { name: 'Retry failed' })).toBeInTheDocument();
  expect(within(cards[1]).getByRole('button', { name: 'Re-render report' })).toBeInTheDocument();
  expect(within(cards[2]).getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  expect(within(cards[2]).queryByRole('button', { name: 'Retry failed' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Launch new panel' })).toBeDisabled();
});

test('Launch posts exactly this request with an idempotency key, then reloads; a rejection surfaces beside the button', async () => {
  global.fetch
    .mockResolvedValueOnce(ok(body()))
    .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'A panel is already running for request #1002852.' }) })
    .mockResolvedValueOnce(ok(body({ launchable: { ok: false, reason: 'A panel is already running for request #1002852.' } })));
  render(<ReviewPanelTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Launch panel' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Launch panel' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('already running'));
  const [, init] = global.fetch.mock.calls[1];
  const posted = JSON.parse(init.body);
  expect(posted).toMatchObject({ action: 'launch', selectedRequestIds: [REQ] });
  expect(typeof posted.idempotencyKey).toBe('string');
  expect(global.fetch).toHaveBeenCalledTimes(3); // load, POST, reload
});
