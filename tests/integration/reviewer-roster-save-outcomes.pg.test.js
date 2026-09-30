/** @jest-environment node */
import crypto from 'node:crypto';
import { Client } from 'pg';

/**
 * Live-Postgres proof for guarded reviewer-roster save outcomes.
 *
 * SKIPPED by default. Set TEST_REQUEST_LEDGER_TEST_URL to a scratch/local
 * Postgres database (never the shared Production/Preview POSTGRES_URL). The
 * test creates and drops only a randomly named schema within that database.
 */
const TEST_URL = process.env.TEST_REQUEST_LEDGER_TEST_URL || '';
if (!TEST_URL && process.env.TEST_REQUEST_LEDGER_REQUIRE === '1') {
  throw new Error('TEST_REQUEST_LEDGER_REQUIRE=1 but TEST_REQUEST_LEDGER_TEST_URL is unset.');
}
if (/neon\.tech/i.test(TEST_URL) || (process.env.POSTGRES_URL && TEST_URL === process.env.POSTGRES_URL)) {
  throw new Error('Refusing to run the reviewer-roster proof against the shared Production/Preview database.');
}
const describeIf = TEST_URL ? describe : describe.skip;

const pg = { client: null };
jest.mock('@vercel/postgres', () => ({
  sql: (strings, ...values) => pg.client.query(
    strings.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ''), ''),
    values,
  ),
}));
jest.mock('../../lib/services/reviewer-institution-measurement', () => ({
  recordInstitutionMeasurement: jest.fn(async () => 'disabled'),
}));

const rosterStore = require('../../lib/services/reviewer-roster-store');

const candidate = (name, candidateKey, extra = {}) => ({
  name,
  candidateKey,
  affiliation: 'North University',
  source: 'publication',
  ...extra,
});

describeIf('reviewer roster save outcomes (isolated live Postgres)', () => {
  const schema = `reviewer_roster_outcomes_${crypto.randomBytes(6).toString('hex')}`;
  let schemaCreated = false;
  let requestId;

  async function insertRow({ key, name, status, updatedAt = '2026-09-29T12:00:00Z', candidateBlob }) {
    await pg.client.query(
      `INSERT INTO reviewer_find_roster
        (request_id, candidate_key, normalized_name, display_name, status, candidate, source_kind, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'literature_retrieved', $7)`,
      [requestId, key, name.toLowerCase(), name, status, JSON.stringify(candidateBlob || candidate(name, key)), updatedAt],
    );
    const result = await pg.client.query(
      `SELECT updated_at::text AS token FROM reviewer_find_roster WHERE request_id = $1 AND candidate_key = $2`,
      [requestId, key],
    );
    return result.rows[0].token;
  }

  beforeAll(async () => {
    pg.client = new Client({ connectionString: TEST_URL });
    await pg.client.connect();
    await pg.client.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    await pg.client.query(`SET search_path TO ${schema}`);
    // Current roster shape after migrations 020, 023, 025, 027 and 029.
    await pg.client.query(`
      CREATE TABLE reviewer_find_roster (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        request_id UUID NOT NULL,
        candidate_key TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active','excluded','saved','coi_dropped','ineligible','blocked')),
        candidate JSONB NOT NULL,
        source_kind TEXT,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (request_id, candidate_key)
      )
    `);
    requestId = crypto.randomUUID();
  });

  afterAll(async () => {
    if (!pg.client) return;
    try {
      if (schemaCreated) await pg.client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pg.client.end();
    }
  });

  beforeEach(async () => {
    await pg.client.query('TRUNCATE reviewer_find_roster RESTART IDENTITY');
    requestId = crypto.randomUUID();
  });

  test('guarded conflicts preserve curated rows and reject stale active-row writes', async () => {
    const statuses = ['excluded', 'saved', 'coi_dropped', 'ineligible', 'blocked'];
    const original = new Map();
    for (const status of statuses) {
      const key = `curated:${status}`;
      original.set(key, await insertRow({ key, name: `Curated ${status}`, status }));
      const write = await rosterStore.recordSurfacedDetailed(
        requestId,
        [candidate(`Refreshed ${status}`, key)],
        { expectedUpdatedAt: original.get(key) },
      );
      expect(write).toMatchObject({ recorded: 0, results: [{ outcome: 'unchanged' }] });
    }

    const staleToken = await insertRow({ key: 'active:stale', name: 'Active Stale', status: 'active' });
    const guarded = await rosterStore.recordSurfacedDetailed(
      requestId,
      [candidate('Should Not Replace', 'active:stale')],
      { expectedUpdatedAt: '2000-01-01 00:00:00+00' },
    );
    expect(guarded).toMatchObject({ recorded: 0, results: [{ outcome: 'unchanged' }] });

    const rows = await pg.client.query(
      `SELECT candidate_key, status, display_name, updated_at::text AS token
       FROM reviewer_find_roster WHERE request_id = $1 ORDER BY candidate_key`,
      [requestId],
    );
    for (const row of rows.rows) {
      if (row.candidate_key === 'active:stale') {
        expect(row).toMatchObject({ status: 'active', display_name: 'Active Stale', token: staleToken });
      } else {
        expect(row.display_name).toMatch(/^Curated /);
        expect(row.token).toBe(original.get(row.candidate_key));
      }
    }
  });

  test('expectedUpdatedAt:null inserts new keys but cannot update an existing or raced key', async () => {
    const first = await rosterStore.recordSurfacedDetailed(
      requestId,
      [candidate('Insert Only', 'new:key')],
      { expectedUpdatedAt: null },
    );
    expect(first).toMatchObject({ recorded: 1, results: [{ outcome: 'written' }] });

    // This preexisting conflict represents a row created after the caller's
    // authoritative GET and before its save attempt.
    const racedToken = await insertRow({ key: 'raced:key', name: 'Raced Original', status: 'active' });
    const guarded = await rosterStore.recordSurfacedDetailed(
      requestId,
      [
        candidate('Should Not Replace Existing', 'new:key'),
        candidate('Should Not Replace Raced', 'raced:key'),
      ],
      { expectedUpdatedAt: null },
    );
    expect(guarded).toMatchObject({
      recorded: 0,
      results: [{ outcome: 'unchanged' }, { outcome: 'unchanged' }],
    });
    const rows = await pg.client.query(
      `SELECT candidate_key, display_name, updated_at::text AS token
       FROM reviewer_find_roster WHERE request_id = $1 ORDER BY candidate_key`,
      [requestId],
    );
    expect(rows.rows).toEqual([
      { candidate_key: 'new:key', display_name: 'Insert Only', token: expect.any(String) },
      { candidate_key: 'raced:key', display_name: 'Raced Original', token: racedToken },
    ]);
  });

  test('numeric wrapper returns inserted row count while the real post-write cap and GET retain hidden keys', async () => {
    const surfaced = Array.from({ length: rosterStore.PER_REQUEST_ACTIVE_CAP + 2 }, (_, index) => (
      candidate(`Cap Candidate ${index}`, `cap:${index}`)
    ));
    const recorded = await rosterStore.recordSurfaced(requestId, surfaced, { expectedUpdatedAt: null });
    expect(recorded).toBe(surfaced.length);

    const savedCandidate = candidate('Saved Invisible', 'suggestion:saved-invisible', {
      suggestionId: 'saved-invisible',
      potentialReviewerId: 'person-saved-invisible',
    });
    const saved = await rosterStore.finalizeCandidatePromotion(
      requestId,
      savedCandidate,
      {
        candidateKey: savedCandidate.candidateKey,
        suggestionId: savedCandidate.suggestionId,
        potentialReviewerId: savedCandidate.potentialReviewerId,
      },
    );
    expect(saved).toEqual({ saved: true, candidateKey: savedCandidate.candidateKey });

    const coiCandidate = candidate('COI Dropped Invisible', 'coi:invisible', {
      affiliation: 'North University',
      hasInstitutionCOI: true,
      institutionCOIDetails: { piInstitution: 'North University', reviewerInstitution: 'North University' },
    });
    expect(await rosterStore.recordCoiDropped(requestId, [coiCandidate])).toBe(1);

    const counts = await pg.client.query(
      `SELECT status, COUNT(*)::int AS count FROM reviewer_find_roster
       WHERE request_id = $1 GROUP BY status ORDER BY status`,
      [requestId],
    );
    expect(counts.rows.find((row) => row.status === 'active').count).toBe(rosterStore.PER_REQUEST_ACTIVE_CAP);

    const roster = await rosterStore.listForRequest(requestId);
    expect(roster.active).toHaveLength(rosterStore.PER_REQUEST_ACTIVE_CAP);
    expect(roster.active.some((item) => item.name === savedCandidate.name || item.name === coiCandidate.name)).toBe(false);
    expect(roster.savedKeys).toContain(savedCandidate.candidateKey);
    expect(roster.allNames).toEqual(expect.arrayContaining([savedCandidate.name, coiCandidate.name]));
    expect(roster.retention.rows).toEqual(expect.arrayContaining([
      { candidateKey: savedCandidate.candidateKey, status: 'saved' },
      { candidateKey: coiCandidate.candidateKey, status: 'coi_dropped' },
    ]));
  });
});
