/**
 * The Workbench request visibility predicate shared by the dashboard and
 * server-side roster readers. Keep this module dependency-free so scripts can
 * reuse the exact filter without importing the dashboard's auth chain.
 */
import { TRIAGE_STATUS } from './triageStatus.js';

// The one status literal both functions below must agree on.
const PHASE_II_PENDING = 'Phase II Pending';

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
