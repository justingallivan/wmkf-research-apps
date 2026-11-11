#!/usr/bin/env node
/** Owner-authorized full-import fixture, only in a NEW empty dedicated local DB.
 * Copies the immutable roster snapshot; feedback bodies/requests are synthetic,
 * retaining only exported feedback IDs and roster references. Never changes source.
 * Usage: ENV_FILE SOURCE_JSON POSTGRES_EVIDENCE_JSON NEW_PRIVATE_RECEIPT
 */
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {assertTarget}=require('../lib/services/expertise-finder/roster-rehearsal-target.cjs');
const {fingerprint}=require('./lib/expertise-roster-import-plan.cjs');
const {TEXT}=require('../lib/services/expertise-finder/roster-contract.cjs');
async function main(args){
 if(args.length!==4)throw Error('ENV_FILE SOURCE_JSON POSTGRES_EVIDENCE_JSON NEW_PRIVATE_RECEIPT required');
 const [envFile,sourceFile,evidenceFile,receiptFile]=args;
 const env={...process.env,...require('dotenv').parse(fs.readFileSync(envFile))};
 const target=assertTarget(env);if(env.NODE_ENV==='production'||env.VERCEL_ENV)throw Error('Local fixture only');
 const source=JSON.parse(fs.readFileSync(sourceFile)),evidence=JSON.parse(fs.readFileSync(evidenceFile));
 const columns=['id','name','role_type',...TEXT,'is_active','dataverse_contact_id','created_at','updated_at','created_by','updated_by'];
 const ids=new Set();
 if(source.version!==1||!Array.isArray(source.rows)||!source.rows.length||!Number.isSafeInteger(source.sequenceHighWater))throw Error('Invalid source');
 for(const row of source.rows){
  if(!Number.isSafeInteger(row.id)||row.id<1||ids.has(row.id)||row.id>source.sequenceHighWater)throw Error('Invalid source identities/high-water');ids.add(row.id);
  if(Object.keys(row).some(k=>!columns.includes(k))||columns.some(k=>!Object.hasOwn(row,k)))throw Error('Source columns mismatch');
  for(const key of ['created_at','updated_at'])if(row[key]!==null&&(typeof row[key]!=='string'||!Number.isFinite(new Date(row[key]).getTime())))throw Error('Invalid source timestamp');
 }
 if(!Array.isArray(evidence.feedback)||evidence.feedback.some(f=>!ids.has(f.consultant_roster_id)||!/^\d+$/.test(String(f.id))))throw Error('Invalid feedback references');
 const actorIds=[...new Set([1,...source.rows.flatMap(r=>[r.created_by,r.updated_by]).filter(v=>v!==null)])];
 if(actorIds.some(id=>!Number.isSafeInteger(id)||id<1))throw Error('Invalid audit actor IDs');
 // Reserve the receipt before connecting; never overwrite evidence.
 const fd=fs.openSync(receiptFile,'wx',0o600);
 const save=value=>{fs.ftruncateSync(fd,0);fs.writeSync(fd,JSON.stringify(value,null,2)+'\n',0,'utf8');fs.fsyncSync(fd);};
 const {Client}=require('pg'),pg=new Client({connectionString:target.connectionString,connectionTimeoutMillis:10000});
 let began=false,phase='connect';
 try{
  save({success:false,status:'started',sourceHash:fingerprint(source)});await pg.connect();
  const identity=(await pg.query('SELECT current_database() AS database,current_user AS username')).rows[0];
  if(identity.database!=='roster_rehearsal'||identity.username!=='roster_rehearsal')throw Error('Connected identity mismatch');
  if((await pg.query("SELECT 1 FROM information_schema.tables WHERE table_schema='public' LIMIT 1")).rowCount)throw Error('Database is not empty; no changes made');
  await pg.query('BEGIN');began=true;phase='fixture';
  await pg.query('CREATE TABLE user_profiles(id INTEGER PRIMARY KEY)');
  for(const id of actorIds)await pg.query('INSERT INTO user_profiles(id) VALUES($1)',[id]);
  for(const name of ['004_expertise_finder.sql','048_consultant_feedback.sql','050_expertise_roster_contact_link.sql'])await pg.query(fs.readFileSync(path.join(__dirname,'../lib/db/migrations',name),'utf8'));
  await pg.query('ALTER TABLE expertise_roster ADD COLUMN preferred_email VARCHAR(320)');
  await pg.query(fs.readFileSync(path.join(__dirname,'../docs/plans/data/expertise-roster/identity-bridge.sql'),'utf8'));
  for(const row of source.rows)await pg.query(`INSERT INTO expertise_roster(${columns.join(',')}) VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')})`,columns.map(k=>['created_at','updated_at'].includes(k)&&row[k]!==null?new Date(row[k]):row[k]));
  for(const f of evidence.feedback)await pg.query("INSERT INTO consultant_feedback(id,request_id,consultant_roster_id,body_html,received_on,mutation_id,created_by,updated_by) VALUES($1,$2,$3,'Synthetic dependency rehearsal',CURRENT_DATE,$4,1,1)",[f.id,randomUUID(),f.consultant_roster_id,randomUUID()]);
  const copied=JSON.parse(JSON.stringify((await pg.query('SELECT * FROM expertise_roster ORDER BY id')).rows));
  if(fingerprint(copied)!==fingerprint(source.rows))throw Error('Copied source-row parity mismatch');
  if(evidence.feedback.length){const max=evidence.feedback.reduce((n,f)=>BigInt(f.id)>n?BigInt(f.id):n,0n);await pg.query("SELECT setval('consultant_feedback_id_seq',$1,true)",[String(max)]);}
  await pg.query("SELECT setval('expertise_roster_id_seq',$1,true)",[source.sequenceHighWater]);
  phase='commit';await pg.query('COMMIT');began=false;
  save({success:true,sourceHash:fingerprint(source),rosterRows:source.rows.length,feedbackRows:evidence.feedback.length,sourceSequenceHighWater:source.sequenceHighWater,bridgeRows:0,feedbackContentSynthetic:true,sourceRowParityVerified:true,identity,scope:'Import/dependency fixture; not full application UAT'});
  return {rosterRows:source.rows.length,feedbackRows:evidence.feedback.length};
 }catch(error){let rollbackSucceeded=null;if(began){try{await pg.query('ROLLBACK');rollbackSucceeded=true;}catch{rollbackSucceeded=false;}}
  save({success:false,phase,commitUnknown:phase==='commit',rollbackSucceeded,message:error.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]')});throw error;
 }finally{fs.closeSync(fd);await pg.end();}
}
if(require.main===module)main(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('Full-import fixture failed; inspect private receipt.');process.exitCode=1;});
module.exports={main};
