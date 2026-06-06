/**
 * @jest-environment node
 *
 * Unit tests for reviewer-roster-store (S224) — the Postgres CRUD behind the
 * Workbench Find-tab durable candidate roster. `@vercel/postgres` `sql` is
 * mocked; these cover the JS-side behavior (normalization, name filtering,
 * partitioning, return shapes) and assert the SQL guards/intent are present.
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
import { sql } from '@vercel/postgres';

const store = require('../../lib/services/reviewer-roster-store');

const REQ = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  sql.mockReset();
  sql.mockResolvedValue({ rows: [], rowCount: 0 });
});

// Flatten the interpolated values of every sql`...` call for assertions.
function allInterpolations() {
  return sql.mock.calls.flatMap((call) => call.slice(1));
}
function queryTextOf(callIndex) {
  const frags = sql.mock.calls[callIndex][0];
  return Array.isArray(frags) ? frags.join(' ') : '';
}

describe('listForRequest', () => {
  test('partitions active/excluded and collects allNames across EVERY status', async () => {
    sql.mockResolvedValueOnce({ rows: [
      { status: 'active', display_name: 'Ann Lee', candidate: { name: 'Ann Lee' } },
      { status: 'excluded', display_name: 'Bob Roe', candidate: { name: 'Bob Roe' } },
      { status: 'saved', display_name: 'Cy Poe', candidate: { name: 'Cy Poe' } },
    ] });
    const out = await store.listForRequest(REQ);
    expect(out.active.map((c) => c.name)).toEqual(['Ann Lee']);
    expect(out.excluded.map((c) => c.name)).toEqual(['Bob Roe']);
    // allNames is the cross-run dedup union — must include saved + excluded too.
    expect(out.allNames).toEqual(['Ann Lee', 'Bob Roe', 'Cy Poe']);
  });
});

describe('recordSurfaced', () => {
  test('records named candidates (normalized) and skips unnamed/blank ones', async () => {
    const n = await store.recordSurfaced(REQ, [
      { name: 'Dr. Ann Lee' }, { name: '' }, { name: '   ' }, { name: 'Bob' },
    ]);
    expect(n).toBe(2);
    const interps = allInterpolations();
    expect(interps).toContain('ann lee'); // honorific stripped + normalized
    expect(interps).toContain('bob');
  });

  test('the conflict update guards against downgrading excluded/saved (never-downgrade)', async () => {
    await store.recordSurfaced(REQ, [{ name: 'Ann Lee' }]);
    // The INSERT ... ON CONFLICT DO UPDATE must only run WHERE status='active'.
    const insertCall = sql.mock.calls.findIndex((c) =>
      Array.isArray(c[0]) && c[0].join(' ').includes('INSERT INTO reviewer_find_roster'));
    expect(insertCall).toBeGreaterThanOrEqual(0);
    expect(queryTextOf(insertCall)).toMatch(/status = 'active'/);
  });
});

describe('setExcluded', () => {
  test('upserts (eviction-tolerant) and forces status excluded', async () => {
    await store.setExcluded(REQ, { name: 'Bob Roe' });
    const text = queryTextOf(0);
    expect(text).toMatch(/INSERT INTO reviewer_find_roster/);
    expect(text).toMatch(/status = 'excluded'/);
    expect(allInterpolations()).toContain('bob roe');
  });

  test('throws on a nameless candidate', async () => {
    await expect(store.setExcluded(REQ, { name: '' })).rejects.toThrow(/name required/);
  });
});

describe('promote', () => {
  test('returns the stored candidate blob on success', async () => {
    sql.mockResolvedValueOnce({ rows: [{ candidate: { name: 'Bob Roe', hIndex: 9 } }] });
    const blob = await store.promote(REQ, 'Bob Roe');
    expect(blob).toEqual({ name: 'Bob Roe', hIndex: 9 });
    expect(queryTextOf(0)).toMatch(/status = 'excluded'/); // only promotes from excluded
  });

  test('no-op (null) when the row is gone (cap eviction)', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    expect(await store.promote(REQ, 'Ghost')).toBeNull();
  });
});

describe('markSaved', () => {
  test('upserts each named row to saved (eviction-tolerant, leaving excluded untouched)', async () => {
    const n = await store.markSaved(REQ, ['Ann Lee', 'Bob Roe', '']);
    expect(n).toBe(2); // one upsert per valid name; blank dropped
    expect(sql).toHaveBeenCalledTimes(2);
    const text = queryTextOf(0);
    expect(text).toMatch(/INSERT INTO reviewer_find_roster/); // upsert, not bare UPDATE → eviction-tolerant
    expect(text).toMatch(/status = 'saved'/);
    expect(text).toMatch(/status <> 'excluded'/);
    expect(allInterpolations()).toEqual(expect.arrayContaining(['ann lee', 'bob roe']));
  });

  test('no-op (0) on an empty name list — no sql issued', async () => {
    const n = await store.markSaved(REQ, ['', '   ']);
    expect(n).toBe(0);
    expect(sql).not.toHaveBeenCalled();
  });
});
