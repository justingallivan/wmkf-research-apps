#!/usr/bin/env node
/** Read-only sandbox candidate inventory. Names alone never authorize reuse.
 * PRIVATE_FULL_ENV STAFF_ENV NEW_PRIVATE_JSON. No Blob or model API calls.
 */
const fs=require('node:fs'),path=require('node:path');
const {parse}=require('dotenv');
const {assertTarget}=require('../lib/services/expertise-finder/roster-rehearsal-target.cjs');
function read(file){const s=fs.lstatSync(file);if(!path.isAbsolute(file)||!s.isFile()||s.isSymbolicLink()||(s.mode&0o077))throw Error('Private regular input required');return fs.readFileSync(file);}
async function main([full,staffFile,out,...extra]){
 if(!full||!staffFile||!out||extra.length||!path.isAbsolute(out))throw Error('Three absolute paths required');
 const env=parse(read(full)),staff=parse(read(staffFile)),target=assertTarget(env);
 if(env.NODE_ENV==='production'||env.VERCEL_ENV)throw Error('Local sandbox only');
 const parent=fs.realpathSync(path.dirname(out)),root=fs.realpathSync(path.resolve(__dirname,'..'));
 if(parent===root||parent.startsWith(root+path.sep)||(fs.statSync(parent).mode&0o077))throw Error('Private external output required');
 for(const k of ['DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET','DATAVERSE_TARGET_INTERLOCK','DATAVERSE_DAL_ENFORCEMENT'])process.env[k]=env[k];
 const {createClient,getAccessToken}=require('../lib/dataverse/client.js');
 const client=createClient({resourceUrl:env.DYNAMICS_URL,token:await getAccessToken(env.DYNAMICS_URL)});
 const queries={
  contacts:"/contacts?$select=contactid,fullname,emailaddress1,statecode,createdon,modifiedon&$filter=contains(fullname,'Synthetic') or startswith(fullname,'Test ')&$top=50",
  users:"/systemusers?$select=systemuserid,fullname,internalemailaddress,isdisabled&$filter=contains(fullname,'Synthetic') or startswith(fullname,'Test ')&$top=50",
  requests:'/akoya_requests?$select=akoya_requestid,akoya_requestnum,wmkf_istestrequest,wmkf_testcreationrunid&$filter=wmkf_istestrequest eq true&$top=50',
  profiles:'/wmkf_expertiseprofiles?$select=wmkf_expertiseprofileid,wmkf_creationkey,wmkf_contactguid,_wmkf_staffuser_value,statecode&$top=100',
 };
 const result={targetHost:target.host,checkedAt:new Date().toISOString(),candidateOnly:true,resources:{},configuration:{}};
 for(const [name,url] of Object.entries(queries)){
  const response=await client.raw('GET',url,undefined,{}, {timeoutMs:30000});
  result.resources[name]={status:response.status,...(response.ok?{complete:!response.body['@odata.nextLink'],rows:response.body.value}:{})};
 }
 const {configuredSharePointTargetInfo}=require('../lib/services/sharepoint-target-registry.js');
 result.configuration.sharePoint=configuredSharePointTargetInfo(staff);
 for(const name of ['UPLOADS_BLOB_RW_TOKEN','BLOB_READ_WRITE_TOKEN','CLAUDE_API_KEY','CLOUDMERSIVE_API_KEY'])result.configuration[name+'Present']=Boolean(staff[name]);
 result.configuration.virusScanSetting=staff.VIRUS_SCAN_ENABLED||'unset';
 // Read only site/drive resolution; never ensure folders or upload/delete files.
 if(result.configuration.sharePoint.registered){
  try{
   process.env.SHAREPOINT_SITE_URL=result.configuration.sharePoint.siteUrl;
   const {GraphService}=require('../lib/services/graph-service.js');
   result.configuration.graph={siteId:await GraphService.getSiteId(),driveId:await GraphService.getDriveId('akoya_request'),verified:true};
  }catch{result.configuration.graph={verified:false};}
 }
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({resources:Object.fromEntries(Object.entries(result.resources).map(([k,v])=>[k,{status:v.status,complete:v.complete,count:v.rows?.length}])),configuration:{sharePointScope:result.configuration.sharePoint.scope,graphResolved:result.configuration.graph?.verified,privateBlobTokenPresent:result.configuration.UPLOADS_BLOB_RW_TOKENPresent,publicBlobTokenPresent:result.configuration.BLOB_READ_WRITE_TOKENPresent,modelKeyPresent:result.configuration.CLAUDE_API_KEYPresent,scannerKeyPresent:result.configuration.CLOUDMERSIVE_API_KEYPresent,virusScanSetting:result.configuration.virusScanSetting}}));
}
if(require.main===module)main(process.argv.slice(2)).catch(()=>{console.error('Remaining fixture probe failed; no sensitive detail emitted.');process.exitCode=1;});
