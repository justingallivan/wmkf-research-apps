/**
 * Server-side input assembly for the J27 read model (plan C7, tier 1).
 *
 * Shared by request resolution and the dashboard proposal list: the SELECT
 * widening, the per-row `request` and memo-presence keys, the two batch facts
 * (any suggestion, latest integrity state) and the calendar key. Every read
 * failure becomes an `unavailable` key; nothing here throws past its caller.
 * Memo columns are selected only when the matching schema helper says the
 * wave is provisioned, so a column absent from a target never breaks a query.
 * A memo whose wave is off reads `not-provisioned`, not `unavailable`: nothing
 * was attempted and nothing failed, so it must not mark the row degraded.
 */
import { classifyStatus, STATUS_CLASS } from '../dataverse-export/constants';
import { linkedCycleCode } from '../../dataverse/adapters/operations-grant-cycle';
import { isReadinessOnlyRow } from '../../../shared/config/workbenchVisibility.js';
import { existsAnySuggestionForRequests } from '../../dataverse/adapters/reviewer-suggestion';
import { initialAssessmentRationaleEnabled } from '../../utils/initial-assessment-rationale-readiness';
import { meetingRosterSchemaEnabled } from '../../utils/meeting-roster-readiness';
import { j27IntegrityTarget, j27ChairsRecommendationEnabled } from '../../utils/j27-integrity-readiness';
import { staffReviewSummaryEnabled } from './staff-review-summary-service';
import { readLatestIntegrityStates } from './j27-integrity-jobs';
import { resolvePreviewReadOnly } from './preview-read-only';
import { deriveJ27Stage, isJ27ScopeCycle } from './j27-read-model';

export const J27_MEMO_COLUMNS = Object.freeze({
  rationale: 'wmkf_initialassessmentrationale',
  reviewSummary: 'wmkf_staffreviewsummary',
  visitAssessment: 'wmkf_staffvisitassessment',
  rosterMemo: 'wmkf_confirmedmeetingroster',
});

const REQUEST_FIELDS = Object.freeze([
  'akoya_requeststatus', 'wmkf_phaseistatus', 'wmkf_phaseiistatus', 'wmkf_readyforreview',
  'wmkf_triagestatus', '_wmkf_grantprogram_value',
]);
// `wmkf_istestrequest` is read when the isolation select already carries it;
// the read model never adds it (the isolation wave owns that projection).

/** Which memo waves are provisioned on this deployment and target. */
export function j27MemoAvailability() {
  const summaryWave = staffReviewSummaryEnabled();
  return {
    rationale: initialAssessmentRationaleEnabled(),
    reviewSummary: summaryWave,
    // The visit assessment column has no helper of its own; the page renders
    // it only inside the review-summary block, so it shares that gate.
    visitAssessment: summaryWave,
    rosterMemo: meetingRosterSchemaEnabled(),
  };
}

/** Add the read model's request fields and the provisioned memo columns to a projection. */
export function withJ27ReadModelSelect(select, availability = j27MemoAvailability()) {
  const memo = Object.entries(J27_MEMO_COLUMNS).filter(([key]) => availability[key]).map(([, column]) => column);
  return [...new Set([...select.split(','), ...REQUEST_FIELDS, ...memo])].join(',');
}

export function j27RequestInput(row) {
  return {
    status: 'present',
    requestStatus: row.akoya_requeststatus || null,
    statusClass: row.akoya_requeststatus
      ? (classifyStatus(row.akoya_requeststatus)?.class || STATUS_CLASS.UNCLASSIFIED)
      : null,
    phaseIStatus: row.wmkf_phaseistatus ?? null,
    phaseIStatusLabel: row.wmkf_phaseistatus_formatted || null,
    phaseIIStatus: row.wmkf_phaseiistatus ?? null,
    readyForReview: row.wmkf_readyforreview === true,
    cycleCode: linkedCycleCode(row),
    grantProgramId: row._wmkf_grantprogram_value ? String(row._wmkf_grantprogram_value).toLowerCase() : null,
    triageStatus: typeof row.wmkf_triagestatus === 'number' ? row.wmkf_triagestatus : null,
    isTestRequest: row.wmkf_istestrequest === true,
  };
}

/** Presence only; a sparse row reads an omitted selected column as absent. */
export function j27MemoInputs(row, availability = j27MemoAvailability()) {
  const out = {};
  for (const [key, column] of Object.entries(J27_MEMO_COLUMNS)) {
    if (!availability[key]) { out[key] = { status: 'not-provisioned' }; continue; }
    const value = row[column];
    out[key] = { status: typeof value === 'string' && value.trim() ? 'present' : 'absent' };
  }
  return out;
}

/**
 * The two batch facts: one Dataverse read and one Postgres read for the
 * whole id list. Each failure yields `null`, which `composeJ27Tier1` maps to
 * `unavailable` on every row.
 */
// A failed batch read is shown to staff only as "Some details could not be
// read.", so the cause is logged here; nothing else records it.
function logFailedFact(name) {
  return (error) => {
    console.warn(`[j27-read-model] ${name} read failed:`, error?.code || '', error?.message || error);
    return null;
  };
}

export async function loadJ27Facts(requestIds) {
  const [anySuggestion, integrity] = await Promise.all([
    existsAnySuggestionForRequests(requestIds).catch(logFailedFact('reviewer suggestions')),
    readLatestIntegrityStates(j27IntegrityTarget(), requestIds).catch(logFailedFact('integrity states')),
  ]);
  return { anySuggestion, integrity };
}

export function j27CalendarInput(cycle, today) {
  if (!cycle) return { status: 'unavailable' };
  return {
    status: 'present',
    offrampMeetingDate: cycle.wmkf_researchofframpmeetingdate || null,
    reviewsDueDate: cycle.wmkf_researchreviewsduedate || null,
    today,
  };
}

export function isoDate(today = new Date()) {
  return today instanceof Date ? today.toISOString().slice(0, 10) : String(today).slice(0, 10);
}

/**
 * Tier 1 input for one row. `counts` is the per-request reviewer rollup when
 * the caller has it (dashboard) or omitted (request page, loaded later).
 */
export function composeJ27Tier1(row, facts, { calendar, counts, availability = j27MemoAvailability(), env = process.env } = {}) {
  const id = String(row.akoya_requestid || '').toLowerCase();
  const reviewers = facts?.anySuggestion
    ? { status: 'present', anySuggestion: facts.anySuggestion.has(id) }
    : { status: 'unavailable' };
  reviewers.counts = counts ? { status: 'present', ...counts } : { status: 'not-loaded' };
  const integrity = facts?.integrity
    ? (facts.integrity.get(id) || { status: 'present', latest: null })
    : { status: 'unavailable' };
  return {
    request: j27RequestInput(row),
    ...j27MemoInputs(row, availability),
    reviewers,
    integrity,
    calendar,
    capabilities: { status: 'present', readOnly: resolvePreviewReadOnly(env) },
    features: { status: 'present', chairsRecommendationEnabled: j27ChairsRecommendationEnabled() },
    presentation: { status: 'not-loaded' },
    roster: { status: 'not-loaded' },
    boardDraft: { status: 'not-loaded' },
    transition: { status: 'not-loaded' },
  };
}

/**
 * Derive for an in-scope row, or `null` for a pre-2027 or unlinked row, or a
 * row outside the readiness-only program scope (Research, resolved from the
 * live catalog by name; plan F1). The model describes the Research workflow,
 * so a J27 Southern California row carries no stage. An empty scope yields
 * no stage anywhere: fail closed, never a wrong task list.
 */
export function deriveJ27ForRow(row, facts, options = {}) {
  if (!isJ27ScopeCycle(linkedCycleCode(row))) return null;
  if (!isReadinessOnlyRow(row, options.scope)) return null;
  const input = composeJ27Tier1(row, facts, options);
  return { ...deriveJ27Stage(input), input };
}

/** The dashboard's slim projection of a derived stage. */
export function j27DashboardDto(stage) {
  const { phase, basis, primaryTask, taskKeys, blockerKeys, recorded, outcome } = stage;
  return { phase, basis, primaryTask, taskKeys, blockerKeys, recorded, outcome };
}
