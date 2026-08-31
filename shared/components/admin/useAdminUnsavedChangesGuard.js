import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';

const GENERIC_WARNING = 'You have unsaved Admin changes. Leave without saving?';
const dirtyEditors = new Map();

let activeRouter = null;
let removeHandlers = null;

function currentWarning() {
  if (dirtyEditors.size !== 1) return GENERIC_WARNING;
  return dirtyEditors.values().next().value;
}

function confirmLeave() {
  return dirtyEditors.size === 0 || window.confirm(currentWarning());
}

function installHandlers(router) {
  let confirmedLinkNavigation = false;
  const beforeUnload = (event) => {
    if (confirmedLinkNavigation || dirtyEditors.size === 0) return;
    event.preventDefault();
    event.returnValue = '';
  };
  const linkClick = (event) => {
    if (dirtyEditors.size === 0 || event.defaultPrevented || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target?.closest?.('a[href]');
    if (!link || link.hasAttribute('download')) return;
    const target = link.getAttribute('target');
    const href = link.getAttribute('href');
    if ((target && target !== '_self') || !href || href.startsWith('#')) return;
    if (!confirmLeave()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    confirmedLinkNavigation = true;
    window.setTimeout(() => { confirmedLinkNavigation = false; }, 0);
  };

  window.addEventListener('beforeunload', beforeUnload);
  document.addEventListener('click', linkClick, true);
  router.beforePopState(confirmLeave);
  activeRouter = router;
  removeHandlers = () => {
    window.removeEventListener('beforeunload', beforeUnload);
    document.removeEventListener('click', linkClick, true);
    router.beforePopState(() => true);
    activeRouter = null;
    removeHandlers = null;
  };
}

function syncHandlers(router) {
  if (dirtyEditors.size === 0) {
    removeHandlers?.();
    return;
  }
  if (removeHandlers && activeRouter !== router) removeHandlers();
  if (!removeHandlers) installHandlers(router);
}

/** One composable guard for every independently editable Admin section. */
export default function useAdminUnsavedChangesGuard(isDirty, warning) {
  const router = useRouter();
  const editorId = useRef(Symbol('admin-editor'));

  useEffect(() => {
    if (isDirty) dirtyEditors.set(editorId.current, warning || GENERIC_WARNING);
    else dirtyEditors.delete(editorId.current);
    syncHandlers(router);

    return () => {
      dirtyEditors.delete(editorId.current);
      syncHandlers(router);
    };
  }, [isDirty, router, warning]);
}
