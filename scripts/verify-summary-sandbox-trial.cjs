#!/usr/bin/env node
/** Read-only bounded ledger/Dataverse proof for the 2026-11-16 Summary trial.
 * --restore clears only the generated Summary to the captured original blank,
 * after exact result/value/ETag verification. --after-restore verifies replay
 * preserved the blank. No provider calls, production access, or receipt deletion.
 */
const fs=require('node:fs'),{createRequire,registerHooks}=require('node:module');
const req=createRequire(`${process.cwd()}/package.json`);
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(`${s}.js`,c);throw e;}}});
const OUT='/private/tmp/wmkf-summary-live-20261116',ORIGIN='https://orgd9e66399.crm.dynamics.com',ID='a92c0f69-90ec-4c24-bc19-f26a0bfc18b6',JOB='ccd99f2b-8d9f-4203-b296-f18ad90d6950';
const mode=process.argv[2]||'--verify';if(!['--verify','--restore','--after-restore'].includes(mode))throw Error('Invalid mode');
const env=JSON.parse(fs.readFileSync(`${OUT}/deployment-env.json`));
const original=JSON.parse(fs.readFileSync(`${OUT}/original.json`));
const creds=req('dotenv').parse(fs.readFileSync('/Users/gallivan/Code/WMKF_Apps/.env.local'));
for(const k of ['DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET','DYNAMICS_TENANT_ID'])process.env[k]=creds[k];
Object.assign(process.env,{DYNAMICS_URL:ORIGIN,DATAVERSE_TARGET_INTERLOCK:'on',DATAVERSE_DAL_ENFORCEMENT:'on',NODE_ENV:'development'});
const native=fetch;let permittedPatch;
global.fetch=(input,o={})=>{const u=new URL(typeof input==='string'?input:input.url),m=(o.method||'GET').toUpperCase();
 if(m==='POST'&&u.origin==='https://login.microsoftonline.com'&&u.pathname.endsWith('/oauth2/v2.0/token'))return native(input,{...o,redirect:'error'});
 if(m==='GET'&&u.origin===ORIGIN)return native(input,{...o,redirect:'error'});
 if(mode==='--restore'&&m==='PATCH'&&u.origin===ORIGIN&&u.pathname===`/api/data/v9.2/akoya_requests(${ID})`&&o.body===permittedPatch&&new Headers(o.headers).get('if-match'))return native(input,{...o,redirect:'error'});
 throw Error('Verification transport denied');};
const emit=process.stdout.write.bind(process.stdout);for(const k of ['log','warn','info','debug'])console[k]=()=>{};
(async()=>{
 const {Client}=req('pg'),c=new Client({connectionString:env.POSTGRES_URL});await c.connect();let result,task,attempt,pub,job,contentDeadlines;
 try{
  await c.query('BEGIN READ ONLY');const {canonical,sha256}=req('./lib/services/prompt-jobs/profile.js');const policy=JSON.parse(env.PROMPT_JOB_SUMMARY_PILOT);
  const ident=(await c.query('SELECT current_database() AS db,system_identifier::text FROM pg_control_system()')).rows[0];if(sha256(JSON.stringify([policy.databaseEndpoint,ident.system_identifier,ident.db]))!==policy.databaseIdentity)throw Error('Wrong database');
  const before=JSON.parse(fs.readFileSync(`${OUT}/db-before.json`));
  const existing=(await c.query('SELECT id,request_id,version,target_etag,authorization_scope,environment,principal_key FROM prompt_jobs WHERE id=ANY($1::uuid[]) ORDER BY id',[before.jobs.map(x=>x.id)])).rows;
  if(canonical(existing)!==canonical(before.jobs))throw Error('Existing Short Title receipts changed');
  job=(await c.query('SELECT id,request_id,version,authorization_scope,source_expires_at,result_expires_at FROM prompt_jobs WHERE id=$1',[JOB])).rows[0];
  if(job?.request_id!==ID||job.authorization_scope!==`pa-executive-summary:${policy.pilotId}`)throw Error('Wrong job scope');
  const tasks=(await c.query('SELECT id,state,writeback_state,error_code,result_content_id,result_hash FROM prompt_job_tasks WHERE job_id=$1',[JOB])).rows;
  const attempts=(await c.query('SELECT a.id,a.attempt_number,a.state,a.audit_state,a.audit_run_id,a.usage,a.usage_complete FROM prompt_job_attempts a JOIN prompt_job_tasks t ON t.id=a.task_id WHERE t.job_id=$1',[JOB])).rows;
  const publications=(await c.query('SELECT id,state,expected_etag,payload_hash FROM prompt_job_publications WHERE job_id=$1',[JOB])).rows;
  if(tasks.length!==1||attempts.length!==1||publications.length!==1)throw Error('Unexpected side-effect counts');
  [task]=tasks;[attempt]=attempts;[pub]=publications;
  if(task.state!=='validated'||task.writeback_state!=='applied'||attempt.audit_state!=='delivered'||pub.state!=='applied')throw Error('Incomplete job');
  const payload=(await c.query('SELECT payload,sha256 FROM prompt_job_content WHERE id=$1',[task.result_content_id])).rows[0];
  result=JSON.parse(payload.payload);if(sha256(payload.payload)!==task.result_hash)throw Error('Result hash mismatch');
  if(typeof result!=='string'||!result.trim()||result.trim().split(/\s+/).length>200)throw Error('Invalid result');
  contentDeadlines=(await c.query('SELECT kind,min(expires_at) AS expires_at,count(*)::int AS rows FROM prompt_job_content WHERE job_id=$1 GROUP BY kind ORDER BY kind',[JOB])).rows;
  await c.query('ROLLBACK');
 }finally{await c.end();}
 const {withDalContext}=req('./lib/dataverse/core/context.js');await withDalContext('approved-summary-trial-verification',async()=>{
  const {getById,updateById}=req('./lib/dataverse/adapters/grant-request.js');const {getByIdWithSelect}=req('./lib/dataverse/adapters/ai-run.js');
  const options={select:'akoya_requestid,akoya_requestnum,wmkf_layabstract,wmkf_wmkfprojectdescription',strictRead:true,expectedOrigin:ORIGIN};
  let row=await getById(ID,options);if(row.akoya_requestnum!=='1000389'||row.wmkf_wmkfprojectdescription!==original.wmkf_wmkfprojectdescription)throw Error('Request/Short Title mismatch');
  const audit=await getByIdWithSelect(attempt.audit_run_id,'wmkf_ai_runid,wmkf_ai_status,wmkf_ai_model,wmkf_ai_notes');if(audit.wmkf_ai_status!==682090000||audit.wmkf_ai_model!=='claude-sonnet-4-6')throw Error('Audit readback mismatch');
  if(mode==='--after-restore'){if(row.wmkf_layabstract!==original.wmkf_layabstract)throw Error('Original Summary not preserved');}
  else if(row.wmkf_layabstract!==result)throw Error('Summary differs from validated result');
  if(mode==='--restore'){
   if(original.wmkf_layabstract!=null&&original.wmkf_layabstract!=='')throw Error('Original Summary not blank');
   fs.writeFileSync(`${OUT}/restore.intent`,JSON.stringify({at:new Date().toISOString(),etag:row._etag}),{flag:'wx',mode:0o600});
   permittedPatch=JSON.stringify({wmkf_layabstract:original.wmkf_layabstract});
   await updateById(ID,{wmkf_layabstract:original.wmkf_layabstract},{ifMatch:row._etag,noFallback:true,expectedOrigin:ORIGIN});
   row=await getById(ID,options);if(row.wmkf_layabstract!==original.wmkf_layabstract)throw Error('Restore readback mismatch');
  }
  const proof={mode,at:new Date().toISOString(),job,task,attempt,pub,contentDeadlines,audit,result,summaryMatches:row.wmkf_layabstract===result,originalRestored:row.wmkf_layabstract===original.wmkf_layabstract,existingShortTitleReceiptsUnchanged:true,shortTitleUnchanged:true};
  fs.writeFileSync(`${OUT}/proof-${mode.slice(2)}.json`,JSON.stringify(proof,null,2),{mode:0o600});
  emit(JSON.stringify({mode,jobId:JOB,oneAttempt:true,auditDelivered:true,publicationApplied:true,words:result.trim().split(/\s+/).length,summaryMatches:proof.summaryMatches,originalRestored:proof.originalRestored,shortTitleUnchanged:true,existingReceiptsUnchanged:true})+'\n');
 });
})().catch(e=>{emit(JSON.stringify({error:e.code||e.name,message:String(e.message).slice(0,160)})+'\n');process.exitCode=1;});
