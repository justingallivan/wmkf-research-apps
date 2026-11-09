/**
 * The Workbench request visibility predicate shared by the dashboard and
 * server-side roster readers. Keep this module dependency-free so scripts can
 * reuse the exact filter without importing the dashboard's auth chain.
 */
import { TRIAGE_STATUS } from './triageStatus.js';

// The one status literal both functions below must agree on.
export const PHASE_II_PENDING = 'Phase II Pending';

export function buildVisibilityFilter(includeSetAside) {
  const base = `akoya_requeststatus eq '${PHASE_II_PENDING}' or wmkf_triagestatus eq ${TRIAGE_STATUS.ADVANCING}`;
  return includeSetAside
    ? `(${base} or wmkf_triagestatus eq ${TRIAGE_STATUS.SET_ASIDE})`
    : `(${base}) and (wmkf_triagestatus eq null or wmkf_triagestatus ne ${TRIAGE_STATUS.SET_ASIDE})`;
}

/**
 * Row-level mirror of `buildVisibilityFilter`, for callers holding an
 * already-fetched request row instead of building an OData `$filter`. Must
 * agree with `buildVisibilityFilter` in meaning — a test in
 * tests/unit/workbench-visibility-row-predicate.test.js pins that agreement
 * against a literal truth table. One stated asymmetry: Dataverse string `eq`
 * is collation-case-insensitive, this compares exactly; `akoya_requeststatus`
 * is a controlled Akoya list value, so exact match is the assumption here.
 */
export function isVisibleRequestRow(row, includeSetAside = false) {
  const status = row?.akoya_requeststatus;
  const triage = row?.wmkf_triagestatus ?? null;
  const base = status === PHASE_II_PENDING || triage === TRIAGE_STATUS.ADVANCING;
  if (includeSetAside) return base || triage === TRIAGE_STATUS.SET_ASIDE;
  return base && triage !== TRIAGE_STATUS.SET_ASIDE;
}

// ── J27+ Research discovery (plan docs/plans/J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md, F1) ──
//
// Owner decision D1: a J27-or-later request in a readiness-only program
// (Research, resolved from the live catalog by the caller) is discoverable by
// `wmkf_readyforreview = true` alone; Set aside does not exclude it. Every
// other row keeps today's composition: the legacy clause above plus the
// readiness post-filter. The OData filter is a superset; `isDiscoverableRequestRow`
// is the exact predicate callers apply to a complete result.
import { isRequestReadyForStaff } from './requestReadiness.js';
import { parseCycleCode } from '../../lib/utils/cycle-code.js';

export const DISCOVERY_FIELDS = Object.freeze([
  'akoya_requeststatus', 'wmkf_triagestatus', '_wmkf_grantprogram_value', 'wmkf_readyforreview',
]);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LINKED_CYCLE_EXPANSION = /\bwmkf_GrantCycle\(\$select=[^)]*\bwmkf_cyclecode\b/;

/** Add the discovery projection to a caller-owned comma-separated select. */
export function withDiscoverySelect(select) {
  return [...new Set([...String(select || '').split(',').map((s) => s.trim()).filter(Boolean), ...DISCOVERY_FIELDS])].join(',');
}

/** Lower-cased, de-duplicated, GUID-shaped program ids; anything else is refused. */
function readinessOnlyIds(scope) {
  const ids = [...new Set((scope?.readinessOnlyProgramIds || []).map((id) => String(id).trim().toLowerCase()))];
  if (ids.some((id) => !GUID.test(id))) throw new Error('readinessOnlyProgramIds must be GUIDs.');
  return ids;
}

/**
 * OData superset of `isDiscoverableRequestRow`, wrapped in its own parentheses
 * so callers can `join(' and ')` it with cycle, program and PD clauses. An
 * empty scope returns today's legacy clause unchanged apart from the wrapper.
 */
export function buildDiscoveryFilter(includeSetAside, scope) {
  const legacy = buildVisibilityFilter(includeSetAside);
  const ids = readinessOnlyIds(scope);
  if (!ids.length) return `(${legacy})`;
  const programs = ids.map((id) => `_wmkf_grantprogram_value eq ${id}`).join(' or ');
  return `((${legacy}) or ((${programs}) and wmkf_readyforreview eq true))`;
}

/**
 * The projection contract is closed at the query, not the row: a selected
 * nullable field may be absent from a sparse row, so callers prove their
 * `select` and `expand` here (in their tests, on the strings they really send).
 */
export function assertDiscoveryQuery({ select, expand } = {}) {
  const fields = new Set(String(select || '').split(',').map((s) => s.trim()));
  const missing = DISCOVERY_FIELDS.filter((field) => !fields.has(field));
  if (missing.length) throw new Error(`Discovery select is missing ${missing.join(', ')}.`);
  if (!LINKED_CYCLE_EXPANSION.test(String(expand || ''))) throw new Error('Discovery query must expand the linked Grant Cycle code.');
}

/** A J27-or-later row in a readiness-only program: discoverable by readiness alone. */
export function isReadinessOnlyRow(row, scope) {
  const code = row?.wmkf_GrantCycle?.wmkf_cyclecode;
  const strict = typeof code === 'string' && /^[JD]\d{2}$/.test(code);
  const program = String(row?._wmkf_grantprogram_value || '').toLowerCase();
  return strict && parseCycleCode(code).year >= 2027 && readinessOnlyIds(scope).includes(program);
}

/**
 * Exact row predicate. Strict cycle grammar on the raw value, as
 * `isRequestReadyForStaff` applies it: a malformed or missing code, a cycle
 * before 2027, a null program, or a program outside the scope all take the
 * legacy branch, which composes `isVisibleRequestRow` and the readiness
 * post-filter exactly as callers do today.
 */
export function isDiscoverableRequestRow(row, includeSetAside, scope) {
  return isReadinessOnlyRow(row, scope)
    ? row.wmkf_readyforreview === true
    : isVisibleRequestRow(row, includeSetAside) && isRequestReadyForStaff(row);
}
