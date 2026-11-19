/**
 * J27 Research Workbench read model: a pure derivation of a proposal's
 * stage, recorded decisions, outcome, tasks and blockers from loaded facts.
 *
 * Plan: docs/plans/J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md, step C.
 * Importable by server and client; no I/O, no clock (`calendar.today` is
 * injected). Every input key is `{ status, ...detail }` with
 * `status ∈ present | absent | unavailable | stale | not-loaded |
 * not-provisioned`. A missing key reads as `not-loaded`. Conditions match
 * only on confirmed values: `not-loaded`, `unavailable` and `not-provisioned`
 * never satisfy a phase row, task or blocker. `not-provisioned` (the fact's
 * schema wave is off on this deployment) also leaves `basis` alone: no read
 * failed and none is pending, so the row is neither degraded nor partial.
 *
 * The model consumes rows after the existing isolation and visibility
 * filters and never decides access. `capabilities.readOnly` is echoed as
 * `readOnly`, not as a blocker.
 */
import { SCORING_STATUS, CHAIRS_RECOMMENDATION_STATUS } from '../../../shared/config/j27Scoring.js';
import { parseCycleCode } from '../../utils/cycle-code.js';

export const PHASE_I_CHAIRS = Object.freeze({ invited: 100000003, notInvited: 100000002 });
export const REVIEWERS_NEEDED = 3;
export const PHASE_II_PENDING = 'Phase II Pending';
// D7 (closed 2026-11-09, D51): the offramp is recorded as this Phase II status value.
export const PHASE_II_OFFRAMPED = 682090001;

export const J27_PHASES = Object.freeze([
  'initial-assessment', 'peer-review', 'deliberations', 'final-assessment', 'decided', 'unclassified',
]);
export const J27_OUTCOMES = Object.freeze([
  'none', 'not-scored', 'not-recommended', 'not-invited', 'offramped', 'decided-award', 'decided-no-award', 'withdrawn',
]);
export const J27_BASES = Object.freeze(['full', 'partial', 'degraded', 'out-of-scope']);

// Display order (C5). `secondary` keys are quiet links on the landing list and
// never become the primary task while another task of the phase qualifies.
export const J27_TASKS = Object.freeze([
  { key: 'record-rationale', phase: 'initial-assessment', owner: 'editor' },
  { key: 'record-scoring', phase: 'initial-assessment', owner: 'lead-pd' },
  { key: 'record-chairs-recommendation', phase: 'initial-assessment', owner: 'lead-pd' },
  { key: 'review-integrity', phase: 'initial-assessment', owner: 'lead-pd' },
  { key: 'identify-reviewers', phase: 'peer-review', owner: 'lead-pd', secondary: true },
  { key: 'send-invitations', phase: 'peer-review', owner: 'lead-pd' },
  { key: 'read-reports', phase: 'peer-review', owner: 'staff' },
  { key: 'record-offramp', phase: 'deliberations', owner: 'lead-pd', secondary: true },
  { key: 'confirm-roster', phase: 'deliberations', owner: 'staff' },
  { key: 'write-visit-assessment', phase: 'deliberations', owner: 'staff' },
  { key: 'write-board-draft', phase: 'final-assessment', owner: 'lead-pd' },
  { key: 'start-group-review', phase: 'final-assessment', owner: 'lead-pd' },
].map(Object.freeze));
export const J27_TASK_KEYS = Object.freeze(J27_TASKS.map((task) => task.key));

// Recording keys are never in any blocker's `blocks` set (C6 invariant).
export const J27_RECORDING_TASK_KEYS = Object.freeze([
  'record-rationale', 'record-scoring', 'record-chairs-recommendation', 'identify-reviewers', 'record-offramp',
]);

// Operations the four D7 presentation gates own; not tasks of this model.
export const J27_PRESENTATION_OPERATIONS = Object.freeze([
  'schedule-presentation', 'presentation-materials', 'presentation-invitation-email', 'presentation-transcription',
]);

export const J27_BLOCKERS = Object.freeze({
  'chairs-outcome-pending': Object.freeze(['send-invitations']),
  'phase-two-status-pending': Object.freeze(['send-invitations']),
  'integrity-unreviewed': Object.freeze(['send-invitations', 'schedule-presentation']),
  // D7: an Offramped row never presents and never invites; the four presentation
  // operations are otherwise open for a live row.
  offramped: Object.freeze([...J27_PRESENTATION_OPERATIONS, 'send-invitations']),
  'presentation-not-ended': Object.freeze(['start-group-review']),
  'presentation-end-unverified': Object.freeze(['start-group-review']),
  'presentation-schedule-unavailable': Object.freeze(['confirm-roster', 'start-group-review']),
  'evidence-stale': Object.freeze(['read-reports']),
  'roster-stale': Object.freeze(['confirm-roster']),
});
export const J27_BLOCKER_KEYS = Object.freeze(Object.keys(J27_BLOCKERS));

const TERMINAL_CLASSES = new Set(['DECIDED_AWARD', 'DECIDED_NO_AWARD', 'WITHDRAWN']);
const CYCLE_GRAMMAR = /^[JD]\d{2}$/;
const PHASE_I_LABELS = Object.freeze({
  scored: 'Scored',
  'not-scored': 'Not Scored',
  'not-recommended': 'Not Recommended',
  recommended: 'Recommended to Chairs',
  invited: 'Invited',
  'not-invited': 'Not Invited',
});

function keyOf(input, name) {
  const value = input?.[name];
  return value && typeof value === 'object' && typeof value.status === 'string' ? value : { status: 'not-loaded' };
}
const confirmed = (key) => key.status === 'present' || key.status === 'absent' || key.status === 'stale';
const isPresent = (key) => key.status === 'present' || key.status === 'stale';
const isAbsent = (key) => key.status === 'absent';
const isUnavailable = (key) => key.status === 'unavailable';
const isNotLoaded = (key) => key.status === 'not-loaded';

export function isJ27ScopeCycle(cycleCode) {
  // Raw grammar first, as requestReadiness.js:15: a lowercase or padded code is
  // out of scope even though parseCycleCode would trim and uppercase it.
  if (typeof cycleCode !== 'string' || !CYCLE_GRAMMAR.test(cycleCode)) return false;
  return parseCycleCode(cycleCode).year >= 2027;
}

/** C2: recorded decisions and the Chairs' outcome from `wmkf_phaseistatus` alone. */
export function deriveRecorded(phaseIStatus, phaseIStatusLabel = null) {
  const base = { scoring: 'unset', chairsRecommendation: 'unset', chairsOutcome: 'pending', label: null, unmapped: false };
  switch (phaseIStatus) {
    case null:
    case undefined:
    case 100000000: // Pending Committee Review
      return base;
    case SCORING_STATUS.yes:
      return { ...base, scoring: 'scored', label: PHASE_I_LABELS.scored };
    case SCORING_STATUS.no:
      return { ...base, scoring: 'not-scored', label: PHASE_I_LABELS['not-scored'] };
    case CHAIRS_RECOMMENDATION_STATUS.no:
      return { ...base, scoring: 'inferred-scored', chairsRecommendation: 'no', label: PHASE_I_LABELS['not-recommended'] };
    case CHAIRS_RECOMMENDATION_STATUS.yes:
      return { ...base, scoring: 'inferred-scored', chairsRecommendation: 'yes', label: PHASE_I_LABELS.recommended };
    case PHASE_I_CHAIRS.invited:
      return { ...base, scoring: 'inferred-scored', chairsRecommendation: 'inferred-yes', chairsOutcome: 'invited', label: PHASE_I_LABELS.invited };
    case PHASE_I_CHAIRS.notInvited:
      return { ...base, scoring: 'inferred-scored', chairsRecommendation: 'inferred-yes', chairsOutcome: 'not-invited', label: PHASE_I_LABELS['not-invited'] };
    default:
      return { ...base, label: phaseIStatusLabel || null, unmapped: true };
  }
}

/** C4: terminal outcome, or `none`. */
export function deriveOutcome(statusClass, recorded, phaseIIStatus = null) {
  if (statusClass === 'DECIDED_AWARD') return 'decided-award';
  if (statusClass === 'DECIDED_NO_AWARD') return 'decided-no-award';
  if (statusClass === 'WITHDRAWN') return 'withdrawn';
  if (phaseIIStatus === PHASE_II_OFFRAMPED) return 'offramped';
  if (recorded.scoring === 'not-scored') return 'not-scored';
  if (recorded.chairsRecommendation === 'no') return 'not-recommended';
  if (recorded.chairsOutcome === 'not-invited') return 'not-invited';
  return 'none';
}

// Date-only comparison on ISO `YYYY-MM-DD` prefixes; null when either is missing.
function isPastDate(today, date) {
  const a = typeof today === 'string' ? today.slice(0, 10) : null;
  const b = typeof date === 'string' ? date.slice(0, 10) : null;
  if (!a || !b || a.length !== 10 || b.length !== 10) return null;
  return a > b;
}

// `not-provisioned` keys count as neither: see the header.
function basisOf(keys) {
  if (keys.some(isUnavailable)) return 'degraded';
  if (keys.some(isNotLoaded)) return 'partial';
  return 'full';
}

/**
 * @param {object} input see the plan's C1 input contract
 * @returns {{ phase, basis, recorded, outcome, tasks, taskKeys, primaryTask, tasksBasis, blockers, blockerKeys, readOnly }}
 */
export function deriveJ27Stage(input) {
  const request = keyOf(input, 'request');
  if (!isPresent(request)) {
    throw new Error('deriveJ27Stage requires a present request key.');
  }
  const recorded = deriveRecorded(request.phaseIStatus ?? null, request.phaseIStatusLabel ?? null);
  const outcome = deriveOutcome(request.statusClass, recorded, request.phaseIIStatus);
  const capabilities = keyOf(input, 'capabilities');
  const readOnly = isPresent(capabilities) && capabilities.readOnly === true;

  if (!isJ27ScopeCycle(request.cycleCode)) {
    return {
      phase: 'unclassified', basis: 'out-of-scope', recorded, outcome,
      tasks: [], taskKeys: [], primaryTask: null, tasksBasis: 'out-of-scope',
      blockers: [], blockerKeys: [], readOnly,
    };
  }

  const rationale = keyOf(input, 'rationale');
  const reviewSummary = keyOf(input, 'reviewSummary');
  const visitAssessment = keyOf(input, 'visitAssessment');
  const rosterMemo = keyOf(input, 'rosterMemo');
  const reviewers = keyOf(input, 'reviewers');
  const counts = keyOf(reviewers, 'counts');
  const integrity = keyOf(input, 'integrity');
  const calendar = keyOf(input, 'calendar');
  const features = keyOf(input, 'features');
  const presentation = keyOf(input, 'presentation');
  const roster = keyOf(input, 'roster');
  const boardDraft = keyOf(input, 'boardDraft');
  const transition = keyOf(input, 'transition');

  // C3: phase precedence. Each row lists the inputs it consults so `basis`
  // can be computed over the rows that outrank the matched one.
  const rosterSource = isNotLoaded(roster) ? rosterMemo : roster;
  const rows = [
    { phase: 'decided', consults: [request], match: () => TERMINAL_CLASSES.has(request.statusClass) },
    {
      phase: 'final-assessment', consults: [transition, boardDraft],
      match: () => (isPresent(transition) && (transition.phase === 'group-review' || transition.phase === 'leadership-review'))
        || (isPresent(boardDraft) && boardDraft.exists === true),
    },
    {
      phase: 'deliberations', consults: [presentation, visitAssessment, rosterSource],
      match: () => (isPresent(presentation) && presentation.exists === true)
        || isPresent(visitAssessment)
        || isPresent(rosterSource),
    },
    {
      phase: 'peer-review', consults: [reviewers],
      match: () => recorded.chairsOutcome === 'invited' || (isPresent(reviewers) && reviewers.anySuggestion === true),
    },
    { phase: 'initial-assessment', consults: [], match: () => true },
  ];
  let phase = 'initial-assessment';
  const consultedAbove = [];
  for (const row of rows) {
    if (row.match()) { phase = row.phase; break; }
    consultedAbove.push(...row.consults);
  }
  // Task inputs join the basis on live rows so a landing-list cue covers
  // tasks that may appear once a missing read lands (C8.4). A terminal row
  // has no forward tasks, so only the phase rows above it count.
  const terminal = outcome !== 'none';
  const taskInputs = terminal ? [] : [
    rationale, reviewSummary, visitAssessment, integrity, calendar, features, reviewers, counts,
    presentation, roster, boardDraft, transition,
  ];
  const basis = basisOf([...consultedAbove, ...taskInputs]);

  // C6: blockers, independent of task presence.
  const integrityUnreviewed = isPresent(integrity) && integrity.latest != null
    && integrity.latest.flagged === true && integrity.latest.reviewed !== true;
  const blockers = [];
  const raise = (key) => blockers.push({ key, blocks: [...J27_BLOCKERS[key]] });
  if (recorded.chairsRecommendation === 'yes' && recorded.chairsOutcome === 'pending') raise('chairs-outcome-pending');
  // Production derives 'Phase II Pending' from a Phase II status of Pending Committee Review or
  // Recommended, so Invited without it means the Chairs' outcome is recorded and the Phase II
  // status has not yet been set. Who sets it and when is open (alignment log, Connor and Sarah).
  if (recorded.chairsOutcome === 'invited' && request.requestStatus !== PHASE_II_PENDING) raise('phase-two-status-pending');
  if (integrityUnreviewed) raise('integrity-unreviewed');
  if (outcome === 'offramped') raise('offramped');
  if (isPresent(presentation) && presentation.ended === false) raise('presentation-not-ended');
  if (isPresent(presentation) && presentation.ended === null && presentation.legacyException !== true) raise('presentation-end-unverified');
  if (isUnavailable(presentation)) raise('presentation-schedule-unavailable');
  if (reviewSummary.status === 'stale' || (isPresent(reviewSummary) && reviewSummary.stale === true)) raise('evidence-stale');
  if (roster.status === 'stale' || (isPresent(roster) && roster.stale === true)) raise('roster-stale');
  const blockedKeys = new Set(blockers.flatMap((blocker) => blocker.blocks));

  // C5: tasks. Terminal outcome → no forward tasks.
  const tasks = [];
  const ended = isPresent(presentation) && presentation.ended === true;
  const summaryStale = reviewSummary.status === 'stale' || (isPresent(reviewSummary) && reviewSummary.stale === true);
  const rosterStale = roster.status === 'stale' || (isPresent(roster) && roster.stale === true);
  const add = (key, detail) => {
    const meta = J27_TASKS.find((task) => task.key === key);
    tasks.push({ key, phase: meta.phase, owner: meta.owner, ...(meta.secondary ? { secondary: true } : {}), ...(detail ? { detail } : {}) });
  };
  if (!terminal) {
    if (isAbsent(rationale)) add('record-rationale');
    if (recorded.scoring === 'unset') add('record-scoring');
    if (recorded.scoring === 'scored' && recorded.chairsRecommendation === 'unset'
      && isPresent(features) && features.chairsRecommendationEnabled === true) add('record-chairs-recommendation');
    if (integrityUnreviewed) add('review-integrity');
    if (isPresent(counts) && counts.completed < REVIEWERS_NEEDED) add('identify-reviewers');
    if (recorded.chairsOutcome === 'invited' && request.requestStatus === PHASE_II_PENDING
      && isPresent(counts) && counts.candidates > counts.invited) add('send-invitations');
    if (isPresent(counts) && counts.received > 0 && (isAbsent(reviewSummary) || summaryStale)) add('read-reports');
    if (recorded.chairsRecommendation === 'yes' || recorded.chairsRecommendation === 'inferred-yes') {
      add('record-offramp', {
        received: isPresent(counts) ? counts.received : null,
        pastOfframpDate: isPresent(calendar) ? isPastDate(calendar.today, calendar.offrampMeetingDate) : null,
      });
    }
    if (ended && (isAbsent(roster) || rosterStale)) add('confirm-roster');
    if (ended && isAbsent(visitAssessment)) add('write-visit-assessment');
    if (isPresent(visitAssessment) && isPresent(boardDraft) && boardDraft.exists === false) add('write-board-draft');
    if (isPresent(boardDraft) && boardDraft.exists === true && isPresent(transition) && transition.phase === null
      && (ended || (isPresent(presentation) && presentation.legacyException === true))
      && !blockedKeys.has('start-group-review')) add('start-group-review');
  }

  // Primary: first in-phase task that is not secondary, else the first
  // non-secondary task overall, else a secondary one; secondary keys lead
  // only when nothing else qualifies anywhere (C5).
  const inPhase = tasks.filter((task) => task.phase === phase);
  const primaryTask = (inPhase.find((task) => !task.secondary) || tasks.find((task) => !task.secondary)
    || inPhase[0] || tasks[0] || null)?.key ?? null;

  return {
    phase, basis, recorded, outcome,
    tasks, taskKeys: tasks.map((task) => task.key), primaryTask, tasksBasis: basis,
    blockers, blockerKeys: blockers.map((blocker) => blocker.key), readOnly,
  };
}

/**
 * What the Deliberations and Final Assessment rows (and the request page's
 * strip, through the same rule) show, from
 * the later-phase facts. Each is `null` when its fact is not known, so the
 * row falls back to the phase name rather than guessing.
 *   timing: not-scheduled | before | after | unconfirmed
 *   review: board-draft | group-review | leadership-review
 */
export function j27ListStanding(input) {
  const presentation = input?.presentation;
  const known = presentation?.status === 'present' || presentation?.status === 'stale';
  const timing = !known ? null
    : presentation.exists !== true ? 'not-scheduled'
      : presentation.ended === true ? 'after'
        : presentation.ended === false ? 'before' : 'unconfirmed';
  const transition = input?.transition;
  const boardDraft = input?.boardDraft;
  const review = transition?.status === 'present' && transition.phase
    ? transition.phase
    : boardDraft?.status === 'present' && boardDraft.exists === true ? 'board-draft' : null;
  return { timing, review };
}
