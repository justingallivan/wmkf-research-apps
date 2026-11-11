/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: Object.assign(jest.fn(), { query: jest.fn() }), db: { connect: jest.fn() } }));
jest.mock('pg', () => ({ Pool: jest.fn() }));
const originalEnv = { ...process.env };
let sql, db, pg, vercel, local, client;
beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv, EXPERTISE_ROSTER_REHEARSAL: 'on', DYNAMICS_URL: 'https://orgd9e66399.crm.dynamics.com', DYNAMICS_SANDBOX_URL: 'https://orgd9e66399.crm.dynamics.com', DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on' };
  delete process.env.VERCEL_ENV;
  for (const key of ['POSTGRES_URL','DATABASE_URL','POSTGRES_URL_NON_POOLING','POSTGRES_PRISMA_URL']) process.env[key] = 'postgres://roster_rehearsal:fixture@127.0.0.1:55439/roster_rehearsal';
  pg = require('pg'); vercel = require('@vercel/postgres');
  client = { query: jest.fn(), release: jest.fn() };
  local = { query: jest.fn().mockResolvedValue({ rows: [{ value: 1 }] }), connect: jest.fn().mockResolvedValue(client) };
  pg.Pool.mockImplementation(() => local);
  ({ sql, db } = require('../../lib/services/expertise-finder/roster-sql.cjs'));
});
afterEach(() => { process.env = originalEnv; });
test('normal mode delegates tag, query and connection without creating a local pool', async () => {
  process.env.EXPERTISE_ROSTER_REHEARSAL = 'off';
  await sql`SELECT ${'value'}`; await sql.query('SELECT $1', [2]); await db.connect();
  expect(vercel.sql).toHaveBeenCalled(); expect(vercel.sql.query).toHaveBeenCalledWith('SELECT $1', [2]);
  expect(vercel.db.connect).toHaveBeenCalled(); expect(pg.Pool).not.toHaveBeenCalled();
});
test('local mode parameterizes hostile text and reuses the pinned pool', async () => {
  const value = "'; DROP TABLE fixture; --";
  await sql`SELECT ${value}::text, ${2}::int`;
  expect(local.query).toHaveBeenCalledWith('SELECT $1::text, $2::int', [value, 2]);
  await sql.query('SELECT 1'); expect(await db.connect()).toBe(client);
  expect(pg.Pool).toHaveBeenCalledTimes(1); expect(vercel.sql).not.toHaveBeenCalled(); expect(vercel.db.connect).not.toHaveBeenCalled();
});
test.each(['POSTGRES_URL','DATABASE_URL','DYNAMICS_URL','DATAVERSE_TARGET_INTERLOCK','EXPERTISE_ROSTER_REHEARSAL'])('invalid %s refuses before either transport', key => {
  process.env[key] = 'invalid';
  expect(() => sql.query('SELECT 1')).toThrow(); expect(() => db.connect()).toThrow();
  expect(pg.Pool).not.toHaveBeenCalled(); expect(vercel.sql.query).not.toHaveBeenCalled(); expect(vercel.db.connect).not.toHaveBeenCalled();
});
test('a cached pool cannot bypass a later target refusal', async () => {
  await sql.query('SELECT 1'); process.env.VERCEL_ENV = 'production';
  expect(() => sql.query('SELECT 2')).toThrow(); expect(() => db.connect()).toThrow();
  expect(local.query).toHaveBeenCalledTimes(1); expect(local.connect).not.toHaveBeenCalled();
});
test('local failures never fall back to Vercel', async () => {
  local.query.mockRejectedValue(new Error('local unavailable'));
  await expect(sql.query('SELECT 1')).rejects.toThrow('local unavailable'); expect(vercel.sql.query).not.toHaveBeenCalled();
});
