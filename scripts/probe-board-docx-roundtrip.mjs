/** Bounded operator-only SharePoint rehearsal; no Dataverse/PG/mail, no deletion.
 * Run from feature checkout: node /tmp/.../probe.mjs prepare|upload|archive
 * Credentials are loaded from the original checkout, Graph scope only.
 * Fixed parents, exact unique folder names, receipt IDs, create-only uploads.
 */
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const home='/tmp/wmkf-board-rehearsal', receipt=`${home}/receipt.json`;
const env=parseEnv(fs.readFileSync('/Users/gallivan/Code/WMKF_Apps/.env.local','utf8'));
for(const k of ['DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET']) {if(!env[k])throw Error(`Missing ${k}`);process.env[k]=env[k];}
const base=process.cwd();
const {GraphService:G}=await import(pathToFileURL(`${base}/lib/services/graph-service.js`));
const {RESEARCH_BOARD_MATERIALS_TARGET:T}=await import(pathToFileURL(`${base}/lib/services/sharepoint-target-registry.js`));
const {hashGovernedDocxContent:hash}=await import(pathToFileURL(`${base}/lib/services/documents/governed-docx-hash.js`));
const token=await G.getAccessToken();
async function call(path,method='GET',body){
 if(!path.startsWith('/drives/'))throw Error('Unexpected path');
 const r=await fetch('https://graph.microsoft.com/v1.0'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000),redirect:'error'});
 const v=await r.json().catch(()=>({}));if(!r.ok){const e=Error(`Graph ${r.status} ${v.error?.code||''}`);e.status=r.status;throw e;}return v;
}
let s=fs.existsSync(receipt)?JSON.parse(fs.readFileSync(receipt)):{};
function save(){fs.writeFileSync(receipt,JSON.stringify(s,null,2));}
function itemPath(t){return `/drives/${encodeURIComponent(t.driveId)}/items/${encodeURIComponent(t.folderId)}`;}
async function folder(t){
 const p=await call(itemPath(t));if(!p.folder||p.id!==t.folderId||p.webUrl!==t.webUrl)throw Error('Parent changed');
 // No recovery by name: stop on uncertain creation and inspect receipt manually.
 const f=await call(itemPath(t)+'/children','POST',{name:s.name,folder:{},'@microsoft.graph.conflictBehavior':'fail'});
 if(!f.folder||f.parentReference.id!==t.folderId)throw Error('Folder identity mismatch');
 return {siteId:t.siteId,driveId:t.driveId,folderId:f.id,webUrl:f.webUrl,path:decodeURIComponent(new URL(f.webUrl).pathname).split('/').slice(4).join('/')};
}
async function upload(t,bytes){
 const name='000000 - Fictional Rehearsal - Writeup.docx';
 let u;
 if(t===s.board){u=await call(`${itemPath(t)}:/${encodeURIComponent(name)}:/createUploadSession`,'POST',{item:{'@microsoft.graph.conflictBehavior':'fail',name}});}
 else {u=await G.createBrowserUploadSession('akoya_request',s.name,name,{conflictBehavior:'fail',siteId:t.siteId,driveId:t.driveId});}
 const item=(await G.putUploadSessionChunk(u.uploadUrl,{start:0,bytes,total:bytes.length})).item;
 if(!item?.id)throw Error('Upload outcome unknown');
 return {id:item.id,name:item.name,webUrl:item.webUrl,eTag:item.eTag};
}
async function download(t,id){const before=await G.getFileMetadataById(t.driveId,id);const {buffer}=await G.downloadFile(t.driveId,id);const after=await G.getFileMetadataById(t.driveId,id);if(before.eTag!==after.eTag)throw Error('Version changed during read');return {buffer,meta:after,hash:await hash(buffer)};}
async function conflict(t,bytes,id){let refused=null;try{await upload(t,bytes);}catch(e){if(e.status===409)refused=409;else throw e;}if(!refused)throw Error('Conflict did not refuse');const r=await download(t,id);return {status:refused,hash:r.hash,eTag:r.meta.eTag};}
try{
 const phase=process.argv[2];
 if(phase==='prepare'){
  if(s.name)throw Error('Already prepared');
  const p=await call(`/drives/${encodeURIComponent(T.driveId)}/items/${T.folderId}`);
  if(p.id!==T.folderId||p.webUrl!==T.webUrl||!p.folder)throw Error('Research parent differs');
  const siteId=await G.getSiteId(),driveId=await G.getDriveId('akoya_request',{siteId});
  const a=await call(`/drives/${encodeURIComponent(driveId)}/root`);
  s={name:`WMKF-Board-Rehearsal-20261017-${randomUUID().slice(0,8)}`,preparedAt:new Date().toISOString(),parents:{board:T,archive:{siteId,driveId,folderId:a.id,webUrl:a.webUrl}}};save();
  console.log(JSON.stringify(s,null,2));
 }else if(phase==='upload'){
  if(!s.parents||s.board||s.uploadStarted)throw Error('Not prepared or already attempted');
  s.uploadStarted=new Date().toISOString();save();
  s.board=await folder(s.parents.board);save();s.archive=await folder(s.parents.archive);save();
  const bytes=fs.readFileSync(`${home}/source.docx`);s.sourceHash=await hash(bytes);save();
  s.boardItem=await upload(s.board,bytes);save();
  const read=await download(s.board,s.boardItem.id);if(read.hash!==s.sourceHash)throw Error('Board round trip hash mismatch');
  fs.writeFileSync(`${home}/board-readback.docx`,read.buffer);s.boardReadback={hash:read.hash,eTag:read.meta.eTag,versionId:read.meta.versionId};save();
  s.boardConflict=await conflict(s.board,bytes,s.boardItem.id);if(s.boardConflict.hash!==s.sourceHash)throw Error('Conflict altered content');save();
  console.log(JSON.stringify({boardUrl:s.boardItem.webUrl,boardFolder:s.board.webUrl,archiveFolder:s.archive.webUrl,roundTrip:'PASS',conflict:s.boardConflict},null,2));
 }else if(phase==='inspect-open'){
  s.childrenWhileWordOpen=(await call(itemPath(s.board)+'/children')).value.map(x=>({id:x.id,name:x.name}));save();console.log(JSON.stringify(s.childrenWhileWordOpen));
 }else if(phase==='archive'){
  if(!s.boardReadback||s.archiveStarted)throw Error('Not ready or already attempted');
  const read=await download(s.board,s.boardItem.id);if(read.hash===s.sourceHash)throw Error('No Word edit observed');
  s.edited={hash:read.hash,eTag:read.meta.eTag,versionId:read.meta.versionId};
  s.boardChildren=(await call(itemPath(s.board)+'/children')).value.map(x=>({id:x.id,name:x.name}));
  s.archiveStarted=new Date().toISOString();save();
  s.archiveItem=await upload(s.archive,read.buffer);save();const archived=await download(s.archive,s.archiveItem.id);
  if(archived.hash!==read.hash)throw Error('Archive round trip hash mismatch');fs.writeFileSync(`${home}/archive-readback.docx`,archived.buffer);
  s.archiveReadback={hash:archived.hash,eTag:archived.meta.eTag,versionId:archived.meta.versionId};save();
  s.archiveConflict=await conflict(s.archive,read.buffer,s.archiveItem.id);if(s.archiveConflict.hash!==read.hash)throw Error('Conflict altered archive');
  s.completedAt=new Date().toISOString();save();console.log(JSON.stringify({archiveUrl:s.archiveItem.webUrl,roundTrip:'PASS',conflict:s.archiveConflict,children:s.boardChildren},null,2));
 }else throw Error('Unknown phase');
}catch(e){s.failure={at:new Date().toISOString(),message:e.message,status:e.status||null};save();console.error(JSON.stringify(s.failure));process.exitCode=1;}
