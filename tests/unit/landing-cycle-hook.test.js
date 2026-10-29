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

test('wait holds the hook unsettled with no request, then a single read settles it', async () => {
  global.fetch = jest.fn();
  const { result, rerender } = renderHook(({ wait }) => useLandingCycleDefault({ view: 'board', wait }), { initialProps: { wait: true } });
  expect(result.current).toEqual({ settled: false, code: null });
  expect(global.fetch).not.toHaveBeenCalled();
  const reply = deferredFetch();
  rerender({ wait: false });
  // Still unsettled after the router becomes ready: the caller must not render a fallback yet.
  expect(result.current).toEqual({ settled: false, code: null });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  await act(async () => { reply({ cycleCode: 'J27' }); });
  await waitFor(() => expect(result.current).toEqual({ settled: true, code: 'J27' }));
});

test('leaving skip reports unsettled in the same render until the fresh read settles', async () => {
  global.fetch = jest.fn();
  const { result, rerender } = renderHook(({ skip }) => useLandingCycleDefault({ view: 'board', skip }), { initialProps: { skip: true } });
  expect(result.current).toEqual({ settled: true, code: null });
  const reply = deferredFetch();
  rerender({ skip: false });
  expect(result.current).toEqual({ settled: false, code: null });
  await act(async () => { reply({ cycleCode: 'J27' }); });
  await waitFor(() => expect(result.current).toEqual({ settled: true, code: 'J27' }));
});

test('re-entering wait drops back to unsettled, and releasing it starts a fresh read', async () => {
  let reply = deferredFetch();
  const { result, rerender } = renderHook(({ wait }) => useLandingCycleDefault({ view: 'board', wait }), { initialProps: { wait: false } });
  await act(async () => { reply({ cycleCode: 'D26' }); });
  await waitFor(() => expect(result.current).toEqual({ settled: true, code: 'D26' }));
  rerender({ wait: true });
  expect(result.current).toEqual({ settled: false, code: null });
  reply = deferredFetch();
  rerender({ wait: false });
  expect(result.current).toEqual({ settled: false, code: null });
  await act(async () => { reply({ cycleCode: 'J27' }); });
  await waitFor(() => expect(result.current).toEqual({ settled: true, code: 'J27' }));
});

test('switching options away and back never reuses the earlier answer while a fresh read is pending', async () => {
  let reply = deferredFetch();
  const { result, rerender } = renderHook(({ skip }) => useLandingCycleDefault({ view: 'board', skip }), { initialProps: { skip: false } });
  await act(async () => { reply({ cycleCode: 'D26' }); });
  await waitFor(() => expect(result.current).toEqual({ settled: true, code: 'D26' }));
  rerender({ skip: true });
  reply = deferredFetch();
  rerender({ skip: false });
  expect(result.current).toEqual({ settled: false, code: null });
  await act(async () => { reply({ cycleCode: 'J27' }); });
  await waitFor(() => expect(result.current).toEqual({ settled: true, code: 'J27' }));
});
