#!/usr/bin/env node
'use strict';
/** Read-only hosted Meeting Tracker preflight. Never prints credentials, tokens or application records.
 * Usage: node scripts/probe-meeting-hosted-rehearsal.cjs <preview-env-file> [local-env-file]
 * Reads only the tracked sandbox's entity metadata; refuses production Dataverse as the probe target.
 */
const fs=require('node:fs');
const {parseEnv}=require('node:util');
const path=require('node:path');
const SANDBOX='https://orgd9e66399.crm.dynamics.com';
const ENTITIES=['akoya_request','wmkf_sitevisit','wmkf_requestdocument','wmkf_appsystemsetting','systemuser','email','wmkf_ai_run'];
const FLAGS=['DATAVERSE_TARGET_INTERLOCK','DATAVERSE_ALLOW_PROD_READS','DATAVERSE_DAL_ENFORCEMENT','DYNAMICS_IMPERSONATION_ENABLED','SITE_VISIT_LOGISTICS_SCHEMA_READY','MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY','MEETING_TRACKER_TRANSCRIPTION_ACCESS','MEETING_MATERIAL_PREPARATION_ACCESS','MEETING_PRESENTATION_INVITATION_ACCESS','MEETING_MANUAL_VIDEO_PAIRING_ACCESS','PRESENTATION_VIDEO_SPLIT_ACCESS','POST_PRESENTATION_MATERIALS_ACCESS'];
const valid=value=>Boolean(value)&&value!=='[SENSITIVE]';
const safeFlag=value=>!value?'(unset or empty)':/^(on|off|yes|no|true|false|test:[a-f0-9-]{36})$/i.test(value)?value:'(unrecognized; redacted)';
const host=value=>{try{return new URL(value).hostname.toLowerCase().replace(/-pooler(?=\.)/,'');}catch{return null;}};
async function main(){
 const preview=parseEnv(fs.readFileSync(process.argv[2],'utf8'));
 const local=parseEnv(fs.readFileSync(process.argv[3]||path.join(__dirname,'..','.env.local'),'utf8'));
 const report={at:new Date().toISOString(),branch:'codex/session-start-20261023',mode:'read-only preflight',preview:{databaseHost:host(preview.POSTGRES_URL||preview.DATABASE_URL),dataverseHost:host(preview.DYNAMICS_URL),sameDatabaseAsLocal:host(preview.POSTGRES_URL||preview.DATABASE_URL)===host(local.POSTGRES_URL||local.DATABASE_URL),sameDataverseAsLocal:host(preview.DYNAMICS_URL)===host(local.DYNAMICS_URL),flags:Object.fromEntries(FLAGS.map(key=>[key,safeFlag(preview[key])])),credentialsAvailable:Object.fromEntries(['UPLOADS_BLOB_RW_TOKEN','ZOOM_S2S_ACCOUNT_ID','ZOOM_S2S_CLIENT_ID','ZOOM_S2S_CLIENT_SECRET','ASSEMBLYAI_API_KEY','CRON_SECRET'].map(key=>[key,valid(preview[key])]))},sandbox:{host:new URL(SANDBOX).hostname,entities:[]}};
 const credentials=['DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET'];
 if(!credentials.every(key=>valid(local[key]))){report.sandbox.authentication='credentials_unavailable';console.log(JSON.stringify(report,null,2));return;}
 const response=await fetch(`https://login.microsoftonline.com/${local.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:local.DYNAMICS_CLIENT_ID,client_secret:local.DYNAMICS_CLIENT_SECRET,scope:`${SANDBOX}/.default`}),signal:AbortSignal.timeout(20000)});
 report.sandbox.authenticationHttpStatus=response.status;
 if(!response.ok){console.log(JSON.stringify(report,null,2));return;}
 const token=(await response.json()).access_token;
 for(const logicalName of ENTITIES){const result=await fetch(`${SANDBOX}/api/data/v9.2/EntityDefinitions(LogicalName='${logicalName}')?$select=LogicalName,EntitySetName`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(20000)});report.sandbox.entities.push({logicalName,httpStatus:result.status,present:result.ok});await result.arrayBuffer();}
 report.sandbox.attributes=[];
 for(const [entity,required] of [['wmkf_sitevisit',['wmkf_attendeerefsjson','wmkf_ianatimezone','wmkf_locationorlink','wmkf_visitformat']],['wmkf_requestdocument',['wmkf_transcriptbundlejson','wmkf_lifecyclestate','wmkf_operationstatus','wmkf_inputfingerprint']]]){
  const result=await fetch(`${SANDBOX}/api/data/v9.2/EntityDefinitions(LogicalName='${entity}')/Attributes?$select=LogicalName`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
  const names=result.ok?new Set((await result.json()).value?.map(row=>row.LogicalName)||[]):new Set();
  report.sandbox.attributes.push({entity,httpStatus:result.status,requiredPresent:required.filter(name=>names.has(name)),requiredMissing:required.filter(name=>!names.has(name))});
 }
 report.sandbox.requiredMetadataPresent=report.sandbox.entities.every(row=>row.present)&&report.sandbox.attributes.every(row=>row.httpStatus===200&&!row.requiredMissing.length);
 console.log(JSON.stringify(report,null,2));
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({code:error?.code||error?.name||'preflight_failed'}));process.exitCode=1;});
