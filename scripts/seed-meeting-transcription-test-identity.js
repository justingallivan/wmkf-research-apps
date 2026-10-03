#!/usr/bin/env node
'use strict';

/**
 * Read-only by default. With --execute, add the one authorized sign-in test
 * identity to the dedicated Meeting Tracker test Neon DB only.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const { EXPECTED_HOST, EXPECTED_NEON_PROJECT_ID, validateTarget } =
  require('./bootstrap-meeting-transcription-test');
const EXPECTED_DATABASE = 'neondb';

const IDENTITY = Object.freeze({
  azureId: '893369cc-1925-40ec-bbc6-6f12b0684a31',
  email: 'jgallivan@wmkeck.org',
  name: 'jgallivan@wmkeck.org',
  displayName: 'Justin Gallivan',
});

function parseArgs(argv) {
  const options = { execute: false, selfTest: false, envFile: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--execute' && !options.execute && !options.selfTest) options.execute = true;
    else if (arg === '--self-test' && !options.selfTest && !options.execute) options.selfTest = true;
    else if (arg === '--env-file' && !options.envFile && argv[i + 1]) options.envFile = argv[++i];
    else throw new Error('invalid_arguments');
  }
  if (options.selfTest && options.envFile) throw new Error('invalid_arguments');
  if (!options.selfTest && !options.envFile) throw new Error('env_file_required');
  return options;
}

function readTargetEnv(envFile) {
  let env;
  try {
    env = parseEnv(fs.readFileSync(envFile, 'utf8'));
  } catch {
    throw new Error('environment_file_unreadable');
  }
  const url = validateTarget(env);
  if (url.hostname !== EXPECTED_HOST || url.pathname !== `/${EXPECTED_DATABASE}`) {
    throw new Error('target_tls_or_database_invalid');
  }
  return { env, url };
}

function chooseProfileAction(rows) {
  if (rows.length === 0) return 'insert';
  if (rows.length !== 1) throw new Error('profile_conflict');

  const row = rows[0];
  const exactIdentity = row.azure_id === IDENTITY.azureId &&
    String(row.azure_email || '').toLowerCase() === IDENTITY.email &&
    row.name === IDENTITY.name && row.display_name === IDENTITY.displayName;
  if (!exactIdentity) {
    if (row.azure_id === IDENTITY.azureId ||
        String(row.azure_email || '').toLowerCase() === IDENTITY.email ||
        row.name === IDENTITY.name) throw new Error('identity_conflict');
    throw new Error('other_profiles_present');
  }
  if (row.is_active !== true) throw new Error('identity_inactive');
  if (row.needs_linking !== false) throw new Error('identity_needs_linking');
  return 'ready';
}

async function verifyProfileSchema(client) {
  const result = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_profiles'`,
  );
  const columns = new Map(result.rows.map((row) => [row.column_name, row]));
  const expected = {
    id: ['integer', 'NO'],
    name: ['character varying', 'NO'],
    display_name: ['character varying', 'YES'],
    azure_id: ['character varying', 'YES'],
    azure_email: ['character varying', 'YES'],
    is_active: ['boolean', 'YES'],
    is_default: ['boolean', 'YES'],
    needs_linking: ['boolean', 'YES'],
  };
  for (const [name, [type, nullable]] of Object.entries(expected)) {
    const column = columns.get(name);
    if (!column || column.data_type !== type || column.is_nullable !== nullable) {
      throw new Error('profile_schema_mismatch');
    }
  }
  if (!String(columns.get('id').column_default || '').startsWith('nextval(')) {
    throw new Error('profile_schema_mismatch');
  }

  const indexes = await client.query(
    `SELECT pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_index i
      WHERE i.indrelid = 'public.user_profiles'::regclass
        AND i.indisunique AND i.indpred IS NULL`,
  );
  const uniqueColumns = new Set(indexes.rows.map(({ definition }) => {
    const match = String(definition).match(/\(([^()]*)\)\s*$/);
    return match ? match[1].replaceAll('"', '').trim() : '';
  }));
  if (!uniqueColumns.has('name') || !uniqueColumns.has('azure_id')) {
    throw new Error('profile_schema_mismatch');
  }
}

async function inspectProfiles(client, execute) {
  if (execute) await client.query('LOCK TABLE public.user_profiles IN SHARE ROW EXCLUSIVE MODE');
  await verifyProfileSchema(client);
  const result = await client.query(
    `SELECT id, name, display_name, azure_id, azure_email, is_active, needs_linking
       FROM public.user_profiles
      ORDER BY id
      LIMIT 2`,
  );
  return chooseProfileAction(result.rows);
}

function createClientConfig(url) {
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    ssl: { rejectUnauthorized: true, servername: EXPECTED_HOST },
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
    application_name: 'meeting-transcription-test-identity-seed',
  };
}

async function selfTest() {
  assert.throws(() => parseArgs([]), /env_file_required/);
  assert.throws(() => parseArgs(['--execute', '--self-test']), /invalid_arguments/);
  assert.equal(chooseProfileAction([]), 'insert');
  const exact = {
    azure_id: IDENTITY.azureId,
    azure_email: IDENTITY.email,
    name: IDENTITY.name,
    display_name: IDENTITY.displayName,
    is_active: true,
    needs_linking: false,
  };
  assert.equal(chooseProfileAction([exact]), 'ready');
  assert.throws(() => chooseProfileAction([{ ...exact, is_active: false }]), /identity_inactive/);
  assert.throws(() => chooseProfileAction([{ ...exact, needs_linking: true }]), /identity_needs_linking/);
  assert.throws(() => chooseProfileAction([{ ...exact, azure_id: 'other' }]), /identity_conflict/);
  assert.throws(() => chooseProfileAction([{ ...exact, azure_email: 'other@example.org' }]), /identity_conflict/);
  assert.throws(() => chooseProfileAction([{ ...exact, display_name: 'Other' }, exact]), /profile_conflict/);
  assert.throws(() => chooseProfileAction([{ ...exact, name: 'someone-else', azure_id: null, azure_email: null }]), /other_profiles_present/);

  const target = `postgresql://user:password@${EXPECTED_HOST}/${EXPECTED_DATABASE}?sslmode=verify-full`;
  const env = { NEON_PROJECT_ID: EXPECTED_NEON_PROJECT_ID, DATABASE_URL: target };
  const validatedUrl = readTargetEnvFromObject(env);
  assert.equal(validatedUrl.hostname, EXPECTED_HOST);
  assert.deepEqual(createClientConfig(validatedUrl).ssl, { rejectUnauthorized: true, servername: EXPECTED_HOST });
  assert.throws(() => readTargetEnvFromObject({ NEON_PROJECT_ID: 'wrong', DATABASE_URL: target }), /target_project_id_mismatch/);
  assert.equal(readTargetEnvFromObject({ NEON_PROJECT_ID: EXPECTED_NEON_PROJECT_ID, DATABASE_URL: target.replace('verify-full', 'require') }).hostname, EXPECTED_HOST);
  process.stdout.write('meeting_transcription_test_identity_self_test_passed\n');
}

function readTargetEnvFromObject(env) {
  const url = validateTarget(env);
  if (url.hostname !== EXPECTED_HOST || url.pathname !== `/${EXPECTED_DATABASE}`) {
    throw new Error('target_tls_or_database_invalid');
  }
  return url;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) return selfTest();
  const { url } = readTargetEnv(options.envFile);
  const { Client } = require('pg');
  const client = new Client(createClientConfig(url));
  let transactionOpen = false;
  let inserted = false;
  try {
    await client.connect();
    await client.query(options.execute ? 'BEGIN' : 'BEGIN READ ONLY');
    transactionOpen = true;
    const target = await client.query('SELECT current_database() AS database_name');
    if (target.rows[0]?.database_name !== EXPECTED_DATABASE) throw new Error('target_database_mismatch');

    const action = await inspectProfiles(client, options.execute);
    if (options.execute && action === 'insert') {
      await client.query(
        `INSERT INTO public.user_profiles
           (name, display_name, azure_id, azure_email, is_active, needs_linking, is_default)
         VALUES ($1, $2, $3, $4, true, false, false)`,
        [IDENTITY.name, IDENTITY.displayName, IDENTITY.azureId, IDENTITY.email],
      );
      inserted = true;
    }
    if (options.execute) await client.query('COMMIT');
    else await client.query('ROLLBACK');
    transactionOpen = false;
    process.stdout.write(`${JSON.stringify({ identityReady: action === 'ready' || inserted })}\n`);
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    process.stdout.write('{"identityReady":false}\n');
    process.stderr.write(`meeting_transcription_test_identity_failed:${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

function safeErrorCode(error) {
  if (/^[a-z0-9_:-]{1,100}$/i.test(error?.code || '')) return error.code;
  if (/^[a-z0-9_:-]{1,100}$/i.test(error?.message || '')) return error.message;
  return 'unexpected_error';
}

if (require.main === module) {
  main().catch((error) => {
    process.stdout.write('{"identityReady":false}\n');
    process.stderr.write(`meeting_transcription_test_identity_failed:${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { IDENTITY, chooseProfileAction, createClientConfig, parseArgs, readTargetEnvFromObject, verifyProfileSchema };
