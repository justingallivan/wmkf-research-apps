/**
 * Tests for the decision logic in scripts/probe-etag-parent-bump.js.
 *
 * The probe answers whether creating a child row bumps the parent record's
 * ETag, which decides whether the reviewer-merge pre-deactivate re-check
 * (S423) is necessary or redundant. A wrong verdict here would either strand a
 * real concurrency hole or justify reverting a correct guard, so the
 * classification is tested rather than trusted.
 *
 * The asymmetry is the point: ONE parent sitting below its newest child
 * disproves the bump, while zero such parents is only consistent with it.
 *
 * @jest-environment node
 */

const {
  etagVersion,
  analyze,
  checkMonotonicity,
  conclude,
} = require('../../scripts/probe-etag-parent-bump.js');

const PARENT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PARENT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const parent = (id, version, modifiedon) => ({
  wmkf_potentialreviewersid: id,
  '@odata.etag': `W/"${version}"`,
  createdon: '2026-01-01T00:00:00Z',
  modifiedon,
});
const child = (id, parentId, version, createdon) => ({
  wmkf_appreviewersuggestionid: id,
  _wmkf_potentialreviewer_value: parentId,
  '@odata.etag': `W/"${version}"`,
  createdon,
});

const healthyMonotonicity = { checked: 500, agreed: 500, agreementRate: 1 };

describe('etagVersion', () => {
  test('parses the Dataverse weak-ETag shape and rejects everything else', () => {
    expect(etagVersion({ '@odata.etag': 'W/"1234567"' })).toBe(1234567);
    expect(etagVersion({ '@odata.etag': 'W/"not-a-number"' })).toBeNull();
    expect(etagVersion({})).toBeNull();
    expect(etagVersion(null)).toBeNull();
  });
});

describe('analyze — classification', () => {
  test('parent below its newest child is the decisive case', () => {
    const { counts, cases } = analyze(
      [parent(PARENT_A, 100, '2026-01-01T00:00:00Z')],
      [child('c1', PARENT_A, 500, '2026-03-01T00:00:00Z')],
    );
    expect(counts['parent-behind-child']).toBe(1);
    expect(cases[0].verdict).toBe('parent-behind-child');
  });

  test('parent written well after its child is NOT evidence of a bump', () => {
    // Ordinary later edit: an email fix months after the suggestion was created.
    const { counts } = analyze(
      [parent(PARENT_A, 900, '2026-06-01T00:00:00Z')],
      [child('c1', PARENT_A, 500, '2026-03-01T00:00:00Z')],
    );
    expect(counts['parent-ahead-of-child']).toBe(1);
    expect(counts['parent-behind-child']).toBe(0);
  });

  test('parent modified within a minute of child creation is coincident, not proof', () => {
    const { counts } = analyze(
      [parent(PARENT_A, 900, '2026-03-01T00:00:30Z')],
      [child('c1', PARENT_A, 500, '2026-03-01T00:00:00Z')],
    );
    expect(counts.coincident).toBe(1);
    expect(counts['parent-behind-child']).toBe(0);
  });

  test('compares against the NEWEST child, not an arbitrary one', () => {
    // An old child would make the parent look "ahead"; the newest one shows it
    // is actually behind. Picking the wrong child inverts the verdict.
    const { counts, cases } = analyze(
      [parent(PARENT_A, 400, '2026-02-01T00:00:00Z')],
      [
        child('c-old', PARENT_A, 100, '2026-01-01T00:00:00Z'),
        child('c-new', PARENT_A, 900, '2026-05-01T00:00:00Z'),
      ],
    );
    expect(cases[0].newestChildVersion).toBe(900);
    expect(counts['parent-behind-child']).toBe(1);
  });

  test('parents with no children, and rows missing a version, are excluded', () => {
    const noVersion = { ...parent(PARENT_B, 1, '2026-01-01T00:00:00Z') };
    delete noVersion['@odata.etag'];
    const { cases, missingVersion } = analyze(
      [parent(PARENT_A, 100, '2026-01-01T00:00:00Z'), noVersion],
      [child('c1', PARENT_B, 500, '2026-03-01T00:00:00Z')],
    );
    expect(cases).toHaveLength(0); // PARENT_A childless, PARENT_B unusable
    expect(missingVersion).toBe(1);
  });

  test('parent id casing does not break the child join', () => {
    const { counts } = analyze(
      [parent(PARENT_A.toUpperCase(), 100, '2026-01-01T00:00:00Z')],
      [child('c1', PARENT_A.toLowerCase(), 500, '2026-03-01T00:00:00Z')],
    );
    expect(counts['parent-behind-child']).toBe(1);
  });
});

describe('conclude — verdicts', () => {
  test('one decisive case is enough to disprove the bump', () => {
    const { verdict } = conclude(
      { 'parent-behind-child': 1, coincident: 240, 'parent-ahead-of-child': 800 },
      healthyMonotonicity,
      1041,
    );
    expect(verdict).toBe('CREATION-DOES-NOT-BUMP-PARENT');
  });

  test('zero decisive cases is only CONSISTENT WITH a bump, never proof', () => {
    const { verdict, detail } = conclude(
      { 'parent-behind-child': 0, coincident: 900, 'parent-ahead-of-child': 100 },
      healthyMonotonicity,
      1000,
    );
    expect(verdict).toBe('CONSISTENT-WITH-PARENT-BUMP');
    expect(detail).toMatch(/not proof/i);
  });

  test('broken monotonicity invalidates the method and outranks the counts', () => {
    // Even with a decisive-looking count, the comparison is meaningless if
    // versionnumber is not an org-wide monotonic counter.
    const { verdict } = conclude(
      { 'parent-behind-child': 50, coincident: 0, 'parent-ahead-of-child': 0 },
      { checked: 500, agreed: 300, agreementRate: 0.6 },
      50,
    );
    expect(verdict).toBe('METHOD-INVALID');
  });

  test('an empty population reports NO-DATA rather than a bump verdict', () => {
    const { verdict } = conclude(
      { 'parent-behind-child': 0, coincident: 0, 'parent-ahead-of-child': 0 },
      healthyMonotonicity,
      0,
    );
    expect(verdict).toBe('NO-DATA');
  });
});

describe('checkMonotonicity', () => {
  test('agrees on a consistently ordered population', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      version: i * 10,
      createdOnMs: 1_700_000_000_000 + i * 60_000,
    }));
    const result = checkMonotonicity(rows);
    expect(result.checked).toBeGreaterThan(0);
    expect(result.agreementRate).toBe(1);
  });

  test('detects a scrambled population', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      version: i * 10,
      createdOnMs: 1_700_000_000_000 + ((i * 37) % 60) * 60_000,
    }));
    expect(checkMonotonicity(rows).agreementRate).toBeLessThan(0.95);
  });

  test('too little usable data reports no rate rather than a false 100%', () => {
    expect(checkMonotonicity([{ version: 1, createdOnMs: 1 }]).agreementRate).toBeNull();
    expect(checkMonotonicity([]).agreementRate).toBeNull();
  });
});
