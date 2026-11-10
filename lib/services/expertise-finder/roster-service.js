/** Rehearsal-only Dataverse roster administration. No matching/cutover side effects.
 * Caller establishes app authorization and DAL context. GUID administration identities;
 * legacy numeric mapping remains import-owned until dependent runtime migration.
 */
import * as profiles from '../../dataverse/adapters/expertise-profile.js';
import * as users from '../../dataverse/adapters/system-user.js';
import * as contacts from '../../dataverse/adapters/contact.js';
import contract from './roster-contract.cjs';
import target from './roster-rehearsal-target.cjs';
const {normalize,decode,encode,guid,fail}=contract;
function clean(input){const {id,profile_guid,etag,updated_at,legacy_id,mutation_id,...fields}=input;return fields;}
async function validateLinks(value,current){
 // Retained links remain historical identity even after a staff account is disabled.
 if(value.dataverse_user_id&&(value.dataverse_user_id!==current?.dataverse_user_id||value.lead_pd_eligible)){const u=await users.getById(value.dataverse_user_id);if(u.isdisabled!==false)fail('Choose an enabled staff account.');}
 if(value.dataverse_contact_id&&value.dataverse_contact_id!==current?.dataverse_contact_id){const c=await contacts.getByIdWithSelect(value.dataverse_contact_id,'contactid,statecode');if(c.statecode!==0)fail('Choose an active Contact.');}
}
function actorRequired(actor){if(!guid(actor))fail('Your staff account must be linked before editing.',403);if(process.env.DYNAMICS_IMPERSONATION_ENABLED!=='true')fail('Staff attribution is not configured for this rehearsal.',503);}
export async function listRoster(query={}){
 target.assertTarget();if(query.id)return {success:true,member:decode(await profiles.get(query.id)),backend:'dataverse-rehearsal'};
 const all=(await profiles.list()).map(decode);
 let rows=all.filter(r=>(query.includeInactive==='true'||r.is_active)&&(!query.roleType||r.role_type===query.roleType));
 const term=String(query.search||'').trim().toLowerCase();if(term)rows=rows.filter(r=>['name','affiliation','expertise','keywords'].some(k=>String(r[k]||'').toLowerCase().includes(term)));
 const sort=['name','role_type','affiliation','updated_at'].includes(query.sortBy)?query.sortBy:'name',direction=query.sortOrder==='desc'?-1:1;
 rows.sort((a,b)=>direction*(String(a[sort]||'').localeCompare(String(b[sort]||''))||a.id.localeCompare(b.id)));
 const total=rows.length,limit=Math.min(Math.max(parseInt(query.limit,10)||100,1),500),offset=Math.max(parseInt(query.offset,10)||0,0);
 return {success:true,members:rows.slice(offset,offset+limit),total,limit,offset,backend:'dataverse-rehearsal',users:(await profiles.users()).map(u=>({id:u.systemuserid,name:u.fullname,email:u.internalemailaddress})),warnings:all.filter(r=>!r.role_type).map(r=>`Repair the category for ${r.name}.`)};
}
export async function saveRoster(input,actor,{create=false}={}){
 target.assertTarget();actorRequired(actor);
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Roster object required.');
 const current=create?null:decode(await profiles.get(input.id));
 if(current&&(!input.etag||input.etag!==current.etag))fail('This profile changed. Reload it before saving.',409);
 const fields=clean(input);if(fields.is_active===false)fields.lead_pd_eligible=false;
 const value=normalize(fields,current);await validateLinks(value,current);
 const body=encode(value);
 if(create){
  if(!guid(input.mutation_id))fail('A stable creation identity is required.');
  const key='app_'+input.mutation_id;
  let existing=await profiles.byCreationKey(key);
  if(!existing){try{await profiles.create({...body,wmkf_creationkey:key},actor);}catch(error){existing=await profiles.byCreationKey(key);if(!existing)throw error;}}
  existing=existing||await profiles.byCreationKey(key);if(!existing)fail('Creation outcome unavailable; retry with the same identity.',503);
  const actual=decode(existing);for(const k of ['name','role_type','is_active','lead_pd_eligible','dataverse_contact_id','dataverse_user_id',...contract.TEXT])if(actual[k]!==value[k])fail('This creation identity already belongs to different profile values.',409);
  return {success:true,member:actual};
 }
 await profiles.update(input.id,body,input.etag,actor);
 // A committed save must not become a failed save merely because hydration failed.
 try{return {success:true,member:decode(await profiles.get(input.id))};}
 catch{return {success:true,member:{...value,id:input.id,profile_guid:input.id,etag:null},warning:'Saved. Reload to fetch the latest profile before editing again.'};}
}
