'use strict';

/**
 * Contract test for lib/services/pre-site-visit/distribution-store.js —
 * Stage 3 item 3 (wave 3, slice B),
 * docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 *
 * tests/unit/pre-site-distribution-store.test.js already exercises
 * recordDistributionSource/recordDistributionPrepared against a mocked
 * `sql`; per plan §2 rule 9 this contract test supplements it by running
 * every exported function against a real database.
 *
 * Must-cover (per `node scripts/check-postgres-access-layer.js --json` →
 * castLint filtered to this file): 22 rows, all on
 * createOrGetDistributionAttempt's INSERT VALUES (lines 26-40). Every
 * bound column there is asserted in the "kitchen sink" test below,
 * including the ones only reachable with calendar_enabled=true and a
 * stale-inputs delta (site_visit_id/etag/snapshot, calendar_*,
 * input_fingerprint_generated/live, stale_inputs_delta/acknowledged_at/by).
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { withClient } = require('../../lib/postgres/client');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('pre-site-visit/distribution-store: contract', () => {
  const store = require('../../lib/services/pre-site-visit/distribution-store');

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
        await client.query('DELETE FROM pre_site_distribution_attempts WHERE operation_id = ANY($1::uuid[])', [insertedOperationIds]);
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

  function hex(seed) {
    return crypto.createHash('sha256').update(seed).digest('hex');
  }

  function baseInput(overrides = {}) {
    const operationId = crypto.randomUUID();
    insertedOperationIds.push(operationId);
    return {
      operationId,
      requestId: crypto.randomUUID(),
      sourceDocumentId: crypto.randomUUID(),
      attachmentMode: 'docx',
      toRecipients: [{ email: 'pd@example.org' }],
      ccRecipients: [],
      subject: 'Pre-site materials',
      bodyText: 'plain body',
      bodyHtml: '<p>html body</p>',
      fromEmail: 'noreply@example.org',
      actingUserSystemId: crypto.randomUUID(),
      draftHash: hex(`draft-${operationId}`),
      templateVersion: 'v1',
      calendarEnabled: false,
      ...overrides,
    };
  }

  async function readAttempt(operationId) {
    const { rows } = await client.query('SELECT * FROM pre_site_distribution_attempts WHERE operation_id = $1', [operationId]);
    return rows[0];
  }

  // pre_site_distribution_prepared_shape requires every source_*/docx_*
  // field to be non-null once state <> 'preparing' (attachment_mode='docx'
  // in baseInput() means pdf_* stays exempt) -- raw fixtures that jump
  // straight to a later state must fill all of them, not just the ones the
  // exported function under test happens to touch, to satisfy the real
  // planner's CHECK the same way the real prepare flow would.
  async function markSentDirectly(operationId, emailId) {
    await client.query(
      `UPDATE pre_site_distribution_attempts
          SET source_drive_id = 'd', source_item_id = 'i', source_version_id = '1.0',
              source_content_hash = 'gdc1:x', source_byte_hash = $2,
              docx_snapshot_document_id = $4, docx_drive_id = 'd', docx_item_id = 'i',
              docx_version_id = '1.0', docx_filename = 'x.docx', docx_content_type = 'application/x',
              docx_byte_hash = $2, docx_size = 1, preview_hash = $2,
              state = 'sent', dynamics_email_id = $3, send_requested_at = NOW(), sent_at = NOW(),
              lease_token = NULL, locked_until = NULL
        WHERE operation_id = $1`,
      [operationId, hex(`marksent-${operationId}`), emailId, crypto.randomUUID()]
    );
  }

  describe('createOrGetDistributionAttempt', () => {
    test('kitchen sink: binds every column of the INSERT, including calendar and stale-inputs fields', async () => {
      const input = baseInput({
        calendarEnabled: true,
        siteVisitId: crypto.randomUUID(),
        siteVisitEtag: 'etag-1',
        siteVisitSnapshot: { location: 'Site A' },
        sessionSnapshot: { userAgent: 'contract-test' },
        materialLinks: [{ url: 'https://example.org/a' }],
        calendar: { filename: 'invite.ics', contentType: 'text/calendar', byteHash: hex('cal'), size: 512 },
        inputFingerprintGenerated: hex('generated'),
        inputFingerprintLive: hex('live'),
        staleInputsDelta: { changed: ['budget'] },
        staleInputsAcknowledgedAt: new Date().toISOString(),
        staleInputsAcknowledgedBy: crypto.randomUUID(),
      });

      const row = await store.createOrGetDistributionAttempt(input);
      expect(row.operation_id).toBe(input.operationId);
      expect(row.request_id).toBe(input.requestId);
      expect(row.source_document_id).toBe(input.sourceDocumentId);
      expect(row.attachment_mode).toBe('docx');
      expect(row.to_recipients).toEqual(input.toRecipients);
      expect(row.cc_recipients).toEqual(input.ccRecipients);
      expect(row.subject).toBe(input.subject);
      expect(row.body_text).toBe(input.bodyText);
      expect(row.body_html).toBe(input.bodyHtml);
      expect(row.from_email).toBe(input.fromEmail);
      expect(row.acting_user_system_id).toBe(input.actingUserSystemId);
      expect(row.draft_hash).toBe(input.draftHash);
      expect(row.template_version).toBe(input.templateVersion);
      expect(row.calendar_enabled).toBe(true);
      expect(row.site_visit_id).toBe(input.siteVisitId);
      expect(row.site_visit_etag).toBe(input.siteVisitEtag);
      expect(row.site_visit_snapshot).toEqual(input.siteVisitSnapshot);
      expect(row.session_snapshot).toEqual(input.sessionSnapshot);
      expect(row.material_links).toEqual(input.materialLinks);
      expect(row.calendar_filename).toBe(input.calendar.filename);
      expect(row.calendar_content_type).toBe(input.calendar.contentType);
      expect(row.calendar_byte_hash).toBe(input.calendar.byteHash);
      expect(Number(row.calendar_size)).toBe(input.calendar.size);
      expect(row.input_fingerprint_generated).toBe(input.inputFingerprintGenerated);
      expect(row.input_fingerprint_live).toBe(input.inputFingerprintLive);
      expect(row.stale_inputs_delta).toEqual(input.staleInputsDelta);
      expect(new Date(row.stale_inputs_acknowledged_at).toISOString()).toBe(input.staleInputsAcknowledgedAt);
      expect(row.stale_inputs_acknowledged_by).toBe(input.staleInputsAcknowledgedBy);
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: ON CONFLICT (operation_id) DO NOTHING + the UNION ALL
    // fallback SELECT must return the ORIGINAL row's subject on a second
    // call with a different subject -- a mutant that dropped ON CONFLICT
    // (or the fallback SELECT) would either throw a duplicate-key error or
    // return the second call's subject instead.
    test('DISCRIMINATING: a second call with the same operationId is idempotent and returns the original row', async () => {
      const input = baseInput();
      const first = await store.createOrGetDistributionAttempt(input);
      expect(first.subject).toBe(input.subject);

      const second = await store.createOrGetDistributionAttempt({ ...input, subject: 'a different subject' });
      expect(second.operation_id).toBe(input.operationId);
      expect(second.subject).toBe(input.subject);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('getDistributionAttempt / listDistributionAttempts / hasSentAttemptForSource / sentSourceDocumentIds / getLatestSentAttempt', () => {
    test('getDistributionAttempt finds by operation_id, null when absent', async () => {
      const input = baseInput();
      await store.createOrGetDistributionAttempt(input);
      const found = await store.getDistributionAttempt(input.operationId);
      expect(found.operation_id).toBe(input.operationId);
      expect(await store.getDistributionAttempt(crypto.randomUUID())).toBeNull();
    });

    test('listDistributionAttempts orders by created_at DESC and clamps the limit', async () => {
      const requestId = crypto.randomUUID();
      const older = baseInput({ requestId });
      await store.createOrGetDistributionAttempt(older);
      await client.query(`UPDATE pre_site_distribution_attempts SET created_at = NOW() - INTERVAL '1 hour' WHERE operation_id = $1`, [older.operationId]);
      const newer = baseInput({ requestId });
      await store.createOrGetDistributionAttempt(newer);

      const rows = await store.listDistributionAttempts(requestId, { limit: 500 });
      expect(rows.map((r) => r.operation_id)).toEqual([newer.operationId, older.operationId]);
    });

    test('hasSentAttemptForSource is true only once state = sent for that exact source document', async () => {
      const input = baseInput();
      await store.createOrGetDistributionAttempt(input);
      expect(await store.hasSentAttemptForSource(input.requestId, input.sourceDocumentId)).toBe(false);

      await markSentDirectly(input.operationId, crypto.randomUUID());
      expect(await store.hasSentAttemptForSource(input.requestId, input.sourceDocumentId)).toBe(true);
      // A different source document on the same request must not be promoted.
      expect(await store.hasSentAttemptForSource(input.requestId, crypto.randomUUID())).toBe(false);
    });

    test('sentSourceDocumentIds batches the same EXISTS semantics and returns [] for an empty input', async () => {
      expect(await store.sentSourceDocumentIds([])).toEqual(new Set());
      expect(await store.sentSourceDocumentIds(null)).toEqual(new Set());

      const sentInput = baseInput();
      await store.createOrGetDistributionAttempt(sentInput);
      await markSentDirectly(sentInput.operationId, crypto.randomUUID());
      const unsentInput = baseInput();
      await store.createOrGetDistributionAttempt(unsentInput);

      const result = await store.sentSourceDocumentIds([sentInput.sourceDocumentId, unsentInput.sourceDocumentId]);
      expect(result.has(sentInput.sourceDocumentId.toLowerCase())).toBe(true);
      expect(result.has(unsentInput.sourceDocumentId.toLowerCase())).toBe(false);
    });

    // DISCRIMINATING: ORDER BY sent_at DESC NULLS LAST, send_requested_at DESC
    // -- a row with sent_at set must outrank a more-recently-created row
    // whose sent_at is NULL, killing a mutant that orders by created_at or
    // drops NULLS LAST (which would otherwise put NULL sent_at first).
    test('getLatestSentAttempt prefers the row with sent_at set even if created earlier', async () => {
      const requestId = crypto.randomUUID();
      const sentInput = baseInput({ requestId });
      await store.createOrGetDistributionAttempt(sentInput);
      await client.query(`UPDATE pre_site_distribution_attempts SET created_at = NOW() - INTERVAL '1 hour' WHERE operation_id = $1`, [sentInput.operationId]);
      await markSentDirectly(sentInput.operationId, crypto.randomUUID());
      await client.query(
        `UPDATE pre_site_distribution_attempts
            SET send_requested_at = NOW() - INTERVAL '50 minutes', sent_at = NOW() - INTERVAL '50 minutes'
          WHERE operation_id = $1`,
        [sentInput.operationId]
      );

      const unsentButNewer = baseInput({ requestId });
      await store.createOrGetDistributionAttempt(unsentButNewer);

      const latest = await store.getLatestSentAttempt(requestId);
      expect(latest.operation_id).toBe(sentInput.operationId);
    });
  });

  describe('full lifecycle: source -> prepared -> claim -> email activity -> send requested -> renew -> sent, plus review bundle rebuild', () => {
    test('walks every state transition with real fences', async () => {
      const input = baseInput({ attachmentMode: 'docx' });
      await store.createOrGetDistributionAttempt(input);

      const source = {
        driveId: 'drive-a', itemId: 'item-a', versionId: '1.0',
        contentHash: 'gdc1:governed-a', byteHash: hex('source-bytes'), filename: 'Staff Brief.docx',
      };
      const sourced = await store.recordDistributionSource(input.operationId, source);
      expect(sourced.source_drive_id).toBe(source.driveId);
      expect(sourced.source_byte_hash).toBe(source.byteHash);

      // DISCRIMINATING: a second recordDistributionSource with a DIFFERENT
      // content hash must be rejected (kills a mutant that drops the
      // "already recorded, must match" OR-branch of the WHERE clause).
      const rejected = await store.recordDistributionSource(input.operationId, { ...source, contentHash: 'gdc1:different', byteHash: hex('other') });
      expect(rejected).toBeNull();

      const prepared = await store.recordDistributionPrepared(input.operationId, {
        source,
        docx: {
          documentId: crypto.randomUUID(), driveId: 'd', itemId: 'i', versionId: '1.0',
          webUrl: null, filename: 'x.docx', contentType: 'application/x', byteHash: hex('docx'), size: 100,
        },
        pdf: null,
        // Seed the initial review bundle at prepare time (real usage:
        // recordReviewBundleRebuilt's CAS compares against the row's
        // CURRENT fingerprint with `=`, which never matches a NULL column,
        // so a first bundle can only ever be seeded here, never via
        // recordReviewBundleRebuilt with a null expectedPriorFingerprint).
        reviewBundle: {
          documentId: crypto.randomUUID(), driveId: 'd', itemId: 'i', versionId: '1.0',
          filename: 'bundle0.pdf', size: 9, byteHash: hex('bundle-0'), setFingerprint: hex('fp-0'), reviewCount: 1,
        },
        previewHash: hex('preview'),
      });
      expect(prepared.state).toBe('prepared');
      expect(prepared.preview_hash).toBe(hex('preview'));
      expect(prepared.review_bundle_set_fingerprint).toBe(hex('fp-0'));
      await assertNoOpenTransactionAnywhere();

      // DISCRIMINATING: a mismatched source identity must not finalize --
      // kills a mutant that drops the source_byte_hash fence (Codex AR-3).
      const preparedAgainWrongSource = await store.recordDistributionPrepared(input.operationId, {
        source: { ...source, byteHash: hex('wrong') },
        docx: { documentId: crypto.randomUUID(), driveId: 'd', itemId: 'i', versionId: '1.0', webUrl: null, filename: 'x.docx', contentType: 'application/x', byteHash: hex('docx'), size: 100 },
        pdf: null,
        previewHash: hex('preview-2'),
      });
      expect(preparedAgainWrongSource).toBeNull();

      const claimed = await store.claimDistributionSend(input.operationId, { lockSeconds: 60 });
      expect(claimed.lease_token).toEqual(expect.any(String));
      expect(claimed.attempt_count).toBe(1);

      // DISCRIMINATING: a second claim attempt while the lease is still live
      // must fail -- kills a mutant that drops the locked_until fence.
      const blockedClaim = await store.claimDistributionSend(input.operationId, { lockSeconds: 60 });
      expect(blockedClaim).toBeNull();

      const emailId = crypto.randomUUID();
      const activity = await store.recordDistributionEmailActivity(claimed, emailId);
      expect(activity.dynamics_email_id).toBe(emailId);
      expect(activity.state).toBe('activity_created');

      // DISCRIMINATING: COALESCE keeps the FIRST dynamics_email_id, and a
      // call with a MISMATCHED id is rejected outright (returns null) --
      // together these kill a mutant that drops the
      // "NULL OR equals emailId" fence and lets any id overwrite it.
      const activitySameId = await store.recordDistributionEmailActivity(claimed, emailId);
      expect(activitySameId.dynamics_email_id).toBe(emailId);
      const activityMismatch = await store.recordDistributionEmailActivity(claimed, crypto.randomUUID());
      expect(activityMismatch).toBeNull();

      const attached = await store.recordDistributionAttachment(claimed, 'docx');
      expect(attached.docx_attached_at).not.toBeNull();
      expect(attached.state).toBe('attachments_added');

      const sendRequested = await store.recordDistributionSendRequested(claimed);
      expect(sendRequested.state).toBe('send_requested');
      expect(sendRequested.send_requested_at).not.toBeNull();

      const renewed = await store.renewDistributionSendLease(claimed, { lockSeconds: 120 });
      expect(new Date(renewed.locked_until).getTime()).toBeGreaterThan(new Date(sendRequested.locked_until).getTime());

      const sent = await store.recordDistributionSent(claimed, { statecode: 0, statuscode: 2, senton: new Date().toISOString() });
      expect(sent.state).toBe('sent');
      expect(sent.lease_token).toBeNull();
      expect(sent.dynamics_statecode).toBe(0);
      expect(sent.dynamics_statuscode).toBe(2);

      const rebuilt = await store.recordReviewBundleRebuilt(input.operationId, {
        documentId: crypto.randomUUID(), driveId: 'd', itemId: 'i', versionId: '1.0',
        filename: 'bundle.pdf', size: 10, byteHash: hex('bundle-1'), setFingerprint: hex('fp-1'), reviewCount: 2,
      }, hex('fp-0'));
      expect(rebuilt.review_bundle_set_fingerprint).toBe(hex('fp-1'));

      // DISCRIMINATING: compare-and-swap on expectedPriorFingerprint -- a
      // STALE expected value (fp-0, already superseded by fp-1 above) must
      // fail (kills a mutant that drops the CAS clause and always
      // overwrites).
      const staleRebuild = await store.recordReviewBundleRebuilt(input.operationId, {
        documentId: crypto.randomUUID(), driveId: 'd', itemId: 'i', versionId: '1.0',
        filename: 'bundle2.pdf', size: 11, byteHash: hex('bundle-2'), setFingerprint: hex('fp-2'), reviewCount: 3,
      }, hex('fp-0'));
      expect(staleRebuild).toBeNull();

      const freshRebuild = await store.recordReviewBundleRebuilt(input.operationId, {
        documentId: crypto.randomUUID(), driveId: 'd', itemId: 'i', versionId: '1.0',
        filename: 'bundle2.pdf', size: 11, byteHash: hex('bundle-2'), setFingerprint: hex('fp-2'), reviewCount: 3,
      }, hex('fp-1'));
      expect(freshRebuild.review_bundle_set_fingerprint).toBe(hex('fp-2'));
      await assertNoOpenTransactionAnywhere();

      const briefingLinked = await store.recordDistributionBriefingLink(input.operationId, crypto.randomUUID());
      // recordDistributionBriefingLink only applies to state = 'preparing';
      // this attempt is already 'sent', so it must be a no-op (null).
      expect(briefingLinked).toBeNull();
    });
  });

  describe('recordDistributionAttachment: calendar branch', () => {
    test('calendar attach requires calendar_enabled and only completes attachments_added once docx is also attached', async () => {
      const input = baseInput({
        attachmentMode: 'docx',
        calendarEnabled: true,
        siteVisitId: crypto.randomUUID(),
        siteVisitEtag: 'etag-cal',
        siteVisitSnapshot: { location: 'Site B' },
        calendar: { filename: 'invite.ics', contentType: 'text/calendar', byteHash: hex('cal-2'), size: 256 },
      });
      await store.createOrGetDistributionAttempt(input);
      const source = { driveId: 'd', itemId: 'i', versionId: '1.0', contentHash: 'gdc1:c', byteHash: hex('cal-src'), filename: 'x.docx' };
      await store.recordDistributionSource(input.operationId, source);
      await store.recordDistributionPrepared(input.operationId, {
        source,
        docx: { documentId: crypto.randomUUID(), driveId: 'd', itemId: 'i', versionId: '1.0', webUrl: null, filename: 'x.docx', contentType: 'application/x', byteHash: hex('cal-docx'), size: 1 },
        pdf: null,
        // recordDistributionPrepared re-affirms the calendar snapshot from
        // its OWN `prepared.calendar` input, not the row's existing
        // calendar_* columns -- omitting it here would null them out and
        // trip pre_site_distribution_calendar_shape.
        calendar: input.calendar,
        previewHash: hex('cal-preview'),
      });
      const claimed = await store.claimDistributionSend(input.operationId);

      // DISCRIMINATING: calendar attach alone (docx not yet attached) must
      // NOT flip state to attachments_added for attachment_mode='docx' --
      // kills a mutant that drops the docx_attached_at condition from the
      // calendar branch's CASE.
      const calendarFirst = await store.recordDistributionAttachment(claimed, 'calendar');
      expect(calendarFirst.calendar_attached_at).not.toBeNull();
      expect(calendarFirst.state).not.toBe('attachments_added');

      const docxAttached = await store.recordDistributionAttachment(claimed, 'docx');
      expect(docxAttached.docx_attached_at).not.toBeNull();
      expect(docxAttached.state).toBe('attachments_added');
    });
  });

  describe('recordDistributionFailure', () => {
    test('clears the lease and stamps a truncated error message', async () => {
      const input = baseInput();
      await store.createOrGetDistributionAttempt(input);
      const claimed = await store.claimDistributionSend(input.operationId);

      const longMessage = 'x'.repeat(2000);
      const failed = await store.recordDistributionFailure(claimed, new Error(longMessage), 'transport_error');
      expect(failed.lease_token).toBeNull();
      expect(failed.locked_until).toBeNull();
      expect(failed.last_error_code).toBe('transport_error');
      expect(failed.last_error_message.length).toBe(1000);
      expect(failed.last_failed_at).not.toBeNull();
    });
  });

  describe('recordDistributionBriefingLink', () => {
    test('binds the briefing link only while state = preparing', async () => {
      const input = baseInput();
      await store.createOrGetDistributionAttempt(input);
      const briefingLinkId = crypto.randomUUID();
      const row = await store.recordDistributionBriefingLink(input.operationId, briefingLinkId);
      expect(row.briefing_link_id).toBe(briefingLinkId);
    });
  });
});
