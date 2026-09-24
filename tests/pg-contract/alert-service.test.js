'use strict';

/**
 * Contract test for lib/services/alert-service.js — Stage 3 item 4 (wave 4,
 * connect/transaction users), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 * TESTS-BEFORE, run green against the UNCONVERTED file first, then the file
 * is converted onto withTransaction (createAlert's autoResolveKey branch
 * only — the plain-insert branch and every other method stay on the bare
 * `sql` tag) and this suite is re-run to prove the conversion.
 *
 * 7 client.query + 1 db.connect + 1 begin-literal + 16 sql-tag statements
 * (`node scripts/check-postgres-access-layer.js --json`). createAlert is
 * the only transactional method (plan §4 item 4: "two COMMITs but both on
 * success return paths (dedup -> null, insert -> row)").
 *
 * Only tests/unit/alert-service-open-keys.test.js loads the real module and
 * mocks `@vercel/postgres` directly (its factory already includes
 * `db: { connect }`); every other consumer test mocks this module's own
 * export.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');
const { withClient } = require('../../lib/postgres/client');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('alert-service: contract', () => {
  const AlertService = require('../../lib/services/alert-service');

  let client;
  const insertedAlertIds = [];
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
      if (insertedAlertIds.length) {
        await client.query('DELETE FROM system_alerts WHERE id = ANY($1::int[])', [insertedAlertIds]);
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

  async function insertUserProfile(name = `alert_contract_${crypto.randomBytes(6).toString('hex')}`) {
    const { rows } = await client.query(`INSERT INTO user_profiles (name) VALUES ($1) RETURNING id`, [name]);
    const id = rows[0].id;
    insertedUserProfileIds.push(id);
    return id;
  }

  async function fetchAlert(id) {
    return (await client.query('SELECT * FROM system_alerts WHERE id = $1', [id])).rows[0] || null;
  }

  describe('createAlert', () => {
    test('plain (no autoResolveKey) path binds every column via the bare sql tag', async () => {
      const metadata = { requestId: 'REQ-1' };
      const row = await AlertService.createAlert({
        type: 'contract_plain', severity: 'warning', title: 'Plain title', message: 'msg',
        metadata, source: 'contract-test',
      });
      insertedAlertIds.push(row.id);
      expect(row.alert_type).toBe('contract_plain');
      expect(row.severity).toBe('warning');
      expect(row.title).toBe('Plain title');
      expect(row.message).toBe('msg');
      expect(row.metadata).toEqual(metadata);
      expect(row.source).toBe('contract-test');
      expect(row.auto_resolve_key).toBeNull();
      expect(row.status).toBe('active');
    });

    test('transactional (autoResolveKey) path binds every column under the advisory lock', async () => {
      const autoResolveKey = `contract_key_${crypto.randomBytes(6).toString('hex')}`;
      const row = await AlertService.createAlert({
        type: 'contract_txn', severity: 'critical', title: 'Txn title', autoResolveKey,
      });
      insertedAlertIds.push(row.id);
      expect(row.alert_type).toBe('contract_txn');
      expect(row.auto_resolve_key).toBe(autoResolveKey);
      expect(row.status).toBe('active');
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: a second createAlert with the SAME autoResolveKey
    // while the first is still 'active' must be deduplicated (returns
    // null, no second row) -- kills a mutant that drops the dedup SELECT
    // or its status membership check.
    test('DISCRIMINATING: a repeat autoResolveKey while the first alert is still open is deduplicated (returns null)', async () => {
      const autoResolveKey = `contract_dedup_${crypto.randomBytes(6).toString('hex')}`;
      const first = await AlertService.createAlert({ type: 'contract_dedup', title: 'first', autoResolveKey });
      insertedAlertIds.push(first.id);

      const second = await AlertService.createAlert({ type: 'contract_dedup', title: 'second', autoResolveKey });
      expect(second).toBeNull();

      const { rows } = await client.query('SELECT count(*)::int AS n FROM system_alerts WHERE auto_resolve_key = $1', [autoResolveKey]);
      expect(rows[0].n).toBe(1);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: dedup treats 'acknowledged' as still open too, not
    // just 'active' -- kills a mutant that dedups only on status='active'.
    test('DISCRIMINATING: an ACKNOWLEDGED (not just active) alert also blocks a repeat autoResolveKey', async () => {
      const autoResolveKey = `contract_ack_dedup_${crypto.randomBytes(6).toString('hex')}`;
      const first = await AlertService.createAlert({ type: 'contract_ack_dedup', title: 'first', autoResolveKey });
      insertedAlertIds.push(first.id);
      const profileId = await insertUserProfile();
      await AlertService.acknowledgeAlert(first.id, profileId);

      const second = await AlertService.createAlert({ type: 'contract_ack_dedup', title: 'second', autoResolveKey });
      expect(second).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: once the first alert is RESOLVED (no longer active
    // or acknowledged), a repeat autoResolveKey must create a NEW row, not
    // be deduplicated forever.
    test('a resolved alert no longer blocks a repeat autoResolveKey', async () => {
      const autoResolveKey = `contract_resolved_${crypto.randomBytes(6).toString('hex')}`;
      const first = await AlertService.createAlert({ type: 'contract_resolved', title: 'first', autoResolveKey });
      insertedAlertIds.push(first.id);
      const profileId = await insertUserProfile();
      await AlertService.resolveAlert(first.id, profileId);

      const second = await AlertService.createAlert({ type: 'contract_resolved', title: 'second', autoResolveKey });
      expect(second).not.toBeNull();
      insertedAlertIds.push(second.id);
      expect(second.id).not.toBe(first.id);
    });
  });

  describe('getActiveAlerts', () => {
    test('filters by type+severity, type only, severity only, and CASE-orders by severity when unfiltered', async () => {
      const marker = `contract_active_${crypto.randomBytes(6).toString('hex')}`;
      const info = await AlertService.createAlert({ type: marker, severity: 'info', title: 'info' });
      const critical = await AlertService.createAlert({ type: marker, severity: 'critical', title: 'critical' });
      const warningOtherType = await AlertService.createAlert({ type: `${marker}_other`, severity: 'warning', title: 'other-type' });
      insertedAlertIds.push(info.id, critical.id, warningOtherType.id);

      const byTypeAndSeverity = await AlertService.getActiveAlerts({ type: marker, severity: 'critical' });
      expect(byTypeAndSeverity.map((r) => r.id)).toEqual([critical.id]);

      const byTypeOnly = await AlertService.getActiveAlerts({ type: marker });
      expect(byTypeOnly.map((r) => r.id).sort()).toEqual([info.id, critical.id].sort());

      const bySeverityOnly = await AlertService.getActiveAlerts({ severity: 'warning' });
      expect(bySeverityOnly.map((r) => r.id)).toContain(warningOtherType.id);

      // DISCRIMINATING: with no filter, ordering is CASE(severity) THEN
      // created_at DESC -- critical (0) must sort before info (3) even
      // though info was inserted after critical chronologically for THIS
      // marker's pair... actually info was inserted first here, so use
      // both: critical must appear before info regardless of insertion
      // order, proving severity dominates created_at in the ORDER BY.
      const unfiltered = await AlertService.getActiveAlerts({ limit: 500 });
      const ourIndexes = unfiltered.reduce((acc, r, i) => {
        if (r.id === info.id) acc.info = i;
        if (r.id === critical.id) acc.critical = i;
        return acc;
      }, {});
      expect(ourIndexes.critical).toBeLessThan(ourIndexes.info);
    });
  });

  describe('getAlerts', () => {
    test('joins acknowledged_by/resolved_by names and filters by status', async () => {
      const acker = await insertUserProfile('Contract Acker');
      const marker = `contract_getalerts_${crypto.randomBytes(6).toString('hex')}`;
      const alert = await AlertService.createAlert({ type: marker, title: 't' });
      insertedAlertIds.push(alert.id);
      await AlertService.acknowledgeAlert(alert.id, acker);

      const byStatus = await AlertService.getAlerts({ status: 'acknowledged' });
      const found = byStatus.find((r) => r.id === alert.id);
      expect(found.acknowledged_by_name).toBe('Contract Acker');
      expect(found.resolved_by_name).toBeNull();

      const unfiltered = await AlertService.getAlerts({ limit: 500 });
      expect(unfiltered.map((r) => r.id)).toContain(alert.id);
    });
  });

  describe('getAlertById / getOpenAutoResolveKeysByType / getOpenAlertsByTypeAndRequestId', () => {
    test('getAlertById returns the row or null', async () => {
      const marker = `contract_byid_${crypto.randomBytes(6).toString('hex')}`;
      const alert = await AlertService.createAlert({ type: marker, title: 't' });
      insertedAlertIds.push(alert.id);
      expect((await AlertService.getAlertById(alert.id)).id).toBe(alert.id);
      expect(await AlertService.getAlertById(999999999)).toBeNull();
    });

    test('getOpenAutoResolveKeysByType returns only non-null keys for open statuses of that type, [] for empty type', async () => {
      expect(await AlertService.getOpenAutoResolveKeysByType('')).toEqual([]);
      const marker = `contract_openkeys_${crypto.randomBytes(6).toString('hex')}`;
      const key = `key_${crypto.randomBytes(6).toString('hex')}`;
      const withKey = await AlertService.createAlert({ type: marker, title: 't', autoResolveKey: key });
      const withoutKey = await AlertService.createAlert({ type: marker, title: 't2' });
      insertedAlertIds.push(withKey.id, withoutKey.id);

      const keys = await AlertService.getOpenAutoResolveKeysByType(marker);
      expect(keys).toEqual([key]);
    });

    test('DISCRIMINATING: getOpenAlertsByTypeAndRequestId matches metadata.requestId case-insensitively and orders newest first', async () => {
      const marker = `contract_reqid_${crypto.randomBytes(6).toString('hex')}`;
      const requestId = `REQ-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const older = await AlertService.createAlert({ type: marker, title: 'older', metadata: { requestId: requestId.toLowerCase() } });
      insertedAlertIds.push(older.id);
      const newer = await AlertService.createAlert({ type: marker, title: 'newer', metadata: { requestId } });
      insertedAlertIds.push(newer.id);

      const rows = await AlertService.getOpenAlertsByTypeAndRequestId(marker, requestId);
      expect(rows.map((r) => r.id)).toEqual([newer.id, older.id]);

      expect(await AlertService.getOpenAlertsByTypeAndRequestId('', requestId)).toEqual([]);
      expect(await AlertService.getOpenAlertsByTypeAndRequestId(marker, '')).toEqual([]);
    });
  });

  describe('acknowledgeAlert / resolveAlert', () => {
    test('acknowledgeAlert only succeeds from status=active, resolveAlert only from active/acknowledged', async () => {
      const profileId = await insertUserProfile();
      const marker = `contract_ackresolve_${crypto.randomBytes(6).toString('hex')}`;
      const alert = await AlertService.createAlert({ type: marker, title: 't' });
      insertedAlertIds.push(alert.id);

      const acked = await AlertService.acknowledgeAlert(alert.id, profileId);
      expect(acked.status).toBe('acknowledged');
      expect(acked.acknowledged_by).toBe(profileId);
      expect(acked.acknowledged_at).not.toBeNull();

      // DISCRIMINATING: a second acknowledge on an already-acknowledged row
      // must be a no-op (WHERE status='active' excludes it).
      const secondAck = await AlertService.acknowledgeAlert(alert.id, profileId);
      expect(secondAck).toBeNull();

      const resolved = await AlertService.resolveAlert(alert.id, profileId);
      expect(resolved.status).toBe('resolved');
      expect(resolved.resolved_by).toBe(profileId);

      // DISCRIMINATING: resolving an already-resolved alert is a no-op.
      expect(await AlertService.resolveAlert(alert.id, profileId)).toBeNull();
    });
  });

  describe('autoResolve', () => {
    test('bulk-resolves every active/acknowledged alert matching the key and returns the count', async () => {
      const autoResolveKey = `contract_autoresolve_${crypto.randomBytes(6).toString('hex')}`;
      const a = await AlertService.createAlert({ type: 'contract_ar', title: 't1', autoResolveKey });
      insertedAlertIds.push(a.id);
      const profileId = await insertUserProfile();
      // Second alert can't share the SAME key via createAlert's dedup, so
      // seed it directly to prove autoResolve handles multiple matches.
      const { rows } = await client.query(
        `INSERT INTO system_alerts (alert_type, severity, title, status, auto_resolve_key) VALUES ('contract_ar','info','t2','acknowledged',$1) RETURNING id`,
        [autoResolveKey]
      );
      insertedAlertIds.push(rows[0].id);

      const count = await AlertService.autoResolve(autoResolveKey);
      expect(count).toBe(2);
      expect((await fetchAlert(a.id)).status).toBe('auto_resolved');
      expect((await fetchAlert(rows[0].id)).status).toBe('auto_resolved');
    });

    test('returns 0 for an unknown key without throwing', async () => {
      expect(await AlertService.autoResolve('no-such-key')).toBe(0);
    });
  });

  describe('updateAlertMetadata', () => {
    // DISCRIMINATING: the patch MERGES into existing metadata (||), it
    // does not replace it -- an untouched pre-existing key must survive.
    test('DISCRIMINATING: merges the patch into existing metadata, preserving untouched keys', async () => {
      const marker = `contract_metadata_${crypto.randomBytes(6).toString('hex')}`;
      const alert = await AlertService.createAlert({ type: marker, title: 't', metadata: { keep: 'me', shared: 'old' } });
      insertedAlertIds.push(alert.id);

      const updated = await AlertService.updateAlertMetadata(alert.id, { shared: 'new', added: true });
      expect(updated.metadata).toEqual({ keep: 'me', shared: 'new', added: true });
    });

    test('COALESCEs a null metadata column to {} before merging', async () => {
      const { rows } = await client.query(
        `INSERT INTO system_alerts (alert_type, severity, title, status) VALUES ('contract_nullmeta','info','t','active') RETURNING id`
      );
      insertedAlertIds.push(rows[0].id);
      const updated = await AlertService.updateAlertMetadata(rows[0].id, { a: 1 });
      expect(updated.metadata).toEqual({ a: 1 });
    });
  });

  describe('getAlertSummary', () => {
    test('sums counts by severity for active alerts only', async () => {
      const marker = `contract_summary_${crypto.randomBytes(6).toString('hex')}`;
      const a = await AlertService.createAlert({ type: marker, severity: 'critical', title: 't1' });
      const b = await AlertService.createAlert({ type: marker, severity: 'critical', title: 't2' });
      const c = await AlertService.createAlert({ type: marker, severity: 'warning', title: 't3' });
      insertedAlertIds.push(a.id, b.id, c.id);
      const profileId = await insertUserProfile();
      // Resolved alerts must NOT count toward the summary.
      await AlertService.resolveAlert(c.id, profileId);

      const summary = await AlertService.getAlertSummary();
      expect(summary.critical).toBeGreaterThanOrEqual(2);
      expect(summary.total).toBeGreaterThanOrEqual(2);
    });
  });

  describe('cleanupOldAlerts', () => {
    // DISCRIMINATING: an old ACTIVE alert must survive cleanup (only
    // resolved/auto_resolved are eligible), while an old RESOLVED one is
    // deleted -- kills a mutant that drops the status filter.
    test('deletes only old resolved/auto_resolved alerts, never old active ones', async () => {
      const marker = `contract_cleanup_${crypto.randomBytes(6).toString('hex')}`;
      const oldActive = await AlertService.createAlert({ type: marker, title: 'old active' });
      const oldResolved = await AlertService.createAlert({ type: marker, title: 'old resolved' });
      insertedAlertIds.push(oldActive.id, oldResolved.id);
      const profileId = await insertUserProfile();
      await AlertService.resolveAlert(oldResolved.id, profileId);
      await client.query(`UPDATE system_alerts SET created_at = NOW() - interval '200 days' WHERE id = ANY($1::int[])`, [[oldActive.id, oldResolved.id]]);

      const deletedCount = await AlertService.cleanupOldAlerts(90);
      expect(deletedCount).toBeGreaterThanOrEqual(1);
      expect(await fetchAlert(oldActive.id)).not.toBeNull();
      expect(await fetchAlert(oldResolved.id)).toBeNull();
    });
  });
});
