import { buildVisibilityFilter, isVisibleRequestRow } from '../../shared/config/workbenchVisibility';
import { TRIAGE_STATUS } from '../../shared/config/triageStatus';

// Pins that `isVisibleRequestRow` (row-level predicate) and
// `buildVisibilityFilter` (OData filter string) agree in meaning. This is a
// structural agreement check, not a full OData evaluator: it hand-derives the
// expected boolean per fixture and separately asserts the filter string
// mentions the same clauses.
const STATUSES = ['Phase II Pending', 'Phase I Pending'];
const TRIAGES = [null, TRIAGE_STATUS.ADVANCING, TRIAGE_STATUS.SET_ASIDE];
const INCLUDE_SET_ASIDE = [false, true];

function expectedVisible(status, triage, includeSetAside) {
  const base = status === 'Phase II Pending' || triage === TRIAGE_STATUS.ADVANCING;
  if (includeSetAside) return base || triage === TRIAGE_STATUS.SET_ASIDE;
  return base && triage !== TRIAGE_STATUS.SET_ASIDE;
}

describe('isVisibleRequestRow matches the hand-derived truth table', () => {
  for (const status of STATUSES) {
    for (const triage of TRIAGES) {
      for (const includeSetAside of INCLUDE_SET_ASIDE) {
        const label = `status=${status} triage=${triage} includeSetAside=${includeSetAside}`;
        test(label, () => {
          const row = { akoya_requeststatus: status, wmkf_triagestatus: triage };
          expect(isVisibleRequestRow(row, includeSetAside)).toBe(
            expectedVisible(status, triage, includeSetAside),
          );
        });
      }
    }
  }
});

describe('buildVisibilityFilter mentions the same clauses as the row predicate', () => {
  test('includeSetAside=false filter mentions Phase II Pending, the ADVANCING value, and an ne SET_ASIDE clause', () => {
    const filter = buildVisibilityFilter(false);
    expect(filter).toContain('Phase II Pending');
    expect(filter).toContain(`wmkf_triagestatus eq ${TRIAGE_STATUS.ADVANCING}`);
    expect(filter).toContain(`ne ${TRIAGE_STATUS.SET_ASIDE}`);
  });

  test('includeSetAside=true filter mentions Phase II Pending and the ADVANCING value', () => {
    const filter = buildVisibilityFilter(true);
    expect(filter).toContain('Phase II Pending');
    expect(filter).toContain(`wmkf_triagestatus eq ${TRIAGE_STATUS.ADVANCING}`);
  });
});
