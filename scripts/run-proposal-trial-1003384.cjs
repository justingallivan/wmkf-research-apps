/** Owner-approved Request1003384 service-level trial. No HTTP auth bypass, deployment, Request writes, or retry of provider outcomes. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire,registerHooks}=require('node:module');
const root=path.resolve(__dirname,'..');
if(process.argv[2]!=='--approved-request-1003384'||!path.isAbsolute(process.argv[4]||'')){console.log('Usage: node scripts/run-proposal-trial-1003384.cjs --approved-request-1003384 <check|publish|admit|tick|inspect|expire> <private-state-directory>');process.exit(2);}
const dir=process.argv[4];
const mode=process.argv[3];if(!['check','publish','admit','tick','inspect','expire'].includes(mode))throw Error('Explicit mode required');
const req=createRequire(root+'/package.json');
registerHooks({resolve(s,c,next){try{return next(s,c)}catch(e){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(s+'.js',c);throw e;}}});
req('@next/env').loadEnvConfig(root);
const state=JSON.parse(fs.readFileSync(dir+'/state.json','utf8'));
const save=()=>{fs.writeFileSync(dir+'/state.next',JSON.stringify(state,null,2),{mode:0o600});fs.renameSync(dir+'/state.next',dir+'/state.json');};
const candidate=JSON.parse(fs.readFileSync(root+'/docs/plans/SHARED_EXECUTOR_PROPOSAL_TRIAL_INPUTS_2026-11-11.json','utf8'));
if(process.env.VERCEL_ENV||process.env.DYNAMICS_SANDBOX_URL||new URL(process.env.DYNAMICS_URL).hostname!=='wmkf.crm.dynamics.com')throw Error('Unexpected deployment/target');
if(state.trialId!=='6affca32-74e9-4628-ba7a-f4e43aa56b65')throw Error('This runner is pinned to the original trial cohort');
if(state.requestId!=='15d8e475-02d3-f111-a05b-70a8a5b11800'||state.profileId!==2||state.systemUserId!=='29b0de0d-4ff7-ee11-a1fd-000d3a3621c7')throw Error('Unexpected actor/request');
process.env.DATAVERSE_TARGET_INTERLOCK='on';process.env.DATAVERSE_DAL_ENFORCEMENT='on';process.env.DATAVERSE_ALLOW_PROD_READS='yes';
process.env.DYNAMICS_IMPERSONATION_ENABLED='true';
process.env.PROMPT_JOB_TRIAL_ACCESS=JSON.stringify({trialId:state.trialId,requestId:state.requestId,profileId:state.profileId,systemUserId:state.systemUserId,sourcePolicy:'ai-materials-proposal-pi-v1'});
process.env.PROMPT_JOB_NONCE_SECRET=state.nonceSecret;
delete process.env.DATAVERSE_PROD_WRITE_ACK;
delete process.env.DATAVERSE_REHEARSAL_GRANT;
if(['publish','tick'].includes(mode))process.env.DATAVERSE_REHEARSAL_GRANT=JSON.stringify({purpose:'owner-approved-request1003384-profile-tasks-audits',ops:['POST'],entitySets:['wmkf_appsystemsettings','wmkf_ai_prompts','wmkf_ai_runs'],recordIds:[],expiresAt:new Date(Date.now()+15*60*1000).toISOString()});
const pgHost=new URL(process.env.POSTGRES_URL).hostname.replace(/^[^.]+\./,'api.');
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url||input.toString());const method=(options.method||'GET').toUpperCase();
 if(['GET','HEAD'].includes(method))return originalFetch(input,options);
 if(method==='POST'&&url.hostname==='login.microsoftonline.com'&&/\/oauth2\/v2\.0\/token$/.test(url.pathname))return originalFetch(input,options);
 let body;try{body=JSON.parse(options.body)}catch{throw Error('Unexpected non-JSON write');}
 if(method==='POST'&&url.hostname===pgHost&&url.pathname==='/sql'){
  const q=body.query||'';
  if(!/^\s*SELECT\b/i.test(q)&&!(/^\s*INSERT INTO (prompt_publish_audit|api_usage_log)\b/i.test(q)&&['publish','tick'].includes(mode)))throw Error('Unexpected HTTP SQL mutation');
  return originalFetch(input,options);
 }
 let kind;
 if(method==='POST'&&url.hostname==='api.anthropic.com'&&url.pathname==='/v1/messages'&&mode==='tick'){
  if(body.model!=='claude-sonnet-4-6'||body.max_tokens!==1536||state.providerPosts>=2)throw Error('Provider scope/cap violation');
  state.providerPosts++;save();kind='anthropic_message';
 }else if(method==='POST'&&url.hostname==='wmkf.crm.dynamics.com'){
  if(mode==='publish'&&url.pathname==='/api/data/v9.2/wmkf_appsystemsettings'&&body.wmkf_settingkey==='executor.profiles.proposal-staff-trial.v000001'){
   const value=JSON.parse(body.wmkf_settingvalue);if(value.sha256!==candidate.profileHash||JSON.stringify(value.profile)!==JSON.stringify(candidate.profile)&&req('./lib/services/prompt-jobs/profile.js').canonical(value.profile)!==req('./lib/services/prompt-jobs/profile.js').canonical(candidate.profile))throw Error('Profile mismatch');kind='profile_publication';
  }else if(mode==='publish'&&url.pathname==='/api/data/v9.2/wmkf_ai_prompts'){
   const task=candidate.tasks.find(t=>t.name===body.wmkf_ai_promptname);if(!task||body.wmkf_ai_promptbody!==task.body||body.wmkf_ai_promptvariables!==task.variables||body.wmkf_ai_model!==task.model||body.wmkf_ai_maxtokens!==task.maxTokens)throw Error('Task mismatch');kind='task_publication';
  }else if(mode==='tick'&&url.pathname==='/api/data/v9.2/wmkf_ai_runs'){
   if(!state.allowedAuditRunIds?.includes(body.wmkf_ai_runid)||body['wmkf_ai_Request@odata.bind']!==`/akoya_requests(${state.requestId})`||new Headers(options.headers).get('MSCRMCallerID')?.toLowerCase()!==state.systemUserId)throw Error('Audit attribution/scope mismatch');kind='contentfree_audit';
  }
 }
 if(!kind)throw Error('Blocked out-of-scope write: '+url.hostname+url.pathname);
 const index=state.networkWrites.length;state.networkWrites.push({kind,at:new Date().toISOString(),status:'intent'});save();
 const response=await originalFetch(input,options);state.networkWrites[index].status=response.status;save();return response;
};
(async()=>{
 const {withDalContext}=req('./lib/dataverse/core/context.js');
 await withDalContext('owner-approved-proposal-trial-1003384',async()=>{
  const svc=req('./lib/services/prompt-jobs/staff-service.js');
  if(mode==='expire'){const scope={environment:'local-production',principalKey:'profile:'+state.profileId,authorizationScope:'proposal-trial:'+state.trialId,requestId:state.requestId};const jobs=await svc.staffJobStore.listJobs({...scope,limit:5});if(jobs.length!==1||jobs[0].job.id!==state.jobId)throw Error('Cleanup scope does not match the retained job');console.log('EXPIRED',await svc.staffJobStore.expireContent({scope}));return;}
  const actor={profileId:state.profileId,systemUserId:state.systemUserId};
  if(await svc.authorizeTrialActor(actor)!==true)throw Error('Actor no longer authorized');
  const policy=req('./lib/services/prompt-jobs/trial-policy.js').readTrialPolicy();
  const scope=req('./lib/services/prompt-jobs/trial-policy.js').scopeForTrial(policy);
  const profiles=req('./lib/services/admin/prompt-profiles-service.js');
  if(mode==='check'){
   const {hashProfile}=req('./lib/services/prompt-jobs/profile.js');if(hashProfile(candidate.profile)!==candidate.profileHash)throw Error('Candidate hash mismatch');
   console.log(JSON.stringify({actorAuthorized:true,environment:policy.environment,profileHash:candidate.profileHash,trialId:state.trialId}));return;
  }
  if(mode==='publish'){
   const result=await profiles.publishPromptProfile({profile:candidate.profile,expectedVersion:0,requestId:state.profilePublicationId,profileId:state.profileId});state.profilePublication={status:result.status,sha256:result.publication.sha256};save();console.log('PROFILE',JSON.stringify(state.profilePublication));
   for(let i=0;i<candidate.tasks.length;i++){
    const t=candidate.tasks[i];const result=await req('./lib/services/admin/prompts-publish-service.js').createPrompt({...t,requestId:state.taskPublicationIds[i],profileId:state.profileId,catalog:{title:i===0?'Proposal executive summary (controlled trial)':'Proposal methodology (controlled trial)',description:'Draft-only Request1003384 architecture trial',usage:'unconnected'}});
    state.taskPublications??=[];state.taskPublications[i]={name:t.name,...result};save();console.log('TASK',JSON.stringify(state.taskPublications[i]));if(!['completed','already_published'].includes(result.status))throw Error('Task publication incomplete');
   }return;
  }
  if(mode==='admit'){
   if(state.jobId)throw Error('Job already admitted; use inspect');
   const source=req('./lib/services/prompt-jobs/proposal-source.js').createProposalSource();const manifest=await source.inspect({requestId:state.requestId});
   const snapshot=await source.prepare({manifest,scope:{environment:scope.environment,authorizationScope:scope.authorizationScope,requestId:scope.requestId},profile:candidate.profile,nonceSecret:state.nonceSecret});
   if(snapshot.documents[0].sha256!==state.sourceHash)throw Error('Approved document bytes changed');
   const {sha256,canonical}=req('./lib/services/prompt-jobs/profile.js');state.expectedSnapshotHash=sha256(canonical(snapshot));state.approvedManifest=manifest;save();
   const result=await svc.admitStaffJob({requestId:state.requestId,actor,idempotencyKey:state.idempotencyKey});state.jobId=result.job.id;state.admittedAt=new Date().toISOString();save();console.log('ADMITTED',JSON.stringify(result));return;
  }
  if(mode==='tick'){
   if(!state.jobId)throw Error('No admitted job');
   const {assertDataverseOperationAllowed}=req('./lib/dataverse/core/interlock.js');
   assertDataverseOperationAllowed({url:'https://wmkf.crm.dynamics.com/api/data/v9.2/wmkf_ai_runs',method:'POST',callerLabel:'approved-trial-audit-preflight'});
   let requestWriteDenied=false;try{assertDataverseOperationAllowed({url:'https://wmkf.crm.dynamics.com/api/data/v9.2/akoya_requests('+state.requestId+')',method:'PATCH',callerLabel:'approved-trial-negative-policy-check'});}catch{requestWriteDenied=true;}if(!requestWriteDenied)throw Error('Request write policy unexpectedly permits mutation');
   const views=await svc.staffJobStore.listJobs({...scope,limit:5});if(views.length!==1||views[0].job.id!==state.jobId)throw Error('Unexpected cohort');
   const job=views[0].job;
   if(job.snapshot_content_id){if(!job.snapshot_hash||job.snapshot_hash!==state.expectedSnapshotHash)throw Error('Stored snapshot differs from pre-admission source');console.log('SNAPSHOT_FENCE',JSON.stringify({jobId:job.id,version:job.version,hash:job.snapshot_hash,matched:true}));}
   else if(job.snapshot_hash||state.stages.some(s=>s.stage==='snapshot_saved')||views[0].attempts.length)throw Error('Expected prepared snapshot is missing');
   state.allowedAuditRunIds=views[0].attempts.map(a=>a.audit_run_id);save();
   const start=Date.now();const result=await req('./lib/services/prompt-jobs/staff-worker.js').runStaffJobTick();state.stages.push({...result,elapsedMs:Date.now()-start,at:new Date().toISOString()});save();console.log('STAGE',JSON.stringify(state.stages.at(-1)));return;
  }
  const status=await svc.readStaffJob({requestId:state.requestId,jobId:state.jobId,actor});
  const result=await svc.readStaffResults({requestId:state.requestId,jobId:state.jobId,actor});
  const [view]=await svc.staffJobStore.listJobs({...scope,limit:1});
  const report={...status,snapshotHash:view.job.snapshot_hash,approvedSnapshotHash:state.expectedSnapshotHash,snapshotHashMatches:view.job.snapshot_hash===state.expectedSnapshotHash,expiresAt:result.expiresAt,results:result.results.map(r=>({taskKey:r.taskKey,status:r.status,...(r.text?{words:r.text.trim().split(/\s+/).length,chars:r.text.length,sha256:crypto.createHash('sha256').update(r.text).digest('hex')}:{})})),attempts:view.attempts.map(a=>({id:a.id,taskId:a.task_id,state:a.state,auditRunId:a.audit_run_id,auditState:a.audit_state,usage:a.usage,usageComplete:a.usage_complete})),providerPosts:state.providerPosts,networkWrites:state.networkWrites};
  report.auditReadback=[];
  for(const a of report.attempts.filter(a=>['delivered','unknown'].includes(a.auditState))){
   const row=await req('./lib/dataverse/adapters/ai-run.js').getByIdWithSelect(a.auditRunId,'wmkf_ai_runid,wmkf_ai_status,wmkf_ai_runsource,wmkf_ai_model,wmkf_ai_promptversion,_wmkf_ai_prompt_value,_wmkf_ai_request_value,_createdby_value,_createdonbehalfby_value,createdon,wmkf_ai_rawoutput,wmkf_ai_promptoverride,wmkf_ai_notes');
   report.auditReadback.push({id:row.wmkf_ai_runid,status:row.wmkf_ai_status,runSource:row.wmkf_ai_runsource,model:row.wmkf_ai_model,promptVersion:row.wmkf_ai_promptversion,promptId:row._wmkf_ai_prompt_value,requestId:row._wmkf_ai_request_value,createdBy:row._createdby_value,createdOnBehalfBy:row._createdonbehalfby_value,createdOn:row.createdon,rawOutputAbsent:row.wmkf_ai_rawoutput==null,promptOverrideAbsent:row.wmkf_ai_promptoverride==null,notes:row.wmkf_ai_notes});
   if(row.wmkf_ai_rawoutput!=null||row.wmkf_ai_promptoverride!=null)throw Error('Unexpected audit content retention');
   if(row._wmkf_ai_request_value!==state.requestId||row._createdby_value!==state.systemUserId)throw Error('Audit readback attribution mismatch');
  }
  fs.writeFileSync(dir+'/receipt.json',JSON.stringify(report,null,2),{mode:0o600});
  fs.writeFileSync(dir+'/drafts.md','# Request 1003384 — trial draft requiring review\n\nThe first-line PI affiliation/collaborator association is unverified. This export preserves the generated text; it is not approved for publication. The methodology response was truncated and is withheld.\n\n'+result.results.filter(r=>r.status==='available').map(r=>'# '+r.taskKey+'\n\n'+r.text+'\n').join('\n'),{mode:0o600});
  console.log('RECEIPT',JSON.stringify(report));
 });
})().then(()=>process.exit(0)).catch(e=>{console.error('TRIAL_STOP',e.code||'',e.message);process.exit(1);});
