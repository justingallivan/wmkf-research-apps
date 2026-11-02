#!/usr/bin/env node
/** Owner-authorized migration 092 only. Fences the production app target,
 * verifies the existing scoped backup still matches, refuses any other pending
 * migration, invokes the canonical runner, and reads back corpus/schema state.
 * Never imports data, enables a flag, merges code or invokes the worker.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const dotenv = require('dotenv');
const { Client } = require('pg');
const { withVerifyFullSslmode } = require('../lib/db/pg-connection-string');
const { fingerprint } = require('./backup-retractions.cjs');
async function main() {
  if (!process.argv.includes('--apply-approved-092')) throw new Error('explicit_approved_migration_required');
  const root = path.resolve(__dirname,'..');
  const backup = process.argv.find(a=>a.startsWith('--backup-dir='))?.slice('--backup-dir='.length);
  if (!backup) throw new Error('verified_backup_required');
  const manifest=JSON.parse(fs.readFileSync(path.join(backup,'manifest.json')));
  const proof=JSON.parse(fs.readFileSync(path.join(backup,'restore-verification.json')));
  const archiveHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(backup,'retractions.dump'))).digest('hex');
  if(!manifest.restoreVerified||proof.archiveSha256!==manifest.archiveSha256||archiveHash!==manifest.archiveSha256)throw new Error('backup_verification_mismatch');
  const env={...dotenv.parse(fs.readFileSync(path.join(root,'.env.local'))),...process.env};
  const target=new URL(env.POSTGRES_URL_NON_POOLING);
  if(env.NEON_PROJECT_ID!=='falling-surf-05640504'||target.hostname!=='ep-frosty-credit-afovxswa.c-2.us-west-2.aws.neon.tech'||target.pathname!=='/neondb')throw new Error('migration_target_mismatch');
  const client=new Client({connectionString:withVerifyFullSslmode(env.POSTGRES_URL_NON_POOLING),application_name:'integrity-approved-migration-092',connectionTimeoutMillis:10000,query_timeout:30000});
  try{
    await client.connect();await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='20s'");
    const tracked=(await client.query('SELECT name FROM schema_migrations')).rows.map(r=>r.name);
    const files=fs.readdirSync(path.join(root,'lib/db/migrations')).filter(f=>f.endsWith('.sql')).sort();
    const pending=files.filter(name=>!tracked.includes(name));
    if(JSON.stringify(pending)!==JSON.stringify(['092_retraction_dataset.sql']))throw new Error('unexpected_pending_migrations');
    const before=await fingerprint(client);
    if(before.rowsSha256!==manifest.fingerprint.rowsSha256||before.count!==manifest.fingerprint.count||JSON.stringify(before.sequence)!==JSON.stringify(manifest.fingerprint.sequence))throw new Error('backup_no_longer_matches_live_corpus');
    const locks=(await client.query("SELECT 1 FROM pg_locks WHERE relation='retractions'::regclass AND pid<>pg_backend_pid() LIMIT 1")).rows;
    if(locks.length)throw new Error('corpus_lock_present');
    await client.query('ROLLBACK');
    const output=await promisify(execFile)(process.execPath,['scripts/apply-migrations.js'],{cwd:root,env:{...env,POSTGRES_URL:withVerifyFullSslmode(env.POSTGRES_URL_NON_POOLING),APPLY_MIGRATIONS_APPLIED_BY:'owner-approved-integrity-rollout-2026-11-02'},timeout:120000,maxBuffer:1024*1024});
    fs.writeFileSync('/private/tmp/integrity-migration-092.log',output.stdout+output.stderr,{mode:0o600});
    await client.query('BEGIN READ ONLY');
    const after=await fingerprint(client);
    const tracker=(await client.query("SELECT name,applied_at,applied_by FROM schema_migrations WHERE name='092_retraction_dataset.sql'")).rows[0];
    const columns=(await client.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND ((table_name='retractions' AND column_name IN ('publisher','subject')) OR table_name='retraction_dataset') ORDER BY table_name,column_name")).rows;
    const rows=(await client.query('SELECT COUNT(*)::int AS count FROM retraction_dataset')).rows[0].count;
    await client.query('ROLLBACK');
    if(after.rowsSha256!==before.rowsSha256||after.count!==before.count||!tracker||rows!==0||columns.filter(c=>['publisher','subject'].includes(c.column_name)&&c.data_type==='text').length!==2)throw new Error('migration_readback_mismatch');
    console.log(JSON.stringify({migration:tracker,columns,corpusCount:after.count,corpusRowsSha256:after.rowsSha256,corpusUnchanged:true,datasetRows:rows,publicationPerformed:false},null,2));
  }finally{await client.end();}
}
main().catch(error=>{console.error(JSON.stringify({error:'approved_migration_failed',name:error.name,code:error.code}));process.exitCode=1;});
