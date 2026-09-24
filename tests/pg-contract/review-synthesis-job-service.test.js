'use strict';

/**
 * Contract test for lib/services/review-synthesis-job-service.js — Stage 3
 * item 3 (wave 3 slice A), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 * TESTS-BEFORE for the test-then-swap hand-back: run green against the
 * UNCONVERTED file first.
 *
 * 8 statements total (census: sql-tag 8 — `node scripts/check-postgres-access-layer.js
 * --json`; the "claimable"/"inserted" census "tables" are CTE aliases, not
 * real tables): enqueueAutomaticReviewSynthesisJob (CTE insert + fallback
 * SELECT), startManualReviewSynthesisJob (insert), claimAutomaticReviewSynthesisJobs
 * (CTE + UPDATE ... FROM), completeReviewSynthesisJob (UPDATE),
 * cancelReviewSynthesisJob (UPDATE), recordReviewSynthesisJobFailure (UPDATE
 * with 3 CASE expressions), getReviewSynthesisJobState (2 parallel SELECTs).
 * This test covers all of them and every castLint-flagged VALUES/CASE bound
 * column (lines 32, 68-76, 154-162).
 *
 * Only tests/unit/review-synthesis-job-service.test.js, reviewers-service.test.js,
 * and the two reviewer-engagement integration tests mock `@vercel/postgres`
 * directly; the other consumer tests mock this module's own export. One
 * characterization test (workbench-read-coalescing-stage2-characterization.test.js)
 * deliberately exercises the REAL module with no POSTGRES_URL set so
 * getReviewSynthesisJobState rejects and its caller's fallback fires — the
 * seam's `sql` is re-exported unchanged from `@vercel/postgres`
 * (lib/postgres/client.js), so that rejection behavior is identical before
 * and after the swap.
 *
 * Copies the template shape (tests/pg-contract/explorer-store.test.js):
 * PG_CONTRACT_URL gating, a direct pg Client for setup/verification/cleanup,
 * assertNoOpenTransactionAnywhere, tracked keys before writes, afterAll with
 * bounded lock_timeout/statement_timeout, and a Promise.allSettled close of
 * both the direct client and the shim pool. review_synthesis_jobs has no
 * FK, so rows are tracked and deleted by id only.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

function sha256hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

describeIfDb('review-synthesis-job-service: contract', () => {
  const store = require('../../lib/services/review-synthesis-job-service');

  let client;
  const insertedJobIds = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (insertedJobIds.length) {
        await client.query('DELETE FROM review_synthesis_jobs WHERE id = ANY($1::bigint[])', [insertedJobIds]);
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

  async function fetchJob(id) {
    const { rows } = await client.query('SELECT * FROM review_synthesis_jobs WHERE id = $1', [id]);
    return rows[0] || null;
  }

  function newRequestId() {
    return crypto.randomUUID();
  }

  describe('enqueueAutomaticReviewSynthesisJob', () => {
    test('binds every column on first insert and defaults status to queued', async () => {
      const requestId = newRequestId();
      const inputHash = sha256hex(`contract-${requestId}-a`);
      const row = await store.enqueueAutomaticReviewSynthesisJob({ requestId, inputHash });
      insertedJobIds.push(row.id);

      expect(row.mode).toBe('automatic');
      expect(row.status).toBe('queued');
      expect(row.request_id).toBe(requestId);
      expect(row.input_hash).toBe(inputHash);
      expect(row.dedupe_key).toBe(`automatic:${requestId}:${inputHash}`);
      expect(row.generation_key).toMatch(/^[0-9a-f-]{36}$/);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: a second enqueue with the SAME requestId/inputHash
    // must return the EXISTING row's id via the `SELECT * FROM inserted
    // UNION ALL SELECT ... WHERE dedupe_key = ...` fallback, not create a
    // second row and not return an undefined/empty result. A mutant that
    // dropped the UNION ALL fallback (leaving only `SELECT * FROM
    // inserted`) would return undefined here since ON CONFLICT DO NOTHING
    // makes the CTE's RETURNING empty on the second call.
    test('DISCRIMINATING: a repeat identical fingerprint returns the SAME existing row, not a new one or undefined', async () => {
      const requestId = newRequestId();
      const inputHash = sha256hex(`contract-${requestId}-b`);
      const first = await store.enqueueAutomaticReviewSynthesisJob({ requestId, inputHash });
      insertedJobIds.push(first.id);

      const second = await store.enqueueAutomaticReviewSynthesisJob({ requestId, inputHash });
      expect(second).toBeDefined();
      expect(second.id).toBe(first.id);

      const { rows } = await client.query('SELECT count(*)::int AS n FROM review_synthesis_jobs WHERE request_id = $1', [requestId]);
      expect(rows[0].n).toBe(1);
      await assertNoOpenTransactionAnywhere();
    });

    test('rejects a malformed inputHash before touching the database', async () => {
      await expect(store.enqueueAutomaticReviewSynthesisJob({ requestId: newRequestId(), inputHash: 'not-a-hash' }))
        .rejects.toThrow(/sha-256/i);
    });
  });

  describe('startManualReviewSynthesisJob', () => {
    test('binds every column: mode manual, status running, attempts 1, a lease, and a ~10-minute lock', async () => {
      const requestId = newRequestId();
      const inputHash = sha256hex(`contract-${requestId}-manual`);
      const actingUserSystemId = crypto.randomUUID();

      const row = await store.startManualReviewSynthesisJob({ requestId, inputHash, actingUserSystemId });
      insertedJobIds.push(row.id);

      expect(row.mode).toBe('manual');
      expect(row.status).toBe('running');
      expect(row.dedupe_key).toBe(`manual:${row.generation_key}`);
      expect(row.request_id).toBe(requestId);
      expect(row.input_hash).toBe(inputHash);
      expect(row.acting_user_system_id).toBe(actingUserSystemId);
      expect(row.attempts).toBe(1);
      expect(row.lease_token).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.started_at).not.toBeNull();
      const lockedUntil = new Date(row.locked_until).getTime();
      const now = Date.now();
      expect(lockedUntil).toBeGreaterThan(now + 9 * 60 * 1000);
      expect(lockedUntil).toBeLessThan(now + 11 * 60 * 1000);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('claimAutomaticReviewSynthesisJobs', () => {
    async function seedQueuedJob({ requestId, nextAttemptAt = new Date(), lockedUntil = null, startedAt = null }) {
      const inputHash = sha256hex(`contract-claim-${requestId}`);
      const { rows } = await client.query(
        `INSERT INTO review_synthesis_jobs
           (generation_key, dedupe_key, request_id, input_hash, mode, status, next_attempt_at, locked_until, started_at)
         VALUES ($1, $2, $3, $4, 'automatic', 'queued', $5, $6, $7)
         RETURNING id`,
        [crypto.randomUUID(), `automatic:${requestId}:${inputHash}`, requestId, inputHash, nextAttemptAt.toISOString(), lockedUntil, startedAt]
      );
      const id = rows[0].id;
      insertedJobIds.push(id);
      return id;
    }

    // DISCRIMINATING: three jobs seeded -- one DUE now, one not-yet-due
    // (next_attempt_at in the future), one already locked (locked_until in
    // the future). Only the due, unlocked job may be claimed. A mutant
    // that dropped either WHERE clause in the `claimable` CTE would pull
    // in one of the other two.
    test('claims only due, unlocked, queued jobs; increments attempts; sets lease/lock; SKIP LOCKED syntax executes without error', async () => {
      const dueId = await seedQueuedJob({ requestId: newRequestId(), nextAttemptAt: new Date(Date.now() - 60_000) });
      const notYetDueId = await seedQueuedJob({ requestId: newRequestId(), nextAttemptAt: new Date(Date.now() + 60 * 60_000) });
      const alreadyLockedId = await seedQueuedJob({
        requestId: newRequestId(),
        nextAttemptAt: new Date(Date.now() - 60_000),
        lockedUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
      });

      const claimed = await store.claimAutomaticReviewSynthesisJobs({ limit: 5, lockSeconds: 120 });
      const claimedIds = claimed.map((r) => r.id);
      expect(claimedIds).toContain(dueId);
      expect(claimedIds).not.toContain(notYetDueId);
      expect(claimedIds).not.toContain(alreadyLockedId);

      const dueRow = claimed.find((r) => r.id === dueId);
      expect(dueRow.status).toBe('running');
      expect(dueRow.attempts).toBe(1);
      expect(dueRow.lease_token).toMatch(/^[0-9a-f-]{36}$/);
      expect(new Date(dueRow.locked_until).getTime()).toBeGreaterThan(Date.now());
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: started_at uses COALESCE(started_at, NOW()) -- a job
    // that was already started once (from a prior failed attempt being
    // re-claimed) must keep its ORIGINAL started_at, not get it reset to
    // the new claim time. The seeded started_at is far in the past, distinct
    // from "now", so a mutant that dropped the COALESCE (always NOW()) is
    // caught by stored value.
    test('DISCRIMINATING: re-claiming a job with a prior started_at preserves it via COALESCE', async () => {
      const originalStartedAt = new Date('2020-01-01T00:00:00Z');
      const id = await seedQueuedJob({
        requestId: newRequestId(),
        nextAttemptAt: new Date(Date.now() - 60_000),
        startedAt: originalStartedAt.toISOString(),
      });

      const claimed = await store.claimAutomaticReviewSynthesisJobs({ limit: 5 });
      const row = claimed.find((r) => r.id === id);
      expect(row).toBeDefined();
      expect(new Date(row.started_at).toISOString()).toBe(originalStartedAt.toISOString());
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('completeReviewSynthesisJob / cancelReviewSynthesisJob (lease-guarded UPDATE)', () => {
    async function seedRunningJob({ requestId, leaseToken }) {
      const inputHash = sha256hex(`contract-lease-${requestId}`);
      const { rows } = await client.query(
        `INSERT INTO review_synthesis_jobs
           (generation_key, dedupe_key, request_id, input_hash, mode, status, attempts, lease_token, locked_until, started_at)
         VALUES ($1, $2, $3, $4, 'manual', 'running', 1, $5, NOW() + interval '10 minutes', NOW())
         RETURNING *`,
        [crypto.randomUUID(), `manual:${crypto.randomUUID()}`, requestId, inputHash, leaseToken]
      );
      const row = rows[0];
      insertedJobIds.push(row.id);
      return row;
    }

    test('completeReviewSynthesisJob updates only when lease_token matches', async () => {
      const leaseToken = crypto.randomUUID();
      const job = await seedRunningJob({ requestId: newRequestId(), leaseToken });

      // DISCRIMINATING: wrong lease token must be a no-op (kills a mutant
      // that dropped the `AND lease_token = ...` guard).
      const wrongLeaseResult = await store.completeReviewSynthesisJob(
        { id: job.id, lease_token: crypto.randomUUID() },
        { runId: 'run-should-not-apply' }
      );
      expect(wrongLeaseResult).toBeNull();
      expect((await fetchJob(job.id)).status).toBe('running');

      const result = await store.completeReviewSynthesisJob({ id: job.id, lease_token: leaseToken }, { runId: 'run-123' });
      expect(result.status).toBe('completed');
      expect(result.run_id).toBe('run-123');
      expect(result.locked_until).toBeNull();
      expect(result.lease_token).toBeNull();
      expect(result.completed_at).not.toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    test('cancelReviewSynthesisJob sets status cancelled and binds the truncated reason', async () => {
      const leaseToken = crypto.randomUUID();
      const job = await seedRunningJob({ requestId: newRequestId(), leaseToken });

      const result = await store.cancelReviewSynthesisJob({ id: job.id, lease_token: leaseToken }, 'operator cancelled');
      expect(result.status).toBe('cancelled');
      expect(result.last_error).toBe('operator cancelled');
      expect(result.completed_at).not.toBeNull();
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('recordReviewSynthesisJobFailure (CASE terminal logic)', () => {
    async function seedRunningJobWithAttempts({ requestId, leaseToken, attempts, nextAttemptAt }) {
      const inputHash = sha256hex(`contract-fail-${requestId}`);
      const { rows } = await client.query(
        `INSERT INTO review_synthesis_jobs
           (generation_key, dedupe_key, request_id, input_hash, mode, status, attempts, lease_token, next_attempt_at, locked_until, started_at)
         VALUES ($1, $2, $3, $4, 'automatic', 'running', $5, $6, $7, NOW() + interval '10 minutes', NOW())
         RETURNING *`,
        [crypto.randomUUID(), `automatic:${requestId}:${inputHash}`, requestId, inputHash, attempts, leaseToken, nextAttemptAt.toISOString()]
      );
      const row = rows[0];
      insertedJobIds.push(row.id);
      return row;
    }

    // DISCRIMINATING: retryable=true and attempts (1) < maxAttempts (3) ->
    // terminal=false -> status 'queued', next_attempt_at BUMPED forward,
    // completed_at NULL. The original next_attempt_at is far in the past,
    // distinct from "now + delay", so a mutant that left next_attempt_at
    // unchanged (the terminal branch) on a non-terminal failure is caught.
    test('a retryable failure under maxAttempts requeues: status queued, next_attempt_at bumped, completed_at null', async () => {
      const requestId = newRequestId();
      const leaseToken = crypto.randomUUID();
      const originalNextAttempt = new Date('2020-01-01T00:00:00Z');
      const job = await seedRunningJobWithAttempts({ requestId, leaseToken, attempts: 1, nextAttemptAt: originalNextAttempt });

      const result = await store.recordReviewSynthesisJobFailure(job, new Error('transient boom'), {
        retryable: true, maxAttempts: 3, delaySeconds: 60,
      });
      expect(result.status).toBe('queued');
      expect(result.last_error).toBe('transient boom');
      expect(new Date(result.next_attempt_at).getTime()).toBeGreaterThan(originalNextAttempt.getTime());
      expect(result.completed_at).toBeNull();
      expect(result.locked_until).toBeNull();
      expect(result.lease_token).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: same retryable=true, but attempts (3) >= maxAttempts
    // (3) -> terminal=TRUE despite retryable -- status 'failed',
    // next_attempt_at UNCHANGED (kills a mutant that only looks at
    // `retryable` and ignores the attempts/maxAttempts comparison),
    // completed_at set.
    test('DISCRIMINATING: retryable=true but attempts >= maxAttempts is terminal (failed), next_attempt_at unchanged', async () => {
      const requestId = newRequestId();
      const leaseToken = crypto.randomUUID();
      const originalNextAttempt = new Date('2020-01-01T00:00:00Z');
      const job = await seedRunningJobWithAttempts({ requestId, leaseToken, attempts: 3, nextAttemptAt: originalNextAttempt });

      const result = await store.recordReviewSynthesisJobFailure(job, new Error('exhausted'), {
        retryable: true, maxAttempts: 3, delaySeconds: 60,
      });
      expect(result.status).toBe('failed');
      expect(new Date(result.next_attempt_at).toISOString()).toBe(originalNextAttempt.toISOString());
      expect(result.completed_at).not.toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    test('a non-retryable failure is terminal regardless of attempts', async () => {
      const requestId = newRequestId();
      const leaseToken = crypto.randomUUID();
      const job = await seedRunningJobWithAttempts({ requestId, leaseToken, attempts: 0, nextAttemptAt: new Date() });

      const result = await store.recordReviewSynthesisJobFailure(job, new Error('fatal'), { retryable: false });
      expect(result.status).toBe('failed');
      expect(result.completed_at).not.toBeNull();
    });

    test('error message longer than MAX_ERROR_LENGTH is truncated to 1000 chars', async () => {
      const requestId = newRequestId();
      const leaseToken = crypto.randomUUID();
      const job = await seedRunningJobWithAttempts({ requestId, leaseToken, attempts: 0, nextAttemptAt: new Date() });
      const longMessage = 'x'.repeat(2000);

      const result = await store.recordReviewSynthesisJobFailure(job, new Error(longMessage), { retryable: false });
      expect(result.last_error).toHaveLength(1000);
    });
  });

  describe('getReviewSynthesisJobState', () => {
    // DISCRIMINATING: two jobs for the SAME requestId with different
    // input_hash -- a NEWER 'queued' job (different hash, so does NOT
    // match `matchingCompleted`) and an OLDER 'completed' job (matching
    // hash). `latest` must reflect the newer queued job (ORDER BY
    // created_at DESC), while `current`/`currentRunId` must still resolve
    // from the OLDER completed job matching the requested inputHash --
    // proving the two queries are independent, not just "the latest row".
    test('DISCRIMINATING: latest reflects the newest row while current/currentRunId match on inputHash independently of recency', async () => {
      const requestId = newRequestId();
      const completedHash = sha256hex(`contract-state-${requestId}-completed`);
      const queuedHash = sha256hex(`contract-state-${requestId}-queued`);

      const older = await client.query(
        `INSERT INTO review_synthesis_jobs
           (generation_key, dedupe_key, request_id, input_hash, mode, status, run_id, created_at, completed_at)
         VALUES ($1, $2, $3, $4, 'automatic', 'completed', 'run-old', NOW() - interval '1 hour', NOW() - interval '1 hour')
         RETURNING id`,
        [crypto.randomUUID(), `automatic:${requestId}:${completedHash}:older`, requestId, completedHash]
      );
      insertedJobIds.push(older.rows[0].id);

      const newer = await client.query(
        `INSERT INTO review_synthesis_jobs
           (generation_key, dedupe_key, request_id, input_hash, mode, status, created_at)
         VALUES ($1, $2, $3, $4, 'automatic', 'queued', NOW())
         RETURNING id`,
        [crypto.randomUUID(), `automatic:${requestId}:${queuedHash}:newer`, requestId, queuedHash]
      );
      insertedJobIds.push(newer.rows[0].id);

      const state = await store.getReviewSynthesisJobState(requestId, completedHash);
      expect(state.status).toBe('queued');
      expect(state.latestInputHash).toBe(queuedHash);
      expect(state.current).toBe(true);
      expect(state.currentRunId).toBe('run-old');
      await assertNoOpenTransactionAnywhere();
    });

    test('returns not_started shape for a request with no jobs', async () => {
      const state = await store.getReviewSynthesisJobState(newRequestId(), 'a'.repeat(64));
      expect(state.status).toBe('not_started');
      expect(state.current).toBe(false);
      expect(state.runId).toBeNull();
    });
  });
});
