import { useEffect } from 'react';
import { useRouter } from 'next/router';

/** Guard only future wording, not selected-row routing or distribution recovery. */
export default function useScheduledDefaultsUnsavedChanges(dirty, pending) {
  const router = useRouter();
  useEffect(() => {
    if (!dirty) return undefined;
    let approved = null;
    const key = url => new URL(url, window.location.href).href;
    const allow = (url, options) => {
      if (options?.shallow && new URL(url, window.location.href).pathname === '/scheduled-emails') return true;
      const target = key(url);
      if (approved === target) return true;
      if (!window.confirm(pending
        ? 'A default wording change is pending or unconfirmed and may already be saved. Leaving loses local edits and results. Leave and reload defaults before another change?'
        : 'Discard your unsaved default wording?')) return false;
      approved = target;
      return true;
    };
    const reset = () => { approved = null; };
    const beforeRoute = (url, options) => {
      if (allow(url, options)) return;
      const error = Object.assign(new Error('Unsaved scheduled reminder defaults'), { cancelled: true });
      router.events.emit('routeChangeError', error, url, options);
      throw error;
    };
    const currentState = window.history.state;
    const currentUrl = window.location.href;
    router.beforePopState(({ as, options }) => {
      reset();
      if (allow(as, options)) return true;
      window.history.pushState(currentState, '', currentUrl);
      return false;
    });
    const unload = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    router.events.on('routeChangeStart', beforeRoute);
    router.events.on('routeChangeComplete', reset);
    router.events.on('routeChangeError', reset);
    return () => {
      window.removeEventListener('beforeunload', unload);
      router.events.off('routeChangeStart', beforeRoute);
      router.events.off('routeChangeComplete', reset);
      router.events.off('routeChangeError', reset);
      router.beforePopState(() => true);
    };
  }, [dirty, pending, router]);
}
