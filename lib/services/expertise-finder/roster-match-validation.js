/** Pure frozen-roster schema and result authorization shared by legacy rehearsal
 * and recommendations. No data reads; canonical names come from supplied rows.
 */
import contract from './roster-contract.cjs';
import { EXPERTISE_MATCH_SCHEMA } from '../../../shared/config/expertise-finder-output-schema';
import { validateAiJson } from '../../utils/ai-output-schema';
import { ServiceHttpError } from '../service-http-error';
function failure(message){return new ServiceHttpError(message,{httpStatus:503,body:{error:message,reason:'roster_match_contract_unavailable'}});}
// This declarative schema contains JSON values only; keep imports portable to jsdom.
export const rosterMatchSchema=JSON.parse(JSON.stringify(EXPERTISE_MATCH_SCHEMA));
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
