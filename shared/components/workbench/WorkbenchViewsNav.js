import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { buildWorkbenchHref } from './workbench-location';

/**
 * View metadata registry — key, nav label, and (for the four views that get a
 * shell-rendered intro) a one-sentence description. Initial assessments stays
 * in the registry for the nav but carries no description: it is hidden for
 * D26 by design and gets its own top matter in the later J27 redesign, so the
 * shell renders no intro for it this pass.
 */
export const VIEWS = {
  requests: {
    label: 'Request list',
    description: 'Triage requests and open reviewer work for the selected program and cycle.',
  },
  'initial-assessments': {
    label: 'Initial assessments',
  },
  'reviewer-follow-up': {
    label: 'Reviewer follow-up',
    description: 'Track invitations, overdue reviews, and received reviews for the selected program and cycle.',
  },
  'final-writeups': {
    label: 'Final writeups',
    description: 'Review current writeups and acknowledge the latest versions.',
  },
  awardees: {
    label: 'Awardees',
    description: 'Track grantee deliverables for awardees in the selected program and cycle.',
  },
};

const VIEW_LIST = Object.entries(VIEWS).map(([key, meta]) => ({ key, ...meta }));

// The three views that share the `scope` (my/all) URL key. Every other
// per-view key resets on a switch; scope is carried only among these.
const SCOPE_VIEWS = new Set(['requests', 'reviewer-follow-up', 'awardees']);

// Every view lives inside the shell page: links carry the shell's program and
// cycle and switch the view shallowly (per-view filters reset on a switch,
// except `scope`, preserved only among its three consumers above).
function hrefFor(view, cycleCode, programId, scope) {
  return buildWorkbenchHref({
    view: view.key,
    programId,
    cycleCode,
    scope: SCOPE_VIEWS.has(view.key) ? scope : undefined,
  });
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

export default function WorkbenchViewsNav({ activeKey, cycleCode, programId = '', scope = 'my', counts = {} }) {
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
        {VIEW_LIST.filter((view) => visibleForCycle(view, cycleCode)).map((view) => {
          const active = resolvedActiveKey === view.key;
          const count = counts[view.key];
          return (
            <Link
              key={view.key}
              href={hrefFor(view, cycleCode, programId, scope)}
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
