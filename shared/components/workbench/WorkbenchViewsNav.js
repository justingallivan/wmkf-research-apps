import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { buildWorkbenchHref } from './workbench-location';

/**
 * View metadata registry — key, nav label, and a one-sentence description the
 * shell renders as the view intro. Order is the nav order and follows the
 * cycle's working sequence. Staff deliberations (the cycle-wide list of
 * Pre-Site Visit drafts) sits between Reviewer follow-up and Final writeups
 * (owner, 2026-09-09). Initial assessments stays registered but hidden for
 * D26 (owner, 2026-09-05; reconfirmed 2026-09-09 after a brief unhide — for
 * D26 it lists only pilot test rows); in J27 an Initial Assessment precedes
 * reviewer identification, so it moves left of Request list then and a Find
 * reviewers view surfaces alongside it. That reorder is J27 work, not this.
 */
export const VIEWS = {
  requests: {
    label: 'Request list',
    description: 'Triage requests and open reviewer work for the selected program and cycle.',
  },
  'reviewer-follow-up': {
    label: 'Reviewer follow-up',
    description: 'Track invitations, overdue reviews, and received reviews for the selected program and cycle.',
  },
  'staff-deliberations': {
    label: 'Staff deliberations',
    description: 'Review visit schedules, briefings, and post-visit preparation for the selected program and cycle.',
  },
  'initial-assessments': {
    label: 'Initial assessments',
    description: 'Track governed Initial Assessments and their lifecycle for the selected cycle.',
  },
  'final-writeups': {
    label: 'Final writeups',
    description: 'Review current writeups and acknowledge the latest versions.',
  },
  awardees: {
    label: 'Awardees',
    description: 'Track grantee deliverables for research awardees in the selected cycle.',
  },
};

const VIEW_LIST = Object.entries(VIEWS).map(([key, meta]) => ({ key, ...meta }));

// The four views that share the `scope` (my/all) URL key. Every other
// per-view key resets on a switch; scope is carried only among these.
const SCOPE_VIEWS = new Set(['requests', 'reviewer-follow-up', 'staff-deliberations', 'awardees']);

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
    <nav ref={scrollerRef} aria-label="Workbench views" className="mb-4 overflow-x-auto border-b border-gray-200">
      <div className="flex min-w-max items-stretch gap-1">
        {VIEW_LIST.filter((view) => visibleForCycle(view, cycleCode)).map((view) => {
          const active = resolvedActiveKey === view.key;
          const count = counts[view.key];
          return (
            <Link
              key={view.key}
              href={hrefFor(view, cycleCode, programId, scope)}
              shallow
              aria-current={active ? 'page' : undefined}
              className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-1 ${
                active
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900'
              }`}
            >
              {view.label}
              {Number.isFinite(count) && (
                <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-amber-50 px-1.5 py-0.5 text-xs tabular-nums text-amber-900">
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
