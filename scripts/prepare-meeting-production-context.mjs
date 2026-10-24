#!/usr/bin/env node
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required for the dedicated rehearsal only');
/** Prepare only the owned fixture's binding/SharePoint location and isolated local staff profiles. Never changes global production configuration. */
import fs from 'node:fs';
import pg from 'pg';
import {loadEnvLocal,getAccessToken,createClient} from '../lib/dataverse/client.js';
import {GraphService} from '../lib/services/graph-service.js';
const file=process.argv[2],r=JSON.parse(fs.readFileSync(file)),origin='https://wmkf.crm.dynamics.com';
if(process.argv[3]!=='--execute'||r.requestId!=='185415ef-3750-4806-84c7-fb6dd032af31'||!r.nullBusinessBindingsVerified)throw Error('owned_fixture_required');
const save=()=>fs.writeFileSync(file,JSON.stringify(r,null,2),{mode:0o600});
loadEnvLocal();process.env.DATAVERSE_ALLOW_PROD_READS='yes';process.env.DATAVERSE_TARGET_INTERLOCK='on';process.env.DATAVERSE_PROD_WRITE_ACK='';
process.env.DATAVERSE_REHEARSAL_GRANT=JSON.stringify({purpose:r.purpose,ops:['PATCH','POST'],entitySets:['akoya_requests','sharepointdocumentlocations'],recordIds:[r.requestId,r.locationId],expiresAt:new Date(Date.now()+15*60000).toISOString()});
const c=createClient({resourceUrl:origin,token:await getAccessToken(origin)}),ok=(v,k)=>{if(!v.ok)throw Error(k+'_'+v.status);return v.body;};
const request=ok(await c.get(`/akoya_requests(${r.requestId})?$select=wmkf_istestrequest,wmkf_testcreationrunid,wmkf_triagestatus`),'request');
if(!request.wmkf_istestrequest||request.wmkf_testcreationrunid!==r.runId)throw Error('request_owner_mismatch');
if(request.wmkf_triagestatus!==100000000){ok(await c.patch(`/akoya_requests(${r.requestId})`,{wmkf_triagestatus:100000000},{'If-Match':request['@odata.etag']}),'triage_patch');r.triageAdvancing=true;save();}
const parents=ok(await c.get("/sharepointdocumentlocations?$filter=relativeurl eq 'akoya_request' and statecode eq 0&$select=sharepointdocumentlocationid,relativeurl&$top=3"),'parent').value;
if(parents.length!==1)throw Error('library_parent_not_unique');
r.folder=`${r.requestNumber}_${r.requestId.replace(/-/g,'').toUpperCase()}`;r.sharePointFolderAttempted=true;save();
r.siteId=await GraphService.getSiteId();r.driveId=await GraphService.getDriveId('akoya_request',{siteId:r.siteId});
const folder=await GraphService.ensureFolderPath('akoya_request',r.folder,{siteId:r.siteId,driveId:r.driveId});r.folderItemId=folder.id;r.sharePointFolderCreated=true;save();
if(!r.locationAttempted){r.locationAttempted=true;save();ok(await c.post('/sharepointdocumentlocations',{sharepointdocumentlocationid:r.locationId,name:'SYNTHETIC Meeting Tracker rehearsal '+r.runId.slice(0,8),relativeurl:r.folder,'regardingobjectid_akoya_request@odata.bind':`/akoya_requests(${r.requestId})`,'parentsiteorlocation_sharepointdocumentlocation@odata.bind':`/sharepointdocumentlocations(${parents[0].sharepointdocumentlocationid})`}), 'location_create');}
const location=ok(await c.get(`/sharepointdocumentlocations(${r.locationId})?$select=sharepointdocumentlocationid,_regardingobjectid_value,relativeurl`),'location');
if(location._regardingobjectid_value!==r.requestId||location.relativeurl!==r.folder)throw Error('location_owner_mismatch');r.locationCreated=true;save();
const actors=[];
const owner=ok(await c.get('/systemusers?$filter=azureactivedirectoryobjectid eq 893369cc-1925-40ec-bbc6-6f12b0684a31&$select=systemuserid,fullname,internalemailaddress,azureactivedirectoryobjectid,isdisabled'),'owner').value;if(owner.length!==1||owner[0].isdisabled)throw Error('owner_ineligible');actors.push({...owner[0],role:'helper',profileId:2});
const coordinator=ok(await c.get(`/systemusers(${r.coordinatorSystemUserId})?$select=systemuserid,fullname,internalemailaddress,azureactivedirectoryobjectid,isdisabled`),'coordinator');if(coordinator.isdisabled||!/@wmkeck\.org$/i.test(coordinator.internalemailaddress))throw Error('coordinator_ineligible');
const e=JSON.parse(fs.readFileSync('/private/tmp/wmkf-meeting-rehearsal-app-env.json'));if(new URL(e.POSTGRES_URL).pathname!=='/meeting_coord_rehearsal_20261023')throw Error('isolated_database_required');const db=new pg.Client({connectionString:e.POSTGRES_URL});await db.connect();
try{let profileId=2;if(coordinator.systemuserid!==owner[0].systemuserid){const existing=(await db.query('SELECT id FROM user_profiles WHERE azure_email=$1',[coordinator.internalemailaddress.toLowerCase()])).rows[0];if(existing)profileId=existing.id;else profileId=(await db.query('INSERT INTO user_profiles(name,display_name,azure_email,azure_id,is_active,needs_linking) VALUES($1,$1,$2,$3,true,false) RETURNING id',[coordinator.fullname,coordinator.internalemailaddress.toLowerCase(),coordinator.azureactivedirectoryobjectid])).rows[0].id;await db.query("INSERT INTO dynamics_user_roles(user_profile_id,role) VALUES($1,'superuser') ON CONFLICT(user_profile_id) DO NOTHING",[profileId]);}actors.push({...coordinator,role:'coordinator',profileId});for(const actor of actors)await db.query('UPDATE user_profiles SET dynamics_systemuser_id=$1 WHERE id=$2',[actor.systemuserid,actor.profileId]);}finally{await db.end();}
fs.writeFileSync('/private/tmp/wmkf-meeting-production-actors.json',JSON.stringify(actors),{mode:0o600});r.coordinatorProfileId=actors.at(-1).profileId;r.contextReady=true;save();console.log(JSON.stringify({requestId:r.requestId,triageAdvancing:r.triageAdvancing,folder:r.folder,locationCreated:r.locationCreated,coordinatorVerified:true,productionGlobalSettingsChanged:false}));
