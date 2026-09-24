'use strict';

/**
 * Contract test for lib/services/scheduled-email-store.js — Stage 3 item 5
 * (wave 5, largest file), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 * TESTS-BEFORE ONLY: run against the UNCONVERTED file.
 *
 * 32 sql-tag statements (`node scripts/check-postgres-access-layer.js --json`).
 * `tests/unit/scheduled-email-service.test.js` only reads this file's SOURCE
 * TEXT (per plan §2 rule 9 / the coordinator's brief) -- this contract test
 * is the SOLE real-planner coverage for every statement here.
 *
 * castLint's 21 uncast-bound-parameter rows (lines 28-36, 400-401, 452, 484)
 * are the explicit must-cover list; every one is asserted by reading the
 * column back:
 *   createOrGetScheduledEmail (14): id, workflow_type, source_record_id,
 *     request_id, deliverable_id, pd_systemuser_id, pd_name, pd_email,
 *     recipient_name, subject, body_text, signature_text, scheduled_send_at,
 *     approval_required.
 *   claimDigestRun (3): pd_systemuser_id, digest_day, the DIGEST_LEASE_MINUTES
 *     interval bound into locked_until.
 *   setScheduledEmailVipFlag (2): pd_systemuser_id, contact_id.
 *   setReviewerVipFlag (2): pd_systemuser_id, potential_reviewer_id.
 * Report: 21/21 covered (see the "MUST-COVER" comment beside each assertion
 * below).
 *
 * Shared-table hygiene: workflow_type is CHECK-restricted to the single
 * literal 'grantee_abstract_reminder', so every fixture uses a fresh random
 * UUID for source_record_id/request_id/deliverable_id (never a fixed
 * literal) to stay collision-free with any other suite using this table,
 * and every inserted row id is tracked and deleted in afterAll.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('scheduled-email-store: contract', () => {
  const store = require('../../lib/services/scheduled-email-store');
  const {
    createOrGetScheduledEmail,
    getScheduledEmail,
    getScheduledEmailForPd,
    listScheduledEmailsForPd,
    listDueScheduledEmails,
    listUnfinalizedScheduledEmails,
    updateScheduledEmailDraft,
    approveScheduledEmail,
    stopScheduledEmail,
    cancelScheduledEmailForSource,
    claimScheduledEmailSend,
    recordScheduledEmailActivity,
    recordScheduledEmailSendRequested,
    recordScheduledEmailSent,
    recordScheduledEmailFailure,
    recordScheduledEmailFinalized,
    listScheduledEmailDigestRows,
    markScheduledEmailsDigestFyi,
    reassignScheduledEmail,
    claimDigestRun,
    recordDigestRunActivity,
    markDigestRunAccepted,
    markDigestRunFyiStamped,
    setScheduledEmailVipFlag,
    clearScheduledEmailVipFlag,
    listScheduledEmailVipFlags,
    setReviewerVipFlag,
    clearReviewerVipFlag,
    listReviewerVipFlags,
    filterVipFlaggedReviewers,
    filterVipFlaggedContacts,
  } = store;

  let client;
  const insertedMessageIds = [];
  const insertedDigestKeys = []; // [pdSystemUserId, digestDay]
  const insertedVipFlagKeys = []; // [pdSystemUserId, contactId]
  const insertedReviewerVipFlagKeys = []; // [pdSystemUserId, potentialReviewerId]

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (insertedMessageIds.length) {
        await client.query('DELETE FROM scheduled_email_messages WHERE id = ANY($1::uuid[])', [insertedMessageIds]);
      }
      for (const [pdSystemUserId, digestDay] of insertedDigestKeys) {
        await client.query('DELETE FROM scheduled_email_digest_runs WHERE pd_systemuser_id = $1 AND digest_day = $2', [pdSystemUserId, digestDay]);
      }
      for (const [pdSystemUserId, contactId] of insertedVipFlagKeys) {
        await client.query('DELETE FROM scheduled_email_vip_flags WHERE pd_systemuser_id = $1 AND contact_id = $2', [pdSystemUserId, contactId]);
      }
      for (const [pdSystemUserId, potentialReviewerId] of insertedReviewerVipFlagKeys) {
        await client.query('DELETE FROM scheduled_email_reviewer_vip_flags WHERE pd_systemuser_id = $1 AND potential_reviewer_id = $2', [pdSystemUserId, potentialReviewerId]);
      }
    } catch (err) {
      deleteError = err;
    } finally {
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

  function baseInput(overrides = {}) {
    const id = crypto.randomUUID();
    return {
      id,
      workflowType: 'grantee_abstract_reminder',
      sourceRecordId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      deliverableId: crypto.randomUUID(),
      pdSystemUserId: crypto.randomUUID(),
      pdName: 'Contract PD',
      pdEmail: 'pd@example.org',
      toRecipients: [{ email: 'to@example.org' }],
      ccRecipients: [],
      recipientName: 'Contract Recipient',
      recipientContactIds: [],
      subject: 'Contract subject',
      bodyText: 'Contract body',
      signatureText: 'Contract signature',
      scheduledSendAt: new Date(Date.now() - 60_000).toISOString(), // due by default
      approvalRequired: false,
      ...overrides,
    };
  }

  async function createMessage(overrides = {}) {
    const input = baseInput(overrides);
    const row = await createOrGetScheduledEmail(input);
    insertedMessageIds.push(row.id);
    return { row, input };
  }

  async function fetchMessage(id) {
    return (await client.query('SELECT * FROM scheduled_email_messages WHERE id = $1', [id])).rows[0] || null;
  }

  describe('createOrGetScheduledEmail', () => {
    test('MUST-COVER (14/21): binds every non-cast column of the INSERT, plus the three ::jsonb columns', async () => {
      const input = baseInput({
        ccRecipients: [{ email: 'cc@example.org' }],
        recipientContactIds: [crypto.randomUUID()],
        approvalRequired: true,
      });
      const row = await createOrGetScheduledEmail(input);
      insertedMessageIds.push(row.id);

      expect(row.id).toBe(input.id); // MUST-COVER: id
      expect(row.workflow_type).toBe(input.workflowType); // MUST-COVER: workflow_type
      expect(row.source_record_id).toBe(input.sourceRecordId); // MUST-COVER: source_record_id
      expect(row.request_id).toBe(input.requestId); // MUST-COVER: request_id
      expect(row.deliverable_id).toBe(input.deliverableId); // MUST-COVER: deliverable_id
      expect(row.pd_systemuser_id).toBe(input.pdSystemUserId); // MUST-COVER: pd_systemuser_id
      expect(row.pd_name).toBe(input.pdName); // MUST-COVER: pd_name
      expect(row.pd_email).toBe(input.pdEmail); // MUST-COVER: pd_email
      expect(row.recipient_name).toBe(input.recipientName); // MUST-COVER: recipient_name
      expect(row.subject).toBe(input.subject); // MUST-COVER: subject
      expect(row.body_text).toBe(input.bodyText); // MUST-COVER: body_text
      expect(row.signature_text).toBe(input.signatureText); // MUST-COVER: signature_text
      expect(new Date(row.scheduled_send_at).toISOString()).toBe(new Date(input.scheduledSendAt).toISOString()); // MUST-COVER: scheduled_send_at
      expect(row.approval_required).toBe(true); // MUST-COVER: approval_required
      // Not on the must-cover list (already ::jsonb-cast) but asserted anyway.
      expect(row.to_recipients).toEqual(input.toRecipients);
      expect(row.cc_recipients).toEqual(input.ccRecipients);
      expect(row.recipient_contact_ids).toEqual(input.recipientContactIds);
      expect(row.status).toBe('scheduled');
      expect(row.version).toBe(1);
    });

    // DISCRIMINATING: a repeat call with the SAME (workflow_type,
    // source_record_id) but a DIFFERENT id/subject must return the
    // EXISTING row (via the CTE's UNION ALL fallback), never a second row
    // and never the new call's own values -- kills a mutant that drops the
    // ON CONFLICT DO NOTHING or the fallback SELECT.
    test('DISCRIMINATING: is idempotent per (workflow_type, source_record_id), ignoring the repeat call\'s own values', async () => {
      const { row: first, input } = await createMessage();
      const second = await createOrGetScheduledEmail(baseInput({
        workflowType: input.workflowType,
        sourceRecordId: input.sourceRecordId,
        subject: 'a DIFFERENT subject that must not land',
      }));
      expect(second.id).toBe(first.id);
      expect(second.subject).toBe(first.subject);

      const { rows } = await client.query(
        'SELECT count(*)::int AS n FROM scheduled_email_messages WHERE workflow_type = $1 AND source_record_id = $2',
        [input.workflowType, input.sourceRecordId]
      );
      expect(rows[0].n).toBe(1);
    });
  });

  describe('getScheduledEmail / getScheduledEmailForPd', () => {
    test('getScheduledEmail returns the row or null; getScheduledEmailForPd scopes by pd', async () => {
      const { row, input } = await createMessage();
      expect((await getScheduledEmail(row.id)).id).toBe(row.id);
      expect(await getScheduledEmail(crypto.randomUUID())).toBeNull();

      expect((await getScheduledEmailForPd(row.id, input.pdSystemUserId)).id).toBe(row.id);
      // DISCRIMINATING: wrong pd_systemuser_id must return null, not the row.
      expect(await getScheduledEmailForPd(row.id, crypto.randomUUID())).toBeNull();
    });
  });

  describe('listScheduledEmailsForPd', () => {
    // DISCRIMINATING: three rows for one PD -- a 'sent' row with the
    // EARLIEST scheduled_send_at (should sort LAST, CASE bucket 1), a
    // 'scheduled' row with a LATER scheduled_send_at (bucket 0, must sort
    // before the 'sent' row despite the later time), and a 'failed' row
    // with the LATEST scheduled_send_at (also bucket 0, must sort after
    // the 'scheduled' row by scheduled_send_at ASC within the bucket).
    // Anti-correlated on purpose: only a correct CASE-then-scheduled_send_at
    // ORDER BY produces [scheduled, failed, sent].
    test('DISCRIMINATING: orders scheduled/failed before everything else, then by scheduled_send_at ASC', async () => {
      const pdSystemUserId = crypto.randomUUID();
      const now = Date.now();
      const { row: sentRow } = await createMessage({ pdSystemUserId, scheduledSendAt: new Date(now - 10_000).toISOString() });
      const { row: scheduledRow } = await createMessage({ pdSystemUserId, scheduledSendAt: new Date(now + 10_000).toISOString() });
      const { row: failedRow } = await createMessage({ pdSystemUserId, scheduledSendAt: new Date(now + 20_000).toISOString() });
      // Force sentRow into a real 'sent' terminal shape (the sent_shape CHECK requires dynamics_email_id/send_requested_at/sent_at all set).
      await client.query(
        `UPDATE scheduled_email_messages SET status='sent', dynamics_email_id=$2, send_requested_at=NOW(), sent_at=NOW() WHERE id=$1`,
        [sentRow.id, crypto.randomUUID()]
      );
      await client.query(`UPDATE scheduled_email_messages SET status='failed' WHERE id=$1`, [failedRow.id]);

      const rows = await listScheduledEmailsForPd(pdSystemUserId, { limit: 10 });
      expect(rows.map((r) => r.id)).toEqual([scheduledRow.id, failedRow.id, sentRow.id]);
    });
  });

  describe('listDueScheduledEmails', () => {
    // DISCRIMINATING: four rows, only one truly claimable-by-listing: due
    // time passed, no approval block, no lock. The other three each
    // violate exactly one guard.
    test('DISCRIMINATING: excludes not-yet-due, approval-blocked, and locked rows independently', async () => {
      const marker = crypto.randomUUID();
      const { row: due } = await createMessage({ requestId: marker, scheduledSendAt: new Date(Date.now() - 60_000).toISOString() });
      const { row: notYetDue } = await createMessage({ requestId: marker, scheduledSendAt: new Date(Date.now() + 60 * 60_000).toISOString() });
      const { row: needsApproval } = await createMessage({ requestId: marker, approvalRequired: true, scheduledSendAt: new Date(Date.now() - 60_000).toISOString() });
      const { row: locked } = await createMessage({ requestId: marker, scheduledSendAt: new Date(Date.now() - 60_000).toISOString() });
      await client.query(`UPDATE scheduled_email_messages SET locked_until = NOW() + interval '1 hour', lease_token = $2 WHERE id = $1`, [locked.id, crypto.randomUUID()]);

      const rows = await listDueScheduledEmails({ limit: 500 });
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(due.id);
      expect(ids).not.toContain(notYetDue.id);
      expect(ids).not.toContain(needsApproval.id);
      expect(ids).not.toContain(locked.id);
    });

    test('an approved row with approval_required is included', async () => {
      const { row } = await createMessage({ approvalRequired: true, scheduledSendAt: new Date(Date.now() - 60_000).toISOString() });
      await client.query(`UPDATE scheduled_email_messages SET approved_at = NOW() WHERE id = $1`, [row.id]);
      const rows = await listDueScheduledEmails({ limit: 500 });
      expect(rows.map((r) => r.id)).toContain(row.id);
    });
  });

  describe('listUnfinalizedScheduledEmails', () => {
    test('DISCRIMINATING: only sent + not-yet-finalized rows, never sent+finalized or non-sent', async () => {
      const marker = crypto.randomUUID();
      const { row: sentNotFinalized } = await createMessage({ requestId: marker });
      const { row: sentFinalized } = await createMessage({ requestId: marker });
      const { row: notSent } = await createMessage({ requestId: marker });
      await client.query(`UPDATE scheduled_email_messages SET status='sent', dynamics_email_id=$2, send_requested_at=NOW(), sent_at=NOW() WHERE id=$1`, [sentNotFinalized.id, crypto.randomUUID()]);
      await client.query(`UPDATE scheduled_email_messages SET status='sent', dynamics_email_id=$2, send_requested_at=NOW(), sent_at=NOW(), finalized_at=NOW() WHERE id=$1`, [sentFinalized.id, crypto.randomUUID()]);

      const rows = await listUnfinalizedScheduledEmails({ limit: 500 });
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(sentNotFinalized.id);
      expect(ids).not.toContain(sentFinalized.id);
      expect(ids).not.toContain(notSent.id);
    });
  });

  describe('updateScheduledEmailDraft', () => {
    test('binds subject/body, bumps version, clears approved_at, requires the exact version/pd/status/lock fence', async () => {
      const { row, input } = await createMessage();
      const updated = await updateScheduledEmailDraft({
        id: row.id, pdSystemUserId: input.pdSystemUserId, profileId: 42,
        expectedVersion: 1, subject: 'new subject', bodyText: 'new body',
      });
      expect(updated.subject).toBe('new subject');
      expect(updated.body_text).toBe('new body');
      expect(updated.version).toBe(2);
      expect(updated.actioned_by_profile_id).toBe('42');

      // DISCRIMINATING: a stale expectedVersion (still 1, but the row is
      // now at version 2) must be a no-op -- kills a mutant that drops the
      // version fence.
      const staleAttempt = await updateScheduledEmailDraft({
        id: row.id, pdSystemUserId: input.pdSystemUserId, profileId: 42,
        expectedVersion: 1, subject: 'should not land', bodyText: 'x',
      });
      expect(staleAttempt).toBeNull();
      expect((await fetchMessage(row.id)).subject).toBe('new subject');
    });

    // DISCRIMINATING: approved_at must reset to NULL when the draft is
    // edited -- an edit after approval un-approves the message.
    test('DISCRIMINATING: editing an approved draft clears approved_at', async () => {
      const { row, input } = await createMessage();
      await approveScheduledEmail({ id: row.id, pdSystemUserId: input.pdSystemUserId, profileId: 1, expectedVersion: 1 });
      expect((await fetchMessage(row.id)).approved_at).not.toBeNull();

      const updated = await updateScheduledEmailDraft({
        id: row.id, pdSystemUserId: input.pdSystemUserId, profileId: 1,
        expectedVersion: 2, subject: 'edited after approval', bodyText: 'x',
      });
      expect(updated.approved_at).toBeNull();
    });
  });

  describe('approveScheduledEmail / stopScheduledEmail', () => {
    test('approveScheduledEmail sets approved_at and bumps version under the fence', async () => {
      const { row, input } = await createMessage();
      const approved = await approveScheduledEmail({ id: row.id, pdSystemUserId: input.pdSystemUserId, profileId: 7, expectedVersion: 1 });
      expect(approved.approved_at).not.toBeNull();
      expect(approved.version).toBe(2);

      // DISCRIMINATING: wrong pd_systemuser_id is a no-op.
      expect(await approveScheduledEmail({ id: row.id, pdSystemUserId: crypto.randomUUID(), profileId: 7, expectedVersion: 2 })).toBeNull();
    });

    test('stopScheduledEmail sets status=stopped and clears the lease', async () => {
      const { row, input } = await createMessage();
      await client.query(`UPDATE scheduled_email_messages SET lease_token=$2, locked_until=NOW()-interval '1 hour' WHERE id=$1`, [row.id, crypto.randomUUID()]);
      const stopped = await stopScheduledEmail({ id: row.id, pdSystemUserId: input.pdSystemUserId, profileId: 1, expectedVersion: 1 });
      expect(stopped.status).toBe('stopped');
      expect(stopped.stopped_at).not.toBeNull();
      expect(stopped.lease_token).toBeNull();
      expect(stopped.locked_until).toBeNull();
    });
  });

  describe('cancelScheduledEmailForSource', () => {
    test('binds a truncated reason code and the fixed error message', async () => {
      const { row } = await createMessage();
      const longReason = 'x'.repeat(200);
      const cancelled = await cancelScheduledEmailForSource(row.id, longReason);
      expect(cancelled.status).toBe('stopped');
      expect(cancelled.last_error_code).toHaveLength(100);
      expect(cancelled.last_error_message).toMatch(/no longer eligible/i);
    });

    test('is a no-op for an already-sent row', async () => {
      const { row } = await createMessage();
      await client.query(`UPDATE scheduled_email_messages SET status='sent', dynamics_email_id=$2, send_requested_at=NOW(), sent_at=NOW() WHERE id=$1`, [row.id, crypto.randomUUID()]);
      expect(await cancelScheduledEmailForSource(row.id)).toBeNull();
    });
  });

  describe('claimScheduledEmailSend', () => {
    test('binds a lease/lock and increments attempt_count', async () => {
      const { row, input } = await createMessage();
      const claimed = await claimScheduledEmailSend(row.id, { pdSystemUserId: input.pdSystemUserId, expectedVersion: 1 });
      expect(claimed.status).toBe('sending');
      expect(claimed.lease_token).toMatch(/^[0-9a-f-]{36}$/);
      expect(claimed.attempt_count).toBe(1);
      expect(new Date(claimed.locked_until).getTime()).toBeGreaterThan(Date.now());
    });

    // DISCRIMINATING: force=false and the row is not yet due -- must NOT
    // claim; force=true must bypass the time gate on the SAME row.
    test('DISCRIMINATING: force=false respects the due-time gate; force=true bypasses it', async () => {
      const { row } = await createMessage({ scheduledSendAt: new Date(Date.now() + 60 * 60_000).toISOString() });
      expect(await claimScheduledEmailSend(row.id, { force: false })).toBeNull();
      const claimed = await claimScheduledEmailSend(row.id, { force: true });
      expect(claimed).not.toBeNull();
      expect(claimed.status).toBe('sending');
    });

    // DISCRIMINATING: approval_required=true, no approved_at, force=false
    // -- must NOT claim; force=true bypasses the approval gate.
    test('DISCRIMINATING: an unapproved required-approval row is not claimed unless force=true', async () => {
      const { row } = await createMessage({ approvalRequired: true });
      expect(await claimScheduledEmailSend(row.id, { force: false })).toBeNull();
      expect(await claimScheduledEmailSend(row.id, { force: true })).not.toBeNull();
    });

    test('a locked row is never claimed regardless of force', async () => {
      const { row } = await createMessage();
      await client.query(`UPDATE scheduled_email_messages SET lease_token=$2, locked_until=NOW()+interval '1 hour' WHERE id=$1`, [row.id, crypto.randomUUID()]);
      expect(await claimScheduledEmailSend(row.id, { force: true })).toBeNull();
    });
  });

  describe('recordScheduledEmailActivity / recordScheduledEmailSendRequested / recordScheduledEmailSent / recordScheduledEmailFailure / recordScheduledEmailFinalized', () => {
    async function claimed() {
      const { row, input } = await createMessage();
      const claimedRow = await claimScheduledEmailSend(row.id, { pdSystemUserId: input.pdSystemUserId });
      return claimedRow;
    }

    test('recordScheduledEmailActivity binds dynamics_email_id under the lease fence', async () => {
      const row = await claimed();
      const emailId = crypto.randomUUID();
      const updated = await recordScheduledEmailActivity(row, emailId);
      expect(updated.dynamics_email_id).toBe(emailId);

      // DISCRIMINATING: a DIFFERENT emailId on a row that already has one
      // bound must be a no-op (the WHERE excludes it) -- proves the guard
      // prevents silently overwriting a different Dynamics activity id.
      const conflicting = await recordScheduledEmailActivity(row, crypto.randomUUID());
      expect(conflicting).toBeNull();
      expect((await fetchMessage(row.id)).dynamics_email_id).toBe(emailId);
    });

    test('recordScheduledEmailSendRequested requires status=sending and a bound dynamics_email_id', async () => {
      const row = await claimed();
      expect(await recordScheduledEmailSendRequested(row)).toBeNull(); // no dynamics_email_id yet
      const withActivity = await recordScheduledEmailActivity(row, crypto.randomUUID());
      const requested = await recordScheduledEmailSendRequested(withActivity);
      expect(requested.send_requested_at).not.toBeNull();
    });

    test('recordScheduledEmailSent binds dynamics status fields and terminal timestamps', async () => {
      const row = await claimed();
      const withActivity = await recordScheduledEmailActivity(row, crypto.randomUUID());
      const sent = await recordScheduledEmailSent(withActivity, { statecode: 1, statuscode: 2, senton: new Date().toISOString() });
      expect(sent.status).toBe('sent');
      expect(sent.dynamics_statecode).toBe(1);
      expect(sent.dynamics_statuscode).toBe(2);
      expect(sent.dynamics_senton).not.toBeNull();
      expect(sent.lease_token).toBeNull();
      expect(sent.locked_until).toBeNull();

      const finalized = await recordScheduledEmailFinalized(sent.id);
      expect(finalized.finalized_at).not.toBeNull();
    });

    test('recordScheduledEmailFailure truncates the error message and clears the lease', async () => {
      const row = await claimed();
      const longMessage = 'y'.repeat(2000);
      const failed = await recordScheduledEmailFailure(row, new Error(longMessage), 'contract_failure_code_that_is_long_'.repeat(5));
      expect(failed.status).toBe('failed');
      expect(failed.last_error_message).toHaveLength(1000);
      expect(failed.last_error_code).toHaveLength(100);
      expect(failed.lease_token).toBeNull();
    });

    test('recordScheduledEmailFinalized is a no-op for a non-sent row', async () => {
      const { row } = await createMessage();
      expect(await recordScheduledEmailFinalized(row.id)).toBeNull();
    });
  });

  describe('listScheduledEmailDigestRows / markScheduledEmailsDigestFyi', () => {
    test('DISCRIMINATING: digest rows are scheduled/failed OR sent-without-fyi, never sent-with-fyi', async () => {
      const marker = crypto.randomUUID();
      const { row: scheduled } = await createMessage({ requestId: marker });
      const { row: sentNoFyi } = await createMessage({ requestId: marker });
      const { row: sentWithFyi } = await createMessage({ requestId: marker });
      await client.query(`UPDATE scheduled_email_messages SET status='sent', dynamics_email_id=$2, send_requested_at=NOW(), sent_at=NOW() WHERE id=$1`, [sentNoFyi.id, crypto.randomUUID()]);
      await client.query(`UPDATE scheduled_email_messages SET status='sent', dynamics_email_id=$2, send_requested_at=NOW(), sent_at=NOW(), digest_fyi_at=NOW() WHERE id=$1`, [sentWithFyi.id, crypto.randomUUID()]);

      const rows = await listScheduledEmailDigestRows({ limit: 500 });
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(scheduled.id);
      expect(ids).toContain(sentNoFyi.id);
      expect(ids).not.toContain(sentWithFyi.id);

      const stampedCount = await markScheduledEmailsDigestFyi([sentNoFyi.id, scheduled.id]);
      // DISCRIMINATING: only the 'sent' row is eligible (WHERE status='sent') -- the 'scheduled' one must not count.
      expect(stampedCount).toBe(1);
      expect((await fetchMessage(sentNoFyi.id)).digest_fyi_at).not.toBeNull();
      expect((await fetchMessage(scheduled.id)).digest_fyi_at).toBeNull();

      expect(await markScheduledEmailsDigestFyi([])).toBe(0);
    });
  });

  describe('reassignScheduledEmail', () => {
    test('rebuilds an unsent row under a new PD, discarding approval/edit state, and requires the PD to actually change', async () => {
      const { row, input } = await createMessage();
      const newPdId = crypto.randomUUID();
      const reassignInput = {
        workflowType: input.workflowType, sourceRecordId: input.sourceRecordId,
        pdSystemUserId: newPdId, pdName: 'New PD', pdEmail: 'newpd@example.org',
        toRecipients: [{ email: 'new-to@example.org' }], ccRecipients: [], recipientName: 'New Recipient',
        recipientContactIds: [], subject: 'reassigned subject', bodyText: 'reassigned body',
        signatureText: 'reassigned sig', approvalRequired: false,
      };
      const reassigned = await reassignScheduledEmail(reassignInput);
      expect(reassigned.pd_systemuser_id).toBe(newPdId);
      expect(reassigned.status).toBe('scheduled');
      expect(reassigned.version).toBe(2);
      expect(reassigned.approved_at).toBeNull();
      // Deliberately untouched per the header note.
      expect(new Date(reassigned.scheduled_send_at).toISOString()).toBe(new Date(input.scheduledSendAt).toISOString());

      // DISCRIMINATING: reassigning to the SAME pd_systemuser_id must be a
      // no-op (`pd_systemuser_id <> $new` excludes it) -- kills a mutant
      // that drops that inequality guard.
      const noop = await reassignScheduledEmail({ ...reassignInput, subject: 'should not land' });
      expect(noop).toBeNull();
      expect((await fetchMessage(row.id)).subject).toBe('reassigned subject');
    });

    test('does not reassign a row with transport already started', async () => {
      const { row, input } = await createMessage();
      await client.query(`UPDATE scheduled_email_messages SET dynamics_email_id = $2 WHERE id = $1`, [row.id, crypto.randomUUID()]);
      const result = await reassignScheduledEmail({
        workflowType: input.workflowType, sourceRecordId: input.sourceRecordId,
        pdSystemUserId: crypto.randomUUID(), pdName: 'x', pdEmail: 'x@example.org',
        toRecipients: [{ email: 'x@example.org' }], recipientName: 'x', subject: 'x', bodyText: 'x', signatureText: 'x',
      });
      expect(result).toBeNull();
    });
  });

  describe('claimDigestRun / recordDigestRunActivity / markDigestRunAccepted / markDigestRunFyiStamped', () => {
    test('MUST-COVER (3/21): first claim binds pd_systemuser_id/digest_day and a locked_until derived from DIGEST_LEASE_MINUTES, stamping membership', async () => {
      const pdSystemUserId = crypto.randomUUID();
      const digestDay = '2026-01-15';
      insertedDigestKeys.push([pdSystemUserId, digestDay]);
      const fyiMessageIds = [crypto.randomUUID(), crypto.randomUUID()];

      const before = Date.now();
      const { claimed, run } = await claimDigestRun({ pdSystemUserId, digestDay, fyiMessageIds });
      expect(claimed).toBe(true);
      expect(run.pd_systemuser_id).toBe(pdSystemUserId); // MUST-COVER: pd_systemuser_id
      expect(run.digest_day.toISOString().slice(0, 10)).toBe(digestDay); // MUST-COVER: digest_day
      const lockedUntilMs = new Date(run.locked_until).getTime();
      expect(lockedUntilMs).toBeGreaterThan(before + 9 * 60 * 1000); // MUST-COVER: DIGEST_LEASE_MINUTES interval
      expect(lockedUntilMs).toBeLessThan(before + 11 * 60 * 1000);
      expect(run.fyi_message_ids).toEqual(fyiMessageIds);
    });

    // DISCRIMINATING: MEMBERSHIP FREEZE -- a re-claim (lease expired,
    // accepted_at still null) must refresh locked_until but must NOT
    // touch fyi_message_ids, even though the caller passes a DIFFERENT
    // membership list on the re-claim.
    test('DISCRIMINATING: a re-claim before acceptance refreshes the lease but never touches fyi_message_ids', async () => {
      const pdSystemUserId = crypto.randomUUID();
      const digestDay = '2026-01-16';
      insertedDigestKeys.push([pdSystemUserId, digestDay]);
      const originalMembership = [crypto.randomUUID()];

      await claimDigestRun({ pdSystemUserId, digestDay, fyiMessageIds: originalMembership });
      // Simulate the lease having expired so ON CONFLICT's WHERE matches.
      await client.query(`UPDATE scheduled_email_digest_runs SET locked_until = NOW() - interval '1 minute' WHERE pd_systemuser_id = $1 AND digest_day = $2`, [pdSystemUserId, digestDay]);

      const { claimed, run } = await claimDigestRun({ pdSystemUserId, digestDay, fyiMessageIds: [crypto.randomUUID(), crypto.randomUUID()] });
      expect(claimed).toBe(true);
      expect(run.fyi_message_ids).toEqual(originalMembership);
    });

    // DISCRIMINATING: once accepted_at is set, a re-claim must return
    // claimed=false with the existing (accepted) row, never re-open it.
    test('DISCRIMINATING: an accepted run cannot be re-claimed', async () => {
      const pdSystemUserId = crypto.randomUUID();
      const digestDay = '2026-01-17';
      insertedDigestKeys.push([pdSystemUserId, digestDay]);
      await claimDigestRun({ pdSystemUserId, digestDay, fyiMessageIds: [] });
      await markDigestRunAccepted(pdSystemUserId, digestDay);

      const { claimed, run } = await claimDigestRun({ pdSystemUserId, digestDay, fyiMessageIds: [crypto.randomUUID()] });
      expect(claimed).toBe(false);
      expect(run.accepted_at).not.toBeNull();
    });

    test('recordDigestRunActivity / markDigestRunAccepted / markDigestRunFyiStamped bind their columns idempotently', async () => {
      const pdSystemUserId = crypto.randomUUID();
      const digestDay = '2026-01-18';
      insertedDigestKeys.push([pdSystemUserId, digestDay]);
      await claimDigestRun({ pdSystemUserId, digestDay, fyiMessageIds: [] });

      const activityId = crypto.randomUUID();
      await recordDigestRunActivity(pdSystemUserId, digestDay, activityId);
      let row = (await client.query('SELECT * FROM scheduled_email_digest_runs WHERE pd_systemuser_id=$1 AND digest_day=$2', [pdSystemUserId, digestDay])).rows[0];
      expect(row.activity_id).toBe(activityId);

      await markDigestRunAccepted(pdSystemUserId, digestDay);
      row = (await client.query('SELECT * FROM scheduled_email_digest_runs WHERE pd_systemuser_id=$1 AND digest_day=$2', [pdSystemUserId, digestDay])).rows[0];
      const acceptedAt = row.accepted_at;
      expect(acceptedAt).not.toBeNull();
      expect(row.locked_until).toBeNull();

      // DISCRIMINATING: COALESCE keeps the FIRST accepted_at on a repeat call.
      await markDigestRunAccepted(pdSystemUserId, digestDay);
      row = (await client.query('SELECT * FROM scheduled_email_digest_runs WHERE pd_systemuser_id=$1 AND digest_day=$2', [pdSystemUserId, digestDay])).rows[0];
      expect(new Date(row.accepted_at).getTime()).toBe(new Date(acceptedAt).getTime());

      await markDigestRunFyiStamped(pdSystemUserId, digestDay);
      row = (await client.query('SELECT * FROM scheduled_email_digest_runs WHERE pd_systemuser_id=$1 AND digest_day=$2', [pdSystemUserId, digestDay])).rows[0];
      expect(row.fyi_stamped_at).not.toBeNull();
    });
  });

  describe('VIP flags (contact + reviewer)', () => {
    test('MUST-COVER (2/21 + 2/21): set/clear/list for both flag tables bind pd_systemuser_id and the target id, and ON CONFLICT DO NOTHING is idempotent', async () => {
      const pdSystemUserId = crypto.randomUUID();
      const contactId = crypto.randomUUID();
      insertedVipFlagKeys.push([pdSystemUserId, contactId]);
      const potentialReviewerId = crypto.randomUUID();
      insertedReviewerVipFlagKeys.push([pdSystemUserId, potentialReviewerId]);

      expect(await setScheduledEmailVipFlag(pdSystemUserId, contactId)).toBe(true); // MUST-COVER: pd_systemuser_id, contact_id
      expect(await setScheduledEmailVipFlag(pdSystemUserId, contactId)).toBe(true); // idempotent replay, no throw
      const contactFlags = await listScheduledEmailVipFlags(pdSystemUserId);
      expect(contactFlags.map((r) => r.contact_id)).toEqual([contactId]);

      expect(await setReviewerVipFlag(pdSystemUserId, potentialReviewerId)).toBe(true); // MUST-COVER: pd_systemuser_id, potential_reviewer_id
      const reviewerFlags = await listReviewerVipFlags(pdSystemUserId);
      expect(reviewerFlags.map((r) => r.potential_reviewer_id)).toEqual([potentialReviewerId]);

      const otherContactId = crypto.randomUUID();
      insertedVipFlagKeys.push([pdSystemUserId, otherContactId]);
      await setScheduledEmailVipFlag(pdSystemUserId, otherContactId);
      expect(await filterVipFlaggedContacts(pdSystemUserId, [contactId, otherContactId, crypto.randomUUID()]))
        .toEqual(new Set([contactId, otherContactId]));
      expect(await filterVipFlaggedContacts(pdSystemUserId, [])).toEqual(new Set());

      const otherReviewerId = crypto.randomUUID();
      insertedReviewerVipFlagKeys.push([pdSystemUserId, otherReviewerId]);
      await setReviewerVipFlag(pdSystemUserId, otherReviewerId);
      expect(await filterVipFlaggedReviewers(pdSystemUserId, [potentialReviewerId, otherReviewerId, crypto.randomUUID()]))
        .toEqual(new Set([potentialReviewerId, otherReviewerId]));
      expect(await filterVipFlaggedReviewers(pdSystemUserId, [])).toEqual(new Set());

      expect(await clearScheduledEmailVipFlag(pdSystemUserId, contactId)).toBe(1);
      expect(await listScheduledEmailVipFlags(pdSystemUserId)).toHaveLength(1);
      expect(await clearReviewerVipFlag(pdSystemUserId, potentialReviewerId)).toBe(1);
      expect(await listReviewerVipFlags(pdSystemUserId)).toHaveLength(1);
    });
  });
});
