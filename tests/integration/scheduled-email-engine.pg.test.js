/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client } from 'pg';

/**
 * Live-Postgres proof for scheduled-email Part A
 * (docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md, A1–A7): the store's
 * claim/fence/window SQL runs against migrations 036 + 059 with real parameter
 * typing, and the service's crash-safety paths (send intent as the point of no
 * return, classified stored-activity reads, generation-aware recovery,
 * reconciliation fairness) are exercised with the REAL store and mocked
 * Dynamics.
 *
 * SKIPPED by default. Set TEST_REQUEST_LEDGER_TEST_URL to a scratch/local
 * Postgres database (NEVER the shared Production/Preview POSTGRES_URL). The
 * test works in its own schema and drops it afterwards.
 */
const TEST_URL = process.env.TEST_REQUEST_LEDGER_TEST_URL || '';
if (!TEST_URL && process.env.TEST_REQUEST_LEDGER_REQUIRE === '1') {
  throw new Error('TEST_REQUEST_LEDGER_REQUIRE=1 but TEST_REQUEST_LEDGER_TEST_URL is unset.');
}
if (/neon\.tech/i.test(TEST_URL) || (process.env.POSTGRES_URL && TEST_URL === process.env.POSTGRES_URL)) {
  throw new Error('Refusing to run the scheduled-email proof against the shared Production/Preview database.');
}
const describeIf = TEST_URL ? describe : describe.skip;

// The store's `sql` tag, executed as a parameterized query on the scratch client.
const mockPg = { client: null };
jest.mock('@vercel/postgres', () => ({
  sql: (strings, ...values) => mockPg.client.query(
    strings.reduce((text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ''), ''),
    values,
  ),
}));

const MIGRATIONS = ['036_scheduled_email_messages.sql', '059_scheduled_email_recipient_generation.sql']
  .map((file) => fs.readFileSync(path.join(process.cwd(), 'lib/db/migrations', file), 'utf8'));

const PD_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PD_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PD_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACTIVITY = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
// The plan's A5 fixture names it 'stale-token'; lease_token is UUID, so a fixed
// UUID no live worker holds stands in for it.
const STALE_TOKEN = '99999999-9999-4999-8999-999999999999';
const UNCONFIRMED = 'scheduled_email_send_unconfirmed';
const MISSING = 'scheduled_email_activity_missing';
const FORBIDDEN = 'scheduled_email_activity_forbidden';

const httpError = (status) => Object.assign(new Error(`dataverse failed (${status})`), { status });

describeIf('scheduled email engine Part A (live Postgres, migrations 036 + 059)', () => {
  const schema = `sched_email_${crypto.randomBytes(4).toString('hex')}`;
  let store;
  let service;
  let attention;

  beforeAll(async () => {
    mockPg.client = new Client({ connectionString: TEST_URL });
    await mockPg.client.connect();
    await mockPg.client.query(`CREATE SCHEMA ${schema}`);
    await mockPg.client.query(`SET search_path TO ${schema}`);
    for (const migration of MIGRATIONS) await mockPg.client.query(migration);
    store = await import('../../lib/services/scheduled-email-store.js');
    service = await import('../../lib/services/scheduled-email-service.js');
    attention = await import('../../shared/utils/scheduled-email-attention.js');
  });

  afterAll(async () => {
    if (!mockPg.client) return;
    await mockPg.client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await mockPg.client.end();
  });

  beforeEach(async () => {
    await mockPg.client.query('DELETE FROM scheduled_email_messages');
  });

  /* ------------------------------ fixtures ------------------------------ */

  async function seed(overrides = {}) {
    const id = overrides.id || crypto.randomUUID();
    const row = {
      id,
      workflowType: 'grantee_abstract_reminder',
      sourceRecordId: overrides.sourceRecordId || crypto.randomUUID(),
      requestId: overrides.requestId || crypto.randomUUID(),
      deliverableId: overrides.deliverableId || crypto.randomUUID(),
      pdSystemUserId: overrides.pdSystemUserId || PD_A,
      pdName: 'Jean Kim',
      pdEmail: 'jean@example.org',
      toRecipients: ['pi@example.edu'],
      ccRecipients: [],
      recipientName: 'Professor Reiter',
      recipientContactIds: [],
      subject: 'Reminder: abstract due',
      bodyText: 'Dear Professor Reiter,\n\nPlease review your abstract.\n\nThank you,',
      signatureText: 'Jean Kim',
      scheduledSendAt: overrides.scheduledSendAt || '2026-01-01T08:00:00.000Z',
      approvalRequired: overrides.approvalRequired === true,
    };
    await store.createOrGetScheduledEmail(row);
    const sets = [];
    const values = [];
    const push = (col, val) => { values.push(val); sets.push(`${col} = $${values.length}`); };
    for (const [col, val] of Object.entries(overrides.set || {})) push(col, val);
    if (sets.length) {
      values.push(id);
      await mockPg.client.query(`UPDATE scheduled_email_messages SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    }
    return read(id);
  }

  async function read(id) {
    const result = await mockPg.client.query('SELECT * FROM scheduled_email_messages WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  /** Real store + mocked Dynamics, in the service's dependency shape. */
  function deps(overrides = {}) {
    return {
      getMessage: store.getScheduledEmail,
      claimSend: store.claimScheduledEmailSend,
      recordEmailActivity: store.recordScheduledEmailActivity,
      recordSendRequested: store.recordScheduledEmailSendRequested,
      recordSent: store.recordScheduledEmailSent,
      recordFailure: store.recordScheduledEmailFailure,
      recordFinalized: store.recordScheduledEmailFinalized,
      cancelForSource: store.cancelScheduledEmailForSource,
      claimReconciliation: store.claimScheduledEmailReconciliation,
      releaseReconciliation: store.releaseScheduledEmailReconciliation,
      claimActivityRead: store.claimScheduledEmailActivityRead,
      clearActivityCode: store.clearScheduledEmailActivityCode,
      recordStoppedSent: store.recordStoppedScheduledEmailSent,
      getDeliverable: jest.fn(async () => ({ _etag: 'W/"1"', wmkf_deliverablestatus: 100000001 })),
      updateDeliverable: jest.fn(async () => ({})),
      createEmailActivity: jest.fn(async () => ACTIVITY),
      sendEmail: jest.fn(async () => undefined),
      getEmailActivity: jest.fn(async () => ({ activityid: ACTIVITY, statuscode: 1, statecode: 0 })),
      findEmailByCorrelation: jest.fn(async () => []),
      mintForRequest: jest.fn(async () => ({ url: 'https://grantees.example.org/t' })),
      isolationEnabled: () => false,
      resolveTestState: jest.fn(),
      ...overrides,
    };
  }

  const INVITED = 100000001;

  /* --------------------------------- A1/A2 -------------------------------- */

  test('A1/A2: send-now on a future, unapproved row records send intent; a failed SendEmail marks it unconfirmed at once; later reconciliation records the late acceptance and never sends again', async () => {
    const row = await seed({ scheduledSendAt: '2099-01-01T08:00:00.000Z', approvalRequired: true });
    const d = deps({ getDeliverable: jest.fn(async () => ({ _etag: 'x', wmkf_deliverablestatus: INVITED })) });
    d.sendEmail.mockRejectedValueOnce(new Error('connection ended during SendEmail'));

    // Ordinary (cron) claim refuses: future and unapproved.
    expect(await store.claimScheduledEmailSend(row.id)).toBeNull();

    const error = await service.deliverScheduledEmail(row.id, { force: true, pdSystemUserId: PD_A, expectedVersion: row.version }, d)
      .catch((caught) => caught);
    expect(error).toMatchObject({ emailOutcome: 'uncertain', retryable: false });

    let after = await read(row.id);
    expect(after).toMatchObject({ status: 'failed', last_error_code: UNCONFIRMED, dynamics_email_id: ACTIVITY, lease_token: null, locked_until: null });
    expect(after.send_requested_at).not.toBeNull();
    expect(after.attempt_count).toBe(1);
    expect(attention.isSendUnconfirmed(after)).toBe(true);
    expect(attention.scheduledEmailAttentionReason(after)).toBe('unconfirmed');

    // Ordinary paths can never touch it again: due query, ordinary claim, send-now.
    expect(await store.listDueScheduledEmails()).toEqual([]);
    expect(await store.claimScheduledEmailSend(row.id, { force: true })).toBeNull();
    expect(await service.deliverScheduledEmail(row.id, { force: true, pdSystemUserId: PD_A, expectedVersion: after.version }, d)).toEqual({ skipped: true });
    expect(d.sendEmail).toHaveBeenCalledTimes(1);

    // Reconciliation claims it despite schedule and approval, reads only.
    const candidates = await store.listScheduledEmailReconciliationCandidates();
    expect(candidates.map((c) => c.id)).toEqual([row.id]);
    const unresolved = await service.reconcileScheduledEmailCandidate(candidates[0], d);
    expect(unresolved).toMatchObject({ unresolved: true, reason: 'not_accepted' });
    const released = await read(row.id);
    expect(released).toMatchObject({ status: 'failed', last_error_code: UNCONFIRMED, lease_token: null, attempt_count: 1 });
    expect(new Date(released.updated_at).getTime()).toBeGreaterThan(new Date(after.updated_at).getTime());
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
    expect(d.createEmailActivity).toHaveBeenCalledTimes(1);

    // Dynamics accepts late: the next run records sent + finalized.
    d.getEmailActivity.mockResolvedValue({ activityid: ACTIVITY, statuscode: 3, statecode: 1, senton: '2026-09-30T00:00:00Z' });
    const sent = await service.reconcileScheduledEmailCandidate(await read(row.id), d);
    expect(sent.sent).toBe(true);
    expect(await read(row.id)).toMatchObject({ status: 'sent', last_error_code: null, lease_token: null, attempt_count: 1 });
    expect((await read(row.id)).finalized_at).not.toBeNull();
    expect(d.updateDeliverable).toHaveBeenCalledTimes(1);
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
  });

  test('A2: the ordinary claim refuses send intent even with a null or different error code; the reconciliation claim re-stamps the marker and keeps attempt_count', async () => {
    const row = await seed({ set: { status: 'failed', dynamics_email_id: ACTIVITY, send_requested_at: new Date(), last_error_code: 'something_else', attempt_count: 3 } });
    expect(await store.claimScheduledEmailSend(row.id, { force: true })).toBeNull();
    const claimed = await store.claimScheduledEmailReconciliation(row.id);
    expect(claimed).toMatchObject({ last_error_code: UNCONFIRMED, attempt_count: 3 });
    expect(claimed.lease_token).not.toBeNull();
    // A second reconciliation claim loses to the live lease.
    expect(await store.claimScheduledEmailReconciliation(row.id)).toBeNull();
    // Release needs the claim's own token.
    expect(await store.releaseScheduledEmailReconciliation({ ...claimed, lease_token: STALE_TOKEN })).toBeNull();
    const released = await store.releaseScheduledEmailReconciliation(claimed);
    expect(released).toMatchObject({ status: 'failed', last_error_code: UNCONFIRMED, lease_token: null, attempt_count: 3 });
  });

  test('A2: an unconfirmed row can be stopped by its PD but not edited or approved', async () => {
    const row = await seed({ set: { status: 'failed', dynamics_email_id: ACTIVITY, send_requested_at: new Date(), last_error_code: UNCONFIRMED } });
    const base = { id: row.id, pdSystemUserId: PD_A, profileId: 7, expectedVersion: row.version };
    expect(await store.updateScheduledEmailDraft({ ...base, subject: 'S', bodyText: 'B' })).toBeNull();
    expect(await store.approveScheduledEmail(base)).toBeNull();
    const stopped = await store.stopScheduledEmail(base);
    expect(stopped).toMatchObject({ status: 'stopped' });
  });

  test('A2 late acceptance: a stopped row with send intent that Dynamics accepted within 7 days becomes sent and finalized; older or intent-less stopped rows are untouched; nothing is sent', async () => {
    const recent = await seed({ set: { status: 'stopped', stopped_at: new Date(), dynamics_email_id: ACTIVITY, send_requested_at: new Date() } });
    const old = await seed({ set: { status: 'stopped', stopped_at: new Date(Date.now() - 8 * 86400000), dynamics_email_id: ACTIVITY, send_requested_at: new Date() } });
    const noIntent = await seed({ set: { status: 'stopped', stopped_at: new Date(), dynamics_email_id: ACTIVITY } });
    const listed = await store.listStoppedScheduledEmailsWithSendIntent({ days: 7 });
    expect(listed.map((r) => r.id)).toEqual([recent.id]);

    const d = deps({ getEmailActivity: jest.fn(async () => ({ activityid: ACTIVITY, statuscode: 3, statecode: 1 })) });
    expect((await service.reconcileStoppedScheduledEmail(listed[0], d)).sent).toBe(true);
    expect(await read(recent.id)).toMatchObject({ status: 'sent', stopped_at: expect.anything() });
    expect((await read(recent.id)).finalized_at).not.toBeNull();
    // The seven-day window and the send-intent requirement are enforced by the
    // query: the older row and the intent-less row were never listed, so the
    // pass never read them. The per-row guard refuses rows without intent.
    expect(await service.reconcileStoppedScheduledEmail(noIntent, d)).toEqual({ skipped: true });
    expect((await read(old.id)).status).toBe('stopped');
    expect((await read(noIntent.id)).status).toBe('stopped');
    expect(d.sendEmail).not.toHaveBeenCalled();

    // Not accepted → stopped wins.
    const pending = await seed({ set: { status: 'stopped', stopped_at: new Date(), dynamics_email_id: ACTIVITY, send_requested_at: new Date() } });
    const d2 = deps();
    expect(await service.reconcileStoppedScheduledEmail(pending, d2)).toMatchObject({ unresolved: true });
    expect((await read(pending.id)).status).toBe('stopped');
  });

  /* ----------------------------------- A3 ---------------------------------- */

  test.each([401, 408, 429, 500, 503, null])('A3: a stored-activity read error (%s) is a transient failure with no create and no correlation lookup', async (status) => {
    const row = await seed({ set: { dynamics_email_id: ACTIVITY } });
    const d = deps({ getEmailActivity: jest.fn(async () => { throw status ? httpError(status) : new Error('socket hang up'); }) });
    await expect(service.deliverScheduledEmail(row.id, {}, d)).rejects.toMatchObject({ code: 'scheduled_email_activity_read_failed', retryable: true });
    expect(d.createEmailActivity).not.toHaveBeenCalled();
    expect(d.findEmailByCorrelation).not.toHaveBeenCalled();
    expect(d.sendEmail).not.toHaveBeenCalled();
    const after = await read(row.id);
    expect(after).toMatchObject({ status: 'failed', last_error_code: 'scheduled_email_activity_read_failed', dynamics_email_id: ACTIVITY, lease_token: null });
    expect(attention.scheduledEmailAttentionReason(after)).toBeNull();
    // Still an ordinary candidate next run.
    expect((await store.listDueScheduledEmails()).map((r) => r.id)).toEqual([row.id]);
  });

  test('A3: 404 stores activity_missing; the row leaves automatic delivery and reconciliation and needs attention', async () => {
    const row = await seed({ set: { dynamics_email_id: ACTIVITY } });
    const d = deps({ getEmailActivity: jest.fn(async () => { throw httpError(404); }) });
    await expect(service.deliverScheduledEmail(row.id, {}, d)).rejects.toMatchObject({ code: MISSING, retryable: false });
    const after = await read(row.id);
    expect(after).toMatchObject({ status: 'failed', last_error_code: MISSING });
    expect(attention.scheduledEmailAttentionReason(after)).toBe('activity_missing');
    expect(await store.listDueScheduledEmails()).toEqual([]);
    expect(await store.listScheduledEmailReconciliationCandidates()).toEqual([]);
    expect(await store.claimScheduledEmailActivityRead(row.id)).toBeNull();
    expect(d.createEmailActivity).not.toHaveBeenCalled();
  });

  test('A3: 403 stores activity_forbidden, needs attention, and stays in the read-only retry lane; a later successful read clears it without creating or sending', async () => {
    const row = await seed({ set: { dynamics_email_id: ACTIVITY } });
    const d = deps({ getEmailActivity: jest.fn(async () => { throw httpError(403); }) });
    await expect(service.deliverScheduledEmail(row.id, {}, d)).rejects.toMatchObject({ code: FORBIDDEN, retryable: true });
    let after = await read(row.id);
    expect(after).toMatchObject({ status: 'failed', last_error_code: FORBIDDEN });
    expect(attention.scheduledEmailAttentionReason(after)).toBe('activity_forbidden');
    expect(await store.listDueScheduledEmails()).toEqual([]);
    const candidates = await store.listScheduledEmailReconciliationCandidates();
    expect(candidates.map((c) => c.id)).toEqual([row.id]);

    // Another 403: code retained, lease released, updated_at advanced (rotation).
    expect(await service.reconcileScheduledEmailCandidate(candidates[0], d)).toMatchObject({ unresolved: true, reason: FORBIDDEN });
    const again = await read(row.id);
    expect(again).toMatchObject({ status: 'failed', last_error_code: FORBIDDEN, lease_token: null });
    expect(new Date(again.updated_at).getTime()).toBeGreaterThan(new Date(after.updated_at).getTime());

    // 404 in the lane changes it to missing.
    const dMissing = deps({ getEmailActivity: jest.fn(async () => { throw httpError(404); }) });
    expect(await service.reconcileScheduledEmailCandidate(again, dMissing)).toMatchObject({ unresolved: true, reason: MISSING });
    expect((await read(row.id)).last_error_code).toBe(MISSING);

    // Reset to forbidden; a successful read clears the code and returns the row to ordinary eligibility.
    await mockPg.client.query('UPDATE scheduled_email_messages SET last_error_code = $2 WHERE id = $1', [row.id, FORBIDDEN]);
    const dOk = deps();
    expect(await service.reconcileScheduledEmailCandidate(await read(row.id), dOk)).toEqual({ cleared: true });
    after = await read(row.id);
    expect(after).toMatchObject({ status: 'scheduled', last_error_code: null, lease_token: null, dynamics_email_id: ACTIVITY, send_requested_at: null });
    expect(dOk.createEmailActivity).not.toHaveBeenCalled();
    expect(dOk.sendEmail).not.toHaveBeenCalled();
    expect((await store.listDueScheduledEmails()).map((r) => r.id)).toEqual([row.id]);

    // The next ordinary run requests its first send from the saved activity.
    const dSend = deps({ getDeliverable: jest.fn(async () => ({ _etag: 'x', wmkf_deliverablestatus: INVITED })) });
    dSend.getEmailActivity
      .mockResolvedValueOnce({ activityid: ACTIVITY, statuscode: 1, statecode: 0 })
      .mockResolvedValue({ activityid: ACTIVITY, statuscode: 3, statecode: 1 });
    expect((await service.deliverScheduledEmail(row.id, {}, dSend)).sent).toBe(true);
    expect(dSend.sendEmail).toHaveBeenCalledTimes(1);
    expect(dSend.createEmailActivity).not.toHaveBeenCalled();
  });

  test('A3 parity: the ordinary and reconciliation SQL agree with scheduledEmailAttentionReason on every code', async () => {
    const unconfirmed = await seed({ set: { status: 'failed', dynamics_email_id: ACTIVITY, send_requested_at: new Date(), last_error_code: UNCONFIRMED } });
    const missing = await seed({ set: { status: 'failed', dynamics_email_id: ACTIVITY, last_error_code: MISSING } });
    const forbidden = await seed({ set: { status: 'failed', dynamics_email_id: ACTIVITY, last_error_code: FORBIDDEN } });
    const ordinaryFailed = await seed({ set: { status: 'failed', last_error_code: 'scheduled_email_send_failed' } });
    const ordinary = await seed();
    const due = (await store.listDueScheduledEmails()).map((r) => r.id).sort();
    expect(due).toEqual([ordinaryFailed.id, ordinary.id].sort());
    const reconcile = (await store.listScheduledEmailReconciliationCandidates()).map((r) => r.id).sort();
    expect(reconcile).toEqual([unconfirmed.id, forbidden.id].sort());
    for (const r of [unconfirmed, missing, forbidden]) {
      expect(attention.scheduledEmailAttentionReason(r)).not.toBeNull();
      expect(due).not.toContain(r.id);
    }
    expect(missing.id).not.toEqual(expect.arrayContaining(reconcile));
    expect(attention.scheduledEmailAttentionReason(ordinaryFailed)).toBeNull();
  });

  /* ----------------------------------- A4 ---------------------------------- */

  test('A4: an edit or approval on a row with a Dynamics activity is refused and the row is unchanged', async () => {
    const row = await seed({ set: { dynamics_email_id: ACTIVITY } });
    const base = { id: row.id, pdSystemUserId: PD_A, profileId: 7, expectedVersion: row.version };
    expect(await store.updateScheduledEmailDraft({ ...base, subject: 'New', bodyText: 'New body text' })).toBeNull();
    expect(await store.approveScheduledEmail(base)).toBeNull();
    expect(await read(row.id)).toMatchObject({ subject: row.subject, version: row.version, approved_at: null });
    // Without an activity both succeed (no regression).
    const plain = await seed();
    expect(await store.approveScheduledEmail({ ...base, id: plain.id, expectedVersion: plain.version })).toMatchObject({ version: plain.version + 1 });
  });

  /* ----------------------------------- A5 ---------------------------------- */

  test('A5: a PD handoff resets the exact post-crash row atomically and the next claim creates generation 1 without recovering the generation-0 draft', async () => {
    const expired = new Date(Date.now() - 60000);
    const row = await seed({ set: { status: 'sending', lease_token: STALE_TOKEN, locked_until: expired, attempt_count: 2 } });
    expect(row).toMatchObject({ version: 1, recipient_generation: 0, dynamics_email_id: null, send_requested_at: null });
    const handoff = {
      workflowType: 'grantee_abstract_reminder',
      sourceRecordId: row.source_record_id,
      pdSystemUserId: PD_B,
      pdName: 'New PD',
      pdEmail: 'new@example.org',
      toRecipients: ['pi@example.edu'],
      ccRecipients: ['liaison@example.edu'],
      recipientName: 'Professor Reiter',
      recipientContactIds: [],
      subject: 'Rebuilt',
      bodyText: 'Rebuilt body text for the new PD.',
      signatureText: 'New PD',
      approvalRequired: false,
    };
    // Wrong version → no-op.
    expect(await store.reassignScheduledEmail({ ...handoff, expectedVersion: 5 })).toBeNull();
    // Live lease → no-op.
    await mockPg.client.query('UPDATE scheduled_email_messages SET locked_until = NOW() + interval \'5 minutes\' WHERE id = $1', [row.id]);
    expect(await store.reassignScheduledEmail({ ...handoff, expectedVersion: 1 })).toBeNull();
    await mockPg.client.query('UPDATE scheduled_email_messages SET locked_until = $2 WHERE id = $1', [row.id, expired]);

    const rebuilt = await store.reassignScheduledEmail({ ...handoff, expectedVersion: 1 });
    expect(rebuilt).toMatchObject({
      status: 'scheduled', pd_systemuser_id: PD_B, version: 2, recipient_generation: 1,
      lease_token: null, locked_until: null, attempt_count: 2, approved_at: null, last_error_code: null,
    });

    // A slow worker still holding the pre-reset token cannot write anything.
    const stale = { ...row, lease_token: STALE_TOKEN };
    expect(await store.recordScheduledEmailActivity(stale, ACTIVITY)).toBeNull();
    expect(await store.recordScheduledEmailSendRequested(stale)).toBeNull();
    expect(await store.recordScheduledEmailFailure(stale, new Error('late'))).toBeNull();
    expect(await read(row.id)).toMatchObject({ dynamics_email_id: null, send_requested_at: null, status: 'scheduled' });

    // Next delivery: the generation-1 key is used; a generation-0 draft is never consulted.
    const d = deps({ getDeliverable: jest.fn(async () => ({ _etag: 'x', wmkf_deliverablestatus: INVITED })) });
    d.findEmailByCorrelation.mockImplementation(async (key) => (key === `wmkf-scheduled-recipient:${row.id}` ? [{ activityid: 'old-draft' }] : []));
    d.getEmailActivity
      .mockResolvedValueOnce({ activityid: ACTIVITY, statuscode: 1, statecode: 0 })
      .mockResolvedValue({ activityid: ACTIVITY, statuscode: 3, statecode: 1 });
    expect((await service.deliverScheduledEmail(row.id, {}, d)).sent).toBe(true);
    expect(d.findEmailByCorrelation).toHaveBeenCalledWith(`wmkf-scheduled-recipient:${row.id}:g1`);
    expect(d.findEmailByCorrelation).not.toHaveBeenCalledWith(`wmkf-scheduled-recipient:${row.id}`);
    expect(d.createEmailActivity).toHaveBeenCalledWith(expect.objectContaining({ correlationKey: `wmkf-scheduled-recipient:${row.id}:g1`, subject: 'Rebuilt' }));
    expect((await read(row.id)).dynamics_email_id).toBe(ACTIVITY);
  });

  test('A5: a generation-0 row created before the migration still recovers by the original key', async () => {
    const row = await seed();
    expect(row.recipient_generation).toBe(0);
    const d = deps({ getDeliverable: jest.fn(async () => ({ _etag: 'x', wmkf_deliverablestatus: INVITED })) });
    d.findEmailByCorrelation.mockResolvedValue([{ activityid: ACTIVITY, statuscode: 3, statecode: 1 }]);
    d.getEmailActivity.mockResolvedValue({ activityid: ACTIVITY, statuscode: 3, statecode: 1 });
    expect((await service.deliverScheduledEmail(row.id, {}, d)).sent).toBe(true);
    expect(d.findEmailByCorrelation).toHaveBeenCalledWith(`wmkf-scheduled-recipient:${row.id}`);
    expect(d.createEmailActivity).not.toHaveBeenCalled();
    expect(d.sendEmail).not.toHaveBeenCalled();
  });

  /* ----------------------------------- A6 ---------------------------------- */

  test('A6: cancelForSource with a foreign lease is a no-op; without a token it requires no live lease', async () => {
    const claimed = await store.claimScheduledEmailSend((await seed()).id);
    expect(await store.cancelScheduledEmailForSource(claimed.id, 'source_no_longer_eligible', { leaseToken: STALE_TOKEN })).toBeNull();
    expect(await store.cancelScheduledEmailForSource(claimed.id)).toBeNull(); // live lease, no token
    expect((await read(claimed.id)).status).toBe('sending');
    expect(await store.cancelScheduledEmailForSource(claimed.id, 'source_no_longer_eligible', { leaseToken: claimed.lease_token })).toMatchObject({ status: 'stopped' });
    const free = await seed();
    expect(await store.cancelScheduledEmailForSource(free.id, 'test_request')).toMatchObject({ status: 'stopped', last_error_code: 'test_request' });
  });

  /* ----------------------------------- A7 ---------------------------------- */

  async function seedMany(count, set) {
    const ids = [];
    for (let i = 0; i < count; i++) {
      const r = await seed({ set: { ...set, updated_at: new Date(Date.now() - (count - i) * 60000) } });
      ids.push(r.id);
    }
    return ids;
  }

  test('A7 send-intent fairness: 120 unresolved intent rows cannot starve one ordinary due row; the 25-row lane rotates through every candidate', async () => {
    const intentIds = await seedMany(120, { status: 'failed', dynamics_email_id: ACTIVITY, send_requested_at: new Date(), last_error_code: UNCONFIRMED });
    const ordinary = await seed();
    expect((await store.listDueScheduledEmails({ limit: 100 })).map((r) => r.id)).toEqual([ordinary.id]);

    const d = deps();
    const seen = new Set();
    for (let run = 0; run < 5; run++) {
      const batch = await store.listScheduledEmailReconciliationCandidates({ limit: 25 });
      expect(batch.length).toBeLessThanOrEqual(25);
      const updated = batch.map((r) => new Date(r.updated_at).getTime());
      expect([...updated].sort((a, b) => a - b)).toEqual(updated);
      for (const row of batch) {
        expect(await service.reconcileScheduledEmailCandidate(row, d)).toMatchObject({ unresolved: true });
        seen.add(row.id);
      }
    }
    // Five runs of 25 reach all 120 before any row is recycled.
    expect(seen.size).toBe(120);
    expect(intentIds.every((id) => seen.has(id))).toBe(true);
    expect(d.sendEmail).not.toHaveBeenCalled();
    expect((await store.listDueScheduledEmails({ limit: 100 })).map((r) => r.id)).toEqual([ordinary.id]);
  }, 60000);

  test('A7 forbidden fairness: 120 forbidden rows retry 25 per run, repeated 403s rotate, and a later successful read only clears the code', async () => {
    const forbiddenIds = await seedMany(120, { status: 'failed', dynamics_email_id: ACTIVITY, last_error_code: FORBIDDEN });
    const ordinary = await seed();
    expect((await store.listDueScheduledEmails({ limit: 100 })).map((r) => r.id)).toEqual([ordinary.id]);
    const d403 = deps({ getEmailActivity: jest.fn(async () => { throw httpError(403); }) });
    const seen = new Set();
    for (let run = 0; run < 5; run++) {
      const batch = await store.listScheduledEmailReconciliationCandidates({ limit: 25 });
      expect(batch.length).toBeLessThanOrEqual(25);
      for (const row of batch) {
        expect(await service.reconcileScheduledEmailCandidate(row, d403)).toMatchObject({ unresolved: true, reason: FORBIDDEN });
        seen.add(row.id);
      }
    }
    expect(seen.size).toBe(120);
    expect(forbiddenIds.every((id) => seen.has(id))).toBe(true);
    expect(d403.createEmailActivity).not.toHaveBeenCalled();
    expect(d403.sendEmail).not.toHaveBeenCalled();

    const dOk = deps();
    const batch = await store.listScheduledEmailReconciliationCandidates({ limit: 25 });
    for (const row of batch) expect(await service.reconcileScheduledEmailCandidate(row, dOk)).toEqual({ cleared: true });
    expect(dOk.createEmailActivity).not.toHaveBeenCalled();
    expect(dOk.sendEmail).not.toHaveBeenCalled();
    const dueNow = (await store.listDueScheduledEmails({ limit: 200 })).map((r) => r.id);
    expect(dueNow).toHaveLength(26);
    for (const row of batch) expect(dueNow).toContain(row.id);
  }, 60000);

  test('A7 digest fairness: every PD is represented, no PD contributes more than the window, the overflowing PD is flagged, and only selected FYI ids are receipted', async () => {
    // One statement per PD (620 rows total): row-at-a-time seeding exceeded
    // jest's default timeout on the CI runner (S553).
    const seedPd = (pd, count, sent = false) => mockPg.client.query(
      `INSERT INTO scheduled_email_messages
         (id, workflow_type, source_record_id, request_id, deliverable_id, pd_systemuser_id, pd_name, pd_email,
          to_recipients, recipient_name, subject, body_text, signature_text, scheduled_send_at,
          status, dynamics_email_id, send_requested_at, sent_at)
       SELECT gen_random_uuid(), 'grantee_abstract_reminder', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
              $1::uuid, 'PD', 'pd@example.org', '["pi@example.edu"]'::jsonb, 'PI', 'Subject', 'Body text', 'Sig',
              TIMESTAMPTZ '2026-01-01T00:00:00Z' + (g * INTERVAL '1 hour'),
              $3, CASE WHEN $3 = 'sent' THEN $4::uuid END,
              CASE WHEN $3 = 'sent' THEN NOW() END, CASE WHEN $3 = 'sent' THEN NOW() END
         FROM generate_series(0, $2::int - 1) AS g`,
      [pd, count, sent ? 'sent' : 'scheduled', ACTIVITY],
    );
    await seedPd(PD_A, 120);
    await seedPd(PD_B, 300, true);
    await seedPd(PD_C, 200);
    const rows = await store.listScheduledEmailDigestRows({ perPdLimit: 100 });
    const groups = service.groupDigestRowsByPd(rows, { perPdLimit: 100 });
    const byPd = Object.fromEntries(groups.map((g) => [g.pdSystemUserId, g]));
    expect(Object.keys(byPd).sort()).toEqual([PD_A, PD_B, PD_C].sort());
    for (const g of groups) {
      const shown = g.approvalPending.length + g.upcoming.length + g.needsAttention.length + g.sentFyi.length;
      expect(shown).toBeLessThanOrEqual(100);
      expect(g.capped).toBe(g.total > 100);
    }
    expect(byPd[PD_A]).toMatchObject({ total: 120, capped: true });
    expect(byPd[PD_B]).toMatchObject({ total: 300, capped: true });
    expect(byPd[PD_B].sentFyi).toHaveLength(100);
    expect(byPd[PD_C]).toMatchObject({ total: 200, capped: true });
    // Oldest scheduled_send_at first within a PD.
    const times = byPd[PD_A].upcoming.map((r) => new Date(r.scheduled_send_at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // FYI receipts cover only the selected ids.
    const receipted = await store.markScheduledEmailsDigestFyi(byPd[PD_B].sentFyi.map((r) => r.id));
    expect(receipted).toBe(100);
    const remaining = await mockPg.client.query("SELECT COUNT(*)::int AS n FROM scheduled_email_messages WHERE status = 'sent' AND digest_fyi_at IS NULL");
    expect(remaining.rows[0].n).toBe(200);
  }, 60000);

  test('A2 digest grouping: an unconfirmed row is under Needs attention, never upcoming', async () => {
    await seed({ set: { status: 'failed', dynamics_email_id: ACTIVITY, send_requested_at: new Date(), last_error_code: UNCONFIRMED } });
    await seed({ set: { status: 'failed', dynamics_email_id: ACTIVITY, last_error_code: MISSING } });
    await seed();
    const groups = service.groupDigestRowsByPd(await store.listScheduledEmailDigestRows());
    expect(groups).toHaveLength(1);
    const group = groups.find((g) => g.pdSystemUserId === PD_A);
    expect(group.needsAttention).toHaveLength(2);
    expect(group.upcoming).toHaveLength(1);
    expect(group.approvalPending).toHaveLength(0);
  });
});
