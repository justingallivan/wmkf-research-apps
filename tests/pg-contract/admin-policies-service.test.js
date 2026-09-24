'use strict';

/**
 * Contract test for lib/services/admin/policies-service.js — Stage 3 item 2
 * (wave 2, slice B), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 *
 * The service also talks to Dataverse (lib/dataverse/adapters/policy.js);
 * per the plan's slice brief this contract test covers ONLY the Postgres-
 * touching exported function (`publishPolicy`) and mocks JUST the
 * Dataverse policy adapter needed to reach the three sql-tag statements
 * (writePendingAudit's INSERT into policy_publish_audit, writeFinalAudit's
 * INSERT into policy_publish_audit, and its catch-branch INSERT into
 * system_alerts). `listSlots()` never touches Postgres and is not covered
 * here (see tests/unit/policies-service.test.js for its Dataverse-mocked
 * coverage). validatePolicyMarkdown is real (not mocked) — a plain-text
 * body satisfies it without sanitization changes.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { withClient } = require('../../lib/postgres/client');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('admin/policies-service: contract', () => {
  jest.mock('../../lib/dataverse/adapters/policy.js', () => ({
    querySlotByCode: jest.fn(),
    getSlotForAdmin: jest.fn(),
    getSlotEtagRow: jest.fn(),
    getSlotCodeRow: jest.fn(),
    queryVersionsByPolicy: jest.fn(),
    queryVersionByLabel: jest.fn(),
    createVersion: jest.fn(),
    setActiveVersion: jest.fn(),
    updateVersionState: jest.fn(),
  }));

  const policy = require('../../lib/dataverse/adapters/policy.js');
  const { publishPolicy } = require('../../lib/services/admin/policies-service');

  let client;
  const insertedProfileIds = [];
  const insertedAuditRequestIds = [];
  const insertedAlertIds = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
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
      if (insertedAuditRequestIds.length) {
        await client.query('DELETE FROM policy_publish_audit WHERE request_id = ANY($1::text[])', [insertedAuditRequestIds]);
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
    const name = `admin_policies_contract_${crypto.randomBytes(6).toString('hex')}`;
    const { rows } = await client.query(
      `INSERT INTO user_profiles (name) VALUES ($1) RETURNING id`,
      [name]
    );
    insertedProfileIds.push(rows[0].id);
    return rows[0].id;
  }

  const VALID_BODY = 'This is a plain policy body used for the Stage 3 contract test.';

  test('publishPolicy Branch A (create+flip) binds every column of the pending and final policy_publish_audit rows', async () => {
    const profileId = await insertProfile();
    const requestId = crypto.randomUUID();
    insertedAuditRequestIds.push(requestId);
    const parentId = crypto.randomUUID();
    const childId = crypto.randomUUID();

    policy.querySlotByCode.mockResolvedValue({
      records: [{ wmkf_policyid: parentId, wmkf_code: 'reviewer-coi', wmkf_displayname: 'Reviewer COI', _wmkf_activeversion_value: null }],
    });
    policy.getSlotForAdmin.mockResolvedValue({ wmkf_policyid: parentId, wmkf_displayname: 'Reviewer COI', _etag: 'W/"1"' });
    policy.queryVersionsByPolicy.mockResolvedValue({ records: [] });
    policy.queryVersionByLabel.mockResolvedValue({ records: [] });
    policy.createVersion.mockResolvedValue({ wmkf_policyversionid: childId });
    policy.setActiveVersion.mockResolvedValue(undefined);

    const result = await publishPolicy({
      slotCode: 'reviewer-coi',
      versionLabel: `v_${requestId.slice(0, 8)}`,
      title: 'Contract Title',
      body: VALID_BODY,
      effectiveDate: '2026-07-04',
      parentEtag: 'W/"1"',
      requestId,
      profileId,
    });

    expect(result.outcome.status).toBe('completed');
    expect(result.auditWritten).toBe(true);

    const { rows } = await client.query(
      'SELECT * FROM policy_publish_audit WHERE request_id = $1 ORDER BY phase',
      [requestId]
    );
    expect(rows).toHaveLength(2);

    const pending = rows.find((r) => r.phase === 'pending');
    expect(pending.slot_code).toBe('reviewer-coi');
    expect(pending.version_label).toBe(`v_${requestId.slice(0, 8)}`);
    expect(pending.title).toBe('Contract Title');
    expect(pending.profile_id).toBe(profileId);
    expect(pending.status).toBe('pending');

    const final = rows.find((r) => r.phase === 'final');
    expect(final.slot_code).toBe('reviewer-coi');
    expect(final.parent_id).toBe(parentId);
    expect(final.version_label).toBe(`v_${requestId.slice(0, 8)}`);
    expect(final.version_id).toBe(childId);
    expect(final.prior_version_id).toBeNull();
    expect(final.title).toBe('Contract Title');
    expect(final.profile_id).toBe(profileId);
    expect(final.status).toBe('completed');
    expect(final.outcome_json.child.id).toBe(childId);
    expect(final.outcome_json.parent.flipped).toBe(true);
    expect(final.warnings_json).toEqual([]);

    await assertNoOpenTransactionAnywhere();
  });

  // DISCRIMINATING: forces a REAL failure in writeFinalAudit's own sql-tag
  // statement -- not a mocked rejection -- by having the (mocked) Dataverse
  // adapter hand back a BigInt id. duplicate_slot_rows -> failure() puts
  // `duplicateIds: [BigInt(...)]` into finalOutcome.details, and
  // `JSON.stringify(outcomeJson)` (evaluated INSIDE writeFinalAudit's try,
  // as part of building the tagged-template call) throws
  // "Do not know how to serialize a BigInt" -- a genuine JS/runtime error
  // on the real statement, not a stub. This exercises the catch branch's
  // system_alerts INSERT, which nothing else in this file reaches. A
  // mutant that swallows writeFinalAudit's error (returns true regardless)
  // would leave auditWritten:true and no system_alerts row -- both are
  // asserted below, killing it.
  test('DISCRIMINATING: a real JSON.stringify failure in writeFinalAudit falls back to a system_alerts row with every column bound', async () => {
    const requestId = crypto.randomUUID();
    insertedAuditRequestIds.push(requestId);
    const dupIdA = 111n;
    const dupIdB = 222n;

    policy.querySlotByCode.mockResolvedValue({
      records: [
        { wmkf_policyid: dupIdA, wmkf_code: 'reviewer-ai-use' },
        { wmkf_policyid: dupIdB, wmkf_code: 'reviewer-ai-use' },
      ],
    });

    const versionLabel = `v_${requestId.slice(0, 8)}`;
    const result = await publishPolicy({
      slotCode: 'reviewer-ai-use',
      versionLabel,
      title: 'Duplicate Slot Title',
      body: VALID_BODY,
      effectiveDate: '2026-07-04',
      parentEtag: 'W/"1"',
      requestId,
      profileId: null,
    });

    expect(result.outcome.status).toBe('duplicate_slot_rows');
    expect(result.auditWritten).toBe(false);

    const pendingRows = await client.query(
      'SELECT * FROM policy_publish_audit WHERE request_id = $1',
      [requestId]
    );
    expect(pendingRows.rows).toHaveLength(1);
    expect(pendingRows.rows[0].phase).toBe('pending');

    const alertRows = await client.query(
      `SELECT * FROM system_alerts WHERE alert_type = 'policy_audit_finalize_failed'
         AND (metadata->>'requestId') = $1`,
      [requestId]
    );
    expect(alertRows.rows).toHaveLength(1);
    const alert = alertRows.rows[0];
    insertedAlertIds.push(alert.id);

    expect(alert.severity).toBe('error');
    expect(alert.title).toBe('Policy publish audit finalize failed');
    expect(alert.message).toBe(
      `Final audit write failed for request ${requestId} (slot reviewer-ai-use, label ${versionLabel}). Pending audit row may be present; reconcile manually.`
    );
    expect(alert.source).toBe('admin/policies');
    expect(alert.metadata.requestId).toBe(requestId);
    expect(alert.metadata.slotCode).toBe('reviewer-ai-use');
    expect(alert.metadata.versionLabel).toBe(versionLabel);
    expect(alert.metadata.status).toBe('duplicate_slot_rows');
    expect(String(alert.metadata.error)).toMatch(/BigInt/);

    await assertNoOpenTransactionAnywhere();
  });
});
