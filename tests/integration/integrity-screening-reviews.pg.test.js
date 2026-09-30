/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client } from 'pg';

/**
 * Live-Postgres proof for migrations 056-057 (Integrity Workbench tab):
 * 056 is additive and re-runnable, 057's CHECK and foreign-key constraints
 * hold in a real database, and the service's conditional "latest run only"
 * append and history queries run with real parameter typing.
 *
 * SKIPPED by default. Set TEST_REQUEST_LEDGER_TEST_URL to a scratch/local
 * Postgres database (NEVER the shared Production/Preview POSTGRES_URL). The
 * test works in its own schema and drops it afterwards.
 */
const TEST_URL = process.env.TEST_REQUEST_LEDGER_TEST_URL || '';
if (!TEST_URL && process.env.TEST_REQUEST_LEDGER_REQUIRE === '1') {
  throw new Error('TEST_REQUEST_LEDGER_REQUIRE=1 but TEST_REQUEST_LEDGER_TEST_URL is unset.');
}
if (/neon\.tech/i.test(TEST_URL) || (process.env.POSTGRES_URL && TEST_URL === process.env.POSTGRES_URL)) {
  throw new Error('Refusing to run the integrity review proof against the shared Production/Preview database.');
}
const describeIf = TEST_URL ? describe : describe.skip;

const pg = { client: null };
jest.mock('@vercel/postgres', () => ({ sql: () => { throw new Error('use the injected sql dependency'); } }));
const sqlTag = (strings, ...values) => pg.client.query(
  strings.reduce((text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ''), ''),
  values,
);

const [MIGRATION_056, MIGRATION_057] = ['056_integrity_screenings_request_id.sql', '057_integrity_screening_reviews.sql']
  .map((file) => fs.readFileSync(path.join(process.cwd(), 'lib/db/migrations', file), 'utf8'));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SYSTEM_ID = '22222222-2222-4222-8222-222222222222';
const PERSON = { contactId: CONTACT_ID, name: 'Ada Example', institution: 'North University', role: 'PI' };
const RESULT = {
  name: PERSON.name,
  institution: PERSON.institution,
  sourceCoverageVersion: 1,
  matchCount: 0,
  sources: {
    retraction_watch: { searched: true, matches: [], error: null },
    pubpeer: { searched: true, summary: 'No results', error: null },
    news: { searched: true, summary: 'No results', error: null },
  },
};

function dataverseDependencies() {
  return {
    grantRequestAdapter: { getById: async () => ({
      akoya_requestid: REQUEST_ID,
      _wmkf_projectleader_value: CONTACT_ID,
      _wmkf_programdirector_value: SYSTEM_ID,
    }) },
    appRequestPersonAdapter: { queryAllPersons: async () => ({ records: [{
      _wmkf_contact_value: CONTACT_ID,
      wmkf_role: 100000000,
      wmkf_Contact: { fullname: PERSON.name, adx_organizationname: PERSON.institution },
    }], capped: false }) },
    contactAdapter: { getByIdWithSelect: async () => null },
    getUserRole: async () => 'read_only',
    sql: sqlTag,
  };
}

describeIf('integrity screening reviews (live Postgres, migrations 056-057)', () => {
  const schema = `integrity_reviews_${crypto.randomBytes(4).toString('hex')}`;
  let service;
  let profileId;

  async function insertRun({ requestId = REQUEST_ID, createdAt }) {
    const result = await pg.client.query(
      `INSERT INTO integrity_screenings (user_profile_id, screening_type, screened_names, results, match_count, status, request_id, created_at)
       VALUES ($1, 'workbench', $2, $3, 0, 'pending', $4, $5) RETURNING id`,
      [profileId, JSON.stringify([PERSON]), JSON.stringify([RESULT]), requestId, createdAt],
    );
    return result.rows[0].id;
  }

  async function insertReview(values) {
    return pg.client.query(
      `INSERT INTO integrity_screening_reviews (screening_id, request_id, reviewer_profile_id, reviewer_systemuser_id, decision, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      values,
    );
  }

  beforeAll(async () => {
    pg.client = new Client({ connectionString: TEST_URL });
    await pg.client.connect();
    await pg.client.query(`CREATE SCHEMA ${schema}`);
    await pg.client.query(`SET search_path TO ${schema}`);
    // Minimal pre-056 shapes of the two tables 056/057 depend on.
    await pg.client.query(`
      CREATE TABLE user_profiles (id SERIAL PRIMARY KEY, name TEXT, display_name TEXT);
      CREATE TABLE integrity_screenings (
        id SERIAL PRIMARY KEY,
        user_profile_id INTEGER REFERENCES user_profiles(id),
        screening_type VARCHAR(50),
        screened_names JSONB,
        results JSONB,
        match_count INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    profileId = (await pg.client.query(`INSERT INTO user_profiles (name, display_name) VALUES ('pd', 'PD Reviewer') RETURNING id`)).rows[0].id;
    await pg.client.query(`INSERT INTO integrity_screenings (user_profile_id, screening_type) VALUES ($1, 'manual')`, [profileId]);
    await pg.client.query(MIGRATION_056);
    await pg.client.query(MIGRATION_056);
    await pg.client.query(MIGRATION_057);
    await pg.client.query(MIGRATION_057);
    service = await import('../../lib/services/workbench/integrity-service.js');
  });

  afterAll(async () => {
    if (!pg.client) return;
    await pg.client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pg.client.end();
  });

  beforeEach(async () => {
    await pg.client.query('TRUNCATE integrity_screening_reviews');
    await pg.client.query(`DELETE FROM integrity_screenings WHERE request_id IS NOT NULL`);
  });

  test('056 is additive and re-runnable: existing standalone rows keep a NULL request_id', async () => {
    const column = await pg.client.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'integrity_screenings' AND column_name = 'request_id'`,
      [schema],
    );
    expect(column.rows[0]).toEqual({ data_type: 'uuid', is_nullable: 'YES' });
    const legacy = await pg.client.query(`SELECT request_id FROM integrity_screenings WHERE screening_type = 'manual'`);
    expect(legacy.rows).toEqual([{ request_id: null }]);
  });

  test('057 enforces decision, hold-note, note-length and foreign-key rules', async () => {
    const runId = await insertRun({ createdAt: '2026-09-26T20:00:00Z' });
    const base = [runId, REQUEST_ID, profileId, SYSTEM_ID];
    await expect(insertReview([...base, 'approve', ''])).rejects.toMatchObject({ code: '23514' });
    await expect(insertReview([...base, 'hold', '   '])).rejects.toMatchObject({ code: '23514' });
    await expect(insertReview([...base, 'approved', 'x'.repeat(2001)])).rejects.toMatchObject({ code: '23514' });
    await expect(insertReview([runId + 9999, REQUEST_ID, profileId, SYSTEM_ID, 'approved', ''])).rejects.toMatchObject({ code: '23503' });
    await expect(insertReview([runId, REQUEST_ID, profileId + 9999, SYSTEM_ID, 'approved', ''])).rejects.toMatchObject({ code: '23503' });
    await expect(insertReview([...base, 'approved', 'x'.repeat(2000)])).resolves.toBeTruthy();
    await expect(insertReview([...base, 'hold', 'Checking a PubPeer thread.'])).resolves.toBeTruthy();
  });

  test('the service appends a disposition only to the latest run, with real parameter typing', async () => {
    const older = await insertRun({ createdAt: '2026-09-26T19:00:00Z' });
    const latest = await insertRun({ createdAt: '2026-09-26T20:00:00Z' });
    const deps = dataverseDependencies();
    const args = { requestId: REQUEST_ID, decision: 'approved', notes: '', profileId, actingUserSystemId: SYSTEM_ID };

    await expect(service.recordWorkbenchIntegrityReview({ ...args, screeningId: older }, deps))
      .rejects.toMatchObject({ httpStatus: 409, body: { code: 'screening_not_latest' } });

    const context = await service.recordWorkbenchIntegrityReview({ ...args, screeningId: latest }, deps);
    expect(context.review.status).toBe('approved');
    expect(context.history.map((run) => run.id)).toEqual([latest, older]);
    expect(context.history[0].reviews).toHaveLength(1);
    expect(context.history[0].reviews[0]).toMatchObject({ decision: 'approved', reviewerName: 'PD Reviewer', reviewerSystemId: SYSTEM_ID });

    const page = await service.getWorkbenchIntegrityContext({ requestId: REQUEST_ID, beforeRunId: latest }, deps);
    expect(page.history.map((run) => run.id)).toEqual([older]);
  });
});
