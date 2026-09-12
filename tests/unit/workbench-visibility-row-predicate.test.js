import { buildVisibilityFilter, isVisibleRequestRow } from '../../shared/config/workbenchVisibility';
import { TRIAGE_STATUS } from '../../shared/config/triageStatus';

// Pins that `isVisibleRequestRow` (row-level predicate) and
// `buildVisibilityFilter` (OData filter string) agree in meaning. The expected
// values are a LITERAL table derived by hand from the OData semantics
// (`(status eq 'Phase II Pending' or triage eq ADVANCING) and (triage eq null
// or triage ne SET_ASIDE)`), not a copy of the implementation, so a shared
// misreading of the null/`ne` cell cannot hide on both sides. The second
// describe is a structural check on the filter string, not an OData evaluator.
const P2 = 'Phase II Pending';
const P1 = 'Phase I Pending';
const ADV = TRIAGE_STATUS.ADVANCING;
const SET = TRIAGE_STATUS.SET_ASIDE;

// [status, triage, includeSetAside, expected]
const TRUTH_TABLE = [
  [P2, null, false, true],
  [P2, ADV, false, true],
  [P2, SET, false, false],
  [P1, null, false, false],
  [P1, ADV, false, true],
  [P1, SET, false, false],
  [P2, null, true, true],
  [P2, ADV, true, true],
  [P2, SET, true, true],
  [P1, null, true, false],
  [P1, ADV, true, true],
  [P1, SET, true, true],
];

describe('isVisibleRequestRow matches the literal truth table', () => {
  test.each(TRUTH_TABLE)('status=%s triage=%s includeSetAside=%s → %s', (status, triage, includeSetAside, expected) => {
    expect(isVisibleRequestRow({ akoya_requeststatus: status, wmkf_triagestatus: triage }, includeSetAside)).toBe(expected);
  });

  test('an absent triage field (unset picklist under $select) behaves as null', () => {
    expect(isVisibleRequestRow({ akoya_requeststatus: P2 }, false)).toBe(true);
    expect(isVisibleRequestRow({ akoya_requeststatus: P1 }, false)).toBe(false);
  });

  test('the table covers every cell exactly once', () => {
    const keys = new Set(TRUTH_TABLE.map(([s, t, i]) => `${s}|${t}|${i}`));
    expect(keys.size).toBe(12);
  });
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
