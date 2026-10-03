#!/usr/bin/env node
'use strict';

// Explicitly scoped operator tool for the fixed synthetic speaker rehearsal.
// Default behavior is read-only; no command here contacts CRM or a provider.
// Preflight needs the existing ESM import resolver:
// node --import ./scripts/lib/use-extensionless.mjs scripts/meeting-transcription-rehearsal-fixture.js --preflight --env-file <protected-preview-env>
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { put, get, del } = require('@vercel/blob');
const fixture = require('../lib/services/meeting-tracker-transcription/rehearsal-fixture');

const NEON_HOST = 'ep-aged-dew-b7gtigyy-pooler.c-13.us-east-1.aws.neon.tech';
const NEON_PROJECT_ID = 'dawn-paper-09421078';
const BLOB_PREFIX = 'vercel_blob_rw_G5ZrBn1kcxzaBkyI_';
const MARKER = 'meeting-tracker-speaker-rehearsal-v1';
const transcriptBytes = Buffer.from(JSON.stringify(fixture.REHEARSAL_TRANSCRIPT), 'utf8');
const transcriptHash = crypto.createHash('sha256').update(transcriptBytes).digest('hex');

function argsOf(argv) {
  const result = { action: 'inspect', execute: false, accessDisabled: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (['--preflight', '--seed', '--teardown'].includes(argv[i])) result.action = argv[i].slice(2);
    else if (argv[i] === '--env-file') result.envFile = argv[++i];
    else if (argv[i] === '--execute') result.execute = true;
    else if (argv[i] === '--access-disabled') result.accessDisabled = true;
    else throw new Error('usage_invalid');
  }
  if (!result.envFile) throw new Error('explicit_env_file_required');
  if ((result.action === 'seed' || result.action === 'teardown') && !result.execute) {
    throw new Error('explicit_execute_required');
  }
  if (result.action === 'teardown' && !result.accessDisabled) throw new Error('access_disabled_attestation_required');
  return result;
}

function loadTarget(envFile) {
  const env = { ...parseEnv(fs.readFileSync(envFile, 'utf8')) };
  for (const key of ['POSTGRES_URL', 'DATABASE_URL', 'NEON_PROJECT_ID', 'UPLOADS_BLOB_RW_TOKEN',
    'MEETING_TRANSCRIPTION_REHEARSAL_ENABLED', 'MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY',
    'MEETING_TRACKER_TRANSCRIPTION_ACCESS']) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }
  let target;
  try { target = new URL(env.POSTGRES_URL); } catch { throw new Error('postgres_target_invalid'); }
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
    || target.hostname.toLowerCase() !== NEON_HOST || target.pathname !== '/neondb'
    || !target.username || !target.password || (target.port && target.port !== '5432')
    || !['require', 'verify-ca', 'verify-full'].includes((target.searchParams.get('sslmode') || '').toLowerCase())
    || env.NEON_PROJECT_ID !== NEON_PROJECT_ID
    || !env.UPLOADS_BLOB_RW_TOKEN?.startsWith(BLOB_PREFIX)) throw new Error('rehearsal_target_mismatch');
  for (const key of ['DATABASE_URL']) {
    if (env[key]) {
      let alternate;
      try { alternate = new URL(env[key]); } catch { throw new Error('alternate_database_target_invalid'); }
      if (!['postgres:', 'postgresql:'].includes(alternate.protocol)
        || alternate.hostname.toLowerCase() !== NEON_HOST || alternate.pathname !== '/neondb'
        || !alternate.username || !alternate.password || (alternate.port && alternate.port !== '5432')
        || !['require', 'verify-ca', 'verify-full'].includes((alternate.searchParams.get('sslmode') || '').toLowerCase())) {
        throw new Error('alternate_database_target_mismatch');
      }
    }
  }
  return { env, target };
}

function clientFor(target) {
  return new Client({
    host: target.hostname, port: Number(target.port || 5432),
    user: decodeURIComponent(target.username), password: decodeURIComponent(target.password),
    database: 'neondb', ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000, query_timeout: 15_000,
    application_name: 'meeting-transcription-rehearsal-fixture',
  });
}

function rowParams(now = new Date()) {
  return [
    fixture.REHEARSAL_JOB_ID, fixture.REHEARSAL_OWNER_PROFILE_ID,
    fixture.REHEARSAL_REQUEST_ID, fixture.REHEARSAL_SITE_VISIT_ACTIVITY_ID,
    fixture.REHEARSAL_OUTPUT_PATH, transcriptHash,
    JSON.stringify({ rehearsal_fixture: MARKER }),
    new Date(now.getTime() + 7 * 86400_000), new Date(now.getTime() + 30 * 86400_000),
    JSON.stringify({ A: '', B: '', C: '' }),
  ];
}

const INSERT_SQL = `INSERT INTO public.transcription_jobs
 (id, owner_profile_id, request_id, site_visit_activity_id, status, version,
   options_snapshot, output_pathname, output_sha256, output_cleanup_pathname, provider_region, ready_at, expires_at,
   receipt_expires_at, speaker_names, attempts, provider_id_conflict)
 VALUES ($1,$2,$3,$4,'ready',1,$7::jsonb,$5,$6,$5,NULL,NOW(),$8,$9,$10::jsonb,0,FALSE)
 RETURNING id, owner_profile_id, request_id, site_visit_activity_id, status,
          version, created_at, updated_at, ready_at, options_snapshot, output_pathname,
          output_sha256, output_cleanup_pathname, expires_at, receipt_expires_at,
          speaker_names, attempts, provider_id_conflict, cleanup_requested_at,
          content_purged_at, input_cleanup_pathname, upload_valid_until`;

async function assertNoFixture(client) {
  const { rows } = await client.query(
    `SELECT id FROM public.transcription_jobs
      WHERE id <> $1 AND (output_pathname = $2 OR request_id = $3 OR site_visit_activity_id = $4)
      LIMIT 2`,
    [fixture.REHEARSAL_JOB_ID, fixture.REHEARSAL_OUTPUT_PATH,
      fixture.REHEARSAL_REQUEST_ID, fixture.REHEARSAL_SITE_VISIT_ACTIVITY_ID],
  );
  if (rows.length) throw new Error('fixture_collision_refused');
  const dispatch = await client.query(
    'SELECT job_id FROM public.transcription_workflow_dispatches WHERE job_id = $1 LIMIT 1',
    [fixture.REHEARSAL_JOB_ID],
  );
  if (dispatch.rows.length) throw new Error('fixture_dispatch_exists');
}

async function verifySeedIdentity(client) {
  const result = await client.query(
    `SELECT id, azure_id, is_active, needs_linking FROM public.user_profiles WHERE id = $1 LIMIT 1`,
    [fixture.REHEARSAL_OWNER_PROFILE_ID],
  );
  const profile = result.rows[0];
  if (!profile || String(profile.azure_id).toLowerCase() !== '893369cc-1925-40ec-bbc6-6f12b0684a31'
    || profile.is_active !== true || profile.needs_linking !== false) throw new Error('fixture_owner_identity_mismatch');
}

async function existingFixture(client) {
  const result = await client.query('SELECT * FROM public.transcription_jobs WHERE id = $1', [fixture.REHEARSAL_JOB_ID]);
  if (!result.rows.length) return null;
  const row = result.rows[0];
  if (result.rows.length !== 1 || row.owner_profile_id !== 1
    || row.request_id !== fixture.REHEARSAL_REQUEST_ID
    || row.site_visit_activity_id !== fixture.REHEARSAL_SITE_VISIT_ACTIVITY_ID
    || row.status !== 'ready' || row.output_pathname !== fixture.REHEARSAL_OUTPUT_PATH
    || row.output_cleanup_pathname !== fixture.REHEARSAL_OUTPUT_PATH || row.output_sha256 !== transcriptHash
    || row.options_snapshot?.rehearsal_fixture !== MARKER
    || Object.keys(row.options_snapshot || {}).sort().join(',') !== 'rehearsal_fixture'
    || row.provider_region || row.requested_model || row.returned_model || row.idempotency_key
    || row.original_filename || row.declared_content_type || row.declared_bytes || row.audio_duration_ms
    || row.verified_content_type || row.verified_bytes || row.provider_upload_ref_ciphertext
    || row.provider_transcript_id || row.callback_candidate_transcript_id || row.conflicting_transcript_id
    || row.attempt_correlation_id || row.submission_intent_at || row.audio_pathname || row.input_cleanup_pathname
    || row.audio_sha256 || row.audio_etag || row.lease_token || row.publication_operation_id
    || row.cleanup_requested_at || row.content_purged_at || row.attempts !== 0
    || row.provider_id_conflict !== false || new Date(row.expires_at).getTime() <= Date.now()
    || new Date(row.receipt_expires_at).getTime() <= Date.now()) throw new Error('fixture_existing_row_mismatch');
  const dispatch = await client.query('SELECT job_id FROM public.transcription_workflow_dispatches WHERE job_id = $1 LIMIT 1', [fixture.REHEARSAL_JOB_ID]);
  if (dispatch.rows.length) throw new Error('fixture_dispatch_exists');
  return row;
}

async function verifyPrivateBlob(pathname, token) {
  const result = await get(pathname, { access: 'private', token, useCache: false });
  if (!result || result.statusCode === 404) return false;
  if (result.statusCode !== 200 || !result.stream) throw new Error('fixture_blob_read_failed');
  const reader = result.stream.getReader();
  const chunks = [];
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      bytesRead += chunk.length;
      if (bytesRead > transcriptBytes.length) {
        await reader.cancel().catch(() => {});
        throw new Error('fixture_blob_size_mismatch');
      }
      chunks.push(chunk);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== transcriptBytes.length
    || crypto.createHash('sha256').update(bytes).digest('hex') !== transcriptHash) throw new Error('fixture_blob_hash_mismatch');
  return true;
}

async function preflight(client, projectMeetingTranscriptionJob) {
  if (typeof projectMeetingTranscriptionJob !== 'function') throw new Error('projector_required');
  await client.query('BEGIN');
  try {
    const identity = await client.query('SELECT current_database() AS db, current_setting($1) AS app', ['application_name']);
    if (identity.rows[0]?.db !== 'neondb') throw new Error('target_database_mismatch');
    await assertNoFixture(client);
    const inserted = await client.query(INSERT_SQL, rowParams());
    if (inserted.rows.length !== 1 || inserted.rows[0].output_sha256 !== transcriptHash
      || inserted.rows[0].options_snapshot?.rehearsal_fixture !== MARKER) throw new Error('preflight_readback_failed');
    const projected = projectMeetingTranscriptionJob(inserted.rows[0]);
    const projectedKeys = Object.keys(projected || {}).sort();
    const expectedKeys = [
      'id', 'status', 'version', 'created_at', 'updated_at', 'original_filename',
      'declared_content_type', 'declared_bytes', 'verified_content_type', 'verified_bytes',
      'audio_duration_ms', 'ready_at', 'expires_at', 'speaker_names', 'label',
      'needsAttention', 'contentAccessAllowed', 'contentDeletionObserved',
      'lateUploadWatchPending', 'cleanupPending',
    ].sort();
    const projectedFlags = {
      contentDeletionObserved: projected?.contentDeletionObserved,
      lateUploadWatchPending: projected?.lateUploadWatchPending,
    };
    if (!projected || projected.id !== fixture.REHEARSAL_JOB_ID || projected.status !== 'ready'
      || projected.contentAccessAllowed !== true || JSON.stringify(projectedKeys) !== JSON.stringify(expectedKeys)
      || projectedFlags.contentDeletionObserved !== false || projectedFlags.lateUploadWatchPending !== false
      || inserted.rows[0].cleanup_requested_at !== null || inserted.rows[0].content_purged_at !== null
      || inserted.rows[0].input_cleanup_pathname !== null || inserted.rows[0].upload_valid_until !== null
      || !projected.speaker_names || Object.keys(projected.speaker_names).sort().join(',') !== 'A,B,C') {
      throw new Error('preflight_projection_failed');
    }
    await client.query('ROLLBACK');
    return { preflightRolledBack: true, projectionVerified: true, projectedKeys, projectedFlags,
      fixedJobId: fixture.REHEARSAL_JOB_ID, fixtureBytes: transcriptBytes.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function seed(client, env) {
  await verifySeedIdentity(client);
  const prior = await existingFixture(client);
  if (prior) {
    if (!await verifyPrivateBlob(fixture.REHEARSAL_OUTPUT_PATH, env.UPLOADS_BLOB_RW_TOKEN)) throw new Error('fixture_blob_missing');
    return { reusedExistingFixture: true, fixedJobId: fixture.REHEARSAL_JOB_ID,
      versionPreserved: prior.version, expiryPreserved: true };
  }
  await assertNoFixture(client);
  let blobPresent = await verifyPrivateBlob(fixture.REHEARSAL_OUTPUT_PATH, env.UPLOADS_BLOB_RW_TOKEN);
  if (!blobPresent) {
    try {
      const saved = await put(fixture.REHEARSAL_OUTPUT_PATH, transcriptBytes, {
        access: 'private', addRandomSuffix: false, allowOverwrite: false,
        contentType: 'application/json', token: env.UPLOADS_BLOB_RW_TOKEN,
      });
      if (saved.pathname !== fixture.REHEARSAL_OUTPUT_PATH) throw new Error('fixture_blob_path_mismatch');
      blobPresent = true;
    } catch (error) {
      // A timeout/collision may happen after storage committed. Recover only by
      // verifying the exact pinned object and expected synthetic bytes.
      blobPresent = await verifyPrivateBlob(fixture.REHEARSAL_OUTPUT_PATH, env.UPLOADS_BLOB_RW_TOKEN);
      if (!blobPresent) throw error;
    }
  }
  try {
    await client.query('BEGIN');
    const inserted = await client.query(INSERT_SQL, rowParams());
    if (inserted.rows.length !== 1 || inserted.rows[0].output_sha256 !== transcriptHash) throw new Error('fixture_insert_readback_failed');
    await client.query('COMMIT');
    return { seeded: true, fixedJobId: fixture.REHEARSAL_JOB_ID, blobPathPinned: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    // A failed COMMIT acknowledgement is ambiguous; retain the exact expected
    // object so a retry can verify/reuse it or an operator can safely fence it.
    throw error;
  }
}

async function teardown(client, env) {
  // Operator must first disable route access in Preview; refuse a still-enabled target.
  if (env.MEETING_TRANSCRIPTION_REHEARSAL_ENABLED === 'on'
    || env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY === 'on'
    || env.MEETING_TRACKER_TRANSCRIPTION_ACCESS === `test:${fixture.REHEARSAL_REQUEST_ID}`) {
    throw new Error('disable_preview_access_before_teardown');
  }
  const selected = await client.query(
    `SELECT id, owner_profile_id, request_id, site_visit_activity_id, output_pathname,
            output_sha256, options_snapshot, provider_upload_ref_ciphertext,
            provider_transcript_id, callback_candidate_transcript_id, conflicting_transcript_id,
            attempt_correlation_id, submission_intent_at, audio_pathname, input_cleanup_pathname,
            audio_sha256, audio_etag, lease_token, lease_expires_at, publication_operation_id,
            output_cleanup_pathname, cleanup_requested_at, version, status, attempts, provider_id_conflict
       FROM public.transcription_jobs WHERE id = $1`,
    [fixture.REHEARSAL_JOB_ID],
  );
  if (!selected.rows.length) return { alreadyAbsent: true };
  const row = selected.rows[0];
  if (selected.rows.length !== 1 || row.owner_profile_id !== 1
    || row.request_id !== fixture.REHEARSAL_REQUEST_ID
    || row.site_visit_activity_id !== fixture.REHEARSAL_SITE_VISIT_ACTIVITY_ID
    || row.output_pathname !== fixture.REHEARSAL_OUTPUT_PATH
    || row.output_cleanup_pathname !== fixture.REHEARSAL_OUTPUT_PATH || row.output_sha256 !== transcriptHash
    || row.options_snapshot?.rehearsal_fixture !== MARKER
    || Object.keys(row.options_snapshot || {}).sort().join(',') !== 'rehearsal_fixture'
    || row.provider_upload_ref_ciphertext || row.provider_transcript_id
    || row.callback_candidate_transcript_id || row.conflicting_transcript_id
    || row.attempt_correlation_id || row.submission_intent_at || row.audio_pathname
    || row.input_cleanup_pathname || row.audio_sha256 || row.audio_etag || row.lease_token
    || row.lease_expires_at || row.publication_operation_id || row.attempts !== 0
    || row.provider_id_conflict !== false) throw new Error('fixture_ownership_check_failed');
  const dispatch = await client.query('SELECT job_id FROM public.transcription_workflow_dispatches WHERE job_id = $1 LIMIT 1', [fixture.REHEARSAL_JOB_ID]);
  if (dispatch.rows.length) throw new Error('fixture_dispatch_exists');
  if (!row.cleanup_requested_at) {
    const fenced = await client.query(
      `UPDATE public.transcription_jobs SET cleanup_requested_at = NOW(), version = version + 1, updated_at = NOW()
        WHERE id = $1 AND owner_profile_id = 1 AND request_id = $2 AND site_visit_activity_id = $3
          AND status = 'ready' AND version = $4 AND output_pathname = $5 AND output_sha256 = $6
          AND output_cleanup_pathname = $5 AND options_snapshot->>'rehearsal_fixture' = $7
          AND cleanup_requested_at IS NULL AND provider_upload_ref_ciphertext IS NULL
          AND provider_transcript_id IS NULL AND callback_candidate_transcript_id IS NULL
          AND conflicting_transcript_id IS NULL AND audio_pathname IS NULL
        RETURNING cleanup_requested_at`,
      [fixture.REHEARSAL_JOB_ID, fixture.REHEARSAL_REQUEST_ID, fixture.REHEARSAL_SITE_VISIT_ACTIVITY_ID,
        row.version, fixture.REHEARSAL_OUTPUT_PATH, transcriptHash, MARKER],
    );
    if (fenced.rows.length !== 1) throw new Error('fixture_access_fence_failed');
  }
  const blobPresent = await verifyPrivateBlob(fixture.REHEARSAL_OUTPUT_PATH, env.UPLOADS_BLOB_RW_TOKEN);
  if (blobPresent) await del(fixture.REHEARSAL_OUTPUT_PATH, { token: env.UPLOADS_BLOB_RW_TOKEN });
  const deleted = await client.query(
    `DELETE FROM public.transcription_jobs
      WHERE id = $1 AND owner_profile_id = 1 AND request_id = $2 AND site_visit_activity_id = $3
        AND output_pathname = $4 AND output_sha256 = $5
        AND output_cleanup_pathname = $4 AND cleanup_requested_at IS NOT NULL
        AND options_snapshot->>'rehearsal_fixture' = $6
        AND provider_upload_ref_ciphertext IS NULL AND provider_transcript_id IS NULL
        AND callback_candidate_transcript_id IS NULL AND conflicting_transcript_id IS NULL
        AND audio_pathname IS NULL
      RETURNING id`,
    [fixture.REHEARSAL_JOB_ID, fixture.REHEARSAL_REQUEST_ID, fixture.REHEARSAL_SITE_VISIT_ACTIVITY_ID,
      fixture.REHEARSAL_OUTPUT_PATH, transcriptHash, MARKER],
  );
  if (deleted.rows.length !== 1) throw new Error('fixture_row_delete_unconfirmed');
  return { tornDown: true, fixedJobId: fixture.REHEARSAL_JOB_ID };
}

async function main() {
  const options = argsOf(process.argv.slice(2));
  const { env, target } = loadTarget(options.envFile);
  const client = clientFor(target);
  await client.connect();
  try {
    const runtime = options.action === 'preflight'
      ? await import('../lib/services/transcription-pilot/runtime.js') : null;
    const receipt = options.action === 'preflight' ? await preflight(client, runtime.projectMeetingTranscriptionJob)
      : options.action === 'seed' ? await seed(client, env)
        : options.action === 'teardown' ? await teardown(client, env)
          : { readOnly: true, targetPinned: true, fixedJobId: fixture.REHEARSAL_JOB_ID };
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) main().catch((error) => {
  const code = /^[a-z0-9_:-]{1,120}$/i.test(error.message || '') ? error.message : 'unexpected_error';
  process.stderr.write(`meeting_transcription_rehearsal_fixture_failed:${code}\n`);
  process.exitCode = 1;
});

module.exports = { INSERT_SQL, MARKER, argsOf, existingFixture, loadTarget, preflight, rowParams, seed, teardown, transcriptHash, verifySeedIdentity };
