/**
 * Row rules for the J27 Research cycle page (build plan
 * docs/plans/J27_CYCLE_PAGE_BUILD_PLAN_2026-11-09.md, section 2). Pure
 * functions over the dashboard's proposal rows (`row.j27` is the slim stage
 * the server derives per row); nothing here fetches or derives a stage.
 *
 * One list component renders every request tab, so the chip, the line under
 * it, the filters and the tab counts are all decided here.
 */
import { J27_TASKS } from '../../lib/services/workbench/j27-read-model';
import {
  J27_DEGRADED_NOTE, J27_IDLE_LABEL, J27_OUTCOME_LABEL, J27_PHASE_LABEL, J27_REVIEWER_STAGE_LABEL,
  J27_REVIEW_STANDING_LABEL, J27_STANDING_LABEL, J27_TASK_LABEL, J27_TIMING_LABEL, J27_WAIT_LABEL,
} from '../config/j27Labels';

/** Tabs whose list is a phase filter over the shared rows. */
export const J27_PHASE_TABS = Object.freeze(['initial-assessment', 'peer-review', 'deliberations', 'final-assessment']);

/** "Showing" menu on All requests: open (default), everything, then each ending. */
export const J27_SHOWING_KEYS = Object.freeze([
  'open', 'everything', 'not-scored', 'not-recommended', 'not-invited', 'offramped', 'decided-no-award', 'withdrawn', 'decided-award',
]);
export const J27_SHOWING_LABEL = Object.freeze({
  open: 'Open requests',
  everything: 'Everything',
  ...Object.fromEntries(J27_SHOWING_KEYS.slice(2).map((key) => [key, J27_OUTCOME_LABEL[key]])),
});

export const J27_STANDING_KEYS = Object.freeze(Object.keys(J27_STANDING_LABEL));

const OPTIONAL_TASKS = new Set(J27_TASKS.filter((task) => task.secondary).map((task) => task.key));
const stageOf = (row) => (row && row.j27 && typeof row.j27 === 'object' ? row.j27 : null);

/**
 * A request with no forward work: a terminal outcome, or a Phase I status the
 * stage model does not map (owner decision 1: Incomplete, Ineligible, Proposal
 * Late, Rescinded Grant, Request Withdrawn, Deferred are treated as closed).
 */
export function isClosedRow(row) {
  const stage = stageOf(row);
  if (!stage) return false;
  return (stage.outcome && stage.outcome !== 'none') || stage.recorded?.unmapped === true;
}

/** Initial Assessment standing of an open row, or null outside that phase. */
export function standingKey(row) {
  const stage = stageOf(row);
  if (!stage || stage.phase !== 'initial-assessment' || isClosedRow(row)) return null;
  if (stage.recorded?.chairsRecommendation === 'yes') return 'recommended';
  if (stage.recorded?.scoring === 'scored') return 'scored';
  return 'not-yet-scored';
}

/**
 * The chip: where the request stands. `kind` lets the row pick a tone without
 * knowing the vocabulary. Returns null when the row carries no stage.
 */
export function rowChip(row) {
  const stage = stageOf(row);
  if (!stage) return null;
  if (isClosedRow(row)) {
    const label = stage.outcome && stage.outcome !== 'none'
      ? J27_OUTCOME_LABEL[stage.outcome]
      : stage.recorded?.label;
    return { kind: 'closed', key: stage.outcome && stage.outcome !== 'none' ? stage.outcome : 'unmapped', label: label || 'Closed' };
  }
  if (stage.phase === 'initial-assessment') {
    const key = standingKey(row);
    return { kind: 'standing', key, label: J27_STANDING_LABEL[key] };
  }
  if (stage.phase === 'peer-review' && J27_REVIEWER_STAGE_LABEL[row.workRemaining]) {
    return { kind: 'reviewer-stage', key: row.workRemaining, label: J27_REVIEWER_STAGE_LABEL[row.workRemaining] };
  }
  // The later phases show what the feed knows; an unknown fact falls through to the phase name.
  if (stage.phase === 'deliberations' && J27_TIMING_LABEL[stage.timing]) {
    return { kind: 'timing', key: stage.timing, label: J27_TIMING_LABEL[stage.timing] };
  }
  if (stage.phase === 'final-assessment' && J27_REVIEW_STANDING_LABEL[stage.review]) {
    return { kind: 'review', key: stage.review, label: J27_REVIEW_STANDING_LABEL[stage.review] };
  }
  return { kind: 'phase', key: stage.phase, label: J27_PHASE_LABEL[stage.phase] || stage.phase };
}

/**
 * The line under the chip, in the plan's order:
 * closed → nothing; a main task → "Next"; waiting on the Chairs; Identify
 * reviewers on a Peer Review row; waiting on the Phase II status; idle
 * (said only when no read failed).
 * The optional offramp task never leads a row.
 */
export function rowLine(row) {
  const stage = stageOf(row);
  if (!stage || isClosedRow(row)) return { kind: 'none', text: null };
  // Owner decision (build plan 3; later-phase lists plan 2): until its
  // presentation has ended a Deliberations row shows the timing chip and no
  // line at all, including work left over from Peer Review.
  if (stage.phase === 'deliberations' && stage.timing !== 'after') return { kind: 'none', text: null };
  const taskKeys = Array.isArray(stage.taskKeys) ? stage.taskKeys : [];
  const blockerKeys = Array.isArray(stage.blockerKeys) ? stage.blockerKeys : [];
  // The model's primary task is already the first main task when one exists.
  const main = stage.primaryTask && !OPTIONAL_TASKS.has(stage.primaryTask)
    ? stage.primaryTask
    : taskKeys.find((key) => !OPTIONAL_TASKS.has(key)) || null;
  if (main) return { kind: 'next', key: main, text: J27_TASK_LABEL[main] || main };
  if (blockerKeys.includes('chairs-outcome-pending')) {
    return { kind: 'wait', key: 'chairs-outcome-pending', text: J27_WAIT_LABEL['chairs-outcome-pending'] };
  }
  if (stage.phase === 'peer-review' && taskKeys.includes('identify-reviewers')) {
    return { kind: 'next', key: 'identify-reviewers', text: J27_TASK_LABEL['identify-reviewers'] };
  }
  if (blockerKeys.includes('phase-two-status-pending')) {
    return { kind: 'wait', key: 'phase-two-status-pending', text: J27_WAIT_LABEL['phase-two-status-pending'] };
  }
  // "Nothing is waiting" is a claim about every fact; a failed read cannot back it.
  if (stage.basis === 'degraded') return { kind: 'none', text: null };
  return { kind: 'idle', text: J27_IDLE_LABEL };
}

const PAST_PEER_REVIEW = new Set(['deliberations', 'final-assessment']);

/** Reviews still owed on an open request that has moved past Peer Review, else 0. */
export function outstandingReviews(row) {
  const stage = stageOf(row);
  if (!stage || isClosedRow(row) || !PAST_PEER_REVIEW.has(stage.phase)) return 0;
  const count = Number(row.reviewers?.outstanding);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/**
 * The small third lines, in display order. A review still owed is said in
 * words once the request has left Peer Review, so the reviewer is not
 * forgotten. Only a failed read ("degraded") earns the other note: every open
 * list row is "partial" because the list never loads the later-phase facts.
 */
export function rowNotes(row, { suppressDegraded = false } = {}) {
  const stage = stageOf(row);
  const notes = [];
  const owed = outstandingReviews(row);
  if (owed) notes.push({ kind: 'outstanding', text: `${owed} review${owed === 1 ? '' : 's'} outstanding` });
  if (!suppressDegraded && stage && stage.basis === 'degraded') notes.push({ kind: 'degraded', text: J27_DEGRADED_NOTE });
  return notes;
}

/**
 * True when every open loaded request (two or more) could not be fully read.
 * Closed requests are left out: they read fewer facts and are usually hidden. That
 * is a condition of the deployment or of one failed batch read, not of any one
 * request, so the list says it once instead of on every row (seen on the
 * sandbox Preview, 2026-11-09).
 */
export function degradedEverywhere(rows) {
  const staged = (Array.isArray(rows) ? rows : []).filter((row) => stageOf(row) && !isClosedRow(row));
  return staged.length > 1 && staged.every((row) => stageOf(row).basis === 'degraded');
}

/** Search over request number, title, institution and Principal Investigator. */
export function matchesSearch(row, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  return [row.requestNumber, row.title, row.institution, row.projectLeader]
    .filter(Boolean).join(' ').toLowerCase().includes(needle);
}

/** All requests "Showing" menu. An unmapped closed row is listed only under Everything. */
export function matchesShowing(row, showing = 'open') {
  if (showing === 'everything') return true;
  const closed = isClosedRow(row);
  if (showing === 'open') return !closed;
  return closed && stageOf(row)?.outcome === showing;
}

/**
 * Phase tab filter: closed rows only with "Show closed"; on Initial
 * Assessment a chosen standing lists just the open rows that stand there.
 */
export function matchesPhaseFilters(row, { showClosed = false, standing = '' } = {}) {
  if (standing) return standingKey(row) === standing;
  return showClosed || !isClosedRow(row);
}

/** Rows of one tab: every row on All requests, a phase filter elsewhere. */
export function rowsForTab(rows, tab) {
  const list = Array.isArray(rows) ? rows : [];
  if (!J27_PHASE_TABS.includes(tab)) return list;
  return list.filter((row) => stageOf(row)?.phase === tab);
}

/** Number of open rows per Initial Assessment standing, for the filter chips. */
export function standingCounts(rows) {
  const counts = Object.fromEntries(J27_STANDING_KEYS.map((key) => [key, 0]));
  for (const row of rowsForTab(rows, 'initial-assessment')) {
    const key = standingKey(row);
    if (key) counts[key] += 1;
  }
  return counts;
}

/** Tab counts: rows of the phase whose line starts with "Next:". */
export function tabCounts(rows) {
  return Object.fromEntries(J27_PHASE_TABS.map((tab) => [
    tab, rowsForTab(rows, tab).filter((row) => rowLine(row).kind === 'next').length,
  ]));
}
