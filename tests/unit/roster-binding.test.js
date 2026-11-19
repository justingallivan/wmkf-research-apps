/** @jest-environment node */
const mockClient = { query: jest.fn(), release: jest.fn() };
jest.mock('../../lib/services/expertise-finder/roster-sql.cjs', () => ({ db: { connect: jest.fn(async () => mockClient) } }));
import { ensureProfileBinding } from '../../lib/services/expertise-finder/roster-binding.js';

const HOST = 'wmkf.crm.dynamics.com';
const GUID = '11111111-1111-4111-8111-111111111111';
const APP_KEY = 'app_55555555-5555-4555-8555-555555555555';

function script(handlers) {
  mockClient.query.mockImplementation(async (text, params) => {
    for (const [match, result] of handlers) if (text.includes(match)) return typeof result === 'function' ? result(params) : result;
    return { rows: [] };
  });
}
const texts = () => mockClient.query.mock.calls.map(([t]) => t);

beforeEach(() => { mockClient.query.mockReset(); mockClient.release.mockReset(); });

test('reuses an existing binding without allocating', async () => {
  script([['SELECT roster_id', { rows: [{ roster_id: 12 }] }]]);
  await expect(ensureProfileBinding(HOST, GUID, APP_KEY)).resolves.toBe(12);
  expect(texts().some((t) => t.includes('nextval'))).toBe(false);
  expect(texts()).toContain('COMMIT');
  expect(mockClient.release).toHaveBeenCalledTimes(1);
});

test('allocates from the legacy roster sequence and inserts identity + binding in one transaction', async () => {
  script([['SELECT roster_id', { rows: [] }], ['nextval', { rows: [{ id: 41 }] }]]);
  await expect(ensureProfileBinding(HOST, GUID, APP_KEY)).resolves.toBe(41);
  const t = texts();
  expect(t[0]).toBe('BEGIN');
  expect(t.find((x) => x.includes('nextval'))).toContain("nextval('expertise_roster_id_seq')");
  const insert = mockClient.query.mock.calls.find(([x]) => x.includes('INSERT INTO expertise_roster_binding'));
  expect(insert[1]).toEqual([41, HOST, GUID]);
  expect(t[t.length - 1]).toBe('COMMIT');
});

test('a failed insert rolls back and propagates', async () => {
  script([['SELECT roster_id', { rows: [] }], ['nextval', { rows: [{ id: 41 }] }], ['INSERT INTO expertise_roster_binding', () => { throw new Error('boom'); }]]);
  await expect(ensureProfileBinding(HOST, GUID, APP_KEY)).rejects.toThrow('boom');
  expect(texts()).toContain('ROLLBACK');
  expect(texts()).not.toContain('COMMIT');
  expect(mockClient.release).toHaveBeenCalledTimes(1);
});

test('a unique conflict returns the existing winner', async () => {
  let selects = 0;
  script([
    ['SELECT roster_id', () => (++selects === 1 ? { rows: [] } : { rows: [{ roster_id: 7 }] })],
    ['nextval', { rows: [{ id: 41 }] }],
    ['INSERT INTO expertise_roster_binding', () => { throw Object.assign(new Error('dup'), { code: '23505' }); }],
  ]);
  await expect(ensureProfileBinding(HOST, GUID, APP_KEY)).resolves.toBe(7);
  expect(texts()).toContain('ROLLBACK');
});

test.each([[null, GUID], [HOST, 'not-a-guid']])('rejects invalid input (%p, %p) before connecting', async (host, guid) => {
  await expect(ensureProfileBinding(host, guid)).rejects.toThrow('target host and profile GUID');
  expect(mockClient.query).not.toHaveBeenCalled();
});

test.each([['legacy_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa_12'], ['direct_x'], [null], [undefined]])('an unbound profile with creation key %p is refused, never allocated', async (key) => {
  script([['SELECT roster_id', { rows: [] }], ['nextval', { rows: [{ id: 41 }] }]]);
  await expect(ensureProfileBinding(HOST, GUID, key)).rejects.toMatchObject({ code: 'roster_binding_requires_reconciliation' });
  expect(texts().some((t) => t.includes('nextval'))).toBe(false);
  expect(texts()).toContain('ROLLBACK');
});

test('an already-bound imported profile is reused regardless of its creation key', async () => {
  script([['SELECT roster_id', { rows: [{ roster_id: 12 }] }]]);
  await expect(ensureProfileBinding(HOST, GUID, 'legacy_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa_12')).resolves.toBe(12);
});
