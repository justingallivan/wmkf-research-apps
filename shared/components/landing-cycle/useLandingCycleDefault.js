import { useEffect, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';

/** Client wait for the landing-cycle read before an app falls back to its own rule. */
export const LANDING_CLIENT_TIMEOUT_MS = 2500;

const CODE = /^[JD]\d{2}$/;

/**
 * One-shot landing-cycle default for client-only apps
 * (docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md §3.3). The first of success,
 * failure or timeout settles `{ settled: true, code }` for this mount; every
 * later completion is ignored. Callers keep the user's explicit choice ahead of
 * `code` and hold data loads until `settled` (or the user has chosen).
 *
 * @param {{ view?: 'board' | null, skip?: boolean, wait?: boolean, timeoutMs?: number }} options
 *   `view: 'board'` asks for the Board pages' default; `skip` settles at once
 *   with no code (e.g. an explicit URL or rehearsal cycle); `wait` holds the
 *   hook unsettled with no request (e.g. until the router is ready), so a
 *   caller never renders on a fallback that a later reply would replace.
 */
export function useLandingCycleDefault({ view = null, skip = false, wait = false, timeoutMs = LANDING_CLIENT_TIMEOUT_MS } = {}) {
  const [state, setState] = useState(() => ({ settled: skip && !wait, code: null }));
  useEffect(() => {
    if (wait) return undefined;
    if (skip) {
      setState((current) => (current.settled ? current : { settled: true, code: null }));
      return undefined;
    }
    let done = false;
    const controller = new AbortController();
    const settle = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      controller.abort();
      setState({ settled: true, code: typeof code === 'string' && CODE.test(code) ? code : null });
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
  }, [skip, wait, timeoutMs, view]);
  return state;
}
