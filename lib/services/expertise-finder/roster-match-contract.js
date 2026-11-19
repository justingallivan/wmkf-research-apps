/** Shared single/batch rehearsal matching contract. Pure output authorization is
 * against this invocation's exact roster snapshot, never model-supplied names.
 */
import * as profiles from '../../dataverse/adapters/expertise-profile.js';
import * as users from '../../dataverse/adapters/system-user.js';
import contract from './roster-contract.cjs';
import target from './roster-rehearsal-target.cjs';
import { rosterTarget } from './roster-mode.js';
import { EXPERTISE_FINDER_ROSTER_V2_ROW, buildRosterV2Variables } from '../../../shared/config/prompts/expertise-finder-roster-v2';
import { ServiceHttpError } from '../service-http-error';
export { EXPERTISE_FINDER_ROSTER_V2_ROW,buildRosterV2Variables };
function failure(message){return new ServiceHttpError(message,{httpStatus:503,body:{error:message,reason:'roster_match_contract_unavailable'}});}
export async function matchRosterSnapshot(){
 rosterTarget();const raw=await profiles.list(),roster=[],warnings=[];
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
 if(target.browserRequested()){
  target.assertBrowserTarget();
  if(resolved.model!=='claude-sonnet-5-5'||resolved.maxTokens!==4096)throw failure('The browser rehearsal requires the approved matching model and output limit.');
 }
 if(resolved.systemPrompt!==EXPERTISE_FINDER_ROSTER_V2_ROW.systemPrompt||resolved.body!==EXPERTISE_FINDER_ROSTER_V2_ROW.body)throw failure('The roster matching prompt does not match the approved version.');
}
export { rosterMatchSchema, validateRosterMatch } from './roster-match-validation';
