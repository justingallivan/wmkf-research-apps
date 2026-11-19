/** Numeric consumer projection (rehearsal or Dataverse mode). Dataverse owns values; the local
 * target-scoped bridge owns numeric references. No allocation or legacy fallback.
 * Callers establish authorization and DAL context. Complete-read failure is 503;
 * missing/invalid rows are explicit exclusions or unavailable historical identities.
 */
import { sql } from './roster-sql.cjs';
import * as profiles from '../../dataverse/adapters/expertise-profile.js';
import contract from './roster-contract.cjs';
import { rosterTarget } from './roster-mode.js';
import { ServiceHttpError } from '../service-http-error.js';
function unavailable(){return new ServiceHttpError('Roster identity is temporarily unavailable. Please retry.',{httpStatus:503,code:'roster_identity_unavailable',body:{error:'Roster identity is temporarily unavailable. Please retry.',reason:'roster_identity_unavailable'}});}
export async function readConsumerRoster(){
 const {host}=rosterTarget();
 try{
  const [raw,bound]=await Promise.all([profiles.list(),sql.query('SELECT roster_id,dataverse_profile_guid FROM expertise_roster_binding WHERE target_host=$1 ORDER BY roster_id',[host])]);
  const bindings=new Map(bound.rows.map(r=>[r.dataverse_profile_guid,r.roster_id]));
  const rows=[],warnings=[];
  for(const record of raw){
   const value=contract.decode(record),id=bindings.get(value.profile_guid);
   let valid=contract.guid(record.wmkf_expertiseprofileid)&&typeof record.wmkf_leadpdeligible==='boolean'&&[0,1].includes(record.statecode);
   try{const {id:_id,profile_guid,etag,updated_at,...fields}=value;contract.normalize(fields,value);}catch{valid=false;}
   if(!valid||!Number.isSafeInteger(id)||id<=0){warnings.push({profileGuid:value.profile_guid,reason:valid?'unmapped':'invalid',message:`A roster profile is unavailable for selection (${valid?'missing numeric binding':'invalid profile fields'}).`});continue;}
   rows.push({...value,id});
  }
  return {rows,warnings};
 }catch(error){if(error instanceof ServiceHttpError)throw error;throw unavailable();}
}
export async function eligibleRoster(roleTypes){
 const result=await readConsumerRoster();
 return {...result,rows:result.rows.filter(r=>r.is_active&&roleTypes.includes(r.role_type)).sort((a,b)=>a.role_type.localeCompare(b.role_type)||a.name.localeCompare(b.name)||a.id-b.id)};
}
export async function assertEligibleConsultant(id){
 const {rows}=await readConsumerRoster();
 if(!rows.some(r=>r.id===id&&r.is_active&&r.role_type==='Consultant'))throw new ServiceHttpError('The selected consultant is not an active mapped roster consultant.',{httpStatus:400,body:{error:'The selected consultant is not an active mapped roster consultant.',reason:'consultant_not_eligible'}});
}
export async function hydrateFeedbackAuthors(rows){
 if(!rows.some(r=>r.consultant_roster_id!=null))return rows;
 let byId;
 try{byId=new Map((await readConsumerRoster()).rows.map(r=>[r.id,r]));}catch{byId=new Map();}
 return rows.map(row=>{
  if(row.consultant_roster_id==null)return row;
  const profile=byId.get(row.consultant_roster_id);
  return {...row,roster_name:profile?.name??'Unavailable consultant',roster_affiliation:profile?.affiliation??null,roster_identity_unavailable:!profile};
 });
}
