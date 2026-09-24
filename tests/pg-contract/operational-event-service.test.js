'use strict';

/**
 * Contract test for lib/services/operational-event-service.js — Stage 3
 * item 2 (wave 3 slice A), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 * TESTS-BEFORE ONLY: run against the UNCONVERTED file; no import swap yet.
 *
 * 8 statements total (census: sql-tag 7, sql.query 1 — `node
 * scripts/check-postgres-access-layer.js --json`): recordEvent's three
 * INSERT variants (drain ON CONFLICT DO NOTHING, app fold ON CONFLICT DO
 * UPDATE, plain insert), _settleByRecoveryKey's UPDATE, setEventStatus's
 * UPDATE + follow-up SELECT, queryEvents's dynamic sql.query SELECT, and
 * getEventSummary's GROUP BY SELECT. This test covers all 8 and every
 * castLint-flagged VALUES/CASE bound column (lines 239-241, 262-264,
 * 300-302, 429).
 *
 * Fail-open contract (plan §7, file header "Contract"): recordEvent,
 * markRecovered, markSuperseded never throw. The DISCRIMINATING
 * forced-failure test at the end of this file ends the shim's real pg Pool
 * (a genuine driver-level rejection, not a mock) and proves all three
 * still resolve instead of throwing — it MUST run last in this file since
 * it kills the pool for the remainder of the suite; afterAll's
 * Promise.allSettled tolerates the pool already being closed.
 *
 * Only tests/unit/operational-event-service.test.js mocks `@vercel/postgres`
 * directly; every other consumer test mocks this module's own export.
 *
 * Copies the template shape (tests/pg-contract/explorer-store.test.js):
 * PG_CONTRACT_URL gating, a direct pg Client for setup/verification/cleanup,
 * assertNoOpenTransactionAnywhere, tracked keys before writes, afterAll with
 * bounded lock_timeout/statement_timeout, and a Promise.allSettled close of
 * both the direct client and the shim pool. operational_events has no
 * per-run scoping column other than the row id itself, so every row this
 * file creates is tracked by id and deleted in afterAll.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('operational-event-service: contract', () => {
  const OperationalEventService = require('../../lib/services/operational-event-service');

  let client;
  const insertedEventIds = [];
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
      if (insertedEventIds.length) {
        await client.query('DELETE FROM operational_events WHERE id = ANY($1::bigint[])', [insertedEventIds]);
      }
      if (insertedUserProfileIds.length) {
        await client.query('DELETE FROM user_profiles WHERE id = ANY($1::int[])', [insertedUserProfileIds]);
      }
    } catch (err) {
      deleteError = err;
    } finally {
      // The final DISCRIMINATING test intentionally ends this pool early;
      // allSettled tolerates a second end() call without failing the suite.
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
    const name = `op_event_contract_${crypto.randomBytes(6).toString('hex')}`;
    const { rows } = await client.query(`INSERT INTO user_profiles (name) VALUES ($1) RETURNING id`, [name]);
    const id = rows[0].id;
    insertedUserProfileIds.push(id);
    return id;
  }

  async function fetchEvent(id) {
    const { rows } = await client.query('SELECT * FROM operational_events WHERE id = $1', [id]);
    return rows[0] || null;
  }

  describe('recordEvent (plain insert, no dedupeKey)', () => {
    test('binds every column, sanitizes metadata, and defaults status from severity', async () => {
      const uniqueType = `contract_event_${crypto.randomBytes(6).toString('hex')}`;
      const result = await OperationalEventService.recordEvent({
        eventType: uniqueType,
        severity: 'critical',
        summary: 'A real failure summary',
        subsystem: 'contract-subsystem',
        stage: 'virus_scan',
        transient: true,
        requestNumber: 'R-1000',
        entityRefs: { suggestionId: 'sugg-1' },
        correlationId: 'corr-1',
        recoveryKey: 'recovery-key-1',
        // A sensitive key must be redacted, proving sanitizeMetadata ran
        // (kills a mutant that stores opts.metadata verbatim).
        metadata: { note: 'ok', apiKey: 'super-secret-value' },
      });
      expect(result).toEqual({ id: expect.anything(), folded: false });
      insertedEventIds.push(result.id);

      const row = await fetchEvent(result.id);
      expect(row.source).toBe('app');
      expect(row.event_type).toBe(uniqueType);
      expect(row.severity).toBe('critical');
      expect(row.status).toBe('open');
      expect(row.summary).toBe('A real failure summary');
      expect(row.subsystem).toBe('contract-subsystem');
      expect(row.stage).toBe('virus_scan');
      expect(row.transient).toBe(true);
      expect(row.request_number).toBe('R-1000');
      expect(row.entity_refs).toEqual({ suggestionId: 'sugg-1' });
      expect(row.correlation_id).toBe('corr-1');
      expect(row.recovery_key).toBe('recovery-key-1');
      expect(row.dedupe_key).toBeNull();
      expect(row.metadata.note).toBe('ok');
      expect(row.metadata.apiKey).toBe('[REDACTED]');
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: severity 'info' must default status to 'info', not
    // 'open' -- the two literals are distinct enum members, so a mutant
    // that always defaults to 'open' regardless of severity is caught by
    // stored value.
    test('DISCRIMINATING: severity "info" defaults status to "info", not "open"', async () => {
      const uniqueType = `contract_info_${crypto.randomBytes(6).toString('hex')}`;
      const result = await OperationalEventService.recordEvent({
        eventType: uniqueType,
        severity: 'info',
        summary: 'info summary',
      });
      insertedEventIds.push(result.id);
      const row = await fetchEvent(result.id);
      expect(row.status).toBe('info');
      expect(row.severity).toBe('info');
    });

    test('summary falls back to eventType when omitted', async () => {
      const uniqueType = `contract_fallback_${crypto.randomBytes(6).toString('hex')}`;
      const result = await OperationalEventService.recordEvent({ eventType: uniqueType });
      insertedEventIds.push(result.id);
      const row = await fetchEvent(result.id);
      expect(row.summary).toBe(uniqueType);
    });

    test('returns null without touching the database when eventType is missing', async () => {
      const result = await OperationalEventService.recordEvent({ summary: 'no event type' });
      expect(result).toBeNull();
    });
  });

  describe('recordEvent (app fold/reopen via dedupeKey)', () => {
    // DISCRIMINATING: the event is pre-settled to 'resolved' via a direct
    // UPDATE (bypassing the service), so the second recordEvent call's
    // ON CONFLICT DO UPDATE branch must reopen it to 'open' AND increment
    // occurrence_count -- both distinct from the settled state, so a
    // mutant that dropped the reopen CASE or the counter increment is
    // caught by stored value.
    test('DISCRIMINATING: a repeat dedupeKey occurrence reopens a resolved row and increments occurrence_count', async () => {
      const dedupeKey = `contract_fold_${crypto.randomBytes(6).toString('hex')}`;
      const first = await OperationalEventService.recordEvent({
        eventType: 'contract_fold_event',
        severity: 'error',
        summary: 'first occurrence',
        dedupeKey,
      });
      insertedEventIds.push(first.id);
      expect(first.folded).toBe(false);

      await client.query(`UPDATE operational_events SET status = 'resolved' WHERE id = $1`, [first.id]);
      const beforeSecond = await fetchEvent(first.id);

      // DISCRIMINATING: pass a distinct, LATER occurredAt on the fold
      // occurrence and assert last_occurred_at actually moves -- kills a
      // mutant that keeps the row's old last_occurred_at instead of
      // "last_occurred_at = EXCLUDED.last_occurred_at".
      const laterOccurredAt = new Date(Date.now() + 3600000).toISOString();
      const second = await OperationalEventService.recordEvent({
        eventType: 'contract_fold_event',
        severity: 'warning',
        summary: 'second occurrence, different severity/summary',
        dedupeKey,
        occurredAt: laterOccurredAt,
      });
      expect(second.id).toBe(first.id);
      expect(second.folded).toBe(true);

      const row = await fetchEvent(first.id);
      expect(row.status).toBe('open');
      expect(row.occurrence_count).toBe(2);
      expect(row.severity).toBe('warning');
      expect(row.summary).toBe('second occurrence, different severity/summary');
      expect(new Date(row.last_occurred_at).getTime()).toBeGreaterThan(new Date(beforeSecond.last_occurred_at).getTime());
      expect(new Date(row.last_occurred_at).toISOString()).toBe(laterOccurredAt);
      await assertNoOpenTransactionAnywhere();
    });

    test('COALESCE keeps the prior subsystem/stage when the fold occurrence omits them', async () => {
      const dedupeKey = `contract_coalesce_${crypto.randomBytes(6).toString('hex')}`;
      const first = await OperationalEventService.recordEvent({
        eventType: 'contract_coalesce_event',
        summary: 'first',
        subsystem: 'kept-subsystem',
        stage: 'kept-stage',
        dedupeKey,
      });
      insertedEventIds.push(first.id);
      const beforeFold = await fetchEvent(first.id);
      expect(beforeFold.status).toBe('open');

      await OperationalEventService.recordEvent({
        eventType: 'contract_coalesce_event',
        summary: 'second, no subsystem/stage',
        dedupeKey,
      });

      const row = await fetchEvent(first.id);
      expect(row.subsystem).toBe('kept-subsystem');
      expect(row.stage).toBe('kept-stage');

      // DISCRIMINATING: folding an occurrence onto an already-OPEN row
      // (not resolved/recovered/superseded) must leave status and
      // status_changed_at untouched -- covers the CASE's ELSE branch,
      // which the reopen test above never exercises.
      expect(row.status).toBe('open');
      expect(new Date(row.status_changed_at).getTime()).toBe(new Date(beforeFold.status_changed_at).getTime());
    });
  });

  describe('recordEvent (vercel-drain, ON CONFLICT DO NOTHING)', () => {
    test('a duplicate drain delivery is reported as {duplicate:true} and does not change the stored row', async () => {
      const dedupeKey = `contract_drain_${crypto.randomBytes(6).toString('hex')}`;
      const first = await OperationalEventService.recordEvent({
        source: 'vercel-drain',
        eventType: 'contract_drain_event',
        summary: 'drain first delivery',
        dedupeKey,
      });
      insertedEventIds.push(first.id);
      expect(first.duplicate).toBeUndefined();

      const second = await OperationalEventService.recordEvent({
        source: 'vercel-drain',
        eventType: 'contract_drain_event',
        summary: 'drain REDELIVERY -- must not overwrite',
        dedupeKey,
      });
      expect(second).toEqual({ duplicate: true });

      const row = await fetchEvent(first.id);
      // Proves DO NOTHING actually fired -- the redelivery's summary and
      // occurrence_count must NOT have landed.
      expect(row.summary).toBe('drain first delivery');
      expect(row.occurrence_count).toBe(1);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('markRecovered / markSuperseded (_settleByRecoveryKey)', () => {
    test('marks all open events with the recoveryKey as recovered, binds the note, and only affects OPEN rows', async () => {
      const recoveryKey = `contract_recovery_${crypto.randomBytes(6).toString('hex')}`;
      const evt = await OperationalEventService.recordEvent({
        eventType: 'contract_recovery_event',
        summary: 'will be recovered',
        recoveryKey,
      });
      insertedEventIds.push(evt.id);

      const count = await OperationalEventService.markRecovered(recoveryKey, { note: 'auto-recovered by contract test' });
      expect(count).toBe(1);

      const row = await fetchEvent(evt.id);
      expect(row.status).toBe('recovered');
      expect(row.resolution_note).toBe('auto-recovered by contract test');
      expect(row.status_changed_at).not.toBeNull();

      // DISCRIMINATING: the row is no longer 'open', so a SECOND call with
      // the same recoveryKey must affect ZERO rows -- proves the
      // `WHERE ... status = 'open'` guard is live, not dropped.
      const secondCount = await OperationalEventService.markRecovered(recoveryKey, {});
      expect(secondCount).toBe(0);
      await assertNoOpenTransactionAnywhere();
    });

    test('markSuperseded sets status to superseded', async () => {
      const recoveryKey = `contract_supersede_${crypto.randomBytes(6).toString('hex')}`;
      const evt = await OperationalEventService.recordEvent({
        eventType: 'contract_supersede_event',
        summary: 'will be superseded',
        recoveryKey,
      });
      insertedEventIds.push(evt.id);

      const count = await OperationalEventService.markSuperseded(recoveryKey);
      expect(count).toBe(1);
      const row = await fetchEvent(evt.id);
      expect(row.status).toBe('superseded');
    });

    test('an unknown recoveryKey settles zero rows without throwing', async () => {
      await expect(OperationalEventService.markRecovered('no-such-recovery-key')).resolves.toBe(0);
    });
  });

  describe('setEventStatus', () => {
    test('resolves an open event, binds resolved_by only on resolve, and returns {id, status}', async () => {
      const profileId = await insertUserProfile();
      const evt = await OperationalEventService.recordEvent({ eventType: 'contract_resolve_event', summary: 'x' });
      insertedEventIds.push(evt.id);

      const result = await OperationalEventService.setEventStatus(evt.id, 'resolve', { profileId, note: 'fixed' });
      expect(result).toEqual({ id: evt.id, status: 'resolved' });

      const row = await fetchEvent(evt.id);
      expect(row.status).toBe('resolved');
      expect(row.resolved_by).toBe(profileId);
      expect(row.resolution_note).toBe('fixed');
    });

    // DISCRIMINATING: resolved_by must be bound ONLY when newStatus is
    // 'resolved' (the CASE at line 429) -- a 'reopen' action with a
    // profileId supplied must NOT stamp resolved_by. Anti-correlated: the
    // event already has a real resolved_by from a prior resolve, and this
    // reopen call passes a DIFFERENT profileId, so a mutant that always
    // binds the CASE's THEN branch would show that second id instead of
    // preserving the first (via the ELSE `resolved_by` branch).
    test('DISCRIMINATING: reopen does not overwrite resolved_by even when a profileId is supplied', async () => {
      const firstResolver = await insertUserProfile();
      const secondCaller = await insertUserProfile();
      const evt = await OperationalEventService.recordEvent({ eventType: 'contract_reopen_event', summary: 'x' });
      insertedEventIds.push(evt.id);

      await OperationalEventService.setEventStatus(evt.id, 'resolve', { profileId: firstResolver });
      await OperationalEventService.setEventStatus(evt.id, 'reopen', { profileId: secondCaller });

      const row = await fetchEvent(evt.id);
      expect(row.status).toBe('open');
      expect(row.resolved_by).toBe(firstResolver);
      expect(row.resolved_by).not.toBe(secondCaller);
    });

    test('a freshness mismatch throws stale_state with the current row attached', async () => {
      const evt = await OperationalEventService.recordEvent({ eventType: 'contract_stale_event', summary: 'x' });
      insertedEventIds.push(evt.id);

      await expect(
        OperationalEventService.setEventStatus(evt.id, 'resolve', { expectedStatus: 'resolved' })
      ).rejects.toMatchObject({ code: 'stale_state', current: { id: evt.id, status: 'open' } });
    });

    test('a status = "info" row cannot be resolved and setEventStatus returns null (not stale)', async () => {
      const evt = await OperationalEventService.recordEvent({ eventType: 'contract_info_guard', severity: 'info', summary: 'x' });
      insertedEventIds.push(evt.id);
      expect((await fetchEvent(evt.id)).status).toBe('info');

      const result = await OperationalEventService.setEventStatus(evt.id, 'resolve', {});
      expect(result).toBeNull();
      // Proves the row is untouched, not silently resolved.
      expect((await fetchEvent(evt.id)).status).toBe('info');
    });

    test('a nonexistent id returns null', async () => {
      const result = await OperationalEventService.setEventStatus(999999999, 'resolve', {});
      expect(result).toBeNull();
    });

    test('rejects an invalid id/action before touching the database', async () => {
      await expect(OperationalEventService.setEventStatus(0, 'resolve', {})).rejects.toMatchObject({ code: 'invalid_id' });
      const evt = await OperationalEventService.recordEvent({ eventType: 'contract_invalid_action', summary: 'x' });
      insertedEventIds.push(evt.id);
      await expect(OperationalEventService.setEventStatus(evt.id, 'not-a-real-action', {})).rejects.toMatchObject({ code: 'invalid_action' });
    });
  });

  describe('setEventStatuses (batch)', () => {
    test('buckets each item into updated/invalid/notFound independently', async () => {
      const evt = await OperationalEventService.recordEvent({ eventType: 'contract_batch_event', summary: 'x' });
      insertedEventIds.push(evt.id);
      const row = await fetchEvent(evt.id);

      const outcome = await OperationalEventService.setEventStatuses(
        [
          {
            id: evt.id,
            expectedStatus: row.status,
            expectedLastOccurredAt: row.last_occurred_at.toISOString(),
            expectedStatusChangedAt: row.status_changed_at,
            expectedOccurrenceCount: row.occurrence_count,
          },
          { id: 999999999 }, // incomplete -- missing every freshness field
          {
            id: 888888888,
            expectedStatus: 'open',
            expectedLastOccurredAt: new Date().toISOString(),
            expectedStatusChangedAt: null,
            expectedOccurrenceCount: 1,
          },
        ],
        'resolve'
      );

      expect(outcome.updated).toEqual([evt.id]);
      expect(outcome.invalid).toEqual([999999999]);
      expect(outcome.notFound).toEqual([888888888]);
      expect(outcome.stale).toEqual([]);
      expect(outcome.failed).toEqual([]);
    });
  });

  describe('queryEvents', () => {
    test('filters by status/hours window and search, and respects limit', async () => {
      const marker = `contract_query_${crypto.randomBytes(6).toString('hex')}`;
      const within = await OperationalEventService.recordEvent({
        eventType: `${marker}_within`, summary: `${marker} within window`, requestNumber: marker,
      });
      insertedEventIds.push(within.id);
      const outside = await OperationalEventService.recordEvent({
        eventType: `${marker}_outside`, summary: `${marker} outside window`, requestNumber: marker,
      });
      insertedEventIds.push(outside.id);
      // Push this one outside the 1-hour lookback window used below.
      await client.query(`UPDATE operational_events SET last_occurred_at = NOW() - interval '2 hours' WHERE id = $1`, [outside.id]);

      const rows = await OperationalEventService.queryEvents({ search: marker, hours: 1, limit: 10 });
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(within.id);
      expect(ids).not.toContain(outside.id);
      await assertNoOpenTransactionAnywhere();
    });

    test('DISCRIMINATING: orders rows by last_occurred_at DESC', async () => {
      const marker = `contract_order_${crypto.randomBytes(6).toString('hex')}`;
      const older = await OperationalEventService.recordEvent({
        eventType: `${marker}_older`, summary: `${marker} older`, requestNumber: marker,
      });
      insertedEventIds.push(older.id);
      await client.query(`UPDATE operational_events SET last_occurred_at = NOW() - interval '10 minutes' WHERE id = $1`, [older.id]);

      const newer = await OperationalEventService.recordEvent({
        eventType: `${marker}_newer`, summary: `${marker} newer`, requestNumber: marker,
      });
      insertedEventIds.push(newer.id);

      const rows = await OperationalEventService.queryEvents({ search: marker, hours: 1, limit: 10 });
      const ids = rows.map((r) => r.id);
      const newerIdx = ids.indexOf(newer.id);
      const olderIdx = ids.indexOf(older.id);
      expect(newerIdx).toBeGreaterThanOrEqual(0);
      expect(olderIdx).toBeGreaterThanOrEqual(0);
      expect(newerIdx).toBeLessThan(olderIdx);
    });

    test('status filter excludes non-matching statuses', async () => {
      const marker = `contract_status_${crypto.randomBytes(6).toString('hex')}`;
      const openEvt = await OperationalEventService.recordEvent({ eventType: marker, summary: marker });
      insertedEventIds.push(openEvt.id);
      await OperationalEventService.setEventStatus(openEvt.id, 'resolve', {});

      const openRows = await OperationalEventService.queryEvents({ status: 'open', search: marker, hours: 24 });
      expect(openRows.map((r) => r.id)).not.toContain(openEvt.id);

      const resolvedRows = await OperationalEventService.queryEvents({ status: 'resolved', search: marker, hours: 24 });
      expect(resolvedRows.map((r) => r.id)).toContain(openEvt.id);
    });
  });

  describe('getEventSummary', () => {
    test('groups counts by status and severity', async () => {
      const marker = `contract_summary_${crypto.randomBytes(6).toString('hex')}`;
      const a = await OperationalEventService.recordEvent({ eventType: `${marker}_a`, severity: 'error', summary: marker });
      const b = await OperationalEventService.recordEvent({ eventType: `${marker}_b`, severity: 'error', summary: marker });
      const c = await OperationalEventService.recordEvent({ eventType: `${marker}_c`, severity: 'critical', summary: marker });
      // DISCRIMINATING: seed an 'info' severity row too -- kills a mutant
      // that adds an extra "severity <> 'info'" filter to getEventSummary.
      const d = await OperationalEventService.recordEvent({ eventType: `${marker}_d`, severity: 'info', summary: marker });
      insertedEventIds.push(a.id, b.id, c.id, d.id);

      const summary = await OperationalEventService.getEventSummary({ hours: 1 });
      const errorOpen = summary.find((r) => r.status === 'open' && r.severity === 'error');
      const criticalOpen = summary.find((r) => r.status === 'open' && r.severity === 'critical');
      const infoBucket = summary.find((r) => r.status === 'info' && r.severity === 'info');
      expect(errorOpen.count).toBeGreaterThanOrEqual(2);
      expect(criticalOpen.count).toBeGreaterThanOrEqual(1);
      expect(infoBucket).toBeDefined();
      expect(infoBucket.count).toBeGreaterThanOrEqual(1);
      await assertNoOpenTransactionAnywhere();
    });
  });

  // DISCRIMINATING FORCED-FAILURE (plan §7 fail-open contract) -- MUST run
  // last: this genuinely ends the shim's real pg Pool (not a mock), so
  // every sql call after this point rejects with a real driver-level
  // error ("Cannot use a pool after calling end on it"). recordEvent,
  // markRecovered, and markSuperseded must all resolve instead of
  // rejecting -- proving their try/catch wraps the actual database call,
  // not a simulated one.
  test('DISCRIMINATING: a real closed-pool driver error leaves recordEvent/markRecovered/markSuperseded resolving, never throwing', async () => {
    await getShimPool().end();

    await expect(
      OperationalEventService.recordEvent({ eventType: 'contract_after_pool_closed', summary: 'x' })
    ).resolves.toBeNull();
    await expect(OperationalEventService.markRecovered('any-key')).resolves.toBe(0);
    await expect(OperationalEventService.markSuperseded('any-key')).resolves.toBe(0);
  });
});
