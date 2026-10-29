/**
 * Board pages wait for the router and the Board default before mounting the
 * Board view (docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md §3.3): no fallback
 * mount, one mount on the resolved cycle, and a URL cycle wins.
 *
 * @jest-environment jsdom
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import BoardWriteupsPage from '../../pages/board-writeups';
import BoardCycleSetupPage from '../../pages/board-cycle-setup';

let routerState;
jest.mock('next/router', () => ({ useRouter: () => routerState }));
jest.mock('../../shared/components/Layout', () => ({ __esModule: true, default: ({ children }) => <div>{children}</div> }));
jest.mock('../../shared/components/RequireAppAccess', () => ({ __esModule: true, default: ({ children }) => <>{children}</> }));
const mounts = [];
jest.mock('../../shared/components/board-writeups/BoardWriteups', () => {
  const ReactActual = jest.requireActual('react');
  return {
    __esModule: true,
    default: function BoardWriteupsStub({ initialCycle, mode }) {
      ReactActual.useEffect(() => { mounts.push(`${mode || 'dashboard'}:${initialCycle}`); }, []);
      return <p>Board view {initialCycle}</p>;
    },
  };
});

function deferredFetch() {
  let resolve;
  global.fetch = jest.fn(() => new Promise((r) => { resolve = r; }));
  return (body) => resolve({ ok: true, status: 200, json: async () => body });
}

beforeEach(() => { mounts.length = 0; });

test.each([
  ['writeups', BoardWriteupsPage, 'dashboard'],
  ['setup', BoardCycleSetupPage, 'setup'],
])('%s page: no Board view until the router is ready and the default arrives, then exactly one mount', async (_name, Page, mode) => {
  routerState = { isReady: false, query: {}, replace: jest.fn() };
  const reply = deferredFetch();
  const view = render(<Page />);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.queryByText(/Board view/)).toBeNull();

  routerState = { isReady: true, query: {}, replace: jest.fn() };
  view.rerender(<Page />);
  expect(screen.queryByText(/Board view/)).toBeNull();
  expect(global.fetch).toHaveBeenCalledWith('/api/landing-cycle?view=board', expect.anything());

  await act(async () => { reply({ cycleCode: 'J27' }); });
  await waitFor(() => expect(screen.getByText('Board view J27')).toBeInTheDocument());
  expect(mounts).toEqual([`${mode}:J27`]);
});

test('a valid URL cycle wins with no default request', () => {
  routerState = { isReady: true, query: { cycle: 'D26' }, replace: jest.fn() };
  global.fetch = jest.fn();
  render(<BoardWriteupsPage />);
  expect(screen.getByText('Board view D26')).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mounts).toEqual(['dashboard:D26']);
});

test.each([
  ['writeups', BoardWriteupsPage, 'dashboard'],
  ['setup', BoardCycleSetupPage, 'setup'],
])('%s page: removing the URL cycle (Tools menu link) shows no fallback view before the default arrives', async (_name, Page, mode) => {
  routerState = { isReady: true, query: { cycle: 'D26' }, replace: jest.fn() };
  global.fetch = jest.fn();
  const view = render(<Page />);
  expect(screen.getByText('Board view D26')).toBeInTheDocument();
  const reply = deferredFetch();
  routerState = { isReady: true, query: {}, replace: jest.fn() };
  view.rerender(<Page />);
  expect(screen.queryByText(/Board view/)).toBeNull();
  await act(async () => { reply({ cycleCode: 'J27' }); });
  await waitFor(() => expect(screen.getByText('Board view J27')).toBeInTheDocument());
  expect(mounts).toEqual([`${mode}:D26`, `${mode}:J27`]);
});

test('a URL cycle arriving while the default is pending wins, and the late reply changes nothing', async () => {
  routerState = { isReady: true, query: {}, replace: jest.fn() };
  const reply = deferredFetch();
  const view = render(<BoardWriteupsPage />);
  routerState = { isReady: true, query: { cycle: 'D26' }, replace: jest.fn() };
  view.rerender(<BoardWriteupsPage />);
  expect(screen.getByText('Board view D26')).toBeInTheDocument();
  await act(async () => { reply({ cycleCode: 'J27' }); });
  expect(screen.getByText('Board view D26')).toBeInTheDocument();
  expect(mounts).toEqual(['dashboard:D26']);
});

test('the discussion-cleanup redirect waits for the resolved cycle', async () => {
  window.history.replaceState(null, '', '/board-writeups#discussion-cleanup');
  const replace = jest.fn();
  routerState = { isReady: true, query: {}, replace };
  const reply = deferredFetch();
  render(<BoardWriteupsPage />);
  expect(replace).not.toHaveBeenCalled();
  await act(async () => { reply({ cycleCode: 'J27' }); });
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/board-cycle-setup?cycle=J27#discussion-cleanup'));
  expect(replace).toHaveBeenCalledTimes(1);
  window.history.replaceState(null, '', '/');
});
