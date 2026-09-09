/**
 * Expertise Finder Batch tab — the grant-cycle selector opens on the working
 * cycle (the upcoming board meeting) and queries by cycle code, not by the
 * akoya_fiscalyear string (owner decision 2026-09-08; the hard-coded
 * 'December 2025' default is gone).
 *
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ExpertiseFinderPage from '../../pages/expertise-finder';
import { conventionalCycles, resolveWorkingCycle } from '../../lib/utils/cycle-code.js';

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
jest.mock('../../shared/components/FileUploaderSimple', () => ({
  __esModule: true,
  default: () => null,
}));

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ proposals: [], totalCount: 0 }) }));
});

test('Batch tab opens on the working cycle and loads proposals by cycle code', async () => {
  const expected = resolveWorkingCycle(conventionalCycles());
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('Batch'));

  const select = screen.getByLabelText('Grant Cycle');
  expect(select.value).toBe(expected);
  expect(select.value).not.toBe('December 2025');
  // Every option is a cycle code, labelled with its month and year.
  const options = [...select.options].map((o) => o.value);
  expect(options).toContain(expected);
  expect(options.every((code) => /^[JD]\d{2}$/.test(code))).toBe(true);
  expect(screen.getByRole('option', { name: 'D26 - December 2026' })).toBeInTheDocument();

  fireEvent.click(screen.getByText('Load Proposals'));
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  const url = new URL(global.fetch.mock.calls[0][0], 'http://localhost');
  expect(url.pathname).toBe('/api/expertise-finder/proposals');
  expect(url.searchParams.get('cycleCode')).toBe(expected);
  expect(url.searchParams.has('fiscalYear')).toBe(false);
});
