/**
 * One finished-work row on the Site Visit page (docs/plans/SITE_VISIT_PAGE_REDESIGN_PLAN_2026-10-10.md §4):
 * the artifact's name is the link, then a status chip, a short detail, and either an inline action or a "…" menu.
 * Anything the row needs below it (a confirmation, an open editor, a notice) is passed as children.
 */
import OverflowMenu from '../workbench/OverflowMenu';

const STATUS_TONES = Object.freeze({
  green: 'bg-green-50 text-green-800',
  amber: 'bg-amber-50 text-amber-900',
  blue: 'bg-blue-50 text-blue-800',
  red: 'bg-red-50 text-red-800',
  gray: 'bg-gray-100 text-gray-700',
});

export default function ArtifactRow({ name, href = null, status = null, detail = null, action = null, menuItems = [], testId, children }) {
  return (
    <li className="py-3" data-testid={testId}>
      <div className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 md:grid-cols-[minmax(12rem,15rem)_9rem_minmax(0,1fr)_auto]">
        <div className="min-w-0 break-words text-sm font-semibold text-gray-950">
          {href
            ? <a href={href} target="_blank" rel="noopener noreferrer" className="rounded-sm underline decoration-gray-300 underline-offset-4 hover:decoration-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{name}</a>
            : name}
        </div>
        <div>
          {status && <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONES[status.tone] || STATUS_TONES.gray}`}>{status.label}</span>}
        </div>
        <div className="col-span-2 min-w-0 text-sm tabular-nums text-gray-600 md:col-span-1">{detail}</div>
        <div className="col-span-2 flex items-center justify-start gap-2 md:col-span-1 md:justify-end">
          {action}
          <OverflowMenu label={`More actions for ${String(name).toLowerCase()}`} items={menuItems} />
        </div>
      </div>
      {children}
    </li>
  );
}
