import { useEffect, useLayoutEffect, useRef } from 'react';
import { useRouter } from 'next/router';

/** Family-only guard; Profile Settings keeps its controller alive during loading. */
export default function useReviewerThankYouDefaultsUnsavedChanges(dirty, pending, confirmedReload = false) {
  const router = useRouter();
  const events = router.events;
  const routerRef = useRef(router);
  useLayoutEffect(() => { routerRef.current = router; }, [router]);
  useEffect(() => {
    if (!dirty) return undefined;
    let approved = null;
    const key = url => new URL(url, window.location.href).href;
    const allow = (url, options) => {
      if (options?.shallow && new URL(url, window.location.href).pathname === '/profile-settings') return true;
      const target = key(url);
      if (approved === target) return true;
      if (!window.confirm(thankYouDiscardMessage(pending, confirmedReload))) return false;
      approved = target;
      return true;
    };
    const reset = () => { approved = null; };
    const beforeRoute = (url, options) => {
      if (allow(url, options)) return;
      const error = Object.assign(new Error('Unsaved automatic thank-you defaults'), { cancelled: true });
      events.emit('routeChangeError', error, url, options);
      throw error;
    };
    let currentState = window.history.state;
    let currentUrl = window.location.href;
    const captureHistory = () => { currentState = window.history.state; currentUrl = window.location.href; };
    const completed = () => { reset(); captureHistory(); };
    // Next changes history synchronously after beforeHistoryChange, then awaits
    // rendering before routeChangeComplete. Capture before a fast Back can win.
    const changingHistory = () => queueMicrotask(captureHistory);
    routerRef.current.beforePopState(({ as, options }) => {
      reset();
      if (allow(as, options)) return true;
      window.history.pushState(currentState, '', currentUrl);
      return false;
    });
    const unload = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    events.on('beforeHistoryChange', changingHistory);
    events.on('routeChangeStart', beforeRoute);
    events.on('routeChangeComplete', completed);
    events.on('routeChangeError', reset);
    return () => {
      window.removeEventListener('beforeunload', unload);
      events.off('beforeHistoryChange', changingHistory);
      events.off('routeChangeStart', beforeRoute);
      events.off('routeChangeComplete', completed);
      events.off('routeChangeError', reset);
      routerRef.current.beforePopState(() => true);
    };
  }, [dirty, pending, confirmedReload, events]);
}

export function thankYouDiscardMessage(pending, confirmedReload) {
  return confirmedReload
    ? 'Your default wording change was confirmed, but refreshed data is unavailable. Leaving loses local edits and results. Leave and reload defaults before another change?'
    : pending
    ? 'A default wording change is pending or unconfirmed and may already be saved. Leaving loses local edits and results. Leave and reload defaults before another change?'
    : 'Discard your unsaved default wording?';
}
