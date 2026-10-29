import { useEffect, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';

/** Client wait for the landing-cycle read before an app falls back to its own rule. */
export const LANDING_CLIENT_TIMEOUT_MS = 2500;

const CODE = /^[JD]\d{2}$/;

/**
 * One-shot landing-cycle default for client-only apps
 * (docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md §3.3). The first of success,
 * failure or timeout settles `{ settled: true, code }` for the current options;
 * every later completion is ignored. Callers keep the user's explicit choice
 * ahead of `code` and hold data loads until `settled` (or the user has chosen).
 *
 * The decision belongs to the options it was made for (`view`, `skip`, `wait`).
 * When they change — e.g. a Board page's URL cycle is removed, or the router
 * becomes ready — the hook reports unsettled in that same render until a fresh
 * read settles, so a caller never renders a fallback a later reply would replace.
 *
 * @param {{ view?: 'board' | null, skip?: boolean, wait?: boolean, timeoutMs?: number }} options
 *   `view: 'board'` asks for the Board pages' default; `skip` settles at once
 *   with no code (e.g. an explicit URL or rehearsal cycle); `wait` holds the
 *   hook unsettled with no request (e.g. until the router is ready).
 */
export function useLandingCycleDefault({ view = null, skip = false, wait = false, timeoutMs = LANDING_CLIENT_TIMEOUT_MS } = {}) {
  const key = `${view || ''}|${skip ? 'skip' : ''}|${wait ? 'wait' : ''}`;
  const [decision, setDecision] = useState(null); // { key, code } once settled for `key`
  // Any change of options discards the previous decision in this render, so returning to an
  // earlier key never reuses a stale answer while that key's fresh read is still pending.
  const [decisionKey, setDecisionKey] = useState(key);
  if (decisionKey !== key) {
    setDecisionKey(key);
    setDecision(null);
  }
  useEffect(() => {
    if (wait || skip) return undefined;
    let done = false;
    const controller = new AbortController();
    const settle = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      controller.abort();
      setDecision({ key, code: typeof code === 'string' && CODE.test(code) ? code : null });
    };
    const timer = setTimeout(() => settle(null), timeoutMs);
    requestEnvelope(view === 'board' ? '/api/landing-cycle?view=board' : '/api/landing-cycle', {
      signal: controller.signal,
      tolerantBody: true,
    }).then(
      ({ ok, data }) => settle(ok ? (view === 'board' ? data?.cycleCode : data?.landingCycleCode) : null),
      () => settle(null),
    );
    return () => {
      done = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, skip, wait, timeoutMs, view]);
  if (wait) return { settled: false, code: null };
  if (skip) return { settled: true, code: null };
  return decision?.key === key && decisionKey === key ? { settled: true, code: decision.code } : { settled: false, code: null };
}
