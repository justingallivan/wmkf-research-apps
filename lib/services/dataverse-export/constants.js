/**
 * Dataverse Power Tools — Track B — Living-taxonomy constants (DATA, not code-logic).
 *
 * Every value here is dated probe evidence or a user-attested WMKF-authority
 * determination, tagged with provenance. These are the *durable patterns /
 * invariants* layer (design doc §"Living taxonomy", point 2) — extendable
 * without a code change. They are NOT a hardcoded business truth restated:
 *
 *   - Value/count SNAPSHOTS (the 24-program list, exact counts) are NEVER
 *     encoded here — those are ephemeral dated evidence, read live at query
 *     time by the Phase-2 metadata route.
 *   - A program / status / type ABSENT from a seed below is NOT defaulted to
 *     the nearest known bucket. It flows to the UNCLASSIFIED / UNCLASSIFIED
 *     PROCESS fail-loud path (design doc §"Fail-loud runtime contract";
 *     build plan §9). Absence is a visible, actionable condition — never a
 *     silent guess.
 *
 * Status / semantic determinations are OWNED by
 * docs/DATAVERSE_POWER_TOOLS_DESIGN.md ("Residuals — AUTHORITATIVE LIST").
 * This module BINDS to that doc by reference; it does not re-derive.
 */

// ─────────────────────────────────────────────────────────────────────────
// Era boundary — creation-PROVENANCE partition (NOT a business-era partition)
// ─────────────────────────────────────────────────────────────────────────
// Provenance: scripts/probe-akoya-createdon-2023.js, 2026-05-16. 100% of the
// 22,573 migrated rows created on a single date 2023-12-03 (one ~43-min bulk
// import 17:42:10Z…18:25:32Z); zero native creates in 2023. Day-level date is
// the exact, solo-derivable classifier.
//
// HARD INVARIANT (design doc S157 C5): business history is sliced on
// akoya_decisiondate, NEVER createdon. createdon is creation provenance only.
const ERA_CUTOVER_DATE = '2023-12-03'; // UTC calendar date
const ERA = {
  MIGRATED: 'migrated', // createdon calendar-date === 2023-12-03 (Blackbaud/"Sky")
  NATIVE: 'native', // createdon calendar-date  >  2023-12-03 (AkoyaGO-born)
};

/**
 * Classify a row's era from its raw `createdon` ISO string.
 * Pure. Returns ERA.MIGRATED | ERA.NATIVE | null (null ⇒ caller emits the
 * UNCLASSIFIED sentinel; never a silent default).
 */
function classifyEra(createdonIso) {
  if (!createdonIso || typeof createdonIso !== 'string') return null;
  const day = createdonIso.slice(0, 10); // YYYY-MM-DD (UTC; Dataverse emits Z)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return day === ERA_CUTOVER_DATE ? ERA.MIGRATED : ERA.NATIVE;
}

// ─────────────────────────────────────────────────────────────────────────
// akoya_requeststatus value → class map (the decided-state predicate)
// ─────────────────────────────────────────────────────────────────────────
// Provenance, tagged per the design doc (§"Decided-state predicate", the
// ambiguous-middle table, §"Disclosure-layer spec"):
//   - PROBE-SUBSTANTIATED behavioral signatures: Pending-family 0% leakage
//     (probe-akoya-status-predicate.js); `Active` = 100% real paid grants
//     incl. the no-decisiondate sliver (probe-akoya-active-nodate.js).
//   - USER-ATTESTED S158 intent labels (not probe-provable — intent is not a
//     field): `Active`, `Proposal Not Invited`, `Withdrawn`.
//
// A status absent from this map ⇒ STATUS_CLASS.UNCLASSIFIED (the §9 path),
// NEVER coerced to the nearest known bucket.
const STATUS_CLASS = {
  IN_FLIGHT: 'IN_FLIGHT', // Pending family — undecided (probe-clean)
  DECIDED_AWARD: 'DECIDED_AWARD', // decided + funded (Approved/Active/Closed)
  DECIDED_NO_AWARD: 'DECIDED_NO_AWARD', // the terminal-non-award NAMED SET
  WITHDRAWN: 'WITHDRAWN', // terminal, no award, OWN class, PATH-AGNOSTIC
  UNCLASSIFIED: 'UNCLASSIFIED', // absent from the live map — fail loud (§9)
};

// Exact-value entries (highest precedence). provenance: 'probe' | 'user-S158'.
const STATUS_VALUE_MAP = {
  // Pending family — probe-clean undecided (0% decision-date leakage).
  'Phase I Pending': { class: STATUS_CLASS.IN_FLIGHT, provenance: 'probe' },
  'Phase II Pending': { class: STATUS_CLASS.IN_FLIGHT, provenance: 'probe' },
  'Concept Pending': { class: STATUS_CLASS.IN_FLIGHT, provenance: 'probe' },
  Pending: { class: STATUS_CLASS.IN_FLIGHT, provenance: 'probe' },

  // Decided + funded.
  Approved: { class: STATUS_CLASS.DECIDED_AWARD, provenance: 'probe' },
  Closed: { class: STATUS_CLASS.DECIDED_AWARD, provenance: 'probe' },
  // Active: awarded grant in active performance period — decided, NOT closed.
  // No in-flight/undecided reading exists in the data (user-confirmed S158;
  // behavioral signature probe-substantiated).
  Active: { class: STATUS_CLASS.DECIDED_AWARD, provenance: 'user-S158' },

  // Terminal, no award — the NAMED SET (a reimplementation must NOT silently
  // shrink this; design doc §"Disclosure-layer spec" item 2).
  'Phase I Declined': { class: STATUS_CLASS.DECIDED_NO_AWARD, provenance: 'probe' },
  'Phase II Declined': { class: STATUS_CLASS.DECIDED_NO_AWARD, provenance: 'probe' },
  'Phase I Ineligible': { class: STATUS_CLASS.DECIDED_NO_AWARD, provenance: 'probe' },
  'Phase II Ineligible': { class: STATUS_CLASS.DECIDED_NO_AWARD, provenance: 'probe' },
  'Concept Ineligible': { class: STATUS_CLASS.DECIDED_NO_AWARD, provenance: 'probe' },
  'Concept Denied': { class: STATUS_CLASS.DECIDED_NO_AWARD, provenance: 'probe' },
  'Concept Done': { class: STATUS_CLASS.DECIDED_NO_AWARD, provenance: 'probe' },
  Denied: { class: STATUS_CLASS.DECIDED_NO_AWARD, provenance: 'probe' },
  Rescinded: { class: STATUS_CLASS.DECIDED_NO_AWARD, provenance: 'probe' },
  // Proposal Not Invited: staff declined to invite a full proposal — a
  // terminal decline, no award (user-confirmed S158).
  'Proposal Not Invited': { class: STATUS_CLASS.DECIDED_NO_AWARD, provenance: 'user-S158' },

  // Withdrawn: terminal, no award, its OWN class. PATH-AGNOSTIC — the cause
  // (applicant backed out vs. administrative withdrawal) is NOT recoverable;
  // the sentinel MUST NOT attribute an actor (user-confirmed S158).
  Withdrawn: { class: STATUS_CLASS.WITHDRAWN, provenance: 'user-S158' },
};

// NO suffix fallback. The exact-value map IS the authoritative set (it
// enumerates every status the dated evidence carries). A value absent from
// it is NOT pattern-matched to the nearest bucket — that is exactly the
// silent rebucketing the design doc's "Fail-loud runtime contract" forbids.
// Absent ⇒ classifyStatus returns null ⇒ the caller emits the §9
// UNCLASSIFIED sentinel (raw value preserved, flagged, not interpreted).
// (Codex S160 cold-review P1: a suffix fallback is silent re-derivation that
// defeats fail-loud — removed.)

// The terminal-non-award NAMED SET, for the B-lifecycle null caption
// "DECIDED — no award" (design doc §"Disclosure-layer spec" item 2). Named
// explicitly so a reimplementation cannot silently lose a member.
const TERMINAL_NON_AWARD_STATUSES = Object.freeze([
  'Phase I Declined', 'Phase II Declined',
  'Phase I Ineligible', 'Phase II Ineligible', 'Concept Ineligible',
  'Concept Denied', 'Denied', 'Rescinded', 'Concept Done',
  'Proposal Not Invited',
]);

/**
 * Classify a raw akoya_requeststatus string.
 * @returns {{class, provenance, matchedBy:'exact'}} | null (null ⇒
 *   caller emits STATUS_CLASS.UNCLASSIFIED; never a silent default).
 */
function classifyStatus(raw) {
  if (raw == null) return null;
  const v = String(raw).trim();
  if (!v) return null;
  if (Object.prototype.hasOwnProperty.call(STATUS_VALUE_MAP, v)) {
    return { ...STATUS_VALUE_MAP[v], matchedBy: 'exact' };
  }
  // Absent from the authoritative map ⇒ fail loud (§9), never guess.
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Amount fan-out — the five explicit `which` → field mappings (no bare "$")
// ─────────────────────────────────────────────────────────────────────────
// Design doc / build plan §3b. Money compiles the *_base currency pair (+
// LE_*currencyprecision/symbol), NEVER the display string.
const AMOUNT_WHICH = {
  awarded: 'akoya_grant',
  requested: 'akoya_request',
  total: 'akoya_expenses',
  recommended: 'akoya_recommendedamount',
  invited: 'wmkf_invitedamount',
};

// B-structural amount fields: migrated values are a migration-backfill
// artifact and must NEVER be emitted as a real amount (build plan §3b/§3c).
const B_STRUCTURAL_AMOUNT_FIELDS = Object.freeze(['akoya_request', 'akoya_expenses']);

/** ExcelJS / disclosure helper: the base-currency companion of a money field. */
function baseAmountField(field) {
  return `${field}_base`;
}

// ─────────────────────────────────────────────────────────────────────────
// Operational-exclusion predicate — axis-by-axis (NOT a single predicate)
// ─────────────────────────────────────────────────────────────────────────
// Design doc §"(ii) determinations" + build plan §3b. Excluded when
// querySpec.excludeOperational === true (default true). These reference
// LOOKUP/PICKLIST values by LABEL — the label→GUID/optionvalue resolution is
// a live-taxonomy (Phase-2 metadata route) concern; the compiler emits a
// resolvable clause and records the intent in appliedRules. wmkf_type =
// "Miscellaneous" is REAL grants (probe-substantiated) — explicitly NOT here.
const OPERATIONAL_EXCLUSION = Object.freeze([
  { field: 'wmkf_request_type', kind: 'picklist', op: 'not-in',
    // Labels MUST match the live picklist exactly (resolver is fail-loud,
    // not fuzzy). Verified live against akoya_request.wmkf_request_type:
    // the phone interaction option's label is "Phone Call", not "Phone"
    // (design-doc §(ii) shorthand "Phone" = this option). Office/Site Visit
    // match verbatim.
    labels: ['Office Visit', 'Site Visit', 'Phone Call'],
    note: 'interaction-kind logs, not grants' },
  { field: 'wmkf_type', kind: 'lookup', op: 'ne', label: 'Site Visit',
    note: 'interaction log, not a grant (user-attested)' },
  { field: 'akoya_programid', kind: 'lookup', op: 'ne', label: 'Research Reviewer',
    note: 'paid peer-reviewer honoraria via GOapply, not grants (≡ wmkf_type=Individual)' },
  // The SHARPEST single reviewer-exclusion predicate (design doc §"(ii)") —
  // the honorarium funding category. Part of the operational predicate so
  // compile() actually applies it (Codex S160 P1: the constant was defined
  // but unused).
  { field: 'wmkf_grantprogram', kind: 'lookup', op: 'ne', label: 'Honorarium',
    note: 'paid honoraria (sharpest single reviewer-exclusion predicate), not grants' },
]);

// Back-compat alias — the sharpest single clause, now folded into the
// operational set above (still exported for callers that want it standalone).
const SHARPEST_REVIEWER_EXCLUSION = Object.freeze({
  field: 'wmkf_grantprogram', kind: 'lookup', op: 'ne', label: 'Honorarium',
});

// Test-record predicate (residual iii, CLOSED artifact-backed S158):
// applicant account.name === this ∧ native era. Default-excluded; opt-in to
// include (with disclosure). Forward-robustness is a maintenance note, not a
// closed guarantee — revisit if WMKF ever legitimately self-grants.
const TEST_RECORD_APPLICANT_NAME = 'W. M. Keck Foundation';

// ─────────────────────────────────────────────────────────────────────────
// Program roll-up — Option B (user-decided S158)
// ─────────────────────────────────────────────────────────────────────────
// A program's grant TOTAL = wmkf_type = "Program" rows ONLY. Non-Program
// giving modes (Special Projects / Special Grants / …) are reported as their
// OWN separate lines, never folded into the program total. Pooling silently
// overstated Medical Research by ~39%.
const PROGRAM_ROLLUP_GRANT_TYPE_LABEL = 'Program';
const PROGRAM_ROLLUP = { OPTION_B: 'optionB' };

// ─────────────────────────────────────────────────────────────────────────
// Decline metadata fields — era-aware + the SoCal third field
// ─────────────────────────────────────────────────────────────────────────
// Provenance: scripts/probe-akoya-decline-by-program.js, 2026-05-17.
//   - migrated declines → akoya_denialreason  (Picklist)  ~97–100% all programs
//   - native   declines → wmkf_denialnotes    (Memo)
//   - SoCal-AREA programs ADDITIONALLY record native declines in a THIRD
//     field wmkf_socalreasonsfordecline2 (research programs = 0% there).
const DECLINE_FIELDS = Object.freeze({
  migratedReason: 'akoya_denialreason', // Picklist
  nativeNotes: 'wmkf_denialnotes', // Memo
  socalThird: 'wmkf_socalreasonsfordecline2', // SoCal-area native only
});

// Statuses that legitimately expect NO decline reason (triage declines) —
// declined-nulls here are "no reason expected", not "reason missing"
// (build plan §3c decline trifurcation).
const DECLINE_TRIAGE_STATUSES = Object.freeze([
  'Proposal Not Invited',
  'Phase I Ineligible', 'Phase II Ineligible', 'Concept Ineligible',
]);

// ─────────────────────────────────────────────────────────────────────────
// Per-program annotation seed (pi_bearing · socal_area · decline_segment)
// ─────────────────────────────────────────────────────────────────────────
// Keyed by the canonical `akoya_program` NAME. Provenance:
//   - pi_bearing: scripts/probe-akoya-projectleader-by-program.js, 2026-05-17
//     (NATIVE wmkf_projectleader fill %). PI-bearing iff measured high.
//   - socal_area + decline_segment: scripts/probe-akoya-decline-by-program.js,
//     2026-05-17 (the wmkf_socalreasonsfordecline2 separation is the anchor).
//
// DISCIPLINE: an attribute is set ONLY where the dated evidence MEASURED it.
//   - A program ABSENT from this seed ⇒ fail-loud UNCLASSIFIED PROCESS on any
//     process-dependent output path (PI column, decline routing). NEVER a
//     guessed default (design doc §"Process is program-scoped" + §9).
//   - `pi_bearing` deliberately UNSET for programs whose native PI fill was
//     n<10-suppressed or never measured (e.g. the Undergraduate Education
//     families): the engine fails loud on those, it does not assume.
// Living-taxonomy: this is extendable evidence, NOT a closed business truth —
// new programs are EXPECTED and must arrive via a fresh dated probe, not a
// guess. The methods sheet cites this provenance date verbatim.
const PER_PROGRAM_SEED_PROVENANCE = Object.freeze({
  pi_bearing: 'probe-akoya-projectleader-by-program.js · 2026-05-17',
  decline: 'probe-akoya-decline-by-program.js · 2026-05-17',
});

const PER_PROGRAM_ANNOTATION = Object.freeze({
  'Medical Research':
    { pi_bearing: true, socal_area: false, decline_segment: 'research' },
  'Science and Engineering Research':
    { pi_bearing: true, socal_area: false, decline_segment: 'research' },
  // Bridge Funding is a research MECHANISM (100% PI-bearing) — proves the
  // crude "research-program-name only" split is wrong.
  'Bridge Funding':
    { pi_bearing: true, socal_area: false, decline_segment: 'research' },

  // SoCal-area: ~0% PI, declines recorded in the THIRD field.
  'Civic & Community':
    { pi_bearing: false, socal_area: true, decline_segment: 'socal' },
  'Precollegiate Education':
    { pi_bearing: false, socal_area: true, decline_segment: 'socal' },
  'Health Care':
    { pi_bearing: false, socal_area: true, decline_segment: 'socal' },

  // Non-research, non-SoCal discretionary/operational families — measured
  // ~0–5% PI fill (not-PI-bearing). socal_area=false (measured ~0% socal).
  "Directors' Directed Grant Program":
    { pi_bearing: false, socal_area: false, decline_segment: 'nonresearch' },
  "Directors' Matching Grant Program":
    { pi_bearing: false, socal_area: false, decline_segment: 'nonresearch' },
  'Senior Staff Directed Grant Program':
    { pi_bearing: false, socal_area: false, decline_segment: 'nonresearch' },
  'Staff Directed Grant Program':
    { pi_bearing: false, socal_area: false, decline_segment: 'nonresearch' },
  'Employee Matching Grant Program':
    { pi_bearing: false, socal_area: false, decline_segment: 'nonresearch' },
  'Arts & Culture':
    { pi_bearing: false, socal_area: false, decline_segment: 'nonresearch' },
  'Strategic Fund':
    { pi_bearing: false, socal_area: false, decline_segment: 'nonresearch' },
  'Disaster Relief':
    { pi_bearing: false, socal_area: false, decline_segment: 'nonresearch' },
  "Chair's Grants":
    { pi_bearing: false, socal_area: false, decline_segment: 'nonresearch' },
  'Early Childhood':
    { pi_bearing: false, socal_area: false, decline_segment: 'nonresearch' },
  Miscellaneous:
    { pi_bearing: false, socal_area: false, decline_segment: 'nonresearch' },

  // Research Reviewer is OPERATIONAL (honorarium) — excluded as a grant by
  // the operational predicate; annotated so a row that slips through still
  // fails loud rather than getting a guessed PI default.
  'Research Reviewer':
    { pi_bearing: false, socal_area: false, decline_segment: 'operational' },
});

// The explicit fail-loud bucket for native declines with a NULL program
// (akoya_programid null — ~9% of native declines). Cannot be routed to any
// program-scoped decline view; surface this, never silently drop/mis-assign.
const PROGRAM_UNATTRIBUTED_LABEL = '(program-unattributed declines)';

/**
 * Look up a program's annotation by canonical akoya_program name.
 * @returns annotation object | null. null ⇒ the program is not in the dated
 *   seed; the caller MUST fail loud (UNCLASSIFIED PROCESS), never default.
 */
function programAnnotation(programName) {
  if (programName == null) return null;
  const key = String(programName).trim();
  return Object.prototype.hasOwnProperty.call(PER_PROGRAM_ANNOTATION, key)
    ? PER_PROGRAM_ANNOTATION[key]
    : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Column contract (S159-closed, user-confirmed, Codex-audited)
// ─────────────────────────────────────────────────────────────────────────
// The default SET is owned by the design doc's Artifact-1 table. This is the
// build-side rendering of it (build plan §4). `piConditional` columns render
// per the per-program pi_bearing annotation; `optIn` are flagged; pruned
// columns (akoya_purpose) are never offered.
const DEFAULT_COLUMNS = Object.freeze([
  { field: 'akoya_requestnum', label: 'Request #' },
  { field: 'wmkf_meetingdate', label: 'Meeting date' },
  { field: 'akoya_requeststatus', label: 'Lifecycle status' },
  { field: 'wmkf_request_type', label: 'Request type (WMKF)' },
  { field: 'akoya_requesttype', label: 'Request type (Akoya)' },
  { field: 'akoya_applicantid', label: 'Applicant org', lookup: 'account' },
  { field: 'wmkf_type', label: 'Type' },
  { field: 'akoya_programid', label: 'Internal Program', lookup: 'akoya_program' },
  { field: 'akoya_title', label: 'Title' },
  { field: 'wmkf_donorname', label: 'Donor' },
  { field: 'wmkf_wmkfprojectdescription', label: 'WMKF description' },
  // Program-conditional DEFAULT — the PI (user-attested S159). Rendered via
  // the per-program pi_bearing annotation; never blank, never guessed.
  { field: 'wmkf_projectleader', label: 'Project Leader (PI)',
    lookup: 'contact', piConditional: true },
  { field: 'akoya_grant', label: 'Grant (awarded) amount', money: true },
  { field: 'akoya_recommendedamount', label: 'Recommended amount', money: true },
  { field: 'wmkf_invitedamount', label: 'Invited amount', money: true },
  { field: 'akoya_decisiondate', label: 'Decision date' },
  { field: 'wmkf_phaseistatus', label: 'Phase I status' },
  { field: 'akoya_fiscalyear', label: 'Fiscal year' },
  // The Request's own copy of the Primary Contact — NOT the PI, and for
  // Research not the current Liaison of record (the institution's Primary
  // Contact; lib/services/contacts/request-liaison.js). Mandatory caption.
  { field: 'akoya_primarycontactid', label: 'Request Primary Contact (copy)',
    lookup: 'contact', liaisonCaption: true },
  { field: 'account.address1_city', label: 'Applicant city', viaApplicant: true },
  { field: 'account.address1_stateorprovince', label: 'Applicant state',
    viaApplicant: true },
]);

const OPT_IN_COLUMNS = Object.freeze([
  { field: 'akoya_payee', label: 'Payee', lookup: 'account',
    flag: 'native-era only ~1% migrated; mostly mirrors applicant in sample, '
      + 'diverges notably (fiscal-sponsor / research-foundation); taxonomy not exhaustive' },
]);

// Never offered — analytically empty 2-value boilerplate constant (the
// plausible-wrong-answer trap). Recognition-pass pruning, S159.
const PRUNED_COLUMNS = Object.freeze(['akoya_purpose']);

export {
  ERA_CUTOVER_DATE,
  ERA,
  classifyEra,
  STATUS_CLASS,
  STATUS_VALUE_MAP,
  TERMINAL_NON_AWARD_STATUSES,
  classifyStatus,
  AMOUNT_WHICH,
  B_STRUCTURAL_AMOUNT_FIELDS,
  baseAmountField,
  OPERATIONAL_EXCLUSION,
  SHARPEST_REVIEWER_EXCLUSION,
  TEST_RECORD_APPLICANT_NAME,
  PROGRAM_ROLLUP_GRANT_TYPE_LABEL,
  PROGRAM_ROLLUP,
  DECLINE_FIELDS,
  DECLINE_TRIAGE_STATUSES,
  PER_PROGRAM_ANNOTATION,
  PER_PROGRAM_SEED_PROVENANCE,
  PROGRAM_UNATTRIBUTED_LABEL,
  programAnnotation,
  DEFAULT_COLUMNS,
  OPT_IN_COLUMNS,
  PRUNED_COLUMNS,
};
