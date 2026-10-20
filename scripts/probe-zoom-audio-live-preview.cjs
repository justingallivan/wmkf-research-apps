#!/usr/bin/env node
'use strict';
/** Owner-approved PR 513 acceptance operator. No secrets or transcript text in output.
 * prepare creates ONE fresh database on the existing isolated test endpoint, then
 * runs the repository's guarded fresh-install bootstrap. Never targets shared DBs.
 * Usage: node scripts/probe-zoom-audio-live-preview.cjs prepare|status|seed-role|drop <test-env-file>
 * Provider/storage readback: resources <operator-json>
 * Environment files are operator-owned, untracked, and must be removed afterward.
 */
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const { Client } = require('pg');
const { getBootstrapGroups } = require('./setup-database');
const { bootstrapFreshDatabase } = require('./lib/fresh-database-bootstrap');
const HOST = 'ep-aged-dew-b7gtigyy-pooler.c-13.us-east-1.aws.neon.tech';
const DATABASE = 'audio_pr513_acceptance_20261019';
const ACTOR_AZURE_ID = '893369cc-1925-40ec-bbc6-6f12b0684a31';
const readEnv = file => parseEnv(fs.readFileSync(file, 'utf8'));
function urlFor(env, database) {
  const url = new URL(env.POSTGRES_URL);
  if (url.hostname !== HOST || !url.username || !url.password || url.searchParams.has('host')) throw Error('isolated_target_mismatch');
  url.pathname = `/${database}`;
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}
async function connect(url) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10000, query_timeout: 30000 });
  await client.connect();
  return client;
}
async function prepare(env, file) {
  const admin = await connect(urlFor(env, 'neondb'));
  let actor;
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [DATABASE]);
    if (exists.rowCount) throw Error('acceptance_database_already_exists');
    const rows = await admin.query('SELECT * FROM user_profiles WHERE azure_id=$1 AND is_active=true', [ACTOR_AZURE_ID]);
    if (rows.rowCount !== 1 || !rows.rows[0].dynamics_systemuser_id) throw Error('actor_identity_unverified');
    actor = rows.rows[0];
    await admin.query(`CREATE DATABASE ${DATABASE}`);
    console.log(JSON.stringify({ createdDatabase: DATABASE, host: HOST }));
  } finally { await admin.end(); }
  const targetUrl = urlFor(env, DATABASE);
  // Persist recovery target before bootstrap so partial setup can be cleaned up.
  fs.writeFileSync(`${file}.acceptance`, `POSTGRES_URL=${JSON.stringify(targetUrl)}\nDATABASE_URL=${JSON.stringify(targetUrl)}\n`, { mode: 0o600 });
  const client = await connect(targetUrl);
  try {
    await bootstrapFreshDatabase(client, getBootstrapGroups());
    const keys = ['name', 'display_name', 'avatar_color', 'is_active', 'azure_id', 'azure_email', 'needs_linking', 'dynamics_systemuser_id'];
    const values = keys.map(key => actor[key]);
    const seeded = await client.query(`INSERT INTO user_profiles (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, values);
    console.log(JSON.stringify({ bootstrapped: true, actorProfileId: seeded.rows[0].id, jobs: 0 }));
  } finally { await client.end(); }
}
async function seedRole(env) {
  const sourceUrl = new URL(readEnv('.env.local').POSTGRES_URL);
  if (sourceUrl.hostname !== 'ep-frosty-credit-afovxswa-pooler.c-2.us-west-2.aws.neon.tech') throw Error('role_source_mismatch');
  const targetUrl = new URL(env.POSTGRES_URL);
  if (targetUrl.pathname !== `/${DATABASE}`) throw Error('acceptance_database_mismatch');
  const source = await connect(sourceUrl.toString());
  try {
    await source.query('BEGIN READ ONLY');
    const proof = await source.query(`SELECT p.id FROM user_profiles p JOIN dynamics_user_roles r ON r.user_profile_id=p.id
      WHERE p.azure_id=$1 AND p.is_active=true AND r.role='superuser'`, [ACTOR_AZURE_ID]);
    if (proof.rowCount !== 1) throw Error('existing_actor_role_unverified');
  } finally { await source.query('ROLLBACK'); await source.end(); }
  const target = await connect(urlFor(env, DATABASE));
  try {
    await target.query('BEGIN');
    const actors = await target.query('SELECT id FROM user_profiles WHERE azure_id=$1 AND is_active=true', [ACTOR_AZURE_ID]);
    if (actors.rowCount !== 1) throw Error('target_actor_unverified');
    const roles = await target.query('SELECT role FROM dynamics_user_roles');
    if (roles.rowCount !== 0) throw Error('target_roles_not_empty');
    await target.query("INSERT INTO dynamics_user_roles(user_profile_id,role) VALUES ($1,'superuser')", [actors.rows[0].id]);
    await target.query('COMMIT');
    console.log(JSON.stringify({ copiedExistingActorRole: true, targetDatabase: DATABASE, sourceReadOnly: true }));
  } catch (error) { await target.query('ROLLBACK'); throw error; }
  finally { await target.end(); }
}
async function resources(file) {
  const operator = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { values } = operator;
  if (!values.UPLOADS_BLOB_RW_TOKEN?.startsWith('vercel_blob_rw_K1ouNXIpH2j48fJ4_')) throw Error('test_store_mismatch');
  const client = await connect(urlFor(values, DATABASE));
  let job;
  try {
    const result = await client.query('SELECT id,provider_transcript_id,provider_cleanup_completed_at FROM transcription_jobs');
    if (result.rowCount !== 1 || !result.rows[0].provider_cleanup_completed_at) throw Error('provider_cleanup_unverified');
    job = result.rows[0];
  } finally { await client.end(); }
  await import('./lib/use-extensionless.mjs');
  process.env.ASSEMBLYAI_API_KEY = values.ASSEMBLYAI_API_KEY;
  const { getAssemblyAITranscript } = await import('../lib/services/transcription-pilot/provider.js');
  let provider;
  try {
    const result = await getAssemblyAITranscript({ region: 'us', transcriptId: job.provider_transcript_id || operator.verifiedProviderTranscriptId });
    provider = { status: result.status, contentAbsent: !result.text && !(result.utterances?.length), textCharacters: result.text?.length || 0, utterances: result.utterances?.length || 0, words: result.words?.length || 0, deletionMarker: typeof result.text === 'string' && /^(?:\[?deleted\]?|deleted by user\.)$/i.test(result.text.trim()) };
    if (provider.deletionMarker && provider.utterances === 0 && provider.words === 0) provider.contentAbsent = true;
    if (!provider.contentAbsent) throw Error('provider_content_still_available');
  } catch (error) {
    if (error.code !== 'provider_http_404') throw error;
    provider = { status: 'not_found', contentAbsent: true };
  }
  const { list } = require('@vercel/blob');
  const listing = await list({ token: values.UPLOADS_BLOB_RW_TOKEN, limit: 1000 });
  const result = { provider, blobCount: listing.blobs.length, hasMore: listing.hasMore };
  console.log(JSON.stringify(result, null, 2));
  if (result.blobCount || result.hasMore) throw Error('test_store_not_empty');
}
async function drop(env) {
  if (new URL(env.POSTGRES_URL).pathname !== `/${DATABASE}`) throw Error('acceptance_database_mismatch');
  const target = await connect(urlFor(env, DATABASE));
  try {
    const jobs = await target.query('SELECT status,provider_cleanup_completed_at FROM transcription_jobs');
    const active = await target.query("SELECT 1 FROM transcription_workflow_dispatches WHERE state <> 'completed'");
    if (jobs.rowCount !== 1 || jobs.rows[0].status !== 'expired' || !jobs.rows[0].provider_cleanup_completed_at || active.rowCount) throw Error('test_work_still_active');
  } finally { await target.end(); }
  const admin = await connect(urlFor(env, 'neondb'));
  try {
    await admin.query(`DROP DATABASE ${DATABASE} WITH (FORCE)`);
    const remaining = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [DATABASE]);
    if (remaining.rowCount) throw Error('database_deletion_unverified');
    console.log(JSON.stringify({ deletedDatabase: DATABASE, absenceVerified: true }));
  } finally { await admin.end(); }
}
async function status(env) {
  const url = new URL(env.POSTGRES_URL);
  if (url.pathname !== `/${DATABASE}`) throw Error('acceptance_database_mismatch');
  const client = await connect(urlFor(env, DATABASE));
  try {
    await client.query('BEGIN READ ONLY');
    const jobs = await client.query(`SELECT id,status,version,created_at,submission_intent_at,declared_bytes,verified_bytes,audio_duration_ms,
      sanitized_error_code,provider_transcript_id,provider_cleanup_completed_at,audio_deleted_at,
      audio_sha256,requested_model,returned_model,output_sha256,ready_at,cleanup_requested_at FROM transcription_jobs ORDER BY created_at`);
    const imports = await client.query('SELECT id,state,transcription_job_id,failure_code,selected_recording_files FROM zoom_recording_imports ORDER BY created_at');
    const dispatches = await client.query('SELECT job_id,state,attempt_no,last_error_code FROM transcription_workflow_dispatches');
    console.log(JSON.stringify({ database: DATABASE, jobs: jobs.rows, imports: imports.rows, dispatches: dispatches.rows }, null, 2));
  } finally { await client.query('ROLLBACK'); await client.end(); }
}
(async () => {
  const [mode, file] = process.argv.slice(2);
  if (!file || !['prepare', 'status', 'seed-role', 'resources', 'drop'].includes(mode)) throw Error('mode_and_env_file_required');
  if (mode === 'resources') return resources(file);
  const env = readEnv(file);
  if (mode === 'prepare') await prepare(env, file);
  else if (mode === 'seed-role') await seedRole(env);
  else if (mode === 'drop') await drop(env);
  else await status(env);
})().catch(error => { console.error(JSON.stringify({ ok: false, code: error.code || (/^[a-z_]+$/.test(error.message) ? error.message : 'operator_failed') })); process.exitCode = 1; });
