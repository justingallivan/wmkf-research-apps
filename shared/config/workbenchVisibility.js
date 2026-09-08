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
