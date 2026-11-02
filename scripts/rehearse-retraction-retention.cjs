#!/usr/bin/env node
/** Apply pending 092 and rehearse the actual first refresh on a restored,
 * explicitly named loopback database only. Never loads application credentials.
 * Requires the scoped backup to have already been restored and verified.
 */
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { fingerprint } = require('./backup-retractions.cjs');
const { refreshRetractions } = require('../lib/services/retraction-refresh-service');
async function main() {
  const raw = process.env.RETRACTION_RESTORE_TEST_URL;
  const source = process.argv.find(a=>a.startsWith('--source-csv='))?.slice('--source-csv='.length);
  const backup = process.argv.find(a=>a.startsWith('--backup-dir='))?.slice('--backup-dir='.length);
  if (!raw || !source || !backup) throw new Error('explicit_restore_source_and_backup_required');
  const url = new URL(raw);
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || !/^\/integrity_restore_[a-z0-9_]+$/.test(url.pathname)) throw new Error('loopback_restore_target_required');
  const manifest = JSON.parse(fs.readFileSync(path.join(backup,'manifest.json')));
  if (!manifest.restoreVerified) throw new Error('verified_restore_required');
  const pool = new Pool({connectionString:raw,max:2});
  try {
    const original = await pool.query("SELECT id,record_id FROM retractions WHERE record_id IN ('13045','67801') ORDER BY record_id");
    const client=await pool.connect();
    try { await client.query('BEGIN READ ONLY');const snapshot=await fingerprint(client);await client.query('ROLLBACK');if(snapshot.rowsSha256!==manifest.fingerprint.rowsSha256)throw new Error('restored_snapshot_mismatch'); } finally {client.release();}
    await pool.query(fs.readFileSync(path.join(__dirname,'../lib/db/migrations/092_retraction_dataset.sql'),'utf8'));
    await pool.query('CREATE TABLE maintenance_runs(id SERIAL PRIMARY KEY,job_name TEXT,status TEXT,records_processed INT,records_deleted INT,details JSONB,error_message TEXT,started_at TIMESTAMP DEFAULT NOW(),completed_at TIMESTAMP,duration_ms INT)');
    const deps={pool,csvFile:source,alert:async()=>{}};
    const dryRun=await refreshRetractions({dryRun:true},deps);
    const publication=await refreshRetractions({},deps);
    const first=(await pool.query('SELECT * FROM retraction_dataset')).rows[0];
    const unchanged=await refreshRetractions({},deps);
    const after=(await pool.query('SELECT * FROM retraction_dataset')).rows[0];
    const retained=(await pool.query("SELECT id,record_id FROM retractions WHERE record_id IN ('13045','67801') ORDER BY record_id")).rows;
    if(JSON.stringify(original.rows)!==JSON.stringify(retained)||publication.count!==73521||publication.sourceCount!==73519||publication.retainedCount!==2||publication.removed!==13||unchanged.status!=='unchanged'||first.generation!==after.generation||first.published_at.getTime()!==after.published_at.getTime())throw new Error('retention_rehearsal_mismatch');
    console.log(JSON.stringify({dryRun:{count:dryRun.count,sourceCount:dryRun.sourceCount,retainedCount:dryRun.retainedCount,inserted:dryRun.inserted,changed:dryRun.changed,removed:dryRun.removed},publication:{status:publication.status,generation:publication.generation,sourceChecksum:publication.checksum,count:publication.count,sourceCount:publication.sourceCount,retainedCount:publication.retainedCount,durationMs:publication.durationMs},retained,retainedRecords:first.retained_records,unchanged:unchanged.status,productionWrites:false},null,2));
  } finally {await pool.end();}
}
main().catch(error=>{console.error(JSON.stringify({error:'retention_rehearsal_failed',name:error.name,code:error.code}));process.exitCode=1;});
