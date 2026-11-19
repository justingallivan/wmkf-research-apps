/** @jest-environment node */
// Real-SQL check of the post-cutover bind path against a disposable schema on the local
// rehearsal database. Opt-in like the other roster pg suites (ROSTER_LIVE_SQL_TEST_ENV).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse } = require('dotenv');
const { Client } = require('pg');

jest.setTimeout(30000);
const envFile = process.env.ROSTER_LIVE_SQL_TEST_ENV;
const live = envFile ? test : test.skip;

let mockConnect;
jest.mock('../../lib/services/expertise-finder/roster-sql.cjs', () => ({ db: { connect: (...args) => mockConnect(...args) } }));

const HOST = 'wmkf.crm.dynamics.com';
const APP_GUID = '11111111-1111-4111-8111-111111111111';
const LEGACY_GUID = '22222222-2222-4222-8222-222222222222';
const APP_KEY = 'app_55555555-5555-4555-8555-555555555555';

live('ensureProfileBinding allocates from the legacy sequence, reuses bindings and refuses unkeyed allocation', async () => {
  const { POSTGRES_URL } = parse(fs.readFileSync(envFile));
  const url = new URL(POSTGRES_URL);
  if (url.hostname !== '127.0.0.1' || url.port !== '55439') throw new Error('Refusing: not the local rehearsal database');
  const schema = `roster_rehearsal_${crypto.randomBytes(16).toString('hex')}`;
  const admin = new Client({ connectionString: POSTGRES_URL });
  await admin.connect();
  const clients = [];
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    await admin.query('CREATE TABLE expertise_roster (id SERIAL PRIMARY KEY, name TEXT NOT NULL)');
    await admin.query(fs.readFileSync(path.join(__dirname, '../../docs/plans/data/expertise-roster/identity-bridge.sql'), 'utf8'));
    // Imported state: legacy IDs 1..40 bound, sequence advanced past them (importer setval).
    await admin.query('INSERT INTO expertise_roster_identity (id) SELECT generate_series(1, 40)');
    await admin.query('INSERT INTO expertise_roster_binding VALUES (12, $1, $2)', [HOST, LEGACY_GUID]);
    await admin.query("SELECT setval('expertise_roster_id_seq', 40, true)");

    mockConnect = async () => {
      const c = new Client({ connectionString: POSTGRES_URL, options: `-c search_path="${schema}"` });
      await c.connect();
      clients.push(c);
      return { query: (...a) => c.query(...a), release: () => c.end() };
    };
    const { ensureProfileBinding } = require('../../lib/services/expertise-finder/roster-binding.js');

    await expect(ensureProfileBinding(HOST, LEGACY_GUID, 'legacy_x_12')).resolves.toBe(12);
    await expect(ensureProfileBinding(HOST, APP_GUID, APP_KEY)).resolves.toBe(41);
    await expect(ensureProfileBinding(HOST, APP_GUID, APP_KEY)).resolves.toBe(41);
    await expect(ensureProfileBinding(HOST, '33333333-3333-4333-8333-333333333333', 'legacy_y_99')).rejects.toMatchObject({ code: 'roster_binding_requires_reconciliation' });

    const identities = (await admin.query('SELECT count(*)::int AS n, max(id) AS max FROM expertise_roster_identity')).rows[0];
    expect(identities).toEqual({ n: 41, max: 41 });
    const bindings = (await admin.query('SELECT roster_id, dataverse_profile_guid FROM expertise_roster_binding ORDER BY roster_id')).rows;
    expect(bindings).toEqual([{ roster_id: 12, dataverse_profile_guid: LEGACY_GUID }, { roster_id: 41, dataverse_profile_guid: APP_GUID }]);
    expect((await admin.query('SELECT last_value FROM expertise_roster_id_seq')).rows[0].last_value).toBe('41');
  } finally {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
