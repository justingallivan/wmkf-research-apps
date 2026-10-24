/** Frozen research-presentation details email. Reconciliation only reads transport; it never resubmits. */
import crypto from 'node:crypto';
import { ServiceHttpError } from '../service-http-error.js';
import { canonicalJson } from '../../utils/canonical-json.js';
import { isGuid } from '../../utils/guid.js';
import { parseMeetingTranscriptionAccess } from '../meeting-tracker-transcription/policy.js';
import { authorizePreparer } from './preparation-service.js';
import { getSiteVisitLogisticsSnapshot } from '../site-visit/logistics-service.js';
import { getSiteVisitRecipientDirectory, resolveSiteVisitRecipientRefs } from '../site-visit/recipient-directory-service.js';
import * as requests from '../../dataverse/adapters/grant-request.js';
import * as email from '../../dataverse/adapters/email-activity.js';
import { isVisibleRequestRow } from '../../../shared/config/workbenchVisibility.js';
import { assertRequestEmailAllowed } from '../test-requests/request-test-state.js';
import { DEFAULT_DEPENDENCIES as collection } from '../site-visit-materials/collection-service.js';
import { renderPlainTextEmailHtml } from '../../external/plain-text-email-html.js';
import { invitationEnabled } from './invitation-policy.js';
import { invitationStore } from './invitation-store.js';
const ACCEPTED=new Set([3,6,7]),TERMINAL=new Set([2,4,5,8]);
const fail=(code,message,httpStatus=409,extras=null)=>{throw new ServiceHttpError(message,{code,httpStatus,...(extras?{body:{error:message,code,...extras}}:{})});};
const hash=value=>crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
const envelopeHash=({from,to,cc})=>hash({from:from.trim().toLowerCase(),to:[...to].sort(),cc:[...cc].sort()});
const emailHash=({subject,bodyHtml,from,to,cc})=>hash({subject,bodyHtml,from:from.trim().toLowerCase(),to:[...to].sort(),cc:[...cc].sort()});
const correlation=id=>`wmkf-presentation-invite:${id}`;
export {invitationEnabled} from './invitation-policy.js';
export const INVITATION_DEPENDENCIES={store:invitationStore,impersonationEnabled:()=>process.env.DYNAMICS_IMPERSONATION_ENABLED==='true',authorize:authorizePreparer,logistics:getSiteVisitLogisticsSnapshot,directory:getSiteVisitRecipientDirectory,resolve:resolveSiteVisitRecipientRefs,
 request:requestId=>requests.getById(requestId,{select:['akoya_requestid','akoya_requestnum','akoya_title','wmkf_meetingdate','akoya_requeststatus','wmkf_triagestatus']}),
 signature:collection.resolvePcSignature,assertEmailAllowed:assertRequestEmailAllowed,createEmail:email.create,sendEmail:email.send,getEmail:email.getById,findEmail:email.findByCorrelation,now:()=>new Date()};
function requireEnabled(requestId){if(!invitationEnabled(requestId))fail('presentation_invitation_unavailable','Presentation invitation emails are not enabled for this request.',503);}
async function actor(args,d){const staff=await d.authorize({profileId:args.profileId,actingUserSystemId:args.actingUserSystemId});if(staff.profileId!==args.profileId||staff.email?.trim().toLowerCase()!==args.fromEmail?.trim().toLowerCase())fail('presentation_invitation_actor','Your active staff profile and sending mailbox must match.',403);return staff;}
async function requestForActor(args,d){const request=await d.request(args.requestId);if(request?.akoya_requestid?.toLowerCase()!==args.requestId.toLowerCase())fail('presentation_invitation_not_found','The request is unavailable.',404);return request;}
function customInput(body){if(typeof body.subject!=='string'||!body.subject.trim()||body.subject.length>320||/[\r\n]/.test(body.subject)||typeof body.message!=='string'||body.message.length>8000)fail('presentation_invitation_message','Use a subject up to 320 characters and a message up to 8,000 characters.',400);return {subject:body.subject.trim(),message:body.message.trim()};}
async function context(args,custom,d){
 if(d.impersonationEnabled?.()!==true)fail('presentation_invitation_impersonation_required','Dynamics sender impersonation must be enabled before sending invitations.',503);
 const staff=await actor(args,d),request=await requestForActor(args,d);
 if(!request.wmkf_meetingdate||!isVisibleRequestRow(request,false))fail('presentation_invitation_request_changed','The request is no longer eligible for meeting invitations.');
 const {siteVisit:visit}=await d.logistics({requestId:args.requestId});
 if(!visit?.activityId||!visit.etag||!visit.startIso||!visit.endIso)fail('presentation_invitation_schedule_required','Save the presentation time and attendees first.');
 const directory=await d.directory();
 const [required,optional]=await Promise.all([d.resolve(visit.requiredAttendees||[],{directory}),d.resolve(visit.optionalAttendees||[],{directory})]);
 const to=required.map(row=>row.email.trim().toLowerCase()),cc=optional.map(row=>row.email.trim().toLowerCase());
 if(!to.length&&!cc.length)fail('presentation_invitation_recipients_required','Select at least one attendee in meeting setup before preparing an invitation.');
 if(to.length+cc.length>100||new Set([...to,...cc]).size!==to.length+cc.length)fail('presentation_invitation_recipients_invalid','The saved attendee groups contain duplicate recipients or exceed the invitation limit.');
 const signature=await d.signature(staff.systemUserId);
 const snapshot={request:{id:args.requestId,number:request.akoya_requestnum,title:request.akoya_title,cycle:request.wmkf_meetingdate},visit,
  actor:{profileId:args.profileId,systemUserId:staff.systemUserId.toLowerCase(),email:staff.email.trim().toLowerCase()},signature,custom,to,cc};
 let when;try{const format=new Intl.DateTimeFormat('en-US',{dateStyle:'full',timeStyle:'short',timeZone:visit.timeZone});when=`${format.format(new Date(visit.startIso))} – ${format.format(new Date(visit.endIso))} (${visit.timeZone})`;}catch{fail('presentation_invitation_schedule_invalid','The saved presentation time could not be verified.',503);}
 const bodyText=[custom.message,`Research presentation: ${request.akoya_title||request.akoya_requestnum}`,`When: ${when}`,`Location or meeting link: ${visit.locationOrLink||'Not provided'}`,signature].filter(Boolean).join('\n\n');
 if(Buffer.byteLength(canonicalJson(snapshot),'utf8')>32768||bodyText.length>16384)fail('presentation_invitation_message_too_large','The invitation is too long. Shorten the message before preparing a preview.',413);
 return {snapshot,sourceHash:hash(snapshot),subject:custom.subject,bodyText,bodyHtml:renderPlainTextEmailHtml(bodyText),to,cc,staff,visit};
}
export function invitationDto(row){
 if(!row)return null;
 const redacted=Boolean(row.redacted_at)||(row.retention_expires_at&&new Date(row.retention_expires_at).getTime()<=Date.now());
 return {id:row.id,version:Number(row.version),state:row.state,subject:redacted?'':row.subject,message:redacted?'':row.snapshot?.custom?.message||'',bodyText:redacted?'':row.body_text,
  fromEmail:redacted?'':row.from_email,to:redacted?[]:row.to_recipients,cc:redacted?[]:row.cc_recipients,expiresAt:row.preview_expires_at,redacted:Boolean(redacted),emailId:row.dynamics_email_id||null,failureCode:row.failure_code||null};
}

async function own(row,args){if(!row)fail('presentation_invitation_not_found','Invitation not found.',404);if(Number(row.actor_profile_id)!==args.profileId||row.acting_user_system_id.toLowerCase()!==args.actingUserSystemId.toLowerCase())fail('presentation_invitation_actor','This invitation belongs to another staff sender. Prepare your own preview.',403);}
export async function getInvitation(args,d=INVITATION_DEPENDENCIES){requireEnabled(args.requestId);await actor(args,d);await requestForActor(args,d);const row=await d.store.latest(args.requestId);return {invitation:invitationDto(row),canReconcile:Boolean(row),canSend:row?Number(row.actor_profile_id)===args.profileId&&row.acting_user_system_id.toLowerCase()===args.actingUserSystemId.toLowerCase():false};}
export async function prepareInvitation(args,d=INVITATION_DEPENDENCIES){
 requireEnabled(args.requestId);const current=await context(args,customInput(args.body),d);
 const unresolved=await d.store.latest(args.requestId);
 if(unresolved&&['creating','activity_created','send_requested','unknown'].includes(unresolved.state))fail('presentation_invitation_unresolved','An earlier invitation needs checking before a new preview can be prepared.',409,{invitation:invitationDto(unresolved),canReconcile:true,canSend:false});
 const row=await d.store.create({id:crypto.randomUUID(),requestId:args.requestId,siteVisitId:current.visit.activityId,profileId:args.profileId,actingUserSystemId:args.actingUserSystemId,fromEmail:current.staff.email.trim().toLowerCase(),envelopeHash:envelopeHash({from:current.staff.email,to:current.to,cc:current.cc}),emailHash:emailHash({subject:current.subject,bodyHtml:current.bodyHtml,from:current.staff.email,to:current.to,cc:current.cc}),...current});
 if(!row)fail('presentation_invitation_capacity','Invitation history is temporarily full. Try again after maintenance.',503);
 return {invitation:invitationDto(row),canSend:true,canReconcile:true};
}
async function transition(row,state,options,d){const next=await d.store.transition(row,state,options);if(!next)fail('presentation_invitation_lease_lost','The invitation changed before its next action. Refresh its status.',503);return next;}
async function matchingEmail(row,d,{allowTerminal=false}={}){
 const records=row.dynamics_email_id?[await d.getEmail(row.dynamics_email_id)]:await d.findEmail(correlation(row.id));
 if(Array.isArray(records)&&records.length>1)fail('presentation_invitation_duplicate_activity','More than one Dynamics activity has this receipt. Ask an administrator to inspect the exact activities.');
 if(!Array.isArray(records)||records.length!==1||!records[0])return null;
 const message=records[0];if(message.subcategory!==correlation(row.id)||!isGuid(message.activityid||'')||(row.dynamics_email_id&&message.activityid.toLowerCase()!==row.dynamics_email_id.toLowerCase()))fail('presentation_invitation_email_mismatch','The email receipt requires administrator reconciliation.');
 if(allowTerminal&&TERMINAL.has(Number(message.statuscode)))return message;
 const parties=Array.isArray(message.email_activity_parties)?message.email_activity_parties:[];
 const addresses=mask=>parties.filter(p=>Number(p.participationtypemask)===mask).map(p=>String(p.addressused||'').trim().toLowerCase()).filter(Boolean).sort();
 const senders=addresses(1);
 if(senders.length!==1||envelopeHash({from:senders[0]||'',to:addresses(2),cc:addresses(3)})!==row.envelope_hash||(!row.email_verified_at&&emailHash({subject:String(message.subject||''),bodyHtml:String(message.description||''),from:senders[0]||'',to:addresses(2),cc:addresses(3)})!==row.email_hash)){
  const error=new ServiceHttpError('The saved Dynamics email changed. Ask an administrator to inspect its exact receipt before another send.',{code:'presentation_invitation_email_mismatch',httpStatus:409});
  error.definitelyUnsentDraft=Number(message.statuscode)===1&&!row.email_verified_at;
  throw error;
 }

 return message;
}
async function reconcile(row,d,known=undefined){
 const message=known===undefined?await matchingEmail(row,d,{allowTerminal:true}):known;
 if(!message&&!row.email_verified_at)return transition(row,'failed',{failureCode:'presentation_invitation_not_dispatched',release:true},d);
 if(message&&ACCEPTED.has(Number(message.statuscode)))return transition(row,'sent',{emailId:message.activityid,emailVerified:true,release:true},d);
 if(message&&(TERMINAL.has(Number(message.statuscode))||(Number(message.statuscode)===1&&(['creating','activity_created'].includes(row.state)||row.failure_code==='presentation_invitation_create_unknown'))))return transition(row,'failed',{emailId:message.activityid,failureCode:'presentation_invitation_not_sent',release:true},d);
 return transition(row,'unknown',{emailId:message?.activityid||null,failureCode:row.failure_code||(['creating','activity_created'].includes(row.state)?'presentation_invitation_create_unknown':'presentation_invitation_send_unknown'),release:true},d);
}
export async function actOnInvitation(args,d=INVITATION_DEPENDENCIES){
 requireEnabled(args.requestId);if(!['send','reconcile'].includes(args.body?.action))fail('presentation_invitation_action','Use Send or Check email status.',400);
 await actor(args,d);await requestForActor(args,d);
 let row=await d.store.get(args.body.invitationId,args.requestId);
 if(!row)fail('presentation_invitation_not_found','Invitation not found.',404);
 if(args.body.action==='send')await own(row,args);
 if(['sent','failed'].includes(row.state))return {invitation:invitationDto(row)};
 if(args.body.action==='reconcile'&&row.state==='prepared')return {invitation:invitationDto(row)};
 if(row.state==='prepared'&&new Date(row.preview_expires_at)<=d.now())fail('presentation_invitation_preview_expired','The preview expired. Prepare and review a new invitation.',410);
 row=await d.store.claim(row.id,args.requestId,args.body.expectedVersion);if(!row)fail('presentation_invitation_conflict','The invitation is busy or changed. Refresh before continuing.');
 try{
  if(row.state!=='prepared')return {invitation:invitationDto(await reconcile(row,d))};
  const renewCurrent=async()=>{if(d.impersonationEnabled?.()!==true){const error=new ServiceHttpError('Dynamics sender impersonation must be enabled before sending invitations.',{code:'presentation_invitation_impersonation_required',httpStatus:503});error.dispatched=false;throw error;}const renewed=await d.store.renew(row);if(!renewed){const error=new ServiceHttpError('The invitation lease expired. Refresh its status.',{code:'presentation_invitation_lease_lost',httpStatus:503});error.dispatched=false;throw error;}row=renewed;};
  const assertCurrent=async()=>{try{const current=await context(args,row.snapshot.custom,d);if(current.sourceHash!==row.source_hash)fail('presentation_invitation_preview_stale','The saved meeting, attendees, sender or message changed. Prepare a fresh preview.');await d.assertEmailAllowed(args.requestId,{recipients:[...current.to,...current.cc]});const renewed=await d.store.renew(row);if(!renewed)fail('presentation_invitation_lease_lost','The invitation lease expired. Refresh its status before continuing.',503);row=renewed;}catch(error){error.dispatched=false;throw error;}};
  await assertCurrent();
  try{row=await transition(row,'creating',{},d);}catch(error){if(error?.code==='23505')fail('presentation_invitation_unresolved','An earlier invitation needs reconciliation before another can be sent.');throw error;}
  await renewCurrent();
  const emailId=await d.createEmail({subject:row.subject,body:row.body_html,from:row.from_email,to:row.to_recipients,cc:row.cc_recipients,regardingId:args.requestId,regardingType:'akoya_request',correlationKey:correlation(row.id),actingUserSystemId:args.actingUserSystemId,noFallback:true});
  if(!isGuid(emailId||''))fail('presentation_invitation_create_unknown','The email activity result could not be confirmed.',502);
  row=await transition(row,'activity_created',{emailId},d);
  await renewCurrent();
  const before=await matchingEmail(row,d);
  if(!before||Number(before.statuscode)!==1)return {invitation:invitationDto(await reconcile(row,d,before))};
  row=await transition(row,'send_requested',{emailVerified:true},d);
  await assertCurrent();
  await d.sendEmail(emailId,{actingUserSystemId:args.actingUserSystemId,noFallback:true});
  return {invitation:invitationDto(await reconcile(row,d))};
 }catch(error){
  if(['presentation_invitation_email_mismatch','presentation_invitation_duplicate_activity'].includes(error?.code)&&row.lease_token){
   const state=error.definitelyUnsentDraft?'failed':'unknown';
   const recorded=await d.store.transition(row,state,{failureCode:error.code,release:true});if(recorded)return {invitation:invitationDto(recorded)};
  }
  if(['creating','activity_created','send_requested'].includes(row.state)&&row.lease_token){
   const definite=row.state==='activity_created'||error?.dispatched===false;
   const code=definite?'presentation_invitation_not_sent':row.state==='creating'?'presentation_invitation_create_unknown':'presentation_invitation_send_unknown';
   const recorded=await d.store.transition(row,definite?'failed':'unknown',{failureCode:code,release:true});
   if(recorded)return {invitation:invitationDto(recorded)};
  }
  throw error;
 }finally{if(row?.lease_token)await d.store.release(row);}
}

/** Retention is independent of admission: feature-off must not retain old recipient/message data forever. */
export async function cleanupInvitations(d=INVITATION_DEPENDENCIES){
 try{return await d.store.cleanup({requestId:null});}
 catch(error){if(error?.code==='42P01')return {skipped:'schema_not_ready',deleted:0,redacted:0};throw error;}
}
