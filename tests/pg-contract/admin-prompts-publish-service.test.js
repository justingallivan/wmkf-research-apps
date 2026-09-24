'use strict';

/**
 * Contract test for lib/services/admin/prompts-publish-service.js —
 * Stage 3 item 4 (wave 2, slice B),
 * docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 *
 * The service also talks to Dataverse (lib/dataverse/adapters/ai-prompt)
 * and Executor budget settings (lib/services/executor-budget-service, which
 * itself reaches Dataverse settings). Per the plan's slice brief this
 * contract test covers ONLY the Postgres-touching exported function
 * (`publishPrompt`) and mocks JUST those two modules — the minimum needed
 * to reach the five sql-tag statements (loadPriorAudit's SELECT,
 * writePendingAudit's INSERT, finalizeAudit's INSERT, its catch-branch
 * system_alerts INSERT, and alertDuplicateCurrent's system_alerts INSERT).
 * `getPrompt()` never touches Postgres and is not covered here.
 * validatePromptForSave / validatePromptTemplatePair /
 * validateReviewedClaudeModelValue run for real (pure validation logic
 * against the same NAME/VALID_BODY fixtures as
 * tests/unit/prompts-publish-service.test.js).
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { withClient } = require('../../lib/postgres/client');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('admin/prompts-publish-service: contract', () => {
  jest.mock('../../lib/dataverse/adapters/ai-prompt', () => ({
    listVersions: jest.fn(),
    queryCurrentRows: jest.fn(),
    queryCurrentIdVersions: jest.fn(),
    getIdOnly: jest.fn(),
    create: jest.fn(),
    setIsCurrent: jest.fn(),
  }));
  jest.mock('../../lib/services/executor-budget-service', () => ({
    assertExecutorBudgetForPromptModel: jest.fn(async () => null),
  }));

  const aiPrompt = require('../../lib/dataverse/adapters/ai-prompt');
  const { publishPrompt } = require('../../lib/services/admin/prompts-publish-service');
  const { ANALYZE_USER_PROMPT_TEMPLATE } = require('../../shared/config/prompts/reviewer-finder-dynamics');

  const NAME = 'reviewer-finder.analyze';
  const VALID_BODY = ANALYZE_USER_PROMPT_TEMPLATE;
  const ANALYZE_VARIABLES = JSON.stringify({
    variables: ['proposal_text', 'additional_notes_block', 'reviewer_count'].map((name) => ({ name })),
  });

  const currentRow = ({
    version = 3, id = 'prior', name = NAME, body = VALID_BODY, systemPrompt = '',
    variables = ANALYZE_VARIABLES, outputSchema = null, model = 'sonnet',
    temperature = null, maxTokens = null,
  } = {}) => ({
    wmkf_ai_promptid: id, wmkf_ai_promptname: name, wmkf_promptversion: version,
    wmkf_ai_iscurrent: true, wmkf_ai_promptbody: body,
    wmkf_ai_systemprompt: systemPrompt, wmkf_ai_promptvariables: variables,
    wmkf_ai_promptoutputschema: outputSchema, wmkf_ai_model: model,
    wmkf_ai_temperature: temperature, wmkf_ai_maxtokens: maxTokens,
  });

  let client;
  const insertedProfileIds = [];
  const insertedAuditRowIds = [];
  const insertedAlertIds = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  beforeEach(() => {
    aiPrompt.getIdOnly.mockResolvedValue({ wmkf_ai_promptid: 'prior', _etag: 'W/"1"' });
    aiPrompt.create.mockResolvedValue({ wmkf_ai_promptid: 'new-row' });
    aiPrompt.setIsCurrent.mockResolvedValue({});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (insertedAlertIds.length) {
        await client.query('DELETE FROM system_alerts WHERE id = ANY($1::int[])', [insertedAlertIds]);
      }
      if (insertedAuditRowIds.length) {
        await client.query('DELETE FROM prompt_publish_audit WHERE id = ANY($1::int[])', [insertedAuditRowIds]);
      }
      if (insertedProfileIds.length) {
        await client.query('DELETE FROM user_profiles WHERE id = ANY($1::int[])', [insertedProfileIds]);
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

  async function insertProfile() {
    const name = `admin_prompts_contract_${crypto.randomBytes(6).toString('hex')}`;
    const { rows } = await client.query(
      `INSERT INTO user_profiles (name) VALUES ($1) RETURNING id`,
      [name]
    );
    insertedProfileIds.push(rows[0].id);
    return rows[0].id;
  }

  test('publishPrompt binds every column of the pending and final prompt_publish_audit rows on a fresh create+flip', async () => {
    const profileId = await insertProfile();
    const requestId = crypto.randomUUID();
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow({ model: 'Sonnet' })] });
    aiPrompt.queryCurrentIdVersions.mockResolvedValue({ records: [{ wmkf_ai_promptid: 'new-row' }] });

    const result = await publishPrompt({
      name: NAME, body: `${VALID_BODY}\nEDIT`, requestId, profileId,
    });

    expect(result).toMatchObject({ status: 'completed', newPromptId: 'new-row', targetVersion: 4, warnings: [] });

    const { rows } = await client.query(
      'SELECT * FROM prompt_publish_audit WHERE request_id = $1 ORDER BY phase',
      [requestId]
    );
    expect(rows).toHaveLength(2);
    rows.forEach((r) => insertedAuditRowIds.push(r.id));

    const pending = rows.find((r) => r.phase === 'pending');
    expect(pending.prompt_name).toBe(NAME);
    expect(pending.target_version).toBe(4);
    expect(pending.prior_prompt_id).toBe('prior');
    expect(pending.profile_id).toBe(profileId);
    expect(pending.status).toBe('pending');
    expect(pending.outcome_json).toEqual({ fingerprintVersion: 2, priorModel: 'Sonnet', newModel: 'sonnet' });
    expect(typeof pending.body_hash).toBe('string');
    expect(pending.body_hash).toMatch(/^[0-9a-f]{64}$/);

    const final = rows.find((r) => r.phase === 'final');
    expect(final.request_id).toBe(pending.request_id);
    expect(final.prompt_name).toBe(NAME);
    expect(final.target_version).toBe(4);
    expect(final.new_prompt_id).toBe('new-row');
    expect(final.prior_prompt_id).toBe('prior');
    expect(final.profile_id).toBe(profileId);
    expect(final.status).toBe('completed');
    // The two audit rows must be bound to the SAME payload fingerprint —
    // proves body_hash is a real bound column, not a per-call recompute.
    expect(final.body_hash).toBe(pending.body_hash);
    expect(final.outcome_json).toMatchObject({
      status: 'completed', newPromptId: 'new-row', targetVersion: 4, warnings: [],
      fingerprintVersion: 2, priorModel: 'Sonnet', newModel: 'sonnet',
    });
    expect(final.warnings_json).toEqual([]);

    await assertNoOpenTransactionAnywhere();
  });

  // DISCRIMINATING: forces a REAL JavaScript TypeError inside finalizeAudit,
  // thrown by JSON.stringify before its sql-tag statement ever runs -- not a
  // mocked rejection and not a sql-tag/driver failure. The mocked Dataverse adapter's
  // create() hands back a BigInt new-row id (`wmkf_ai_promptid`), a field
  // with NO validation anywhere on this path (unlike body/model, which are
  // reshaped by real validators). That BigInt flows into
  // `outcome.newPromptId`, which appears ONLY in finalizeAudit's own
  // outcome_json (writePendingAudit's outcome_json is written earlier and
  // never includes newPromptId, so it succeeds normally). `JSON.stringify(outcome)`
  // (evaluated INSIDE finalizeAudit's try, building the tagged-template
  // call) then throws "Do not know how to serialize a BigInt" --
  // exercising the catch branch's system_alerts INSERT that nothing else
  // in this file reaches. A mutant that swallows this error and returns
  // true regardless would leave no system_alerts row while still reporting
  // 'completed' -- asserted below, killing it.
  test('DISCRIMINATING: a real JSON.stringify failure in finalizeAudit falls back to a system_alerts row with every column bound', async () => {
    const requestId = crypto.randomUUID();
    aiPrompt.queryCurrentRows.mockResolvedValue({ records: [currentRow()] });
    aiPrompt.create.mockResolvedValue({ wmkf_ai_promptid: 555555555555555555555n });
    aiPrompt.queryCurrentIdVersions.mockResolvedValue({ records: [{ wmkf_ai_promptid: 'irrelevant' }] });

    const result = await publishPrompt({
      name: NAME, body: `${VALID_BODY}\nEDIT2`, requestId, profileId: null,
    });

    expect(result.status).toBe('completed');

    const { rows: auditRows } = await client.query(
      'SELECT * FROM prompt_publish_audit WHERE request_id = $1',
      [requestId]
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].phase).toBe('pending');
    insertedAuditRowIds.push(auditRows[0].id);

    const { rows: alertRows } = await client.query(
      `SELECT * FROM system_alerts WHERE alert_type = 'prompt_audit_finalize_failed'
         AND (metadata->>'requestId') = $1`,
      [requestId]
    );
    expect(alertRows).toHaveLength(1);
    const alert = alertRows[0];
    insertedAlertIds.push(alert.id);

    expect(alert.severity).toBe('error');
    expect(alert.title).toBe('Prompt publish audit finalize failed');
    expect(alert.message).toBe(`Final audit write failed for request ${requestId} (prompt ${NAME}). Reconcile manually.`);
    expect(alert.source).toBe('admin/prompts');
    expect(alert.metadata.requestId).toBe(requestId);
    expect(alert.metadata.name).toBe(NAME);
    expect(alert.metadata.status).toBe('completed');
    expect(String(alert.metadata.error)).toMatch(/BigInt/);

    await assertNoOpenTransactionAnywhere();
  });

  // Covers the fifth sql-tag statement: alertDuplicateCurrent's
  // system_alerts INSERT, reached via the non-resumable multi-current
  // (duplicate_current_rows) branch, which returns before touching
  // prompt_publish_audit at all.
  test('a non-resumable multi-current state writes a system_alerts row with every column bound, then throws', async () => {
    const uniqueName = `${NAME}.contract.${crypto.randomBytes(6).toString('hex')}`;
    aiPrompt.queryCurrentRows.mockResolvedValue({
      records: [
        currentRow({ name: uniqueName, version: 3, id: 'dup-a' }),
        currentRow({ name: uniqueName, version: 8, id: 'dup-b' }),
      ],
    });

    await expect(publishPrompt({ name: uniqueName, body: `${VALID_BODY}\nEDIT3` }))
      .rejects.toMatchObject({
        httpStatus: 500,
        body: expect.objectContaining({ status: 'duplicate_current_rows', ids: ['dup-a', 'dup-b'] }),
      });
    expect(aiPrompt.create).not.toHaveBeenCalled();

    const { rows: alertRows } = await client.query(
      `SELECT * FROM system_alerts WHERE alert_type = 'prompt_duplicate_current_rows'
         AND (metadata->>'name') = $1`,
      [uniqueName]
    );
    expect(alertRows).toHaveLength(1);
    const alert = alertRows[0];
    insertedAlertIds.push(alert.id);

    expect(alert.severity).toBe('error');
    expect(alert.title).toBe('Prompt store has multiple current rows');
    expect(alert.message).toBe(`Prompt "${uniqueName}" has 2 rows with iscurrent=true — resolve in Dynamics.`);
    expect(alert.source).toBe('admin/prompts');
    expect(alert.metadata.name).toBe(uniqueName);
    expect(alert.metadata.ids).toEqual(['dup-a', 'dup-b']);

    const { rows: auditRows } = await client.query(
      'SELECT count(*)::int AS n FROM prompt_publish_audit WHERE prompt_name = $1',
      [uniqueName]
    );
    expect(auditRows[0].n).toBe(0);

    await assertNoOpenTransactionAnywhere();
  });
});
