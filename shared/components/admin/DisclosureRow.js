/**
 * One disclosure primitive for the Messages & policies admin page (Build E,
 * Item 1): a native <details>/<summary> row used at every depth — the panel
 * level (via AdminEditorPanel's collapsible variant), email audience groups,
 * each policy slot, and policy version history.
 *
 * Chevron rotation uses a Tailwind *named* group per disclosure depth so a
 * nested disclosure's chevron only reacts to its own open state, never an
 * ancestor's. Tailwind only generates CSS for class strings it can see
 * literally in source, so the group/chevron pairs are a closed, hard-coded
 * map — never string-interpolated — and `groupName` must be one of its keys.
 *
 * Prop surface extends the brief's `{ id, title, meta, description,
 * defaultOpen, groupName, children, headingLevel }` with two additions the
 * brief's callers need and didn't name: `titleAdornment` (e.g. the panel's
 * SettingScopeBadge — rendered next to the heading but never inside it, so
 * it never pollutes the heading's accessible name) and `actions` (right-
 * aligned interactive content such as the field-mapping info button — the
 * caller is responsible for guarding it against toggling the summary. A
 * bubble-phase `onClick={(e) => e.preventDefault()}` is not enough once the
 * guarded content (e.g. a popover) calls `stopPropagation()` itself, since
 * that cuts the bubble off before it reaches the guard; use
 * `onClickCapture={(e) => e.preventDefault()}` instead, which runs before
 * any of that and sets `defaultPrevented` regardless of what happens after.
 */
const GROUP_CLASSES = {
  panel: { details: 'group/panel', chevron: 'group-open/panel:rotate-180' },
  audience: { details: 'group/audience', chevron: 'group-open/audience:rotate-180' },
  slot: { details: 'group/slot', chevron: 'group-open/slot:rotate-180' },
  history: { details: 'group/history', chevron: 'group-open/history:rotate-180' },
  current: { details: 'group/current', chevron: 'group-open/current:rotate-180' },
};

const HEADING_TAGS = { 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5' };
const HEADING_CLASSES = {
  2: 'text-lg font-semibold text-gray-950',
  3: 'text-sm font-semibold text-gray-900',
  4: 'text-sm font-semibold text-gray-900',
  5: 'text-sm font-semibold text-gray-900',
};
// The panel level (h2) needs the roomier padding/border the old bespoke
// AdminEditorPanel markup used; nested rows (audience/slot/history) stay compact.
const SUMMARY_PADDING = { 2: 'px-5 py-5 sm:px-6' };
const BODY_CLASSES = { 2: 'border-t border-gray-200 px-5 py-5 sm:px-6' };

export default function DisclosureRow({
  id,
  title,
  titleAdornment,
  meta,
  description,
  defaultOpen = false,
  groupName,
  children,
  headingLevel = 3,
  actions,
}) {
  const groupClasses = GROUP_CLASSES[groupName];
  if (!groupClasses) {
    throw new Error(`DisclosureRow: unknown groupName "${groupName}" — add it to GROUP_CLASSES`);
  }
  const HeadingTag = HEADING_TAGS[headingLevel] || 'h3';
  const headingClass = HEADING_CLASSES[headingLevel] || HEADING_CLASSES[3];
  const summaryPadding = SUMMARY_PADDING[headingLevel] || 'px-2 py-2';
  const bodyClass = BODY_CLASSES[headingLevel] || 'px-2 pb-2 pt-1';
  const titleId = id ? `${id}-title` : undefined;

  return (
    <details className={groupClasses.details} open={defaultOpen || undefined} data-disclosure-id={id}>
      <summary
        aria-labelledby={titleId}
        className={`flex cursor-pointer list-none flex-col gap-3 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 [&::-webkit-details-marker]:hidden sm:flex-row sm:items-start sm:justify-between ${summaryPadding}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <HeadingTag id={titleId} className={headingClass}>{title}</HeadingTag>
            {titleAdornment}
          </div>
          {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {meta && <span className="whitespace-nowrap text-xs text-gray-500">{meta}</span>}
          {actions}
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${groupClasses.chevron}`}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 7.5 5 5 5-5" />
          </svg>
        </div>
      </summary>
      <div className={bodyClass}>{children}</div>
    </details>
  );
}
