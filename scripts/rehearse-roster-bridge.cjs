#!/usr/bin/env node
/** Synthetic-only SQL cutover/rollback test; locks only the dedicated local DB. */
const fs=require('fs'),assert=require('node:assert/strict'),{Client}=require('pg');
async function main(){
 const [file]=process.argv.slice(2),env=require('dotenv').parse(fs.readFileSync(file));const raw=env.POSTGRES_URL,u=new URL(raw);
 assert(!u.search&&!u.hash&&u.hostname==='127.0.0.1'&&u.port==='55439'&&u.pathname==='/roster_rehearsal'&&u.username==='roster_rehearsal');
 for(const k of ['DATABASE_URL','POSTGRES_URL_NON_POOLING','POSTGRES_PRISMA_URL'])assert.equal(env[k],raw);
 const pg=new Client({connectionString:raw}),writer=new Client({connectionString:raw,options:'-c lock_timeout=500ms -c statement_timeout=2000ms'});
 await pg.connect();await writer.connect();
 try{
 assert.equal((await pg.query('SELECT count(*)::int n FROM expertise_roster_identity')).rows[0].n,0,'Empty identity fixture required');
 await pg.query('BEGIN');await pg.query('LOCK TABLE expertise_roster IN ACCESS EXCLUSIVE MODE');
 let blocked=false;try{await writer.query("INSERT INTO expertise_roster(name,role_type) VALUES('must be blocked','Consultant')");}catch(e){assert.equal(e.code,'55P03');blocked=true;}assert(blocked,'Old writer must be blocked');
 await pg.query("INSERT INTO expertise_roster(id,name,role_type) VALUES(35,'SYNTHETIC placeholder','Consultant')");
 await pg.query("INSERT INTO consultant_feedback(request_id,consultant_roster_id,body_html,received_on,mutation_id,created_by,updated_by) VALUES('11111111-1111-4111-8111-111111111111',35,'Synthetic historical reference',CURRENT_DATE,'33333333-3333-4333-8333-333333333333',1,1)");
 await pg.query('INSERT INTO expertise_roster_identity(id) SELECT id FROM expertise_roster');
 const fk=(await pg.query("SELECT conname FROM pg_constraint WHERE conrelid='consultant_feedback'::regclass AND confrelid='expertise_roster'::regclass")).rows;
 assert.equal(fk.length,1);assert(/^[a-z0-9_]+$/.test(fk[0].conname));
 await pg.query(`ALTER TABLE consultant_feedback DROP CONSTRAINT "${fk[0].conname}"`);
 await pg.query('ALTER TABLE consultant_feedback ADD CONSTRAINT rehearsal_feedback_identity_fk FOREIGN KEY(consultant_roster_id) REFERENCES expertise_roster_identity(id)');
 await pg.query('DELETE FROM expertise_roster WHERE id=35');
 assert.equal((await pg.query('SELECT count(*)::int n FROM consultant_feedback WHERE consultant_roster_id=35')).rows[0].n,1);
 assert.equal((await pg.query('SELECT count(*)::int n FROM expertise_roster_binding WHERE roster_id=35')).rows[0].n,0);
 await pg.query('ROLLBACK');
 assert.equal((await pg.query('SELECT count(*)::int n FROM expertise_roster_identity')).rows[0].n,0);
 assert.equal((await pg.query("SELECT count(*)::int n FROM pg_constraint WHERE conrelid='consultant_feedback'::regclass AND confrelid='expertise_roster'::regclass")).rows[0].n,1);
 await writer.query('BEGIN');await writer.query("INSERT INTO expertise_roster(name,role_type) VALUES('SYNTHETIC rollback writer','Consultant')");await writer.query('ROLLBACK');
 console.log(JSON.stringify({passed:true,syntheticOnly:true,oldWriterBlocked:true,foreignKeyRetarget:true,excludedProfileRetainsHistoricalNumericIdentity:true,rollbackRestoredOriginalForeignKey:true,oldWriterResumed:true,sequenceNote:'rolled-back inserts may consume sequence values; no real data involved'}));
 }finally{await pg.end();await writer.end();}
}main().catch(e=>{console.error(e.message);process.exitCode=1;});
