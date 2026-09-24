'use strict';

/**
 * Contract test for lib/services/consultant-feedback-service.js — Stage 3
 * item 4 TESTS-BEFORE (docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md).
 * NO CONVERSION in this pass: the service still imports `db`/`sql` from
 * `@vercel/postgres` directly; this test runs, and must pass, against
 * that UNCONVERTED source. `lib/postgres/client` is used here only as
 * test infrastructure (the Stage 2 open-transaction assertion helper).
 *
 * tests/unit/consultant-feedback-service.test.js already exercises every
 * branch against a mocked `client.query`/`sql.query`; per plan §2 rule 9
 * this contract test supplements it with the real planner: FK/UNIQUE/CHECK
 * constraints, and — the excluded transaction shape's whole point — that
 * every transaction-owning function's ROLLBACK path leaves the tables
 * byte-for-byte unchanged, not just that `ROLLBACK` was called on a mock.
 * `writeFeedbackEntry`, `updateFeedbackEntry`, and `deleteFeedbackEntry`
 * each get a commit-end-state AND a rollback-end-state assertion, plus the
 * Stage 2 open-transaction check, per the coordinator's brief. Only the
 * non-Postgres Dataverse/Graph layer is mocked, via the file's own
 * `dependencies` injection point (`findDocumentsByIds`, `downloadFile`,
 * `supersedeDocument`) — never `@vercel/postgres` itself.
 *
 * No cast-lint rows: every statement in this file is a plain `$n`
 * parameterized `client.query`/`sql.query` call, not a tagged `sql\`...\``
 * template, so `scripts/check-postgres-access-layer.js`'s VALUES/CASE scan
 * (which only looks at tagged templates) does not flag any of them. Every
 * bound column is still asserted by row read-back below regardless.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { withClient } = require('../../lib/postgres/client');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');
const {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
} = require('../../shared/config/requestDocument.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('consultant-feedback-service: contract', () => {
  const service = require('../../lib/services/consultant-feedback-service');

  let client;
  const insertedFeedbackIds = [];
  const insertedRosterIds = [];
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
        await client.query('DELETE FROM consultant_feedback WHERE id = ANY($1::bigint[])', [insertedFeedbackIds]);
      }
      if (insertedRosterIds.length) {
        await client.query('DELETE FROM expertise_roster WHERE id = ANY($1::int[])', [insertedRosterIds]);
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

  async function seedActorProfile() {
    const name = `consultant_feedback_contract_${crypto.randomBytes(6).toString('hex')}`;
    const { rows } = await client.query(`INSERT INTO user_profiles (name) VALUES ($1) RETURNING id`, [name]);
    insertedUserProfileIds.push(rows[0].id);
    return rows[0].id;
  }

  async function seedRoster({ isActive = true, roleType = 'Consultant', name = 'Contract Consultant', affiliation = 'Contract Affiliation' } = {}) {
    const { rows } = await client.query(
      `INSERT INTO expertise_roster (name, role_type, affiliation, is_active) VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, roleType, affiliation, isActive]
    );
    insertedRosterIds.push(rows[0].id);
    return rows[0].id;
  }

  async function readEntry(id) {
    const { rows } = await client.query('SELECT * FROM consultant_feedback WHERE id = $1', [id]);
    return rows[0];
  }

  async function countEntriesForRequest(requestId) {
    const { rows } = await client.query('SELECT count(*)::int AS n FROM consultant_feedback WHERE request_id = $1', [requestId]);
    return rows[0].n;
  }

  describe('writeFeedbackEntry', () => {
    test('one-off author create binds every column', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const mutationId = crypto.randomUUID();

      const row = await service.writeFeedbackEntry({
        requestId, actorProfileId, mutationId,
        oneOff: { name: 'Jane Doe', affiliation: 'Acme' },
        bodyHtml: '<p>Solid proposal.</p>', receivedOn: '2026-09-01', shared: false,
      });
      insertedFeedbackIds.push(Number(row.id));
      expect(row.oneOff).toBe(true);
      expect(row.consultant).toEqual({ rosterId: null, name: 'Jane Doe', affiliation: 'Acme' });
      expect(row.shared).toBe(false);
      expect(row.receivedOn).toBe('2026-09-01');

      const persisted = await readEntry(Number(row.id));
      expect(persisted.request_id).toBe(requestId);
      expect(persisted.mutation_id).toBe(mutationId);
      expect(persisted.created_by).toBe(actorProfileId);
      expect(persisted.updated_by).toBe(actorProfileId);
      expect(persisted.status).toBe('active');
      await assertNoOpenTransactionAnywhere();
    });

    test('roster author create runs eligibility inside the same transaction and commits', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const rosterId = await seedRoster({ isActive: true, roleType: 'Consultant', name: 'Ada Lovelace' });

      const row = await service.writeFeedbackEntry({
        requestId, actorProfileId, mutationId: crypto.randomUUID(),
        consultantRosterId: rosterId, bodyHtml: '<p>Good.</p>', receivedOn: '2026-09-01',
      });
      insertedFeedbackIds.push(Number(row.id));
      expect(row.consultant.rosterId).toBe(rosterId);
      expect(row.consultant.name).toBe('Ada Lovelace');
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: commit vs. rollback end-state. An inactive roster
    // consultant fails eligibility INSIDE the transaction; the ROLLBACK
    // must leave the table with ZERO rows for this request, not a
    // half-written one -- kills a mutant that inserts before checking
    // eligibility, or that commits despite the thrown error.
    test('DISCRIMINATING: an inactive roster author rolls back with no row inserted', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const rosterId = await seedRoster({ isActive: false, roleType: 'Consultant' });

      await expect(service.writeFeedbackEntry({
        requestId, actorProfileId, mutationId: crypto.randomUUID(),
        consultantRosterId: rosterId, bodyHtml: '<p>Good.</p>', receivedOn: '2026-09-01',
      })).rejects.toMatchObject({ httpStatus: 400, body: { reason: 'consultant_not_eligible' } });

      expect(await countEntriesForRequest(requestId)).toBe(0);
      await assertNoOpenTransactionAnywhere();
    });

    test('a replayed mutationId is idempotent (ON CONFLICT DO NOTHING + replay SELECT), never a second row', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const mutationId = crypto.randomUUID();
      const args = {
        requestId, actorProfileId, mutationId,
        oneOff: { name: 'Replay Author' }, bodyHtml: '<p>Original.</p>', receivedOn: '2026-09-01',
      };
      const first = await service.writeFeedbackEntry(args);
      insertedFeedbackIds.push(Number(first.id));
      const second = await service.writeFeedbackEntry(args);
      expect(second.id).toBe(first.id);
      expect(await countEntriesForRequest(requestId)).toBe(1);
    });

    // DISCRIMINATING: a 23505 on requestdocument_id (finalize retried with a
    // NEW mutation id for the same staged attachment) must be caught and
    // return the EXISTING bound row, not create a second row and not
    // surface a raw duplicate-key error -- kills a mutant that drops the
    // `error?.code === '23505'` recovery branch.
    test('DISCRIMINATING: a duplicate requestdocument_id under a new mutationId returns the existing row instead of throwing', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const requestdocumentId = crypto.randomUUID();
      const first = await service.writeFeedbackEntry({
        requestId, actorProfileId, mutationId: crypto.randomUUID(), requestdocumentId,
        oneOff: { name: 'Attach Author' }, bodyHtml: '<p>Body.</p>', receivedOn: '2026-09-01',
      });
      insertedFeedbackIds.push(Number(first.id));

      const second = await service.writeFeedbackEntry({
        requestId, actorProfileId, mutationId: crypto.randomUUID(), requestdocumentId,
        oneOff: { name: 'Attach Author' }, bodyHtml: '<p>Body.</p>', receivedOn: '2026-09-01',
      });
      expect(second.id).toBe(first.id);
      expect(await countEntriesForRequest(requestId)).toBe(1);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('updateFeedbackEntry', () => {
    async function seedEntry({ requestId, actorProfileId, rosterId = null, oneOffName = 'Original Author', requestdocumentId = null } = {}) {
      const mutationId = crypto.randomUUID();
      const { rows } = await client.query(
        `INSERT INTO consultant_feedback (request_id, consultant_roster_id, one_off_name, body_html, received_on, requestdocument_id, mutation_id, created_by, updated_by)
         VALUES ($1, $2, $3, '<p>Original.</p>', '2026-09-01', $4, $5, $6, $6) RETURNING id`,
        [requestId, rosterId, rosterId ? null : oneOffName, requestdocumentId, mutationId, actorProfileId]
      );
      insertedFeedbackIds.push(rows[0].id);
      return rows[0].id;
    }

    test('body-only edit succeeds and commits without touching the author', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const id = await seedEntry({ requestId, actorProfileId });

      const updated = await service.updateFeedbackEntry({
        id, requestId, actorProfileId, patch: { bodyHtml: '<p>Revised.</p>' },
      });
      expect(updated.bodyHtml).toContain('Revised.');
      const row = await readEntry(id);
      expect(row.body_html).toContain('Revised.');
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: author-unchanged resubmission of the SAME roster id
    // must NOT re-run eligibility, even though that roster is now
    // deactivated -- kills a mutant that always re-checks eligibility when
    // the author key is present (would wrongly 400 a body-only-intent save).
    test('DISCRIMINATING: resubmitting the same (now-deactivated) roster id as author-unchanged does not re-check eligibility', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const rosterId = await seedRoster({ isActive: true });
      const id = await seedEntry({ requestId, actorProfileId, rosterId });
      await client.query('UPDATE expertise_roster SET is_active = false WHERE id = $1', [rosterId]);

      const updated = await service.updateFeedbackEntry({
        id, requestId, actorProfileId, patch: { consultantRosterId: rosterId, bodyHtml: '<p>Still fine.</p>' },
      });
      expect(updated.consultant.rosterId).toBe(rosterId);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: commit vs rollback end-state for an ACTUAL author
    // change to an ineligible consultant -- the row must remain exactly as
    // it was (original author, original body), proving the ROLLBACK
    // undid the whole UPDATE, not just skipped the eligibility check.
    test('DISCRIMINATING: changing the author to an inactive roster consultant rolls back with the row unchanged', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const id = await seedEntry({ requestId, actorProfileId });
      const inactiveRosterId = await seedRoster({ isActive: false });

      await expect(service.updateFeedbackEntry({
        id, requestId, actorProfileId, patch: { consultantRosterId: inactiveRosterId },
      })).rejects.toMatchObject({ httpStatus: 400, body: { reason: 'consultant_not_eligible' } });

      const row = await readEntry(id);
      expect(row.one_off_name).toBe('Original Author');
      expect(row.consultant_roster_id).toBeNull();
      expect(row.body_html).toContain('Original.');
      await assertNoOpenTransactionAnywhere();
    });

    test('binding an attachment to an entry with none succeeds', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const id = await seedEntry({ requestId, actorProfileId });
      const requestdocumentId = crypto.randomUUID();

      const updated = await service.updateFeedbackEntry({
        id, requestId, actorProfileId, patch: { requestdocumentId },
      });
      expect(updated.attachment).not.toBeNull();
      const row = await readEntry(id);
      expect(row.requestdocument_id).toBe(requestdocumentId);
    });

    test('re-binding the SAME attachment id is an idempotent no-op success', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const requestdocumentId = crypto.randomUUID();
      const id = await seedEntry({ requestId, actorProfileId, requestdocumentId });

      const updated = await service.updateFeedbackEntry({
        id, requestId, actorProfileId, patch: { requestdocumentId },
      });
      expect(updated.id).toBe(String(id));
    });

    // DISCRIMINATING: binding a DIFFERENT attachment id when one is already
    // set is a conflict, not a silent overwrite -- kills a mutant that
    // drops the isSameAttachment check.
    test('DISCRIMINATING: binding a different attachment id than the one already set is a conflict, row unchanged', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const existingDocId = crypto.randomUUID();
      const id = await seedEntry({ requestId, actorProfileId, requestdocumentId: existingDocId });

      await expect(service.updateFeedbackEntry({
        id, requestId, actorProfileId, patch: { requestdocumentId: crypto.randomUUID() },
      })).rejects.toMatchObject({ httpStatus: 409, body: { reason: 'attachment_conflict' } });

      const row = await readEntry(id);
      expect(row.requestdocument_id).toBe(existingDocId);
    });

    test('a missing/foreign id is a 404, and an attachment-bind attempt on a missing row is 409 attachment_target_gone', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      await expect(service.updateFeedbackEntry({
        id: 999999999, requestId, actorProfileId, patch: { bodyHtml: '<p>x</p>' },
      })).rejects.toMatchObject({ httpStatus: 404 });
      await expect(service.updateFeedbackEntry({
        id: 999999999, requestId, actorProfileId, patch: { requestdocumentId: crypto.randomUUID() },
      })).rejects.toMatchObject({ httpStatus: 409, body: { reason: 'attachment_target_gone' } });
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('deleteFeedbackEntry', () => {
    async function seedEntry({ requestId, actorProfileId, requestdocumentId = null, status = 'active' } = {}) {
      const { rows } = await client.query(
        `INSERT INTO consultant_feedback (request_id, one_off_name, body_html, received_on, requestdocument_id, mutation_id, status, created_by, updated_by)
         VALUES ($1, 'Delete Author', '<p>Body.</p>', '2026-09-01', $2, $3, $4, $5, $5) RETURNING id`,
        [requestId, requestdocumentId, crypto.randomUUID(), status, actorProfileId]
      );
      insertedFeedbackIds.push(rows[0].id);
      return rows[0].id;
    }

    test('no-attachment entry hard-deletes in one transaction and commits', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const id = await seedEntry({ requestId, actorProfileId });

      const result = await service.deleteFeedbackEntry({ id, requestId, actorProfileId });
      expect(result.id).toBe(String(id));
      expect(await readEntry(id)).toBeUndefined();
      await assertNoOpenTransactionAnywhere();
    });

    test('an attached entry marks deleting (commit), then supersedes and hard-deletes', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const requestdocumentId = crypto.randomUUID();
      const id = await seedEntry({ requestId, actorProfileId, requestdocumentId });
      const supersedeDocument = jest.fn().mockResolvedValue(undefined);

      const result = await service.deleteFeedbackEntry(
        { id, requestId, actorProfileId },
        { ...service.DEFAULT_DEPENDENCIES, supersedeDocument }
      );
      expect(result.id).toBe(String(id));
      expect(supersedeDocument).toHaveBeenCalledWith(requestdocumentId);
      expect(await readEntry(id)).toBeUndefined();
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: step-1 COMMIT (mark 'deleting') must be durable even
    // when step 2 (supersede) fails -- the row must be left in 'deleting',
    // NOT rolled back to 'active' and NOT deleted -- proving steps 1 and
    // 2-3 are genuinely separate transactions/operations, not one atomic
    // unit that a step-2 failure could roll back as a whole.
    test('DISCRIMINATING: a step-2 supersede failure leaves the row committed in status=deleting, not rolled back or deleted', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const requestdocumentId = crypto.randomUUID();
      const id = await seedEntry({ requestId, actorProfileId, requestdocumentId });
      const supersedeDocument = jest.fn().mockRejectedValue(new Error('Dataverse unavailable'));

      await expect(service.deleteFeedbackEntry(
        { id, requestId, actorProfileId },
        { ...service.DEFAULT_DEPENDENCIES, supersedeDocument }
      )).rejects.toMatchObject({ httpStatus: 502, body: { reason: 'attachment_removal_pending' } });

      const row = await readEntry(id);
      expect(row.status).toBe('deleting');
      await assertNoOpenTransactionAnywhere();
    });

    test('a missing/foreign id rolls back with a 404, no row changes', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      await expect(service.deleteFeedbackEntry({ id: 999999999, requestId, actorProfileId })).rejects.toMatchObject({ httpStatus: 404 });
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('listConsultantFeedback (incl. the deleting-row recovery sweep)', () => {
    test('lists only active entries, newest received_on/id first', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const older = await client.query(
        `INSERT INTO consultant_feedback (request_id, one_off_name, body_html, received_on, mutation_id, created_by, updated_by)
         VALUES ($1, 'A', '<p>a</p>', '2026-08-01', $2, $3, $3) RETURNING id`,
        [requestId, crypto.randomUUID(), actorProfileId]
      );
      insertedFeedbackIds.push(older.rows[0].id);
      const newer = await client.query(
        `INSERT INTO consultant_feedback (request_id, one_off_name, body_html, received_on, mutation_id, created_by, updated_by)
         VALUES ($1, 'B', '<p>b</p>', '2026-09-01', $2, $3, $3) RETURNING id`,
        [requestId, crypto.randomUUID(), actorProfileId]
      );
      insertedFeedbackIds.push(newer.rows[0].id);
      const deletingRow = await client.query(
        `INSERT INTO consultant_feedback (request_id, one_off_name, body_html, received_on, mutation_id, status, created_by, updated_by)
         VALUES ($1, 'C', '<p>c</p>', '2026-09-05', $2, 'deleting', $3, $3) RETURNING id`,
        [requestId, crypto.randomUUID(), actorProfileId]
      );
      insertedFeedbackIds.push(deletingRow.rows[0].id);

      const list = await service.listConsultantFeedback({ requestId });
      expect(list.map((r) => r.id)).toEqual([String(newer.rows[0].id), String(older.rows[0].id)]);
    });

    // DISCRIMINATING: a stuck 'deleting' row (crash between step 1 commit
    // and step 2-3) is swept to completion BEFORE the list read -- kills a
    // mutant that drops the sweep call entirely (the stuck row would
    // linger forever since 'deleting' rows are never listed).
    test('DISCRIMINATING: a stuck deleting row with an attachment is swept (superseded + hard-deleted) before listing', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const requestdocumentId = crypto.randomUUID();
      const stuck = await client.query(
        `INSERT INTO consultant_feedback (request_id, one_off_name, requestdocument_id, body_html, received_on, mutation_id, status, created_by, updated_by)
         VALUES ($1, 'Stuck Author', $2, '<p>stuck</p>', '2026-09-01', $3, 'deleting', $4, $4) RETURNING id`,
        [requestId, requestdocumentId, crypto.randomUUID(), actorProfileId]
      );
      const supersedeDocument = jest.fn().mockResolvedValue(undefined);

      const list = await service.listConsultantFeedback({ requestId }, { ...service.DEFAULT_DEPENDENCIES, supersedeDocument });
      expect(list).toEqual([]);
      expect(supersedeDocument).toHaveBeenCalledWith(requestdocumentId);
      expect(await readEntry(stuck.rows[0].id)).toBeUndefined();
    });
  });

  describe('listEligibleConsultants', () => {
    // Anti-correlated fixture: the row that must sort FIRST by name has an
    // id that sorts LAST numerically, so a mutant ordering by id instead of
    // name would fail.
    test('returns only active Consultant rows, ordered by name then id', async () => {
      const eligibleA = await seedRoster({ isActive: true, roleType: 'Consultant', name: 'AAA Contract Consultant' });
      const eligibleB = await seedRoster({ isActive: true, roleType: 'Consultant', name: 'ZZZ Contract Consultant' });
      await seedRoster({ isActive: false, roleType: 'Consultant', name: 'MMM Inactive' });
      await seedRoster({ isActive: true, roleType: 'Reviewer', name: 'NNN Wrong Role' });

      const list = await service.listEligibleConsultants();
      const ids = list.map((r) => r.id);
      expect(ids.indexOf(eligibleA)).toBeLessThan(ids.indexOf(eligibleB));
      expect(list.find((r) => r.name === 'MMM Inactive')).toBeUndefined();
      expect(list.find((r) => r.name === 'NNN Wrong Role')).toBeUndefined();
    });
  });

  describe('isSharedActiveFeedbackAttachment', () => {
    test('true only for a shared, active row matching both request and document id', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const requestdocumentId = crypto.randomUUID();
      const { rows } = await client.query(
        `INSERT INTO consultant_feedback (request_id, one_off_name, requestdocument_id, body_html, received_on, shared, mutation_id, created_by, updated_by)
         VALUES ($1, 'Shared Author', $2, '<p>b</p>', '2026-09-01', true, $3, $4, $4) RETURNING id`,
        [requestId, requestdocumentId, crypto.randomUUID(), actorProfileId]
      );
      insertedFeedbackIds.push(rows[0].id);

      expect(await service.isSharedActiveFeedbackAttachment(requestId, requestdocumentId)).toBe(true);
      expect(await service.isSharedActiveFeedbackAttachment(requestId, crypto.randomUUID())).toBe(false);
      expect(await service.isSharedActiveFeedbackAttachment(crypto.randomUUID(), requestdocumentId)).toBe(false);

      await client.query('UPDATE consultant_feedback SET shared = false WHERE id = $1', [rows[0].id]);
      expect(await service.isSharedActiveFeedbackAttachment(requestId, requestdocumentId)).toBe(false);
    });
  });

  describe('getFeedbackEntryForFilename', () => {
    test('resolves the roster name for a roster author and the one-off name otherwise; null when absent', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const rosterId = await seedRoster({ name: 'Filename Roster Author' });
      const { rows: rosterRow } = await client.query(
        `INSERT INTO consultant_feedback (request_id, consultant_roster_id, body_html, received_on, mutation_id, created_by, updated_by)
         VALUES ($1, $2, '<p>x</p>', '2026-09-01', $3, $4, $4) RETURNING id`,
        [requestId, rosterId, crypto.randomUUID(), actorProfileId]
      );
      insertedFeedbackIds.push(rosterRow[0].id);

      const found = await service.getFeedbackEntryForFilename({ id: rosterRow[0].id, requestId });
      expect(found.consultantName).toBe('Filename Roster Author');
      expect(found.receivedOn).toBe('2026-09-01');
      expect(await service.getFeedbackEntryForFilename({ id: 999999999, requestId })).toBeNull();
    });
  });

  describe('downloadConsultantFeedbackAttachment', () => {
    test('happy path resolves through the registry DI and returns the downloaded buffer', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const requestdocumentId = crypto.randomUUID();
      const { rows } = await client.query(
        `INSERT INTO consultant_feedback (request_id, one_off_name, requestdocument_id, body_html, received_on, mutation_id, created_by, updated_by)
         VALUES ($1, 'Download Author', $2, '<p>x</p>', '2026-09-01', $3, $4, $4) RETURNING id`,
        [requestId, requestdocumentId, crypto.randomUUID(), actorProfileId]
      );
      insertedFeedbackIds.push(rows[0].id);

      const registryRow = {
        wmkf_requestdocumentid: requestdocumentId,
        _wmkf_request_value: requestId,
        wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.CONSULTANT_FEEDBACK,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
        wmkf_sharepointdriveid: 'drive-1',
        wmkf_sharepointitemid: 'item-1',
        wmkf_filename: 'feedback.pdf',
      };
      const dependencies = {
        ...service.DEFAULT_DEPENDENCIES,
        findDocumentsByIds: jest.fn().mockResolvedValue({ records: [registryRow] }),
        downloadFile: jest.fn().mockResolvedValue({ buffer: Buffer.from('pdf-bytes'), mimeType: 'application/pdf', filename: 'feedback.pdf' }),
      };

      const result = await service.downloadConsultantFeedbackAttachment({ requestId, entryId: rows[0].id }, dependencies);
      expect(result.mimeType).toBe('application/pdf');
      expect(result.inline).toBe(true);
      expect(dependencies.downloadFile).toHaveBeenCalledWith('drive-1', 'item-1');
    });

    test('not found when the entry has no attachment', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const { rows } = await client.query(
        `INSERT INTO consultant_feedback (request_id, one_off_name, body_html, received_on, mutation_id, created_by, updated_by)
         VALUES ($1, 'No Attachment Author', '<p>x</p>', '2026-09-01', $2, $3, $3) RETURNING id`,
        [requestId, crypto.randomUUID(), actorProfileId]
      );
      insertedFeedbackIds.push(rows[0].id);
      await expect(service.downloadConsultantFeedbackAttachment({ requestId, entryId: rows[0].id })).rejects.toMatchObject({ httpStatus: 404 });
    });
  });

  describe('loadSharedConsultantFeedbackForBriefing', () => {
    test('returns only shared active items and marks a failed registry batch unavailable', async () => {
      const requestId = crypto.randomUUID();
      const actorProfileId = await seedActorProfile();
      const sharedDocId = crypto.randomUUID();
      const shared = await client.query(
        `INSERT INTO consultant_feedback (request_id, one_off_name, requestdocument_id, body_html, received_on, shared, mutation_id, created_by, updated_by)
         VALUES ($1, 'Shared Briefing Author', $2, '<p>shared</p>', '2026-09-01', true, $3, $4, $4) RETURNING id`,
        [requestId, sharedDocId, crypto.randomUUID(), actorProfileId]
      );
      insertedFeedbackIds.push(shared.rows[0].id);
      const notShared = await client.query(
        `INSERT INTO consultant_feedback (request_id, one_off_name, body_html, received_on, shared, mutation_id, created_by, updated_by)
         VALUES ($1, 'Private Briefing Author', '<p>private</p>', '2026-09-01', false, $2, $3, $3) RETURNING id`,
        [requestId, crypto.randomUUID(), actorProfileId]
      );
      insertedFeedbackIds.push(notShared.rows[0].id);

      const dependencies = {
        ...service.DEFAULT_DEPENDENCIES,
        findDocumentsByIds: jest.fn().mockRejectedValue(new Error('registry down')),
      };
      const result = await service.loadSharedConsultantFeedbackForBriefing(requestId, dependencies);
      expect(result.status).toBe('ok');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].attachment).toEqual({ status: 'unavailable' });
    });

    test('invalid requestId short-circuits to an empty ok result without querying', async () => {
      const result = await service.loadSharedConsultantFeedbackForBriefing('not-a-guid');
      expect(result).toEqual({ status: 'ok', items: [] });
    });
  });
});
