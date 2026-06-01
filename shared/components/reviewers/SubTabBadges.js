/**
 * SubTabBadges — work-remaining badge primitives for the Reviewers sub-tabs.
 *
 * Each management sub-tab (Invite / Track / Completed) carries a count badge.
 * "Work remaining" (reviewers still needing action this stage) shows amber;
 * a stage with reviewers but no open work shows neutral gray; an empty stage
 * shows nothing. Counts derive from the same MODE_* maps the panel filters on,
 * so the badge and the table can never disagree.
 */

import { MODE_STATUSES, MODE_WORK_REMAINING } from './ReviewerManagePanel';

/** Reviewers visible under a given mode. */
export function countForMode(reviewers, mode) {
  const statuses = MODE_STATUSES[mode];
  if (!statuses) return (reviewers || []).length;
  return (reviewers || []).filter(r => statuses.includes(r.reviewStatus)).length;
}

/** Reviewers under a mode that still need staff action. */
export function workRemainingForMode(reviewers, mode) {
  const statuses = MODE_WORK_REMAINING[mode];
  if (!statuses || statuses.length === 0) return 0;
  return (reviewers || []).filter(r => statuses.includes(r.reviewStatus)).length;
}

/**
 * A single sub-tab count badge.
 *   count          — total reviewers in this stage
 *   workRemaining  — subset still needing action (amber when > 0)
 */
export function SubTabBadge({ count = 0, workRemaining = 0 }) {
  if (!count) return null;
  const amber = workRemaining > 0;
  return (
    <span
      className={`ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] px-1.5 py-0.5 text-xs font-medium rounded-full ${
        amber ? 'bg-amber-100 text-amber-800' : 'bg-gray-200 text-gray-600'
      }`}
      title={amber ? `${workRemaining} awaiting action` : `${count} in this stage`}
    >
      {count}
    </span>
  );
}

export default SubTabBadge;
