'use strict';

/**
 * Contract test for lib/services/portal-upload-staging.js — Stage 3 item 3
 * (wave 3, slice B), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 *
 * This file has existing unit tests (tests/unit/portal-upload-staging.test.js
 * and siblings) that mock @vercel/postgres and @vercel/blob at the module
 * boundary, so per plan §2 rule 9 this contract test supplements them by
 * running every Postgres-touching export against a real database. Every
 * Blob-touching call (`get`, `del`, `generateClientTokenFromReadWriteToken`)
 * is mocked here — CLAUDE.md forbids a test reaching a real Blob store, and
 * doing so is unnecessary: the contract under test is the Postgres
 * statements, not Blob I/O.
 *
 * Must-cover (per `node scripts/check-postgres-access-layer.js --json` →
 * castLint filtered to this file): 10 rows, all on createPortalUpload's
 * INSERT VALUES at lines 157/158 — every bound column is asserted below,
 * including the two which the fixture deliberately makes non-null/non-default
 * (original_etag, max_bytes) so a dropped or swapped binding fails.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { withClient } = require('../../lib/postgres/client');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

jest.mock('@vercel/blob', () => ({
  del: jest.fn(),
  get: jest.fn(),
}));
jest.mock('@vercel/blob/client', () => ({
  generateClientTokenFromReadWriteToken: jest.fn(),
}));

const { del, get } = require('@vercel/blob');
const { generateClientTokenFromReadWriteToken } = require('@vercel/blob/client');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('portal-upload-staging: contract', () => {
  const store = require('../../lib/services/portal-upload-staging');

  let client;
  const insertedStagingIds = [];
  const insertedUserProfileIds = [];
  const insertedConsultantFeedbackIds = [];
  const realFetch = global.fetch;

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.UPLOADS_BLOB_RW_TOKEN = 'vercel_blob_rw_test_private';
    generateClientTokenFromReadWriteToken.mockResolvedValue('scoped-client-token');
    del.mockResolvedValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
  });

  afterAll(async () => {
    global.fetch = realFetch;
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (insertedConsultantFeedbackIds.length) {
        await client.query('DELETE FROM consultant_feedback WHERE id = ANY($1::bigint[])', [insertedConsultantFeedbackIds]);
      }
      if (insertedStagingIds.length) {
        await client.query('DELETE FROM portal_upload_staging WHERE id = ANY($1::uuid[])', [insertedStagingIds]);
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

  async function insertUserProfile() {
    const name = `portal_upload_contract_${crypto.randomBytes(6).toString('hex')}`;
    const { rows } = await client.query(
      `INSERT INTO user_profiles (name) VALUES ($1) RETURNING id`,
      [name]
    );
    insertedUserProfileIds.push(rows[0].id);
    return rows[0].id;
  }

  async function readStagingRow(id) {
    const { rows } = await client.query('SELECT * FROM portal_upload_staging WHERE id = $1', [id]);
    return rows[0];
  }

  describe('createPortalUpload', () => {
    test('binds every column of the INSERT, including a real original_etag and a distinguishing max_bytes', async () => {
      const resourceId = crypto.randomUUID();
      const result = await store.createPortalUpload({
        scope: store.PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE,
        resourceId,
        actorBinding: 'grantee:contract-hash',
        filename: 'Contract Figure.png',
        contentType: 'image/png',
        maxBytes: 7654321,
        originalEtag: 'W/"contract-etag"',
      });
      insertedStagingIds.push(result.stagingId);

      const row = await readStagingRow(result.stagingId);
      expect(row.id).toBe(result.stagingId);
      expect(row.scope).toBe('grantee_image');
      expect(row.resource_id).toBe(resourceId);
      expect(row.actor_binding).toBe('grantee:contract-hash');
      expect(row.pathname).toBe(`portal-staging/grantee_image/${resourceId}/${result.stagingId}`);
      expect(row.filename).toBe('Contract Figure.png');
      expect(row.declared_content_type).toBe('image/png');
      expect(Number(row.max_bytes)).toBe(7654321);
      expect(row.original_etag).toBe('W/"contract-etag"');
      expect(row.expires_at).toBeInstanceOf(Date);
      expect(row.status).toBe('pending');
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('claimPortalUpload / releasePortalUpload / recordPortalUploadCandidate / completePortalUpload', () => {
    async function mint(overrides = {}) {
      const resourceId = crypto.randomUUID();
      const result = await store.createPortalUpload({
        scope: store.PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE,
        resourceId,
        actorBinding: 'grantee:claim-flow',
        filename: 'claim-flow.png',
        contentType: 'image/png',
        maxBytes: 1000,
        ...overrides,
      });
      insertedStagingIds.push(result.stagingId);
      return { resourceId, ...result };
    }

    test('claim -> record candidate -> release -> re-claim -> complete deletes the Blob object', async () => {
      const { resourceId, stagingId } = await mint();
      const claimed = await store.claimPortalUpload({
        stagingId, scope: store.PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE, resourceId, actorBinding: 'grantee:claim-flow',
      });
      expect(claimed.state).toBe('claimed');
      await assertNoOpenTransactionAnywhere();

      await store.recordPortalUploadCandidate({
        stagingId, leaseToken: claimed.leaseToken, candidate: { imageRef: 'ref-1' },
      });
      const withCandidate = await readStagingRow(stagingId);
      expect(withCandidate.candidate_result).toEqual({ imageRef: 'ref-1' });

      await store.releasePortalUpload({ stagingId, leaseToken: claimed.leaseToken });
      const released = await readStagingRow(stagingId);
      expect(released.status).toBe('pending');
      expect(released.lease_token).toBeNull();

      const reclaimed = await store.claimPortalUpload({
        stagingId, scope: store.PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE, resourceId, actorBinding: 'grantee:claim-flow',
      });
      expect(reclaimed.state).toBe('claimed');

      const payload = await store.completePortalUpload({
        stagingId, leaseToken: reclaimed.leaseToken, resultCode: 'ok', resultPayload: { done: true },
      });
      expect(payload).toEqual({ done: true });
      expect(del).toHaveBeenCalledWith(withCandidate.pathname, { token: 'vercel_blob_rw_test_private' });
      const completedRow = await readStagingRow(stagingId);
      expect(completedRow.status).toBe('consumed');
      expect(completedRow.result_code).toBe('ok');
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: a consumed row's claim attempt must short-circuit to
    // the durable stored result rather than re-running the UPDATE's WHERE
    // clause and returning a fresh 404/409 — kills a mutant that drops the
    // `status === 'consumed'` branch in the SELECT fallback.
    test('DISCRIMINATING: claiming an already-consumed row returns the durable result, not an error', async () => {
      const { resourceId, stagingId } = await mint();
      const claimed = await store.claimPortalUpload({
        stagingId, scope: store.PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE, resourceId, actorBinding: 'grantee:claim-flow',
      });
      await store.completePortalUpload({
        stagingId, leaseToken: claimed.leaseToken, resultCode: 'ok', resultPayload: { already: true },
      });

      const again = await store.claimPortalUpload({
        stagingId, scope: store.PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE, resourceId, actorBinding: 'grantee:claim-flow',
      });
      expect(again.state).toBe('consumed');
      expect(again.result).toEqual({ already: true });
      await assertNoOpenTransactionAnywhere();
    });

    test('a nonexistent ownership tuple throws staging_not_found (404)', async () => {
      await expect(store.claimPortalUpload({
        stagingId: crypto.randomUUID(),
        scope: store.PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE,
        resourceId: crypto.randomUUID(),
        actorBinding: 'grantee:nobody',
      })).rejects.toMatchObject({ code: 'staging_not_found', httpStatus: 404 });
      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: an already-expired-but-not-yet-marked row must be
    // flipped to 'expired' by the UPDATE inside claimPortalUpload's SELECT
    // fallback branch before the throw — kills a mutant that throws
    // staging_expired without ever issuing that UPDATE.
    test('DISCRIMINATING: a claim past expires_at marks the row expired in the same call and throws 410', async () => {
      const { resourceId, stagingId } = await mint();
      await client.query(`UPDATE portal_upload_staging SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [stagingId]);

      await expect(store.claimPortalUpload({
        stagingId, scope: store.PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE, resourceId, actorBinding: 'grantee:claim-flow',
      })).rejects.toMatchObject({ code: 'staging_expired', httpStatus: 410 });

      const row = await readStagingRow(stagingId);
      expect(row.status).toBe('expired');
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('rejectPortalUpload', () => {
    test('marks the row rejected, clears the lease, and deletes the Blob object', async () => {
      const resourceId = crypto.randomUUID();
      const minted = await store.createPortalUpload({
        scope: store.PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE,
        resourceId, actorBinding: 'grantee:reject-flow', filename: 'reject.png',
        contentType: 'image/png', maxBytes: 500,
      });
      insertedStagingIds.push(minted.stagingId);
      const claimed = await store.claimPortalUpload({
        stagingId: minted.stagingId, scope: store.PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE, resourceId, actorBinding: 'grantee:reject-flow',
      });

      await store.rejectPortalUpload({ stagingId: minted.stagingId, leaseToken: claimed.leaseToken, resultCode: 'image_too_large' });

      expect(del).toHaveBeenCalledWith(minted.pathname, { token: 'vercel_blob_rw_test_private' });
      const row = await readStagingRow(minted.stagingId);
      expect(row.status).toBe('rejected');
      expect(row.result_code).toBe('image_too_large');
      expect(row.lease_token).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('clearPortalUploadCandidate', () => {
    test('nulls candidate_result on the leased row', async () => {
      const resourceId = crypto.randomUUID();
      const minted = await store.createPortalUpload({
        scope: store.PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE,
        resourceId, actorBinding: 'grantee:clear-flow', filename: 'clear.png',
        contentType: 'image/png', maxBytes: 500,
      });
      insertedStagingIds.push(minted.stagingId);
      const claimed = await store.claimPortalUpload({
        stagingId: minted.stagingId, scope: store.PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE, resourceId, actorBinding: 'grantee:clear-flow',
      });
      await store.recordPortalUploadCandidate({ stagingId: minted.stagingId, leaseToken: claimed.leaseToken, candidate: { imageRef: 'x' } });

      await store.clearPortalUploadCandidate({ stagingId: minted.stagingId, leaseToken: claimed.leaseToken });

      const row = await readStagingRow(minted.stagingId);
      expect(row.candidate_result).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('loadClaimedPortalImage', () => {
    test('verifies the fetched Blob against the row and records blob_etag/sha256/actual_bytes', async () => {
      const resourceId = crypto.randomUUID();
      const buffer = Buffer.from('contract-image-bytes');
      const minted = await store.createPortalUpload({
        scope: store.PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE,
        resourceId, actorBinding: 'grantee:load-flow', filename: 'load.png',
        contentType: 'image/png', maxBytes: buffer.length + 10,
      });
      insertedStagingIds.push(minted.stagingId);
      const claimed = await store.claimPortalUpload({
        stagingId: minted.stagingId, scope: store.PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE, resourceId, actorBinding: 'grantee:load-flow',
      });

      get.mockResolvedValue({
        statusCode: 200,
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(buffer);
            controller.close();
          },
        }),
        blob: { pathname: minted.pathname, contentType: 'image/png', size: buffer.length, url: 'https://blob.example/private-object', etag: 'blob-etag-1' },
      });

      const loaded = await store.loadClaimedPortalImage({ row: claimed.row, leaseToken: claimed.leaseToken });
      expect(loaded.sha256).toBe(crypto.createHash('sha256').update(buffer).digest('hex'));
      expect(loaded.blobEtag).toBe('blob-etag-1');

      const row = await readStagingRow(minted.stagingId);
      expect(row.blob_etag).toBe('blob-etag-1');
      expect(row.sha256).toBe(loaded.sha256);
      expect(Number(row.actual_bytes)).toBe(buffer.length);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('DEFAULT_CLEANUP_DEPENDENCIES.isConsultantFeedbackBound', () => {
    test('true iff a consultant_feedback row references the registry id', async () => {
      const userProfileId = await insertUserProfile();
      const requestdocumentId = crypto.randomUUID();
      const { rows } = await client.query(
        `INSERT INTO consultant_feedback (request_id, one_off_name, body_html, received_on, requestdocument_id, mutation_id, created_by, updated_by)
         VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, $6) RETURNING id`,
        [crypto.randomUUID(), 'Contract Reviewer', '<p>feedback</p>', requestdocumentId, crypto.randomUUID(), userProfileId]
      );
      insertedConsultantFeedbackIds.push(rows[0].id);

      const bound = await store.DEFAULT_CLEANUP_DEPENDENCIES.isConsultantFeedbackBound(requestdocumentId);
      expect(bound).toBe(true);

      const unbound = await store.DEFAULT_CLEANUP_DEPENDENCIES.isConsultantFeedbackBound(crypto.randomUUID());
      expect(unbound).toBe(false);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('cleanupExpiredPortalUploads', () => {
    test('deletes the Blob object for an expired row, marks it expired, and prunes old terminal rows', async () => {
      const resourceId = crypto.randomUUID();
      const expiredMint = await store.createPortalUpload({
        scope: store.PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE,
        resourceId, actorBinding: 'grantee:cleanup-flow', filename: 'cleanup.png',
        contentType: 'image/png', maxBytes: 500,
      });
      insertedStagingIds.push(expiredMint.stagingId);
      await client.query(`UPDATE portal_upload_staging SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [expiredMint.stagingId]);

      // A second row, already terminal and genuinely old (10 days), must be
      // pruned by the default retentionDays=7 DELETE below, while the row
      // freshly marked 'expired' in THIS run (updated_at = NOW()) must
      // survive it -- kills a mutant that drops the prune query, or its
      // status/candidate_result/updated_at filter, or that prunes
      // everything regardless of age.
      const pruneMint = await store.createPortalUpload({
        scope: store.PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE,
        resourceId, actorBinding: 'grantee:cleanup-flow', filename: 'prune.png',
        contentType: 'image/png', maxBytes: 500,
      });
      insertedStagingIds.push(pruneMint.stagingId);
      // expires_at stays in the FUTURE so this row is not also picked up by
      // the eligible-row loop above (which would reset its status/updated_at
      // to 'expired'/NOW() and defeat the age check below); only its
      // terminal status + old updated_at should make it prunable.
      await client.query(
        `UPDATE portal_upload_staging
            SET status = 'rejected', expires_at = NOW() + INTERVAL '1 day', updated_at = NOW() - INTERVAL '10 days'
          WHERE id = $1`,
        [pruneMint.stagingId]
      );

      const outcome = await store.cleanupExpiredPortalUploads();
      expect(outcome.deleted).toBeGreaterThanOrEqual(1);
      expect(outcome.pruned).toBeGreaterThanOrEqual(1);
      expect(del).toHaveBeenCalledWith(expiredMint.pathname, { token: 'vercel_blob_rw_test_private' });

      const expiredRow = await readStagingRow(expiredMint.stagingId);
      expect(expiredRow.status).toBe('expired');

      const prunedRow = await readStagingRow(pruneMint.stagingId);
      expect(prunedRow).toBeUndefined();
      await assertNoOpenTransactionAnywhere();
    });
  });
});
