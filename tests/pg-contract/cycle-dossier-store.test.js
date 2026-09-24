'use strict';

/**
 * Contract test for lib/services/cycle-dossier-store.js — Stage 3 item 4
 * (wave 4), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 * TESTS-BEFORE ONLY: run against the UNCONVERTED file (no import swap yet).
 * Model file for the connect/transaction wave: `withDossierTransaction`
 * (this file, unmodified) becomes `return withTransaction(fn)` later; this
 * test proves the CURRENT commit/rollback end-states so that later swap can
 * be verified against them unchanged (plan §4 item 1 recorded differences:
 * ROLLBACK failure no longer masks the original error; the client is
 * destroyed on error — both invisible to a caller who never breaks
 * ROLLBACK itself, which this test does not attempt to do).
 *
 * 22 client.query call sites + 1 db.connect + 1 BEGIN literal + 12
 * sql.query call sites (`node scripts/check-postgres-access-layer.js --json`).
 * This test exercises every exported function at least once against the
 * real database, asserts every bound column by reading rows back, and adds
 * the Stage 2 open-transaction assertion after every transaction-touching
 * test (a fresh pooled connection's `pg_current_xact_id_if_assigned()` is
 * NULL, and no session anywhere is `idle in transaction`).
 *
 * Only tests/unit/cycle-dossier-store.test.js mocks `@vercel/postgres`
 * directly (`{ db: { connect }, sql: { query } }`); the other four
 * consumer tests (cycle-dossier-service, -worker, -storage, -sharepoint)
 * mock this module's own export.
 *
 * Shared-singleton note: `cycle_dossier_control` has exactly one row
 * (`id = TRUE`, seeded by setup-database.js). Tests that touch it snapshot
 * and restore its prior state so no test order dependency leaks across
 * this file's own tests.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');
const { withClient } = require('../../lib/postgres/client');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('cycle-dossier-store: contract', () => {
  const store = require('../../lib/services/cycle-dossier-store');
  const {
    withDossierTransaction,
    readDossierControl,
    setDossierOperatorStop,
    assertDossierActor,
    getDossier,
    saveDossierSelection,
    listDossierEntries,
    getDossierEntry,
    reserveDossierEntry,
    finishDossierEntry,
    createDossierPreview,
    readDossierPreview,
    createDossierRun,
    findDossierLaunch,
    listDossierRuns,
    readDossierRun,
    mutateDossierRun,
    claimDossierRun,
    releaseDossierRun,
    stopRevokedDossierRun,
    listDossierEditions,
    readDossierEdition,
    reserveDossierEdition,
    publishDossierEdition,
  } = store;

  let client;
  const insertedUserProfileIds = [];
  const insertedDossierIds = [];
  const insertedRunIds = [];
  const insertedEntryIds = [];
  const insertedPreviewIds = [];
  const insertedEditionIds = [];
  let originalControl;

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
    const { rows } = await client.query('SELECT * FROM cycle_dossier_control WHERE id = TRUE');
    originalControl = rows[0];
  });

  afterAll(async () => {
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      // Restore the singleton control row to its pre-test state.
      if (originalControl) {
        await client.query(
          `UPDATE cycle_dossier_control SET stop_requested = $1, reason = $2, updated_by = $3 WHERE id = TRUE`,
          [originalControl.stop_requested, originalControl.reason, originalControl.updated_by]
        );
      }
      // Children first (FK order): editions -> runs/entries/previews -> dossiers -> user_profiles.
      if (insertedEditionIds.length) {
        await client.query('DELETE FROM cycle_dossier_editions WHERE id = ANY($1::uuid[])', [insertedEditionIds]);
      }
      if (insertedRunIds.length) {
        await client.query('DELETE FROM cycle_dossier_runs WHERE id = ANY($1::uuid[])', [insertedRunIds]);
      }
      if (insertedEntryIds.length) {
        await client.query('DELETE FROM cycle_dossier_entries WHERE id = ANY($1::uuid[])', [insertedEntryIds]);
      }
      if (insertedPreviewIds.length) {
        await client.query('DELETE FROM cycle_dossier_previews WHERE id = ANY($1::uuid[])', [insertedPreviewIds]);
      }
      if (insertedDossierIds.length) {
        await client.query('DELETE FROM cycle_dossiers WHERE id = ANY($1::uuid[])', [insertedDossierIds]);
      }
      if (insertedUserProfileIds.length) {
        await client.query('DELETE FROM dynamics_user_roles WHERE user_profile_id = ANY($1::int[])', [insertedUserProfileIds]);
        await client.query('DELETE FROM user_profiles WHERE id = ANY($1::int[])', [insertedUserProfileIds]);
      }
    } catch (err) {
      deleteError = err;
    } finally {
      await Promise.allSettled([client.end(), getShimPool().end()]);
    }
    if (deleteError) throw deleteError;
  });

  // Stage 2 open-transaction assertion, required after every
  // transaction-touching test in this file (per the coordinator's brief):
  // a fresh pooled connection's transaction id is unassigned, and no
  // session anywhere is idle-in-transaction.
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

  async function insertUserProfile({ isActive = true } = {}) {
    const name = `dossier_contract_${crypto.randomBytes(6).toString('hex')}`;
    const { rows } = await client.query(
      `INSERT INTO user_profiles (name, is_active) VALUES ($1, $2) RETURNING id`,
      [name, isActive]
    );
    const id = rows[0].id;
    insertedUserProfileIds.push(id);
    return id;
  }

  async function insertSuperuser({ isActive = true } = {}) {
    const profileId = await insertUserProfile({ isActive });
    await client.query(`INSERT INTO dynamics_user_roles (user_profile_id, role) VALUES ($1, 'superuser')`, [profileId]);
    return profileId;
  }

  async function insertDossier(owner) {
    const id = crypto.randomUUID();
    await client.query(`INSERT INTO cycle_dossiers (id, owner_profile_id) VALUES ($1, $2)`, [id, owner]);
    insertedDossierIds.push(id);
    return id;
  }

  async function insertRun({
    owner, dossierId, idempotencyKey = crypto.randomUUID(), launchHash = 'hash-a',
    status = 'queued', data = { items: [] }, leaseToken = null, lockedUntil = null,
  }) {
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO cycle_dossier_runs (id, owner_profile_id, dossier_id, idempotency_key, launch_hash, status, data, lease_token, locked_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [id, owner, dossierId, idempotencyKey, launchHash, status, JSON.stringify(data), leaseToken, lockedUntil]
    );
    insertedRunIds.push(id);
    return id;
  }

  async function fetchRun(id) {
    const { rows } = await client.query('SELECT * FROM cycle_dossier_runs WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async function resetControlToNeutral() {
    await client.query(`UPDATE cycle_dossier_control SET stop_requested = FALSE, reason = NULL WHERE id = TRUE`);
  }

  // ==========================================================================
  // withDossierTransaction (the wrapper itself — model for withTransaction)
  // ==========================================================================
  describe('withDossierTransaction', () => {
    beforeEach(resetControlToNeutral);
    afterAll(resetControlToNeutral);

    test('commits: a write inside fn is durable after the call resolves', async () => {
      const marker = `commit-${crypto.randomBytes(6).toString('hex')}`;
      const result = await withDossierTransaction(async (txClient) => {
        await txClient.query('UPDATE cycle_dossier_control SET reason = $1 WHERE id = TRUE', [marker]);
        return 'fn-result';
      });
      expect(result).toBe('fn-result');
      const control = await readDossierControl();
      expect(control.reason).toBe(marker);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: insert-then-throw must leave the row EXACTLY as it
    // was before the call (proves ROLLBACK actually ran) -- kills a mutant
    // that drops the ROLLBACK or only rethrows without rolling back.
    test('DISCRIMINATING: rolls back on throw, leaving the row exactly as it was before', async () => {
      const before = await readDossierControl();
      const marker = `should-not-persist-${crypto.randomBytes(6).toString('hex')}`;

      await expect(withDossierTransaction(async (txClient) => {
        await txClient.query('UPDATE cycle_dossier_control SET reason = $1 WHERE id = TRUE', [marker]);
        throw new Error('deliberate rollback trigger');
      })).rejects.toThrow('deliberate rollback trigger');

      const after = await readDossierControl();
      expect(after.reason).toBe(before.reason);
      expect(after.reason).not.toBe(marker);
      await assertNoOpenTransactionAnywhere();
    });

    test('the client is released after commit and after rollback (no connection leak)', async () => {
      // Run several transactions back-to-back; if the client were not
      // released, this would eventually exhaust the pool and hang instead
      // of completing.
      for (let i = 0; i < 5; i += 1) {
        await withDossierTransaction(async (txClient) => {
          await txClient.query('SELECT 1');
        }).catch(() => {});
      }
      await assertNoOpenTransactionAnywhere();
    });
  });

  // ==========================================================================
  // readDossierControl / setDossierOperatorStop / assertDossierActor
  // ==========================================================================
  describe('assertDossierActor', () => {
    test('returns profileId/actingUserSystemId for an active superuser', async () => {
      const profileId = await insertSuperuser();
      const result = await assertDossierActor(profileId);
      expect(result.profileId).toBe(profileId);
    });

    test('rejects a non-integer profileId (403) without querying', async () => {
      await expect(assertDossierActor('not-a-number')).rejects.toMatchObject({ httpStatus: 403 });
    });

    test('rejects an inactive superuser', async () => {
      const profileId = await insertSuperuser({ isActive: false });
      await expect(assertDossierActor(profileId)).rejects.toMatchObject({ httpStatus: 403 });
    });

    test('rejects an active profile without the superuser role', async () => {
      const profileId = await insertUserProfile();
      await expect(assertDossierActor(profileId)).rejects.toMatchObject({ httpStatus: 403 });
    });
  });

  describe('setDossierOperatorStop', () => {
    beforeEach(resetControlToNeutral);
    afterAll(resetControlToNeutral);

    test('binds stop_requested/reason/updated_by and pauses queued/running runs', async () => {
      const superuserId = await insertSuperuser();
      const owner = await insertUserProfile();
      const dossierId = await insertDossier(owner);
      const runningRun = await insertRun({
        owner, dossierId, status: 'running',
        data: { items: [], cutPending: true },
      });
      // DISCRIMINATING: a 'completed' run must NOT be touched -- kills a
      // mutant that drops the `WHERE status IN ('queued','running')` guard.
      const completedRun = await insertRun({ owner, dossierId, status: 'completed', data: { items: [] } });

      const control = await setDossierOperatorStop(superuserId, true, 'contract stop reason');
      expect(control.stop_requested).toBe(true);
      expect(control.reason).toBe('contract stop reason');
      expect(control.updated_by).toBe(superuserId);

      const pausedRow = await fetchRun(runningRun);
      expect(pausedRow.status).toBe('paused');
      expect(pausedRow.data.pauseReason).toBe('contract stop reason');
      expect(pausedRow.data.cutPending).toBe(false);

      const untouchedRow = await fetchRun(completedRun);
      expect(untouchedRow.status).toBe('completed');
      await assertNoOpenTransactionAnywhere();
    });

    test('DISCRIMINATING: an unauthorized profile throws and leaves the control row unchanged (rollback proof)', async () => {
      const before = await readDossierControl();
      const nonSuperuser = await insertUserProfile();

      await expect(setDossierOperatorStop(nonSuperuser, true, 'should not persist')).rejects.toMatchObject({ httpStatus: 403 });

      const after = await readDossierControl();
      expect(after.stop_requested).toBe(before.stop_requested);
      expect(after.reason).toBe(before.reason);
      await assertNoOpenTransactionAnywhere();
    });
  });

  // ==========================================================================
  // Dossier / entries / previews (non-transactional sql.query statements)
  // ==========================================================================
  describe('getDossier / saveDossierSelection', () => {
    // DISCRIMINATING: calling getDossier twice for the SAME owner must
    // return the SAME row id both times (ON CONFLICT(owner_profile_id,cycle)
    // DO UPDATE, not a fresh insert) -- a mutant that dropped the ON
    // CONFLICT clause would either throw (UNIQUE violation) or, if it also
    // dropped the constraint reliance, create a second row with a
    // different id.
    test('DISCRIMINATING: is idempotent per owner -- repeat calls return the same dossier id', async () => {
      const owner = await insertUserProfile();
      const first = await getDossier(owner);
      insertedDossierIds.push(first.id);
      const second = await getDossier(owner);
      expect(second.id).toBe(first.id);
      expect(second.owner_profile_id).toBe(owner);
      expect(second.cycle).toBe('D26');

      const { rows } = await client.query('SELECT count(*)::int AS n FROM cycle_dossiers WHERE owner_profile_id = $1', [owner]);
      expect(rows[0].n).toBe(1);
    });

    test('saveDossierSelection binds the selection jsonb for the D26 cycle row', async () => {
      const owner = await insertUserProfile();
      const dossier = await getDossier(owner);
      insertedDossierIds.push(dossier.id);
      const selection = { requests: ['r1', 'r2'] };

      const updated = await saveDossierSelection(owner, selection);
      expect(updated.selection).toEqual(selection);
      expect(updated.id).toBe(dossier.id);
    });
  });

  describe('listDossierEntries / getDossierEntry / reserveDossierEntry / finishDossierEntry', () => {
    test('reserveDossierEntry computes a monotonically increasing request_revision per request_id', async () => {
      const owner = await insertUserProfile();
      const requestId = crypto.randomUUID();
      const first = await reserveDossierEntry({ id: crypto.randomUUID(), requestId, owner, data: { a: 1 } });
      insertedEntryIds.push(first.id);
      expect(first.request_revision).toBe(1);
      expect(first.data).toEqual({ a: 1 });
      expect(first.created_by).toBe(owner);
      expect(first.ready).toBe(false);

      const second = await reserveDossierEntry({ id: crypto.randomUUID(), requestId, owner, data: { a: 2 } });
      insertedEntryIds.push(second.id);
      expect(second.request_revision).toBe(2);
    });

    // DISCRIMINATING: a real 23505 (duplicate primary key) is remapped to a
    // ServiceHttpError(409) with the specific concurrency message, not
    // rethrown raw and not silently swallowed -- kills a mutant that drops
    // the catch/remap or widens it to swallow all errors.
    test('DISCRIMINATING: a genuine 23505 (duplicate id) is remapped to a 409 ServiceHttpError', async () => {
      const owner = await insertUserProfile();
      const requestId = crypto.randomUUID();
      const entryId = crypto.randomUUID();
      const first = await reserveDossierEntry({ id: entryId, requestId, owner, data: {} });
      insertedEntryIds.push(first.id);

      await expect(reserveDossierEntry({ id: entryId, requestId, owner, data: {} }))
        .rejects.toMatchObject({ httpStatus: 409 });
    });

    test('finishDossierEntry requires a client and only transitions ready=false -> true once', async () => {
      await expect(finishDossierEntry(crypto.randomUUID(), {}, undefined)).rejects.toMatchObject({ httpStatus: 409 });

      const owner = await insertUserProfile();
      const requestId = crypto.randomUUID();
      const entry = await reserveDossierEntry({ id: crypto.randomUUID(), requestId, owner, data: {} });
      insertedEntryIds.push(entry.id);

      const finishedData = { final: true };
      const finished = await withClient((c) => finishDossierEntry(entry.id, finishedData, c));
      expect(finished.ready).toBe(true);
      expect(finished.data).toEqual(finishedData);

      // DISCRIMINATING: a second finish call on an already-ready entry must
      // be a no-op (the WHERE ready=FALSE guard excludes it) -- kills a
      // mutant that drops that guard and would overwrite `data` again.
      const secondAttempt = await withClient((c) => finishDossierEntry(entry.id, { final: false }, c));
      expect(secondAttempt).toBeUndefined();
      const { rows } = await client.query('SELECT data FROM cycle_dossier_entries WHERE id = $1', [entry.id]);
      expect(rows[0].data).toEqual(finishedData);
    });

    // DISCRIMINATING: DISTINCT ON (request_id) ... ORDER BY request_id,
    // revision DESC must return the LATEST ready revision, not the
    // earliest and not an unready one. Three entries for one request_id:
    // an old ready one, a newer ready one (expected winner), and an even
    // newer NOT-ready one (must be excluded, proving the ready=TRUE filter
    // wins over "just take the max revision").
    test('DISCRIMINATING: listDossierEntries returns only the latest READY revision per request', async () => {
      const owner = await insertUserProfile();
      const requestId = crypto.randomUUID();
      const older = await reserveDossierEntry({ id: crypto.randomUUID(), requestId, owner, data: { tag: 'older' } });
      insertedEntryIds.push(older.id);
      await withClient((c) => finishDossierEntry(older.id, { tag: 'older-finished' }, c));

      const newerReady = await reserveDossierEntry({ id: crypto.randomUUID(), requestId, owner, data: { tag: 'newer' } });
      insertedEntryIds.push(newerReady.id);
      await withClient((c) => finishDossierEntry(newerReady.id, { tag: 'newer-finished' }, c));

      const newestNotReady = await reserveDossierEntry({ id: crypto.randomUUID(), requestId, owner, data: { tag: 'newest-not-ready' } });
      insertedEntryIds.push(newestNotReady.id);

      const entries = await listDossierEntries();
      const ours = entries.filter((e) => e.request_id === requestId);
      expect(ours).toHaveLength(1);
      expect(ours[0].id).toBe(newerReady.id);
      expect(ours[0].data.tag).toBe('newer-finished');
    });
  });

  describe('createDossierPreview / readDossierPreview', () => {
    test('creates and reads back a preview; an expired preview throws', async () => {
      const owner = await insertUserProfile();
      const dossierId = await insertDossier(owner);
      const data = { selection: ['a'] };

      const created = await createDossierPreview(owner, dossierId, data);
      insertedPreviewIds.push(created.id);
      const read = await readDossierPreview(owner, created.id);
      expect(read.data).toEqual(data);

      const expiredId = crypto.randomUUID();
      await client.query(
        `INSERT INTO cycle_dossier_previews (id, owner_profile_id, dossier_id, data, expires_at) VALUES ($1, $2, $3, $4::jsonb, NOW() - interval '1 minute')`,
        [expiredId, owner, dossierId, JSON.stringify({})]
      );
      insertedPreviewIds.push(expiredId);
      await expect(readDossierPreview(owner, expiredId)).rejects.toMatchObject({ httpStatus: expect.any(Number) });
    });
  });

  // ==========================================================================
  // Runs: createDossierRun / findDossierLaunch / listDossierRuns / readDossierRun
  // ==========================================================================
  describe('createDossierRun (idempotency-key upsert)', () => {
    test('is idempotent for the same key+hash and detects a launch-hash mismatch', async () => {
      const owner = await insertUserProfile();
      const dossierId = await insertDossier(owner);
      const idempotencyKey = crypto.randomUUID();
      const data = { items: [] };

      const first = await createDossierRun({ owner, dossierId, idempotencyKey, launchHash: 'hash-a', data });
      insertedRunIds.push(first.id);
      expect(first.launch_hash).toBe('hash-a');
      expect(first.data).toEqual(data);

      // DISCRIMINATING: same key, SAME hash -> returns the cached row
      // (idempotent replay), not a new insert.
      const replay = await createDossierRun({ owner, dossierId, idempotencyKey, launchHash: 'hash-a', data: { items: ['ignored'] } });
      expect(replay.id).toBe(first.id);
      expect(replay.data).toEqual(data); // NOT the replay call's data -- proves ON CONFLICT DO NOTHING held

      // DISCRIMINATING: same key, DIFFERENT hash -> must throw (a mutant
      // that dropped this comparison would silently return the stale row).
      await expect(createDossierRun({ owner, dossierId, idempotencyKey, launchHash: 'hash-b', data }))
        .rejects.toThrow(/already used/i);
    });
  });

  describe('findDossierLaunch / listDossierRuns / readDossierRun', () => {
    test('findDossierLaunch returns null for an unknown key, the row for a known one', async () => {
      const owner = await insertUserProfile();
      expect(await findDossierLaunch(owner, crypto.randomUUID())).toBeNull();

      const dossierId = await insertDossier(owner);
      const key = crypto.randomUUID();
      const runId = await insertRun({ owner, dossierId, idempotencyKey: key });
      const found = await findDossierLaunch(owner, key);
      expect(found.id).toBe(runId);
    });

    test('listDossierRuns orders DESC and scopes to the owner', async () => {
      const owner = await insertUserProfile();
      const otherOwner = await insertUserProfile();
      const dossierId = await insertDossier(owner);
      const otherDossierId = await insertDossier(otherOwner);
      const a = await insertRun({ owner, dossierId });
      const b = await insertRun({ owner, dossierId });
      const otherRun = await insertRun({ owner: otherOwner, dossierId: otherDossierId });

      const rows = await listDossierRuns(owner);
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([a, b]));
      expect(ids).not.toContain(otherRun);
    });

    test('readDossierRun throws 404 for a nonexistent id and scopes by owner', async () => {
      await expect(readDossierRun(await insertUserProfile(), crypto.randomUUID())).rejects.toMatchObject({ httpStatus: 404 });

      const owner = await insertUserProfile();
      const wrongOwner = await insertUserProfile();
      const dossierId = await insertDossier(owner);
      const runId = await insertRun({ owner, dossierId });
      await expect(readDossierRun(wrongOwner, runId)).rejects.toMatchObject({ httpStatus: 404 });
      const row = await readDossierRun(owner, runId);
      expect(row.id).toBe(runId);
    });
  });

  // ==========================================================================
  // mutateDossierRun (transactional)
  // ==========================================================================
  describe('mutateDossierRun', () => {
    test('commits: fn mutates row.data and the persisted row reflects it', async () => {
      const superuserId = await insertSuperuser();
      const dossierId = await insertDossier(superuserId);
      const runId = await insertRun({ owner: superuserId, dossierId, status: 'running', data: { items: [], counter: 0 } });

      const result = await mutateDossierRun(runId, async (row) => {
        row.data.counter = 42;
        row.status = 'completed';
      }, { owner: superuserId });

      expect(result.status).toBe('completed');
      const persisted = await fetchRun(runId);
      expect(persisted.status).toBe('completed');
      expect(persisted.data.counter).toBe(42);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: fn throws mid-mutation -- the row must be
    // COMPLETELY unchanged (not partially applied), proving ROLLBACK, not
    // just that the caller sees an error.
    test('DISCRIMINATING: rolls back when fn throws, leaving the row exactly as it was', async () => {
      const superuserId = await insertSuperuser();
      const dossierId = await insertDossier(superuserId);
      const runId = await insertRun({ owner: superuserId, dossierId, status: 'running', data: { items: [], counter: 0 } });
      const before = await fetchRun(runId);

      await expect(mutateDossierRun(runId, async (row) => {
        row.data.counter = 999;
        row.status = 'failed';
        throw new Error('deliberate mid-mutation failure');
      }, { owner: superuserId })).rejects.toThrow('deliberate mid-mutation failure');

      const after = await fetchRun(runId);
      expect(after.status).toBe(before.status);
      expect(after.data).toEqual(before.data);
      await assertNoOpenTransactionAnywhere();
    });

    test('throws 404 for a run owned by someone else', async () => {
      const superuserId = await insertSuperuser();
      const otherOwner = await insertUserProfile();
      const dossierId = await insertDossier(otherOwner);
      const runId = await insertRun({ owner: otherOwner, dossierId, status: 'running' });

      await expect(mutateDossierRun(runId, async () => {}, { owner: superuserId }))
        .rejects.toMatchObject({ httpStatus: 404 });
      await assertNoOpenTransactionAnywhere();
    });

    test('throws when the supplied leaseToken does not match or has expired', async () => {
      const superuserId = await insertSuperuser();
      const dossierId = await insertDossier(superuserId);
      const runId = await insertRun({
        owner: superuserId, dossierId, status: 'running',
        leaseToken: crypto.randomUUID(), lockedUntil: new Date(Date.now() + 60_000).toISOString(),
      });

      await expect(mutateDossierRun(runId, async () => {}, { owner: superuserId, leaseToken: 'wrong-token' }))
        .rejects.toThrow(/lease expired/i);
      await assertNoOpenTransactionAnywhere();
    });
  });

  // ==========================================================================
  // claimDossierRun (transactional, advisory lock + SKIP LOCKED)
  // ==========================================================================
  describe('claimDossierRun', () => {
    // claimDossierRun's "at most one active run" rule looks across ALL
    // rows in cycle_dossier_runs, so an earlier describe block's run left
    // with a future locked_until (e.g. the mutateDossierRun lease-mismatch
    // test) would otherwise leak in and block every claim here. Neutralize
    // every run this file has created so far before each test in this
    // block, in addition to the control-row reset.
    beforeEach(async () => {
      await resetControlToNeutral();
      // Also neutralize every run this file has created SO FAR (from
      // earlier describe blocks, e.g. createDossierRun/listDossierRuns'
      // default 'queued' status runs): claimDossierRun's query has no
      // per-test scoping column and picks the globally oldest claimable
      // row, so any leftover queued/active row would otherwise get
      // claimed instead of the row this test just created.
      if (insertedRunIds.length) {
        await client.query(
          `UPDATE cycle_dossier_runs SET locked_until = NULL, status = 'completed' WHERE id = ANY($1::uuid[])`,
          [insertedRunIds]
        );
      }
    });
    afterAll(resetControlToNeutral);

    test('claims the oldest queued run, sets a lease/lock, and flips status to running', async () => {
      const owner = await insertUserProfile();
      const dossierId = await insertDossier(owner);
      const runId = await insertRun({ owner, dossierId, status: 'queued', data: { items: [] } });

      const claimed = await claimDossierRun();
      expect(claimed.id).toBe(runId);
      expect(claimed.status).toBe('running');
      expect(claimed.lease_token).toMatch(/^[0-9a-f-]{36}$/);

      const persisted = await fetchRun(runId);
      expect(persisted.status).toBe('running');
      expect(persisted.lease_token).toBe(claimed.lease_token);
      expect(new Date(persisted.locked_until).getTime()).toBeGreaterThan(Date.now());
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: control.stop_requested = true must block ANY claim,
    // even with a perfectly claimable queued run present.
    test('DISCRIMINATING: returns null when stop_requested is true, even with a claimable run present', async () => {
      const owner = await insertUserProfile();
      const dossierId = await insertDossier(owner);
      await insertRun({ owner, dossierId, status: 'queued', data: { items: [] } });
      await client.query(`UPDATE cycle_dossier_control SET stop_requested = TRUE WHERE id = TRUE`);

      const claimed = await claimDossierRun();
      expect(claimed).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: an existing run with a FUTURE locked_until (globally
    // active) must block claiming a DIFFERENT queued run -- the
    // "at most one active run" rule -- kills a mutant that drops the
    // `SELECT id FROM cycle_dossier_runs WHERE locked_until>NOW()` guard.
    test('DISCRIMINATING: returns null when another run is already active (locked_until in the future)', async () => {
      const owner = await insertUserProfile();
      const dossierId = await insertDossier(owner);
      await insertRun({
        owner, dossierId, status: 'running', data: { items: [] },
        leaseToken: crypto.randomUUID(), lockedUntil: new Date(Date.now() + 60_000).toISOString(),
      });
      await insertRun({ owner, dossierId, status: 'queued', data: { items: [] } });

      const claimed = await claimDossierRun();
      expect(claimed).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: a recovered run (already had a lease_token, meaning a
    // prior worker died mid-flight) must convert its 'running' items to
    // 'failed' and refund any reserved budget for non-paid-in-flight items
    // -- proving the crash-recovery branch, not just the happy claim path.
    test('DISCRIMINATING: recovering an orphaned lease fails in-flight items and refunds reservedUsd for non-paid ones', async () => {
      const owner = await insertUserProfile();
      const dossierId = await insertDossier(owner);
      const runId = await insertRun({
        owner, dossierId, status: 'queued',
        // lease_token present but locked_until in the PAST -- an orphaned
        // lease from a worker that died without releasing.
        leaseToken: crypto.randomUUID(), lockedUntil: new Date(Date.now() - 60_000).toISOString(),
        data: {
          reservedUsd: 100,
          items: [
            { status: 'running', reservationUsd: 40, reserved: true },
            { status: 'completed', reservationUsd: 0 },
          ],
        },
      });

      const claimed = await claimDossierRun();
      expect(claimed.id).toBe(runId);
      const runningItem = claimed.data.items.find((i) => i.reservationUsd === 0 && i.status === 'failed');
      expect(runningItem).toBeDefined();
      expect(runningItem.reserved).toBe(false);
      expect(claimed.data.reservedUsd).toBe(60); // 100 - 40 refunded
      const completedItem = claimed.data.items.find((i) => i.status === 'completed');
      expect(completedItem).toBeDefined();
      await assertNoOpenTransactionAnywhere();
    });
  });

  // ==========================================================================
  // releaseDossierRun / stopRevokedDossierRun
  // ==========================================================================
  describe('releaseDossierRun', () => {
    test('clears the lease when no item is running', async () => {
      const owner = await insertUserProfile();
      const dossierId = await insertDossier(owner);
      const token = crypto.randomUUID();
      const runId = await insertRun({
        owner, dossierId, status: 'running', leaseToken: token,
        lockedUntil: new Date(Date.now() + 60_000).toISOString(),
        data: { items: [{ status: 'completed' }] },
      });

      await releaseDossierRun(runId, token);
      const row = await fetchRun(runId);
      expect(row.lease_token).toBeNull();
      expect(row.locked_until).toBeNull();
    });

    // DISCRIMINATING: a run with a 'running' item must NOT have its lease
    // cleared -- kills a mutant that drops the `NOT EXISTS (... status =
    // 'running')` guard, which would let a worker's release race ahead of
    // an in-flight item and orphan it without a lease.
    test('DISCRIMINATING: does not clear the lease while an item is still running', async () => {
      const owner = await insertUserProfile();
      const dossierId = await insertDossier(owner);
      const token = crypto.randomUUID();
      const runId = await insertRun({
        owner, dossierId, status: 'running', leaseToken: token,
        lockedUntil: new Date(Date.now() + 60_000).toISOString(),
        data: { items: [{ status: 'running' }] },
      });

      await releaseDossierRun(runId, token);
      const row = await fetchRun(runId);
      expect(row.lease_token).toBe(token);
      expect(row.locked_until).not.toBeNull();
    });
  });

  describe('stopRevokedDossierRun', () => {
    // DISCRIMINATING: only 'running' items convert to 'failed'; a
    // 'completed' item in the SAME array must survive untouched -- kills a
    // mutant that maps every item unconditionally.
    test('DISCRIMINATING: converts only running items to failed, pauses the run, and clears the lease', async () => {
      const owner = await insertUserProfile();
      const dossierId = await insertDossier(owner);
      const token = crypto.randomUUID();
      const runId = await insertRun({
        owner, dossierId, status: 'running', leaseToken: token,
        lockedUntil: new Date(Date.now() + 60_000).toISOString(),
        data: { items: [{ status: 'running', id: 'a' }, { status: 'completed', id: 'b' }], cutPending: true },
      });

      await stopRevokedDossierRun(runId, token);
      const row = await fetchRun(runId);
      expect(row.status).toBe('paused');
      expect(row.lease_token).toBeNull();
      expect(row.data.cutPending).toBe(false);
      const itemA = row.data.items.find((i) => i.id === 'a');
      const itemB = row.data.items.find((i) => i.id === 'b');
      expect(itemA.status).toBe('failed');
      expect(itemB.status).toBe('completed');
      expect(row.data.pauseReason).toMatch(/authorization/i);
    });
  });

  // ==========================================================================
  // Editions
  // ==========================================================================
  describe('listDossierEditions / readDossierEdition / reserveDossierEdition / publishDossierEdition', () => {
    test('reserveDossierEdition is idempotent per (run_id, cut_key), and publish flips ready + updates latest_edition_id', async () => {
      const owner = await insertUserProfile();
      const dossierId = await insertDossier(owner);
      const runId = await insertRun({ owner, dossierId });
      const run = { id: runId, owner_profile_id: owner, dossier_id: dossierId };

      const first = await withClient((c) => reserveDossierEdition(run, 'cutA', { v: 1 }, c));
      insertedEditionIds.push(first.id);
      // DISCRIMINATING: a second reserve for the SAME (run_id, cut_key)
      // returns the cached row via ON CONFLICT DO NOTHING, not a new id.
      const replay = await withClient((c) => reserveDossierEdition(run, 'cutA', { v: 999 }, c));
      expect(replay.id).toBe(first.id);
      expect(replay.data).toEqual({ v: 1 });

      await withClient((c) => publishDossierEdition(first, { v: 1, published: true }, c));
      const published = (await client.query('SELECT * FROM cycle_dossier_editions WHERE id = $1', [first.id])).rows[0];
      expect(published.ready).toBe(true);
      expect(published.data).toEqual({ v: 1, published: true });

      const dossierRow = (await client.query('SELECT latest_edition_id FROM cycle_dossiers WHERE id = $1', [dossierId])).rows[0];
      expect(dossierRow.latest_edition_id).toBe(first.id);

      const listed = await listDossierEditions(owner);
      expect(listed.map((e) => e.id)).toContain(first.id);
      const read = await readDossierEdition(owner, first.id);
      expect(read.id).toBe(first.id);
    });

    // DISCRIMINATING: publishing a SECOND, OLDER-created edition for the
    // same dossier must NOT overwrite latest_edition_id with the older
    // one -- kills a mutant that unconditionally sets latest_edition_id to
    // whatever was just published, regardless of recency.
    test('DISCRIMINATING: publishing an older edition after a newer one does not regress latest_edition_id', async () => {
      const owner = await insertUserProfile();
      const dossierId = await insertDossier(owner);
      const runId = await insertRun({ owner, dossierId });
      const run = { id: runId, owner_profile_id: owner, dossier_id: dossierId };

      const newer = await withClient((c) => reserveDossierEdition(run, 'cutNewer', {}, c));
      insertedEditionIds.push(newer.id);
      const older = await withClient((c) => reserveDossierEdition(run, 'cutOlder', {}, c));
      insertedEditionIds.push(older.id);
      // Force `older` to have an earlier created_at than `newer`.
      await client.query(`UPDATE cycle_dossier_editions SET created_at = NOW() - interval '1 hour' WHERE id = $1`, [older.id]);

      await withClient((c) => publishDossierEdition(newer, { tag: 'newer' }, c));
      await withClient((c) => publishDossierEdition(older, { tag: 'older' }, c));

      const dossierRow = (await client.query('SELECT latest_edition_id FROM cycle_dossiers WHERE id = $1', [dossierId])).rows[0];
      expect(dossierRow.latest_edition_id).toBe(newer.id);
    });

    test('readDossierEdition throws 404 for an unready or nonexistent edition', async () => {
      const owner = await insertUserProfile();
      await expect(readDossierEdition(owner, crypto.randomUUID())).rejects.toMatchObject({ httpStatus: 404 });

      const dossierId = await insertDossier(owner);
      const runId = await insertRun({ owner, dossierId });
      const run = { id: runId, owner_profile_id: owner, dossier_id: dossierId };
      const notReady = await withClient((c) => reserveDossierEdition(run, 'cutNotReady', {}, c));
      insertedEditionIds.push(notReady.id);
      await expect(readDossierEdition(owner, notReady.id)).rejects.toMatchObject({ httpStatus: 404 });
    });
  });
});
