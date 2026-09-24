'use strict';

/**
 * Contract test for lib/services/review-draft-service.js — Stage 3 item 5
 * (wave 2, slice B), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 *
 * Covers all four static methods (the whole exported surface). No Dataverse
 * or other layer is touched by this service (it is "pure Postgres" — see
 * the file's own header note), so nothing else needs mocking here.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { withClient } = require('../../lib/postgres/client');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('review-draft-service: contract', () => {
  const ReviewDraftService = require('../../lib/services/review-draft-service');

  let client;
  const insertedSuggestionIds = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (insertedSuggestionIds.length) {
        await client.query('DELETE FROM review_drafts WHERE suggestion_id = ANY($1::uuid[])', [insertedSuggestionIds]);
      }
    } catch (err) {
      deleteError = err;
    } finally {
      await Promise.allSettled([client.end(), getShimPool().end()]);
    }
    if (deleteError) throw deleteError;
  });

  async function assertNoOpenTransactionAnywhere() {
    const xact = await withClient(async (c) => {
      const { rows } = await c.query('SELECT pg_current_xact_id_if_assigned() AS x');
      return rows[0].x;
    });
    expect(xact).toBeNull();

    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND state LIKE 'idle in transaction%'`
    );
    expect(rows[0].n).toBe(0);
  }

  function freshUuid() {
    const id = crypto.randomUUID();
    insertedSuggestionIds.push(id);
    return id;
  }

  describe('getBySuggestion', () => {
    test('returns null when no draft exists', async () => {
      const id = freshUuid();
      const row = await ReviewDraftService.getBySuggestion(id);
      expect(row).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    test('returns the full row (suggestion_id, draft_json, updated_at) for an existing draft', async () => {
      const id = freshUuid();
      const seeded = { q2: '<p>seed</p>', impact: 3 };
      await client.query(
        `INSERT INTO review_drafts (suggestion_id, draft_json) VALUES ($1, $2::jsonb)`,
        [id, JSON.stringify(seeded)]
      );

      const row = await ReviewDraftService.getBySuggestion(id);
      expect(row.suggestion_id).toBe(id);
      expect(row.draft_json).toEqual(seeded);
      expect(row.updated_at).toBeInstanceOf(Date);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('upsertDraftJson', () => {
    test('INSERT path binds suggestion_id and draft_json for a brand-new row', async () => {
      const id = freshUuid();
      const draftJson = { q1: 'first save', options: [1, 2, 3] };

      const row = await ReviewDraftService.upsertDraftJson({ suggestionId: id, draftJson });
      expect(row.suggestion_id).toBe(id);
      expect(row.draft_json).toEqual(draftJson);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: the ON CONFLICT DO UPDATE clause overwrites
    // draft_json with EXCLUDED.draft_json and bumps updated_at, but does
    // NOT touch suggestion_id (the conflict target) or id (the identity
    // PK). Seeding a distinct FIRST draft_json, then upserting a SECOND,
    // DIFFERENT draft_json for the same suggestion_id, and asserting the
    // row count stays at 1 with draft_json equal to the SECOND value (not
    // a merge of both, not the first) kills a mutant that does a plain
    // INSERT (would violate the UNIQUE(suggestion_id) constraint and
    // throw) as well as a mutant that drops `draft_json = EXCLUDED.draft_json`
    // from the SET list (would leave the first value in place).
    test('UPDATE path (autosave) overwrites draft_json in place and advances updated_at, keeping one row', async () => {
      const id = freshUuid();
      const first = await ReviewDraftService.upsertDraftJson({ suggestionId: id, draftJson: { step: 'first' } });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await ReviewDraftService.upsertDraftJson({ suggestionId: id, draftJson: { step: 'second' } });

      expect(second.id).toBe(first.id);
      expect(second.suggestion_id).toBe(id);
      expect(second.draft_json).toEqual({ step: 'second' });
      expect(new Date(second.updated_at).getTime()).toBeGreaterThan(new Date(first.updated_at).getTime());

      const { rows } = await client.query('SELECT count(*)::int AS n FROM review_drafts WHERE suggestion_id = $1', [id]);
      expect(rows[0].n).toBe(1);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('deleteBySuggestion', () => {
    test('deletes the matching row and returns the row count', async () => {
      const id = freshUuid();
      await client.query(`INSERT INTO review_drafts (suggestion_id, draft_json) VALUES ($1, '{}'::jsonb)`, [id]);

      const count = await ReviewDraftService.deleteBySuggestion(id);
      expect(count).toBe(1);

      const { rows } = await client.query('SELECT * FROM review_drafts WHERE suggestion_id = $1', [id]);
      expect(rows).toHaveLength(0);
      await assertNoOpenTransactionAnywhere();
    });

    test('is idempotent: returns 0 when there is nothing to delete', async () => {
      const id = freshUuid();
      const count = await ReviewDraftService.deleteBySuggestion(id);
      expect(count).toBe(0);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('deleteExpired', () => {
    // DISCRIMINATING: fresh sorts LAST alphabetically/insertion-wise but
    // must be the one that SURVIVES, and stale sorts first but must be the
    // one DELETED -- anti-correlated with any accidental ordering. Backdate
    // updated_at directly via SQL (the real cutoff comparison, not a
    // mocked clock) so `updated_at < NOW() - MAKE_INTERVAL(days => N)` is
    // exercised against real timestamps: a mutant that flips the
    // comparison direction, or drops the interval and compares to NOW()
    // directly, would delete the wrong row (or both/neither).
    test('deletes only drafts older than the cutoff, by real timestamp comparison', async () => {
      const staleId = freshUuid();
      const freshId = freshUuid();
      await client.query(
        `INSERT INTO review_drafts (suggestion_id, draft_json, updated_at)
         VALUES ($1, '{}'::jsonb, NOW() - INTERVAL '100 days')`,
        [staleId]
      );
      await client.query(
        `INSERT INTO review_drafts (suggestion_id, draft_json, updated_at)
         VALUES ($1, '{}'::jsonb, NOW() - INTERVAL '1 day')`,
        [freshId]
      );

      const deletedCount = await ReviewDraftService.deleteExpired({ olderThanDays: 90 });
      expect(deletedCount).toBeGreaterThanOrEqual(1);

      const { rows: staleRows } = await client.query('SELECT * FROM review_drafts WHERE suggestion_id = $1', [staleId]);
      expect(staleRows).toHaveLength(0);
      const { rows: freshRows } = await client.query('SELECT * FROM review_drafts WHERE suggestion_id = $1', [freshId]);
      expect(freshRows).toHaveLength(1);

      await assertNoOpenTransactionAnywhere();
    });

    test('defaults olderThanDays to 90 when omitted', async () => {
      const justUnder90 = freshUuid();
      await client.query(
        `INSERT INTO review_drafts (suggestion_id, draft_json, updated_at)
         VALUES ($1, '{}'::jsonb, NOW() - INTERVAL '89 days')`,
        [justUnder90]
      );

      await ReviewDraftService.deleteExpired();

      const { rows } = await client.query('SELECT * FROM review_drafts WHERE suggestion_id = $1', [justUnder90]);
      expect(rows).toHaveLength(1);
      await assertNoOpenTransactionAnywhere();
    });
  });
});
