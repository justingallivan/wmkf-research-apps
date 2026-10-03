#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import pg from 'pg';

const EXPECTED_HOST_LABEL = 'ep-gentle-smoke-b77a6d90-pooler';
const TARGET_ENV_FILE = '.env.transcription-preview.local';
const PRODUCTION_ENV_FILE = '.env.local';

function readEnvFile(path) {
  return parseEnv(readFileSync(path, 'utf8'));
}

function getPostgresUrl(raw, label) {
  if (!raw) throw new Error(`${label}_missing`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label}_malformed`);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`${label}_protocol_invalid`);
  }
  const sslMode = url.searchParams.get('sslmode')?.toLowerCase();
  if (!['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    throw new Error(`${label}_sslmode_not_required`);
  }
  if (!url.username || !url.password) throw new Error(`${label}_credentials_missing`);
  if (url.port && url.port !== '5432') throw new Error(`${label}_port_invalid`);
  return url;
}

function normalizedHost(hostname) {
  return hostname.toLowerCase().replace(/-pooler(?=\.)/, '');
}

function fail(code) {
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}

let targetUrl;
let productionUrls;
try {
  const targetEnv = readEnvFile(TARGET_ENV_FILE);
  targetUrl = getPostgresUrl(targetEnv.POSTGRES_URL, 'target_url');

  const productionEnv = readEnvFile(PRODUCTION_ENV_FILE);
  productionUrls = ['POSTGRES_URL', 'DATABASE_URL']
    .map((name) => productionEnv[name])
    .filter(Boolean)
    .map((value) => getPostgresUrl(value, 'production_url'));
} catch {
  fail('local_environment_preflight_failed');
  process.exit();
}

if (!targetUrl.hostname.endsWith('.neon.tech')
    || targetUrl.hostname.split('.')[0] !== EXPECTED_HOST_LABEL) {
  fail('target_host_does_not_match_user_confirmed_neon_endpoint');
  process.exit();
}

if (productionUrls.length === 0) {
  fail('local_production_hosts_unavailable');
  process.exit();
}

if (productionUrls.some((url) => normalizedHost(url.hostname) === normalizedHost(targetUrl.hostname))) {
  fail('target_host_matches_local_production_host');
  process.exit();
}

if (decodeURIComponent(targetUrl.pathname.replace(/^\//, '')) !== 'neondb') {
  fail('target_database_not_neondb');
  process.exit();
}
if (targetUrl.searchParams.has('host')) {
  fail('target_url_host_override_not_allowed');
  process.exit();
}

const { Client } = pg;
const client = new Client({
  host: targetUrl.hostname,
  port: targetUrl.port ? Number(targetUrl.port) : 5432,
  user: decodeURIComponent(targetUrl.username),
  password: decodeURIComponent(targetUrl.password),
  database: 'neondb',
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 10_000,
  query_timeout: 10_000,
  application_name: 'transcription-preview-readonly-preflight',
});

try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const readOnly = await client.query('SHOW transaction_read_only');
  if (readOnly.rows[0]?.transaction_read_only !== 'on') {
    throw new Error('read_only_transaction_not_confirmed');
  }

  const identity = await client.query(
    'SELECT current_database() AS database_label, current_schema() AS current_schema'
  );
  if (identity.rows[0]?.database_label !== 'neondb') {
    throw new Error('connected_database_not_neondb');
  }
  const relations = await client.query(`
    SELECT n.nspname AS table_schema, c.relname AS table_name,
      pg_catalog.pg_get_userbyid(c.relowner) AS table_owner
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_%'
    ORDER BY n.nspname, c.relname
  `);
  if (relations.rows.length > 64) throw new Error('user_table_count_exceeds_probe_bound');
  const quoteIdentifier = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
  const tables = [];
  for (const relation of relations.rows) {
    const qualifiedName = `${quoteIdentifier(relation.table_schema)}.${quoteIdentifier(relation.table_name)}`;
    const count = await client.query(`SELECT COUNT(*)::text AS exact_row_count FROM ${qualifiedName}`);
    tables.push({
      schema: relation.table_schema,
      table: relation.table_name,
      owner: relation.table_owner,
      exactVisibleRowCount: count.rows[0].exact_row_count,
    });
  }

  await client.query('COMMIT');
  process.stdout.write(`${JSON.stringify({
    endpointMatch: true,
    distinctFromLocalProductionHosts: true,
    database: identity.rows[0].database_label,
    currentSchema: identity.rows[0].current_schema,
    exactVisibleUserTableCount: tables.length,
    tables,
    readOnlyTransaction: true,
  }, null, 2)}\n`);
} catch (error) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The connection may already be unavailable; keep errors sanitized.
  }
  const safeCode = /^[A-Z0-9_]+$/.test(error.code || '') ? `:${error.code}` : '';
  process.stderr.write(`readonly_probe_failed${safeCode}\n`);
  process.exitCode = 1;
} finally {
  try {
    await client.end();
  } catch {
    // Do not expose connection details in cleanup errors.
  }
}
