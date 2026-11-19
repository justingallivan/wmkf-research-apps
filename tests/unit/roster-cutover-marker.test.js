/** @jest-environment node */
const { legacyRosterMoved, assertLegacyRosterWritable, PRODUCTION_ROSTER_HOST } = require('../../lib/services/expertise-finder/roster-cutover-marker.cjs');

// Fake query over an in-memory binding table; `present=false` models the pre-migration DB.
function fakeQuery({ present = true, bindings = [] } = {}) {
  const calls = [];
  const query = async (text, params) => {
    calls.push([text, params]);
    if (text.includes('to_regclass')) return { rows: [{ present }] };
    if (text.includes('FROM expertise_roster_binding')) {
      if (!present) throw new Error('relation does not exist');
      return { rows: bindings.filter((b) => b.target_host === params[0]).slice(0, 1).map(() => ({ '?column?': 1 })) };
    }
    throw new Error(`unexpected query: ${text}`);
  };
  return { query, calls };
}

test('before the bridge migration (no table) legacy writes are allowed', async () => {
  const { query, calls } = fakeQuery({ present: false });
  await expect(legacyRosterMoved(query)).resolves.toBe(false);
  await expect(assertLegacyRosterWritable(query)).resolves.toBeUndefined();
  expect(calls.every(([text]) => !text.includes('FROM expertise_roster_binding'))).toBe(true);
});

test('table present with no bindings: writable', async () => {
  const { query } = fakeQuery({ bindings: [] });
  await expect(assertLegacyRosterWritable(query)).resolves.toBeUndefined();
});

test('a sandbox-only binding does not freeze Production legacy writes', async () => {
  const { query } = fakeQuery({ bindings: [{ target_host: 'orgd9e66399.crm.dynamics.com' }] });
  await expect(legacyRosterMoved(query)).resolves.toBe(false);
});

test('a Production-host binding refuses legacy writes with 409 roster_moved', async () => {
  const { query } = fakeQuery({ bindings: [{ target_host: PRODUCTION_ROSTER_HOST }] });
  await expect(assertLegacyRosterWritable(query)).rejects.toMatchObject({ status: 409, code: 'roster_moved' });
});
