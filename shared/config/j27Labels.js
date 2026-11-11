/**
 * Staff-facing labels for the J27 Research stage model, in one place so the
 * request page's stage strip and the cycle page's request lists cannot name a
 * phase, task, blocker, outcome or standing differently
 * (docs/plans/J27_CYCLE_PAGE_REDESIGN_PLAN_2026-11-09.md, rule 14).
 *
 * The first four maps are pinned to the read model's vocabularies in
 * tests/unit/j27-page-stage.test.js; the rest in tests/unit/j27-cycle-rows.test.js.
 */

export const J27_PHASE_LABEL = {
  'initial-assessment': 'Initial Assessment',
  'peer-review': 'Peer Review',
  deliberations: 'Deliberations',
  'final-assessment': 'Final Assessment',
  decided: 'Decided',
  unclassified: 'Not classified',
};

export const J27_TASK_LABEL = {
  'record-rationale': 'Record the staff rationale',
  'record-scoring': 'Record Scored or Not Scored',
  'record-chairs-recommendation': 'Record the recommendation to Chairs',
  'review-integrity': 'Review the integrity findings',
  'identify-reviewers': 'Identify reviewers',
  'send-invitations': 'Send reviewer invitations',
  'read-reports': 'Read the reviewer reports',
  'record-offramp': 'Record an offramp decision if one is needed',
  'confirm-roster': 'Confirm presentation attendance',
  'write-visit-assessment': 'Write the staff presentation assessment',
  'write-board-draft': 'Write the Draft Writeup',
  'start-group-review': 'Start group review',
};

export const J27_BLOCKER_LABEL = {
  'chairs-outcome-pending': 'Reviewer invitations wait for the Chairs’ outcome',
  'phase-two-status-pending': 'Reviewer invitations open once the Phase II status is Pending Committee Review',
  'integrity-unreviewed': 'Integrity findings need a Program Director’s review before invitations or scheduling',
  offramped: 'This request took the offramp; it is not invited or presented',
  'presentation-not-ended': 'Group review starts after the presentation ends',
  'presentation-end-unverified': 'The presentation’s end has not been verified yet',
  'presentation-schedule-unavailable': 'The presentation schedule could not be read',
  'evidence-stale': 'Reviewer reports changed after the staff summary was saved',
  'roster-stale': 'The confirmed attendance no longer matches the presentation',
};

export const J27_OUTCOME_LABEL = {
  none: null,
  'not-scored': 'Not Scored',
  'not-recommended': 'Not Recommended',
  'not-invited': 'Not Invited',
  offramped: 'Offramped',
  'decided-award': 'Awarded',
  'decided-no-award': 'Not awarded',
  withdrawn: 'Withdrawn',
};

/** Where an open Initial Assessment request stands (cycle page chip and filter). */
export const J27_STANDING_LABEL = {
  'not-yet-scored': 'Not yet scored',
  scored: 'Scored',
  recommended: 'Recommended to Chairs',
};

/** The reviewer stage on a Peer Review row; keys are the dashboard's `workRemaining`. */
export const J27_REVIEWER_STAGE_LABEL = {
  find: 'Find reviewers',
  invite: 'Invite reviewers',
  awaiting: 'Awaiting replies',
  review: 'In review',
  done: 'Sufficient coverage',
};

/** A quiet status line for a request that is waiting; keyed by the blocker that causes the wait. */
export const J27_WAIT_LABEL = {
  'chairs-outcome-pending': 'Awaiting the Chairs’ outcome',
  'phase-two-status-pending': 'Reviewer invitations are not open yet',
};

export const J27_IDLE_LABEL = 'Nothing is waiting on staff right now.';
export const J27_DEGRADED_NOTE = 'Some details could not be read.';
/** Shown once above the list when every request is affected, in place of the note on each row. */
export const J27_DEGRADED_LIST_NOTE = 'Some details could not be read for these requests.';
