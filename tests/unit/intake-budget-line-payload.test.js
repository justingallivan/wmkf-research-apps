/**
 * intake-budget-line-payload.test.js
 *
 * Covers the budget-line shape helpers used by /api/intake/submit
 * (validation at submit-entry) and /api/cron/drain-submissions
 * (validation at drain-entry + the Dataverse POST body builder).
 *
 * The numeric category integers + the Personnel-only headcount/effortPct
 * rule are load-bearing — a regression here would surface as a
 * production validation_400 instead of a clean 422 to the applicant.
 */

const {
  validateBudgetLineRow,
  buildBudgetLinePayload,
  synthesizeName,
  VALID_CATEGORIES,
  COSTSHARE_CATEGORIES,
  PERSONNEL_CATEGORY,
  CATEGORY_LABEL,
} = require('../../lib/utils/intake-budget-line-payload.js');

const REQUEST_ID = '11111111-2222-3333-4444-555555555555';

function validRow(overrides = {}) {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    year: 1,
    category: 100000001, // Equipment
    amount: 12500,
    lineOrder: 0,
    description: 'Confocal microscope',
    ...overrides,
  };
}

describe('VALID_CATEGORIES / COSTSHARE_CATEGORIES / labels', () => {
  test('exactly 10 categories', () => {
    expect(VALID_CATEGORIES.size).toBe(10);
  });
  test('costshare set has the 3 expected integers', () => {
    expect([...COSTSHARE_CATEGORIES].sort()).toEqual([100000007, 100000008, 100000009]);
  });
  test('Personnel = 100000000', () => {
    expect(PERSONNEL_CATEGORY).toBe(100000000);
  });
  test('every valid category has a label', () => {
    for (const c of VALID_CATEGORIES) {
      expect(typeof CATEGORY_LABEL[c]).toBe('string');
      expect(CATEGORY_LABEL[c].length).toBeGreaterThan(0);
    }
  });
});

describe('synthesizeName', () => {
  test('with description: Y{year} — {label}: {description}', () => {
    expect(synthesizeName(2, 100000001, 'Microscope')).toBe('Y2 — Equipment: Microscope');
  });
  test('without description: Y{year} — {label}', () => {
    expect(synthesizeName(1, 100000006, '')).toBe('Y1 — Indirect');
    expect(synthesizeName(1, 100000006, null)).toBe('Y1 — Indirect');
  });
  test('truncates with ellipsis at 160 chars', () => {
    const long = 'x'.repeat(200);
    const out = synthesizeName(1, 100000001, long);
    expect(out.length).toBe(160);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('validateBudgetLineRow — happy path', () => {
  test('valid Equipment row passes', () => {
    expect(() => validateBudgetLineRow(validRow(), 0)).not.toThrow();
  });
  test('Personnel row with headcount + effortPct passes', () => {
    expect(() => validateBudgetLineRow(validRow({
      category: 100000000, headcount: 2, effortPct: 50,
    }), 0)).not.toThrow();
  });
  test('Indirect row at $0 passes (the convention)', () => {
    expect(() => validateBudgetLineRow(validRow({
      category: 100000006, amount: 0,
    }), 0)).not.toThrow();
  });
  test('cost-share row passes', () => {
    expect(() => validateBudgetLineRow(validRow({
      category: 100000009, amount: 5000, description: 'University commitment',
    }), 0)).not.toThrow();
  });
});

describe('validateBudgetLineRow — required fields', () => {
  test('non-object → throws', () => {
    expect(() => validateBudgetLineRow(null, 0)).toThrow('must be an object');
  });
  test('year out of range', () => {
    expect(() => validateBudgetLineRow(validRow({ year: 0 }), 3))
      .toThrow(/budget_lines\[3\]: year must be integer 1\.\.10/);
    expect(() => validateBudgetLineRow(validRow({ year: 11 }), 0))
      .toThrow(/year must be integer 1\.\.10/);
    expect(() => validateBudgetLineRow(validRow({ year: 1.5 }), 0))
      .toThrow(/year must be integer 1\.\.10/);
  });
  test('invalid category integer', () => {
    expect(() => validateBudgetLineRow(validRow({ category: 999 }), 0))
      .toThrow(/invalid category 999/);
    expect(() => validateBudgetLineRow(validRow({ category: '100000001' }), 0))
      .toThrow(/invalid category/);
  });
  test('amount negative or non-number', () => {
    expect(() => validateBudgetLineRow(validRow({ amount: -1 }), 0))
      .toThrow(/amount must be number >= 0/);
    expect(() => validateBudgetLineRow(validRow({ amount: '100' }), 0))
      .toThrow(/amount must be number >= 0/);
    expect(() => validateBudgetLineRow(validRow({ amount: NaN }), 0))
      .toThrow(/amount must be number >= 0/);
  });
  test('lineOrder out of range', () => {
    expect(() => validateBudgetLineRow(validRow({ lineOrder: -1 }), 0))
      .toThrow(/lineOrder/);
    expect(() => validateBudgetLineRow(validRow({ lineOrder: 100001 }), 0))
      .toThrow(/lineOrder/);
  });
});

describe('validateBudgetLineRow — string lengths', () => {
  test('description over 500 chars rejected', () => {
    expect(() => validateBudgetLineRow(validRow({ description: 'x'.repeat(501) }), 0))
      .toThrow(/description exceeds 500/);
  });
  test('roleCode over 60 chars rejected', () => {
    expect(() => validateBudgetLineRow(validRow({ roleCode: 'x'.repeat(61) }), 0))
      .toThrow(/roleCode exceeds 60/);
  });
});

describe('validateBudgetLineRow — Personnel-only field guards', () => {
  test('headcount on non-Personnel row → throws', () => {
    expect(() => validateBudgetLineRow(validRow({
      category: 100000001, headcount: 2,
    }), 0)).toThrow(/headcount only valid for Personnel rows/);
  });
  test('effortPct on non-Personnel row → throws', () => {
    expect(() => validateBudgetLineRow(validRow({
      category: 100000003, effortPct: 50,
    }), 0)).toThrow(/effortPct only valid for Personnel rows/);
  });
  test('headcount range check on Personnel row', () => {
    expect(() => validateBudgetLineRow(validRow({
      category: 100000000, headcount: -1,
    }), 0)).toThrow(/headcount must be integer 0\.\.100000/);
  });
  test('effortPct range check on Personnel row', () => {
    expect(() => validateBudgetLineRow(validRow({
      category: 100000000, effortPct: 101,
    }), 0)).toThrow(/effortPct must be integer 0\.\.100/);
  });
});

describe('buildBudgetLinePayload — Dataverse POST body shape', () => {
  test('happy path emits all required fields + odata bind', () => {
    const body = buildBudgetLinePayload(validRow(), REQUEST_ID);
    expect(body).toEqual({
      wmkf_proposalbudgetlineid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      wmkf_name: 'Y1 — Equipment: Confocal microscope',
      wmkf_year: 1,
      wmkf_category: 100000001,
      wmkf_amount: 12500,
      wmkf_lineorder: 0,
      wmkf_description: 'Confocal microscope',
      'wmkf_Request@odata.bind': `/akoya_requests(${REQUEST_ID})`,
    });
  });
  test('description null omits wmkf_description', () => {
    const body = buildBudgetLinePayload(validRow({ description: null }), REQUEST_ID);
    expect(body).not.toHaveProperty('wmkf_description');
  });
  test('Personnel row includes headcount + effortPct', () => {
    const body = buildBudgetLinePayload(validRow({
      category: 100000000, headcount: 3, effortPct: 25,
    }), REQUEST_ID);
    expect(body.wmkf_headcount).toBe(3);
    expect(body.wmkf_effortpct).toBe(25);
  });
  test('non-Personnel row does NOT include headcount/effortPct (even if input has them stripped)', () => {
    const body = buildBudgetLinePayload(validRow({ category: 100000001 }), REQUEST_ID);
    expect(body).not.toHaveProperty('wmkf_headcount');
    expect(body).not.toHaveProperty('wmkf_effortpct');
  });
  test('roleCode included when present', () => {
    const body = buildBudgetLinePayload(validRow({ roleCode: 'principal-investigators' }), REQUEST_ID);
    expect(body.wmkf_rolecode).toBe('principal-investigators');
  });
  test('PascalCase nav-property key — wmkf_Request not wmkf_request', () => {
    const body = buildBudgetLinePayload(validRow(), REQUEST_ID);
    expect(Object.keys(body)).toContain('wmkf_Request@odata.bind');
    expect(Object.keys(body)).not.toContain('wmkf_request@odata.bind');
  });
  test('throws when row.id missing', () => {
    const { id, ...rest } = validRow();
    expect(() => buildBudgetLinePayload(rest, REQUEST_ID)).toThrow(/row\.id required/);
  });
  test('throws when requestId missing', () => {
    expect(() => buildBudgetLinePayload(validRow(), null)).toThrow(/requestId required/);
  });
});
