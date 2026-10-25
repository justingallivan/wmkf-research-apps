import { useEffect } from 'react';
import { useRouter } from 'next/router';


/** Guard distribution edits across shell links, router navigation, history and reload. */
export default function useDistributionUnsavedChanges(dirty, recovery = false, preferencePending = false) {
  const router = useRouter();
  useEffect(() => {
    if (!dirty) return undefined;
    let approvedDestination = null;
    const destinationKey = url => new URL(url, window.location.href).href;
    const clearApproval = () => { approvedDestination = null; };
    const allow = url => {
      const destination = destinationKey(url);
      if (approvedDestination === destination) return true;
      if (!window.confirm(recovery ? 'Leaving loses the local retry state for this email. Reconcile the original email before sending another. Leave this page?' : preferencePending ? 'A default wording change is pending or unconfirmed and may already be saved. Leave this page? Reload defaults before another change.' : 'Discard your unsaved email changes?')) return false;
      approvedDestination = destination;
      return true;
    };
    const beforeUnload = event => {
      event.preventDefault();
      event.returnValue = '';
    };
    const beforeRoute = (url, options) => {
      if (allow(url)) return;
      const error = Object.assign(new Error('Unsaved distribution email'), { cancelled: true });
      router.events.emit('routeChangeError', error, url, options);
      throw error;
    };
    const currentState = window.history.state;
    const currentUrl = window.location.href;
    router.beforePopState(({ as }) => {
      clearApproval();
      if (allow(as)) return true;
      // The browser has already moved its history cursor; restore the edited page.
      window.history.pushState(currentState, '', currentUrl);
      return false;
    });
    window.addEventListener('beforeunload', beforeUnload);
    router.events.on('routeChangeStart', beforeRoute);
    router.events.on('routeChangeComplete', clearApproval);
    router.events.on('routeChangeError', clearApproval);
    return () => {
      clearApproval();
      window.removeEventListener('beforeunload', beforeUnload);
      router.events.off('routeChangeStart', beforeRoute);
      router.events.off('routeChangeComplete', clearApproval);
      router.events.off('routeChangeError', clearApproval);
      router.beforePopState(() => true);
    };
  }, [dirty, recovery, preferencePending, router]);
}
