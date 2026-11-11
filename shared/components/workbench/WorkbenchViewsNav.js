import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { buildWorkbenchHref } from './workbench-location';
import { J27_PHASE_LABEL } from '../../config/j27Labels';

/**
 * View metadata registry — key, nav label, and a one-sentence description the
 * shell renders as the view intro. Order is the nav order and follows the
 * cycle's working sequence. Staff deliberations (the cycle-wide list of
 * Pre-Site Visit drafts) sits between Reviewer follow-up and Final writeups
 * (owner, 2026-09-09). Initial assessments stays registered but hidden for
 * D26 (owner, 2026-09-05; reconfirmed 2026-09-09 after a brief unhide — for
 * D26 it lists only pilot test rows). In J27 an Initial Assessment precedes
 * reviewer identification, so Initial assessments leads the nav (owner,
 * 2026-11-09); for D26 the hide rule below simply removes it, and Request
 * list stays the default view.
 */
export const VIEWS = {
  'initial-assessments': {
    label: 'Initial assessments',
    description: 'Track governed Initial Assessments and their lifecycle for the selected cycle.',
  },
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
    description: 'Review research presentation schedules, proposal discussion briefs, and draft writeups for the selected program and cycle.',
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

/**
 * J27 Research layout (2027-or-later cycles of the Research program): All
 * requests, then the request page's four phases, then Awardees
 * (docs/plans/J27_CYCLE_PAGE_REDESIGN_PLAN_2026-11-09.md). The Deliberations
 * and Final Assessment tabs mount today's Staff deliberations and Final
 * writeups panels until their own lists are built. Phase labels are the stage
 * strip's.
 */
export const J27_VIEWS = {
  requests: {
    label: 'All requests',
    description: 'Every request in this program and cycle, with where it stands and what is next.',
  },
  'initial-assessment': {
    label: J27_PHASE_LABEL['initial-assessment'],
    description: 'Requests being read, scored and recommended to the Chairs.',
  },
  'peer-review': {
    label: J27_PHASE_LABEL['peer-review'],
    description: 'Requests invited by the Chairs: reviewers, invitations and reports.',
  },
  deliberations: {
    label: J27_PHASE_LABEL.deliberations,
    description: 'Requests with a research presentation: schedule, attendance and the staff assessment.',
  },
  'final-assessment': {
    label: J27_PHASE_LABEL['final-assessment'],
    description: 'Requests with a Draft Writeup, or in group or leadership review.',
  },
  awardees: VIEWS.awardees,
};

const VIEW_LIST = Object.entries(VIEWS).map(([key, meta]) => ({ key, ...meta }));
const J27_VIEW_LIST = Object.entries(J27_VIEWS).map(([key, meta]) => ({ key, ...meta }));

// The four views that share the `scope` (my/all) URL key. Every other
// per-view key resets on a switch; scope is carried only among these.
// Final Assessment joined them when it became a request list over the shared rows:
// dropping the scope there reloaded the feed and changed every tab's count.
const SCOPE_VIEWS = new Set(['requests', 'reviewer-follow-up', 'staff-deliberations', 'awardees', 'initial-assessment', 'peer-review', 'deliberations', 'final-assessment']);

// Every view lives inside the shell page: links carry the shell's program and
// cycle and switch the view shallowly (per-view filters reset on a switch,
// except `scope`, preserved only among its three consumers above).
function hrefFor(view, cycleCode, programId, scope, scopeSet) {
  const carriesScope = SCOPE_VIEWS.has(view.key);
  return buildWorkbenchHref({
    view: view.key,
    programId,
    cycleCode,
    scope: carriesScope ? scope : undefined,
    scopeSet: carriesScope ? scopeSet : false,
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

/**
 * @param {object} props
 * @param {'legacy'|'j27'|'pending'} [props.layout] `pending` renders an empty
 *   bar while the shell does not yet know which layout the program uses, so
 *   tabs never flash from one set to the other.
 * @param {boolean} [props.scopeSet] the scope was chosen explicitly (J27 layout)
 */
export default function WorkbenchViewsNav({ activeKey, cycleCode, programId = '', scope = 'my', scopeSet = false, counts = {}, layout = 'legacy' }) {
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
        {layout === 'pending' && <span aria-hidden="true" className="min-h-11" />}
        {(layout === 'pending' ? [] : layout === 'j27' ? J27_VIEW_LIST : VIEW_LIST.filter((view) => visibleForCycle(view, cycleCode))).map((view) => {
          const active = resolvedActiveKey === view.key;
          const count = counts[view.key];
          return (
            <Link
              key={view.key}
              href={hrefFor(view, cycleCode, programId, scope, scopeSet)}
              shallow
              aria-current={active ? 'page' : undefined}
              className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-1 ${
                active
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900'
              }`}
            >
              {view.label}
              {Number.isFinite(count) && count > 0 && (
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
