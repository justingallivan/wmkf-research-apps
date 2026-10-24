/** @jest-environment node */
jest.mock('../../lib/services/meeting-tracker-transcription/service.js',()=>({getMeetingTranscriptionOverview:jest.fn(),getMeetingCorrectionDraft:jest.fn(),publishMeetingCorrection:jest.fn(),reconcileMeetingTranscriptPublication:jest.fn(),resolveCurrentMeetingTranscriptSource:jest.fn()}));
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
let mockPool;
jest.mock('@vercel/postgres',()=>({db:{connect:(...args)=>mockPool.connect(...args)},sql:(strings,...values)=>mockPool.query(strings.reduce((text,part,i)=>text+(i?'$'+i:'')+part,''),values)}));
import {runPreparationTick} from '../../lib/services/meeting-coordination/preparation-worker.js';
import {createPreparationStore} from '../../lib/services/meeting-coordination/preparation-store.js';
import {reserveSummaryDraftRun,markSummaryDraftDispatched,completeSummaryDraft,expireSummaryDrafts,getActiveSummaryDraft,claimSummaryDraftForPublish,yieldSummaryDraftClaim} from '../../lib/services/post-presentation-materials/summary-draft-store.js';
const url=process.env.TEST_REQUEST_LEDGER_TEST_URL||'';
if(process.env.TEST_REQUEST_LEDGER_REQUIRE==='1'&&!url)throw new Error('Isolated local Postgres required');
if(url&&(!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)||url===process.env.POSTGRES_URL))throw new Error('Only isolated loopback Postgres allowed');
const uuid=()=>crypto.randomUUID();
(url?describe:describe.skip)('durable preparation with actual PostgreSQL',()=>{
 let admin,schema,store;
 beforeAll(async()=>{admin=new pg.Client({connectionString:url});await admin.connect();schema='prep_test_'+uuid().replace(/-/g,'');await admin.query(`CREATE SCHEMA "${schema}"`);
  mockPool=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`});await mockPool.query('CREATE TABLE user_profiles(id INTEGER PRIMARY KEY)');await mockPool.query('INSERT INTO user_profiles VALUES(1)');await mockPool.query('CREATE TABLE transcription_jobs(id UUID PRIMARY KEY)');
  for(const file of ['070_meeting_transcript_summary_drafts.sql','071_summary_draft_slides_identity.sql','075_summary_drafts_discussion_kind.sql','086_meeting_presentation_editions.sql','087_meeting_material_preparations.sql'])await mockPool.query(fs.readFileSync('lib/db/migrations/'+file,'utf8'));
  store=createPreparationStore(mockPool);
 });
 afterAll(async()=>{if(mockPool)await mockPool.end();if(admin){if(schema)await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}});
 async function parent(){const requestId=uuid();await mockPool.query('INSERT INTO meeting_presentation_visibility(request_id,enrolled_by,changed_by) VALUES($1,1,1)',[requestId]);
  return store.create({requestId,siteVisitId:uuid(),fingerprint:crypto.randomBytes(32).toString('hex'),input:{source:{kind:'published',artifactId:uuid(),fingerprint:'a'.repeat(64)},files:{}},profileId:1,actingUserSystemId:uuid()});}
 async function summaryClaim(){const p=await parent();await mockPool.query("UPDATE meeting_material_preparation_steps SET state='succeeded' WHERE preparation_id=$1 AND kind IN ('source','transcripts','video','discussion_summary')",[p.id]);const s=await store.claim({requestId:p.request_id});return {p,s,args:{id:s.attempt_id,requestId:p.request_id,artifactType:100000007,sourceRevisionId:uuid(),sourceArtifactId:uuid(),presentationEndMs:1000,profileId:1,preparationId:p.id}};}
 test('duplicate start does not restamp or create more than five steps',async()=>{const p=await parent();const a={requestId:p.request_id,siteVisitId:p.site_visit_id,fingerprint:p.input_fingerprint,input:p.input,profileId:1,actingUserSystemId:p.acting_user_system_id};
  const [x,y]=await Promise.all([store.create(a),store.create(a)]);expect(x.id).toBe(p.id);expect(y.created_at).toEqual(p.created_at);expect(x.steps).toHaveLength(5);
 });
 test('one claim per preparation; completion is fenced and successes stay intact',async()=>{const p=await parent();const [a,b]=await Promise.all([store.claim({requestId:p.request_id}),store.claim({requestId:p.request_id})]);const s=a||b;expect([a,b].filter(Boolean)).toHaveLength(1);expect(s.kind).toBe('source');
  expect(await store.finish({id:s.id,leaseToken:uuid(),state:'succeeded'})).toBeNull();await store.finish({id:s.id,leaseToken:s.lease_token,state:'succeeded',source:{id:uuid(),fingerprint:'b'.repeat(64)},output:{saved:true}});
  const t=await store.claim({requestId:p.request_id});expect(t.kind).toBe('transcripts');await store.finish({id:t.id,leaseToken:t.lease_token,state:'blocked',failureCode:'test_failure'});expect((await store.read(p.id,p.request_id)).steps.find(x=>x.kind==='source').output).toEqual({saved:true});
 });
 test('unknown summary survives six minutes and fourteen days, blocks legacy reservation and fences late completion',async()=>{const {p,s,args}=await summaryClaim();await reserveSummaryDraftRun(args);expect(await markSummaryDraftDispatched({id:s.attempt_id,preparationId:p.id})).not.toBeNull();
  await mockPool.query("UPDATE meeting_transcript_summary_drafts SET created_at=NOW()-INTERVAL '20 days',expires_at=NOW()-INTERVAL '6 days' WHERE id=$1",[s.attempt_id]);await mockPool.query("UPDATE meeting_material_preparation_steps SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[s.id]);
  await store.recoverExpired();expect(await expireSummaryDrafts()).toBe(0);expect((await getActiveSummaryDraft({requestId:p.request_id,artifactType:100000007})).generation_outcome).toBe('unknown');
  expect(await reserveSummaryDraftRun({...args,id:uuid(),preparationId:null})).toMatchObject({conflict:{code:'summary_generation_in_progress'}});expect(await store.claim({requestId:p.request_id})).toBeNull();
  expect(await completeSummaryDraft({id:s.attempt_id,text:'late result'})).toBeNull();
  const step=(await store.read(p.id,p.request_id)).steps.find(x=>x.id===s.id);
  await expect(store.retry({requestId:p.request_id,preparationId:p.id,stepId:s.id,expectedVersion:step.version,profileId:1})).rejects.toMatchObject({code:'preparation_charge_ack_required'});
  await store.retry({requestId:p.request_id,preparationId:p.id,stepId:s.id,expectedVersion:step.version,profileId:1,acknowledgePotentialDuplicateCharge:true});
  expect(await completeSummaryDraft({id:s.attempt_id,text:'still late'})).toBeNull();const next=await store.claim({requestId:p.request_id});expect(next.attempt_id).not.toBe(s.attempt_id);
  expect((await reserveSummaryDraftRun({...args,id:next.attempt_id})).draft).toMatchObject({id:next.attempt_id,acknowledged_at:null,initiated_by_profile_id:1});
 });
 test('a completed paid result is recovered without another call after worker death',async()=>{const {p,s,args}=await summaryClaim();await reserveSummaryDraftRun(args);await markSummaryDraftDispatched({id:s.attempt_id,preparationId:p.id});await completeSummaryDraft({id:s.attempt_id,text:'accepted summary',promptName:'test',promptVersion:1});
  await mockPool.query("UPDATE meeting_material_preparation_steps SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[s.id]);await store.recoverExpired();
  expect((await store.read(p.id,p.request_id)).steps.find(x=>x.id===s.id)).toMatchObject({state:'succeeded',output:{draftId:s.attempt_id}});expect(await store.claim({requestId:p.request_id})).toBeNull();
 });
 test('an old worker cannot reserve or dispatch after its lease expires',async()=>{const {p,s,args}=await summaryClaim();await mockPool.query("UPDATE meeting_material_preparation_steps SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[s.id]);await expect(reserveSummaryDraftRun(args)).rejects.toThrow('invalid_summary_preparation');
  expect(await markSummaryDraftDispatched({id:s.attempt_id,preparationId:p.id})).toBeNull();
 });
 test('expired completed summary is visible and explicitly retryable without repeating successful siblings',async()=>{
  const {p,s,args}=await summaryClaim();await reserveSummaryDraftRun(args);await markSummaryDraftDispatched({id:s.attempt_id,preparationId:p.id});await completeSummaryDraft({id:s.attempt_id,text:'ready text'});
  await store.finish({id:s.id,leaseToken:s.lease_token,state:'succeeded',output:{draftId:s.attempt_id}});
  await mockPool.query("UPDATE meeting_transcript_summary_drafts SET expires_at=NOW()-INTERVAL '1 day' WHERE id=$1",[s.attempt_id]);await expireSummaryDrafts();
  const row=await store.read(p.id,p.request_id),step=row.steps.find(x=>x.id===s.id);expect(step).toMatchObject({state:'blocked',failure_code:'summary_draft_expired'});
  await store.retry({requestId:p.request_id,preparationId:p.id,stepId:s.id,expectedVersion:step.version,profileId:1});
  expect((await store.claim({requestId:p.request_id})).attempt_id).not.toBe(s.attempt_id);
  expect((await store.read(p.id,p.request_id)).steps.find(x=>x.kind==='transcripts').state).toBe('succeeded');
 });

 test('actual JSONB queue handoff runs source and transcript children, not a false input-drift block',async()=>{
  const p=await parent();await mockPool.query('UPDATE meeting_material_preparations SET input=$2::jsonb WHERE id=$1',[p.id,JSON.stringify({...p.input,files:{recordingId:null,recordingIdentity:null,slidesId:null,slidesHash:null}})]);
  const prior={...process.env};Object.assign(process.env,{MEETING_MATERIAL_PREPARATION_ACCESS:'test:'+p.request_id,MEETING_TRACKER_TRANSCRIPTION_ACCESS:'on',MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY:'on'});
  try{const d={store,authorize:async()=>({}),binding:async()=>({siteVisitActivityId:p.site_visit_id}),visibility:async()=>({version:1}),documents:async()=>({records:[]}),overview:async()=>({currentArtifact:{id:p.input.source.artifactId,fingerprint:p.input.source.fingerprint,presentationEnd:{endMs:1000}}}),generate:jest.fn(async()=>({presentationTranscript:{artifactId:uuid()},staffDiscussionTranscript:{artifactId:uuid()}}))};
   expect((await runPreparationTick(d)).outcome).toBe('succeeded');expect((await runPreparationTick(d)).outcome).toBe('succeeded');expect(d.generate).toHaveBeenCalledTimes(1);
   expect((await store.read(p.id,p.request_id)).steps.find(step=>step.kind==='transcripts').state).toBe('succeeded');
  }finally{process.env=prior;}
 });

 test.each(['legacy_generating','interrupted_publishing'])('owned worker preserves %s instead of replacing it automatically',async kind=>{
  const {s,args}=await summaryClaim();const oldId=uuid();await reserveSummaryDraftRun({...args,id:oldId,preparationId:null});
  if(kind==='legacy_generating')await mockPool.query("UPDATE meeting_transcript_summary_drafts SET created_at=NOW()-INTERVAL '20 minutes' WHERE id=$1",[oldId]);
  else{const ready=await completeSummaryDraft({id:oldId,text:'saved edited text'});const token=uuid();await claimSummaryDraftForPublish({id:oldId,requestId:args.requestId,artifactType:100000007,expectedVersion:ready.version,token,profileId:1});await mockPool.query('UPDATE meeting_transcript_summary_drafts SET publish_registration_attempted=TRUE WHERE id=$1',[oldId]);await yieldSummaryDraftClaim({id:oldId,token});}
  expect(await reserveSummaryDraftRun({...args,id:s.attempt_id})).toMatchObject({conflict:{code:'summary_generation_in_progress'}});
  const old=(await mockPool.query('SELECT state,summary_text,publish_registration_attempted FROM meeting_transcript_summary_drafts WHERE id=$1',[oldId])).rows[0];
  expect(old).toMatchObject(kind==='legacy_generating'?{state:'generating'}:{state:'publishing',summary_text:'saved edited text',publish_registration_attempted:true});
 });
 test('worker death before dispatch resumes safely without a false duplicate-charge warning',async()=>{
  const {p,s,args}=await summaryClaim();await reserveSummaryDraftRun(args);await mockPool.query("UPDATE meeting_material_preparation_steps SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[s.id]);await store.recoverExpired();
  const step=(await store.read(p.id,p.request_id)).steps.find(x=>x.id===s.id);expect(step.state).toBe('pending');expect(step.attempt_id).not.toBe(s.attempt_id);
  expect((await mockPool.query('SELECT generation_outcome FROM meeting_transcript_summary_drafts WHERE id=$1',[s.attempt_id])).rows[0].generation_outcome).toBe('failed');
  const next=await store.claim({requestId:p.request_id});expect((await reserveSummaryDraftRun({...args,id:next.attempt_id})).draft.id).toBe(next.attempt_id);
 });

});
