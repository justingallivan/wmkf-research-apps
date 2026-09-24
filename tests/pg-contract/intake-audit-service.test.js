'use strict';

/**
 * Contract test for lib/services/intake-audit-service.js — Stage 3 item 3
 * (wave 2 slice A), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 *
 * No unit test exercises the real module: `tests/unit/maintenance-cleanup-intake-audit.test.js`
 * and every other consumer test `jest.mock('../../lib/services/intake-audit-service', ...)`
 * at the module boundary (Stage 3 fresh-context finding — this file "exists
 * only as a jest.mock target"). Per plan §2 rule 9 / Stage 3 "tests before",
 * this contract test IS the tests-before requirement.
 *
 * Copies the template shape (tests/pg-contract/explorer-store.test.js):
 * PG_CONTRACT_URL gating, a direct pg Client for setup/verification/cleanup,
 * assertNoOpenTransactionAnywhere, tracked keys before writes, afterAll with
 * bounded lock_timeout/statement_timeout, and a Promise.allSettled close of
 * both the direct client and the shim pool.
 *
 * intake_audit (scripts/setup-database.js ~:1603) has no FK, so nothing to
 * seed beyond the row itself.
 *
 * Fail-open telemetry writer (plan §7): IntakeAuditService.log/queryByActor/
 * queryByTarget all catch and swallow, returning null/[] rather than
 * throwing. The DISCRIMINATING test forces a real planner rejection
 * (invalid INET literal for ip_address) to prove `log` resolves null
 * instead of throwing against an actual constraint/type failure, not a
 * mocked one.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('intake-audit-service: contract', () => {
  const IntakeAuditService = require('../../lib/services/intake-audit-service');

  let client;
  const insertedActorOids = [];
  const insertedIds = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (insertedIds.length) {
        await client.query('DELETE FROM intake_audit WHERE id = ANY($1::bigint[])', [insertedIds]);
      }
      if (insertedActorOids.length) {
        await client.query('DELETE FROM intake_audit WHERE actor_oid = ANY($1::text[])', [insertedActorOids]);
      }
    } catch (err) {
      deleteError = err;
    } finally {
      await Promise.allSettled([client.end(), getShimPool().end()]);
    }
    if (deleteError) throw deleteError;
  });

  async function assertNoOpenTransactionAnywhere() {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND state LIKE 'idle in transaction%'`
    );
    expect(rows[0].n).toBe(0);
  }

  test('log() binds every column, digests the payload, and returns the inserted id', async () => {
    const actorOid = `actor_${crypto.randomBytes(6).toString('hex')}`;
    insertedActorOids.push(actorOid);
    const payload = { foo: 'bar', n: 1 };
    // Computed independently of IntakeAuditService.digestPayload (not via
    // the module under test) so a constant or wrong-input digest in the
    // module cannot pass by construction.
    const expectedDigest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    const id = await IntakeAuditService.log({
      actorOid,
      actorType: 'applicant',
      action: 'draft_upsert',
      targetEntity: 'intake_draft',
      targetId: 'draft-123',
      payload,
      metadata: { source: 'contract-test' },
      ipAddress: '203.0.113.5',
      userAgent: 'contract-test-agent',
    });
    // BIGSERIAL comes back through pg as a string, not a JS number.
    expect(id).toEqual(expect.stringMatching(/^\d+$/));
    insertedIds.push(id);

    const { rows } = await client.query('SELECT * FROM intake_audit WHERE id = $1', [id]);
    const row = rows[0];
    expect(row.actor_oid).toBe(actorOid);
    expect(row.actor_type).toBe('applicant');
    expect(row.action).toBe('draft_upsert');
    expect(row.target_entity).toBe('intake_draft');
    expect(row.target_id).toBe('draft-123');
    // Proves the bytes are never stored -- only the digest -- and that the
    // digest is computed over the actual payload (kills a mutant that
    // stores payload verbatim or a constant digest).
    expect(row.payload_digest).toBe(expectedDigest);
    expect(row.payload_digest).not.toBe(JSON.stringify(payload));
    expect(row.metadata).toEqual({ source: 'contract-test' });
    expect(row.ip_address).toBe('203.0.113.5');
    expect(row.user_agent).toBe('contract-test-agent');
    await assertNoOpenTransactionAnywhere();
  });

  test('log() defaults metadata to {} when none is supplied', async () => {
    const actorOid = `actor_${crypto.randomBytes(6).toString('hex')}`;
    insertedActorOids.push(actorOid);

    const id = await IntakeAuditService.log({
      actorOid,
      actorType: 'system',
      action: 'submission_job_enqueued',
    });
    expect(id).toEqual(expect.stringMatching(/^\d+$/));
    insertedIds.push(id);

    const { rows } = await client.query('SELECT * FROM intake_audit WHERE id = $1', [id]);
    expect(rows[0].metadata).toEqual({});
    expect(rows[0].payload_digest).toBeNull();
    await assertNoOpenTransactionAnywhere();
  });

  test('log() rejects an invalid actorType before touching the database, returning null', async () => {
    const id = await IntakeAuditService.log({ actorType: 'not-a-real-actor-type', action: 'x' });
    expect(id).toBeNull();
  });

  // DISCRIMINATING: ip_address is a real INET column (scripts/setup-database.js
  // ~:1612). A well-formed actorType/action pass the app-level guard, but
  // an invalid INET literal only fails at the planner (22P02, invalid
  // input syntax for type inet) -- a genuine database rejection, not a
  // simulated JS throw. This proves log()'s try/catch actually reaches the
  // database call, not just the two early-return validation guards above:
  // a mutant that removed the try/catch around the `sql` call (leaving the
  // two guards intact) would make this test's promise reject instead of
  // resolving null.
  test('DISCRIMINATING: an invalid INET literal in ipAddress is a real planner rejection that resolves null, never throws', async () => {
    const actorOid = `actor_${crypto.randomBytes(6).toString('hex')}`;
    insertedActorOids.push(actorOid); // no-op cleanup target; row is never created

    await expect(
      IntakeAuditService.log({
        actorOid,
        actorType: 'staff',
        action: 'override',
        ipAddress: 'not-an-ip-address',
      })
    ).resolves.toBeNull();

    const { rows } = await client.query('SELECT * FROM intake_audit WHERE actor_oid = $1', [actorOid]);
    expect(rows).toHaveLength(0);
    await assertNoOpenTransactionAnywhere();
  });

  describe('queryByActor / queryByTarget', () => {
    test('queryByActor returns rows for the actor ordered by created_at DESC, respecting limit', async () => {
      const actorOid = `actor_${crypto.randomBytes(6).toString('hex')}`;
      insertedActorOids.push(actorOid);

      const idFirst = await IntakeAuditService.log({ actorOid, actorType: 'applicant', action: 'first' });
      insertedIds.push(idFirst);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const idSecond = await IntakeAuditService.log({ actorOid, actorType: 'applicant', action: 'second' });
      insertedIds.push(idSecond);

      const rows = await IntakeAuditService.queryByActor(actorOid, { limit: 1 });
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe('second');
    });

    test('queryByTarget filters by both target_entity and target_id', async () => {
      const actorOid = `actor_${crypto.randomBytes(6).toString('hex')}`;
      insertedActorOids.push(actorOid);
      const targetId = `target_${crypto.randomBytes(6).toString('hex')}`;

      const idMatch = await IntakeAuditService.log({
        actorOid, actorType: 'applicant', action: 'x', targetEntity: 'intake_draft', targetId,
      });
      insertedIds.push(idMatch);
      // Same target_id, different target_entity -- must NOT match (kills a
      // mutant that filters on target_id alone).
      const idOtherEntity = await IntakeAuditService.log({
        actorOid, actorType: 'applicant', action: 'x', targetEntity: 'submission_job', targetId,
      });
      insertedIds.push(idOtherEntity);

      const rows = await IntakeAuditService.queryByTarget('intake_draft', targetId);
      expect(rows.map((r) => r.id)).toEqual([idMatch]);
    });
  });
});
