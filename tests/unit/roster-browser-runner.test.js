/** @jest-environment node */
const {environment,verifyCensus}=require('../../scripts/run-roster-browser-venue.cjs');
const canary='b34e680b-849c-4207-a2c5-689defd79aa7',other='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const url='postgres://roster_rehearsal:synthetic@127.0.0.1:55439/roster_rehearsal';
const rehearsal={POSTGRES_URL:url,DATABASE_URL:url,POSTGRES_URL_NON_POOLING:url,POSTGRES_PRISMA_URL:url,DYNAMICS_URL:'https://orgd9e66399.crm.dynamics.com',DYNAMICS_TENANT_ID:'synthetic',DYNAMICS_CLIENT_ID:'synthetic',DYNAMICS_CLIENT_SECRET:'synthetic',DATAVERSE_TARGET_INTERLOCK:'on',DATAVERSE_DAL_ENFORCEMENT:'on'};
const staff={AZURE_AD_CLIENT_ID:'synthetic',AZURE_AD_CLIENT_SECRET:'synthetic',AZURE_AD_TENANT_ID:'synthetic'};
const schema='roster_rehearsal_'+'a'.repeat(32);
function census(){return {profiles:[{profileGuid:canary,values:{wmkf_name:'Synthetic canary',statecode:1,'@odata.etag':'W/"1"',modifiedon:'2026-01-01T00:00:00Z'}},{profileGuid:other,values:{wmkf_name:'Other','@odata.etag':'W/"2"'}}]};}
test('environment is allowlisted with a fresh secret and no inherited credentials or test flags',()=>{
 const previous={...process.env};try{
  process.env.OPENAI_API_KEY='forbidden';process.env.BLOB_READ_WRITE_TOKEN='forbidden';process.env.VERCEL='1';process.env.MEETING_TRANSCRIPTION_TEST_DEPLOYMENT_PROFILE='forbidden';
  const a=environment(rehearsal,staff,schema),b=environment(rehearsal,staff,schema);
  expect(a.NEXTAUTH_SECRET).not.toBe(b.NEXTAUTH_SECRET);expect(a.NEXTAUTH_SECRET).toBeTruthy();
  for(const key of ['OPENAI_API_KEY','BLOB_READ_WRITE_TOKEN','VERCEL','MEETING_TRANSCRIPTION_TEST_DEPLOYMENT_PROFILE'])expect(a).not.toHaveProperty(key);
  expect(a).toMatchObject({AUTH_REQUIRED:'true',EXPERTISE_ROSTER_BROWSER_SCHEMA:schema});
 }finally{process.env=previous;}
});
test('only canary ETag and modifiedon may change',()=>{
 const before=census(),after=structuredClone(before);after.profiles[0].values['@odata.etag']='W/"3"';after.profiles[0].values.modifiedon='2026-01-02T00:00:00Z';
 expect(verifyCensus(before,after)).toMatchObject({allNonCanaryProfilesUnchanged:true,canaryBusinessValuesRestored:true,canaryEtagChanged:true});
});
test.each(['count','other','canary'])('refuses %s census drift',kind=>{
 const before=census(),after=structuredClone(before);if(kind==='count')after.profiles.pop();if(kind==='other')after.profiles[1].values.wmkf_name='Changed';if(kind==='canary')after.profiles[0].values.statecode=0;
 expect(()=>verifyCensus(before,after)).toThrow();
});

const {EventEmitter}=require('node:events');
const {watchServer}=require('../../scripts/run-roster-browser-venue.cjs');
function serverWatch(){const signals=new EventEmitter(),child=new EventEmitter();child.exitCode=null;child.signalCode=null;child.kill=jest.fn();return {signals,child,watch:watchServer(child,signals)};}
test.each([['SIGINT',130],['SIGTERM',143]])('intentional %s accepts exit %s',async(signal,code)=>{
 const {signals,child,watch}=serverWatch();signals.emit(signal);expect(child.kill).toHaveBeenCalledWith('SIGTERM');child.exitCode=code;child.emit('exit',code,null);await expect(watch.done).resolves.toBeUndefined();watch.dispose();
});
test('unexpected exit 143 rejects',async()=>{const {child,watch}=serverWatch();child.exitCode=143;child.emit('exit',143,null);await expect(watch.done).rejects.toThrow('Venue server failed');watch.dispose();});
test('repeated stop during cleanup is handled without killing an exited child',async()=>{
 const {signals,child,watch}=serverWatch();signals.emit('SIGINT');child.exitCode=130;child.emit('exit',130,null);await watch.done;
 signals.emit('SIGINT');signals.emit('SIGTERM');expect(child.kill).toHaveBeenCalledTimes(1);expect(signals.listenerCount('SIGINT')).toBe(1);expect(signals.listenerCount('SIGTERM')).toBe(1);
 watch.dispose();expect(signals.listenerCount('SIGINT')).toBe(0);expect(signals.listenerCount('SIGTERM')).toBe(0);
});
test('child process error rejects',async()=>{const {child,watch}=serverWatch();const error=Error('spawn failed');child.emit('error',error);await expect(watch.done).rejects.toBe(error);watch.dispose();});

const {validateLiveManifest,attachmentCleanupPending}=require('../../scripts/run-roster-browser-venue.cjs');
const source=require('../../docs/plans/evidence/test-request-factory/app-owned-location-rehearsal-2026-09-23.json');
const graphFolder=require('../../docs/plans/evidence/test-request-factory/app-owned-location-receipt-2026-09-23.json').locationProvision.graphFolder;
function liveManifest(){const loc=source.appOwnedSharePointProvision;return {authorization:{attachments:true,matching:false,publicBlob:false},sandboxHost:new URL(source.target).hostname,requestId:source.requestId,requestNumber:source.requestNumber,factoryRunId:source.runId,locationId:loc.locationId,parentLocationId:loc.parentLocationId,library:loc.parentLibrary,graphParentFolderId:loc.graphFolderId,graphFolderPath:`${loc.folder}/Consultant Feedback`,site:{key:'akoyago-shared',scope:'shared',siteUrl:'https://appriver3651007194.sharepoint.com/sites/akoyaGO'},siteId:graphFolder.siteId,driveId:graphFolder.driveId,blobStore:'wmkf-uploads-private',blobPrefix:`portal-staging/consultant_feedback/${source.requestId}/`};}
test('live credentials require explicit approved mode and exact fixture',()=>{
 const staffWithKeys={...staff,UPLOADS_BLOB_RW_TOKEN:'blob-synthetic',CLAUDE_API_KEY:'model-synthetic',BLOB_READ_WRITE_TOKEN:'public-synthetic'};
 const a=environment(rehearsal,staffWithKeys,schema,liveManifest());expect(a.UPLOADS_BLOB_RW_TOKEN).toBe('blob-synthetic');expect(a).not.toHaveProperty('CLAUDE_API_KEY');expect(a).not.toHaveProperty('BLOB_READ_WRITE_TOKEN');
 const matching=liveManifest();matching.authorization={attachments:false,matching:true,publicBlob:true};matching.approvedModel='claude-sonnet-5-5';const b=environment(rehearsal,staffWithKeys,schema,matching);
 expect(b.CLAUDE_API_KEY).toBe('model-synthetic');expect(b.BLOB_READ_WRITE_TOKEN).toBe('public-synthetic');expect(b).not.toHaveProperty('UPLOADS_BLOB_RW_TOKEN');
 for(const mutate of [x=>{delete x.authorization.attachments;},x=>{x.requestId='wrong';},x=>{x.authorization={attachments:false,matching:true,publicBlob:false};x.approvedModel='claude-sonnet-5';},x=>{x.authorization={attachments:true,matching:false,publicBlob:true};}]){const value=liveManifest();mutate(value);expect(()=>validateLiveManifest(value)).toThrow();}
});
test('attachment cleanup retains state until every row and external cleanup is confirmed',()=>{
 const baseline=[{id:1,status:'active'}],terminal={status:'consumed',candidate_result:{itemId:'synthetic'},result_payload:{requestDocumentId:'synthetic'}};
 expect(attachmentCleanupPending({staging:[],feedback:baseline,baselineFeedback:baseline})).toBe(false);
 expect(attachmentCleanupPending({staging:[terminal],feedback:baseline,baselineFeedback:baseline,externalClean:true})).toBe(true);
 for(const row of [{...terminal,status:'pending'},{...terminal,status:'rejected'},{...terminal,candidate_result:null},{...terminal,result_payload:null}])expect(attachmentCleanupPending({staging:[row],feedback:baseline,baselineFeedback:baseline,externalClean:true})).toBe(true);
 expect(attachmentCleanupPending({staging:[terminal],feedback:baseline,baselineFeedback:baseline})).toBe(true);
 expect(attachmentCleanupPending({staging:[],feedback:[],baselineFeedback:baseline,externalClean:true})).toBe(true);
});
