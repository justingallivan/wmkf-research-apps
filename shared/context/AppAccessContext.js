/**
 * AppAccessContext - Tracks which apps the current user can access
 *
 * Fetches allowed apps from /api/app-access on mount.
 * Provides hasAccess(appKey) for nav filtering and page guards.
 * Returns false during loading or on error (deny by default / fail-closed).
 *
 * Resilience (S281): the access fetch is the gate for every app page, so a
 * single stalled request must not strand the UI on a permanent "Loading…"
 * spinner. The fetch therefore (1) has a hard timeout so it can never hang
 * forever, (2) retries a few times to ride out a transient stall (e.g. a cold
 * serverless function on the first request after navigation), and (3) exposes
 * an `error` flag plus `refreshAccess` so the guard can offer a Retry instead of
 * a dead spinner. It also self-heals: if we never loaded successfully, regaining
 * tab focus/visibility re-attempts the fetch.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const AppAccessContext = createContext(null);

// One attempt's hard ceiling; an abort here is treated as a (retryable) failure
// rather than an indefinite hang. Generous enough to absorb a function cold
// start without false-aborting a healthy-but-slow request.
const FETCH_TIMEOUT_MS = 12000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 800;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function AppAccessProvider({ children }) {
  const [allowedApps, setAllowedApps] = useState(null); // null = never-loaded
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false); // true = load failed after retries

  // Monotonic guard so a superseded/overlapping fetch can never clobber the
  // result of a newer one (e.g. an in-flight mount fetch racing a focus-retry).
  const seqRef = useRef(0);
  // Latest state for the focus/visibility handler without re-binding listeners
  // on every render.
  const stateRef = useRef({ allowedApps: null, error: false });
  stateRef.current = { allowedApps, error };

  const fetchAccess = useCallback(async () => {
    const seq = ++seqRef.current;
    setIsLoading(true);
    setError(false);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch('/api/app-access', { signal: controller.signal });
        clearTimeout(timer);
        if (seq !== seqRef.current) return; // a newer fetch superseded this one
        if (!res.ok) throw new Error(`app-access ${res.status}`);
        const data = await res.json();
        if (seq !== seqRef.current) return;
        setAllowedApps(data.apps || []);
        setIsSuperuser(data.isSuperuser || false);
        setError(false);
        setIsLoading(false);
        return;
      } catch {
        clearTimeout(timer);
        if (seq !== seqRef.current) return; // superseded — let the newer fetch own state
        if (attempt < MAX_ATTEMPTS) {
          await delay(RETRY_BASE_DELAY_MS * attempt); // linear backoff
          if (seq !== seqRef.current) return;
          continue;
        }
        // Terminal failure: stop the spinner and surface a retryable error.
        // allowedApps is left as-is (null on first load), so hasAccess still
        // denies — fail-closed — while the guard shows a Retry affordance.
        setError(true);
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchAccess();
  }, [fetchAccess]);

  // Self-heal: if we have not yet loaded successfully (never loaded, or errored),
  // re-attempt when the tab regains focus/visibility. No-op once access loaded.
  useEffect(() => {
    const maybeRefetch = () => {
      if (document.visibilityState === 'hidden') return;
      const { allowedApps: apps, error: err } = stateRef.current;
      if (apps === null || err) fetchAccess();
    };
    document.addEventListener('visibilitychange', maybeRefetch);
    window.addEventListener('focus', maybeRefetch);
    return () => {
      document.removeEventListener('visibilitychange', maybeRefetch);
      window.removeEventListener('focus', maybeRefetch);
    };
  }, [fetchAccess]);

  const hasAccess = useCallback((appKey) => {
    // While loading or unloaded, deny (show nothing until permissions confirmed).
    if (allowedApps === null) return false;
    return allowedApps.includes(appKey);
  }, [allowedApps]);

  const value = {
    allowedApps,
    isSuperuser,
    isLoading,
    error,
    hasAccess,
    refreshAccess: fetchAccess,
  };

  return (
    <AppAccessContext.Provider value={value}>
      {children}
    </AppAccessContext.Provider>
  );
}

export function useAppAccess() {
  const context = useContext(AppAccessContext);
  if (!context) {
    throw new Error('useAppAccess must be used within an AppAccessProvider');
  }
  return context;
}

export default AppAccessContext;
