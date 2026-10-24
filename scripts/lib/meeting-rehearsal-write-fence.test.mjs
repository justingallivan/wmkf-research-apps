import test from 'node:test';
import assert from 'node:assert/strict';
import {fencedMeetingFetch} from './meeting-rehearsal-write-fence.mjs';
const requestId='185415ef-3750-4806-84c7-fb6dd032af31';
const scope={requestId,visitId:'6976986d-a760-4a51-bd1f-1add2697a9dd',folder:'owned-folder',driveId:'owned-drive'};
for(const [name,url,method,body] of [
 ['email','https://graph.microsoft.com/v1.0/me/sendMail','POST',{}],
 ['foreign request','https://wmkf.crm.dynamics.com/api/data/v9.2/akoya_requests(00000000-0000-0000-0000-000000000000)','PATCH',{}],
 ['foreign document binding','https://wmkf.crm.dynamics.com/api/data/v9.2/wmkf_requestdocuments','POST',{'wmkf_request@odata.bind':'/akoya_requests(00000000-0000-0000-0000-000000000000)'}],
 ['deep insert','https://wmkf.crm.dynamics.com/api/data/v9.2/wmkf_requestdocuments','POST',{'wmkf_request@odata.bind':`/akoya_requests(${requestId})`,nested:{name:'foreign'}}],
 ['foreign folder','https://graph.microsoft.com/v1.0/drives/owned-drive/root:/foreign/file:/content','PUT','bytes'],
 ['unknown destination','https://example.com/write','POST',{}],
])test('denies '+name+' before mutation',async()=>{let calls=0;const fetch=fencedMeetingFetch(async()=>{calls++;return new Response('{}')},scope);await assert.rejects(fetch(url,{method,body:JSON.stringify(body)}),/rehearsal_write_denied/);assert.equal(calls,0);});
test('allows owned document registration',async()=>{let calls=0;const fetch=fencedMeetingFetch(async()=>{calls++;return new Response('{}')},scope);await fetch('https://wmkf.crm.dynamics.com/api/data/v9.2/wmkf_requestdocuments',{method:'POST',body:JSON.stringify({'wmkf_request@odata.bind':`/akoya_requests(${requestId})`,wmkf_name:'synthetic'})});assert.equal(calls,1);});
test('denies moving owned Graph item to another folder',async()=>{let calls=0;const fetch=fencedMeetingFetch(async()=>{calls++;return new Response(JSON.stringify({name:'file',parentReference:{path:'/drives/owned-drive/root:/owned-folder'}}))},scope);await assert.rejects(fetch('https://graph.microsoft.com/v1.0/drives/owned-drive/items/owned-item',{method:'PATCH',body:JSON.stringify({parentReference:{id:'foreign'}})}),/rehearsal_write_denied/);assert.equal(calls,1);});
