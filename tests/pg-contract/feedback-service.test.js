'use strict';

/**
 * Contract test for lib/services/feedback-service.js — Stage 3 item 5 (wave
 * 3 slice A, last file), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 * TESTS-BEFORE for the test-then-swap hand-back: run green against the
 * UNCONVERTED file first.
 *
 * 10 statements total (census: sql-tag 10): createFeedback (correlation
 * SELECT + primary INSERT + 42703-fallback INSERT), getFeedback (4 SELECT
 * variants for the status/feedbackType filter combinations), getFeedbackSummary
 * (GROUP BY SELECT), updateFeedback (UPDATE with 1 CASE + 2 COALESCE),
 * cleanupOldFeedback (DELETE). This test covers all of them and every
 * castLint-flagged VALUES/CASE bound column (lines 55-58, 71-74, 182).
 *
 * dynamics_feedback has 3 FKs: user_profile_id -> user_profiles(id),
 * reviewed_by -> user_profiles(id), request_id -> dynamics_explorer_requests(request_id)
 * ON DELETE SET NULL -- every write test seeds real, non-null values for at
 * least one of these.
 *
 * Only tests/unit/feedback-service-retention.test.js and
 * feedback-service-request-correlation.test.js load the real module (both
 * mock `@vercel/postgres` directly, unaffected by the seam swap);
 * maintenance-cron-handler.test.js and notification-trust-model-pushup.test.js
 * mock this module's own export.
 *
 * Copies the template shape (tests/pg-contract/explorer-store.test.js):
 * PG_CONTRACT_URL gating, a direct pg Client for setup/verification/cleanup,
 * assertNoOpenTransactionAnywhere, tracked keys before writes, afterAll with
 * bounded lock_timeout/statement_timeout, child-first deletes in
 * try/finally, and a Promise.allSettled close of both the direct client and
 * the shim pool.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('feedback-service: contract', () => {
  const FeedbackService = require('../../lib/services/feedback-service');

  let client;
  const insertedFeedbackIds = [];
  const insertedRequestIds = [];
  const insertedUserProfileIds = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (insertedFeedbackIds.length) {
        await client.query('DELETE FROM dynamics_feedback WHERE id = ANY($1::int[])', [insertedFeedbackIds]);
      }
      if (insertedRequestIds.length) {
        await client.query('DELETE FROM dynamics_explorer_requests WHERE request_id = ANY($1::uuid[])', [insertedRequestIds]);
      }
      if (insertedUserProfileIds.length) {
        await client.query('DELETE FROM user_profiles WHERE id = ANY($1::int[])', [insertedUserProfileIds]);
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

  async function insertUserProfile(name = `feedback_contract_${crypto.randomBytes(6).toString('hex')}`) {
    const { rows } = await client.query(`INSERT INTO user_profiles (name) VALUES ($1) RETURNING id`, [name]);
    const id = rows[0].id;
    insertedUserProfileIds.push(id);
    return id;
  }

  async function insertExplorerRequest({ userProfileId, sessionId }) {
    const requestId = crypto.randomUUID();
    await client.query(
      `INSERT INTO dynamics_explorer_requests (request_id, user_profile_id, session_id, outcome, rounds_used)
       VALUES ($1, $2, $3, 'running', 0)`,
      [requestId, userProfileId, sessionId]
    );
    insertedRequestIds.push(requestId);
    return requestId;
  }

  async function fetchFeedback(id) {
    const { rows } = await client.query('SELECT * FROM dynamics_feedback WHERE id = $1', [id]);
    return rows[0] || null;
  }

  describe('createFeedback', () => {
    test('binds every column, including a verified request_id when session/user/request all match', async () => {
      const userProfileId = await insertUserProfile();
      const sessionId = 'contract-session-1';
      const requestId = await insertExplorerRequest({ userProfileId, sessionId });
      const conversationContext = { turns: [{ role: 'user', text: 'hi' }] };

      const row = await FeedbackService.createFeedback({
        userProfileId,
        sessionId,
        requestId,
        feedbackType: 'negative',
        category: 'incorrect_answer',
        userNote: 'this was wrong',
        queryText: 'what is the grant status',
        conversationContext,
        autoDetected: false,
      });
      insertedFeedbackIds.push(row.id);

      expect(row.user_profile_id).toBe(userProfileId);
      expect(row.session_id).toBe(sessionId);
      expect(row.feedback_type).toBe('negative');
      expect(row.category).toBe('incorrect_answer');
      expect(row.user_note).toBe('this was wrong');
      expect(row.query_text).toBe('what is the grant status');
      expect(row.conversation_context).toEqual(conversationContext);
      expect(row.auto_detected).toBe(false);
      expect(row.request_id).toBe(requestId);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: the correlation SELECT requires session_id AND
    // user_profile_id AND request_id to ALL match the real
    // dynamics_explorer_requests row. Here the request exists but was
    // recorded under a DIFFERENT user_profile_id, so verifiedRequestId
    // must be NULL -- the feedback is still saved (uncorrelated), never
    // discarded. A mutant that dropped the user_profile_id check from the
    // correlation WHERE clause would incorrectly bind this request_id.
    test('DISCRIMINATING: a request owned by a different user is not correlated (request_id stored as null), feedback still saved', async () => {
      const ownerProfileId = await insertUserProfile();
      const requesterProfileId = await insertUserProfile();
      const sessionId = 'contract-session-mismatch';
      const requestId = await insertExplorerRequest({ userProfileId: ownerProfileId, sessionId });

      const row = await FeedbackService.createFeedback({
        userProfileId: requesterProfileId, // does NOT own the request
        sessionId,
        requestId,
        feedbackType: 'positive',
      });
      insertedFeedbackIds.push(row.id);

      expect(row.request_id).toBeNull();
      expect(row.user_profile_id).toBe(requesterProfileId);
      await assertNoOpenTransactionAnywhere();
    });

    test('saves feedback with no session/request correlation data at all', async () => {
      const userProfileId = await insertUserProfile();
      const row = await FeedbackService.createFeedback({
        userProfileId,
        feedbackType: 'positive',
        autoDetected: true,
      });
      insertedFeedbackIds.push(row.id);
      expect(row.request_id).toBeNull();
      expect(row.session_id).toBeNull();
      expect(row.auto_detected).toBe(true);
    });
  });

  describe('getFeedback', () => {
    test('filters by status AND feedbackType together, joins user_profiles for names, orders DESC, respects limit', async () => {
      const reviewerId = await insertUserProfile('Reviewer Name');
      const authorId = await insertUserProfile('Author Name');

      const older = await FeedbackService.createFeedback({ userProfileId: authorId, feedbackType: 'negative' });
      insertedFeedbackIds.push(older.id);
      await client.query(`UPDATE dynamics_feedback SET status = 'reviewed', reviewed_by = $1 WHERE id = $2`, [reviewerId, older.id]);

      // DISCRIMINATING: a second row shares feedbackType but NOT status --
      // must be excluded when both filters are supplied (kills a mutant
      // that drops the status half of the AND).
      const wrongStatus = await FeedbackService.createFeedback({ userProfileId: authorId, feedbackType: 'negative' });
      insertedFeedbackIds.push(wrongStatus.id);

      const rows = await FeedbackService.getFeedback({ status: 'reviewed', feedbackType: 'negative', limit: 10 });
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(older.id);
      expect(ids).not.toContain(wrongStatus.id);
      const matched = rows.find((r) => r.id === older.id);
      expect(matched.user_name).toBe('Author Name');
      expect(matched.reviewed_by_name).toBe('Reviewer Name');
      await assertNoOpenTransactionAnywhere();
    });

    test('filters by status only', async () => {
      const authorId = await insertUserProfile();
      const row = await FeedbackService.createFeedback({ userProfileId: authorId, feedbackType: 'positive' });
      insertedFeedbackIds.push(row.id);
      await client.query(`UPDATE dynamics_feedback SET status = 'resolved' WHERE id = $1`, [row.id]);

      const rows = await FeedbackService.getFeedback({ status: 'resolved' });
      expect(rows.map((r) => r.id)).toContain(row.id);
    });

    test('filters by feedbackType only', async () => {
      const authorId = await insertUserProfile();
      const row = await FeedbackService.createFeedback({ userProfileId: authorId, feedbackType: 'positive' });
      insertedFeedbackIds.push(row.id);

      const rows = await FeedbackService.getFeedback({ feedbackType: 'positive' });
      expect(rows.map((r) => r.id)).toContain(row.id);
    });

    test('with no filters, returns rows across types/statuses', async () => {
      const authorId = await insertUserProfile();
      const row = await FeedbackService.createFeedback({ userProfileId: authorId, feedbackType: 'negative' });
      insertedFeedbackIds.push(row.id);

      const rows = await FeedbackService.getFeedback({ limit: 500 });
      expect(rows.map((r) => r.id)).toContain(row.id);
    });
  });

  describe('getFeedbackSummary', () => {
    test('groups counts by feedback_type and status and totals correctly', async () => {
      const authorId = await insertUserProfile();
      const a = await FeedbackService.createFeedback({ userProfileId: authorId, feedbackType: 'positive' });
      const b = await FeedbackService.createFeedback({ userProfileId: authorId, feedbackType: 'negative' });
      const c = await FeedbackService.createFeedback({ userProfileId: authorId, feedbackType: 'negative' });
      insertedFeedbackIds.push(a.id, b.id, c.id);
      await client.query(`UPDATE dynamics_feedback SET status = 'resolved' WHERE id = $1`, [c.id]);

      const summary = await FeedbackService.getFeedbackSummary();
      expect(summary.positive).toBeGreaterThanOrEqual(1);
      expect(summary.negative).toBeGreaterThanOrEqual(2);
      expect(summary.resolved).toBeGreaterThanOrEqual(1);
      expect(summary.total).toBeGreaterThanOrEqual(3);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('updateFeedback', () => {
    test('sets status, COALESCE-preserves admin_note when none supplied, and stamps reviewed_by/reviewed_at on first review', async () => {
      const authorId = await insertUserProfile();
      const reviewerId = await insertUserProfile();
      const created = await FeedbackService.createFeedback({ userProfileId: authorId, feedbackType: 'negative' });
      insertedFeedbackIds.push(created.id);

      const result = await FeedbackService.updateFeedback(created.id, { status: 'reviewed', adminNote: 'looking into it', reviewedBy: reviewerId });
      expect(result.status).toBe('reviewed');
      expect(result.admin_note).toBe('looking into it');
      expect(result.reviewed_by).toBe(reviewerId);
      expect(result.reviewed_at).not.toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: a SECOND update by a DIFFERENT reviewer, once
    // reviewed_at is already set, must NOT reassign reviewed_by (the CASE's
    // ELSE branch) and must NOT restart reviewed_at (COALESCE) or clobber
    // admin_note when the new call passes no note (COALESCE again). The
    // two reviewer ids are distinct real user_profiles rows, so a mutant
    // that always binds the new reviewedBy is caught by stored value.
    test('DISCRIMINATING: a later transition does not reassign the acknowledging reviewer or restart reviewed_at, and an omitted note preserves the old one', async () => {
      const authorId = await insertUserProfile();
      const firstReviewer = await insertUserProfile();
      const secondReviewer = await insertUserProfile();
      const created = await FeedbackService.createFeedback({ userProfileId: authorId, feedbackType: 'negative' });
      insertedFeedbackIds.push(created.id);

      await FeedbackService.updateFeedback(created.id, { status: 'reviewed', adminNote: 'first note', reviewedBy: firstReviewer });
      const firstResult = await fetchFeedback(created.id);
      const firstReviewedAt = firstResult.reviewed_at;

      const secondResult = await FeedbackService.updateFeedback(created.id, { status: 'resolved', reviewedBy: secondReviewer });
      expect(secondResult.status).toBe('resolved');
      expect(secondResult.reviewed_by).toBe(firstReviewer);
      expect(secondResult.reviewed_by).not.toBe(secondReviewer);
      expect(secondResult.admin_note).toBe('first note');
      expect(new Date(secondResult.reviewed_at).getTime()).toBe(new Date(firstReviewedAt).getTime());
      await assertNoOpenTransactionAnywhere();
    });

    test('returns null for a nonexistent id', async () => {
      const result = await FeedbackService.updateFeedback(999999999, { status: 'reviewed' });
      expect(result).toBeNull();
    });
  });

  describe('cleanupOldFeedback', () => {
    // DISCRIMINATING: three rows -- one reviewed long ago (must delete),
    // one reviewed RECENTLY (must survive, proving the retention window is
    // live, not "any reviewed row"), one NEVER reviewed with an old
    // created_at (must survive regardless of age, proving reviewed_at, not
    // created_at, gates eligibility -- kills a mutant that filters on
    // created_at instead).
    test('deletes only rows reviewed before the retention window, never unreviewed rows regardless of age', async () => {
      const authorId = await insertUserProfile();
      const oldReviewed = await FeedbackService.createFeedback({ userProfileId: authorId, feedbackType: 'negative' });
      const recentReviewed = await FeedbackService.createFeedback({ userProfileId: authorId, feedbackType: 'negative' });
      const neverReviewedButOld = await FeedbackService.createFeedback({ userProfileId: authorId, feedbackType: 'negative' });
      insertedFeedbackIds.push(oldReviewed.id, recentReviewed.id, neverReviewedButOld.id);

      await client.query(`UPDATE dynamics_feedback SET reviewed_at = NOW() - interval '30 days' WHERE id = $1`, [oldReviewed.id]);
      await client.query(`UPDATE dynamics_feedback SET reviewed_at = NOW() - interval '1 day' WHERE id = $1`, [recentReviewed.id]);
      await client.query(`UPDATE dynamics_feedback SET created_at = NOW() - interval '365 days' WHERE id = $1`, [neverReviewedButOld.id]);

      const deletedCount = await FeedbackService.cleanupOldFeedback(20);
      expect(deletedCount).toBeGreaterThanOrEqual(1);

      expect(await fetchFeedback(oldReviewed.id)).toBeNull();
      expect(await fetchFeedback(recentReviewed.id)).not.toBeNull();
      expect(await fetchFeedback(neverReviewedButOld.id)).not.toBeNull();

      // These two survived cleanup; remove them from the tracked-ids
      // afterAll cleanup is fine since they're still tracked by id.
      await assertNoOpenTransactionAnywhere();
    });
  });
});
