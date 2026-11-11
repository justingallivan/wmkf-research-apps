/** Shared single/batch rehearsal matching contract. Pure output authorization is
 * against this invocation's exact roster snapshot, never model-supplied names.
 */
import * as profiles from '../../dataverse/adapters/expertise-profile.js';
import * as users from '../../dataverse/adapters/system-user.js';
import contract from './roster-contract.cjs';
import target from './roster-rehearsal-target.cjs';
import { EXPERTISE_MATCH_SCHEMA } from '../../../shared/config/expertise-finder-output-schema';
import { EXPERTISE_FINDER_ROSTER_V2_ROW, buildRosterV2Variables } from '../../../shared/config/prompts/expertise-finder-roster-v2';
import { validateAiJson } from '../../utils/ai-output-schema';
import { ServiceHttpError } from '../service-http-error';
export { EXPERTISE_FINDER_ROSTER_V2_ROW,buildRosterV2Variables };
function failure(message){return new ServiceHttpError(message,{httpStatus:503,body:{error:message,reason:'roster_match_contract_unavailable'}});}
export async function matchRosterSnapshot(){
 target.assertTarget();const raw=await profiles.list(),roster=[],warnings=[];
 for(const record of raw){
  const row=contract.decode(record);let valid=contract.guid(record.wmkf_expertiseprofileid)&&typeof record.wmkf_leadpdeligible==='boolean'&&[0,1].includes(record.statecode);
  try{const {id,profile_guid,etag,updated_at,...fields}=row;contract.normalize(fields,row);}catch{valid=false;}
  if(!valid){warnings.push('An invalid roster profile was excluded from matching.');continue;}
  if(row.is_active)roster.push(row);
 }
 const leadGuids=[];
 for(const r of roster.filter(r=>r.role_type==='Research Program Staff'&&r.lead_pd_eligible&&r.dataverse_user_id)){
  // An incomplete/failed User read is not evidence of ineligibility.
  const u=await users.getById(r.dataverse_user_id);if(u.isdisabled===false)leadGuids.push(r.profile_guid);
 }
 return {rows:roster.sort((a,b)=>a.role_type.localeCompare(b.role_type)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id)),leadGuids,warnings};
}
export function assertRosterPrompt(resolved){
 if(resolved.systemPrompt!==EXPERTISE_FINDER_ROSTER_V2_ROW.systemPrompt||resolved.body!==EXPERTISE_FINDER_ROSTER_V2_ROW.body)throw failure('The roster matching prompt does not match the approved version.');
}
export const rosterMatchSchema=structuredClone(EXPERTISE_MATCH_SCHEMA);
const schema=rosterMatchSchema;
schema.fields.staff_assignment.required=true;delete schema.fields.staff_assignment.default;
for(const key of ['primary','secondary']){
 const item=schema.fields.staff_assignment.fields[key];item.nullable=true;item.default=null;delete item.fields.name;item.fields.profile_guid={type:'string',required:true,maxLength:36};
}
for(const key of ['consultant_overlap','board_interest','conflicts']){delete schema.fields[key].of.fields.name;schema.fields[key].of.fields.profile_guid={type:'string',required:true,maxLength:36};}
schema.fields.staff_consultation={type:'array',required:false,default:[],maxItems:50,of:{type:'object',fields:{profile_guid:{type:'string',required:true,maxLength:36},rationale:{type:'string',required:false,default:'',maxLength:4000}}}};
export function validateRosterMatch(value,snapshot){
 const checked=validateAiJson(value,schema);if(!checked.ok)throw failure('Matching returned an invalid roster result.');
 const result=checked.value,byId=new Map(snapshot.rows.map(r=>[r.profile_guid,r])),leads=new Set(snapshot.leadGuids);
 const resolve=(item,category,lead=false)=>{
  if(item===null)return null;
  const row=byId.get(item.profile_guid);
  if(!row||!contract.guid(item.profile_guid)||(category&&row.role_type!==category)||(lead&&!leads.has(item.profile_guid)))throw failure('Matching returned an unavailable or ineligible profile identity.');
  return {...item,name:row.name};
 };
 for(const k of ['primary','secondary'])result.staff_assignment[k]=resolve(result.staff_assignment[k],'Research Program Staff',true);
 for(const [k,category] of [['staff_consultation','Research Program Staff'],['consultant_overlap','Consultant'],['board_interest','Board'],['conflicts',null]])result[k]=result[k].map(item=>resolve(item,category));
 return {...result,roster_contract:'expertise-roster-guid-eligibility-v2',roster_warnings:snapshot.warnings,no_lead_recommendation:!result.staff_assignment.primary};
}
