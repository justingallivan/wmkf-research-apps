/**
 * @jest-environment jsdom
 *
 * Workbench Awardees list page — loads the cycle's awardees and links each to
 * its Awardee tab. (RequireAppAccess guard is exercised elsewhere; this renders
 * the inner list against a mocked fetch.)
 */
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';

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

// Live cycle list the page consults for its default (last decided cycle).
const DASHBOARD = {
  cycles: [{ code: 'D26', meetingDate: '2026-12-11' }, { code: 'J26', meetingDate: '2026-06-04' }],
  defaultCycleCode: 'D26',
  lastDecidedCycleCode: 'J26',
};
const isDashboard = (url) => String(url).startsWith('/api/workbench/dashboard');
// Answers the cycle-list call immediately; every other URL goes to `fn`.
const withDashboard = (fn, dashboard = DASHBOARD) => jest.fn((url, options) => (
  isDashboard(url) ? Promise.resolve(response(dashboard)) : fn(url, options)
));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function response(body, ok = true) {
  return { ok, json: async () => body };
}

function cycleCodeFromUrl(url) {
  return new URL(url, 'http://localhost').searchParams.get('cycleCode');
}

function alternateCycle(code) {
  return `${code[0] === 'J' ? 'D' : 'J'}${code.slice(1)}`;
}

async function settle(deferredValue, value) {
  await act(async () => {
    deferredValue.resolve(value);
    await deferredValue.promise;
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function settleReject(deferredValue, error) {
  await act(async () => {
    deferredValue.reject(error);
    await deferredValue.promise.catch(() => {});
    await Promise.resolve();
    await Promise.resolve();
  });
}

function awardee(title, requestId = title.toLowerCase()) {
  return {
    requestId,
    requestNumber: requestId,
    title,
    pi: { name: `${title} PI` },
    liaison: { name: `${title} Liaison` },
    statusLabel: null,
    abstractReady: false,
  };
}

test('renders the awardee rows with PI/liaison and an Open link to each Awardee tab', async () => {
  global.fetch = withDashboard(async () => ({
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
  global.fetch = withDashboard(async () => ({ ok: true, json: async () => ({ cycleCode: 'D25', cycleLabel: 'December 2025', count: 0, awardees: [], scope: 'mine', pdResolved: true }) }));
  render(<AwardeesPage />);
  await waitFor(() => expect(screen.getByText(/no awardees assigned to you/i)).toBeInTheDocument());
  // default fetch is mine-scoped (no scope=all param)
  expect(global.fetch.mock.calls.every(([u]) => !String(u).includes('scope=all'))).toBe(true);
});

test('PD-unresolved empty state prompts to show all', async () => {
  global.fetch = withDashboard(async () => ({ ok: true, json: async () => ({ cycleCode: 'D25', cycleLabel: 'December 2025', count: 0, awardees: [], scope: 'mine', pdResolved: false, programDirector: null }) }));
  render(<AwardeesPage />);
  await waitFor(() => expect(screen.getByText(/could not match your account/i)).toBeInTheDocument());
});

test('toggling "Show all programs" refetches with scope=all', async () => {
  global.fetch = withDashboard(async () => ({ ok: true, json: async () => ({ cycleCode: 'J26', cycleLabel: 'June 2026', count: 0, awardees: [], scope: 'mine', pdResolved: true }) }));
  render(<AwardeesPage />);
  await waitFor(() => expect(screen.getByText(/show all programs/i)).toBeInTheDocument());
  fireEvent.click(screen.getByLabelText(/show all programs/i));
  await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => String(u).includes('scope=all'))).toBe(true));
});

test('a stale success cannot overwrite a newer cycle and its request is aborted', async () => {
  const pending = [];
  global.fetch = withDashboard((url, options) => {
    const d = deferred();
    pending.push({ url: String(url), options, d });
    return d.promise;
  });

  render(<AwardeesPage />);
  await waitFor(() => expect(pending).toHaveLength(1));
  const initialCycle = cycleCodeFromUrl(pending[0].url);
  const nextCycle = alternateCycle(initialCycle);
  fireEvent.change(screen.getByLabelText('Cycle code'), { target: { value: nextCycle } });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));
  await waitFor(() => expect(pending).toHaveLength(2));

  await settle(pending[1].d, response({ cycleCode: nextCycle, cycleLabel: nextCycle, count: 1, awardees: [awardee(`${nextCycle} current`)] }));
  expect(screen.getByText(`${nextCycle} current`)).toBeInTheDocument();
  await settle(pending[0].d, response({ cycleCode: initialCycle, cycleLabel: initialCycle, count: 1, awardees: [awardee(`${initialCycle} stale`)] }));

  expect(screen.getByText(`${nextCycle} current`)).toBeInTheDocument();
  expect(screen.queryByText(`${initialCycle} stale`)).not.toBeInTheDocument();
  expect(pending[0].options.signal.aborted).toBe(true);
});

test('stale HTTP and JSON failures cannot replace the latest result or loading state', async () => {
  const pending = [];
  const staleJson = deferred();
  global.fetch = withDashboard((url, options) => {
    const d = deferred();
    pending.push({ url: String(url), options, d });
    return d.promise;
  });

  render(<AwardeesPage />);
  await waitFor(() => expect(pending).toHaveLength(1));
  const initialCycle = cycleCodeFromUrl(pending[0].url);
  const nextCycle = alternateCycle(initialCycle);
  fireEvent.change(screen.getByLabelText('Cycle code'), { target: { value: nextCycle } });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));
  await waitFor(() => expect(pending).toHaveLength(2));

  await settle(pending[0].d, { ok: false, json: () => staleJson.promise });
  await settleReject(staleJson, new Error('stale JSON failure'));
  expect(screen.getByText('Loading…')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();

  await settle(pending[1].d, response({ cycleCode: nextCycle, cycleLabel: nextCycle, count: 0, awardees: [] }));
  expect(screen.getByText(/no awardees assigned to you/i)).toBeInTheDocument();
  expect(screen.queryByText('Failed to load awardees.')).not.toBeInTheDocument();
});

test('a stale HTTP error cannot replace a newer loading request', async () => {
  const pending = [];
  global.fetch = withDashboard((url, options) => {
    const d = deferred();
    pending.push({ url: String(url), options, d });
    return d.promise;
  });

  render(<AwardeesPage />);
  await waitFor(() => expect(pending).toHaveLength(1));
  const initialCycle = cycleCodeFromUrl(pending[0].url);
  const nextCycle = alternateCycle(initialCycle);
  fireEvent.change(screen.getByLabelText('Cycle code'), { target: { value: nextCycle } });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));
  await waitFor(() => expect(pending).toHaveLength(2));

  await settle(pending[0].d, response({ error: 'stale HTTP error' }, false));
  expect(screen.getByText('Loading…')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();

  await settle(pending[1].d, response({ cycleCode: nextCycle, cycleLabel: nextCycle, count: 0, awardees: [] }));
  expect(screen.getByText(/no awardees assigned to you/i)).toBeInTheDocument();
});

test('a same-cycle scope change clears mine rows and keeps the all-scope result authoritative', async () => {
  const pending = [];
  global.fetch = withDashboard((url, options) => {
    const d = deferred();
    pending.push({ url: String(url), options, d });
    return d.promise;
  });

  render(<AwardeesPage />);
  await waitFor(() => expect(pending).toHaveLength(1));
  await settle(pending[0].d, response({ cycleCode: cycleCodeFromUrl(pending[0].url), cycleLabel: 'Current cycle', count: 1, scope: 'mine', awardees: [awardee('Mine row')] }));
  expect(screen.getByText('Mine row')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/show all programs/i));
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(screen.queryByText('Mine row')).not.toBeInTheDocument();
  expect(screen.queryByText(/1 awardee\(s\) \(yours\)/i)).not.toBeInTheDocument();

  await settle(pending[1].d, response({ cycleCode: cycleCodeFromUrl(pending[1].url), cycleLabel: 'Current cycle', count: 1, scope: 'all', awardees: [awardee('All row')] }));
  expect(screen.getByText('All row')).toBeInTheDocument();
});

test('returning to a prior cycle cannot revive its old rows while a fresh request is pending', async () => {
  const pending = [];
  global.fetch = withDashboard((url, options) => {
    const d = deferred();
    pending.push({ url: String(url), options, d });
    return d.promise;
  });

  render(<AwardeesPage />);
  await waitFor(() => expect(pending).toHaveLength(1));
  const cycleA = cycleCodeFromUrl(pending[0].url);
  const cycleB = alternateCycle(cycleA);
  await settle(pending[0].d, response({ cycleCode: cycleA, cycleLabel: cycleA, count: 1, awardees: [awardee('A old')] }));
  expect(screen.getByText('A old')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Cycle code'), { target: { value: cycleB } });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(screen.queryByText('A old')).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Cycle code'), { target: { value: cycleA } });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));
  await waitFor(() => expect(pending).toHaveLength(3));
  expect(screen.queryByText('A old')).not.toBeInTheDocument();

  await settle(pending[1].d, response({ cycleCode: cycleB, cycleLabel: cycleB, count: 1, awardees: [awardee('B stale')] }));
  expect(screen.queryByText('B stale')).not.toBeInTheDocument();
  await settle(pending[2].d, response({ cycleCode: cycleA, cycleLabel: cycleA, count: 1, awardees: [awardee('A fresh')] }));
  expect(screen.getByText('A fresh')).toBeInTheDocument();
  expect(screen.queryByText('A old')).not.toBeInTheDocument();
});

test('returning to a prior cycle cannot revive its old error while a fresh request is pending', async () => {
  const pending = [];
  global.fetch = withDashboard((url, options) => {
    const d = deferred();
    pending.push({ url: String(url), options, d });
    return d.promise;
  });

  render(<AwardeesPage />);
  await waitFor(() => expect(pending).toHaveLength(1));
  const cycleA = cycleCodeFromUrl(pending[0].url);
  const cycleB = alternateCycle(cycleA);
  await settle(pending[0].d, response({ error: 'A old error' }, false));
  expect(screen.getByRole('alert')).toHaveTextContent('A old error');

  fireEvent.change(screen.getByLabelText('Cycle code'), { target: { value: cycleB } });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Cycle code'), { target: { value: cycleA } });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));
  await waitFor(() => expect(pending).toHaveLength(3));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();

  await settle(pending[1].d, response({ error: 'B stale error' }, false));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await settle(pending[2].d, response({ cycleCode: cycleA, cycleLabel: cycleA, count: 0, awardees: [] }));
  expect(screen.getByText(/no awardees assigned to you/i)).toBeInTheDocument();
});

test('honors a ?cycleCode= deep link (workbench "View awardees" link)', async () => {
  const defaultCycle = DASHBOARD.lastDecidedCycleCode;
  const deepLinkCycle = alternateCycle(defaultCycle);
  mockRouter = { isReady: true, query: { cycleCode: deepLinkCycle } };
  const pending = [];
  global.fetch = withDashboard((url, options) => {
    const d = deferred();
    pending.push({ url: String(url), options, d });
    return d.promise;
  });
  render(<AwardeesPage />);
  await waitFor(() => expect(pending).toHaveLength(1));
  // The deep link wins outright: no request is ever issued for the default cycle.
  const deepLinkRequest = pending[0];
  expect(cycleCodeFromUrl(deepLinkRequest.url)).toBe(deepLinkCycle);
  expect(pending.some(({ url }) => cycleCodeFromUrl(url) === defaultCycle)).toBe(false);
  await settle(deepLinkRequest.d, response({ cycleCode: deepLinkCycle, cycleLabel: deepLinkCycle, count: 1, awardees: [awardee('Deep link row')] }));
  expect(screen.getByText('Deep link row')).toBeInTheDocument();
  expect(deepLinkRequest.options.signal.aborted).toBe(false);
});

test('unmount aborts the active request and ignores a delayed response', async () => {
  const pending = deferred();
  let options;
  global.fetch = withDashboard((_url, init) => { options = init; return pending.promise; });

  const { unmount } = render(<AwardeesPage />);
  await waitFor(() => expect(options).toBeDefined());
  unmount();
  expect(options.signal.aborted).toBe(true);
  await settle(pending, response({ cycleCode: 'J26', cycleLabel: 'June 2026', count: 1, awardees: [awardee('Unmounted row')] }));
});

test('defaults to the live last decided cycle, not a calendar guess', async () => {
  global.fetch = withDashboard(async () => response({ cycleCode: 'J26', cycleLabel: 'June 2026', count: 0, awardees: [], scope: 'mine', pdResolved: true }));
  render(<AwardeesPage />);
  await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => cycleCodeFromUrl(String(u)) === 'J26')).toBe(true));
  expect(global.fetch.mock.calls[0][0]).toBe('/api/workbench/dashboard');
  expect(screen.getByLabelText('Cycle code')).toHaveValue('J26');
});

test('with no decided cycle in the live list it shows an explicit empty state and requests nothing', async () => {
  global.fetch = withDashboard(async () => { throw new Error('must not fetch awardees'); }, { cycles: [{ code: 'D26' }], defaultCycleCode: 'D26', lastDecidedCycleCode: null });
  render(<AwardeesPage />);
  await waitFor(() => expect(screen.getByText(/no decided cycle has requests yet/i)).toBeInTheDocument());
  expect(global.fetch.mock.calls.every(([u]) => isDashboard(u))).toBe(true);
});

test('a failed cycle-list read shows an error with a retry that resolves the default', async () => {
  let fail = true;
  global.fetch = jest.fn(async (url) => {
    if (isDashboard(url)) {
      if (fail) return response({ error: 'down' }, false);
      return response(DASHBOARD);
    }
    return response({ cycleCode: 'J26', cycleLabel: 'June 2026', count: 0, awardees: [], scope: 'mine', pdResolved: true });
  });
  render(<AwardeesPage />);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not determine the current cycle/i));
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.getByLabelText('Cycle code')).toHaveValue('J26'));
});
