#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { Client } = require('pg');
const { del, get, put } = require('@vercel/blob');
const {
  validateTarget,
  verifyBootstrapReadback,
  verifySeedReadback,
} = require('./bootstrap-transcription-preview');

const EXPECTED_STORE_TOKEN_PREFIX = 'vercel_blob_rw_Qri02A1kj96tQYR9_';
const BLOB_OPERATION_TIMEOUT_MS = 90_000;
const MAX_FIXTURE_BYTES = 2 * 1024 * 1024;
function safeCode(error) {
  const candidate = error?.code || error?.message || '';
  return /^[a-z0-9_:-]{1,120}$/i.test(candidate) ? candidate : 'unexpected_error';
}

function parseTargetEnvironment(text) {
  let env;
  try { env = parseEnv(text); } catch { throw new Error('preview_environment_malformed'); }
  const postgresUrl = env.POSTGRES_URL;
  const blobToken = env.BLOB_READ_WRITE_TOKEN;
  if (!postgresUrl || !blobToken) {
    throw new Error('preview_environment_scope_invalid');
  }
  if (!blobToken.startsWith(EXPECTED_STORE_TOKEN_PREFIX)
      || blobToken.length <= EXPECTED_STORE_TOKEN_PREFIX.length) {
    throw new Error('preview_blob_store_token_mismatch');
  }
  // Return only the two values this operator check consumes. Other branch
  // credentials in the file are neither copied into process.env nor used.
  return { POSTGRES_URL: postgresUrl, BLOB_READ_WRITE_TOKEN: blobToken };
}

function createClient(targetUrl) {
  return new Client({
    host: targetUrl.hostname,
    port: Number(targetUrl.port || 5432),
    user: decodeURIComponent(targetUrl.username),
    password: decodeURIComponent(targetUrl.password),
    database: 'neondb',
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    query_timeout: 10_000,
    application_name: 'transcription-preview-storage-check',
  });
}

async function withinDeadline(operation, timeoutMs, label) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > BLOB_OPERATION_TIMEOUT_MS) {
    throw new Error('blob_timeout_invalid');
  }
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label}_timeout`));
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function readBlob(result, signal, maxBytes) {
  if (!result || result.statusCode !== 200 || !result.stream) throw new Error('blob_read_failed');
  const reader = result.stream.getReader();
  const chunks = [];
  let length = 0;
  const cancelOnAbort = () => reader.cancel().catch(() => {});
  signal.addEventListener('abort', cancelOnAbort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error('blob_operation_timeout');
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = Buffer.from(value);
      length += bytes.length;
      if (length > maxBytes) throw new Error('blob_read_limit_exceeded');
      chunks.push(bytes);
    }
    if (signal.aborted) throw new Error('blob_operation_timeout');
    return Buffer.concat(chunks, length);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelOnAbort);
    reader.releaseLock();
  }
}

async function ensureBlobAbsent({ token, pathname, blobApi, timeoutMs }) {
  const result = await withinDeadline(
    (abortSignal) => blobApi.get(pathname, { access: 'private', token, useCache: false, abortSignal }),
    timeoutMs,
    'blob_verify_absence',
  );
  if (result == null || result.statusCode === 404) return true;
  if (result.statusCode === 200) {
    await result.stream?.cancel().catch(() => {});
    throw new Error('blob_path_still_present');
  }
  throw new Error('blob_absence_check_failed');
}

async function runStorageCheck({
  client,
  token,
  fixture,
  audioInspector,
  blobApi = { put, get, del },
  timeoutMs = BLOB_OPERATION_TIMEOUT_MS,
  makeId = crypto.randomUUID,
  schemaVerifier = verifyBootstrapReadback,
  adminVerifier = verifySeedReadback,
} = {}) {
  if (!client || !token?.startsWith(EXPECTED_STORE_TOKEN_PREFIX)) throw new Error('preview_storage_config_invalid');
  if (!Buffer.isBuffer(fixture) || fixture.length < 1 || fixture.length > MAX_FIXTURE_BYTES) throw new Error('synthetic_fixture_invalid');
  if (typeof audioInspector !== 'function') throw new Error('media_inspector_unavailable');

  let connected = false;
  let transactionOpen = false;
  let pathname;
  let mayOwnPath = false;
  let putResponseReceived = false;
  let cleanupAbsentObserved = false;
  let cleanupVerified = false;
  let originalFailure;
  let result;
  try {
    await client.connect();
    connected = true;
    await client.query('BEGIN READ ONLY');
    transactionOpen = true;
    const readOnly = await client.query('SHOW transaction_read_only');
    if (readOnly.rows[0]?.transaction_read_only !== 'on') throw new Error('readonly_transaction_not_confirmed');
    const identity = await client.query('SELECT current_database() AS database_name');
    if (identity.rows[0]?.database_name !== 'neondb') throw new Error('target_database_mismatch');
    await schemaVerifier(client);
    await adminVerifier(client);
    // Refuse a silently RLS-filtered count; if the connection cannot bypass
    // policies, Postgres errors rather than allowing a false zero.
    await client.query('SET LOCAL row_security = off');
    const jobs = await client.query('SELECT COUNT(*)::text AS count FROM public.transcription_jobs');
    if (jobs.rows[0]?.count !== '0') throw new Error('transcription_jobs_not_empty');
    await client.query('COMMIT');
    transactionOpen = false;
    await client.end();
    connected = false;

    pathname = `transcription-pilot/preflight/${makeId()}/synthetic-aac.m4a`;
    await ensureBlobAbsent({ token, pathname, blobApi, timeoutMs });

    // Mark the unique path before starting the write so timeout/connection-loss
    // after a successful remote commit still triggers exact-path cleanup.
    mayOwnPath = true;
    const stored = await withinDeadline((abortSignal) => blobApi.put(pathname, fixture, {
      access: 'private',
      token,
      contentType: 'audio/mp4',
      addRandomSuffix: false,
      allowOverwrite: false,
      abortSignal,
    }), timeoutMs, 'blob_upload');
    putResponseReceived = true;
    if (stored.pathname !== pathname) throw new Error('blob_upload_metadata_mismatch');

    const downloaded = await withinDeadline(async (abortSignal) => {
      const response = await blobApi.get(pathname, { access: 'private', token, useCache: false, abortSignal });
      return readBlob(response, abortSignal, MAX_FIXTURE_BYTES);
    }, timeoutMs, 'blob_download');
    const expectedHash = crypto.createHash('sha256').update(fixture).digest('hex');
    const downloadedHash = crypto.createHash('sha256').update(downloaded).digest('hex');
    if (downloaded.length !== fixture.length || downloadedHash !== expectedHash) throw new Error('blob_roundtrip_integrity_mismatch');

    const media = await audioInspector(downloaded);
    if (!media || !Number.isFinite(media.durationSeconds) || media.durationSeconds <= 0) throw new Error('media_inspection_failed');
    result = {
      completed: true,
      database: 'neondb',
      transcriptionJobs: 0,
      blobStoreTokenPrefixMatched: true,
      blobRoundTripVerified: true,
      deployedMediaRuntimeExercised: false,
      fixtureBytes: downloaded.length,
      fixtureSha256: downloadedHash,
      media: {
        container: media.container,
        codec: media.codec,
        durationSeconds: media.durationSeconds,
      },
    };
  } catch (error) {
    originalFailure = error;
  } finally {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    if (mayOwnPath) {
      try {
        await withinDeadline((abortSignal) => blobApi.del(pathname, { token, abortSignal }), timeoutMs, 'blob_delete');
        cleanupAbsentObserved = await ensureBlobAbsent({ token, pathname, blobApi, timeoutMs });
        // A rejected/timed-out PUT may still finish remotely after this 404;
        // keep its opaque pathname as an unresolved cleanup item.
        cleanupVerified = putResponseReceived && cleanupAbsentObserved;
      } catch (cleanupError) {
        originalFailure ||= cleanupError;
      }
    }
    if (connected) await client.end().catch(() => {});
  }
  if (originalFailure) {
    const cleanupAttempted = mayOwnPath;
    const failure = new Error(`transcription_preview_storage_check_failed:${safeCode(originalFailure)}${cleanupAttempted && !cleanupVerified ? ':blob_cleanup_unverified' : ''}`);
    failure.cleanupVerified = cleanupVerified;
    failure.cleanupPath = cleanupAttempted && !cleanupVerified ? pathname : null;
    failure.cleanupAbsentObserved = cleanupAbsentObserved;
    failure.cleanupOutcomeAmbiguous = cleanupAttempted && !putResponseReceived;
    throw failure;
  }
  if (!cleanupVerified) throw new Error('transcription_preview_storage_check_failed:blob_cleanup_unverified');
  return { ...result, exactPathCleanupVerified: cleanupVerified };
}

async function main() {
  if (process.argv[2] !== '--confirm-private-blob-roundtrip') {
    throw new Error('explicit_private_blob_roundtrip_confirmation_required');
  }
  const root = path.resolve(__dirname, '..');
  const targetPath = path.join(root, '.env.transcription-preview.local');
  const productionPath = path.join(root, '.env.local');
  const targetText = fs.readFileSync(targetPath, 'utf8');
  // The shared local file is used only by validateTarget to reject a host
  // collision; no credentials from it are passed to the client or Blob SDK.
  const productionText = fs.readFileSync(productionPath, 'utf8');
  const env = parseTargetEnvironment(targetText);
  const targetUrl = validateTarget(targetText, productionText);
  const client = createClient(targetUrl);
  const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/transcription/synthetic-aac.m4a'));
  const { inspectAudioBuffer } = await import('../lib/services/transcription-pilot/media-inspector.js');
  const result = await runStorageCheck({ client, token: env.BLOB_READ_WRITE_TOKEN, fixture, audioInspector: inspectAudioBuffer });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    const message = error.message.startsWith('transcription_preview_storage_check_failed:')
      ? error.message : `transcription_preview_storage_check_failed:${safeCode(error)}`;
    process.stderr.write(`${message}\n`);
    if (error.cleanupPath) process.stderr.write(`cleanup_path=${error.cleanupPath}\n`);
    if (error.cleanupPath) process.stderr.write(`cleanup_absent_observed=${error.cleanupAbsentObserved === true}\n`);
    if (error.cleanupPath && error.cleanupOutcomeAmbiguous) process.stderr.write('cleanup_uncertainty=upload_outcome_may_complete_late\n');
    process.exitCode = 1;
  });
}

module.exports = { EXPECTED_STORE_TOKEN_PREFIX, parseTargetEnvironment, runStorageCheck };
