#!/usr/bin/env node
/** Read-only sandbox permission/audit evidence. PRIVATE_DIR NEW_RECEIPT.
 * Reads approved mapped staff only. Does not impersonate writes or grant roles;
 * effective table privilege grants do not prove a successful staff edit. Private output only.
 * API reference: learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/use-web-api-functions
 */
const fs=require('node:fs'),path=require('node:path');
const {assertTarget}=require('../lib/services/expertise-finder/roster-rehearsal-target.cjs');
async function main([dir,out,...extra]){
 if(!dir||!out||extra.length)throw Error('PRIVATE_DIR NEW_RECEIPT required');
 const env={...process.env,...require('dotenv').parse(fs.readFileSync(path.join(dir,'full.env')))};
 const target=assertTarget(env);if(env.VERCEL_ENV||env.NODE_ENV==='production')throw Error('Local probe only');
 const mapping=JSON.parse(fs.readFileSync(path.join(dir,'full-mapping.json'))),receipt=JSON.parse(fs.readFileSync(path.join(dir,'full-import-receipt.json')));
 if(mapping.targetHost!==target.host||receipt.targetHost!==target.host||!receipt.success)throw Error('Evidence target mismatch');
 const fd=fs.openSync(out,'wx',0o600);
 try{
  for(const k of ['DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET','DATAVERSE_TARGET_INTERLOCK','DATAVERSE_DAL_ENFORCEMENT'])process.env[k]=env[k];
  const {createClient,getAccessToken}=require('../lib/dataverse/client.js');const c=createClient({resourceUrl:env.DYNAMICS_URL,token:await getAccessToken(env.DYNAMICS_URL)});
  const get=async url=>{const r=await c.raw('GET',url,undefined,{}, {timeoutMs:30000});if(!r.ok){fs.writeSync(fd,JSON.stringify({success:false,status:r.status,error:r.body},null,2));throw Error(`Probe failed HTTP ${r.status}`);}return r.body;};
  const meta=await get("/EntityDefinitions(LogicalName='wmkf_expertiseprofile')?$select=IsAuditEnabled,OwnershipType,Privileges&$expand=Attributes($select=LogicalName,IsAuditEnabled,IsSecured)");
  const sample=receipt.rows.find(r=>r.profileGuid),people=[];
  for(const m of mapping.rows.filter(r=>r.staffUserGuid)){
   const privileges=[];
   for(const privilege of meta.Privileges){
    const access=await get(`/systemusers(${m.staffUserGuid})/Microsoft.Dynamics.CRM.RetrieveUserPrivilegeByPrivilegeId(PrivilegeId=${privilege.PrivilegeId},ExcludeTeamBasic=false)`);
    privileges.push({name:privilege.Name,type:privilege.PrivilegeType,effective:access.RolePrivileges});
   }
   people.push({legacyId:m.legacyId,privileges});
  }
  const audits=await get('/audits?'+new URLSearchParams({$select:'auditid,operation,action,_objectid_value,_userid_value,_callinguserid_value', $filter:`_objectid_value eq ${sample.profileGuid}`,$top:'100'}));
  const profile=await get(`/wmkf_expertiseprofiles(${sample.profileGuid})?$select=_createdby_value,_modifiedby_value,_createdonbehalfby_value,_modifiedonbehalfby_value`);
  const result={targetHost:target.host,checkedAt:new Date().toISOString(),tableAudit:meta.IsAuditEnabled,attributes:meta.Attributes,people,profile,audits:audits.value,auditComplete:!audits['@odata.nextLink'],ownershipType:meta.OwnershipType,scope:'Mapped staff effective table privileges and import service-principal audit; no staff write or signed-in route verification'};
  fs.writeSync(fd,JSON.stringify(result,null,2)+'\n');fs.fsyncSync(fd);console.log(JSON.stringify({staff:people.map(p=>({legacyId:p.legacyId,privileges:p.privileges.map(x=>({name:x.name,grants:x.effective?.length??null}))})),auditCount:result.audits.length,auditComplete:result.auditComplete}));
 }finally{fs.closeSync(fd);}
}
if(require.main===module)main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
