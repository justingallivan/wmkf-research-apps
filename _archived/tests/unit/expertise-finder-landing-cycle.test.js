/**
 * Expertise Finder Batch tab follows the Grants Manager's landing cycle
 * (docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md): Load waits until the default
 * settles, a listed landing code is preselected, and an explicit choice wins.
 *
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ExpertiseFinderPage from '../../pages/expertise-finder';
import { conventionalCycles, resolveWorkingCycle } from '../../lib/utils/cycle-code.js';

let landingState = { settled: false, code: null };
jest.mock('../../shared/components/landing-cycle/useLandingCycleDefault', () => ({
  useLandingCycleDefault: () => landingState,
}));
jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  PageHeader: ({ title }) => <h1>{title}</h1>,
  Card: ({ children }) => <section>{children}</section>,
  Button: ({ children, loading: _loading, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('../../shared/components/RequireAppAccess', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));
// T2 (client-request-layer Stage 2, plan §5): exposes a button so tests can
// drive MatchTab's handleMatch without a real upload widget.
// T2: the real ErrorAlert reads a prop named `error`, while every call site
// in this page passes `message` — a pre-existing mismatch outside Stage 2's
// scope, which is why the real component never actually surfaces these error
// strings today. Mocked here (as StaffDeliberationsTab.test.js mocks its own
// children) so the T2 matrix can assert the *state the page computed*
// (`error.message`/derived text) is unchanged by the migration, independent
// of that unrelated display bug.
jest.mock('../../shared/components/ErrorAlert', () => ({
  __esModule: true,
  default: ({ message, error }) => ((message || error) ? <p role="alert">{message || error}</p> : null),
}));

jest.mock('../../shared/components/FileUploaderSimple', () => ({
  __esModule: true,
  default: ({ onFilesUploaded }) => (
    <button type="button" onClick={() => onFilesUploaded([{ url: 'https://example.test/file.pdf', filename: 'file.pdf' }])}>
      mock-upload
    </button>
  ),
}));

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ proposals: [], totalCount: 0 }) }));
});

function openBatch() {
  const view = render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('Batch'));
  return view;
}

test('Load is disabled until the landing default settles, then the landing cycle is preselected and queried', async () => {
  landingState = { settled: false, code: null };
  const view = openBatch();
  expect(screen.getByText('Load Proposals')).toBeDisabled();
  expect(screen.getByLabelText('Grant Cycle').value).toBe(resolveWorkingCycle(conventionalCycles()));

  landingState = { settled: true, code: 'J27' };
  view.rerender(<ExpertiseFinderPage />);
  expect(screen.getByLabelText('Grant Cycle').value).toBe('J27');
  fireEvent.click(screen.getByText('Load Proposals'));
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(new URL(global.fetch.mock.calls[0][0], 'http://localhost').searchParams.get('cycleCode')).toBe('J27');
});

test('an explicit choice before the default settles wins and enables Load', () => {
  landingState = { settled: false, code: null };
  const view = openBatch();
  fireEvent.change(screen.getByLabelText('Grant Cycle'), { target: { value: 'D25' } });
  expect(screen.getByText('Load Proposals')).not.toBeDisabled();
  landingState = { settled: true, code: 'J27' };
  view.rerender(<ExpertiseFinderPage />);
  expect(screen.getByLabelText('Grant Cycle').value).toBe('D25');
});

test('a landing code the picker does not offer is ignored', () => {
  landingState = { settled: true, code: 'J40' };
  openBatch();
  expect(screen.getByLabelText('Grant Cycle').value).toBe(resolveWorkingCycle(conventionalCycles()));
});
