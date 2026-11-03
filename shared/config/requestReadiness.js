/**
 * PD discovery prerequisite, independent of lifecycle/action eligibility.
 * Power Automate owns real-intake wmkf_readyforreview; the prepared Factory
 * has a separate guarded test-fixture finalizer. This predicate only reads. Only an
 * explicitly linked pre-J27 cycle is exempt. No request-date fallback.
 * Callers must fetch the complete roster before filtering/counting, select
 * wmkf_readyforreview, and expand wmkf_GrantCycle($select=wmkf_cyclecode).
 */
import { parseCycleCode } from '../../lib/utils/cycle-code.js';

export function isRequestReadyForStaff(row) {
  const code = row?.wmkf_GrantCycle?.wmkf_cyclecode;
  // Match the canonical linkedCycleCode contract; a malformed/missing expansion
  // cannot establish the historical exemption, even when readiness is true.
  if (typeof code !== 'string' || !/^[JD]\d{2}$/.test(code)) return false;
  const { year } = parseCycleCode(code);
  return year < 2027 || row.wmkf_readyforreview === true;
}

/** Add the raw Boolean field to a caller-owned comma-separated projection. */
export function withRequestReadinessSelect(select) {
  return [...new Set([...select.split(','), 'wmkf_readyforreview'])].join(',');
}
