#!/usr/bin/env node
/** Bounded 2026-11-16 Summary fixture setup. No provider calls or production writes.
 * Default read-only; --execute prepares one synthetic PI/PDF and publishes the
 * checked-in Summary definition in Sandbox. --verify seals the real PDF snapshot.
 * Uses the existing application's local credential file; emits no secrets.
 * Retains private original values and write intents for reconciliation, never retries.
 */
const fs = require('node:fs');
const { createRequire, registerHooks } = require('node:module');
const { randomUUID } = require('node:crypto');
const req = createRequire(`${process.cwd()}/package.json`);
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(`${s}.js`,c);throw e;}}});
const ORIGIN='https://orgd9e66399.crm.dynamics.com';
const REQUEST='a92c0f69-90ec-4c24-bc19-f26a0bfc18b6';
const CONTACT='a341c0b2-205d-4dd7-9c6b-b01ea91ebc36';
const FOLDER='1000389_A92C0F6990EC4C24BC19F26A0BFC18B6/Submission-Documents';
const FILE='Project-Narrative_1000389.pdf';
const OUT='/private/tmp/wmkf-summary-live-20261116';
const mode=process.argv[2]||'--inspect';
if(!['--inspect','--execute','--verify','--resume-setup','--publish-only'].includes(mode))throw Error('Invalid mode');
fs.mkdirSync(OUT,{recursive:true,mode:0o700});
const save=(name,value)=>fs.writeFileSync(`${OUT}/${name}.json`,JSON.stringify(value,null,2),{mode:0o600});
const creds=req('dotenv').parse(fs.readFileSync('/Users/gallivan/Code/WMKF_Apps/.env.local'));
for(const k of ['DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET','DYNAMICS_TENANT_ID'])process.env[k]=creds[k];
Object.assign(process.env,{DYNAMICS_URL:ORIGIN,DATAVERSE_TARGET_INTERLOCK:'on',DATAVERSE_DAL_ENFORCEMENT:'on',NODE_ENV:'development'});
const db=req('dotenv').parse(fs.readFileSync('/private/tmp/wmkf-pa-sandbox-db-20261112.env')).POSTGRES_URL;
if(new URL(db).hostname!=='ep-nameless-shape-afytiwop-pooler.c-2.us-west-2.aws.neon.tech')throw Error('Database pin mismatch');
process.env.POSTGRES_URL=db;process.env.DATABASE_URL=db;
let driveId,rootItemId,piNav;
const native=fetch;
global.fetch=(input,o={})=>{
 const u=new URL(typeof input==='string'?input:input.url),method=(o.method||'GET').toUpperCase();
 if(method==='POST'&&u.origin==='https://login.microsoftonline.com'&&u.pathname.endsWith('/oauth2/v2.0/token'))return native(input,{...o,redirect:'error'});
 if(method==='GET'&&(u.origin===ORIGIN||u.origin==='https://graph.microsoft.com'||u.hostname==='appriver3651007194.sharepoint.com'))return native(input,o);
 if(['--execute','--resume-setup','--publish-only'].includes(mode)){
  if(method==='POST'&&u.origin==='https://api.c-2.us-west-2.aws.neon.tech'&&u.pathname==='/sql'&&new URL(new Headers(o.headers).get('Neon-Connection-String')).hostname===new URL(db).hostname)return native(input,{...o,redirect:'error'});
  const b=typeof o.body==='string'?JSON.parse(o.body):null;
  if(u.origin===ORIGIN){
   if(method==='POST'&&u.pathname.endsWith('/contacts')&&b?.contactid===CONTACT)return native(input,{...o,redirect:'error'});
   if(method==='PATCH'&&u.pathname.endsWith(`/akoya_requests(${REQUEST})`)&&Object.keys(b||{}).length===1&&b[`${piNav}@odata.bind`]===`/contacts(${CONTACT})`&&new Headers(o.headers).get('if-match'))return native(input,{...o,redirect:'error'});
   if(method==='POST'&&u.pathname.endsWith('/wmkf_ai_prompts')&&b?.wmkf_ai_promptname==='proposal.executive-summary')return native(input,{...o,redirect:'error'});
   if(method==='POST'&&u.pathname.includes('settings')&&JSON.stringify(b).includes('executor.profiles.proposal-staff-trial.v000001'))return native(input,{...o,redirect:'error'});
  }
  if(u.origin==='https://graph.microsoft.com'&&driveId){
   if(method==='POST'&&u.pathname===`/v1.0/drives/${driveId}/items/${rootItemId}/children`&&b?.name==='Submission-Documents')return native(input,{...o,redirect:'error'});
   if(method==='PUT'&&decodeURIComponent(u.pathname)===`/v1.0/drives/${driveId}/root:/${FOLDER}/${FILE}:/content`&&u.searchParams.get('@microsoft.graph.conflictBehavior')==='fail')return native(input,{...o,redirect:'error'});
  }
 }
 emit(JSON.stringify({deniedMethod:method,deniedHost:u.hostname})+'\n');throw Error('Unapproved trial transport');
};
const emit=process.stdout.write.bind(process.stdout);
for(const k of ['log','warn','info','debug'])console[k]=()=>{};
function intent(name){fs.writeFileSync(`${OUT}/${name}.intent`,new Date().toISOString(),{flag:'wx',mode:0o600});}
(async()=>{
 const {withDalContext}=req('./lib/dataverse/core/context.js');
 await withDalContext('approved-bounded-summary-fixture',async()=>{
  const {getById,updateById}=req('./lib/dataverse/adapters/grant-request.js');
  const contact=req('./lib/dataverse/adapters/contact.js');
  const {GraphService}=req('./lib/services/graph-service.js');
  const {getRequestSharePointBuckets}=req('./lib/utils/sharepoint-buckets.js');
  const {getPromptProfiles,publishPromptProfile}=req('./lib/services/admin/prompt-profiles-service.js');
  const {createPrompt}=req('./lib/services/admin/prompts-publish-service.js');
  const {fetchCurrentPrompt}=req('./lib/services/prompt-store.js');
  const {canonical,hashProfile,sha256}=req('./lib/services/prompt-jobs/profile.js');
  const definition=req('./docs/plans/SHARED_EXECUTOR_PROPOSAL_RETRY_CANDIDATE_2026-11-11.json');
  const {createClient,getAccessToken}=req('./lib/dataverse/client.js');
  const client=createClient({resourceUrl:ORIGIN,token:await getAccessToken(ORIGIN)});
  const rel=await client.get("/EntityDefinitions(LogicalName='akoya_request')/ManyToOneRelationships?$select=ReferencingEntityNavigationPropertyName&$filter=ReferencingAttribute%20eq%20'wmkf_projectleader'");
  if(!rel.ok||rel.body.value.length!==1)throw Error('PI relationship unavailable');piNav=rel.body.value[0].ReferencingEntityNavigationPropertyName;
  emit(JSON.stringify({piNavigation:piNav})+'\n');
  const options={select:'akoya_requestid,akoya_requestnum,akoya_title,wmkf_istestrequest,wmkf_layabstract,_wmkf_projectleader_value,wmkf_wmkfprojectdescription',strictRead:true,expectedOrigin:ORIGIN};
  let row=await getById(REQUEST,options);
  if(row.akoya_requestnum!=='1000389'||row.wmkf_istestrequest!==true||!row.akoya_title.startsWith('TEST: PA bounded'))throw Error('Fixture identity mismatch');
  const buckets=await getRequestSharePointBuckets(REQUEST,'1000389',{requireResolvedParents:true,requireCompleteResults:true});
  const active=buckets.filter(x=>x.source==='dynamics'&&x.library.toLowerCase()==='akoya_request');
  if(active.length!==1||`${active[0].folder}/Submission-Documents`!==FOLDER)throw Error('Fixture folder mismatch');
  const siteId=await GraphService.getSiteId();driveId=await GraphService.getDriveId('akoya_request',{siteId});
  const root=await GraphService.getFileMetadataByPath('akoya_request','',active[0].folder,{siteId,driveId});
  rootItemId=root?.id;if(!rootItemId)throw Error('Missing fixture root');
  const existing=await GraphService.getFileMetadataByPath('akoya_request',FOLDER,FILE,{siteId,driveId});
  let prompt;try{prompt=await fetchCurrentPrompt('proposal.executive-summary');}catch(e){if(e.code!=='PROMPT_NOT_FOUND')throw e;}
  const profiles=await getPromptProfiles();
  if(['--execute','--resume-setup'].includes(mode)){
   if(row.wmkf_layabstract!=null&&row.wmkf_layabstract!=='')throw Error('Summary is not blank');
   if(row._wmkf_projectleader_value||existing||prompt||profiles.profiles.some(x=>x.profile.key===definition.profile.key))throw Error('Expected pristine fixture/configuration; inspect rather than retry');
   if(mode==='--execute')save('original',row);save('source-target',{requestId:REQUEST,contactId:CONTACT,siteId,driveId,rootItemId,folder:FOLDER,filename:FILE});
   if(mode==='--execute'){intent('contact-create');await contact.createPortalContact({contactid:CONTACT,firstname:'Summary Trial',lastname:'Synthetic Investigator',description:'Synthetic test contact for bounded Sandbox Summary integration 2026-11-16. Not a real applicant.'});}
   const person=await contact.getByIdWithSelect(CONTACT,'contactid,fullname');if(person.contactid!==CONTACT||!person.fullname.includes('Synthetic Investigator'))throw Error('PI readback mismatch');
   intent(mode==='--resume-setup'?'request-pi-corrected':'request-pi');await updateById(REQUEST,{[`${piNav}@odata.bind`]:`/contacts(${CONTACT})`},{ifMatch:row._etag,noFallback:true,expectedOrigin:ORIGIN});
   const {PDFDocument,StandardFonts}=req('pdf-lib');const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);const page=pdf.addPage([612,792]);
   const lines=[
    'SYNTHETIC SANDBOX PROJECT NARRATIVE - REQUEST 1000389',
    'This fabricated proposal exists only to test Executive Summary integration.',
    'Research question: Can low-intensity pulsed illumination improve live-cell',
    'imaging speed while reducing phototoxicity relative to continuous illumination?',
    'Hypothesis: Synchronized pulses will preserve measurement sensitivity at a',
    'lower total light dose without reducing temporal resolution.',
    'Innovation: The project combines a programmable light source with synchronized',
    'camera acquisition and a calibration method that corrects pulse-to-pulse drift.',
    'Approach: Build a laboratory optical prototype and evaluate cultured cells.',
    'Compare pulsed and continuous illumination at matched imaging resolution.',
    'Use fluorescent reference samples to calibrate brightness and noise.',
    'Randomize samples between conditions and blind the image-quality analysis.',
    'Measure signal-to-noise ratio, cell viability after imaging, and temporal',
    'resolution across three independently prepared batches of cells.',
    'Test the hypothesis by comparing sensitivity and viability at equal light dose',
    'and at equal image quality. Report uncertainty and batch variation.',
    'No preliminary results are claimed. Pulse instability and cell-type variation',
    'are important risks; calibration and independent batches address these risks.',
    'Potential impact: A validated method could enable longer observations of rapid',
    'cellular events with less imaging-induced damage. This remains a proposed outcome.',
    'This narrative contains no real investigator, institution, or grant information.'
   ];let y=750;for(const line of lines){page.drawText(line,{x:40,y,size:10,font});y-=19;}
   const bytes=Buffer.from(await pdf.save());fs.writeFileSync(`${OUT}/narrative.pdf`,bytes,{flag:'wx',mode:0o600});
   intent('folder-create');await GraphService.ensureFolderPath('akoya_request',FOLDER,{siteId,driveId});
   intent('pdf-upload');const uploaded=await GraphService.uploadFile('akoya_request',FOLDER,FILE,bytes,'application/pdf',{siteId,driveId,conflictBehavior:'fail',onItemCreated:x=>save('uploaded',x)});save('uploaded',uploaded);
   intent('profile-publish');await publishPromptProfile({profile:definition.profile,expectedVersion:0,requestId:randomUUID()});
   intent('prompt-publish');await createPrompt({...definition.tasks[0],catalog:{title:'Executive Summary - bounded Sandbox test',description:'Narrative-based scientific Summary, exact test enrollment only.',usage:'unconnected'},requestId:randomUUID(),profileId:null});
   prompt=await fetchCurrentPrompt('proposal.executive-summary');
  }
  if(mode==='--publish-only'){
   if(prompt||row._wmkf_projectleader_value!==CONTACT||!existing||!profiles.profiles.some(x=>x.sha256===hashProfile(definition.profile)))throw Error('Publication prerequisites changed');
   intent('prompt-publish-with-db');await createPrompt({...definition.tasks[0],catalog:{title:'Executive Summary - bounded Sandbox test',description:'Narrative-based scientific Summary, exact test enrollment only.',usage:'unconnected'},requestId:randomUUID(),profileId:null});
   prompt=await fetchCurrentPrompt('proposal.executive-summary');
  }
  if(prompt){save('pins',{requestId:REQUEST,promptId:prompt.wmkf_ai_promptid,promptVersion:prompt.wmkf_promptversion,promptHash:sha256(canonical(prompt)),profileHash:hashProfile(definition.profile)});}
  if(mode==='--verify'){
   const {createSummarySource}=req('./lib/services/prompt-jobs/summary-source.js');const source=createSummarySource({extractText:async (...args)=>{try{fs.writeFileSync(`${OUT}/downloaded.pdf`,args[0],{mode:0o600});emit(JSON.stringify({downloadBytes:args[0].length,downloadHash:sha256(args[0]),localHash:sha256(fs.readFileSync(`${OUT}/narrative.pdf`))})+'\n');return await req('./lib/utils/file-loader.js').extractTextFromBuffer(...args);}catch(e){emit(JSON.stringify({extractError:e.message})+'\n');throw e;}}});const manifest=await source.inspect({requestId:REQUEST});
   const snapshot=await source.prepare({manifest,profile:definition.profile,scope:{environment:'local-sandbox',requestId:REQUEST,authorizationScope:'pa-executive-summary:ff774f17-bbe0-4bc7-ab7b-9989dd85fc17'},nonceSecret:'offline-readonly-preflight-secret-20261116'});
   save('manifest',manifest);save('prepared-proof',{documentCount:snapshot.documents.length,sourceHash:sha256(fs.readFileSync(`${OUT}/narrative.pdf`)),snapshotHash:sha256(canonical(snapshot))});
   emit(JSON.stringify({prepared:true,documents:snapshot.documents.length,sourceCurrent:await source.isCurrent({manifest})})+'\n');
  }
  emit(JSON.stringify({mode,requestId:REQUEST,promptPresent:!!prompt,sourcePresent:!!existing||['--execute','--resume-setup'].includes(mode),sandbox:true})+'\n');
 });
})().catch(e=>{emit(JSON.stringify({error:e.code||e.name,message:String(e.message).slice(0,200),status:e.status})+'\n');process.exitCode=1;});
