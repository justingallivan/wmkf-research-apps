/**
 * The Workbench request visibility predicate shared by the dashboard and
 * server-side roster readers. Keep this module dependency-free so scripts can
 * reuse the exact filter without importing the dashboard's auth chain.
 */
import { TRIAGE_STATUS } from './triageStatus.js';

export function buildVisibilityFilter(includeSetAside) {
  const base = `akoya_requeststatus eq 'Phase II Pending' or wmkf_triagestatus eq ${TRIAGE_STATUS.ADVANCING}`;
  return includeSetAside
    ? `(${base} or wmkf_triagestatus eq ${TRIAGE_STATUS.SET_ASIDE})`
    : `(${base}) and (wmkf_triagestatus eq null or wmkf_triagestatus ne ${TRIAGE_STATUS.SET_ASIDE})`;
}

/**
 * Row-level mirror of `buildVisibilityFilter`, for callers holding an
 * already-fetched request row instead of building an OData `$filter`. Must
 * agree with `buildVisibilityFilter` in meaning — a test in
 * tests/unit/workbench-visibility-row-predicate.test.js pins that agreement.
 */
export function isVisibleRequestRow(row, includeSetAside = false) {
  const status = row?.akoya_requeststatus;
  const triage = row?.wmkf_triagestatus ?? null;
  const base = status === 'Phase II Pending' || triage === TRIAGE_STATUS.ADVANCING;
  if (includeSetAside) return base || triage === TRIAGE_STATUS.SET_ASIDE;
  return base && triage !== TRIAGE_STATUS.SET_ASIDE;
}
