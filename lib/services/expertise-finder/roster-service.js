/** Dataverse roster administration (rehearsal or Dataverse mode). No matching/cutover side effects.
 * Caller establishes app authorization and DAL context. GUID administration identities.
 * Rehearsal saves run under the lifecycle lease; Dataverse-mode saves bind directly through
 * `ensureProfileBinding` (simplified Production cutover plan, 2026-11-18).
 */
import * as profiles from '../../dataverse/adapters/expertise-profile.js';
import * as users from '../../dataverse/adapters/system-user.js';
import * as contacts from '../../dataverse/adapters/contact.js';
import contract from './roster-contract.cjs';
import { rosterMode, rosterTarget } from './roster-mode.js';
import lifecycle from './roster-lifecycle.cjs';
import { ensureProfileBinding } from './roster-binding.js';
const {normalize,decode,encode,guid,fail}=contract;
function clean(input){const {id,profile_guid,etag,updated_at,legacy_id,mutation_id,...fields}=input;return fields;}
async function validateLinks(value,current){
 // Retained links remain historical identity even after a staff account is disabled.
 if(value.dataverse_user_id&&(value.dataverse_user_id!==current?.dataverse_user_id||value.lead_pd_eligible)){const u=await users.getById(value.dataverse_user_id);if(u.isdisabled!==false)fail('Choose an enabled staff account.');}
 if(value.dataverse_contact_id&&value.dataverse_contact_id!==current?.dataverse_contact_id){const c=await contacts.getByIdWithSelect(value.dataverse_contact_id,'contactid,statecode');if(c.statecode!==0)fail('Choose an active Contact.');}
}
function actorRequired(actor){if(!guid(actor))fail('Your staff account must be linked before editing.',403);if(process.env.DYNAMICS_IMPERSONATION_ENABLED!=='true')fail('Staff attribution is not configured.',503);}
function backendLabel(){return rosterMode()==='rehearsal'?'dataverse-rehearsal':'dataverse';}
// Dataverse mode: no lifecycle lock or pending intents; confirmed saves bind directly.
function directLease(host){return {active:false,async beforeMutation(){return null;},async rejectMutation(){},async complete({profileGuid}){await ensureProfileBinding(host,profileGuid);}};}
function withWrite(work){if(rosterMode()==='rehearsal')return lifecycle.withRosterWrite(work);const {host}=rosterTarget();return work(directLease(host));}
export async function listRoster(query={}){
 rosterTarget();if(query.id)return {success:true,member:decode(await profiles.get(query.id)),backend:backendLabel()};
 const all=(await profiles.list()).map(decode);
 let rows=all.filter(r=>(query.includeInactive==='true'||r.is_active)&&(!query.roleType||r.role_type===query.roleType));
 const term=String(query.search||'').trim().toLowerCase();if(term)rows=rows.filter(r=>['name','affiliation','expertise','keywords'].some(k=>String(r[k]||'').toLowerCase().includes(term)));
 const sort=['name','role_type','affiliation','updated_at'].includes(query.sortBy)?query.sortBy:'name',direction=query.sortOrder==='desc'?-1:1;
 rows.sort((a,b)=>direction*(String(a[sort]||'').localeCompare(String(b[sort]||''))||a.id.localeCompare(b.id)));
 const total=rows.length,limit=Math.min(Math.max(parseInt(query.limit,10)||100,1),500),offset=Math.max(parseInt(query.offset,10)||0,0);
 return {success:true,members:rows.slice(offset,offset+limit),total,limit,offset,backend:backendLabel(),users:(await profiles.users()).map(u=>({id:u.systemuserid,name:u.fullname,email:u.internalemailaddress})),warnings:all.filter(r=>!r.role_type).map(r=>`Repair the category for ${r.name}.`)};
}
export async function saveRoster(input,actor,{create=false}={}){
 rosterTarget();actorRequired(actor);
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Roster object required.');
 return withWrite(async lease=>{
 const currentRecord=create?null:await profiles.get(input.id);
 const current=currentRecord?decode(currentRecord):null;
 if(current&&(!/^W\/"\d+"$/.test(input.etag||'')||input.etag.length>100||input.etag!==current.etag))fail('This profile changed. Reload it before saving.',409);
 const fields=clean(input);if(fields.is_active===false)fields.lead_pd_eligible=false;
 const value=normalize(fields,current);await validateLinks(value,current);
 const body=encode(value);
 if(create){
  if(!guid(input.mutation_id))fail('A stable creation identity is required.');
  const key='app_'+input.mutation_id;
  let existing=await profiles.byCreationKey(key),attemptId=null;
  if(!existing){
   attemptId=await lease.beforeMutation({kind:'create',creationKey:key});
   try{await profiles.create({...body,wmkf_creationkey:key},actor);}
   catch(error){await lease.rejectMutation(attemptId,error);existing=await profiles.byCreationKey(key);if(!existing)throw error;}
  }
  existing=existing||await profiles.byCreationKey(key);if(!existing)fail('Creation outcome unavailable; retry with the same identity.',503);
  const actual=decode(existing);for(const k of ['name','role_type','is_active','lead_pd_eligible','dataverse_contact_id','dataverse_user_id',...contract.TEXT])if(actual[k]!==value[k])fail('This creation identity already belongs to different profile values.',409);
  await lease.complete({profileGuid:actual.profile_guid,creationKey:existing.wmkf_creationkey,attemptId});
  return {success:true,member:actual};
 }
 if(lease.active&&!lifecycle.creationKey(currentRecord.wmkf_creationkey))throw lifecycle.fail('Profile creation identity needs reconciliation before numeric use.');
 const attemptId=await lease.beforeMutation({kind:'update',profileGuid:input.id,etag:input.etag});
 try{await profiles.update(input.id,body,input.etag,actor);}
 catch(error){await lease.rejectMutation(attemptId,error);throw error;}
 let bindingWarning=null;
 try{await lease.complete({profileGuid:input.id,creationKey:currentRecord.wmkf_creationkey,attemptId});}
 catch{bindingWarning='Saved, but numeric roster reconciliation is incomplete. The profile may be unavailable to dependent features.';}
 // A committed save must not become a failed save merely because hydration failed.
 try{return {success:true,member:decode(await profiles.get(input.id)),...(bindingWarning?{warning:bindingWarning}:{})};}
 catch{return {success:true,member:{...value,id:input.id,profile_guid:input.id,etag:null},warning:bindingWarning||'Saved. Reload to fetch the latest profile before editing again.'};}
 });
}
