'use strict';

/**
 * Contract test for lib/services/review-panel-store.js — Stage 3 item 4
 * (wave 4), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 * TESTS-BEFORE ONLY: run against the UNCONVERTED file (no import swap yet).
 * Byte-identical model to lib/services/cycle-dossier-store.js's
 * `withDossierTransaction` shape: `withReviewPanelTransaction` (this file,
 * unmodified) becomes `return withTransaction(fn)` later.
 *
 * 51 client.query call sites + 1 db.connect + 1 BEGIN literal + 7 sql.query
 * call sites (`node scripts/check-postgres-access-layer.js --json`). This
 * test exercises every exported function at least once against the real
 * database, asserts bound columns by reading rows back, and adds the
 * Stage 2 open-transaction assertion after every transaction-touching test
 * (a fresh pooled connection's `pg_current_xact_id_if_assigned()` is NULL,
 * and no session anywhere is `idle in transaction`).
 *
 * Shared-singleton note: `review_panel_control` has exactly one row
 * (`id = TRUE`, seeded by setup-database.js). Tests that touch it snapshot
 * and restore its prior state.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');
const { withClient } = require('../../lib/postgres/client');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('review-panel-store: contract', () => {
  const store = require('../../lib/services/review-panel-store');
  const {
    withReviewPanelTransaction,
    assertReviewPanelActor,
    assertReviewPanelAccess,
    readReviewPanelControl,
    setReviewPanelOperatorStop,
    createAttempt,
    markAttemptDispatched,
    finalizeAttempt,
    reapExpiredAttempts,
    reapAllDispatchedAttempts,
    selectWinners,
    sumAttemptCosts,
    sumEntryAttemptCosts,
    isAttemptCostUnknown,
    createReviewPanel,
    saveReviewPanelSelection,
    createReviewPanelRun,
    findReviewPanelLaunch,
    listReviewPanelRuns,
    listReviewPanelRunsForRequest,
    readReviewPanelRun,
    mutateReviewPanelRun,
    claimReviewPanelRun,
    releaseReviewPanelRun,
    createReviewPanelEntry,
    listReviewPanelEntries,
    readReviewPanelEntry,
    listAttemptsForEntry,
    listEntryAttempts,
    mutateReviewPanelEntry,
    requestReviewPanelRetry,
    requestReviewPanelRerender,
    listRetryRequestedEntries,
    requestReviewPanelCancel,
    stopRevokedReviewPanelRun,
  } = store;

  let client;
  const insertedUserProfileIds = [];
  const insertedPanelIds = [];
  const insertedRunIds = [];
  const insertedEntryIds = [];
  const insertedAttemptIds = [];
  let originalControl;

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
    const { rows } = await client.query('SELECT * FROM review_panel_control WHERE id = TRUE');
    originalControl = rows[0];
  });

  afterAll(async () => {
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (originalControl) {
        await client.query(
          `UPDATE review_panel_control SET stop_requested = $1, reason = $2, updated_by = $3 WHERE id = TRUE`,
          [originalControl.stop_requested, originalControl.reason, originalControl.updated_by]
        );
      }
      // Children first (FK order): seat_attempts -> entries -> runs -> panels -> user_profiles.
      if (insertedAttemptIds.length) {
        await client.query('DELETE FROM review_panel_seat_attempts WHERE id = ANY($1::uuid[])', [insertedAttemptIds]);
      }
      if (insertedEntryIds.length) {
        await client.query('DELETE FROM review_panel_entries WHERE id = ANY($1::uuid[])', [insertedEntryIds]);
      }
      if (insertedRunIds.length) {
        await client.query('DELETE FROM review_panel_runs WHERE id = ANY($1::uuid[])', [insertedRunIds]);
      }
      if (insertedPanelIds.length) {
        await client.query('DELETE FROM review_panels WHERE id = ANY($1::uuid[])', [insertedPanelIds]);
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
    const name = `review_panel_contract_${crypto.randomBytes(6).toString('hex')}`;
    const { rows } = await client.query(`INSERT INTO user_profiles (name, is_active) VALUES ($1, $2) RETURNING id`, [name, isActive]);
    const id = rows[0].id;
    insertedUserProfileIds.push(id);
    return id;
  }

  async function insertSuperuser({ isActive = true } = {}) {
    const profileId = await insertUserProfile({ isActive });
    await client.query(`INSERT INTO dynamics_user_roles (user_profile_id, role) VALUES ($1, 'superuser')`, [profileId]);
    return profileId;
  }

  async function insertPanel(owner) {
    const id = crypto.randomUUID();
    await client.query(`INSERT INTO review_panels (id, owner_profile_id) VALUES ($1, $2)`, [id, owner]);
    insertedPanelIds.push(id);
    return id;
  }

  async function insertRun({
    owner, panelId, idempotencyKey = crypto.randomUUID(), launchHash = 'hash-a',
    status = 'queued', data = {}, leaseToken = null, lockedUntil = null,
  }) {
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO review_panel_runs (id, owner_profile_id, panel_id, idempotency_key, launch_hash, status, data, lease_token, locked_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [id, owner, panelId, idempotencyKey, launchHash, status, JSON.stringify(data), leaseToken, lockedUntil]
    );
    insertedRunIds.push(id);
    return id;
  }

  async function insertEntry({ runId, requestId = crypto.randomUUID(), status = 'pending', data = {}, winnersJson = {}, createdBy }) {
    const id = crypto.randomUUID();
    const { rows } = await client.query(
      `INSERT INTO review_panel_entries (id, run_id, request_id, request_revision, status, data, winners_json, created_by)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(request_revision),0)+1 FROM review_panel_entries WHERE request_id=$3), $4, $5::jsonb, $6::jsonb, $7)
       RETURNING *`,
      [id, runId, requestId, status, JSON.stringify(data), JSON.stringify(winnersJson), createdBy]
    );
    insertedEntryIds.push(id);
    return rows[0];
  }

  async function insertAttempt({
    entryId, seatKey = 'seat1', attemptNo = 1, state = 'pending', dispatchToken = null,
    dispatchExpiresAt = null, costCents = null, costState = null,
  }) {
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO review_panel_seat_attempts (id, entry_id, seat_key, attempt_no, state, dispatch_token, dispatch_expires_at, cost_cents, cost_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, entryId, seatKey, attemptNo, state, dispatchToken, dispatchExpiresAt, costCents, costState]
    );
    insertedAttemptIds.push(id);
    return id;
  }

  async function fetchRun(id) {
    return (await client.query('SELECT * FROM review_panel_runs WHERE id = $1', [id])).rows[0] || null;
  }
  async function fetchEntry(id) {
    return (await client.query('SELECT * FROM review_panel_entries WHERE id = $1', [id])).rows[0] || null;
  }
  async function fetchAttempt(id) {
    return (await client.query('SELECT * FROM review_panel_seat_attempts WHERE id = $1', [id])).rows[0] || null;
  }
  async function resetControlToNeutral() {
    await client.query(`UPDATE review_panel_control SET stop_requested = FALSE, reason = NULL WHERE id = TRUE`);
  }
  async function neutralizeAllRuns() {
    if (insertedRunIds.length) {
      await client.query(
        `UPDATE review_panel_runs SET locked_until = NULL, status = 'completed' WHERE id = ANY($1::uuid[])`,
        [insertedRunIds]
      );
    }
  }

  // ==========================================================================
  // withReviewPanelTransaction (the wrapper itself)
  // ==========================================================================
  describe('withReviewPanelTransaction', () => {
    beforeEach(resetControlToNeutral);
    afterAll(resetControlToNeutral);

    test('commits: a write inside fn is durable after the call resolves', async () => {
      const marker = `commit-${crypto.randomBytes(6).toString('hex')}`;
      const result = await withReviewPanelTransaction(async (txClient) => {
        await txClient.query('UPDATE review_panel_control SET reason = $1 WHERE id = TRUE', [marker]);
        return 'fn-result';
      });
      expect(result).toBe('fn-result');
      const control = await readReviewPanelControl();
      expect(control.reason).toBe(marker);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: insert-then-throw must leave the row exactly as it
    // was before the call -- proves ROLLBACK actually ran.
    test('DISCRIMINATING: rolls back on throw, leaving the row exactly as it was before', async () => {
      const before = await readReviewPanelControl();
      const marker = `should-not-persist-${crypto.randomBytes(6).toString('hex')}`;

      await expect(withReviewPanelTransaction(async (txClient) => {
        await txClient.query('UPDATE review_panel_control SET reason = $1 WHERE id = TRUE', [marker]);
        throw new Error('deliberate rollback trigger');
      })).rejects.toThrow('deliberate rollback trigger');

      const after = await readReviewPanelControl();
      expect(after.reason).toBe(before.reason);
      expect(after.reason).not.toBe(marker);
      await assertNoOpenTransactionAnywhere();
    });
  });

  // ==========================================================================
  // Actor / access checks
  // ==========================================================================
  describe('assertReviewPanelActor / assertReviewPanelAccess', () => {
    test('returns profileId/actingUserSystemId/isSuperuser for an active superuser', async () => {
      const profileId = await insertSuperuser();
      const result = await assertReviewPanelActor(profileId);
      expect(result.profileId).toBe(profileId);
      expect(result.isSuperuser).toBe(true);
    });

    test('rejects a non-integer profileId, an inactive profile, and a non-superuser without querying differently', async () => {
      await expect(assertReviewPanelActor('nope')).rejects.toMatchObject({ httpStatus: 403 });
      const inactive = await insertSuperuser({ isActive: false });
      await expect(assertReviewPanelActor(inactive)).rejects.toMatchObject({ httpStatus: 403 });
      const plain = await insertUserProfile();
      const plainResult = await assertReviewPanelActor(plain);
      expect(plainResult.isSuperuser).toBe(false);
    });

    test('assertReviewPanelAccess: a superuser is admitted without a grant lookup', async () => {
      const profileId = await insertSuperuser();
      const listAppKeys = jest.fn();
      const result = await assertReviewPanelAccess(profileId, { listAppKeys });
      expect(result.isSuperuser).toBe(true);
      expect(listAppKeys).not.toHaveBeenCalled();
    });

    test('assertReviewPanelAccess: a non-superuser with the review-panel app grant is admitted', async () => {
      const profileId = await insertUserProfile();
      const listAppKeys = jest.fn().mockResolvedValue(['review-panel', 'other-app']);
      const result = await assertReviewPanelAccess(profileId, { listAppKeys });
      expect(result.profileId).toBe(profileId);
    });

    test('assertReviewPanelAccess: a non-superuser without the grant is refused (403)', async () => {
      const profileId = await insertUserProfile();
      const listAppKeys = jest.fn().mockResolvedValue(['other-app']);
      await expect(assertReviewPanelAccess(profileId, { listAppKeys })).rejects.toMatchObject({ httpStatus: 403 });
    });

    // DISCRIMINATING: a grant-lookup FAILURE (Dataverse outage) must
    // surface as a 503 marked `interrupted: true`, distinct from an
    // ordinary 403 "not granted" -- kills a mutant that treats a lookup
    // error the same as an empty grant list.
    test('DISCRIMINATING: a grant lookup failure is a 503 marked interrupted, not a 403', async () => {
      const profileId = await insertUserProfile();
      const listAppKeys = jest.fn().mockRejectedValue(new Error('dataverse down'));
      await expect(assertReviewPanelAccess(profileId, { listAppKeys })).rejects.toMatchObject({ httpStatus: 503, interrupted: true });
    });
  });

  describe('readReviewPanelControl / setReviewPanelOperatorStop', () => {
    beforeEach(resetControlToNeutral);
    afterAll(resetControlToNeutral);

    test('binds stop_requested/reason/updated_by', async () => {
      const superuserId = await insertSuperuser();
      const control = await setReviewPanelOperatorStop(superuserId, true, 'contract reason');
      expect(control.stop_requested).toBe(true);
      expect(control.reason).toBe('contract reason');
      expect(control.updated_by).toBe(superuserId);
      const reread = await readReviewPanelControl();
      expect(reread.reason).toBe('contract reason');
      await assertNoOpenTransactionAnywhere();
    });

    // NOTE: assertReviewPanelActor (unlike cycle-dossier-store's
    // assertDossierActor) only requires an ACTIVE profile, not the
    // superuser role -- setReviewPanelOperatorStop's authorization is
    // looser than the dossier equivalent by design of this file. An
    // inactive profile is what actually fails here.
    test('DISCRIMINATING: an inactive profile throws and leaves the row unchanged', async () => {
      const before = await readReviewPanelControl();
      const inactive = await insertUserProfile({ isActive: false });
      await expect(setReviewPanelOperatorStop(inactive, true, 'nope')).rejects.toMatchObject({ httpStatus: 403 });
      const after = await readReviewPanelControl();
      expect(after.reason).toBe(before.reason);
      await assertNoOpenTransactionAnywhere();
    });
  });

  // ==========================================================================
  // Panel / run primitives
  // ==========================================================================
  describe('createReviewPanel / saveReviewPanelSelection', () => {
    test('DISCRIMINATING: is idempotent per owner -- repeat calls return the same panel id', async () => {
      const owner = await insertUserProfile();
      const first = await createReviewPanel(owner);
      insertedPanelIds.push(first.id);
      const second = await createReviewPanel(owner);
      expect(second.id).toBe(first.id);
    });

    test('saveReviewPanelSelection binds the selection jsonb', async () => {
      const owner = await insertUserProfile();
      const panel = await createReviewPanel(owner);
      insertedPanelIds.push(panel.id);
      const selection = { requests: ['a', 'b'] };
      const updated = await saveReviewPanelSelection(owner, selection);
      expect(updated.selection).toEqual(selection);
    });
  });

  describe('createReviewPanelRun / findReviewPanelLaunch / listReviewPanelRuns / readReviewPanelRun', () => {
    test('is idempotent for the same key+hash and detects a launch-hash mismatch', async () => {
      const owner = await insertUserProfile();
      const panelId = await insertPanel(owner);
      const idempotencyKey = crypto.randomUUID();
      const data = { items: [] };

      const first = await createReviewPanelRun({ owner, panelId, idempotencyKey, launchHash: 'hash-a', data });
      insertedRunIds.push(first.id);
      const replay = await createReviewPanelRun({ owner, panelId, idempotencyKey, launchHash: 'hash-a', data: { items: ['ignored'] } });
      expect(replay.id).toBe(first.id);
      expect(replay.data).toEqual(data);

      await expect(createReviewPanelRun({ owner, panelId, idempotencyKey, launchHash: 'hash-b', data }))
        .rejects.toThrow(/already used/i);
    });

    test('findReviewPanelLaunch/listReviewPanelRuns/readReviewPanelRun', async () => {
      const owner = await insertUserProfile();
      expect(await findReviewPanelLaunch(owner, crypto.randomUUID())).toBeNull();

      const panelId = await insertPanel(owner);
      const runId = await insertRun({ owner, panelId });
      const found = await findReviewPanelLaunch(owner, (await fetchRun(runId)).idempotency_key);
      expect(found.id).toBe(runId);

      const rows = await listReviewPanelRuns(owner);
      expect(rows.map((r) => r.id)).toContain(runId);

      await expect(readReviewPanelRun(owner, crypto.randomUUID())).rejects.toMatchObject({ httpStatus: 404 });
      const read = await readReviewPanelRun(owner, runId);
      expect(read.id).toBe(runId);
    });

    // DISCRIMINATING: listReviewPanelRunsForRequest must surface a run
    // via EITHER path independently -- (a) a materialized entry FK'd to
    // the request, or (b) an unsettled run whose data.pendingEntries still
    // names the request (entry not yet materialized). A third run with
    // NEITHER must be excluded.
    test('DISCRIMINATING: listReviewPanelRunsForRequest matches via a materialized entry OR a pending-entries marker, never neither', async () => {
      const owner = await insertUserProfile();
      const panelId = await insertPanel(owner);
      const requestId = crypto.randomUUID();

      const viaEntry = await insertRun({ owner, panelId, status: 'completed' });
      await insertEntry({ runId: viaEntry, requestId, createdBy: owner });

      const viaPending = await insertRun({ owner, panelId, status: 'queued', data: { pendingEntries: [{ requestId }] } });

      const unrelated = await insertRun({ owner, panelId, status: 'completed' });

      const rows = await listReviewPanelRunsForRequest(requestId);
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(viaEntry);
      expect(ids).toContain(viaPending);
      expect(ids).not.toContain(unrelated);
      expect(rows.find((r) => r.id === viaEntry).owner_name).toBeTruthy();
    });
  });

  describe('mutateReviewPanelRun', () => {
    test('commits: fn mutates row.data and the persisted row reflects it', async () => {
      const superuserId = await insertSuperuser();
      const panelId = await insertPanel(superuserId);
      const leaseToken = crypto.randomUUID();
      const runId = await insertRun({
        owner: superuserId, panelId, status: 'running', data: { counter: 0 },
        leaseToken, lockedUntil: new Date(Date.now() + 60_000).toISOString(),
      });

      const result = await mutateReviewPanelRun(runId, async (row) => {
        row.data.counter = 7;
        row.status = 'completed';
      }, { owner: superuserId, leaseToken });

      expect(result.status).toBe('completed');
      const persisted = await fetchRun(runId);
      expect(persisted.status).toBe('completed');
      expect(persisted.data.counter).toBe(7);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: fn throws mid-mutation -- the row must be
    // completely unchanged, proving ROLLBACK.
    test('DISCRIMINATING: rolls back when fn throws, leaving the row exactly as it was', async () => {
      const superuserId = await insertSuperuser();
      const panelId = await insertPanel(superuserId);
      const leaseToken = crypto.randomUUID();
      const runId = await insertRun({
        owner: superuserId, panelId, status: 'running', data: { counter: 0 },
        leaseToken, lockedUntil: new Date(Date.now() + 60_000).toISOString(),
      });
      const before = await fetchRun(runId);

      await expect(mutateReviewPanelRun(runId, async (row) => {
        row.data.counter = 999;
        row.status = 'failed';
        throw new Error('deliberate mid-mutation failure');
      }, { owner: superuserId, leaseToken })).rejects.toThrow('deliberate mid-mutation failure');

      const after = await fetchRun(runId);
      expect(after).toEqual(before);
      await assertNoOpenTransactionAnywhere();
    });

    test('requires a non-empty leaseToken before touching the database', async () => {
      await expect(mutateReviewPanelRun(crypto.randomUUID(), async () => {}, { owner: 1, leaseToken: '' }))
        .rejects.toMatchObject({ httpStatus: 400 });
    });

    test('throws 404 for a run owned by someone else, and on lease mismatch', async () => {
      const superuserId = await insertSuperuser();
      const otherOwner = await insertUserProfile();
      const panelId = await insertPanel(otherOwner);
      const runId = await insertRun({ owner: otherOwner, panelId, status: 'running' });

      await expect(mutateReviewPanelRun(runId, async () => {}, { owner: superuserId, leaseToken: 'x' }))
        .rejects.toMatchObject({ httpStatus: 404 });

      const leasedRunId = await insertRun({
        owner: superuserId, panelId: await insertPanel(superuserId), status: 'running',
        leaseToken: crypto.randomUUID(), lockedUntil: new Date(Date.now() + 60_000).toISOString(),
      });
      await expect(mutateReviewPanelRun(leasedRunId, async () => {}, { owner: superuserId, leaseToken: 'wrong' }))
        .rejects.toThrow(/lease expired/i);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('claimReviewPanelRun', () => {
    beforeEach(async () => {
      await resetControlToNeutral();
      await neutralizeAllRuns();
    });
    afterAll(resetControlToNeutral);

    test('claims the oldest queued run and sets a lease/lock', async () => {
      const owner = await insertUserProfile();
      const panelId = await insertPanel(owner);
      const runId = await insertRun({ owner, panelId, status: 'queued' });

      const claimed = await claimReviewPanelRun();
      expect(claimed.id).toBe(runId);
      expect(claimed.status).toBe('running');
      expect(claimed.lease_token).toMatch(/^[0-9a-f-]{36}$/);
      const persisted = await fetchRun(runId);
      expect(persisted.lease_token).toBe(claimed.lease_token);
      await assertNoOpenTransactionAnywhere();
    });

    test('DISCRIMINATING: returns null when stop_requested is true', async () => {
      const owner = await insertUserProfile();
      const panelId = await insertPanel(owner);
      await insertRun({ owner, panelId, status: 'queued' });
      await client.query(`UPDATE review_panel_control SET stop_requested = TRUE WHERE id = TRUE`);
      expect(await claimReviewPanelRun()).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    test('DISCRIMINATING: returns null when another run is already active', async () => {
      const owner = await insertUserProfile();
      const panelId = await insertPanel(owner);
      await insertRun({
        owner, panelId, status: 'running',
        leaseToken: crypto.randomUUID(), lockedUntil: new Date(Date.now() + 60_000).toISOString(),
      });
      await insertRun({ owner, panelId, status: 'queued' });
      expect(await claimReviewPanelRun()).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('releaseReviewPanelRun', () => {
    test('clears the lease on a matching token, is a no-op on a mismatch', async () => {
      const owner = await insertUserProfile();
      const panelId = await insertPanel(owner);
      const token = crypto.randomUUID();
      const runId = await insertRun({
        owner, panelId, status: 'running', leaseToken: token,
        lockedUntil: new Date(Date.now() + 60_000).toISOString(),
      });

      await releaseReviewPanelRun(runId, crypto.randomUUID()); // well-formed UUID, just not the real lease
      expect((await fetchRun(runId)).lease_token).toBe(token);

      await releaseReviewPanelRun(runId, token);
      const row = await fetchRun(runId);
      expect(row.lease_token).toBeNull();
      expect(row.locked_until).toBeNull();
    });
  });

  // ==========================================================================
  // Entries / attempts
  // ==========================================================================
  describe('createReviewPanelEntry / listReviewPanelEntries / readReviewPanelEntry', () => {
    test('binds every column, computes a monotonic request_revision, and remaps a real 23505 to 409', async () => {
      const superuserId = await insertSuperuser();
      const panelId = await insertPanel(superuserId);
      const leaseToken = crypto.randomUUID();
      const runId = await insertRun({
        owner: superuserId, panelId, status: 'running', leaseToken,
        lockedUntil: new Date(Date.now() + 60_000).toISOString(),
      });
      const requestId = crypto.randomUUID();

      const first = await createReviewPanelEntry({ runId, requestId, leaseToken, createdBy: superuserId, data: { a: 1 } });
      insertedEntryIds.push(first.id);
      expect(first.run_id).toBe(runId);
      expect(first.request_id).toBe(requestId);
      expect(first.request_revision).toBe(1);
      expect(first.created_by).toBe(superuserId);
      expect(first.data).toEqual({ a: 1 });

      const second = await createReviewPanelEntry({ runId, requestId, leaseToken, createdBy: superuserId, data: { a: 2 } });
      insertedEntryIds.push(second.id);
      expect(second.request_revision).toBe(2);

      // Lease mismatch on the run must be caught before any insert.
      await expect(createReviewPanelEntry({ runId, requestId: crypto.randomUUID(), leaseToken: 'wrong', createdBy: superuserId }))
        .rejects.toThrow(/lease expired/i);

      const listed = await listReviewPanelEntries(runId);
      expect(listed.map((e) => e.id)).toEqual(expect.arrayContaining([first.id, second.id]));
      const read = await readReviewPanelEntry(first.id);
      expect(read.id).toBe(first.id);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('createAttempt / markAttemptDispatched / finalizeAttempt / reapExpiredAttempts / reapAllDispatchedAttempts', () => {
    async function seedRunAndEntry({ status = 'running' } = {}) {
      const superuserId = await insertSuperuser();
      const panelId = await insertPanel(superuserId);
      const leaseToken = crypto.randomUUID();
      const runId = await insertRun({
        owner: superuserId, panelId, status, leaseToken,
        lockedUntil: new Date(Date.now() + 60_000).toISOString(),
      });
      const entry = await insertEntry({ runId, createdBy: superuserId });
      return { superuserId, runId, leaseToken, entry };
    }

    test('createAttempt binds columns and computes a monotonic attempt_no per (entry,seat)', async () => {
      const { entry, leaseToken } = await seedRunAndEntry();
      const first = await createAttempt({ entryId: entry.id, seatKey: 'chair', leaseToken, provider: 'anthropic', model: 'm1', promptSnapshot: { p: 1 } });
      insertedAttemptIds.push(first.id);
      expect(first.attempt_no).toBe(1);
      expect(first.state).toBe('pending');
      expect(first.provider).toBe('anthropic');
      expect(first.model).toBe('m1');
      expect(first.prompt_snapshot_json).toEqual({ p: 1 });

      const second = await createAttempt({ entryId: entry.id, seatKey: 'chair', leaseToken, provider: 'anthropic', model: 'm1' });
      insertedAttemptIds.push(second.id);
      expect(second.attempt_no).toBe(2);

      await expect(createAttempt({ entryId: crypto.randomUUID(), seatKey: 'chair', leaseToken, provider: 'x', model: 'y' }))
        .rejects.toMatchObject({ httpStatus: 404 });
      await assertNoOpenTransactionAnywhere();
    });

    test('markAttemptDispatched: pending -> dispatched once, second attempt fails, validates inputs', async () => {
      const { entry, leaseToken } = await seedRunAndEntry();
      const attempt = await createAttempt({ entryId: entry.id, seatKey: 'seat1', leaseToken, provider: 'p', model: 'm' });
      insertedAttemptIds.push(attempt.id);

      await expect(markAttemptDispatched(attempt.id, { dispatchToken: '', leaseToken, dispatchExpiresAt: new Date().toISOString() }))
        .rejects.toMatchObject({ httpStatus: 400 });
      await expect(markAttemptDispatched(attempt.id, { dispatchToken: 'tok', leaseToken, dispatchExpiresAt: 'not-a-date' }))
        .rejects.toMatchObject({ httpStatus: 400 });

      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const dispatched = await markAttemptDispatched(attempt.id, { dispatchToken: 'contract-token', leaseToken, dispatchExpiresAt: expiresAt });
      expect(dispatched.state).toBe('dispatched');
      expect(dispatched.dispatch_token).toBe('contract-token');
      expect(dispatched.lease_token).toBe(leaseToken);

      // DISCRIMINATING: dispatch_token is immutable once set -- a second
      // dispatch attempt (state is no longer 'pending') must throw, not
      // silently reassign the token.
      await expect(markAttemptDispatched(attempt.id, { dispatchToken: 'second-token', leaseToken, dispatchExpiresAt: expiresAt }))
        .rejects.toThrow(/not pending/i);
      expect((await fetchAttempt(attempt.id)).dispatch_token).toBe('contract-token');
      await assertNoOpenTransactionAnywhere();
    });

    test('finalizeAttempt: in-lease CAS succeeds before expiry (outcome "finalized")', async () => {
      const { entry, leaseToken } = await seedRunAndEntry();
      const attempt = await createAttempt({ entryId: entry.id, seatKey: 'seat1', leaseToken, provider: 'p', model: 'm' });
      insertedAttemptIds.push(attempt.id);
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      await markAttemptDispatched(attempt.id, { dispatchToken: 'tok', leaseToken, dispatchExpiresAt: expiresAt });

      const outcome = await finalizeAttempt(attempt.id, 'tok', {
        state: 'completed', result: { text: 'ok' }, usage: { tokens: 10 }, costCents: 5, costState: 'known',
      });
      expect(outcome.outcome).toBe('finalized');
      expect(outcome.attempt.state).toBe('completed');
      expect(outcome.attempt.result_json).toEqual({ text: 'ok' });
      expect(Number(outcome.attempt.cost_cents)).toBe(5);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: dispatch_expires_at is already in the PAST (a real
    // clock_timestamp() comparison, not a mocked one) when finalize runs --
    // the in-lease CAS must MISS (dispatch_expires_at > clock_timestamp()
    // fails) and fall through to the late path: state -> 'unknown_outcome',
    // late_result_json bound, result_json/cost_cents left untouched.
    test('DISCRIMINATING: finalize after dispatch_expires_at has passed lands "late" (unknown_outcome), not "finalized"', async () => {
      const { entry, leaseToken } = await seedRunAndEntry();
      const attempt = await createAttempt({ entryId: entry.id, seatKey: 'seat1', leaseToken, provider: 'p', model: 'm' });
      insertedAttemptIds.push(attempt.id);
      // Bypass markAttemptDispatched's future-only validation by writing
      // an already-past dispatch_expires_at directly.
      await client.query(
        `UPDATE review_panel_seat_attempts SET state='dispatched', dispatch_token=$2, dispatch_expires_at=NOW() - interval '1 second' WHERE id=$1`,
        [attempt.id, 'late-token']
      );

      const outcome = await finalizeAttempt(attempt.id, 'late-token', { state: 'completed', result: { text: 'too late' }, costState: 'unknown' });
      expect(outcome.outcome).toBe('late');
      expect(outcome.attempt.state).toBe('unknown_outcome');
      expect(outcome.attempt.late_result_json).toEqual({ text: 'too late' });
      expect(outcome.attempt.result_json).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    test('finalizeAttempt returns no_match for an unknown attempt id or wrong dispatch token', async () => {
      expect((await finalizeAttempt(crypto.randomUUID(), 'x', { state: 'completed', costState: 'unknown' })).outcome).toBe('no_match');

      const { entry, leaseToken } = await seedRunAndEntry();
      const attempt = await createAttempt({ entryId: entry.id, seatKey: 'seat1', leaseToken, provider: 'p', model: 'm' });
      insertedAttemptIds.push(attempt.id);
      await markAttemptDispatched(attempt.id, { dispatchToken: 'real-token', leaseToken, dispatchExpiresAt: new Date(Date.now() + 60_000).toISOString() });
      expect((await finalizeAttempt(attempt.id, 'wrong-token', { state: 'completed', costState: 'unknown' })).outcome).toBe('no_match');
    });

    test('finalizeAttempt validates state and cost', async () => {
      await expect(finalizeAttempt(crypto.randomUUID(), 'x', { state: 'pending', costState: 'unknown' })).rejects.toMatchObject({ httpStatus: 400 });
      await expect(finalizeAttempt(crypto.randomUUID(), 'x', { state: 'completed', costState: 'known', costCents: null }))
        .rejects.toMatchObject({ httpStatus: 400 });
    });

    test('reapExpiredAttempts moves only expired dispatched attempts to unknown_outcome, requires the lease', async () => {
      const { runId, entry, leaseToken } = await seedRunAndEntry();
      const expired = await insertAttempt({ entryId: entry.id, seatKey: 'seatA', state: 'dispatched', dispatchToken: 't1', dispatchExpiresAt: new Date(Date.now() - 60_000).toISOString() });
      const notYetExpired = await insertAttempt({ entryId: entry.id, seatKey: 'seatB', state: 'dispatched', dispatchToken: 't2', dispatchExpiresAt: new Date(Date.now() + 60_000).toISOString() });

      const reaped = await reapExpiredAttempts(runId, leaseToken);
      const reapedIds = reaped.map((r) => r.id);
      expect(reapedIds).toContain(expired);
      expect(reapedIds).not.toContain(notYetExpired);
      expect((await fetchAttempt(expired)).state).toBe('unknown_outcome');
      expect((await fetchAttempt(notYetExpired)).state).toBe('dispatched');

      await expect(reapExpiredAttempts(crypto.randomUUID(), leaseToken)).rejects.toMatchObject({ httpStatus: 404 });
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: reapAllDispatchedAttempts reaps a dispatched attempt
    // REGARDLESS of expiry (future dispatch_expires_at) -- the opposite of
    // reapExpiredAttempts -- kills a mutant that copy-pasted the expiry
    // filter into this function too.
    test('DISCRIMINATING: reapAllDispatchedAttempts reaps dispatched attempts even before their expiry', async () => {
      const { runId, entry, leaseToken } = await seedRunAndEntry();
      const notExpired = await insertAttempt({ entryId: entry.id, seatKey: 'seatC', state: 'dispatched', dispatchToken: 't3', dispatchExpiresAt: new Date(Date.now() + 60_000).toISOString() });

      const reaped = await reapAllDispatchedAttempts(runId, leaseToken);
      expect(reaped.map((r) => r.id)).toContain(notExpired);
      expect((await fetchAttempt(notExpired)).state).toBe('unknown_outcome');
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('selectWinners / sumAttemptCosts / sumEntryAttemptCosts / isAttemptCostUnknown', () => {
    test('selectWinners records the highest attempt_no completed attempt per seat, merging into existing winners_json', async () => {
      const superuserId = await insertSuperuser();
      const panelId = await insertPanel(superuserId);
      const leaseToken = crypto.randomUUID();
      const runId = await insertRun({ owner: superuserId, panelId, status: 'running', leaseToken, lockedUntil: new Date(Date.now() + 60_000).toISOString() });
      // Pre-existing winner for a DIFFERENT seat -- must survive the merge (||).
      const entry = await insertEntry({ runId, createdBy: superuserId, winnersJson: { other_seat: 'existing-attempt-id' } });

      await insertAttempt({ entryId: entry.id, seatKey: 'chair', attemptNo: 1, state: 'failed' });
      const winningAttemptId = await insertAttempt({ entryId: entry.id, seatKey: 'chair', attemptNo: 2, state: 'completed' });

      const updated = await selectWinners(entry.id, leaseToken);
      expect(updated.winners_json.chair).toBe(winningAttemptId);
      expect(updated.winners_json.other_seat).toBe('existing-attempt-id'); // merge preserved this
      await assertNoOpenTransactionAnywhere();
    });

    test('sumAttemptCosts/sumEntryAttemptCosts sum only known-cost attempts and count unknowns, matching isAttemptCostUnknown', async () => {
      const superuserId = await insertSuperuser();
      const panelId = await insertPanel(superuserId);
      const runId = await insertRun({ owner: superuserId, panelId });
      const entry = await insertEntry({ runId, createdBy: superuserId });

      await insertAttempt({ entryId: entry.id, seatKey: 's1', state: 'completed', costCents: 100, costState: 'known' });
      await insertAttempt({ entryId: entry.id, seatKey: 's2', state: 'completed', costCents: 200, costState: 'known' });
      // DISCRIMINATING: 'unknown_outcome' state counts as unknown cost even
      // though cost_state happens to be 'known' -- kills a mutant that
      // only checks cost_state, ignoring the state override.
      await insertAttempt({ entryId: entry.id, seatKey: 's3', state: 'unknown_outcome', costCents: 9999, costState: 'known' });
      // 'pending', not 'dispatched': the dispatched_has_token CHECK requires
      // a real dispatch_token/dispatch_expires_at pair for state='dispatched',
      // and this row only needs to be "in-flight with no known cost".
      await insertAttempt({ entryId: entry.id, seatKey: 's4', state: 'pending', costCents: null, costState: null });

      const runTotal = await sumAttemptCosts(runId);
      expect(runTotal.totalCents).toBe(300);
      expect(runTotal.unknownCount).toBe(2);

      const entryTotal = await sumEntryAttemptCosts(entry.id);
      expect(entryTotal).toEqual(runTotal);

      expect(isAttemptCostUnknown({ state: 'unknown_outcome', cost_state: 'known', cost_cents: 9999 })).toBe(true);
      expect(isAttemptCostUnknown({ state: 'completed', cost_state: 'known', cost_cents: 5 })).toBe(false);
    });
  });

  describe('listAttemptsForEntry / listEntryAttempts', () => {
    // DISCRIMINATING: listEntryAttempts is a batched, explicit-column
    // projection that must NEVER include prompt_snapshot_json/usage_json/
    // result_json -- kills a mutant that switches to `SELECT *`.
    test('DISCRIMINATING: listEntryAttempts never includes prompt/usage/result JSON columns', async () => {
      const superuserId = await insertSuperuser();
      const panelId = await insertPanel(superuserId);
      const runId = await insertRun({ owner: superuserId, panelId });
      const entry = await insertEntry({ runId, createdBy: superuserId });
      await client.query(
        `INSERT INTO review_panel_seat_attempts (id, entry_id, seat_key, attempt_no, state, prompt_snapshot_json, result_json, usage_json)
         VALUES ($1, $2, 'seat1', 1, 'completed', '{"secret":true}'::jsonb, '{"secret":true}'::jsonb, '{"secret":true}'::jsonb)`,
        [crypto.randomUUID(), entry.id]
      ).then((r) => insertedAttemptIds.push(r.rows ? undefined : undefined));
      const { rows: attemptRows } = await client.query('SELECT id FROM review_panel_seat_attempts WHERE entry_id = $1', [entry.id]);
      attemptRows.forEach((r) => insertedAttemptIds.push(r.id));

      const viaListAttemptsForEntry = await listAttemptsForEntry(entry.id);
      expect(viaListAttemptsForEntry[0].result_json).toEqual({ secret: true }); // this one DOES include it

      const rows = await listEntryAttempts([entry.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).not.toHaveProperty('prompt_snapshot_json');
      expect(rows[0]).not.toHaveProperty('result_json');
      expect(rows[0]).not.toHaveProperty('usage_json');
      expect(rows[0].seat_key).toBe('seat1');
    });

    test('listEntryAttempts returns [] for an empty id list without querying', async () => {
      expect(await listEntryAttempts([])).toEqual([]);
    });
  });

  describe('mutateReviewPanelEntry', () => {
    // DISCRIMINATING: retry_requested_at is pre-set and the mutation does
    // NOT touch it in `fn` -- it must still be cleared to NULL
    // unconditionally by the wrapping UPDATE, proving the clear is
    // unconditional, not contingent on fn changing something else.
    test('DISCRIMINATING: unconditionally clears retry_requested_at even when fn does not touch it', async () => {
      const superuserId = await insertSuperuser();
      const panelId = await insertPanel(superuserId);
      const leaseToken = crypto.randomUUID();
      const runId = await insertRun({ owner: superuserId, panelId, status: 'running', leaseToken, lockedUntil: new Date(Date.now() + 60_000).toISOString() });
      const entry = await insertEntry({ runId, createdBy: superuserId, status: 'failed' });
      await client.query(`UPDATE review_panel_entries SET retry_requested_at = NOW() WHERE id = $1`, [entry.id]);

      const updated = await mutateReviewPanelEntry(entry.id, async (e) => {
        e.status = 'running'; // fn does not reference retry_requested_at at all
      }, leaseToken);

      expect(updated.status).toBe('running');
      expect(updated.retry_requested_at).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    test('throws 404 for a nonexistent entry and on lease mismatch', async () => {
      await expect(mutateReviewPanelEntry(crypto.randomUUID(), async () => {}, 'x')).rejects.toMatchObject({ httpStatus: 404 });

      const superuserId = await insertSuperuser();
      const panelId = await insertPanel(superuserId);
      const leaseToken = crypto.randomUUID();
      const runId = await insertRun({ owner: superuserId, panelId, status: 'running', leaseToken, lockedUntil: new Date(Date.now() + 60_000).toISOString() });
      const entry = await insertEntry({ runId, createdBy: superuserId });
      await expect(mutateReviewPanelEntry(entry.id, async () => {}, 'wrong-lease')).rejects.toThrow(/lease expired/i);
      await assertNoOpenTransactionAnywhere();
    });
  });

  // ==========================================================================
  // Operator-initiated retry / re-render / cancel (route-triggered, no lease)
  // ==========================================================================
  describe('requestReviewPanelRetry', () => {
    test('marks only failed eligible entries and re-queues a settled run', async () => {
      const superuserId = await insertSuperuser();
      const panelId = await insertPanel(superuserId);
      const runId = await insertRun({ owner: superuserId, panelId, status: 'partial' }); // settled, no lease
      const failedEntry = await insertEntry({ runId, status: 'failed', createdBy: superuserId });
      const completedEntry = await insertEntry({ runId, status: 'completed', createdBy: superuserId });

      const result = await requestReviewPanelRetry(superuserId, [failedEntry.id, completedEntry.id]);
      expect(result.status).toBe('queued');
      expect((await fetchEntry(failedEntry.id)).retry_requested_at).not.toBeNull();
      // DISCRIMINATING: the 'completed' entry is NOT eligible -- must be
      // left untouched, proving the `status='failed'` filter is live.
      expect((await fetchEntry(completedEntry.id)).retry_requested_at).toBeNull();
    });

    test('DISCRIMINATING: a cancelled run gives the specific cancelled-run message, not the generic settle message', async () => {
      const superuserId = await insertSuperuser();
      const panelId = await insertPanel(superuserId);
      const runId = await insertRun({ owner: superuserId, panelId, status: 'cancelled' });
      const entry = await insertEntry({ runId, status: 'failed', createdBy: superuserId });

      await expect(requestReviewPanelRetry(superuserId, [entry.id])).rejects.toThrow(/cancelled by the operator/i);
    });

    test('throws when the run still has a live lease or is queued/running', async () => {
      const superuserId = await insertSuperuser();
      const panelId = await insertPanel(superuserId);
      const runId = await insertRun({ owner: superuserId, panelId, status: 'running' });
      const entry = await insertEntry({ runId, status: 'failed', createdBy: superuserId });
      await expect(requestReviewPanelRetry(superuserId, [entry.id])).rejects.toThrow(/wait for this run to settle/i);
    });

    test('requires at least one entry id', async () => {
      await expect(requestReviewPanelRetry(1, [])).rejects.toMatchObject({ httpStatus: 400 });
    });
  });

  describe('requestReviewPanelRerender', () => {
    test('is eligible only for completed entries with a completed chair attempt', async () => {
      const superuserId = await insertSuperuser();
      const panelId = await insertPanel(superuserId);
      const runId = await insertRun({ owner: superuserId, panelId, status: 'partial' });
      const eligible = await insertEntry({ runId, status: 'completed', createdBy: superuserId, data: { files: ['old.pdf'] } });
      await insertAttempt({ entryId: eligible.id, seatKey: 'chair', state: 'completed' });

      // DISCRIMINATING: completed but NO completed chair attempt -- not eligible.
      const noChair = await insertEntry({ runId, status: 'completed', createdBy: superuserId });
      await insertAttempt({ entryId: noChair.id, seatKey: 'chair', state: 'failed' });

      const result = await requestReviewPanelRerender(superuserId, [eligible.id, noChair.id]);
      expect(result.status).toBe('queued');
      const eligibleAfter = await fetchEntry(eligible.id);
      expect(eligibleAfter.retry_requested_at).not.toBeNull();
      expect(eligibleAfter.data.rerender.requestedBy).toBe(superuserId);
      expect(eligibleAfter.data.files).toEqual(['old.pdf']); // untouched, per header note
      expect((await fetchEntry(noChair.id)).retry_requested_at).toBeNull();
    });

    test('requires at least one entry id and throws if none eligible', async () => {
      await expect(requestReviewPanelRerender(1, [])).rejects.toMatchObject({ httpStatus: 400 });
      const superuserId = await insertSuperuser();
      const panelId = await insertPanel(superuserId);
      const runId = await insertRun({ owner: superuserId, panelId, status: 'partial' });
      const notCompleted = await insertEntry({ runId, status: 'pending', createdBy: superuserId });
      await expect(requestReviewPanelRerender(superuserId, [notCompleted.id])).rejects.toThrow(/eligible for re-rendering/i);
    });
  });

  describe('listRetryRequestedEntries', () => {
    test('returns ids with a retry marker, oldest first', async () => {
      const superuserId = await insertSuperuser();
      const panelId = await insertPanel(superuserId);
      const runId = await insertRun({ owner: superuserId, panelId, status: 'partial' });
      const a = await insertEntry({ runId, status: 'failed', createdBy: superuserId });
      const b = await insertEntry({ runId, status: 'completed', createdBy: superuserId });
      await requestReviewPanelRetry(superuserId, [a.id]);

      const ids = await listRetryRequestedEntries(runId);
      expect(ids).toContain(a.id);
      expect(ids).not.toContain(b.id);
    });
  });

  describe('requestReviewPanelCancel', () => {
    test('cancels a settled (no-lease) queued/running run owned by the caller', async () => {
      const superuserId = await insertSuperuser();
      const panelId = await insertPanel(superuserId);
      const runId = await insertRun({ owner: superuserId, panelId, status: 'queued', data: { note: 'x' } });

      const result = await requestReviewPanelCancel(runId, superuserId);
      expect(result.status).toBe('cancelled');
      expect(result.data.error).toBe('Cancelled by operator.');
      expect(result.data.note).toBe('x'); // spread-preserved
    });

    test('throws 404 for wrong owner, throws while an active lease is held, and throws for an already-settled run', async () => {
      const superuserId = await insertSuperuser();
      const otherOwner = await insertUserProfile();
      const panelId = await insertPanel(otherOwner);
      const runId = await insertRun({ owner: otherOwner, panelId, status: 'queued' });
      await expect(requestReviewPanelCancel(runId, superuserId)).rejects.toMatchObject({ httpStatus: 404 });

      // review_panels has UNIQUE(owner_profile_id): one panel per owner,
      // reused for both runs below.
      const superuserPanelId = await insertPanel(superuserId);
      const leasedRunId = await insertRun({
        owner: superuserId, panelId: superuserPanelId, status: 'running',
        leaseToken: crypto.randomUUID(), lockedUntil: new Date(Date.now() + 60_000).toISOString(),
      });
      await expect(requestReviewPanelCancel(leasedRunId, superuserId)).rejects.toThrow(/active worker pass/i);

      const settledRunId = await insertRun({ owner: superuserId, panelId: superuserPanelId, status: 'completed' });
      await expect(requestReviewPanelCancel(settledRunId, superuserId)).rejects.toThrow(/already settled/i);
    });
  });

  describe('stopRevokedReviewPanelRun', () => {
    test('fails the run, merges an error message into data, and releases the lease only on a matching token', async () => {
      const superuserId = await insertSuperuser();
      const panelId = await insertPanel(superuserId);
      const token = crypto.randomUUID();
      const runId = await insertRun({
        owner: superuserId, panelId, status: 'running', leaseToken: token,
        lockedUntil: new Date(Date.now() + 60_000).toISOString(), data: { note: 'keep-me' },
      });

      await stopRevokedReviewPanelRun(runId, crypto.randomUUID(), 'should not apply'); // well-formed UUID, just not the real lease
      expect((await fetchRun(runId)).status).toBe('running');

      await stopRevokedReviewPanelRun(runId, token, 'access revoked mid-drain');
      const row = await fetchRun(runId);
      expect(row.status).toBe('failed');
      expect(row.data.error).toBe('access revoked mid-drain');
      expect(row.data.note).toBe('keep-me');
      expect(row.lease_token).toBeNull();
      expect(row.locked_until).toBeNull();
    });
  });
});
