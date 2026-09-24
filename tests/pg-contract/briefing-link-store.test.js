'use strict';

/**
 * Contract test for lib/services/deliberation-briefing/briefing-link-store.js
 * — Stage 3 item 4 TESTS-BEFORE (docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md).
 * NO CONVERSION in this pass: the store still imports `db`/`sql` from
 * `@vercel/postgres` directly; this test runs, and must pass, against
 * that UNCONVERTED source. `lib/postgres/client` is used here only as
 * test infrastructure (the Stage 2 open-transaction assertion helper),
 * never imported by the store itself.
 *
 * This store has only source-text/indirect coverage today (via
 * tests/unit/deliberation-briefing-link-service.test.js, which mocks the
 * store, not the driver) so per plan §2 rule 9 this contract test IS the
 * tests-before requirement.
 *
 * `replaceLiveLink` is an EXCLUDED transaction shape (early
 * ROLLBACK-then-throw at ~:106 and ~:125, plus a catch-all ROLLBACK at
 * ~:148): the eventual conversion keeps its statements verbatim on a
 * `withClient` client rather than `withTransaction`, so this test proves
 * every one of those paths — including both early-ROLLBACK branches and
 * the catch-all — leaves the tables byte-for-byte unchanged.
 *
 * Must-cover (per `node scripts/check-postgres-access-layer.js --json` →
 * castLint filtered to this file): 7 rows, all on insertLink's INSERT
 * VALUES (lines 72/73: id, request_id, jti, token_digest,
 * token_ciphertext, expires_at, created_by) — every one asserted by row
 * read-back below. `replaceLiveLink`'s parameterized ($1..$7) statements
 * are plain `client.query` calls, not `sql\`...\`` tags, so they are
 * outside the cast-lint scan, but every one is still exercised and its
 * bound values asserted.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { withClient } = require('../../lib/postgres/client');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('deliberation-briefing/briefing-link-store: contract', () => {
  const store = require('../../lib/services/deliberation-briefing/briefing-link-store');

  let client;
  const insertedLinkIds = [];
  const insertedOperationIds = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (insertedOperationIds.length) {
        await client.query('DELETE FROM pre_site_distribution_attempts WHERE operation_id = ANY($1::uuid[])', [insertedOperationIds]);
      }
      if (insertedLinkIds.length) {
        await client.query('DELETE FROM deliberation_briefing_links WHERE id = ANY($1::uuid[])', [insertedLinkIds]);
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

  function hex(seed) {
    return crypto.createHash('sha256').update(seed).digest('hex');
  }

  function linkFixture(overrides = {}) {
    const id = crypto.randomUUID();
    insertedLinkIds.push(id);
    return {
      id,
      requestId: crypto.randomUUID(),
      jti: crypto.randomUUID(),
      tokenDigest: hex(`digest-${id}`),
      tokenCiphertext: 'ciphertext',
      expiresAt: new Date(Date.now() + 7 * 86400_000),
      createdBy: crypto.randomUUID(),
      ...overrides,
    };
  }

  async function readLink(id) {
    const { rows } = await client.query('SELECT * FROM deliberation_briefing_links WHERE id = $1', [id]);
    return rows[0];
  }

  // Minimal valid pre_site_distribution_attempts row, bound to a briefing
  // link, satisfying every NOT NULL/CHECK constraint on that table
  // (owned by distribution-store.js, not this file) so replaceLiveLink's
  // FOR UPDATE lock query has real rows to evaluate.
  async function seedBoundAttempt(linkId, requestId, overrides = {}) {
    const operationId = crypto.randomUUID();
    insertedOperationIds.push(operationId);
    await client.query(
      `INSERT INTO pre_site_distribution_attempts (
         operation_id, request_id, source_document_id, attachment_mode,
         to_recipients, cc_recipients, subject, body_text, body_html,
         from_email, acting_user_system_id, draft_hash, template_version,
         state, briefing_link_id, lease_token, locked_until, send_requested_at
       ) VALUES ($1, $2, $3, 'none', '[{"email":"a@example.org"}]'::jsonb, '[]'::jsonb,
         'subj', 'body', '<p>body</p>', 'noreply@example.org', $4, $5, 'v1',
         $6, $7, $8, $9, $10)`,
      [
        operationId, requestId, crypto.randomUUID(), crypto.randomUUID(),
        hex(`draft-${operationId}`), overrides.state || 'preparing', linkId,
        overrides.leaseToken || null, overrides.lockedUntil || null, overrides.sendRequestedAt || null,
      ]
    );
    return operationId;
  }

  describe('insertLink / getLiveLinkForRequest / getLinkByDigest / getLinkById', () => {
    test('insertLink binds every column, and reads all find it', async () => {
      const fixture = linkFixture();
      const row = await store.insertLink(fixture);
      expect(row.id).toBe(fixture.id);
      expect(row.request_id).toBe(fixture.requestId);
      expect(row.jti).toBe(fixture.jti);
      expect(row.token_digest).toBe(fixture.tokenDigest);
      expect(row.token_ciphertext).toBe(fixture.tokenCiphertext);
      expect(new Date(row.expires_at).toISOString()).toBe(fixture.expiresAt.toISOString());
      expect(row.created_by).toBe(fixture.createdBy);
      expect(row.revoked_at).toBeNull();

      const byRequest = await store.getLiveLinkForRequest(fixture.requestId);
      expect(byRequest.id).toBe(fixture.id);
      const byDigest = await store.getLinkByDigest(fixture.tokenDigest);
      expect(byDigest.id).toBe(fixture.id);
      const byId = await store.getLinkById(fixture.id);
      expect(byId.id).toBe(fixture.id);

      expect(await store.getLiveLinkForRequest(crypto.randomUUID())).toBeNull();
      expect(await store.getLinkByDigest('0'.repeat(64))).toBeNull();
      expect(await store.getLinkById(crypto.randomUUID())).toBeNull();
    });

    // DISCRIMINATING: getLiveLinkForRequest must exclude a REVOKED row for
    // the same request -- kills a mutant that drops the
    // `revoked_at IS NULL` filter.
    test('getLiveLinkForRequest excludes a revoked row', async () => {
      const fixture = linkFixture();
      await store.insertLink(fixture);
      await client.query(
        'UPDATE deliberation_briefing_links SET revoked_at = NOW(), revoked_by = $2, superseded_by = $3 WHERE id = $1',
        [fixture.id, crypto.randomUUID(), crypto.randomUUID()]
      );
      expect(await store.getLiveLinkForRequest(fixture.requestId)).toBeNull();
    });
  });

  describe('replaceLiveLink', () => {
    test('no existing live link: revoke UPDATE is a no-op, replacement inserted, committed', async () => {
      const requestId = crypto.randomUUID();
      const replacement = linkFixture({ requestId });
      const result = await store.replaceLiveLink(requestId, replacement, { revokedBy: crypto.randomUUID() });

      expect(result.id).toBe(replacement.id);
      const inserted = await readLink(replacement.id);
      expect(inserted.request_id).toBe(requestId);
      expect(inserted.revoked_at).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    test('existing live link with no bound sends: revokes the old row and inserts the replacement in one commit', async () => {
      const requestId = crypto.randomUUID();
      const original = linkFixture({ requestId });
      await store.insertLink(original);
      const replacement = linkFixture({ requestId });
      const revokedBy = crypto.randomUUID();

      const result = await store.replaceLiveLink(requestId, replacement, { revokedBy });
      expect(result.id).toBe(replacement.id);

      const oldRow = await readLink(original.id);
      expect(oldRow.revoked_at).not.toBeNull();
      expect(oldRow.revoked_by).toBe(revokedBy);
      expect(oldRow.superseded_by).toBe(replacement.id);

      const newRow = await readLink(replacement.id);
      expect(newRow.revoked_at).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: early ROLLBACK-then-throw at ~:106 (CAS mismatch).
    // The old row must remain exactly as it was (still live, unrevoked)
    // and the attempted replacement must NOT be persisted -- proves the
    // ROLLBACK actually undid nothing-yet-committed rather than the
    // transaction partially landing.
    test('DISCRIMINATING: expectedLiveId mismatch rolls back with no table changes and throws briefing_link_superseded', async () => {
      const requestId = crypto.randomUUID();
      const original = linkFixture({ requestId });
      await store.insertLink(original);
      const replacement = linkFixture({ requestId });

      await expect(
        store.replaceLiveLink(requestId, replacement, { revokedBy: crypto.randomUUID(), expectedLiveId: crypto.randomUUID() })
      ).rejects.toMatchObject({ code: 'briefing_link_superseded', httpStatus: 409 });

      const oldRow = await readLink(original.id);
      expect(oldRow.revoked_at).toBeNull();
      expect(await readLink(replacement.id)).toBeUndefined();
      await assertNoOpenTransactionAnywhere();
    });

    test('expectedLiveId match proceeds normally', async () => {
      const requestId = crypto.randomUUID();
      const original = linkFixture({ requestId });
      await store.insertLink(original);
      const replacement = linkFixture({ requestId });

      const result = await store.replaceLiveLink(requestId, replacement, { revokedBy: crypto.randomUUID(), expectedLiveId: original.id });
      expect(result.id).toBe(replacement.id);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: early ROLLBACK-then-throw at ~:125 (send in progress).
    // A leased (unexpired) distribution attempt bound to the live link
    // blocks replacement entirely; the old row and the bound attempt's
    // lease must both remain untouched.
    test('DISCRIMINATING: a leased bound distribution attempt blocks replacement (send_in_progress), no table changes', async () => {
      const requestId = crypto.randomUUID();
      const original = linkFixture({ requestId });
      await store.insertLink(original);
      const leaseToken = crypto.randomUUID();
      const operationId = await seedBoundAttempt(original.id, requestId, {
        leaseToken, lockedUntil: new Date(Date.now() + 60_000).toISOString(),
      });
      const replacement = linkFixture({ requestId });

      await expect(
        store.replaceLiveLink(requestId, replacement, { revokedBy: crypto.randomUUID() })
      ).rejects.toMatchObject({ code: 'briefing_send_in_progress', httpStatus: 409 });

      const oldRow = await readLink(original.id);
      expect(oldRow.revoked_at).toBeNull();
      expect(await readLink(replacement.id)).toBeUndefined();
      const { rows } = await client.query('SELECT lease_token FROM pre_site_distribution_attempts WHERE operation_id = $1', [operationId]);
      expect(rows[0].lease_token).toBe(leaseToken);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: an EXPIRED lease and a send_requested OUTSIDE the
    // 24h window must NOT block replacement -- kills a mutant that drops
    // the `locked_until > NOW()` / `send_requested_at > NOW() - interval`
    // comparisons entirely (always-blocking).
    test('an expired lease and a stale send_requested do not block replacement', async () => {
      const requestId = crypto.randomUUID();
      const original = linkFixture({ requestId });
      await store.insertLink(original);
      await seedBoundAttempt(original.id, requestId, {
        leaseToken: crypto.randomUUID(), lockedUntil: new Date(Date.now() - 60_000).toISOString(),
        sendRequestedAt: new Date(Date.now() - 25 * 3600_000).toISOString(),
      });
      const replacement = linkFixture({ requestId });

      const result = await store.replaceLiveLink(requestId, replacement, { revokedBy: crypto.randomUUID() });
      expect(result.id).toBe(replacement.id);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: the catch-all ROLLBACK at ~:148, reached via a REAL
    // Postgres error (23505 unique violation on token_digest), not a
    // thrown JS error -- proves the whole transaction (including the
    // revoke UPDATE that ran before the failing INSERT) is undone, not
    // partially committed.
    test('DISCRIMINATING: a real planner error (duplicate token_digest) rolls back the revoke too', async () => {
      const requestId = crypto.randomUUID();
      const original = linkFixture({ requestId });
      await store.insertLink(original);
      const collidingDigestOwner = linkFixture();
      await store.insertLink(collidingDigestOwner);

      const replacement = linkFixture({ requestId, tokenDigest: collidingDigestOwner.tokenDigest });
      await expect(
        store.replaceLiveLink(requestId, replacement, { revokedBy: crypto.randomUUID() })
      ).rejects.toThrow(/duplicate key value violates unique constraint/);

      const oldRow = await readLink(original.id);
      expect(oldRow.revoked_at).toBeNull();
      expect(await readLink(replacement.id)).toBeUndefined();
      await assertNoOpenTransactionAnywhere();
    });
  });
});
