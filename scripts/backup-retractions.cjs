#!/usr/bin/env node
/** Authorized scoped production backup: pg_dump of retractions + owned sequence.
 * Production is read-only; synchronized exported snapshot binds verification
 * hashes to archive bytes. Local artifacts are private and Git-ignored. Never
 * starts the app or authenticates an agent CLI. Restore is a separate local task.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const dotenv = require('dotenv');
const { Client } = require('pg');
const { withVerifyFullSslmode } = require('../lib/db/pg-connection-string');
const run = promisify(execFile);
async function fingerprint(client) {
  await client.query("SET LOCAL timezone='UTC'");
  const hash = crypto.createHash('sha256'); let count = 0, last = 0;
  while (true) {
    const batch = (await client.query('SELECT id,row_to_json(r)::text AS row FROM public.retractions r WHERE id>$1 ORDER BY id LIMIT 2000', [last])).rows;
    if (!batch.length) break;
    for (const row of batch) { hash.update(row.row+'\n'); count++; last = row.id; }
  }
  const columns = (await client.query("SELECT column_name,data_type,udt_name,character_maximum_length,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='retractions' ORDER BY ordinal_position")).rows;
  const indexes = (await client.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='retractions' ORDER BY indexname")).rows;
  const constraints = (await client.query("SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.retractions'::regclass AND contype<>'n' ORDER BY conname")).rows;
  const sequence = (await client.query('SELECT last_value::text,is_called FROM public.retractions_id_seq')).rows[0];
  return { count, maxId: last, rowsSha256: hash.digest('hex'), columns, indexes, constraints, sequence };
}
async function main() {
  const root = path.resolve(__dirname, '..');
  const env = { ...dotenv.parse(fs.readFileSync(path.join(root, '.env.local'))), ...process.env };
  const url = new URL(env.POSTGRES_URL_NON_POOLING);
  if (env.NEON_PROJECT_ID !== 'falling-surf-05640504' || url.hostname !== 'ep-frosty-credit-afovxswa.c-2.us-west-2.aws.neon.tech' || url.pathname !== '/neondb') throw new Error('backup_target_mismatch');
  const output = process.argv.find(arg => arg.startsWith('--output-dir='))?.slice('--output-dir='.length);
  if (!output || !path.isAbsolute(output) || fs.existsSync(output)) throw new Error('new_absolute_backup_directory_required');
  fs.mkdirSync(output, { recursive: true, mode: 0o700 }); fs.chmodSync(output, 0o700);
  fs.writeFileSync(path.join(output, '.gitignore'), '*\n', { mode: 0o600 });
  const archive = path.join(output, 'retractions.dump');
  const linked = path.dirname(execFileSync('git', ['rev-parse','--path-format=absolute','--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim());
  execFileSync('git', ['check-ignore', '--quiet', archive], { cwd: linked });
  const client = new Client({ connectionString: withVerifyFullSslmode(env.POSTGRES_URL_NON_POOLING), application_name: 'integrity-backup-snapshot', connectionTimeoutMillis: 10000, query_timeout: 30000 });
  try {
    await client.connect(); await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='20s'"); await client.query("SET LOCAL lock_timeout='5s'");
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    const before = await fingerprint(client);
    const pgEnv = Object.fromEntries(['HOME','PATH','TMPDIR','LANG','LC_ALL'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    Object.assign(pgEnv, { PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: 'neondb', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'verify-full', PGSSLROOTCERT: 'system', PGAPPNAME: 'integrity-scoped-backup', PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=5000' });
    const dump = '/opt/homebrew/opt/libpq/bin/pg_dump';
    const result = await run(dump, ['--format=custom','--table=public.retractions','--table=public.retractions_id_seq','--no-owner','--no-privileges','--lock-wait-timeout=5s',`--snapshot=${snapshot}`,`--file=${archive}`], { env: pgEnv, timeout: 180000, maxBuffer: 1024*1024 });
    if (result.stderr.trim()) throw new Error('backup_emitted_warning_inspect_private_stderr');
    fs.chmodSync(archive, 0o600);
    const afterSequence = (await client.query('SELECT last_value::text,is_called FROM public.retractions_id_seq')).rows[0];
    if (JSON.stringify(before.sequence) !== JSON.stringify(afterSequence)) throw new Error('backup_sequence_changed_retry_in_quiet_window');
    await client.query('ROLLBACK');
    const listing = (await run('/opt/homebrew/opt/libpq/bin/pg_restore',['--list',archive])).stdout;
    for (const expected of ['TABLE DATA public retractions','SEQUENCE SET public retractions_id_seq','INDEX public idx_retractions_authors_gin']) if (!listing.includes(expected)) throw new Error('backup_contents_incomplete');
    fs.writeFileSync(path.join(output,'archive-list.txt'),listing,{mode:0o600});
    const manifest = { createdAt: new Date().toISOString(), target: { project: env.NEON_PROJECT_ID, host: url.hostname, database: 'neondb' }, scope: ['public.retractions','public.retractions_id_seq'], tool: execFileSync(dump,['--version'],{encoding:'utf8'}).trim(), archiveBytes: fs.statSync(archive).size, archiveSha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), fingerprint: before, restoreVerified: false };
    fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
    console.log(JSON.stringify({ directory: output, count: before.count, archiveBytes: manifest.archiveBytes, archiveSha256: manifest.archiveSha256, rowsSha256: before.rowsSha256, sequence: before.sequence, restoreVerified: false }, null, 2));
  } finally { await client.end(); }
}
if (require.main === module) main().catch(error => { console.error(JSON.stringify({ error:'scoped_backup_failed',name:error.name,code:error.code })); process.exitCode=1; });
module.exports = { fingerprint };
