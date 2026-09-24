'use strict';

/**
 * Contract test for lib/services/meeting-tracker/agenda-store.js — Stage 3
 * item 3 (wave 3, slice B), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 *
 * Only source-text/parity coverage exists for this file (see
 * tests/unit/meeting-tracker-agenda-schema-parity.test.js, which greps the
 * source rather than executing it), so per plan §2 rule 9 this contract
 * test IS the tests-before requirement — every exported function is
 * exercised once against the real database.
 *
 * Must-cover (per `node scripts/check-postgres-access-layer.js --json` →
 * `j.castLint.filter(c => c.file === '.../agenda-store.js')`, 7 rows, all
 * on createOrGetAgendaSend's INSERT VALUES at lines 15/19/20): every bound
 * column of that statement is asserted below, including the JSONB columns.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { withClient } = require('../../lib/postgres/client');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('meeting-tracker/agenda-store: contract', () => {
  const store = require('../../lib/services/meeting-tracker/agenda-store');

  let client;
  const insertedOperationIds = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (insertedOperationIds.length) {
        await client.query('DELETE FROM deliberation_agenda_sends WHERE operation_id = ANY($1::uuid[])', [insertedOperationIds]);
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

  function freshOpId() {
    const id = crypto.randomUUID();
    insertedOperationIds.push(id);
    return id;
  }

  // Direct seed helper (bypasses the store) for tests that need a row in a
  // specific state the store's own functions can't produce directly.
  async function seedRow(overrides = {}) {
    const operationId = overrides.operationId || freshOpId();
    const base = {
      operationId,
      sessionId: crypto.randomUUID(),
      state: 'prepared',
      toRecipients: [{ email: 'seed@example.org' }],
      ccRecipients: [],
      dynamicsEmailId: null,
      leaseToken: null,
      lockedUntil: null,
      sentAt: null,
      sendRequestedAt: null,
      ...overrides,
      operationId,
    };
    // deliberation_agenda_lease_shape requires both lease_token and
    // locked_until to be set together (or both null) -- default
    // locked_until to the future whenever a caller sets a lease token but
    // doesn't care about the lock expiry itself.
    if (base.leaseToken && !base.lockedUntil) {
      base.lockedUntil = new Date(Date.now() + 60000).toISOString();
    }
    const { rows } = await client.query(
      `INSERT INTO deliberation_agenda_sends (
         operation_id, session_id, agenda_snapshot, to_recipients, cc_recipients,
         subject, body_text, body_html, from_email, state, dynamics_email_id,
         lease_token, locked_until, sent_at, send_requested_at
       ) VALUES ($1, $2, '{}'::jsonb, $3::jsonb, $4::jsonb, 'Subj', 'Body text', '<p>Body</p>', 'from@example.org',
                 $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        base.operationId, base.sessionId, JSON.stringify(base.toRecipients), JSON.stringify(base.ccRecipients),
        base.state, base.dynamicsEmailId, base.leaseToken, base.lockedUntil, base.sentAt, base.sendRequestedAt,
      ]
    );
    return rows[0];
  }

  describe('createOrGetAgendaSend', () => {
    // Covers all 7 castLint rows: every bound VALUES column, including the
    // JSONB ones, asserted round-tripped.
    test('inserts a brand-new row binding every column', async () => {
      const operationId = freshOpId();
      const sessionId = crypto.randomUUID();
      const input = {
        operationId, sessionId,
        agendaSnapshot: { items: ['Item A', 'Item B'] },
        toRecipients: [{ email: 'to@example.org' }],
        ccRecipients: [{ email: 'cc@example.org' }],
        subject: 'Contract Test Subject',
        bodyText: 'Contract test body text',
        bodyHtml: '<p>Contract test body html</p>',
        fromEmail: 'from@example.org',
        actingUserSystemId: crypto.randomUUID(),
      };

      const row = await store.createOrGetAgendaSend(input);
      expect(row.inserted).toBe(true);
      expect(row.operation_id).toBe(operationId);
      expect(row.session_id).toBe(sessionId);
      expect(row.agenda_snapshot).toEqual(input.agendaSnapshot);
      expect(row.to_recipients).toEqual(input.toRecipients);
      expect(row.cc_recipients).toEqual(input.ccRecipients);
      expect(row.subject).toBe(input.subject);
      expect(row.body_text).toBe(input.bodyText);
      expect(row.body_html).toBe(input.bodyHtml);
      expect(row.from_email).toBe(input.fromEmail);
      expect(row.acting_user_system_id).toBe(input.actingUserSystemId);
      expect(row.state).toBe('prepared');
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: ON CONFLICT (operation_id) DO NOTHING + the UNION ALL
    // fallback SELECT -- a second call with the SAME operation_id but a
    // DIFFERENT subject/body must return the ORIGINAL row (inserted:false),
    // never overwrite it and never create a duplicate. Kills a mutant that
    // uses DO UPDATE instead of DO NOTHING, and one that drops the
    // fallback SELECT (would return null instead of the existing row).
    test('a repeat call with the same operation_id returns the ORIGINAL row unmodified, inserted:false', async () => {
      const operationId = freshOpId();
      const sessionId = crypto.randomUUID();
      const first = await store.createOrGetAgendaSend({
        operationId, sessionId, agendaSnapshot: {}, toRecipients: [{ email: 'a@example.org' }],
        ccRecipients: [], subject: 'First Subject', bodyText: 'first', bodyHtml: '<p>first</p>', fromEmail: 'f@example.org',
      });
      expect(first.inserted).toBe(true);

      const second = await store.createOrGetAgendaSend({
        operationId, sessionId, agendaSnapshot: {}, toRecipients: [{ email: 'a@example.org' }],
        ccRecipients: [], subject: 'DIFFERENT Subject', bodyText: 'different', bodyHtml: '<p>different</p>', fromEmail: 'different@example.org',
      });
      expect(second.inserted).toBe(false);
      expect(second.subject).toBe('First Subject');
      expect(second.body_text).toBe('first');

      const { rows: countRows } = await client.query('SELECT count(*)::int AS n FROM deliberation_agenda_sends WHERE operation_id = $1', [operationId]);
      expect(countRows[0].n).toBe(1);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('getAgendaSend', () => {
    test('returns the row by operation_id, or null when absent', async () => {
      const row = await seedRow();
      const found = await store.getAgendaSend(row.operation_id);
      expect(found.operation_id).toBe(row.operation_id);

      const missing = await store.getAgendaSend(crypto.randomUUID());
      expect(missing).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('getLatestSentAgendaSend', () => {
    // DISCRIMINATING: two 'sent' rows for the SAME session with distinct
    // sent_at, plus a non-'sent' row that sorts later than both by
    // created_at -- proves both the state='sent' filter and the sent_at
    // DESC ordering (not created_at, not insertion order).
    test('returns the most recently sent row for the session, excluding non-sent states', async () => {
      const sessionId = crypto.randomUUID();
      const older = await seedRow({ sessionId, state: 'sent', sentAt: new Date(Date.now() - 60000).toISOString() });
      const newer = await seedRow({ sessionId, state: 'sent', sentAt: new Date().toISOString() });
      await seedRow({ sessionId, state: 'prepared' }); // must be excluded despite being inserted last

      const latest = await store.getLatestSentAgendaSend(sessionId);
      expect(latest.operation_id).toBe(newer.operation_id);
      expect(latest.operation_id).not.toBe(older.operation_id);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('getLatestUnresolvedAgendaSend', () => {
    test('returns the send_requested row for the session, and null for a session with none', async () => {
      const sessionId = crypto.randomUUID();
      const row = await seedRow({
        sessionId, state: 'send_requested', dynamicsEmailId: crypto.randomUUID(),
        sendRequestedAt: new Date().toISOString(),
      });
      await seedRow({ sessionId: crypto.randomUUID(), state: 'send_requested', sendRequestedAt: new Date().toISOString() }); // different session, must not leak

      const found = await store.getLatestUnresolvedAgendaSend(sessionId);
      expect(found.operation_id).toBe(row.operation_id);

      const none = await store.getLatestUnresolvedAgendaSend(crypto.randomUUID());
      expect(none).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('claimAgendaSend', () => {
    test('claims a fresh prepared row, clamps lockSeconds, and increments attempt_count', async () => {
      const row = await seedRow({ state: 'prepared' });
      const before = Date.now();
      const claimed = await store.claimAgendaSend(row.operation_id, { lockSeconds: 5 }); // below the 30s floor
      expect(claimed).not.toBeNull();
      expect(claimed.attempt_count).toBe(1);
      expect(claimed.lease_token).toEqual(expect.any(String));
      const lockedUntilMs = new Date(claimed.locked_until).getTime();
      // Clamped to the 30s floor, not the raw 5s requested.
      expect(lockedUntilMs).toBeGreaterThanOrEqual(before + 29_000);
      expect(lockedUntilMs).toBeLessThan(before + 60_000);

      // Claiming again immediately fails: locked_until is in the future.
      const reclaim = await store.claimAgendaSend(row.operation_id, { lockSeconds: 60 });
      expect(reclaim).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: state NOT IN ('sent', 'failed') -- a terminal-state
    // row must never be claimable, no matter its lock state. Kills a
    // mutant that drops or inverts the state exclusion.
    test('refuses to claim a row in a terminal state (sent/failed)', async () => {
      const sentRow = await seedRow({ state: 'sent', sentAt: new Date().toISOString() });
      const failedRow = await seedRow({ state: 'failed' });
      expect(await store.claimAgendaSend(sentRow.operation_id)).toBeNull();
      expect(await store.claimAgendaSend(failedRow.operation_id)).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    test('reclaims a row whose lock already expired', async () => {
      const row = await seedRow({
        state: 'prepared', leaseToken: crypto.randomUUID(),
        lockedUntil: new Date(Date.now() - 1000).toISOString(), // already expired
      });
      const claimed = await store.claimAgendaSend(row.operation_id);
      expect(claimed).not.toBeNull();
      expect(claimed.attempt_count).toBe(1);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('recordAgendaEmailActivity', () => {
    test('sets dynamics_email_id and flips prepared -> activity_created, is idempotent for the SAME email, and refuses a DIFFERENT email once set', async () => {
      const row = await seedRow({ state: 'prepared', leaseToken: crypto.randomUUID(), lockedUntil: new Date(Date.now() + 60000).toISOString() });
      const emailId = crypto.randomUUID();

      const updated = await store.recordAgendaEmailActivity(row, emailId);
      expect(updated.dynamics_email_id).toBe(emailId);
      expect(updated.state).toBe('activity_created');

      // Idempotent replay with the SAME email id still matches the WHERE
      // guard (dynamics_email_id IS NULL OR = emailId) and leaves state as-is.
      const replay = await store.recordAgendaEmailActivity(row, emailId);
      expect(replay.dynamics_email_id).toBe(emailId);
      expect(replay.state).toBe('activity_created');

      // DISCRIMINATING: a DIFFERENT email id must NOT match the guard once
      // dynamics_email_id is set -- proves the guard is a real WHERE
      // clause, not decorative.
      const otherEmailId = crypto.randomUUID();
      const refused = await store.recordAgendaEmailActivity(row, otherEmailId);
      expect(refused).toBeNull();
      const { rows: after } = await client.query('SELECT dynamics_email_id FROM deliberation_agenda_sends WHERE operation_id = $1', [row.operation_id]);
      expect(after[0].dynamics_email_id).toBe(emailId);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('recordAgendaSendRequested', () => {
    test('requires dynamics_email_id to already be set, and COALESCE keeps the first send_requested_at on replay', async () => {
      const noEmailRow = await seedRow({ state: 'activity_created', leaseToken: crypto.randomUUID() });
      expect(await store.recordAgendaSendRequested(noEmailRow)).toBeNull();

      const withEmailRow = await seedRow({
        state: 'activity_created', leaseToken: crypto.randomUUID(), dynamicsEmailId: crypto.randomUUID(),
      });
      const first = await store.recordAgendaSendRequested(withEmailRow);
      expect(first.state).toBe('send_requested');
      expect(first.send_requested_at).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await store.recordAgendaSendRequested(withEmailRow);
      expect(new Date(second.send_requested_at).getTime()).toBe(new Date(first.send_requested_at).getTime());
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('recordAgendaDraftReconciled', () => {
    test('flips send_requested -> activity_created, clears send_requested_at, binds statecode/statuscode, and refuses the wrong starting state', async () => {
      const row = await seedRow({
        state: 'send_requested', leaseToken: crypto.randomUUID(), dynamicsEmailId: crypto.randomUUID(),
        sendRequestedAt: new Date().toISOString(),
      });
      const updated = await store.recordAgendaDraftReconciled(row, { statecode: 1, statuscode: 2 });
      expect(updated.state).toBe('activity_created');
      expect(updated.send_requested_at).toBeNull();
      expect(updated.dynamics_statecode).toBe(1);
      expect(updated.dynamics_statuscode).toBe(2);

      // Wrong starting state (already activity_created) must not match.
      const refused = await store.recordAgendaDraftReconciled(updated, { statecode: 9, statuscode: 9 });
      expect(refused).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('recordAgendaTerminalFailure', () => {
    // DISCRIMINATING: message truncation to ERROR_MAX (1000) chars -- an
    // over-length message must be stored truncated to EXACTLY 1000 chars,
    // not the full string and not some other length.
    test('flips to failed, clears the lease, and truncates the message to 1000 chars', async () => {
      const row = await seedRow({
        state: 'send_requested', leaseToken: crypto.randomUUID(), dynamicsEmailId: crypto.randomUUID(),
        lockedUntil: new Date(Date.now() + 60000).toISOString(),
      });
      const longMessage = 'x'.repeat(1500);
      const updated = await store.recordAgendaTerminalFailure(row, { statecode: 3, statuscode: 4 }, longMessage);
      expect(updated.state).toBe('failed');
      expect(updated.lease_token).toBeNull();
      expect(updated.locked_until).toBeNull();
      expect(updated.last_error_code).toBe('agenda_send_terminal');
      expect(updated.last_error_message).toHaveLength(1000);
      expect(updated.last_error_message).toBe('x'.repeat(1000));
      expect(updated.dynamics_statecode).toBe(3);
      expect(updated.dynamics_statuscode).toBe(4);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('renewAgendaSendLease', () => {
    test('extends locked_until only while state is send_requested', async () => {
      const row = await seedRow({
        state: 'send_requested', leaseToken: crypto.randomUUID(), dynamicsEmailId: crypto.randomUUID(),
        lockedUntil: new Date(Date.now() + 1000).toISOString(),
      });
      const before = Date.now();
      const renewed = await store.renewAgendaSendLease(row, { lockSeconds: 600 });
      expect(new Date(renewed.locked_until).getTime()).toBeGreaterThanOrEqual(before + 599_000);

      const wrongStateRow = await seedRow({ state: 'activity_created', leaseToken: crypto.randomUUID() });
      expect(await store.renewAgendaSendLease(wrongStateRow)).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('recordAgendaSent', () => {
    test('flips to sent, requires dynamics_email_id, and clears the lease', async () => {
      const noEmailRow = await seedRow({ state: 'send_requested', leaseToken: crypto.randomUUID() });
      expect(await store.recordAgendaSent(noEmailRow)).toBeNull();

      const row = await seedRow({
        state: 'send_requested', leaseToken: crypto.randomUUID(), dynamicsEmailId: crypto.randomUUID(),
      });
      const first = await store.recordAgendaSent(row, { statecode: 0, statuscode: 1 });
      expect(first.state).toBe('sent');
      expect(first.lease_token).toBeNull();
      expect(first.locked_until).toBeNull();
      expect(first.sent_at).not.toBeNull();
      expect(first.dynamics_statecode).toBe(0);
      expect(first.dynamics_statuscode).toBe(1);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: COALESCE(sent_at, NOW()) / COALESCE(send_requested_at, NOW())
    // must preserve an ALREADY-set sent_at/send_requested_at rather than
    // overwriting it with the current call's clock time. A row is seeded
    // directly with both fields already populated (simulating a retry that
    // reaches the UPDATE again with a still-matching lease), and the
    // service call's own lease_token is made to match the seeded one.
    test('COALESCE preserves an already-set sent_at and send_requested_at', async () => {
      const leaseToken = crypto.randomUUID();
      const priorSentAt = new Date(Date.now() - 120000).toISOString();
      const priorRequestedAt = new Date(Date.now() - 180000).toISOString();
      const row = await seedRow({
        state: 'send_requested', leaseToken, dynamicsEmailId: crypto.randomUUID(),
        sentAt: priorSentAt, sendRequestedAt: priorRequestedAt,
      });

      const updated = await store.recordAgendaSent({ operation_id: row.operation_id, lease_token: leaseToken });
      expect(new Date(updated.sent_at).getTime()).toBe(new Date(priorSentAt).getTime());
      expect(new Date(updated.send_requested_at).getTime()).toBe(new Date(priorRequestedAt).getTime());
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('recordAgendaFailure', () => {
    // DISCRIMINATING: last_error_code truncates to 100 chars, last_error_message
    // to 1000 -- two DIFFERENT limits, so a mutant that applies one limit
    // to both fields (or swaps them) fails this assertion.
    test('clears the lease and truncates code (100) and message (1000) independently', async () => {
      const row = await seedRow({ state: 'prepared', leaseToken: crypto.randomUUID(), lockedUntil: new Date(Date.now() + 60000).toISOString() });
      const longCode = 'c'.repeat(150);
      const longMessage = 'm'.repeat(1200);
      const updated = await store.recordAgendaFailure(row, new Error(longMessage), longCode);
      expect(updated.lease_token).toBeNull();
      expect(updated.locked_until).toBeNull();
      expect(updated.last_error_code).toHaveLength(100);
      expect(updated.last_error_code).toBe('c'.repeat(100));
      expect(updated.last_error_message).toHaveLength(1000);
      expect(updated.last_error_message).toBe('m'.repeat(1000));

      // Default code + string (not Error) message path.
      const row2 = await seedRow({ state: 'prepared', leaseToken: crypto.randomUUID() });
      const updated2 = await store.recordAgendaFailure(row2, 'plain string error');
      expect(updated2.last_error_code).toBe('agenda_send_failed');
      expect(updated2.last_error_message).toBe('plain string error');
      await assertNoOpenTransactionAnywhere();
    });
  });
});
