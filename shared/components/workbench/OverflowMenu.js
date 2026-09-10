/**
 * Small "More" overflow menu for Workbench action rows (Staff Deliberations
 * tab redesign, docs/plans/STAFF_DELIBERATIONS_TAB_SHAPE_BRIEF_2026-09-09.md).
 * Mirrors the reviewer screens' portalled, outside-click-closing, upward-
 * flipping pattern (shared/components/reviewers/TokenActionsMenu.js) without
 * their reviewer-specific items; those copies are left as they are.
 *
 * items: [{ key, label, onSelect?, href?, download?, disabled?, title? }]
 * An item with `href` renders as a link (new tab unless `download`), the rest
 * as buttons. The trigger is the standard ellipsis, labelled by `label`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MENU_WIDTH = 224; // w-56
const ROW_HEIGHT = 40;

export default function OverflowMenu({ label = 'More actions', items = [], disabled = false }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const visible = items.filter(Boolean);
  const estimatedMenuHeight = visible.length * ROW_HEIGHT + 8;

  const place = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const openUp = rect.bottom + estimatedMenuHeight > window.innerHeight
      && rect.top > estimatedMenuHeight;
    setCoords({
      left: Math.max(8, rect.right - MENU_WIDTH),
      top: openUp ? rect.top - estimatedMenuHeight - 4 : rect.bottom + 4,
    });
  }, [estimatedMenuHeight]);

  useEffect(() => {
    if (!open) return undefined;
    place();
    const onDocClick = (event) => {
      if (btnRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    const onReflow = () => setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open, place]);

  if (visible.length === 0) return null;
  const itemClass = 'block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-white';

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
        </svg>
      </button>
      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          style={{ position: 'fixed', left: coords.left, top: coords.top, width: MENU_WIDTH }}
          className="z-50 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {visible.map((item) => (
            item.href ? (
              <a
                key={item.key}
                role="menuitem"
                href={item.href}
                download={item.download || undefined}
                target={item.download ? undefined : '_blank'}
                rel={item.download ? undefined : 'noopener noreferrer'}
                title={item.title || undefined}
                onClick={() => setOpen(false)}
                className={itemClass}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.key}
                role="menuitem"
                type="button"
                disabled={item.disabled}
                title={item.title || undefined}
                onClick={() => { setOpen(false); item.onSelect?.(); }}
                className={itemClass}
              >
                {item.label}
              </button>
            )
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
