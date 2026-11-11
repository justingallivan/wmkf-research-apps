/** Sandbox roster administration adapter. Trusted context is caller-owned. */
import { randomUUID } from 'node:crypto';
import { DynamicsService } from '../../services/dynamics-service.js';
import { entitySet } from '../core/entity-registry.js';
import { eq } from '../core/odata.js';
import contract from '../../services/expertise-finder/roster-contract.cjs';
import target from '../../services/expertise-finder/roster-rehearsal-target.cjs';
const ENTITY=entitySet('wmkf_expertiseprofiles');
const SELECT=['wmkf_expertiseprofileid','wmkf_name','wmkf_category','statecode','wmkf_leadpdeligible','wmkf_contactguid','_wmkf_staffuser_value','wmkf_creationkey','modifiedon',...contract.TEXT.map(contract.column)].join(',');
function check(){target.assertTarget();}
export async function list(){check();const r=await DynamicsService.queryAllRecords(ENTITY,{select:SELECT,filter:'statecode eq 0 or statecode eq 1',orderby:'wmkf_expertiseprofileid asc'});if(r.capped||r.hasMore)throw Object.assign(new Error('Roster read is incomplete.'),{status:503});return r.records;}
export function get(id){check();if(!contract.guid(id))contract.fail('Invalid profile identity.');return DynamicsService.getRecord(ENTITY,id,{select:SELECT});}
export async function byCreationKey(key){check();const r=await DynamicsService.queryRecords(ENTITY,{select:SELECT,filter:eq('wmkf_creationkey',key),top:2});if(r.records.length>1)throw Error('Duplicate creation identity');return r.records[0]||null;}
export function create(body,actor){
 check();
 if(body.statecode===1){
  if(body.statuscode!==2)contract.fail('Invalid inactive profile status.');
  // Dataverse creates Active first. One atomic change set keeps an inactive
  // creation from becoming visible as Active if deactivation fails. The GUID
  // is generated here; callers recover uncertain responses by creation key.
  const id=randomUUID();
  return DynamicsService.executeChangeset([
   {method:'POST',url:ENTITY,body:{...body,wmkf_expertiseprofileid:id,statecode:0,statuscode:1}},
   {method:'PATCH',url:`${ENTITY}(${id})`,body:{statecode:1,statuscode:2}},
  ],{actingUserSystemId:actor,noFallback:true});
 }
 return DynamicsService.createRecord(ENTITY,body,{actingUserSystemId:actor,noFallback:true});
}
export function update(id,body,etag,actor){check();if(!contract.guid(id)||!/^W\/"\d+"$/.test(etag||''))contract.fail('Reload the profile before saving.',409);return DynamicsService.updateRecord(ENTITY,id,body,{ifMatch:etag,actingUserSystemId:actor,noFallback:true});}
export async function users(){check();const r=await DynamicsService.queryAllRecords(entitySet('systemusers'),{select:'systemuserid,fullname,internalemailaddress,isdisabled',filter:'isdisabled eq false'});if(r.capped||r.hasMore)throw Error('Staff list incomplete');return r.records;}
