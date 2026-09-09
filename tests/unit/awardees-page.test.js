/**
 * @jest-environment jsdom
 *
 * Workbench Awardees panel — loads the shell's cycle's awardees and links each
 * to its Awardee tab. The panel is driven by the Request Workbench shell
 * through props; the harness below plays the shell (cycle + my/all scope).
 */
import { useState } from 'react';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children }) => <a href={href}>{children}</a> }));

import AwardeesPanel from '../../shared/components/workbench/AwardeesPanel';
import { getServerSideProps as legacyAwardeesRedirect } from '../../pages/workbench/awardees';

afterEach(() => { if (global.fetch?.mockRestore) global.fetch.mockRestore(); });

const harness = { state: null, set: null };
function Harness({ initial }) {
  const [state, setState] = useState(initial);
  harness.state = state;
  harness.set = (patch) => setState((prev) => ({ ...prev, ...patch }));
  return (
    <AwardeesPanel
      cycleCode={state.cycleCode}
      loadingCycles={false}
      scope={state.scope}
      onScopeChange={(scope) => harness.set({ scope })}
      onCycleChange={(cycleCode) => harness.set({ cycleCode })}
    />
  );
}
const DEFAULT_CYCLE = 'J26';
function renderPanel(initial = {}) {
  return render(<Harness initial={{ cycleCode: DEFAULT_CYCLE, scope: 'my', ...initial }} />);
}

// Live cycle list the panel consults only when a cycle turns out empty.
const CYCLE_LIST = {
  cycles: [{ code: 'D26', label: 'December 2026', meetingDate: '2026-12-11', count: 0 }, { code: 'J26', label: 'June 2026', meetingDate: '2026-06-04', count: 14 }],
  defaultCycleCode: 'D26',
  lastDecidedCycleCode: 'J26',
};
const isCycleList = (url) => String(url) === '/api/workbench/grantee-deliverables/awardees';
const withCycleList = (fn, cycleList = CYCLE_LIST) => jest.fn((url, options) => (
  isCycleList(url) ? Promise.resolve(response(cycleList)) : fn(url, options)
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
  global.fetch = withCycleList(async () => ({
    ok: true,
    json: async () => ({
      cycleCode: 'J26', cycleLabel: 'June 2026', count: 2,
      awardees: [
        { requestId: 'r1', requestNumber: '1002238', title: 'Fungal Networks', pi: { name: 'Erika Espinosa-Ortiz' }, liaison: { name: 'Dawnie Elzinga' }, statusLabel: 'Drafted', abstractReady: true },
        { requestId: 'r2', requestNumber: '1002324', title: 'Circadian clock', pi: { name: 'Margaret Stratton' }, liaison: { name: 'Marco Monoc' }, statusLabel: null, abstractReady: false },
      ],
    }),
  }));

  renderPanel();

  await waitFor(() => expect(screen.getByText('Fungal Networks')).toBeInTheDocument());
  expect(screen.getByText('Erika Espinosa-Ortiz')).toBeInTheDocument();
  expect(screen.getByText('Margaret Stratton')).toBeInTheDocument();
  const links = screen.getAllByRole('link', { name: /open/i });
  expect(links.map((l) => l.getAttribute('href'))).toEqual([
    '/workbench/r1?tab=awardee',
    '/workbench/r2?tab=awardee',
  ]);
  // A populated cycle never consults the cycle list.
  expect(global.fetch.mock.calls.some(([u]) => isCycleList(u))).toBe(false);
  expect(global.fetch).toHaveBeenCalledWith('/api/workbench/grantee-deliverables/awardees?cycleCode=J26', expect.any(Object));
});

test('empty state (mine scope) in a cycle that has awardees prompts to show all', async () => {
  global.fetch = withCycleList(async () => ({ ok: true, json: async () => ({ cycleCode: 'J26', cycleLabel: 'June 2026', count: 0, awardees: [], scope: 'mine', pdResolved: true }) }));
  renderPanel();
  await waitFor(() => expect(screen.getByText(/no awardees assigned to you for June 2026/i)).toBeInTheDocument());
  expect(await screen.findByText(/Choose “All program directors”/)).toBeInTheDocument();
  expect(global.fetch.mock.calls.every(([u]) => !String(u).includes('scope=all'))).toBe(true);
  expect(screen.queryByRole('button', { name: /awardees in/ })).not.toBeInTheDocument();
});

test('the working cycle with no awardees yet names itself and links the last decided cycle, which changes the shell cycle', async () => {
  global.fetch = withCycleList(async (url) => {
    const code = cycleCodeFromUrl(url);
    return code === 'D26'
      ? response({ cycleCode: 'D26', cycleLabel: 'December 2026', count: 0, awardees: [], scope: 'mine', pdResolved: true })
      : response({ cycleCode: 'J26', cycleLabel: 'June 2026', count: 1, awardees: [awardee('June row')] });
  });
  renderPanel({ cycleCode: 'D26' });
  expect(await screen.findByText('No awardees for December 2026 yet.')).toBeInTheDocument();
  expect(screen.queryByText(/Choose “All program directors”/)).not.toBeInTheDocument();
  const link = await screen.findByRole('button', { name: '14 awardees in June 2026' });

  fireEvent.click(link);
  expect(harness.state.cycleCode).toBe('J26');
  expect(await screen.findByText('June row')).toBeInTheDocument();
});

test('an empty cycle under All program directors is empty for everyone: no prompt to show all, the last decided link renders', async () => {
  global.fetch = withCycleList(async () => response({ cycleCode: 'D26', cycleLabel: 'December 2026', count: 0, awardees: [], scope: 'all', pdResolved: true }));
  renderPanel({ cycleCode: 'D26', scope: 'all' });
  expect(await screen.findByText('No awardees for December 2026 yet.')).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: '14 awardees in June 2026' })).toBeInTheDocument();
});

test('a failed cycle-list read still shows the empty state, without the link', async () => {
  global.fetch = jest.fn(async (url) => (isCycleList(url)
    ? response({ error: 'list down' }, false)
    : response({ cycleCode: 'D26', cycleLabel: 'December 2026', count: 0, awardees: [], scope: 'all', pdResolved: true })));
  renderPanel({ cycleCode: 'D26', scope: 'all' });
  expect(await screen.findByText('No awardees for December 2026 yet.')).toBeInTheDocument();
  await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => isCycleList(u))).toBe(true));
  expect(screen.queryByRole('button', { name: /awardees in/ })).not.toBeInTheDocument();
});

test('PD-unresolved empty state prompts to show all', async () => {
  global.fetch = withCycleList(async () => ({ ok: true, json: async () => ({ cycleCode: 'D25', cycleLabel: 'December 2025', count: 0, awardees: [], scope: 'mine', pdResolved: false, programDirector: null }) }));
  renderPanel();
  await waitFor(() => expect(screen.getByText(/could not match your account/i)).toBeInTheDocument());
  // Only that guidance: no last-decided link, and the cycle list is not consulted.
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByRole('button', { name: /awardees in/ })).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([u]) => isCycleList(u))).toBe(false);
});

test('toggling "All program directors" hands the shell scope=all and refetches with it', async () => {
  global.fetch = withCycleList(async () => ({ ok: true, json: async () => ({ cycleCode: 'J26', cycleLabel: 'June 2026', count: 0, awardees: [], scope: 'mine', pdResolved: true }) }));
  renderPanel();
  await waitFor(() => expect(screen.getByRole('button', { name: 'All program directors' })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'All program directors' }));
  expect(harness.state.scope).toBe('all');
  await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => String(u).includes('scope=all'))).toBe(true));
});

test('a stale success cannot overwrite a newer cycle and its request is aborted', async () => {
  const pending = [];
  global.fetch = withCycleList((url, options) => {
    const d = deferred();
    pending.push({ url: String(url), options, d });
    return d.promise;
  });

  renderPanel();
  await waitFor(() => expect(pending).toHaveLength(1));
  const initialCycle = cycleCodeFromUrl(pending[0].url);
  const nextCycle = alternateCycle(initialCycle);
  harness.set({ cycleCode: nextCycle });
  await waitFor(() => expect(pending).toHaveLength(2));

  await settle(pending[1].d, response({ cycleCode: nextCycle, cycleLabel: nextCycle, count: 1, awardees: [awardee(`${nextCycle} current`)] }));
  expect(screen.getByText(`${nextCycle} current`)).toBeInTheDocument();
  await settle(pending[0].d, response({ cycleCode: initialCycle, cycleLabel: initialCycle, count: 1, awardees: [awardee(`${initialCycle} stale`)] }));

  expect(screen.getByText(`${nextCycle} current`)).toBeInTheDocument();
  expect(screen.queryByText(`${initialCycle} stale`)).not.toBeInTheDocument();
  expect(pending[0].options.signal.aborted).toBe(true);
});

test('a same-cycle scope change clears mine rows and keeps the all-scope result authoritative', async () => {
  const pending = [];
  global.fetch = withCycleList((url, options) => {
    const d = deferred();
    pending.push({ url: String(url), options, d });
    return d.promise;
  });

  renderPanel();
  await waitFor(() => expect(pending).toHaveLength(1));
  await settle(pending[0].d, response({ cycleCode: cycleCodeFromUrl(pending[0].url), cycleLabel: 'Current cycle', count: 1, scope: 'mine', awardees: [awardee('Mine row')] }));
  expect(screen.getByText('Mine row')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All program directors' }));
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(screen.queryByText('Mine row')).not.toBeInTheDocument();
  expect(screen.queryByText('Current cycle · 1 awardee')).not.toBeInTheDocument();

  await settle(pending[1].d, response({ cycleCode: cycleCodeFromUrl(pending[1].url), cycleLabel: 'Current cycle', count: 1, scope: 'all', awardees: [awardee('All row')] }));
  expect(screen.getByText('All row')).toBeInTheDocument();
});

test('returning to a prior cycle cannot revive its old rows while a fresh request is pending', async () => {
  const pending = [];
  global.fetch = withCycleList((url, options) => {
    const d = deferred();
    pending.push({ url: String(url), options, d });
    return d.promise;
  });

  renderPanel();
  await waitFor(() => expect(pending).toHaveLength(1));
  const cycleA = cycleCodeFromUrl(pending[0].url);
  const cycleB = alternateCycle(cycleA);
  await settle(pending[0].d, response({ cycleCode: cycleA, cycleLabel: cycleA, count: 1, awardees: [awardee('A old')] }));
  expect(screen.getByText('A old')).toBeInTheDocument();

  harness.set({ cycleCode: cycleB });
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(screen.queryByText('A old')).not.toBeInTheDocument();

  harness.set({ cycleCode: cycleA });
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
  global.fetch = withCycleList((url, options) => {
    const d = deferred();
    pending.push({ url: String(url), options, d });
    return d.promise;
  });

  renderPanel();
  await waitFor(() => expect(pending).toHaveLength(1));
  const cycleA = cycleCodeFromUrl(pending[0].url);
  const cycleB = alternateCycle(cycleA);
  await settle(pending[0].d, response({ error: 'A old error' }, false));
  expect(screen.getByRole('alert')).toHaveTextContent('A old error');

  harness.set({ cycleCode: cycleB });
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();

  harness.set({ cycleCode: cycleA });
  await waitFor(() => expect(pending).toHaveLength(3));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();

  await settle(pending[1].d, response({ error: 'B stale error' }, false));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await settle(pending[2].d, response({ cycleCode: cycleA, cycleLabel: cycleA, count: 0, awardees: [], pdResolved: true }));
  expect(screen.getByText(/no awardees assigned to you/i)).toBeInTheDocument();
});

test('unmount aborts the active request and ignores a delayed response', async () => {
  const pending = deferred();
  let options;
  global.fetch = withCycleList((_url, init) => { options = init; return pending.promise; });

  const { unmount } = renderPanel();
  await waitFor(() => expect(options).toBeDefined());
  unmount();
  expect(options.signal.aborted).toBe(true);
  await settle(pending, response({ cycleCode: 'J26', cycleLabel: 'June 2026', count: 1, awardees: [awardee('Unmounted row')] }));
});

test('no cycle from the shell yet: nothing is requested', async () => {
  global.fetch = jest.fn();
  renderPanel({ cycleCode: null });
  await act(async () => { await Promise.resolve(); });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('the legacy awardees route redirects into the shell, carrying the cycle', async () => {
  await expect(legacyAwardeesRedirect({ query: { cycleCode: 'j26' } })).resolves.toEqual({
    redirect: { destination: '/workbench?view=awardees&cycleCode=J26', permanent: false },
  });
});

test('the count line uses real pluralization: "1 awardee" and "2 awardees"', async () => {
  global.fetch = withCycleList(async () => response({
    cycleCode: 'J26', cycleLabel: 'June 2026', count: 1, awardees: [awardee('Solo row')],
  }));
  renderPanel();
  expect(await screen.findByText('June 2026 · 1 awardee')).toBeInTheDocument();
  expect(screen.queryByText(/awardee\(s\)/)).not.toBeInTheDocument();
});
