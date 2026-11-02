#!/usr/bin/env node
/** Restore ONLY the checksummed scoped backup into an explicitly empty loopback
 * database. No production credential fallback, drops, remote restore or app
 * startup. Compares every row, schema, indexes, constraints and sequence state.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Client } = require('pg');
const { fingerprint } = require('./backup-retractions.cjs');
async function main() {
  const directory = process.argv.find(arg=>arg.startsWith('--backup-dir='))?.slice('--backup-dir='.length);
  const raw = process.env.RETRACTION_RESTORE_TEST_URL;
  if (!directory || !raw) throw new Error('explicit_backup_and_local_restore_target_required');
  const target = new URL(raw);
  if (!['127.0.0.1','localhost','[::1]'].includes(target.hostname) || !/^\/integrity_restore_[a-z0-9_]+$/.test(target.pathname)) throw new Error('restore_requires_named_loopback_database');
  const manifestPath = path.join(directory,'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  const archive = path.join(directory,'retractions.dump');
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (checksum !== manifest.archiveSha256 || JSON.stringify(manifest.scope) !== JSON.stringify(['public.retractions','public.retractions_id_seq'])) throw new Error('backup_scope_or_checksum_mismatch');
  const client = new Client({ connectionString: raw, connectionTimeoutMillis: 5000, query_timeout: 30000 });
  try {
    await client.connect();
    const tables = await client.query("SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')");
    if (tables.rows[0].count !== 0) throw new Error('restore_target_not_empty');
    const env = Object.fromEntries(['HOME','PATH','TMPDIR','LANG','LC_ALL'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
    Object.assign(env,{PGHOST:target.hostname,PGPORT:target.port||'5432',PGDATABASE:target.pathname.slice(1),PGUSER:decodeURIComponent(target.username),PGPASSWORD:decodeURIComponent(target.password),PGAPPNAME:'integrity-isolated-restore'});
    const restored = await promisify(execFile)('/opt/homebrew/opt/libpq/bin/pg_restore',['--exit-on-error','--single-transaction','--no-owner','--no-privileges',`--dbname=${target.pathname.slice(1)}`,archive],{env,timeout:120000,maxBuffer:1024*1024});
    if (restored.stderr.trim()) throw new Error('restore_emitted_warning');
    await client.query('BEGIN READ ONLY');
    const actual = await fingerprint(client);
    await client.query('ROLLBACK');
    // Postgres 18 adds catalog rows for NOT NULL constraints; compare the
    // portable PK/unique/check definitions retained by both versions.
    const expected = manifest.fingerprint;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('restored_fingerprint_mismatch');
    const proof = {verifiedAt:new Date().toISOString(),target:{host:target.hostname,database:target.pathname.slice(1)},archiveSha256:checksum,count:actual.count,rowsSha256:actual.rowsSha256,schemaIndexesConstraintsAndSequenceMatch:true,productionWrites:false};
    fs.writeFileSync(path.join(directory,'restore-verification.json'),JSON.stringify(proof,null,2),{mode:0o600});
    fs.writeFileSync(manifestPath,JSON.stringify({...manifest,restoreVerified:true,restoreVerifiedAt:proof.verifiedAt,restoreProofFile:'restore-verification.json'},null,2),{mode:0o600});
    console.log(JSON.stringify(proof,null,2));
  } finally {await client.end();}
}
main().catch(error=>{console.error(JSON.stringify({error:'isolated_restore_verification_failed',name:error.name,code:error.code}));process.exitCode=1;});
