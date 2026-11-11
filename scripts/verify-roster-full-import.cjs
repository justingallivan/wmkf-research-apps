#!/usr/bin/env node
/** Read-only verification of the dedicated full-import rehearsal.
 * Usage: PRIVATE_EVIDENCE_DIR NEW_OUTPUT_JSON [PREVIOUS_VERIFICATION_JSON]
 * Fixed private inputs: full.env, inventory/source.json, inventory/postgres-evidence.json,
 * full-mapping.json, full-reviewed-plan.json, target-before.json, full-import-receipt.json.
 * Never prints personal rows; output is exclusive mode 0600. No application-UAT claim.
 */
const fs=require('node:fs');
const path=require('node:path');
const {fingerprint,planImport}=require('./lib/expertise-roster-import-plan.cjs');
const {assertTarget}=require('../lib/services/expertise-finder/roster-rehearsal-target.cjs');
function check(ok,message){if(!ok)throw Error(message);}
function verify({source,mapping,reviewed,receipt,before,evidence,target,sql,previous}){
 check(receipt.success===true&&receipt.bridgeCommitted===true,'Import did not commit');
 check(fingerprint(source)===reviewed.sourceHash&&fingerprint(mapping)===reviewed.mappingHash,'Reviewed input hashes differ');
 check(receipt.sourceHash===reviewed.sourceHash&&receipt.mappingHash===reviewed.mappingHash,'Receipt input hashes differ');
 const plan=planImport(source,target,mapping,[target.targetHost]);
 check(!plan.blocked&&plan.summary.create===0,'Target values do not match all planned profiles');
 const included=plan.rows.filter(r=>r.action!=='exclude');
 check(receipt.rows.length===plan.rows.length,'Receipt row count differs');
 const expectedIds=source.rows.map(r=>r.id),expectedBindings=[];
 let high=source.sequenceHighWater;
 for(const row of plan.rows){
  const matches=receipt.rows.filter(r=>r.creationKey===row.creationKey);
  check(matches.length===1,'Receipt key missing or duplicate');const r=matches[0];
  const id=row.legacyId===null?++high:row.legacyId;
  check(r.rosterId===id,'Numeric identity differs');
  if(row.legacyId===null)expectedIds.push(id);
  if(row.action==='exclude')check(r.status==='identity-only'&&!r.profileGuid,'Excluded identity has profile');
  else {check(r.status==='bound'&&r.profileGuid===row.profileGuid,'Receipt profile binding differs');expectedBindings.push({roster_id:id,target_host:target.targetHost,dataverse_profile_guid:row.profileGuid});}
 }
 const sortId=rows=>[...rows].sort((a,b)=>a.roster_id-b.roster_id);
 check(fingerprint(sql.identities.map(r=>r.id).sort((a,b)=>a-b))===fingerprint(expectedIds.sort((a,b)=>a-b)),'Identity census differs');
 check(fingerprint(sortId(sql.bindings))===fingerprint(sortId(expectedBindings)),'Binding census differs');
 check(fingerprint(sql.roster)===fingerprint(source.rows),'Original local source rows changed');
 const refs=rows=>rows.map(r=>({id:String(r.id),consultant_roster_id:r.consultant_roster_id})).sort((a,b)=>Number(a.id)-Number(b.id));
 check(fingerprint(refs(sql.feedback))===fingerprint(refs(evidence.feedback)),'Feedback references changed');
 check(Number(sql.sequence.last_value)===high&&sql.sequence.is_called===true,'Roster sequence differs');
 const feedbackHigh=Math.max(...evidence.feedback.map(r=>Number(r.id)));
 check(Number(sql.feedbackSequence.last_value)===feedbackHigh&&sql.feedbackSequence.is_called===true,'Feedback sequence differs');
 check(target.profiles.length===before.profiles.length+included.length,'Unexpected target profile count');
 for(const prior of before.profiles){const now=target.profiles.find(p=>p.profileGuid===prior.profileGuid);check(now&&fingerprint(now)===fingerprint(prior),'Preexisting sandbox profile changed');}
 for(const p of target.profiles)check(typeof p.values['@odata.etag']==='string','Missing ETag evidence');
 const snapshot={profiles:[...target.profiles].sort((a,b)=>a.profileGuid.localeCompare(b.profileGuid)),identities:sql.identities,bindings:sortId(sql.bindings),roster:sql.roster,feedback:sql.feedback,sequence:sql.sequence,feedbackSequence:sql.feedbackSequence};
 const stateHash=fingerprint(snapshot);
 if(previous)check(previous.success===true&&previous.sourceHash===reviewed.sourceHash&&previous.mappingHash===reviewed.mappingHash&&previous.stateHash===stateHash,'Replay changed persisted state');
 return {success:true,sourceHash:reviewed.sourceHash,mappingHash:reviewed.mappingHash,stateHash,counts:{source:source.rows.length,profiles:included.length,identities:sql.identities.length,bindings:sql.bindings.length,feedback:sql.feedback.length,totalSandboxProfiles:target.profiles.length},sequence:high,replayStable:!!previous,snapshot};
}
async function main(args){
 check(args.length===2||args.length===3,'PRIVATE_DIR NEW_OUTPUT [PREVIOUS_OUTPUT] required');
 const [dir,out,prior]=args,read=name=>JSON.parse(fs.readFileSync(path.join(dir,name)));
 const env={...process.env,...require('dotenv').parse(fs.readFileSync(path.join(dir,'full.env')))};
 const guarded=assertTarget(env);check(env.NODE_ENV!=='production'&&!env.VERCEL_ENV,'Local rehearsal only');
 const input={source:read('inventory/source.json'),mapping:read('full-mapping.json'),reviewed:read('full-reviewed-plan.json'),receipt:read('full-import-receipt.json'),before:read('target-before.json'),evidence:read('inventory/postgres-evidence.json'),previous:prior?JSON.parse(fs.readFileSync(prior)):null};
 const fd=fs.openSync(out,'wx',0o600);let pg;
 try{
  for(const key of ['DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET','DATAVERSE_TARGET_INTERLOCK','DATAVERSE_DAL_ENFORCEMENT']){check(env[key],`Missing ${key}`);process.env[key]=env[key];}
  const {createClient,getAccessToken}=require('../lib/dataverse/client.js');
  const live=createClient({resourceUrl:env.DYNAMICS_URL,token:await getAccessToken(env.DYNAMICS_URL)});
  const client={raw(method,...rest){check(method==='GET','Verification forbids Dataverse writes');return live.raw(method,...rest);}};
  const {createStore}=require('./lib/expertise-roster-import-store.cjs');
  input.target=await createStore({env,client,pg:null}).readTarget();
  const {Client}=require('pg');pg=new Client({connectionString:guarded.connectionString,connectionTimeoutMillis:10000});await pg.connect();
  await pg.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const identity=(await pg.query('SELECT current_database() AS database,current_user AS username')).rows[0];
  check(identity.database==='roster_rehearsal'&&identity.username==='roster_rehearsal','Database identity differs');
  input.sql={};
  for(const [key,query] of Object.entries({identities:'SELECT * FROM expertise_roster_identity ORDER BY id',bindings:'SELECT * FROM expertise_roster_binding ORDER BY roster_id,target_host',roster:'SELECT * FROM expertise_roster ORDER BY id',feedback:'SELECT * FROM consultant_feedback ORDER BY id',sequence:'SELECT last_value,is_called FROM expertise_roster_id_seq',feedbackSequence:'SELECT last_value,is_called FROM consultant_feedback_id_seq'})){
   const rows=JSON.parse(JSON.stringify((await pg.query(query)).rows));input.sql[key]=key.endsWith('Sequence')||key==='sequence'?rows[0]:rows;
  }
  await pg.query('ROLLBACK');
  const result=verify(input);fs.writeSync(fd,JSON.stringify(result,null,2)+'\n');fs.fsyncSync(fd);
  console.log(JSON.stringify({success:result.success,counts:result.counts,sequence:result.sequence,replayStable:result.replayStable}));return result;
 }finally{fs.closeSync(fd);if(pg)await pg.end();}
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={verify,main};
