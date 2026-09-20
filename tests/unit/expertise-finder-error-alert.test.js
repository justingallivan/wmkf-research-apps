/**
 * @jest-environment jsdom
 *
 * D9 fix (docs/plans/CLIENT_REQUEST_LAYER_D1_UNGUARDED_RESPONSES_2026-09-20.md
 * §8): pages/expertise-finder.js rendered `<ErrorAlert message={error} .../>`
 * at three sites (:250 MatchTab, :388 RosterTab, :851 BatchTab), but
 * ErrorAlert destructures `error`, not `message`
 * (shared/components/ErrorAlert.js:45) — so with the prop mismatch, `error`
 * is undefined, `classifyError(undefined)` returns null, and ErrorAlert
 * renders nothing at all. This is a render-level regression test per site,
 * using the REAL (un-mocked) ErrorAlert component — unlike
 * tests/unit/expertise-finder-batch-cycle.test.js, which mocks ErrorAlert
 * around this exact gap to assert page-computed error text independent of
 * it (see that file's T2 comment). The error string here deliberately
 * matches ErrorAlert's "Network Error" category (shared/components/
 * ErrorAlert.js:15) so the assertion is the category's fixed message, not
 * classifyError's raw-text fallback (only shown behind "Show details").
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  PageHeader: ({ title }) => <h1>{title}</h1>,
  Card: ({ children, className }) => <section className={className}>{children}</section>,
  Button: ({ children, loading: _loading, ...props }) => <button {...props}>{children}</button>,
}));

jest.mock('../../shared/components/RequireAppAccess', () => ({
  __esModule: true,
  default: ({ children }) => children,
}));

jest.mock('../../shared/components/FileUploaderSimple', () => ({
  __esModule: true,
  default: ({ onFilesUploaded }) => (
    <button type="button" onClick={() => onFilesUploaded([{ url: 'https://x/test.pdf', filename: 'test.pdf' }])}>
      fake-upload
    </button>
  ),
}));

import ExpertiseFinderGuard from '../../pages/expertise-finder';

const NETWORK_ERROR_TEXT = 'Network connection issue. Check your internet connection and try again.';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('expertise-finder.js — D9 ErrorAlert prop fix (error= not message=)', () => {
  test('(:250 MatchTab) a failed match request renders visibly via the real ErrorAlert', async () => {
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    render(<ExpertiseFinderGuard />);
    fireEvent.click(await screen.findByText('fake-upload'));
    fireEvent.click(screen.getByRole('button', { name: 'Find Matches' }));
    expect(await screen.findByText(NETWORK_ERROR_TEXT)).toBeInTheDocument();
  });

  test('(:388 RosterTab) a failed roster load renders visibly via the real ErrorAlert', async () => {
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    render(<ExpertiseFinderGuard />);
    fireEvent.click(await screen.findByText('Roster'));
    expect(await screen.findByText(NETWORK_ERROR_TEXT)).toBeInTheDocument();
  });

  test('(:851 BatchTab) a failed proposals load renders visibly via the real ErrorAlert', async () => {
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    render(<ExpertiseFinderGuard />);
    fireEvent.click(await screen.findByText('Batch'));
    fireEvent.click(await screen.findByRole('button', { name: 'Load Proposals' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(await screen.findByText(NETWORK_ERROR_TEXT)).toBeInTheDocument();
  });
});
