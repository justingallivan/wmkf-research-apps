'use strict';

/**
 * Contract test for lib/services/reviewer-acceptance-job-service.js — Stage
 * 3 item 4 (wave 3 slice A), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 * TESTS-BEFORE for the test-then-swap hand-back: run green against the
 * UNCONVERTED file first.
 *
 * 10 statements total (census: sql-tag 10; the "claimable" census "table"
 * is a CTE alias, not a real table): enqueueReviewerAcceptanceJob (INSERT
 * ... ON CONFLICT DO UPDATE with 5 CASE guards), markReviewerAcceptanceJobQueued
 * (UPDATE with 2 CASE guards), cancelReviewerAcceptanceJob (2 statement
 * variants: lease-guarded / unguarded), cancelReviewerAcceptanceJobsForSuggestion
 * (UPDATE), claimReviewerAcceptanceJobs (CTE + UPDATE ... FROM),
 * mergeReviewerAcceptanceJobStep (jsonb_set/merge UPDATE),
 * completeReviewerAcceptanceJob (2 statement variants: with/without
 * stepsPatch), recordReviewerAcceptanceJobFailure (UPDATE with 3 CASE
 * expressions). This test covers all of them and every castLint-flagged
 * VALUES/CASE bound column (lines 109-114, 281-289).
 *
 * Only tests/unit/reviewer-acceptance-job-service.test.js and the two
 * reviewer-engagement integration tests mock `@vercel/postgres` directly;
 * the other consumer tests mock this module's own export.
 *
 * Copies the template shape (tests/pg-contract/explorer-store.test.js):
 * PG_CONTRACT_URL gating, a direct pg Client for setup/verification/cleanup,
 * assertNoOpenTransactionAnywhere, tracked keys before writes, afterAll with
 * bounded lock_timeout/statement_timeout, and a Promise.allSettled close of
 * both the direct client and the shim pool. reviewer_acceptance_jobs has no
 * FK, so rows are tracked and deleted by id only.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('reviewer-acceptance-job-service: contract', () => {
  const store = require('../../lib/services/reviewer-acceptance-job-service');
  const { decrypt } = require('../../lib/utils/encryption');

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
        await client.query('DELETE FROM reviewer_acceptance_jobs WHERE id = ANY($1::bigint[])', [insertedJobIds]);
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
    const { rows } = await client.query('SELECT * FROM reviewer_acceptance_jobs WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async function seedJob({
    suggestionId = crypto.randomUUID(),
    requestId = crypto.randomUUID(),
    reviewerId = crypto.randomUUID(),
    acceptedAt = new Date().toISOString(),
    status = 'accept_pending',
    payload = { seed: true },
    steps = {},
    attempts = 0,
    nextAttemptAt = new Date(),
    lockedUntil = null,
    leaseToken = null,
    completedAt = null,
  } = {}) {
    const { rows } = await client.query(
      `INSERT INTO reviewer_acceptance_jobs
         (acceptance_key, suggestion_id, request_id, reviewer_id, accepted_at, status, payload, steps,
          attempts, next_attempt_at, locked_until, lease_token, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        crypto.randomUUID(), suggestionId, requestId, reviewerId, acceptedAt, status,
        JSON.stringify(payload), JSON.stringify(steps), attempts, nextAttemptAt.toISOString(),
        lockedUntil, leaseToken, completedAt,
      ]
    );
    const row = rows[0];
    insertedJobIds.push(row.id);
    return row;
  }

  describe('enqueueReviewerAcceptanceJob', () => {
    test('binds every column on first insert, including an encrypted portal token', async () => {
      const suggestionId = crypto.randomUUID();
      const requestId = crypto.randomUUID();
      const reviewerId = crypto.randomUUID();
      const acceptedAt = '2026-07-01T10:00:00.000Z';

      const row = await store.enqueueReviewerAcceptanceJob({
        acceptanceKey: `contract-${crypto.randomBytes(6).toString('hex')}`,
        acceptedAt,
        suggestion: { wmkf_appreviewersuggestionid: suggestionId, _wmkf_request_value: requestId, _wmkf_potentialreviewer_value: reviewerId },
        request: { akoya_requestid: requestId },
        reviewer: { wmkf_potentialreviewersid: reviewerId },
        body: { contactEdits: { email: 'contract@example.org' } },
        isAcceptRepeat: false,
        optedOut: false,
        reviewerPortalToken: 'contract-secret-token',
      });
      insertedJobIds.push(row.id);

      expect(row.suggestion_id).toBe(suggestionId);
      expect(row.request_id).toBe(requestId);
      expect(row.reviewer_id).toBe(reviewerId);
      expect(new Date(row.accepted_at).toISOString()).toBe(acceptedAt);
      expect(row.status).toBe('accept_pending');
      expect(row.payload.action).toBe('accept');
      expect(row.payload.body.contactEdits.email).toBe('contract@example.org');
      expect(decrypt(row.payload.reviewerPortalTokenEncrypted)).toBe('contract-secret-token');
      await assertNoOpenTransactionAnywhere();
    });

    test('rejects a missing suggestion id or acceptedAt before touching the database', async () => {
      await expect(store.enqueueReviewerAcceptanceJob({ acceptedAt: new Date().toISOString(), suggestion: {} }))
        .rejects.toThrow(/suggestion id required/i);
      await expect(store.enqueueReviewerAcceptanceJob({ suggestion: { wmkf_appreviewersuggestionid: crypto.randomUUID() } }))
        .rejects.toThrow(/acceptedAt required/i);
    });

    // DISCRIMINATING: the existing row's status is 'accept_pending' (NOT in
    // ('failed','cancelled')), so every CASE guard's ELSE branch must fire:
    // status/next_attempt_at/completed_at/locked_until/lease_token all stay
    // at their PRE-EXISTING values, even though the conflicting insert
    // supplies a DIFFERENT status ('queued') and the row already carries a
    // real lease_token/locked_until that a mutant using EXCLUDED.* directly
    // would overwrite.
    test('DISCRIMINATING: re-enqueueing an active (non-terminal) job preserves status/lease/lock unchanged', async () => {
      const suggestionId = crypto.randomUUID();
      const acceptedAt = new Date().toISOString();
      const existingLease = crypto.randomUUID();
      const existingLockedUntil = new Date(Date.now() + 60 * 60_000).toISOString();
      const existing = await seedJob({
        suggestionId, acceptedAt, status: 'accept_pending',
        leaseToken: existingLease, lockedUntil: existingLockedUntil,
      });

      const row = await store.enqueueReviewerAcceptanceJob({
        acceptanceKey: `contract-conflict-${crypto.randomBytes(6).toString('hex')}`,
        acceptedAt,
        suggestion: { wmkf_appreviewersuggestionid: suggestionId },
        status: 'queued',
      });

      expect(row.id).toBe(existing.id);
      expect(row.status).toBe('accept_pending'); // unchanged, not 'queued'
      expect(row.lease_token).toBe(existingLease);
      expect(new Date(row.locked_until).toISOString()).toBe(existingLockedUntil);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: the existing row's status IS 'failed', so the CASE
    // guards' THEN branch fires: status flips to the NEW insert's status,
    // and next_attempt_at/completed_at/locked_until/lease_token all reset
    // (NOW()/NULL) despite the row previously carrying real non-null
    // values for all four -- proving the guard direction, not just that
    // "something" changed.
    test('DISCRIMINATING: re-enqueueing a terminal (failed) job resets lease/lock and applies the new status', async () => {
      const suggestionId = crypto.randomUUID();
      const acceptedAt = new Date().toISOString();
      const existing = await seedJob({
        suggestionId, acceptedAt, status: 'failed',
        leaseToken: crypto.randomUUID(),
        lockedUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
        completedAt: new Date().toISOString(),
      });

      const row = await store.enqueueReviewerAcceptanceJob({
        acceptanceKey: `contract-reset-${crypto.randomBytes(6).toString('hex')}`,
        acceptedAt,
        suggestion: { wmkf_appreviewersuggestionid: suggestionId },
        status: 'accept_pending',
      });

      expect(row.id).toBe(existing.id);
      expect(row.status).toBe('accept_pending');
      expect(row.lease_token).toBeNull();
      expect(row.locked_until).toBeNull();
      expect(row.completed_at).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('markReviewerAcceptanceJobQueued', () => {
    test('flips accept_pending to queued and pulls a future next_attempt_at to now', async () => {
      const futureAttempt = new Date(Date.now() + 60 * 60_000);
      const job = await seedJob({ status: 'accept_pending', nextAttemptAt: futureAttempt });

      const result = await store.markReviewerAcceptanceJobQueued(job.id);
      expect(result.status).toBe('queued');
      expect(new Date(result.next_attempt_at).getTime()).toBeLessThan(futureAttempt.getTime());
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: status is already 'queued' (not 'accept_pending'), so
    // it must stay 'queued' (ELSE branch) -- kills a mutant that always
    // sets status = 'queued' unconditionally, which would pass a naive
    // "result.status === 'queued'" check either way.
    test('DISCRIMINATING: a job already queued keeps its status and a past next_attempt_at unchanged', async () => {
      const pastAttempt = new Date('2020-01-01T00:00:00Z');
      const job = await seedJob({ status: 'queued', nextAttemptAt: pastAttempt });

      const result = await store.markReviewerAcceptanceJobQueued(job.id);
      expect(result.status).toBe('queued');
      expect(new Date(result.next_attempt_at).toISOString()).toBe(pastAttempt.toISOString());
    });
  });

  describe('cancelReviewerAcceptanceJob', () => {
    test('without a leaseToken, cancels unconditionally and binds the truncated reason', async () => {
      const job = await seedJob({ status: 'queued' });
      const result = await store.cancelReviewerAcceptanceJob(job.id, 'operator cancelled');
      expect(result.status).toBe('cancelled');
      expect(result.last_error).toBe('operator cancelled');
      expect(result.completed_at).not.toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: with a leaseToken supplied, a WRONG lease must be a
    // no-op -- kills a mutant that drops the `AND lease_token = ...` guard
    // on the lease-guarded variant.
    test('DISCRIMINATING: with a leaseToken, a mismatched lease is a no-op', async () => {
      const job = await seedJob({ status: 'queued', leaseToken: crypto.randomUUID() });
      const result = await store.cancelReviewerAcceptanceJob(job.id, 'wrong lease', { leaseToken: crypto.randomUUID() });
      expect(result).toBeNull();
      expect((await fetchJob(job.id)).status).toBe('queued');
    });

    test('completed_at uses COALESCE and does not overwrite an already-set completed_at', async () => {
      const existingCompletedAt = new Date('2021-06-01T00:00:00Z');
      // Seeded as 'failed' (terminal) so the completed_when_terminal CHECK
      // allows a pre-set completed_at; cancelling it again must PRESERVE
      // that original timestamp via COALESCE, not stamp a new NOW().
      const job = await seedJob({ status: 'failed', completedAt: existingCompletedAt.toISOString() });
      const result = await store.cancelReviewerAcceptanceJob(job.id, 'x');
      expect(new Date(result.completed_at).toISOString()).toBe(existingCompletedAt.toISOString());
    });
  });

  describe('cancelReviewerAcceptanceJobsForSuggestion', () => {
    // DISCRIMINATING: three jobs for the same suggestion -- one active +
    // unlocked (must cancel), one active + currently locked with a future
    // locked_until (must NOT cancel), one terminal 'completed' (must NOT
    // cancel, and would violate `status = ANY(active)` if included). A
    // mutant dropping either the status filter or the lock-freshness
    // filter would include one of the other two.
    test('cancels only active, unlocked jobs for the suggestion', async () => {
      // Distinct acceptedAt per row: the unique index is on
      // (suggestion_id, accepted_at), and Date.now() can resolve to the
      // same millisecond across these back-to-back seedJob calls.
      const suggestionId = crypto.randomUUID();
      const activeUnlocked = await seedJob({ suggestionId, status: 'queued', acceptedAt: '2026-01-01T00:00:00Z' });
      const activeLocked = await seedJob({
        suggestionId, status: 'accept_pending', leaseToken: crypto.randomUUID(),
        lockedUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
        acceptedAt: '2026-01-01T00:00:01Z',
      });
      const terminal = await seedJob({
        suggestionId, status: 'completed', completedAt: new Date().toISOString(),
        acceptedAt: '2026-01-01T00:00:02Z',
      });

      const cancelled = await store.cancelReviewerAcceptanceJobsForSuggestion(suggestionId, 'suggestion withdrawn');
      const cancelledIds = cancelled.map((r) => r.id);
      expect(cancelledIds).toContain(activeUnlocked.id);
      expect(cancelledIds).not.toContain(activeLocked.id);
      expect(cancelledIds).not.toContain(terminal.id);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('claimReviewerAcceptanceJobs', () => {
    // DISCRIMINATING: due+unlocked active job claimed; not-yet-due job and
    // already-locked job both excluded -- same shape as the review-synthesis
    // claim test, proving the `claimable` CTE's three WHERE conditions are
    // all live.
    test('claims only due, unlocked, active-status jobs and sets lease/lock', async () => {
      const due = await seedJob({ status: 'queued', nextAttemptAt: new Date(Date.now() - 60_000) });
      const notYetDue = await seedJob({ status: 'queued', nextAttemptAt: new Date(Date.now() + 60 * 60_000) });
      const alreadyLocked = await seedJob({
        status: 'accept_pending', nextAttemptAt: new Date(Date.now() - 60_000),
        leaseToken: crypto.randomUUID(), lockedUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
      });

      const claimed = await store.claimReviewerAcceptanceJobs({ limit: 5, lockSeconds: 120 });
      const claimedIds = claimed.map((r) => r.id);
      expect(claimedIds).toContain(due.id);
      expect(claimedIds).not.toContain(notYetDue.id);
      expect(claimedIds).not.toContain(alreadyLocked.id);

      const dueRow = claimed.find((r) => r.id === due.id);
      expect(dueRow.lease_token).toMatch(/^[0-9a-f-]{36}$/);
      expect(new Date(dueRow.locked_until).getTime()).toBeGreaterThan(Date.now());
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('mergeReviewerAcceptanceJobStep', () => {
    // DISCRIMINATING: the step already has {existingField:1}; the patch
    // adds {newField:2}. The merged object must have BOTH keys -- kills a
    // mutant that uses `patch` alone (dropping the `COALESCE(steps ->
    // key,'{}') || patch` merge), which would lose existingField.
    test('DISCRIMINATING: merges a patch into an existing step object, keeping prior keys', async () => {
      const job = await seedJob({ steps: { validate: { existingField: 1 } } });

      const result = await store.mergeReviewerAcceptanceJobStep(job.id, null, 'validate', { newField: 2 });
      // lease_token is NULL on the seeded job and no leaseToken was passed,
      // so the `AND lease_token = ${leaseToken}` predicate matches NULL = NULL
      // via IS NOT DISTINCT semantics? No -- plain `=` with two NULLs is
      // NULL (no match). Use the real lease token instead below.
      expect(result).toBeNull();

      const leaseToken = crypto.randomUUID();
      const leased = await seedJob({ steps: { validate: { existingField: 1 } }, leaseToken });
      const merged = await store.mergeReviewerAcceptanceJobStep(leased.id, leaseToken, 'validate', { newField: 2 });
      expect(merged.steps.validate).toEqual({ existingField: 1, newField: 2 });
      await assertNoOpenTransactionAnywhere();
    });

    test('creates a new step key when steps starts empty', async () => {
      const leaseToken = crypto.randomUUID();
      const job = await seedJob({ steps: {}, leaseToken });
      const result = await store.mergeReviewerAcceptanceJobStep(job.id, leaseToken, 'newStep', { a: 1 });
      expect(result.steps.newStep).toEqual({ a: 1 });
    });
  });

  describe('completeReviewerAcceptanceJob', () => {
    test('without stepsPatch: sets completed, clears lease/lock/last_error', async () => {
      const leaseToken = crypto.randomUUID();
      const job = await seedJob({ status: 'queued', leaseToken, lockedUntil: new Date(Date.now() + 60_000).toISOString() });
      const result = await store.completeReviewerAcceptanceJob(job.id, leaseToken);
      expect(result.status).toBe('completed');
      expect(result.last_error).toBeNull();
      expect(result.locked_until).toBeNull();
      expect(result.lease_token).toBeNull();
      expect(result.completed_at).not.toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: with stepsPatch, the patch merges into `steps` (||),
    // it does not replace it -- prior step data must survive alongside the
    // new patch.
    test('DISCRIMINATING: with stepsPatch, merges into existing steps rather than replacing them', async () => {
      const leaseToken = crypto.randomUUID();
      const job = await seedJob({ status: 'queued', leaseToken, steps: { earlier: { done: true } } });
      const result = await store.completeReviewerAcceptanceJob(job.id, leaseToken, { stepsPatch: { finalize: { done: true } } });
      expect(result.steps.earlier).toEqual({ done: true });
      expect(result.steps.finalize).toEqual({ done: true });
      await assertNoOpenTransactionAnywhere();
    });

    test('a wrong lease is a no-op', async () => {
      const job = await seedJob({ status: 'queued', leaseToken: crypto.randomUUID() });
      const result = await store.completeReviewerAcceptanceJob(job.id, crypto.randomUUID());
      expect(result).toBeNull();
    });
  });

  describe('recordReviewerAcceptanceJobFailure', () => {
    test('always increments attempts regardless of terminal outcome', async () => {
      const leaseToken = crypto.randomUUID();
      const job = await seedJob({ status: 'queued', leaseToken, attempts: 2 });
      const result = await store.recordReviewerAcceptanceJobFailure(job, new Error('boom'), { retryable: true, maxAttempts: 8 });
      expect(result.attempts).toBe(3);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: retryable=true but the NEW attempts count (job.attempts
    // + 1 = 8) reaches maxAttempts (8) -- terminal=true despite retryable,
    // so status becomes 'failed' and next_attempt_at stays at its
    // far-past original value (the ELSE branch), not bumped forward.
    test('DISCRIMINATING: retryable=true but attempts reaching maxAttempts is terminal, next_attempt_at unchanged', async () => {
      const leaseToken = crypto.randomUUID();
      const originalNextAttempt = new Date('2020-01-01T00:00:00Z');
      const job = await seedJob({ status: 'queued', leaseToken, attempts: 7, nextAttemptAt: originalNextAttempt });

      const result = await store.recordReviewerAcceptanceJobFailure(job, new Error('exhausted'), {
        retryable: true, maxAttempts: 8, delaySeconds: 60,
      });
      expect(result.status).toBe('failed');
      expect(new Date(result.next_attempt_at).toISOString()).toBe(originalNextAttempt.toISOString());
      expect(result.completed_at).not.toBeNull();
      expect(result.locked_until).toBeNull();
      expect(result.lease_token).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    test('a retryable failure under maxAttempts requeues: status unchanged, next_attempt_at bumped, completed_at unchanged', async () => {
      const leaseToken = crypto.randomUUID();
      const originalNextAttempt = new Date('2020-01-01T00:00:00Z');
      const job = await seedJob({ status: 'queued', leaseToken, attempts: 0, nextAttemptAt: originalNextAttempt });

      const result = await store.recordReviewerAcceptanceJobFailure(job, new Error('transient'), {
        retryable: true, maxAttempts: 8, delaySeconds: 60,
      });
      expect(result.status).toBe('queued'); // unchanged (ELSE `status`)
      expect(new Date(result.next_attempt_at).getTime()).toBeGreaterThan(originalNextAttempt.getTime());
      expect(result.completed_at).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    test('a wrong lease is a no-op (attempts not incremented)', async () => {
      const leaseToken = crypto.randomUUID();
      const job = await seedJob({ status: 'queued', leaseToken, attempts: 0 });
      const result = await store.recordReviewerAcceptanceJobFailure(
        { ...job, lease_token: crypto.randomUUID() },
        new Error('x'),
        {}
      );
      expect(result).toBeNull();
      expect((await fetchJob(job.id)).attempts).toBe(0);
    });

    test('error message longer than MAX_ERROR_LENGTH is truncated to 1000 chars', async () => {
      const leaseToken = crypto.randomUUID();
      const job = await seedJob({ status: 'queued', leaseToken, attempts: 0 });
      const result = await store.recordReviewerAcceptanceJobFailure(job, new Error('x'.repeat(2000)), { retryable: false });
      expect(result.last_error).toHaveLength(1000);
    });
  });
});
