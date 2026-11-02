#!/usr/bin/env node
/** Read-only Integrity rollout preflight. Explicit app-production target fence;
 * no migrations, imports, application startup, advisory locks or audit writes.
 * Uses one bounded REPEATABLE READ READ ONLY transaction; prints aggregates and
 * schema/job metadata only. Run from the isolated Integrity worktree.
 */
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { parse } = require('csv-parse/sync');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { withVerifyFullSslmode } = require('../lib/db/pg-connection-string');
const EXPECTED_HOST = 'ep-frosty-credit-afovxswa-pooler.c-2.us-west-2.aws.neon.tech';
const EXPECTED_PROJECT = 'falling-surf-05640504';
async function main() {
  const env = { ...dotenv.parse(fs.readFileSync(path.join(__dirname, '../.env.local'))), ...process.env };
  const raw = env.POSTGRES_URL;
  const target = new URL(raw);
  if (target.hostname !== EXPECTED_HOST || target.pathname !== '/neondb' || env.NEON_PROJECT_ID !== EXPECTED_PROJECT) throw new Error('production_preflight_target_mismatch');
  const client = new Client({ connectionString: withVerifyFullSslmode(raw), application_name: 'integrity-readonly-preflight', connectionTimeoutMillis: 10000, query_timeout: 20000 });
  const report = { observedAt: new Date().toISOString(), target: { project: EXPECTED_PROJECT, host: target.hostname, database: 'neondb', pooled: true }, mode: 'REPEATABLE READ READ ONLY' };
  try {
    await client.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL lock_timeout='2s'");
    async function query(key, text, params) { try { report[key] = (await client.query(text, params)).rows; } catch (error) { error.probeKey = key; throw error; } }
    await query('identity', `SELECT current_database() AS database,current_user AS role,current_setting('transaction_read_only') AS read_only,version() AS version`);
    await query('tables', "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('retractions','retraction_dataset','schema_migrations','maintenance_runs','integrity_screenings','integrity_screening_reviews') ORDER BY table_name");
    await query('columns', "SELECT column_name,data_type,character_maximum_length,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='retractions' ORDER BY ordinal_position");
    await query('corpus', `SELECT COUNT(*)::int AS rows,COUNT(*) FILTER(WHERE record_id IS NULL OR btrim(record_id)='')::int AS empty_ids, COUNT(DISTINCT record_id)::int AS distinct_ids,COUNT(*) FILTER(WHERE title IS NULL OR btrim(title)='' OR authors IS NULL OR btrim(authors)='')::int AS incomplete_rows,MIN(created_at) AS first_created,MAX(created_at) AS last_created,MIN(last_updated) AS oldest_update,MAX(last_updated) AS latest_update,MAX(retraction_date)::text AS latest_retraction_date,pg_size_pretty(pg_total_relation_size('retractions')) AS total_size FROM retractions`);
    const sourceArg = process.argv.find(arg => arg.startsWith('--source-csv='));
    if (sourceArg) {
      const sourcePath = sourceArg.slice('--source-csv='.length);
      if (fs.statSync(sourcePath).size > 128 * 1024 * 1024) throw new Error('source_csv_too_large');
      const bytes = fs.readFileSync(sourcePath);
      const source = parse(bytes, { columns: true, bom: true, skip_empty_lines: true });
      const sourceIds = new Set(source.map(row => String(row['Record ID']).trim()));
      if (sourceIds.size !== source.length || sourceIds.has('') || sourceIds.has('undefined')) throw new Error('source_ids_invalid');
      const currentIds = new Set((await client.query('SELECT record_id FROM retractions')).rows.map(row => row.record_id));
      report.sourceIdComparison = { sourceCount: source.length, bytes: bytes.length, checksum: crypto.createHash('sha256').update(bytes).digest('hex'), inserted: [...sourceIds].filter(id => !currentIds.has(id)).length, removed: [...currentIds].filter(id => !sourceIds.has(id)).length, retained: [...currentIds].filter(id => sourceIds.has(id)).length, removedRecordIds: [...currentIds].filter(id => !sourceIds.has(id)).sort() };
    }
    await query('indexes', "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='retractions'");
    await query('constraints', "SELECT conrelid::regclass::text AS owning_table,conname,contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='retractions'::regclass OR confrelid='retractions'::regclass");
    await query('triggers', "SELECT tgname,pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid='retractions'::regclass AND NOT tgisinternal");
    await query('migrations', 'SELECT name,applied_at FROM schema_migrations ORDER BY name DESC LIMIT 8');
    const tracked = (await client.query('SELECT name FROM schema_migrations')).rows.map(row => row.name);
    const expected = JSON.parse(fs.readFileSync(path.join(__dirname, '../lib/db/migrations-manifest.json'))).files;
    report.migrationCoverage = { trackedCount: tracked.length, pending: expected.filter(name => !tracked.includes(name)), extra: tracked.filter(name => !expected.includes(name)) };
    await query('importMaintenance', "SELECT id,job_name,status,started_at,completed_at,records_processed,records_deleted FROM maintenance_runs WHERE job_name ILIKE '%retract%' OR job_name ILIKE '%integrity%' ORDER BY started_at DESC LIMIT 12");
    await query('currentActivity', `SELECT pid,application_name,state,query_start,xact_start,wait_event_type,wait_event,(query ~* '(insert[[:space:]]+into|update|delete[[:space:]]+from|copy|truncate|alter[[:space:]]+table)[[:space:]]+(public[.])?retractions') AS corpus_writer FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND (state<>'idle' OR query ILIKE '%retractions%') ORDER BY query_start DESC LIMIT 25`);
    await query('corpusLocks', "SELECT a.pid,a.application_name,a.state,l.mode,l.granted FROM pg_locks l LEFT JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.relation='retractions'::regclass AND l.pid<>pg_backend_pid()");
    await query('jobExtensions', "SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pgagent')");
    if (report.jobExtensions.some(e => e.extname === 'pg_cron')) await query('postgresCron', 'SELECT jobid,schedule,active FROM cron.job WHERE command ILIKE \'%retract%\'');
    await query('migrationAlert', "SELECT id,alert_type,status,created_at,auto_resolve_key FROM system_alerts WHERE source='instrumentation/migration-drift' ORDER BY created_at DESC LIMIT 6");
    if (report.tables.some(t => t.table_name === 'retraction_dataset')) await query('dataset', 'SELECT generation,source_url,source_checksum,published_at,last_checked_at,row_count,format_version FROM retraction_dataset');
    await client.query('ROLLBACK');
    console.log(JSON.stringify(report, null, 2));
  } finally { await client.end(); }
}
main().catch(error => { console.error(JSON.stringify({ error: 'readonly_preflight_failed', name: error.name, code: error.code, probeKey: error.probeKey })); process.exitCode = 1; });
