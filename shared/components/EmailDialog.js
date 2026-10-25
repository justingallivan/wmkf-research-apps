/** Native modal shell only; each workflow owns its close/write/async policy. */
import { useEffect, useRef } from 'react';

let scrollLocks = 0;
let previousOverflow = '';
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export default function EmailDialog({ children, label, onClose, busy = false, initialFocusSelector }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const node = dialogRef.current;
    const opener = document.activeElement;
    if (!node.open) node.showModal();
    if (scrollLocks++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    const buttons = [...node.querySelectorAll('button:not([disabled])')];
    const initial = (initialFocusSelector && node.querySelector(initialFocusSelector)) || buttons.find((button) => /^(close|cancel)$/i.test(button.getAttribute('aria-label') || button.textContent.trim()))
      || node.querySelector(FOCUSABLE) || node;
    initial.focus();
    return () => {
      if (node.open) node.close();
      if (--scrollLocks === 0) document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return <dialog ref={dialogRef} aria-modal="true" aria-label={label} tabIndex={-1}
    className="email-dialog fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none border-0 bg-transparent p-0 text-gray-900"
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose?.(); }}
    onKeyDown={(event) => {
      if (event.key !== 'Tab' || event.defaultPrevented || event.target.closest('dialog') !== event.currentTarget) return;
      const node = dialogRef.current;
      const fields = [...node.querySelectorAll(FOCUSABLE)].filter((field) => field.getClientRects().length && !field.closest('dialog:not([open])'));
      if (!fields.length) { event.preventDefault(); node.focus(); return; }
      const first = fields[0], last = fields[fields.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
    <style>{'.email-dialog::backdrop { background: transparent; }'}</style>
    {children}
  </dialog>;
}
