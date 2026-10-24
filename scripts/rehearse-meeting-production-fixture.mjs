#!/usr/bin/env node
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required for the dedicated rehearsal only');
/** Owner-authorized, one-request production fixture. No existing account/contact bindings, no email calls, no global settings changes.
 * All writes are constrained to preallocated new IDs. Default is plan-only. Refuses redispatch after an attempted create.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {parseEnv} from 'node:util';
import {loadEnvLocal,getAccessToken,createClient} from '../lib/dataverse/client.js';
import {fenceProductionClient} from '../lib/services/test-requests/production-write-fence.js';
const origin='https://wmkf.crm.dynamics.com',file=process.argv[2],execute=process.argv[3]==='--execute';
if(!file)throw Error('explicit_receipt_required');
loadEnvLocal();process.env.DATAVERSE_ALLOW_PROD_READS='yes';process.env.DATAVERSE_TARGET_INTERLOCK='on';
let receipt=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)): {runId:crypto.randomUUID(),requestId:crypto.randomUUID(),visitId:crypto.randomUUID(),locationId:crypto.randomUUID(),purpose:'meeting-tracker-owned-synthetic-rehearsal',productionOrigin:origin,noExistingBusinessBindings:true,realEmailAllowed:false,requestAttempted:false,requestCreated:false,visitAttempted:false,visitCreated:false};
const save=()=>fs.writeFileSync(file,JSON.stringify(receipt,null,2),{mode:0o600});save();
if(receipt.productionOrigin!==origin||receipt.noExistingBusinessBindings!==true||receipt.realEmailAllowed!==false)throw Error('receipt_scope_mismatch');
process.env.DATAVERSE_REHEARSAL_GRANT=JSON.stringify({purpose:receipt.purpose,ops:['POST'],entitySets:['akoya_requests','wmkf_sitevisits'],recordIds:[receipt.requestId,receipt.visitId],expiresAt:new Date(Date.now()+20*60000).toISOString()});
if(!execute){console.log(JSON.stringify({planOnly:true,...receipt}));process.exit(0);}
const token=await getAccessToken(origin);
// This operator uses the Factory's restricted top-level marker-create contract and existing create fence.
const raw=createClient({resourceUrl:origin,token,allowTestRequestMarkerWrites:true});
const requestClient=fenceProductionClient(raw,{destinationRequestId:receipt.requestId,destinationLocationId:receipt.locationId,sourceRequestId:null});
const ok=(r,label)=>{if(!r.ok)throw Object.assign(Error(label+'_http_'+r.status),{code:label+'_failed'});return r.body;};
const select='akoya_requestid,akoya_requestnum,akoya_title,akoya_requeststatus,wmkf_triagestatus,wmkf_meetingdate,wmkf_istestrequest,wmkf_testcreationrunid,_akoya_applicantid_value,_akoya_payee_value,_akoya_primarycontactid_value,_akoya_gofundrecommender_value,_wmkf_paymentcontact_value';
try{
 // A request without applicant/payee/contact/recommender bindings cannot refresh an existing applicant account or address an applicant/recommender email.
 // The live workflow census is reviewed separately before execution; no synchronous/background automation is disabled.
 const body={akoya_requestid:receipt.requestId,akoya_title:'SYNTHETIC MEETING TRACKER REHEARSAL '+receipt.runId.slice(0,8),akoya_purpose:'Owner-authorized synthetic test. No applicant, payee, contact, recommender, payment, invitation or email.',akoya_requeststatus:'Phase II Pending',wmkf_meetingdate:'2026-12-11',wmkf_istestrequest:true,wmkf_testcreationrunid:receipt.runId,wmkf_respondreminderenabled:false,wmkf_reviewduereminderenabled:false};
 if(!receipt.requestAttempted){receipt.requestAttempted=true;receipt.requestAttemptedAt=new Date().toISOString();save();const r=await requestClient.post('/akoya_requests',body);receipt.requestCreateHttpStatus=r.status;save();ok(r,'request_create');}
 const r=await raw.get(`/akoya_requests(${receipt.requestId})?$select=${select}`);receipt.requestReadbackHttpStatus=r.status;save();const request=ok(r,'request_readback');
 if(request.wmkf_istestrequest!==true||request.wmkf_testcreationrunid?.toLowerCase()!==receipt.runId)throw Error('request_ownership_unverified');
 for(const key of ['_akoya_applicantid_value','_akoya_payee_value','_akoya_primarycontactid_value','_akoya_gofundrecommender_value','_wmkf_paymentcontact_value'])if(request[key])throw Error('unexpected_existing_business_binding');
 receipt.requestCreated=true;receipt.requestNumber=request.akoya_requestnum;receipt.requestStatus=request.akoya_requeststatus;receipt.requestMeetingDate=request.wmkf_meetingdate;receipt.nullBusinessBindingsVerified=true;save();
 if(!receipt.visitAttempted){
  const visit={activityid:receipt.visitId,subject:'SYNTHETIC MEETING TRACKER REHEARSAL '+receipt.runId.slice(0,8),scheduledstart:'2026-12-01T18:00:00Z',scheduledend:'2026-12-01T19:00:00Z',wmkf_visitformat:100000001,wmkf_ianatimezone:'America/Los_Angeles',wmkf_locationorlink:'https://example.invalid/synthetic-meeting','regardingobjectid_akoya_request_wmkf_sitevisit@odata.bind':`/akoya_requests(${receipt.requestId})`};
  if(Object.keys(visit).some(k=>k.endsWith('@odata.bind')&&visit[k]!==`/akoya_requests(${receipt.requestId})`))throw Error('visit_bind_denied');
  receipt.visitAttempted=true;save();const r=await raw.post('/wmkf_sitevisits',visit);receipt.visitCreateHttpStatus=r.status;save();ok(r,'visit_create');
 }
 const visit=ok(await raw.get(`/wmkf_sitevisits(${receipt.visitId})?$select=activityid,_regardingobjectid_value,statecode`),'visit_readback');
 if(visit._regardingobjectid_value?.toLowerCase()!==receipt.requestId)throw Error('visit_ownership_unverified');
 receipt.visitCreated=true;
 const emails=ok(await raw.get(`/emails?$filter=_regardingobjectid_value eq ${receipt.requestId}&$select=activityid,senton,statecode,statuscode`),'email_readback').value;
 receipt.regardingEmails=emails.map(x=>({id:x.activityid,sent:!!x.senton,statecode:x.statecode,statuscode:x.statuscode}));
 if(emails.some(x=>x.senton))throw Error('unexpected_email_delivery');
 const role=ok(await raw.get("/wmkf_appsystemsettings?$filter=wmkf_settingkey eq 'board_writeups.program_coordinator'&$select=wmkf_settingvalue"),'coordinator_read').value;
 receipt.coordinatorSystemUserId=role[0]?JSON.parse(role[0].wmkf_settingvalue).systemUserId:null;
 receipt.fixtureReady=true;save();console.log(JSON.stringify(receipt));
}catch(error){receipt.errorCode=error.code||error.message;save();console.error(JSON.stringify({errorCode:receipt.errorCode,requestAttempted:receipt.requestAttempted,requestCreated:receipt.requestCreated,visitCreated:receipt.visitCreated}));process.exitCode=1;}
