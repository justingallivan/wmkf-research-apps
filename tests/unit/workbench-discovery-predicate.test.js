/**
 * Plan F1/F3: the J27+ Research discovery predicate and its OData superset.
 * Expected values are a literal table derived from owner decision D1, not a
 * copy of the implementation. `supersetAdmits` is a hand-written reading of
 * the OData filter's meaning so the exact predicate can be proven to imply it.
 */
import {
  DISCOVERY_FIELDS, withDiscoverySelect, buildDiscoveryFilter, assertDiscoveryQuery, isDiscoverableRequestRow,
  isVisibleRequestRow, buildVisibilityFilter,
} from '../../shared/config/workbenchVisibility';
import { isRequestReadyForStaff } from '../../shared/config/requestReadiness';
import { TRIAGE_STATUS } from '../../shared/config/triageStatus';

const P2 = 'Phase II Pending';
const P1 = 'Phase I Pending';
const ADV = TRIAGE_STATUS.ADVANCING;
const SET = TRIAGE_STATUS.SET_ASIDE;
const RESEARCH = '11111111-1111-4111-8111-111111111111';
const SOCAL = '22222222-2222-4222-8222-222222222222';
const SCOPE = { readinessOnlyProgramIds: [RESEARCH] };
const EMPTY = { readinessOnlyProgramIds: [] };
const EXPAND = 'wmkf_GrantCycle($select=wmkf_cyclecode)';

const row = ({ status = P2, triage = null, program = RESEARCH, ready = null, code = 'J27' } = {}) => ({
  akoya_requeststatus: status,
  wmkf_triagestatus: triage,
  _wmkf_grantprogram_value: program,
  wmkf_readyforreview: ready,
  // `MISSING` omits the expansion entirely (a default parameter cannot express undefined).
  ...(code === 'MISSING' ? {} : { wmkf_GrantCycle: code === null ? null : { wmkf_cyclecode: code } }),
});

describe('isDiscoverableRequestRow truth table (D1)', () => {
  // [label, row, includeSetAside, scope, expected]
  const TABLE = [
    ['J27 Research ready, not Advancing', row({ status: P1, ready: true }), false, SCOPE, true],
    ['J27 Research ready, Set aside, default view', row({ status: P1, triage: SET, ready: true }), false, SCOPE, true],
    ['J27 Research unready, Advancing', row({ status: P1, triage: ADV, ready: false }), false, SCOPE, false],
    ['J27 Research unready, Phase II Pending', row({ status: P2, ready: false }), false, SCOPE, false],
    ['J27 Research readiness null', row({ status: P2, ready: null }), false, SCOPE, false],
    ['J27 SoCal ready, not Advancing', row({ status: P1, program: SOCAL, ready: true }), false, SCOPE, false],
    ['J27 SoCal Phase II Pending, ready', row({ status: P2, program: SOCAL, ready: true }), false, SCOPE, true],
    ['J27 SoCal Phase II Pending, unready', row({ status: P2, program: SOCAL, ready: false }), false, SCOPE, false],
    ['D26 Research ready, Set aside, default view (legacy hides)', row({ status: P2, triage: SET, ready: true, code: 'D26' }), false, SCOPE, false],
    ['D26 Research ready, Set aside, includeSetAside', row({ status: P2, triage: SET, ready: true, code: 'D26' }), true, SCOPE, true],
    ['D26 Research Phase II Pending (readiness exempt before 2027)', row({ status: P2, ready: null, code: 'D26' }), false, SCOPE, true],
    ['D26 Research not Advancing', row({ status: P1, ready: true, code: 'D26' }), false, SCOPE, false],
    ['null program takes the legacy branch', row({ status: P1, program: null, ready: true }), false, SCOPE, false],
    ['null program, Phase II Pending, ready', row({ status: P2, program: null, ready: true }), false, SCOPE, true],
    ['lowercase cycle code is not strict', row({ status: P1, ready: true, code: 'j27' }), false, SCOPE, false],
    ['padded cycle code is not strict', row({ status: P1, ready: true, code: ' J27 ' }), false, SCOPE, false],
    ['missing expansion', row({ status: P1, ready: true, code: 'MISSING' }), false, SCOPE, false],
    ['null expansion', row({ status: P1, ready: true, code: null }), false, SCOPE, false],
    ['missing expansion, Phase II Pending, ready (legacy readiness needs the code)', row({ status: P2, ready: true, code: 'MISSING' }), false, SCOPE, false],
    ['empty scope: J27 Research ready, not Advancing', row({ status: P1, ready: true }), false, EMPTY, false],
    ['empty scope: J27 Research Phase II Pending, ready', row({ status: P2, ready: true }), false, EMPTY, true],
    ['upper-cased program id in the row still matches', row({ status: P1, ready: true, program: RESEARCH.toUpperCase() }), false, SCOPE, true],
  ];
  test.each(TABLE)('%s → %s', (_label, r, includeSetAside, scope, expected) => {
    expect(isDiscoverableRequestRow(r, includeSetAside, scope)).toBe(expected);
  });

  test('empty scope equals today\'s composition for every row', () => {
    for (const r of allRows()) for (const i of [false, true]) {
      expect(isDiscoverableRequestRow(r, i, EMPTY)).toBe(isVisibleRequestRow(r, i) && isRequestReadyForStaff(r));
    }
  });

  test('non-GUID scope ids are refused', () => {
    expect(() => isDiscoverableRequestRow(row(), false, { readinessOnlyProgramIds: ['research'] })).toThrow('GUID');
    expect(() => buildDiscoveryFilter(false, { readinessOnlyProgramIds: ["x' or 1 eq 1"] })).toThrow('GUID');
  });
});

/** Literal reading of the OData superset: legacy clause OR (program in scope AND ready eq true). */
function supersetAdmits(r, includeSetAside, scope) {
  const status = r.akoya_requeststatus;
  const triage = r.wmkf_triagestatus ?? null;
  const base = status === P2 || triage === ADV;
  const legacy = includeSetAside ? (base || triage === SET) : (base && triage !== SET);
  const program = String(r._wmkf_grantprogram_value || '').toLowerCase();
  const inScope = scope.readinessOnlyProgramIds.map((s) => s.toLowerCase()).includes(program);
  return legacy || (inScope && r.wmkf_readyforreview === true);
}

function* allRows() {
  for (const status of [P2, P1, null])
    for (const triage of [null, ADV, SET])
      for (const program of [RESEARCH, SOCAL, null])
        for (const ready of [true, false, null])
          for (const code of ['J27', 'D26', 'j27', null, 'MISSING', 'X1'])
            yield row({ status, triage, program, ready, code });
}

describe('the OData filter is a superset of the exact predicate', () => {
  test('exhaustively: exact(row) implies superset(row), both scopes, both views', () => {
    let checked = 0;
    for (const r of allRows()) for (const i of [false, true]) for (const scope of [SCOPE, EMPTY]) {
      if (isDiscoverableRequestRow(r, i, scope)) expect(supersetAdmits(r, i, scope)).toBe(true);
      checked += 1;
    }
    expect(checked).toBe(3 * 3 * 3 * 3 * 6 * 2 * 2);
  });

  test('filter string: empty scope is the legacy clause in its own parentheses', () => {
    expect(buildDiscoveryFilter(false, EMPTY)).toBe(`(${buildVisibilityFilter(false)})`);
    expect(buildDiscoveryFilter(true, EMPTY)).toBe(`(${buildVisibilityFilter(true)})`);
  });

  test('filter string: scoped filter ORs the program/readiness disjunct inside outer parentheses', () => {
    const filter = buildDiscoveryFilter(false, SCOPE);
    expect(filter).toBe(`((${buildVisibilityFilter(false)}) or ((_wmkf_grantprogram_value eq ${RESEARCH}) and wmkf_readyforreview eq true))`);
    expect(filter.startsWith('((')).toBe(true);
    expect(filter.endsWith('))')).toBe(true);
    const two = buildDiscoveryFilter(false, { readinessOnlyProgramIds: [RESEARCH, SOCAL.toUpperCase(), RESEARCH] });
    expect(two).toContain(`(_wmkf_grantprogram_value eq ${RESEARCH} or _wmkf_grantprogram_value eq ${SOCAL})`);
  });

  test('composition: an out-of-cycle, out-of-PD or out-of-program ready Research row cannot escape the ANDed clauses', () => {
    const composed = ["(wmkf_GrantCycle/wmkf_cyclecode eq 'J27')", `_wmkf_grantprogram_value eq ${RESEARCH}`, buildDiscoveryFilter(false, SCOPE), '_wmkf_programdirector_value eq pd'].join(' and ');
    // Each clause sits at top level between ANDs: the discovery OR never opens a top-level OR.
    let depth = 0; const topLevelOrs = [];
    for (let k = 0; k < composed.length; k += 1) {
      if (composed[k] === '(') depth += 1;
      else if (composed[k] === ')') depth -= 1;
      else if (depth === 0 && composed.slice(k, k + 4) === ' or ') topLevelOrs.push(k);
    }
    expect(topLevelOrs).toEqual([]);
  });
});

describe('projection contract', () => {
  test('withDiscoverySelect adds the four fields once', () => {
    const out = withDiscoverySelect('akoya_requestid,akoya_requeststatus');
    expect(out.split(',')).toEqual(['akoya_requestid', ...DISCOVERY_FIELDS]);
    expect(withDiscoverySelect(out)).toBe(out);
  });
  test('assertDiscoveryQuery: valid select and expand pass', () => {
    expect(() => assertDiscoveryQuery({ select: withDiscoverySelect('akoya_requestid'), expand: EXPAND })).not.toThrow();
  });
  test('assertDiscoveryQuery: a missing field or missing expansion fails', () => {
    expect(() => assertDiscoveryQuery({ select: 'akoya_requestid,akoya_requeststatus,wmkf_triagestatus,wmkf_readyforreview', expand: EXPAND })).toThrow('_wmkf_grantprogram_value');
    expect(() => assertDiscoveryQuery({ select: withDiscoverySelect(''), expand: '' })).toThrow('Grant Cycle');
    expect(() => assertDiscoveryQuery({ select: withDiscoverySelect(''), expand: 'wmkf_GrantCycle($select=wmkf_name)' })).toThrow('Grant Cycle');
  });
  test('sparse rows (selected nullable fields omitted) evaluate without throwing', () => {
    for (const omitted of DISCOVERY_FIELDS) {
      const r = row({ status: P2, ready: true }); delete r[omitted];
      expect(() => isDiscoverableRequestRow(r, false, SCOPE)).not.toThrow();
    }
    expect(isDiscoverableRequestRow({ akoya_requeststatus: P2, wmkf_GrantCycle: { wmkf_cyclecode: 'D26' } }, false, SCOPE)).toBe(true);
  });
});
