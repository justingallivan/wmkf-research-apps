/**
 * One-shot client landing default (docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md §3.3):
 * the first of success, failure or timeout settles the mount; later replies are ignored.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { useLandingCycleDefault } from '../../shared/components/landing-cycle/useLandingCycleDefault';

function deferredFetch() {
  let resolve;
  global.fetch = jest.fn(() => new Promise((r) => { resolve = r; }));
  return (body, status = 200) => resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
}

afterEach(() => { jest.useRealTimers(); });

test('a successful read settles with the landing code', async () => {
  const reply = deferredFetch();
  const { result } = renderHook(() => useLandingCycleDefault());
  expect(result.current).toEqual({ settled: false, code: null });
  expect(global.fetch.mock.calls[0][0]).toBe('/api/landing-cycle');
  await act(async () => { reply({ landingCycleCode: 'J27' }); });
  await waitFor(() => expect(result.current).toEqual({ settled: true, code: 'J27' }));
});

test('the board view reads the Board default', async () => {
  const reply = deferredFetch();
  const { result } = renderHook(() => useLandingCycleDefault({ view: 'board' }));
  expect(global.fetch.mock.calls[0][0]).toBe('/api/landing-cycle?view=board');
  await act(async () => { reply({ cycleCode: 'D26' }); });
  await waitFor(() => expect(result.current).toEqual({ settled: true, code: 'D26' }));
});

test('a failed read settles with no code', async () => {
  const reply = deferredFetch();
  const { result } = renderHook(() => useLandingCycleDefault());
  await act(async () => { reply({ error: 'down' }, 503); });
  await waitFor(() => expect(result.current).toEqual({ settled: true, code: null }));
});

test('a timeout settles with no code and a late success never changes it', async () => {
  jest.useFakeTimers();
  const reply = deferredFetch();
  const { result } = renderHook(() => useLandingCycleDefault({ timeoutMs: 100 }));
  await act(async () => { jest.advanceTimersByTime(100); });
  expect(result.current).toEqual({ settled: true, code: null });
  await act(async () => { reply({ landingCycleCode: 'J27' }); });
  expect(result.current).toEqual({ settled: true, code: null });
});

test('a malformed code from the server is ignored', async () => {
  const reply = deferredFetch();
  const { result } = renderHook(() => useLandingCycleDefault());
  await act(async () => { reply({ landingCycleCode: 'June 2027' }); });
  await waitFor(() => expect(result.current).toEqual({ settled: true, code: null }));
});

test('skip settles at once without a request', () => {
  global.fetch = jest.fn();
  const { result } = renderHook(() => useLandingCycleDefault({ skip: true }));
  expect(result.current).toEqual({ settled: true, code: null });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('unmount aborts the read, and a remount starts a fresh decision', async () => {
  deferredFetch();
  const first = renderHook(() => useLandingCycleDefault());
  const signal = global.fetch.mock.calls[0][1].signal;
  first.unmount();
  expect(signal.aborted).toBe(true);
  const reply = deferredFetch();
  const second = renderHook(() => useLandingCycleDefault());
  expect(second.result.current.settled).toBe(false);
  await act(async () => { reply({ landingCycleCode: 'J27' }); });
  await waitFor(() => expect(second.result.current).toEqual({ settled: true, code: 'J27' }));
});
