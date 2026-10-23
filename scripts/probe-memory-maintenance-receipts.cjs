#!/usr/bin/env node
/** Read-only maintenance receipt metadata; no cleanup invocation or Blob calls. */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SQL = `SELECT status,started_at,completed_at,records_deleted,
  (error_message IS NOT NULL) AS has_error_message,
  details->'blobs'->>'deleted' AS blob_deleted,
  details->'blobs'->>'skipped' AS blob_skipped,
  details->'blobs'->>'errors' AS blob_errors
  FROM maintenance_runs WHERE job_name='daily-maintenance'
  ORDER BY started_at DESC LIMIT 14`;
async function run() {
  if (!process.argv.includes('--execute')) {
    console.log(JSON.stringify({ mode: 'plan_only', transaction: 'BEGIN READ ONLY; bounded SELECT; ROLLBACK', query: SQL }));
    return;
  }
  const env = { ...process.env };
  for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !env[match[1]]) env[match[1]] = match[2].trim().replace(/^['"](.*)['"]$/, '$1');
  }
  const connectionString = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL;
  if (!connectionString) throw new Error('connection_not_configured');
  const { Client } = require('pg');
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  const result = { observedAt: new Date().toISOString(), target: 'app database selected by local configuration; deployed connection not established', mode: 'read-only transaction; no cleanup or Blob operations', status: 'unavailable', receipts: [] };
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10000ms'");
    const rows = await client.query(SQL);
    const number = value => value != null && /^\d+$/.test(String(value)) ? Number(value) : null;
    const date = value => value != null && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
    result.receipts = rows.rows.map(row => ({
      status: ['running','completed','failed','partial'].includes(row.status) ? row.status : 'other',
      startedAt: date(row.started_at), completedAt: date(row.completed_at),
      recordsDeleted: number(row.records_deleted), hasErrorMessage: row.has_error_message === true,
      blobDeleted: number(row.blob_deleted), blobSkipped: number(row.blob_skipped), blobErrors: number(row.blob_errors),
    }));
    result.status = 'ok';
  } catch (error) {
    result.errorCode = /^[A-Z0-9_]+$/i.test(error.code || '') ? error.code : error.name;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
  const output = path.join(ROOT, 'docs/audits/maintenance-retention-evidence-2026-10-22.json');
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
}
if (require.main === module) run().catch(error => { console.error(`Receipt probe failed: ${error.name}`); process.exitCode = 1; });
