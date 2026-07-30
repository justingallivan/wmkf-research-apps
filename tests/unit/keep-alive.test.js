/**
 * lib/utils/keep-alive — post-response background work handoff.
 *
 * The load-bearing behavior: @vercel/functions' waitUntil OPTIONAL-CALLS the
 * request context's waitUntil, so with no context it is a silent no-op and the work
 * would be orphaned. keepAlive must detect that and await inline instead.
 *
 * @jest-environment node
 */

const waitUntil = jest.fn();
jest.mock('@vercel/functions', () => ({ waitUntil: (...a) => waitUntil(...a) }));

import { keepAlive } from '../../lib/utils/keep-alive';

const SYMBOL_FOR_REQ_CONTEXT = Symbol.for('@vercel/request-context');

/** Install a fake Vercel request context exposing waitUntil. */
function withRuntimeContext(fn) {
  const prev = globalThis[SYMBOL_FOR_REQ_CONTEXT];
  globalThis[SYMBOL_FOR_REQ_CONTEXT] = { get: () => ({ waitUntil: () => {} }) };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prev === undefined) delete globalThis[SYMBOL_FOR_REQ_CONTEXT];
      else globalThis[SYMBOL_FOR_REQ_CONTEXT] = prev;
    });
}

beforeEach(() => {
  waitUntil.mockReset();
  delete globalThis[SYMBOL_FOR_REQ_CONTEXT];
});

test('no runtime context (local dev / jest): awaits inline so work is not orphaned', async () => {
  let done = false;
  await keepAlive(new Promise((resolve) => setTimeout(() => { done = true; resolve(); }, 5)));
  expect(done).toBe(true);
  expect(waitUntil).not.toHaveBeenCalled();
});

test('runtime context present: registers with waitUntil and returns without awaiting', async () => {
  await withRuntimeContext(async () => {
    let done = false;
    const work = new Promise((resolve) => setTimeout(() => { done = true; resolve(); }, 50));
    await keepAlive(work);
    // Handed off — keepAlive did NOT block on the 50ms work.
    expect(done).toBe(false);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await work;
  });
});

test('a rejecting promise never rejects the caller (no context)', async () => {
  await expect(keepAlive(Promise.reject(new Error('boom')))).resolves.toBeUndefined();
});

test('a rejecting promise never rejects the caller (with context)', async () => {
  await withRuntimeContext(async () => {
    await expect(keepAlive(Promise.reject(new Error('boom')))).resolves.toBeUndefined();
    // The registered promise is the SWALLOWED one, so the runtime never sees a
    // rejection either.
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });
});

test('a context without waitUntil falls back to awaiting', async () => {
  const prev = globalThis[SYMBOL_FOR_REQ_CONTEXT];
  globalThis[SYMBOL_FOR_REQ_CONTEXT] = { get: () => ({}) }; // context, but no waitUntil
  try {
    let done = false;
    await keepAlive(new Promise((resolve) => setTimeout(() => { done = true; resolve(); }, 5)));
    expect(done).toBe(true);
    expect(waitUntil).not.toHaveBeenCalled();
  } finally {
    if (prev === undefined) delete globalThis[SYMBOL_FOR_REQ_CONTEXT];
    else globalThis[SYMBOL_FOR_REQ_CONTEXT] = prev;
  }
});
