/**
 * Policy acknowledgment modal — opens from a Stage 2a policy card, renders
 * the active version's body, and exposes a single "I have read and
 * acknowledge" action that's gated by scroll-to-bottom.
 *
 * Interaction:
 *   - Acknowledge button starts disabled with label "Scroll to acknowledge".
 *   - Enabled when the body container scrolls within `BOTTOM_THRESHOLD_PX`
 *     of the bottom, OR immediately if the body fits without overflow.
 *   - Re-checks overflow on viewport resize, font-size changes, and after
 *     first markdown render — first-paint measurement alone is fragile.
 *   - Closing the modal without acknowledging does NOT change the parent
 *     card's state.
 *   - Re-opening an already-acknowledged policy renders read-only with a
 *     close button.
 *
 * Form-factor target: desktop / laptop / iPad. Tailwind defaults handle
 * mobile gracefully but layout is not optimized for narrow viewports.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { renderPolicyMarkdown } from '../../utils/policy-markdown-client';

const BOTTOM_THRESHOLD_PX = 24;

export default function PolicyAckModal({
  policy,        // { slotCode, activeVersionId, versionLabel, title, body }
  isAcknowledged,
  onAcknowledge, // () => void; called when user clicks the ack button
  onClose,       // () => void; called when user clicks Cancel or the close X
}) {
  const [canAcknowledge, setCanAcknowledge] = useState(false);
  const bodyRef = useRef(null);
  const headingRef = useRef(null);

  const checkScrollPosition = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    // If body fits without needing to scroll, enable ack immediately.
    if (el.scrollHeight <= el.clientHeight + 1) {
      setCanAcknowledge(true);
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom <= BOTTOM_THRESHOLD_PX) {
      setCanAcknowledge(true);
    }
  }, []);

  // Re-check on mount, after any layout shift (markdown render, font load),
  // viewport resize, and scroll. ResizeObserver covers font-size changes
  // and any DOM-induced reflow inside the body.
  useEffect(() => {
    if (isAcknowledged) {
      // Re-opened in read-only mode; don't gate anything.
      setCanAcknowledge(true);
      return;
    }
    checkScrollPosition(); // initial measurement

    const el = bodyRef.current;
    if (!el) return;

    const onScroll = () => checkScrollPosition();
    el.addEventListener('scroll', onScroll, { passive: true });

    const ro = new ResizeObserver(() => checkScrollPosition());
    ro.observe(el);

    const onWindowResize = () => checkScrollPosition();
    window.addEventListener('resize', onWindowResize);

    // Re-check once more after a tick, in case content height settles after
    // initial paint (markdown rendering, web-font swap, etc.).
    const settleTimer = setTimeout(checkScrollPosition, 100);

    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      window.removeEventListener('resize', onWindowResize);
      clearTimeout(settleTimer);
    };
  }, [checkScrollPosition, isAcknowledged]);

  // Move screen-reader focus to the heading when the modal opens.
  useEffect(() => {
    if (headingRef.current) {
      headingRef.current.focus();
    }
  }, []);

  // Escape key closes (matches expected modal behavior).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="policy-modal-heading"
    >
      <div
        className="absolute inset-0 bg-gray-900/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 border-b border-gray-200">
          <h2
            id="policy-modal-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-semibold text-gray-900 outline-none"
          >
            {policy.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 text-xl leading-none flex-shrink-0"
          >
            ×
          </button>
        </div>

        <div
          ref={bodyRef}
          className="px-6 py-4 overflow-y-auto flex-1 text-sm text-gray-800 leading-relaxed prose prose-sm max-w-none"
          tabIndex={0}
          dangerouslySetInnerHTML={/* nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml -- renderPolicyMarkdown sanitizes via DOMPurify strict allowlist; server validator rejects raw HTML */ { __html: renderPolicyMarkdown(policy.body || '') }}
        />


        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 px-6 py-4 border-t border-gray-200">
          <p className="text-xs text-gray-500 sm:flex-shrink-0">
            Version {policy.versionLabel}
          </p>
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-sm text-gray-700 hover:text-gray-900"
            >
              {isAcknowledged ? 'Close' : 'Cancel'}
            </button>
            {!isAcknowledged && (
              <button
                type="button"
                onClick={onAcknowledge}
                disabled={!canAcknowledge}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {canAcknowledge ? 'I have read and acknowledge' : 'Scroll to acknowledge'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
