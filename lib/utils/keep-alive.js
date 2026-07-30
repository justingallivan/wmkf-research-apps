/**
 * keepAlive — hand post-response background work to the Vercel runtime.
 *
 * Use for work that must run AFTER a response is written but must still finish:
 * the response goes out immediately, and the runtime keeps the invocation alive
 * until the promise settles. Awaiting such work BEFORE responding risks the
 * platform ending the invocation first, which turns a committed operation into an
 * apparent failure for the caller.
 *
 * Why the fallback matters: `waitUntil` resolves the request context off a
 * globalThis symbol and OPTIONAL-CALLS it — `getContext().waitUntil?.(promise)`
 * (node_modules/@vercel/functions/wait-until.js). Outside a Vercel request context
 * (local `next dev`, jest, one-off scripts) there is no context, so the call is a
 * silent no-op and the promise would be orphaned. So probe for a real runtime
 * waitUntil first: register when it exists, otherwise await inline.
 *
 * The returned promise NEVER rejects — background work must not surface as an
 * unhandled rejection or change an already-sent response.
 */

import { waitUntil } from '@vercel/functions';

// Vercel's request-context global (mirrors @vercel/functions' own get-context).
const SYMBOL_FOR_REQ_CONTEXT = Symbol.for('@vercel/request-context');

/** True when a real runtime waitUntil is available to take ownership. */
function hasRuntimeWaitUntil() {
  try {
    return typeof globalThis[SYMBOL_FOR_REQ_CONTEXT]?.get?.()?.waitUntil === 'function';
  } catch {
    return false;
  }
}

/**
 * @param {Promise<any>} promise - background work already started by the caller.
 * @returns {Promise<void>} resolves once the work is registered (on Vercel) or
 *          has settled (everywhere else). Never rejects.
 */
export async function keepAlive(promise) {
  // Swallow first: whether the runtime owns it or we await it, a rejection here
  // must not propagate into the caller's post-response path.
  const settled = Promise.resolve(promise).catch((err) => {
    console.error('[keepAlive] background work failed (non-fatal):', err?.message || err);
  });

  if (hasRuntimeWaitUntil()) {
    try {
      waitUntil(settled);
      return;
    } catch (err) {
      // Only a non-Promise argument throws; fall through to awaiting.
      console.error('[keepAlive] waitUntil rejected the promise; awaiting inline:', err?.message || err);
    }
  }

  await settled;
}
