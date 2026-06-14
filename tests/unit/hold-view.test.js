/**
 * @jest-environment jsdom
 *
 * Component tests for HoldView (reviewer "hold step" chunk 4). Covers the two
 * sub-states (ask / confirmed), the hold POST (action + If-Match round-trip +
 * onHeld callback), and the decline hand-off.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HoldView from '../../shared/components/external/HoldView';

function makeData(overrides = {}) {
  return {
    etag: 'W/"1"',
    proposal: { title: 'A Proposal', requestNumber: 'R-123', meetingDate: '2026-07-01' },
    engagementState: { view: 'hold-invite', canFlipState: true, held: false, heldAt: null, ...(overrides.engagementState || {}) },
    ...overrides,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('HoldView — ask sub-state', () => {
  it('renders the lightweight ask with Hold + decline affordances and the panel window', () => {
    render(<HoldView data={makeData()} token="tok" confirmed={false} onRequestDecline={() => {}} onHeld={() => {}} />);
    expect(screen.getByRole('button', { name: 'Hold my spot' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "I can't this time" })).toBeInTheDocument();
    // No proposal materials / acks shown pre-hold.
    expect(screen.queryByText(/Honorarium payment address/i)).not.toBeInTheDocument();
    expect(screen.getByText(/July 2026/)).toBeInTheDocument();
  });

  it('decline affordance calls onRequestDecline (routes to the shared decline form)', () => {
    const onRequestDecline = jest.fn();
    render(<HoldView data={makeData()} token="tok" confirmed={false} onRequestDecline={onRequestDecline} onHeld={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: "I can't this time" }));
    expect(onRequestDecline).toHaveBeenCalled();
  });

  it('Hold my spot POSTs action:hold with the If-Match etag, then calls onHeld', async () => {
    const onHeld = jest.fn().mockResolvedValue(undefined);
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, idempotent: false, engagementState: { view: 'held' } }),
    });
    render(<HoldView data={makeData()} token="tok" confirmed={false} onRequestDecline={() => {}} onHeld={onHeld} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hold my spot' }));

    await waitFor(() => expect(onHeld).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/external/review/tok/respond');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ action: 'hold' });
    expect(opts.headers['If-Match']).toBe('W/"1"');
  });

  it('surfaces already_released (409) as a refresh prompt and does NOT call onHeld', async () => {
    const onHeld = jest.fn();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ ok: false, reason: 'already_released' }),
    });
    render(<HoldView data={makeData()} token="tok" confirmed={false} onRequestDecline={() => {}} onHeld={onHeld} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hold my spot' }));

    await waitFor(() => expect(screen.getByText(/now ready for review/i)).toBeInTheDocument());
    expect(onHeld).not.toHaveBeenCalled();
  });
});

describe('HoldView — confirmed sub-state', () => {
  it('renders the on-the-slate confirmation with a flip-to-decline when still flippable', () => {
    const onRequestDecline = jest.fn();
    const data = makeData({ engagementState: { view: 'held', held: true, canFlipState: true, heldAt: '2026-06-14T00:00:00Z' } });
    render(<HoldView data={data} token="tok" confirmed onRequestDecline={onRequestDecline} onHeld={() => {}} />);

    expect(screen.getByText(/your spot is held/i)).toBeInTheDocument();
    expect(screen.getByText(/held on June 14, 2026/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hold my spot' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Switch to declining/i }));
    expect(onRequestDecline).toHaveBeenCalled();
  });

  it('hides the flip-to-decline once the engagement is locked (canFlipState=false)', () => {
    const data = makeData({ engagementState: { view: 'held', held: true, canFlipState: false } });
    render(<HoldView data={data} token="tok" confirmed onRequestDecline={() => {}} onHeld={() => {}} />);
    expect(screen.queryByRole('button', { name: /Switch to declining/i })).not.toBeInTheDocument();
  });
});
