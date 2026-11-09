/**
 * J27 Research Workbench read model: a pure derivation of a proposal's
 * stage, recorded decisions, outcome, tasks and blockers from loaded facts.
 *
 * Plan: docs/plans/J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md, step C.
 * Importable by server and client; no I/O, no clock (`calendar.today` is
 * injected). Every input key is `{ status, ...detail }` with
 * `status ∈ present | absent | unavailable | stale | not-loaded`. A missing
 * key reads as `not-loaded`. Conditions match only on confirmed values:
 * `not-loaded` and `unavailable` never satisfy a phase row, task or blocker.
 *
 * The model consumes rows after the existing isolation and visibility
 * filters and never decides access. `capabilities.readOnly` is echoed as
 * `readOnly`, not as a blocker.
 */
import { FIRST_CUT_STATUS, SEMI_FINALIST_STATUS } from '../../../shared/config/j27FirstCut.js';
import { parseCycleCode } from '../../utils/cycle-code.js';

export const PHASE_I_CHAIRS = Object.freeze({ invited: 100000003, notInvited: 100000002 });
export const REVIEWERS_NEEDED = 3;
export const PHASE_II_PENDING = 'Phase II Pending';

export const J27_PHASES = Object.freeze([
  'initial-assessment', 'peer-review', 'deliberations', 'final-assessment', 'decided', 'unclassified',
]);
export const J27_OUTCOMES = Object.freeze([
  'none', 'not-scored', 'triaged', 'not-invited', 'decided-award', 'decided-no-award', 'withdrawn',
]);
export const J27_BASES = Object.freeze(['full', 'partial', 'degraded', 'out-of-scope']);

// Display order (C5). `secondary` keys are quiet links on the landing list and
// never become the primary task while another task of the phase qualifies.
export const J27_TASKS = Object.freeze([
  { key: 'record-rationale', phase: 'initial-assessment', owner: 'editor' },
  { key: 'record-first-cut', phase: 'initial-assessment', owner: 'lead-pd' },
  { key: 'record-semi-finalist', phase: 'initial-assessment', owner: 'lead-pd' },
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
  'record-rationale', 'record-first-cut', 'record-semi-finalist', 'identify-reviewers', 'record-offramp',
]);

// Operations the four D7 presentation gates own; not tasks of this model.
export const J27_PRESENTATION_OPERATIONS = Object.freeze([
  'schedule-presentation', 'presentation-materials', 'presentation-invitation-email', 'presentation-transcription',
]);

export const J27_BLOCKERS = Object.freeze({
  'chairs-outcome-pending': Object.freeze(['send-invitations']),
  'integrity-unreviewed': Object.freeze(['send-invitations', 'schedule-presentation']),
  'continue-decision-missing': Object.freeze([...J27_PRESENTATION_OPERATIONS]),
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
  triaged: 'Triaged',
  recommended: 'Recommended to Chairs, awaiting outcome',
  invited: 'Invited for peer review',
  'not-invited': 'Not invited',
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
  const base = { firstCut: 'unset', semiFinalist: 'unset', chairsOutcome: 'pending', label: null, unmapped: false };
  switch (phaseIStatus) {
    case null:
    case undefined:
    case 100000000: // Pending Committee Review
      return base;
    case FIRST_CUT_STATUS.yes:
      return { ...base, firstCut: 'scored', label: PHASE_I_LABELS.scored };
    case FIRST_CUT_STATUS.no:
      return { ...base, firstCut: 'not-scored', label: PHASE_I_LABELS['not-scored'] };
    case SEMI_FINALIST_STATUS.no:
      return { ...base, firstCut: 'inferred-scored', semiFinalist: 'no', label: PHASE_I_LABELS.triaged };
    case SEMI_FINALIST_STATUS.yes:
      return { ...base, firstCut: 'inferred-scored', semiFinalist: 'yes', label: PHASE_I_LABELS.recommended };
    case PHASE_I_CHAIRS.invited:
      return { ...base, firstCut: 'inferred-scored', semiFinalist: 'inferred-yes', chairsOutcome: 'invited', label: PHASE_I_LABELS.invited };
    case PHASE_I_CHAIRS.notInvited:
      return { ...base, firstCut: 'inferred-scored', semiFinalist: 'inferred-yes', chairsOutcome: 'not-invited', label: PHASE_I_LABELS['not-invited'] };
    default:
      return { ...base, label: phaseIStatusLabel || null, unmapped: true };
  }
}

/** C4: terminal outcome, or `none`. */
export function deriveOutcome(statusClass, recorded) {
  if (statusClass === 'DECIDED_AWARD') return 'decided-award';
  if (statusClass === 'DECIDED_NO_AWARD') return 'decided-no-award';
  if (statusClass === 'WITHDRAWN') return 'withdrawn';
  if (recorded.firstCut === 'not-scored') return 'not-scored';
  if (recorded.semiFinalist === 'no') return 'triaged';
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
  const outcome = deriveOutcome(request.statusClass, recorded);
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
  if ((recorded.semiFinalist === 'yes' && recorded.chairsOutcome === 'pending')
    || (recorded.chairsOutcome === 'invited' && request.requestStatus !== PHASE_II_PENDING)) raise('chairs-outcome-pending');
  if (integrityUnreviewed) raise('integrity-unreviewed');
  raise('continue-decision-missing');
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
    if (recorded.firstCut === 'unset') add('record-first-cut');
    if (recorded.firstCut === 'scored' && recorded.semiFinalist === 'unset'
      && isPresent(features) && features.semiFinalistEnabled === true) add('record-semi-finalist');
    if (integrityUnreviewed) add('review-integrity');
    if (isPresent(counts) && counts.completed < REVIEWERS_NEEDED) add('identify-reviewers');
    if (recorded.chairsOutcome === 'invited' && request.requestStatus === PHASE_II_PENDING
      && isPresent(counts) && counts.candidates > counts.invited) add('send-invitations');
    if (isPresent(counts) && counts.received > 0 && (isAbsent(reviewSummary) || summaryStale)) add('read-reports');
    if (recorded.semiFinalist === 'yes' || recorded.semiFinalist === 'inferred-yes') {
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

  const inPhase = tasks.filter((task) => task.phase === phase);
  const primaryTask = (inPhase.find((task) => !task.secondary) || inPhase[0] || tasks[0] || null)?.key ?? null;

  return {
    phase, basis, recorded, outcome,
    tasks, taskKeys: tasks.map((task) => task.key), primaryTask, tasksBasis: basis,
    blockers, blockerKeys: blockers.map((blocker) => blocker.key), readOnly,
  };
}
