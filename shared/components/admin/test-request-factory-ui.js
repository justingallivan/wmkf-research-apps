/**
 * Class strings and tiny formatters shared by the Test Request Factory form
 * components. They copy the idioms in TestRequestPreviewSection.js (primary
 * button, input, error band); nothing here is a component.
 */

export const PRIMARY_BUTTON = 'min-h-11 rounded-lg bg-gray-950 px-5 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
export const OUTLINE_BUTTON = 'min-h-11 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
export const INPUT = 'mt-2 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-normal text-gray-950 outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500';
/** Props for a button that is the one primary action (marked for tests and assistive review) or an outline one. */
export const buttonProps = (primary) => (primary ? { className: PRIMARY_BUTTON, 'data-primary': 'true' } : { className: OUTLINE_BUTTON });
export const SUMMARY_CLASS = 'inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 rounded-lg';

/** Moves focus to an element and keeps it in view (jsdom has no scrollIntoView). */
export function focusAndShow(element) {
  if (!element) return;
  element.focus({ preventScroll: true });
  if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest', behavior: 'auto' });
}

export const ERROR_BAND = 'rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800';
export const TABLE_WRAP = 'overflow-x-auto rounded-xl border border-gray-200';
export const TH = 'px-4 py-3';

export function formatBytes(value) {
  if (!Number.isFinite(value)) return 'Unknown size';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTime(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}
