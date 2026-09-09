import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { buildWorkbenchHref } from './workbench-location';

const VIEWS = [
  { key: 'requests', label: 'Request list' },
  { key: 'initial-assessments', label: 'Initial assessments' },
  { key: 'reviewer-follow-up', label: 'Reviewer follow-up' },
  { key: 'final-writeups', label: 'Final writeups' },
  { key: 'awardees', label: 'Awardees' },
];

// Every view lives inside the shell page: links carry the shell's program and
// cycle and switch the view shallowly (per-view filters reset on a switch).
function hrefFor(view, cycleCode, programId) {
  return buildWorkbenchHref({ view: view.key, programId, cycleCode });
}

// Initial Assessments are not part of the D26 dual-phase workflow (owner
// decision 2026-09-05). The cycle is unknown until the page's first fetch
// resolves it, so a cycle-conditional view stays hidden until then rather
// than flashing in and out on load; unconditional views render immediately.
function visibleForCycle(view, cycleCode) {
  if (view.key !== 'initial-assessments') return true;
  if (!cycleCode) return false;
  return cycleCode !== 'D26';
}

export default function WorkbenchViewsNav({ activeKey, cycleCode, programId = '', counts = {} }) {
  const resolvedActiveKey = activeKey;
  const scrollerRef = useRef(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const activeLink = scroller?.querySelector('[aria-current="page"]');
    if (!scroller || !activeLink || scroller.scrollWidth <= scroller.clientWidth) return;
    scroller.scrollLeft = Math.max(
      0,
      activeLink.offsetLeft - (scroller.clientWidth - activeLink.offsetWidth) / 2,
    );
  }, [resolvedActiveKey]);

  return (
    <nav ref={scrollerRef} aria-label="Workbench views" className="mb-6 overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex min-w-max items-stretch p-1.5">
        {VIEWS.filter((view) => visibleForCycle(view, cycleCode)).map((view) => {
          const active = resolvedActiveKey === view.key;
          const count = counts[view.key];
          return (
            <Link
              key={view.key}
              href={hrefFor(view, cycleCode, programId)}
              shallow
              aria-current={active ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-1 ${
                active
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {view.label}
              {Number.isFinite(count) && (
                <span
                  className={`inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                    active ? 'bg-amber-100 text-amber-900' : 'bg-amber-50 text-amber-900'
                  }`}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
