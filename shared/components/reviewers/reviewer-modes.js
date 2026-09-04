/**
 * reviewer-modes — pure (React-free) logic for the reviewer management surface.
 *
 * Extracted so the status pipeline, the sub-tab mode→status bucketing, the
 * state-aware default landing, and the fail-closed canManage display logic can be unit-tested
 * without rendering any component. Imported by ReviewerManagePanel,
 * SubTabBadges, ReviewersTab, and the Workbench shell. See
 * docs/REQUEST_WORKBENCH_BUILD_PLAN.md § Phase 2.
 */

// The full reviewer lifecycle, in order. Every wmkf_reviewstatus the API can
// return (REVIEW_STATUS_BY_VALUE in lib/services/review-manager/reviewers-service.js) MUST
// have a key here, and MUST land in exactly one MODE_STATUSES bucket — otherwise
// a reviewer in that state would vanish from all sub-tabs. The
// reviewer-modes.test.js "no fallthrough" assertion enforces this invariant.
export const STATUS_PIPELINE = [
  { key: 'accepted', label: 'Accepted', color: 'bg-blue-100 text-blue-800' },
  { key: 'materials_sent', label: 'Materials Sent', color: 'bg-indigo-100 text-indigo-800' },
  { key: 'under_review', label: 'Under Review', color: 'bg-yellow-100 text-yellow-800' },
  { key: 'review_received', label: 'Review Received', color: 'bg-green-100 text-green-800' },
  { key: 'complete', label: 'Complete', color: 'bg-green-200 text-green-900' },
  { key: 'withdrew', label: 'Withdrew', color: 'bg-red-100 text-red-800' },
  { key: 'released', label: 'Released', color: 'bg-slate-100 text-slate-700' },
];

export function getStatusInfo(status) {
  return STATUS_PIPELINE.find(s => s.key === status) || STATUS_PIPELINE[0];
}

// Which reviewStatus values the Workbench tracking sub-tab surfaces. The
// buckets must partition every STATUS_PIPELINE key (complete coverage, no
// overlap).
export const MODE_STATUSES = {
  track: ['accepted', 'materials_sent', 'under_review', 'review_received', 'complete', 'withdrew', 'released'],
};

// Reviewers a mode still has open work for (drives the work-remaining badge).
// Track open work: accepted reviewers still need materials, and sent reviewers
// still need a review returned.
export const MODE_WORK_REMAINING = {
  track: ['accepted', 'materials_sent', 'under_review'],
};

export const TERMINAL_REVIEW_STATUSES = ['withdrew', 'released'];
const TERMINAL_SOURCE_STATUSES = ['accepted', 'materials_sent', 'under_review'];

export function canTransitionToTerminal(reviewer) {
  return Boolean(
    reviewer
    && TERMINAL_SOURCE_STATUSES.includes(reviewer.reviewStatus)
    && !reviewer.reviewReceivedAt
    && reviewer.submitted !== true,
  );
}

export function filterByMode(reviewers, mode) {
  if (!mode || mode === 'all') return reviewers || [];
  const statuses = MODE_STATUSES[mode];
  if (!statuses) return reviewers || [];
  return (reviewers || []).filter(r => statuses.includes(r.reviewStatus));
}

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

// State-aware default sub-tab: drop staff into Track whenever any post-
// acceptance reviewer exists; otherwise (no reviewers) the Find tab, where
// reviewer-finding starts.
export function computeDefaultSub(reviewers) {
  if (workRemainingForMode(reviewers, 'track') > 0) return 'track';
  if (countForMode(reviewers, 'track') > 0) return 'track';
  return 'find';
}

/**
 * Fail-closed display gate for request-owner controls: lead PD or superuser.
 * Mutation routes independently enforce server authorization and never trust
 * this client-side value. GUID case does not affect the comparison.
 */
export function computeCanManage({ isSuperuser = false, pdId = null, myUserId = null } = {}) {
  if (isSuperuser) return true;
  if (!pdId || !myUserId) return false;
  return String(myUserId).toLowerCase() === String(pdId).toLowerCase();
}
