/** @jest-environment node */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
jest.mock('../../lib/services/meeting-tracker-transcription/service.js',()=>({getMeetingTranscriptionOverview:jest.fn(),getMeetingCorrectionDraft:jest.fn()}));
import {prepareInvitation,actOnInvitation} from '../../lib/services/meeting-coordination/invitation-service';
import {createInvitationStore} from '../../lib/services/meeting-coordination/invitation-store';
const url=process.env.TEST_REQUEST_LEDGER_TEST_URL||'';
if(process.env.TEST_REQUEST_LEDGER_REQUIRE==='1'&&!url)throw new Error('Isolated local PostgreSQL required');
if(url&&(!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)||url===process.env.POSTGRES_URL))throw new Error('Only isolated loopback PostgreSQL permitted');
const uuid=()=>crypto.randomUUID();
(url?describe:describe.skip)('presentation invitation ledger with actual PostgreSQL',()=>{
 let admin,pool,schema,store;
 beforeAll(async()=>{admin=new pg.Client({connectionString:url});await admin.connect();schema='invitation_test_'+uuid().replaceAll('-','');await admin.query(`CREATE SCHEMA "${schema}"`);pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`});await pool.query('CREATE TABLE user_profiles(id INTEGER PRIMARY KEY)');await pool.query('INSERT INTO user_profiles VALUES(7)');await pool.query(fs.readFileSync('lib/db/migrations/088_meeting_presentation_invitations.sql','utf8'));store=createInvitationStore(pool);});
 afterAll(async()=>{if(pool)await pool.end();if(admin){if(schema)await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}});
 afterEach(async()=>{await pool.query('TRUNCATE meeting_presentation_invitations');});
 const input=(requestId=uuid())=>({id:uuid(),requestId,siteVisitId:uuid(),profileId:7,actingUserSystemId:uuid(),fromEmail:'pc@wmkeck.org',sourceHash:'a'.repeat(64),emailHash:'b'.repeat(64),envelopeHash:'c'.repeat(64),snapshot:{custom:{subject:'Meeting',message:'Join us'}},subject:'Meeting',bodyText:'Join us',bodyHtml:'<p>Join us</p>',to:['staff@wmkeck.org'],cc:[]});
 test('actual schema accepts explicit empty To with selected Cc and refuses an empty combined audience',async()=>{const first=await store.create({...input(),to:[],cc:['consultant@example.org']});expect(first.to_recipients).toEqual([]);await expect(store.create({...input(),to:[],cc:[]})).rejects.toMatchObject({code:'23514'});});
 test('two claims for the same preview version have one winner',async()=>{const row=await store.create(input());const claimed=await Promise.all([store.claim(row.id,row.request_id,1),store.claim(row.id,row.request_id,1)]);expect(claimed.filter(Boolean)).toHaveLength(1);expect(claimed.find(Boolean).version).toBe(2);});
 test('wrong or expired lease cannot advance durable intent',async()=>{const row=await store.create(input()),claimed=await store.claim(row.id,row.request_id,1);expect(await store.transition({...claimed,lease_token:uuid()},'creating')).toBeNull();await pool.query("UPDATE meeting_presentation_invitations SET lease_expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[row.id]);expect(await store.transition(claimed,'creating')).toBeNull();});
 test('an unresolved operation blocks another preview send for the same request',async()=>{const request=uuid(),a=await store.create(input(request)),b=await store.create(input(request)),first=await store.claim(a.id,request,1),second=await store.claim(b.id,request,1);let active=await store.transition(first,'creating');await expect(store.transition(second,'creating')).rejects.toMatchObject({code:'23505'});active=await store.transition(active,'unknown',{failureCode:'presentation_invitation_create_unknown',release:true});await expect(store.transition(second,'creating')).rejects.toMatchObject({code:'23505'});expect(active.state).toBe('unknown');});
 test('cleanup redacts unresolved content without releasing its uniqueness fence; resolved old rows are removed',async()=>{const a=await store.create(input()),b=await store.create(input());let active=await store.claim(a.id,a.request_id,1);active=await store.transition(active,'creating');active=await store.transition(active,'unknown',{failureCode:'presentation_invitation_create_unknown',release:true});await pool.query("UPDATE meeting_presentation_invitations SET retention_expires_at=NOW()-INTERVAL '1 day'");expect(await store.cleanup()).toEqual({deleted:1,redacted:1});const retained=await store.get(a.id,a.request_id);expect(retained).toMatchObject({state:'unknown',snapshot:{},body_text:'',to_recipients:[]});expect(retained.redacted_at).not.toBeNull();expect(await store.get(b.id,b.request_id)).toBeNull();const extra=await store.create(input(a.request_id)),claim=await store.claim(extra.id,a.request_id,1);await expect(store.transition(claim,'creating')).rejects.toMatchObject({code:'23505'});});
 test('store supports a bounded request-scoped cleanup when explicitly requested',async()=>{const a=await store.create(input()),b=await store.create(input());await pool.query("UPDATE meeting_presentation_invitations SET retention_expires_at=NOW()-INTERVAL '1 day'");expect(await store.cleanup({requestId:a.request_id})).toEqual({deleted:1,redacted:0});expect(await store.get(b.id,b.request_id)).not.toBeNull();});
 test('the per-request cap holds under concurrent admission, including differently cased UUID input',async()=>{const seed=input();await pool.query(`INSERT INTO meeting_presentation_invitations(id,request_id,site_visit_id,actor_profile_id,acting_user_system_id,from_email,source_hash,email_hash,envelope_hash,snapshot,subject,body_text,body_html,to_recipients,cc_recipients)
 SELECT gen_random_uuid(),$1,$2,7,$3,'pc@wmkeck.org',$4,$4,$4,'{}'::jsonb,'Meeting','Join','<p>Join</p>','["staff@wmkeck.org"]'::jsonb,'[]'::jsonb FROM generate_series(1,99)`,[seed.requestId,seed.siteVisitId,seed.actingUserSystemId,seed.sourceHash]);const results=await Promise.all([store.create(input(seed.requestId.toUpperCase())),store.create(input(seed.requestId))]);expect(results.filter(Boolean)).toHaveLength(1);expect(Number((await pool.query('SELECT count(*) AS count FROM meeting_presentation_invitations')).rows[0].count)).toBe(100);});
 test('service and actual SQL keep the frozen proof through JSONB and thirty-day uncertainty redaction',async()=>{
  const prior=process.env.MEETING_PRESENTATION_INVITATION_ACCESS;process.env.MEETING_PRESENTATION_INVITATION_ACCESS='on';
  try {
   const requestId=uuid(),actor=uuid(),visit=uuid(),emailId=uuid();let message;
   const d={store,impersonationEnabled:()=>true,now:()=>new Date(),authorize:jest.fn(async()=>({profileId:7,systemUserId:actor,email:'pc@wmkeck.org'})),request:jest.fn(async()=>({akoya_requestid:requestId,akoya_title:'Research',akoya_requestnum:'1001',wmkf_meetingdate:'2030-12-01',akoya_requeststatus:100000001,wmkf_triagestatus:100000000})),
    logistics:jest.fn(async()=>({siteVisit:{activityId:visit,etag:'v1',startIso:'2030-02-01T18:00:00Z',endIso:'2030-02-01T19:00:00Z',timeZone:'America/Los_Angeles',locationOrLink:'Campus',requiredAttendees:[{kind:'manual',email:'staff@wmkeck.org'}],optionalAttendees:[]}})),directory:async()=>({}),resolve:async refs=>refs,signature:async()=>'Coordinator',assertEmailAllowed:jest.fn(),
    createEmail:jest.fn(async input=>{message={activityid:emailId,subcategory:input.correlationKey,subject:input.subject,description:input.body,statuscode:1,email_activity_parties:[{participationtypemask:1,addressused:input.from},...input.to.map(addressused=>({participationtypemask:2,addressused}))]};return emailId;}),sendEmail:jest.fn(async()=>{throw new Error('Send response lost');}),getEmail:jest.fn(async()=>message),findEmail:jest.fn(async()=>[message])};
   const args={requestId,profileId:7,actingUserSystemId:actor,fromEmail:'pc@wmkeck.org'};
   const preview=(await prepareInvitation({...args,body:{subject:'Research presentation',message:'Please join us.'}},d)).invitation;
   const first=(await actOnInvitation({...args,body:{action:'send',invitationId:preview.id,expectedVersion:preview.version}},d)).invitation;
   expect(first.state).toBe('unknown');expect(d.createEmail).toHaveBeenCalledTimes(1);expect(d.sendEmail).toHaveBeenCalledTimes(1);
   await pool.query("UPDATE meeting_presentation_invitations SET retention_expires_at=NOW()-INTERVAL '1 day' WHERE id=$1",[preview.id]);expect(await store.cleanup()).toEqual({deleted:0,redacted:1});
   const retained=await store.get(preview.id,requestId);expect(retained.snapshot).toEqual({});expect(retained.email_hash).toMatch(/^[a-f0-9]{64}$/);message.statuscode=3;
   const resolved=(await actOnInvitation({...args,body:{action:'reconcile',invitationId:retained.id,expectedVersion:retained.version}},d)).invitation;
   expect(resolved).toMatchObject({state:'sent',redacted:true,bodyText:'',emailId});expect(d.sendEmail).toHaveBeenCalledTimes(1);
  }finally{if(prior===undefined)delete process.env.MEETING_PRESENTATION_INVITATION_ACCESS;else process.env.MEETING_PRESENTATION_INVITATION_ACCESS=prior;}
 });

 test('expired previews cannot be claimed at the SQL boundary',async()=>{const row=await store.create(input());await pool.query("UPDATE meeting_presentation_invitations SET preview_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[row.id]);expect(await store.claim(row.id,row.request_id,row.version)).toBeNull();expect(await store.cleanup()).toEqual({deleted:1,redacted:0});});
 test('recovery of a creation-only expired lease fences the late creator before it can persist send intent',async()=>{
  const row=await store.create(input());let original=await store.claim(row.id,row.request_id,row.version);original=await store.transition(original,'creating');
  await pool.query("UPDATE meeting_presentation_invitations SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[row.id]);
  let recovered=await store.claim(row.id,row.request_id,original.version);recovered=await store.transition(recovered,'failed',{failureCode:'presentation_invitation_not_dispatched',release:true});
  expect(await store.transition(original,'activity_created',{emailId:uuid()})).toBeNull();expect(await store.transition(original,'send_requested',{emailVerified:true})).toBeNull();expect((await store.get(row.id,row.request_id)).state).toBe('failed');
 });

});
