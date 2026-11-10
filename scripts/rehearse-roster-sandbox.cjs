#!/usr/bin/env node
/** Sandbox-only synthetic key/null/ETag and isolated bridge rehearsal.
 * Never imports real roster records. Receipts retained; no cleanup/delete mode.
 */
const fs=require('node:fs'),assert=require('node:assert/strict');
const {Client}=require('pg');
const HOST='orgd9e66399.crm.dynamics.com',ENTITY="/EntityDefinitions(LogicalName='wmkf_expertiseprofile')";
async function main(){
 const [credentialFile,localEnvFile,receiptFile,mode]=process.argv.slice(2);assert(['--metadata','--execute'].includes(mode),'explicit mode required');
 const local=require('dotenv').parse(fs.readFileSync(localEnvFile));const u=new URL(local.POSTGRES_URL);assert(!u.search&&!u.hash&&u.hostname==='127.0.0.1'&&u.port==='55439'&&u.pathname==='/roster_rehearsal'&&u.username==='roster_rehearsal');
 for(const alias of ['DATABASE_URL','POSTGRES_URL_NON_POOLING','POSTGRES_PRISMA_URL'])assert.equal(local[alias],local.POSTGRES_URL);
 const env=require('dotenv').parse(fs.readFileSync(credentialFile));
 for(const k of ['DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET'])process.env[k]=env[k];
 Object.assign(process.env,{NODE_ENV:'development',DATAVERSE_TARGET_INTERLOCK:'on',DATAVERSE_DAL_ENFORCEMENT:'on'});
 const {getAccessToken,createClient}=require('../lib/dataverse/client.js');
 const c=createClient({resourceUrl:'https://'+HOST,token:await getAccessToken('https://'+HOST)});
 const receipt={targetHost:HOST,syntheticOnly:true,startedAt:new Date().toISOString(),steps:[]};
 const fd=fs.openSync(receiptFile,'wx',0o600);fs.closeSync(fd);
 const save=()=>fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
 const checked=async(r,label)=>{if(!r.ok)throw Error(`${label}: HTTP ${r.status} ${r.body?.error?.code||''} ${r.body?.error?.message||''}`);return r.body;};
 try{
 const meta=await checked(await c.get(ENTITY+'?$select=LogicalName,EntitySetName,IsAuditEnabled,IsOptimisticConcurrencyEnabled'),'metadata');
 let keys=await checked(await c.get(ENTITY+'/Keys?$select=SchemaName,KeyAttributes,EntityKeyIndexStatus'),'keys');
 receipt.metadata=meta;receipt.keys=keys.value;save();
 if(mode==='--metadata')return;
 for(let attempt=0;attempt<30&&!(keys.value.length===3&&keys.value.every(k=>k.EntityKeyIndexStatus==='Active'));attempt++){
  assert(!keys.value.some(k=>k.EntityKeyIndexStatus==='Failed'),'Alternate key creation failed');
  await new Promise(resolve=>setTimeout(resolve,10000));
  keys=await checked(await c.get(ENTITY+'/Keys?$select=SchemaName,KeyAttributes,EntityKeyIndexStatus'),'key readiness');
  receipt.keys=keys.value;save();
 }
 assert(keys.value.length===3&&keys.value.every(k=>k.EntityKeyIndexStatus==='Active'),'All three alternate keys must be Active; bounded wait expired before any row writes');
 assert.deepEqual(keys.value.map(k=>k.KeyAttributes.join(',')).sort(),['wmkf_contactguid','wmkf_creationkey','wmkf_staffuser']);
 assert(meta.IsOptimisticConcurrencyEnabled===true,'Optimistic concurrency required');
 // Exact table-scoped audit configuration, using the existing metadata-update convention.
 if(!meta.IsAuditEnabled?.Value){
 const full=await checked(await c.get(ENTITY),'full metadata');delete full['@odata.context'];full.IsAuditEnabled={...full.IsAuditEnabled,Value:true};
 await checked(await c.raw('PUT',ENTITY,full,{'MSCRM.MergeLabels':'true'}),'enable audit');
 await checked(await c.post('/PublishXml',{ParameterXml:'<importexportxml><entities><entity>wmkf_expertiseprofile</entity></entities></importexportxml>'}),'publish');
 }
 const audit=await checked(await c.get(ENTITY+'?$select=IsAuditEnabled'),'audit readback');assert(audit.IsAuditEnabled.Value);receipt.steps.push('table auditing enabled');save();
 const base='/'+meta.EntitySetName;
 const ids=['8c6a2c01-2609-4000-8000-000000000001','8c6a2c01-2609-4000-8000-000000000002','8c6a2c01-2609-4000-8000-000000000003'];
 for(let i=0;i<3;i++){
 const key='direct_'+ids[i],url=base+"(wmkf_creationkey='"+key+"')";
 const body={wmkf_name:'SYNTHETIC roster rehearsal '+(i+1),wmkf_category:i===0?100000001:100000002,wmkf_creationkey:key,wmkf_leadpdeligible:false};
 const existing=await c.get(url);
 if(existing.ok){assert(existing.body.wmkf_name===body.wmkf_name,'Existing fixture differs; refuse overwrite');}
 else{assert.equal(existing.status,404);await checked(await c.post(base,body),'create synthetic profile');}
 const row=await checked(await c.get(url+'?$select=wmkf_expertiseprofileid,wmkf_name,wmkf_category,wmkf_creationkey,wmkf_leadpdeligible,wmkf_contactguid,_wmkf_staffuser_value'),'read fixture');assert(Object.hasOwn(row,'wmkf_contactguid')&&Object.hasOwn(row,'_wmkf_staffuser_value'),'Incomplete identity projection');for(const [field,value]of Object.entries(body))assert.equal(row[field],value,`Fixture drift at ${field}`);assert(row.wmkf_contactguid==null&&row._wmkf_staffuser_value==null,'Null-link fixture required');receipt.steps.push({fixture:i+1,guid:row.wmkf_expertiseprofileid});save();
 }
 receipt.steps.push('multiple null User and Contact keys accepted');save();
 const url=base+"(wmkf_creationkey='direct_"+ids[0]+"')";
 const replay=await c.post(base,{wmkf_name:'must not overwrite',wmkf_category:100000001,wmkf_creationkey:'direct_'+ids[0]});assert(!replay.ok&&/duplicate|unique|entity key/i.test(replay.body?.error?.message||''),'Create-only replay must refuse existing key');
 const row=await checked(await c.get(url),'etag read');
 await checked(await c.patch(url,{wmkf_role:'Synthetic rehearsal title'},{'If-Match':row['@odata.etag']}),'etag update');
 const stale=await c.patch(url,{wmkf_role:'must not overwrite'},{'If-Match':row['@odata.etag']});assert.equal(stale.status,412,'Stale edit must fail');
 receipt.steps.push('create-only replay and stale ETag rejected');save();
 const second=base+"(wmkf_creationkey='direct_"+ids[1]+"')";
 const fakeContact='8c6a2c01-2609-4000-8000-000000000099';
 await checked(await c.patch(url,{wmkf_contactguid:fakeContact,statecode:1,statuscode:2}),'inactive synthetic Contact holder');
 const duplicate=await c.patch(second,{wmkf_contactguid:fakeContact});
 assert(!duplicate.ok && /duplicate|unique|entity key/i.test(duplicate.body?.error?.message||''),'Contact key must reject duplicate inactive holder');
 const cleanSecond=await checked(await c.get(second),'duplicate readback');assert(!cleanSecond.wmkf_contactguid,'Failed write must leave second link empty');
 receipt.steps.push('Contact uniqueness includes inactive holders; failed write leaves second row unchanged');save();
 const userQuery=await checked(await c.get('/systemusers?'+new URLSearchParams({$select:'systemuserid,isdisabled',$filter:"internalemailaddress eq 'jsader@wmkeck.org'"})),'sandbox User');
 assert(userQuery.value.length===1&&!userQuery.value[0].isdisabled&&!userQuery['@odata.nextLink'],'Unique enabled sandbox User required');
 const rels=await checked(await c.get(ENTITY+"/ManyToOneRelationships?$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName&$filter=ReferencingAttribute eq 'wmkf_staffuser'"),'User navigation');
 assert.equal(rels.value.length,1);const navigation=rels.value[0].ReferencingEntityNavigationPropertyName;
 const third=base+"(wmkf_creationkey='direct_"+ids[2]+"')";
 await checked(await c.patch(third,{wmkf_category:100000000,[navigation+'@odata.bind']:'/systemusers('+userQuery.value[0].systemuserid+')',statecode:1,statuscode:2}),'synthetic User holder');
 const duplicateUser=await c.patch(second,{wmkf_category:100000000,[navigation+'@odata.bind']:'/systemusers('+userQuery.value[0].systemuserid+')'});
 assert(!duplicateUser.ok&&/duplicate|unique|entity key/i.test(duplicateUser.body?.error?.message||''),'User key must reject duplicate inactive holder');
 receipt.steps.push('User uniqueness includes inactive holders');save();
 // Release only this run's verified synthetic link reservations; preserve the rows.
 await checked(await c.patch(url,{wmkf_contactguid:null,statecode:0,statuscode:1}),'restore Contact fixture');
 await checked(await c.patch(third,{[navigation+'@odata.bind']:null,wmkf_category:100000002,statecode:0,statuscode:1}),'restore User fixture');
 const restoredContact=await checked(await c.get(url),'Contact restore readback');
 const restoredUser=await checked(await c.get(third),'User restore readback');
 assert(restoredContact.wmkf_contactguid==null&&restoredContact.statecode===0);
 assert(restoredUser._wmkf_staffuser_value==null&&restoredUser.wmkf_category===100000002&&restoredUser.statecode===0);
 receipt.steps.push('synthetic link reservations released and read back; rows retained');save();

 const org=await checked(await c.get('/organizations?$select=isauditenabled'),'organization audit');
 receipt.organizationAuditEnabled=org.value?.[0]?.isauditenabled===true;
 const attrs=await checked(await c.get(ENTITY+'/Attributes?$select=LogicalName,IsAuditEnabled'),'attribute audit');
 receipt.attributeAudit=attrs.value.filter(a=>a.LogicalName.startsWith('wmkf_')).map(a=>({name:a.LogicalName,enabled:a.IsAuditEnabled?.Value}));save();

 const pg=new Client({connectionString:local.POSTGRES_URL});await pg.connect();
 try{
 await pg.query('BEGIN');await pg.query('INSERT INTO expertise_roster_identity(id) VALUES(1),(2),(3) ON CONFLICT DO NOTHING');
 for(const step of receipt.steps.filter(s=>s.guid))await pg.query('INSERT INTO expertise_roster_binding(roster_id,target_host,dataverse_profile_guid) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[step.fixture,HOST,step.guid]);
 const count=(await pg.query('SELECT count(*)::int n FROM expertise_roster_binding WHERE target_host=$1',[HOST])).rows[0].n;assert.equal(count,3);
 await pg.query('ROLLBACK');
 const after=(await pg.query('SELECT count(*)::int n FROM expertise_roster_binding')).rows[0].n;assert.equal(after,0);
 receipt.steps.push('isolated bridge population and transaction rollback passed; old feedback FK untouched');
 }finally{await pg.end();}
 receipt.success=true;save();console.log(JSON.stringify({success:true,steps:receipt.steps.length,receipt:receiptFile}));
 }catch(e){receipt.error=e.message;save();throw e;}
}main().catch(e=>{console.error(e.message);process.exitCode=1;});
