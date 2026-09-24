'use strict';

/**
 * Contract test for lib/services/admin/review-questions-service.js —
 * Stage 3 item 3 (wave 2, slice B),
 * docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 *
 * The service also talks to Dataverse (lib/dataverse/adapters/review-question,
 * lib/dataverse/core/changeset). Per the plan's slice brief this contract
 * test covers ONLY the Postgres-touching exported function
 * (`saveQuestionSet`) and mocks JUST the two Dataverse-facing modules needed
 * to reach the three sql-tag statements (writePendingAudit's INSERT into
 * review_question_audit, bestEffortAudit's INSERT into
 * review_question_audit, and its catch-branch INSERT into system_alerts).
 * `getQuestionSet()` never touches Postgres and is not covered here.
 * validateSubmittedSet / buildChangeset / normalizeRow / questionSetVersion
 * are real (not mocked) — they are pure, already unit-tested logic that
 * shapes what reaches the sql-tag statements.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { withClient } = require('../../lib/postgres/client');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('admin/review-questions-service: contract', () => {
  jest.mock('../../lib/dataverse/adapters/review-question', () => ({
    queryActiveQuestions: jest.fn(),
  }));
  jest.mock('../../lib/dataverse/core/changeset', () => ({
    runChangeset: jest.fn(),
  }));

  const { queryActiveQuestions } = require('../../lib/dataverse/adapters/review-question');
  const { runChangeset } = require('../../lib/dataverse/core/changeset');
  const { normalizeRow, questionSetVersion } = require('../../lib/external/review-question-fetcher');
  const { saveQuestionSet } = require('../../lib/services/admin/review-questions-service');

  let client;
  const insertedProfileIds = [];
  const insertedAuditRowIds = [];
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
      if (insertedAuditRowIds.length) {
        await client.query('DELETE FROM review_question_audit WHERE id = ANY($1::int[])', [insertedAuditRowIds]);
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
    const name = `review_questions_contract_${crypto.randomBytes(6).toString('hex')}`;
    const { rows } = await client.query(
      `INSERT INTO user_profiles (name) VALUES ($1) RETURNING id`,
      [name]
    );
    insertedProfileIds.push(rows[0].id);
    return rows[0].id;
  }

  // Fixture builders mirror tests/unit/review-questions-service.test.js so
  // the submitted/current sets satisfy validateSubmittedSet, buildChangeset,
  // and missingParentBoundKeys (affiliation + both core rating keys must
  // stay present) against the real functions, which run un-mocked here.
  const rawRich = (id, key, order, over = {}) => ({
    wmkf_reviewquestionid: id, _etag: `W/"${typeof id === 'string' ? id : String(id)}"`,
    wmkf_questionkey: key, wmkf_questionorder: order, wmkf_questiontext: `Question ${key}`,
    wmkf_questiontype: 'richtext', wmkf_required: true, wmkf_maxlength: null, wmkf_hint: null, wmkf_options: null, ...over,
  });
  const rawString = (id, key, order) => ({ ...rawRich(id, key, order), wmkf_questiontype: 'string' });
  const rawPick = (id, key, order) => ({
    ...rawRich(id, key, order), wmkf_questiontype: 'picklist',
    wmkf_options: JSON.stringify([{ value: 1, label: 'Low' }, { value: 2, label: 'High' }]),
  });
  const rawMulti = (id, key, order) => ({
    ...rawPick(id, key, order), wmkf_questiontype: 'multiselect',
  });
  const baseRaw = (affId = 'id-aff') => [
    rawString(affId, 'affiliation', 0),
    rawMulti('id-imp', 'impactAreas', 1),
    rawPick('id-risk', 'riskLevel', 2),
    rawRich('id-q4', 'riskDetail', 3),
    rawPick('id-or', 'overallAssessment', 4),
  ];
  const versionOf = (raw) => questionSetVersion(raw.map((r) => normalizeRow(r)));
  const submittedFour = () => [
    { id: 'id-aff', key: 'affiliation', label: 'Question affiliation', type: 'string', required: true },
    { id: 'id-imp', key: 'impactAreas', label: 'Question impactAreas', type: 'multiselect', required: true, options: [{ value: 1, label: 'Low' }, { value: 2, label: 'High' }] },
    { id: 'id-risk', key: 'riskLevel', label: 'Question riskLevel', type: 'picklist', required: true, options: [{ value: 1, label: 'Low' }, { value: 2, label: 'High' }] },
    { id: 'id-or', key: 'overallAssessment', label: 'Question overallAssessment', type: 'picklist', required: true, options: [{ value: 1, label: 'Low' }, { value: 2, label: 'High' }] },
  ];
  const fullSubmitted = () => {
    const [affiliation, impactAreas, riskLevel, overallAssessment] = submittedFour();
    return [
      affiliation,
      impactAreas,
      riskLevel,
      { id: 'id-q4', key: 'riskDetail', label: 'Question riskDetail', type: 'richtext', required: true },
      overallAssessment,
    ];
  };
  // validateSubmittedSet assigns `order` from list position, never trusted
  // from the client — expected fixtures for after_json comparisons must
  // include it.
  const withOrder = (rows) => rows.map((r, i) => ({ ...r, order: i }));

  function primeActive(records) {
    queryActiveQuestions.mockResolvedValue({ records, totalCount: records.length, hasMore: false });
  }

  test('saveQuestionSet binds every column of the pending and final review_question_audit rows on a successful edit', async () => {
    const profileId = await insertProfile();
    const raw = baseRaw();
    primeActive(raw);
    runChangeset.mockResolvedValue({ ok: true });

    const edited = fullSubmitted().map((r) => (r.key === 'riskDetail' ? { ...r, label: 'Edited label' } : r));
    const result = await saveQuestionSet({ questions: edited, baseVersion: versionOf(raw), profileId });

    expect(result.status).toBe('completed');
    expect(result.auditWritten).toBe(true);
    expect(runChangeset).toHaveBeenCalledTimes(1);

    const { rows } = await client.query(
      'SELECT * FROM review_question_audit WHERE profile_id = $1 ORDER BY phase',
      [profileId]
    );
    expect(rows).toHaveLength(2);
    rows.forEach((r) => insertedAuditRowIds.push(r.id));

    const pending = rows.find((r) => r.phase === 'pending');
    expect(pending.status).toBe('pending');
    expect(pending.profile_id).toBe(profileId);
    expect(pending.base_version).toBe(versionOf(raw));
    expect(pending.after_json).toEqual(withOrder(edited));

    const final = rows.find((r) => r.phase === 'final');
    // Both rows share the SAME request_id (assigned once in saveQuestionSet
    // and reused for the pending and final writes).
    expect(final.request_id).toBe(pending.request_id);
    expect(final.status).toBe('completed');
    expect(final.profile_id).toBe(profileId);
    expect(final.base_version).toBe(versionOf(raw));
    expect(final.result_version).toBe(result.version);
    expect(final.summary_json).toEqual(result.summary);
    expect(final.summary_json).toMatchObject({ updated: 1 });
    expect(final.after_json).toEqual(withOrder(edited));
    expect(final.before_json).toHaveLength(5);
    expect(final.before_json.find((r) => r.key === 'riskDetail').label).toBe('Question riskDetail');
    expect(final.warnings_json).toEqual([]);

    await assertNoOpenTransactionAnywhere();
  });

  // DISCRIMINATING: forces a REAL JavaScript TypeError inside bestEffortAudit,
  // thrown by JSON.stringify before its sql-tag statement ever runs -- not a
  // mocked rejection and not a sql-tag/driver failure. The mocked Dataverse adapter hands
  // back the 'riskDetail' row (a non-parent-bound key, safe to omit from
  // the submitted set) with wmkf_reviewquestionid set to a BigInt.
  // readActiveSetWithIds copies that id straight through into
  // currentRows[].id with NO validation (unlike every other field, which
  // normalizeRow/validateSubmittedSet reshape into safe primitives). The
  // submitted set omits 'riskDetail', so buildChangeset's removed-rows loop
  // (which needs no id lookup/match, unlike the update branch) plans a
  // soft-delete for it without erroring -- producing a valid, non-empty
  // operations plan. currentRows (with the BigInt id row) becomes `before`
  // in the final bestEffortAudit call, so `JSON.stringify(before)`
  // (evaluated INSIDE the try, building the tagged-template call) throws
  // "Do not know how to serialize a BigInt" -- exercising the catch
  // branch's system_alerts INSERT that nothing else in this file reaches.
  // A mutant that swallows this error and returns true regardless would
  // leave auditWritten:true and no system_alerts row -- both are asserted
  // below, killing it.
  test('DISCRIMINATING: a real JSON.stringify failure in bestEffortAudit falls back to a system_alerts row with every column bound', async () => {
    const profileId = await insertProfile();
    const raw = [
      rawString('id-aff', 'affiliation', 0),
      rawMulti('id-imp', 'impactAreas', 1),
      rawPick('id-risk', 'riskLevel', 2),
      rawRich(999999999999999999999n, 'riskDetail', 3),
      rawPick('id-or', 'overallAssessment', 4),
    ];
    primeActive(raw);
    runChangeset.mockResolvedValue({ ok: true });

    const result = await saveQuestionSet({ questions: submittedFour(), baseVersion: versionOf(raw), profileId });

    expect(result.status).toBe('completed');
    expect(result.auditWritten).toBe(false);

    const { rows: auditRows } = await client.query(
      'SELECT * FROM review_question_audit WHERE profile_id = $1',
      [profileId]
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].phase).toBe('pending');
    insertedAuditRowIds.push(auditRows[0].id);
    const requestId = auditRows[0].request_id;

    const { rows: alertRows } = await client.query(
      `SELECT * FROM system_alerts WHERE alert_type = 'review_question_audit_failed'
         AND (metadata->>'requestId') = $1`,
      [requestId]
    );
    expect(alertRows).toHaveLength(1);
    const alert = alertRows[0];
    insertedAlertIds.push(alert.id);

    expect(alert.severity).toBe('error');
    expect(alert.title).toBe('Review question audit write failed');
    expect(alert.message).toBe(`Audit write (final/completed) failed for request ${requestId}.`);
    expect(alert.source).toBe('admin/review-questions');
    expect(alert.metadata.requestId).toBe(requestId);
    expect(alert.metadata.phase).toBe('final');
    expect(alert.metadata.status).toBe('completed');
    expect(String(alert.metadata.error)).toMatch(/BigInt/);

    await assertNoOpenTransactionAnywhere();
  });
});
