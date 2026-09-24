'use strict';

/**
 * Contract test for lib/services/panel-review-service.js — Stage 3 item 3
 * (wave 3 slice A), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 *
 * Scope: this file has no unit test of its own (source-only coverage), so
 * per plan §2 rule 9 this contract test IS the tests-before requirement.
 * PanelReviewService has 8 statements total (sql-tag 6, sql.query 2 —
 * `node scripts/check-postgres-access-layer.js --json`), all in the "DB
 * OPERATIONS" block plus `_calculateCosts`: createPanelReview (INSERT),
 * updatePanelReview (dynamic UPDATE via sql.query), createReviewItem
 * (INSERT), updateReviewItem (dynamic UPDATE via sql.query), getPanelReview
 * (2 SELECTs), getPanelReviewHistory (SELECT), _calculateCosts (SELECT).
 * This test covers all 8. The "ORCHESTRATION" methods (runFullPanel,
 * _runStage, _runDevilsAdvocate, _runSynthesis, _runIntelligencePass) call
 * MultiLLMService/LiteratureSearchService for LLM/search work and touch no
 * SQL directly beyond calling into the DB-operation methods already
 * covered here — out of scope for an import-swap contract test (Stage 4/5
 * territory, not this seam change).
 *
 * Copies the template shape (tests/pg-contract/explorer-store.test.js):
 * PG_CONTRACT_URL gating, a direct pg Client for setup/verification/cleanup,
 * assertNoOpenTransactionAnywhere, tracked keys before writes, afterAll with
 * bounded lock_timeout/statement_timeout, child-first deletes in
 * try/finally, and a Promise.allSettled close of both the direct client and
 * the shim pool. panel_review_items.panel_review_id has ON DELETE CASCADE
 * from panel_reviews, but child rows are still deleted explicitly first for
 * template consistency and to make the FK reachable if the CASCADE were
 * ever changed.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('panel-review-service: contract', () => {
  const { PanelReviewService } = require('../../lib/services/panel-review-service');

  let client;
  const insertedUserProfileIds = [];
  const insertedPanelReviewIds = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (insertedPanelReviewIds.length) {
        await client.query('DELETE FROM panel_review_items WHERE panel_review_id = ANY($1::int[])', [insertedPanelReviewIds]);
        await client.query('DELETE FROM panel_reviews WHERE id = ANY($1::int[])', [insertedPanelReviewIds]);
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

  async function insertUserProfile() {
    const name = `panel_review_contract_${crypto.randomBytes(6).toString('hex')}`;
    const { rows } = await client.query(`INSERT INTO user_profiles (name) VALUES ($1) RETURNING id`, [name]);
    const id = rows[0].id;
    insertedUserProfileIds.push(id);
    return id;
  }

  async function fetchPanelReview(id) {
    const { rows } = await client.query('SELECT * FROM panel_reviews WHERE id = $1', [id]);
    return rows[0] || null;
  }

  describe('createPanelReview', () => {
    test('binds every column, hashes proposalText with sha256, and defaults status to pending', async () => {
      const userProfileId = await insertUserProfile();
      const proposalText = `proposal text ${crypto.randomBytes(8).toString('hex')}`;
      const config = { providers: ['claude', 'openai'], includeDevilsAdvocate: true };

      const id = await PanelReviewService.createPanelReview(userProfileId, {
        proposalTitle: 'A Real Title',
        proposalFilename: 'proposal.pdf',
        proposalText,
        config,
      });
      insertedPanelReviewIds.push(id);

      const row = await fetchPanelReview(id);
      expect(row.user_profile_id).toBe(userProfileId);
      expect(row.proposal_title).toBe('A Real Title');
      expect(row.proposal_filename).toBe('proposal.pdf');
      expect(row.proposal_text_hash).toBe(crypto.createHash('sha256').update(proposalText).digest('hex'));
      expect(row.config).toEqual(config);
      expect(row.status).toBe('pending');
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: proposalTitle: undefined must fall back to the
    // literal 'Untitled Proposal' (`proposalTitle || 'Untitled Proposal'`),
    // not null and not ''. A mutant that dropped the fallback, or coerced
    // to '' instead, is caught by stored VALUE.
    test('DISCRIMINATING: an undefined proposalTitle falls back to the literal "Untitled Proposal"', async () => {
      const userProfileId = await insertUserProfile();
      const id = await PanelReviewService.createPanelReview(userProfileId, {
        proposalText: 'x'.repeat(20),
        config: {},
      });
      insertedPanelReviewIds.push(id);

      const row = await fetchPanelReview(id);
      expect(row.proposal_title).toBe('Untitled Proposal');
      expect(row.proposal_filename).toBeNull();
    });
  });

  describe('updatePanelReview', () => {
    test('JSON-stringifies panelSummary/costBreakdown/config, converts camelCase keys, and binds raw scalars', async () => {
      const userProfileId = await insertUserProfile();
      const id = await PanelReviewService.createPanelReview(userProfileId, { proposalText: 'y'.repeat(20), config: {} });
      insertedPanelReviewIds.push(id);

      const panelSummary = { verdict: 'fund', confidence: 0.8 };
      const costBreakdown = { claude: 120, openai: 80 };
      const startedAt = new Date('2026-01-01T00:00:00Z').toISOString();
      const completedAt = new Date('2026-01-01T01:00:00Z').toISOString();

      await PanelReviewService.updatePanelReview(id, {
        status: 'completed',
        currentStage: 'synthesis',
        panelSummary,
        totalCostCents: 200,
        costBreakdown,
        startedAt,
        completedAt,
      });

      const row = await fetchPanelReview(id);
      expect(row.status).toBe('completed');
      expect(row.current_stage).toBe('synthesis');
      expect(row.panel_summary).toEqual(panelSummary);
      expect(Number(row.total_cost_cents)).toBe(200);
      expect(row.cost_breakdown).toEqual(costBreakdown);
      // started_at/completed_at are TIMESTAMP WITHOUT TIME ZONE columns:
      // node-postgres reads them back as a Date in the PROCESS's local
      // timezone, so comparing via .toISOString() is host-timezone
      // dependent. Cast to text in SQL instead, which reflects exactly
      // what was stored regardless of the test host's TZ.
      const { rows: textRows } = await client.query(
        `SELECT started_at::text AS started_at_text, completed_at::text AS completed_at_text
           FROM panel_reviews WHERE id = $1`,
        [id]
      );
      expect(textRows[0].started_at_text).toBe('2026-01-01 00:00:00');
      expect(textRows[0].completed_at_text).toBe('2026-01-01 01:00:00');
      await assertNoOpenTransactionAnywhere();
    });

    test('an empty updates object is a no-op (no query issued, row unchanged)', async () => {
      const userProfileId = await insertUserProfile();
      const id = await PanelReviewService.createPanelReview(userProfileId, { proposalText: 'z'.repeat(20), config: {} });
      insertedPanelReviewIds.push(id);

      await expect(PanelReviewService.updatePanelReview(id, {})).resolves.toBeUndefined();

      const row = await fetchPanelReview(id);
      expect(row.status).toBe('pending');
    });
  });

  describe('createReviewItem / updateReviewItem', () => {
    test('createReviewItem binds every column and defaults status/started_at', async () => {
      const userProfileId = await insertUserProfile();
      const panelReviewId = await PanelReviewService.createPanelReview(userProfileId, { proposalText: 'w'.repeat(20), config: {} });
      insertedPanelReviewIds.push(panelReviewId);

      const itemId = await PanelReviewService.createReviewItem(panelReviewId, 'claude', 'claude-model-x', 'structured_review');

      const { rows } = await client.query('SELECT * FROM panel_review_items WHERE id = $1', [itemId]);
      const row = rows[0];
      expect(row.panel_review_id).toBe(panelReviewId);
      expect(row.llm_provider).toBe('claude');
      expect(row.llm_model).toBe('claude-model-x');
      expect(row.stage).toBe('structured_review');
      expect(row.status).toBe('in_progress');
      expect(row.started_at).not.toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    test('updateReviewItem JSON-stringifies parsedResponse and binds raw scalars for everything else', async () => {
      const userProfileId = await insertUserProfile();
      const panelReviewId = await PanelReviewService.createPanelReview(userProfileId, { proposalText: 'v'.repeat(20), config: {} });
      insertedPanelReviewIds.push(panelReviewId);
      const itemId = await PanelReviewService.createReviewItem(panelReviewId, 'openai', 'gpt-x', 'structured_review');

      const parsedResponse = { overallRating: 4, riskRating: 2 };
      await PanelReviewService.updateReviewItem(itemId, {
        status: 'completed',
        rawResponse: 'raw text blob',
        parsedResponse,
        errorMessage: null,
        inputTokens: 500,
        outputTokens: 700,
        estimatedCostCents: 33.5,
        latencyMs: 4200,
        completedAt: new Date('2026-02-01T00:00:00Z').toISOString(),
      });

      const { rows } = await client.query('SELECT * FROM panel_review_items WHERE id = $1', [itemId]);
      const row = rows[0];
      expect(row.status).toBe('completed');
      expect(row.raw_response).toBe('raw text blob');
      expect(row.parsed_response).toEqual(parsedResponse);
      expect(row.error_message).toBeNull();
      expect(row.input_tokens).toBe(500);
      expect(row.output_tokens).toBe(700);
      expect(Number(row.estimated_cost_cents)).toBe(33.5);
      expect(row.latency_ms).toBe(4200);
      expect(row.completed_at).not.toBeNull();
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('getPanelReview', () => {
    test('returns null for an id that does not exist', async () => {
      const result = await PanelReviewService.getPanelReview(999999999);
      expect(result).toBeNull();
    });

    // DISCRIMINATING: items are inserted in REVERSE created_at order (the
    // later-timestamped item inserted FIRST) via an explicit created_at, so
    // a mutant that relies on insertion/heap order instead of
    // `ORDER BY created_at` would return them in the wrong sequence. The
    // fixture is anti-correlated with insertion order on purpose.
    test('DISCRIMINATING: returns the review merged with its items ordered by created_at ascending, independent of insertion order', async () => {
      const userProfileId = await insertUserProfile();
      const panelReviewId = await PanelReviewService.createPanelReview(userProfileId, { proposalText: 'u'.repeat(20), config: {} });
      insertedPanelReviewIds.push(panelReviewId);

      const later = new Date('2026-03-01T12:00:00Z');
      const earlier = new Date('2026-03-01T10:00:00Z');
      const laterItem = await client.query(
        `INSERT INTO panel_review_items (panel_review_id, llm_provider, llm_model, stage, created_at)
         VALUES ($1, 'claude', 'm', 'structured_review', $2) RETURNING id`,
        [panelReviewId, later.toISOString()]
      );
      const earlierItem = await client.query(
        `INSERT INTO panel_review_items (panel_review_id, llm_provider, llm_model, stage, created_at)
         VALUES ($1, 'openai', 'm', 'structured_review', $2) RETURNING id`,
        [panelReviewId, earlier.toISOString()]
      );

      const result = await PanelReviewService.getPanelReview(panelReviewId);
      expect(result.id).toBe(panelReviewId);
      expect(result.items.map((i) => i.id)).toEqual([earlierItem.rows[0].id, laterItem.rows[0].id]);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('getPanelReviewHistory', () => {
    // DISCRIMINATING: three reviews for the target user with explicit,
    // non-default-order created_at timestamps, plus one review for a
    // DIFFERENT user with a created_at that would sort first if the
    // user_profile_id filter were dropped. limit=2 must return exactly the
    // two most recent of the target user's three, in DESC order -- kills a
    // mutant that drops the WHERE filter, the ORDER BY, or the LIMIT.
    test('filters by user_profile_id, orders by created_at DESC, and respects limit', async () => {
      const targetUser = await insertUserProfile();
      const otherUser = await insertUserProfile();

      const targetOld = await PanelReviewService.createPanelReview(targetUser, { proposalText: 't1'.repeat(20), config: {} });
      const targetMid = await PanelReviewService.createPanelReview(targetUser, { proposalText: 't2'.repeat(20), config: {} });
      const targetNew = await PanelReviewService.createPanelReview(targetUser, { proposalText: 't3'.repeat(20), config: {} });
      const otherNewest = await PanelReviewService.createPanelReview(otherUser, { proposalText: 'o1'.repeat(20), config: {} });
      insertedPanelReviewIds.push(targetOld, targetMid, targetNew, otherNewest);

      await client.query(`UPDATE panel_reviews SET created_at = $1 WHERE id = $2`, ['2026-01-01T00:00:00Z', targetOld]);
      await client.query(`UPDATE panel_reviews SET created_at = $1 WHERE id = $2`, ['2026-01-02T00:00:00Z', targetMid]);
      await client.query(`UPDATE panel_reviews SET created_at = $1 WHERE id = $2`, ['2026-01-03T00:00:00Z', targetNew]);
      // Sorts before all target rows if the filter were dropped.
      await client.query(`UPDATE panel_reviews SET created_at = $1 WHERE id = $2`, ['2026-01-05T00:00:00Z', otherNewest]);

      const history = await PanelReviewService.getPanelReviewHistory(targetUser, 2);
      expect(history.map((r) => r.id)).toEqual([targetNew, targetMid]);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('_calculateCosts', () => {
    // DISCRIMINATING: a 'failed' item for the SAME provider with a large
    // cost is seeded alongside two 'completed' items -- if the
    // `status = 'completed'` filter were dropped, the sum would include
    // the failed item's cost and fail the exact-total assertion below.
    test('sums estimated_cost_cents per provider for completed items only, excluding failed', async () => {
      const userProfileId = await insertUserProfile();
      const panelReviewId = await PanelReviewService.createPanelReview(userProfileId, { proposalText: 's'.repeat(20), config: {} });
      insertedPanelReviewIds.push(panelReviewId);

      const item1 = await PanelReviewService.createReviewItem(panelReviewId, 'claude', 'm', 'structured_review');
      const item2 = await PanelReviewService.createReviewItem(panelReviewId, 'claude', 'm', 'claim_verification');
      const item3 = await PanelReviewService.createReviewItem(panelReviewId, 'claude', 'm', 'devils_advocate');
      const item4 = await PanelReviewService.createReviewItem(panelReviewId, 'openai', 'm', 'structured_review');

      await PanelReviewService.updateReviewItem(item1, { status: 'completed', estimatedCostCents: 10 });
      await PanelReviewService.updateReviewItem(item2, { status: 'completed', estimatedCostCents: 20 });
      // Same provider ('claude'), 'failed' -- must be excluded from the sum.
      await PanelReviewService.updateReviewItem(item3, { status: 'failed', estimatedCostCents: 9999 });
      await PanelReviewService.updateReviewItem(item4, { status: 'completed', estimatedCostCents: 5 });

      const breakdown = await PanelReviewService._calculateCosts(panelReviewId);
      expect(breakdown.claude).toBe(30);
      expect(breakdown.openai).toBe(5);
      expect(breakdown.claude).not.toBe(10029);
      await assertNoOpenTransactionAnywhere();
    });
  });
});
