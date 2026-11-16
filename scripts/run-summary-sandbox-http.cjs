#!/usr/bin/env node
/** Exact-Preview/Request operator for the approved 2026-11-16 Summary trial.
 * Fixed enrolled Request and at most eight sequential worker ticks. GET by default.
 * Secrets come from owner-private files; content-free receipts persist before POST.
 * Any uncertain response leaves pending intent, denying another mutating command.
 */
const fs=require('node:fs');
const {createRequire}=require('node:module');
const req=createRequire(`${process.cwd()}/package.json`);
const OUT='/private/tmp/wmkf-summary-live-20261116';
const BASE='https://wmkfresearchapps-ad6zvrmhv-justin-gallivans-projects.vercel.app';
const env=JSON.parse(fs.readFileSync(`${OUT}/deployment-env.json`));
const policy=JSON.parse(env.PROMPT_JOB_SUMMARY_PILOT);
if(policy.requestId!=='a92c0f69-90ec-4c24-bc19-f26a0bfc18b6'||policy.pilotId!=='ff774f17-bbe0-4bc7-ab7b-9989dd85fc17'||Date.parse(policy.expiresAt)<=Date.now())throw Error('Trial policy mismatch/expired');
const oidc=req('dotenv').parse(fs.readFileSync(`${OUT}/development.env`)).VERCEL_OIDC_TOKEN;
const credential=JSON.parse(fs.readFileSync('/private/tmp/wmkf-pa-entra-credential-20261112.json')).secretText;
if(!oidc||!credential)throw Error('Private credentials unavailable');
const file=`${OUT}/http-state.json`,mode=process.argv[2]||'status';
if(!['auth','admit','tick','status','replay','wrong-request'].includes(mode))throw Error('Invalid mode');
const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{idempotencyKey:'6b154270-c56d-4475-b062-4f257ba68e5e',ticks:0,events:[]};
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2),{mode:0o600});
async function call(path,{method='GET',token,body,key,expectedStatus}={}){
 if(method!=='GET'){if(state.pending)throw Error('Unresolved prior intent: inspect before resuming');state.pending={mode,at:new Date().toISOString()};save();}
 const response=await fetch(BASE+path,{method,redirect:'manual',signal:AbortSignal.timeout(255000),headers:{'x-vercel-trusted-oidc-idp-token':oidc,...(token?{authorization:`Bearer ${token}`} :{}),...(body?{'content-type':'application/json'}:{}),...(key?{'idempotency-key':key}:{})},body:body?JSON.stringify(body):undefined});
 let bodyResult;try{bodyResult=await response.json();}catch{throw Error(`Non-JSON response: ${response.status}`);}
 const result={mode,status:response.status,body:bodyResult,cache:response.headers.get('cache-control'),at:new Date().toISOString()};state.events.push(result);save();
 if(!expectedStatus.includes(response.status))throw Error(`Unexpected HTTP ${response.status}`);
 if(method!=='GET'){state.pending=null;save();}
 console.log(JSON.stringify(result));return bodyResult;
}
(async()=>{
 const response=await fetch(`https://login.microsoftonline.com/${policy.tenantId}/oauth2/v2.0/token`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),body:new URLSearchParams({client_id:policy.clientId,client_secret:credential,scope:`api://${policy.audience}/.default`,grant_type:'client_credentials'})});
 if(!response.ok)throw Error(`Entra HTTP ${response.status}`);const token=(await response.json()).access_token;if(!token)throw Error('No app token');
 if(mode==='auth'){
  const path='/api/automation/summary-jobs/f7a2a5e4-9cc5-4a57-8dab-9e8898049608';
  for(const [t,status,error]of [[null,401,'machine_auth_invalid'],['invalid',401,'machine_auth_invalid'],[token,404,'machine_job_not_found']]){
   const body=await call(path,{token:t,expectedStatus:[status]});if(body.error!==error)throw Error('Unexpected auth result');
  }return;
 }
 if(mode==='status'){if(!state.jobId)throw Error('No admitted job');await call(`/api/automation/summary-jobs/${state.jobId}`,{token,expectedStatus:[200]});return;}
 if(mode==='tick'){
  if(!state.jobId||state.ticks>=8)throw Error('No job or tick bound reached');
  const before=await call(`/api/automation/summary-jobs/${state.jobId}`,{token,expectedStatus:[200]});
  if(!['queued','running'].includes(before.job?.state)||before.job.pollAfterSeconds!==5)throw Error('Job is terminal or requires attention');
  state.ticks++;save();const result=await call('/api/cron/drain-summary-prompt-jobs',{method:'POST',token:env.CRON_SECRET,expectedStatus:[200]});
  if(!['snapshot_saved','target_captured','validated','audit_delivered','published'].includes(result.stage))throw Error('Worker requires attention');
  await call(`/api/automation/summary-jobs/${state.jobId}`,{token,expectedStatus:[200]});return;
 }
 if(mode==='admit'&&state.jobId)throw Error('Job exists: use replay');
 if(mode==='replay'&&!state.jobId)throw Error('No original job');
 const body={requestId:mode==='wrong-request'?'63dab4af-178f-4bbc-b24d-3ccbaf74cbfc':policy.requestId,sourceEventId:policy.sourceEventId,operation:'initialize',taskKeys:['proposal.executive-summary']};
 const result=await call('/api/automation/summary-jobs',{method:'POST',token,body,key:state.idempotencyKey,expectedStatus:mode==='wrong-request'?[403]:[200,202]});
 if(mode==='wrong-request'){if(result.error!=='machine_request_denied')throw Error('Wrong Request result');return;}
 if(!result.job?.jobId||(state.jobId&&state.jobId!==result.job.jobId))throw Error('Job identity mismatch');
 state.jobId=result.job.jobId;save();
})().catch(e=>{console.error(`Summary test stopped: ${e.message}`);process.exitCode=1;});
