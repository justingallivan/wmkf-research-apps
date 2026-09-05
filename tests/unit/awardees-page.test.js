/**
 * @jest-environment jsdom
 *
 * Workbench Awardees list page — loads the cycle's awardees and links each to
 * its Awardee tab. (RequireAppAccess guard is exercised elsewhere; this renders
 * the inner list against a mocked fetch.)
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  Card: ({ children }) => <div>{children}</div>,
  PageHeader: ({ title, subtitle, icon, children }) => (
    <div>
      {icon && <span>{icon}</span>}
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
      {children}
    </div>
  ),
}));
jest.mock('../../shared/components/RequireAppAccess', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children }) => <a href={href}>{children}</a> }));

let mockRouter = { isReady: true, query: {} };
jest.mock('next/router', () => ({ useRouter: () => mockRouter }));

import AwardeesPage from '../../pages/workbench/awardees';

beforeEach(() => { mockRouter = { isReady: true, query: {} }; });
afterEach(() => { if (global.fetch?.mockRestore) global.fetch.mockRestore(); });

test('renders the awardee rows with PI/liaison and an Open link to each Awardee tab', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      cycleCode: 'J26', cycleLabel: 'June 2026', count: 2,
      awardees: [
        { requestId: 'r1', requestNumber: '1002238', title: 'Fungal Networks', pi: { name: 'Erika Espinosa-Ortiz' }, liaison: { name: 'Dawnie Elzinga' }, statusLabel: 'Drafted', abstractReady: true },
        { requestId: 'r2', requestNumber: '1002324', title: 'Circadian clock', pi: { name: 'Margaret Stratton' }, liaison: { name: 'Marco Monoc' }, statusLabel: null, abstractReady: false },
      ],
    }),
  }));

  render(<AwardeesPage />);

  await waitFor(() => expect(screen.getByText('Fungal Networks')).toBeInTheDocument());
  expect(screen.getByText('Erika Espinosa-Ortiz')).toBeInTheDocument();
  expect(screen.getByText('Margaret Stratton')).toBeInTheDocument();
  // each row links to its Awardee tab
  const links = screen.getAllByRole('link', { name: /open/i });
  expect(links.map((l) => l.getAttribute('href'))).toEqual([
    '/workbench/r1?tab=awardee',
    '/workbench/r2?tab=awardee',
  ]);
});

test('empty state (mine scope, default) prompts to show all', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ cycleCode: 'D25', cycleLabel: 'December 2025', count: 0, awardees: [], scope: 'mine', pdResolved: true }) }));
  render(<AwardeesPage />);
  await waitFor(() => expect(screen.getByText(/no awardees assigned to you/i)).toBeInTheDocument());
  // default fetch is mine-scoped (no scope=all param)
  expect(global.fetch.mock.calls.every(([u]) => !String(u).includes('scope=all'))).toBe(true);
});

test('PD-unresolved empty state prompts to show all', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ cycleCode: 'D25', cycleLabel: 'December 2025', count: 0, awardees: [], scope: 'mine', pdResolved: false, programDirector: null }) }));
  render(<AwardeesPage />);
  await waitFor(() => expect(screen.getByText(/could not match your account/i)).toBeInTheDocument());
});

test('toggling "Show all programs" refetches with scope=all', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ cycleCode: 'J26', cycleLabel: 'June 2026', count: 0, awardees: [], scope: 'mine', pdResolved: true }) }));
  render(<AwardeesPage />);
  await waitFor(() => expect(screen.getByText(/show all programs/i)).toBeInTheDocument());
  fireEvent.click(screen.getByLabelText(/show all programs/i));
  await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => String(u).includes('scope=all'))).toBe(true));
});

test('honors a ?cycleCode= deep link (workbench "View awardees" link)', async () => {
  mockRouter = { isReady: true, query: { cycleCode: 'D26' } };
  global.fetch = jest.fn(async () => ({
    ok: true, json: async () => ({ cycleCode: 'D26', cycleLabel: 'December 2026', count: 0, awardees: [] }),
  }));
  render(<AwardeesPage />);
  await waitFor(() => {
    const calls = global.fetch.mock.calls.map(([u]) => String(u));
    expect(calls.some((u) => u.includes('cycleCode=D26'))).toBe(true);
  });
});
