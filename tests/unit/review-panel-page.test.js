/**
 * @jest-environment jsdom
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  deriveLaunchState,
  formatReservationBound,
  isRunUnsettled,
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
});

test('the default export wraps the workspace in RequireAuth without crashing', async () => {
  global.fetch = jest.fn().mockResolvedValue(response(pageResponse()));
  render(<ReviewPanelPage />);
  await waitFor(() => expect(screen.getByText('Review Panel')).toBeInTheDocument());
});
