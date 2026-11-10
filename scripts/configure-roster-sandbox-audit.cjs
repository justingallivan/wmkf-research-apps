#!/usr/bin/env node
/** Sandbox-only audit completion/readback for the roster User lookup. */
const fs=require('fs'),assert=require('node:assert/strict');
async function main(){
 const [envFile,out]=process.argv.slice(2);assert(envFile&&out,'ENV_FILE NEW_PRIVATE_RECEIPT required');
 const e=require('dotenv').parse(fs.readFileSync(envFile));for(const k of ['DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET'])process.env[k]=e[k];
 Object.assign(process.env,{NODE_ENV:'development',DATAVERSE_TARGET_INTERLOCK:'on',DATAVERSE_DAL_ENFORCEMENT:'on'});
 const {getAccessToken,createClient}=require('../lib/dataverse/client.js');const url='https://orgd9e66399.crm.dynamics.com';
 const c=createClient({resourceUrl:url,token:await getAccessToken(url)});
 const check=(r,label)=>{assert(r.ok,`${label}: HTTP ${r.status} ${r.body?.error?.code||''}`);return r.body;};
 const target="/EntityDefinitions(LogicalName='wmkf_expertiseprofile')/Attributes(LogicalName='wmkf_staffuser')";
 const full=check(await c.get(target),'lookup metadata');assert(full.IsAuditEnabled.CanBeChanged!==false);
 if(!full.IsAuditEnabled.Value){delete full['@odata.context'];full.IsAuditEnabled={...full.IsAuditEnabled,Value:true};check(await c.raw('PUT',target,full,{'MSCRM.MergeLabels':'true'}),'lookup audit enable');check(await c.post('/PublishXml',{ParameterXml:'<importexportxml><entities><entity>wmkf_expertiseprofile</entity></entities></importexportxml>'}),'publish');}
 const after=check(await c.get(target+'?$select=LogicalName,IsAuditEnabled'),'lookup audit readback');assert(after.IsAuditEnabled.Value);
 const fixtures=check(await c.get('/wmkf_expertiseprofiles?'+new URLSearchParams({$select:'wmkf_expertiseprofileid,wmkf_creationkey',$filter:"startswith(wmkf_creationkey,'direct_8c6a2c01-2609-4000-8000-00000000000')"})),'fixture read');assert(!fixtures['@odata.nextLink']);
 const audits=[];for(const row of fixtures.value){const r=await c.get('/audits?'+new URLSearchParams({$select:'auditid,operation,action,_objectid_value,_userid_value',$filter:`_objectid_value eq ${row.wmkf_expertiseprofileid}`}));audits.push({profileGuid:row.wmkf_expertiseprofileid,status:r.status,count:r.ok?r.body.value.length:null,complete:r.ok&&!r.body['@odata.nextLink']});}
 const result={checkedAt:new Date().toISOString(),targetHost:'orgd9e66399.crm.dynamics.com',staffUserAuditEnabled:true,audits,scope:'actual synthetic audit presence only; end-user attribution and staff permissions not yet tested'};
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));
}main().catch(e=>{console.error(e.message);process.exitCode=1;});
