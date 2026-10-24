/** @jest-environment node */
jest.mock('../../lib/services/meeting-tracker-transcription/service.js',()=>({getMeetingTranscriptionOverview:jest.fn(),getMeetingCorrectionDraft:jest.fn()}));
import { prepareInvitation,actOnInvitation,getInvitation,cleanupInvitations } from '../../lib/services/meeting-coordination/invitation-service';
const requestId='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',visitId='33333333-3333-4333-8333-333333333333',emailId='44444444-4444-4444-8444-444444444444';
const now=new Date('2030-01-01T00:00:00Z');let previous;
beforeEach(()=>{previous=process.env.MEETING_PRESENTATION_INVITATION_ACCESS;process.env.MEETING_PRESENTATION_INVITATION_ACCESS='on';});
afterEach(()=>{if(previous===undefined)delete process.env.MEETING_PRESENTATION_INVITATION_ACCESS;else process.env.MEETING_PRESENTATION_INVITATION_ACCESS=previous;});
function fixture(){let saved=null,message=null;const staff={profileId:7,systemUserId:actor,email:'pc@wmkeck.org',name:'Coordinator'};
 const d={impersonationEnabled:()=>true,authorize:jest.fn(async()=>staff),request:jest.fn(async()=>({akoya_requestid:requestId,akoya_requestnum:'1001',akoya_title:'Research',wmkf_meetingdate:'2030-12-01',akoya_requeststatus:100000001,wmkf_triagestatus:100000000})),
 logistics:jest.fn(async()=>({siteVisit:{activityId:visitId,etag:'v1',startIso:'2030-02-01T18:00:00Z',endIso:'2030-02-01T19:00:00Z',timeZone:'America/Los_Angeles',locationOrLink:'https://zoom.test/meeting',requiredAttendees:[{kind:'staff',profileId:8}],optionalAttendees:[{kind:'roster',rosterId:9}]}})),directory:jest.fn(async()=>({})),resolve:jest.fn(async refs=>refs.map(ref=>({email:ref.kind==='staff'?'staff@wmkeck.org':'consultant@example.org',name:'Selected person'}))),signature:jest.fn(async()=>'<Coordinator>'),assertEmailAllowed:jest.fn(),now:()=>now,
 createEmail:jest.fn(async input=>{message={activityid:emailId,subcategory:input.correlationKey,statuscode:1,subject:input.subject,description:input.body,email_activity_parties:[{participationtypemask:1,addressused:input.from},...(input.to||[]).map(addressused=>({participationtypemask:2,addressused})),...(input.cc||[]).map(addressused=>({participationtypemask:3,addressused}))]};return emailId;}),sendEmail:jest.fn(async()=>{message.statuscode=3;}),getEmail:jest.fn(async()=>message),findEmail:jest.fn(async()=>message?[message]:[]),
 store:{create:jest.fn(async input=>{saved={id:input.id,request_id:input.requestId,site_visit_id:input.siteVisitId,actor_profile_id:input.profileId,acting_user_system_id:input.actingUserSystemId,from_email:input.fromEmail,source_hash:input.sourceHash,email_hash:input.emailHash,envelope_hash:input.envelopeHash,snapshot:input.snapshot,subject:input.subject,body_text:input.bodyText,body_html:input.bodyHtml,to_recipients:input.to,cc_recipients:input.cc,version:1,state:'prepared',preview_expires_at:new Date(now.getTime()+900000)};return {...saved};}),get:jest.fn(async(id,request)=>saved?.id===id&&saved?.request_id===request?{...saved}:null),latest:jest.fn(async()=>saved?{...saved}:null),
 claim:jest.fn(async(id,request,version)=>{if(saved?.id!==id||saved?.request_id!==request||saved?.version!==version||saved?.lease_token)return null;saved={...saved,version:version+1,lease_token:'lease'};return {...saved};}),
 renew:jest.fn(async row=>saved.version===row.version&&saved.lease_token===row.lease_token?{...saved}:null),
 transition:jest.fn(async(row,state,options={})=>{if(saved.version!==row.version||saved.lease_token!==row.lease_token)return null;saved={...saved,email_verified_at:options.emailVerified?now:saved.email_verified_at,state,version:saved.version+1,dynamics_email_id:options.emailId||saved.dynamics_email_id,failure_code:options.failureCode||null,lease_token:options.release?null:saved.lease_token};return {...saved};}),release:jest.fn(async row=>{if(saved.version===row.version&&saved.lease_token===row.lease_token)saved={...saved,version:saved.version+1,lease_token:null};return saved;}),cleanup:jest.fn(async()=>({deleted:0,redacted:0}))}};
 return {d,row:()=>saved,set:changes=>{saved={...saved,...changes};},message:()=>message};}
const args={requestId,profileId:7,actingUserSystemId:actor,fromEmail:'pc@wmkeck.org',body:{subject:'Research presentation',message:'Please join us.'}};
async function prepared(f){return (await prepareInvitation(args,f.d)).invitation;}
const action=(row,type='send')=>({...args,body:{action:type,invitationId:row.id,expectedVersion:row.version}});
test('preview freezes current selected groups and escaped rendered copy without creating mail',async()=>{const f=fixture();const row=await prepared(f);expect(row.to).toEqual(['staff@wmkeck.org']);expect(row.cc).toEqual(['consultant@example.org']);expect(row.bodyText).toContain('Please join us.');expect(f.row().body_html).toContain('&lt;Coordinator&gt;');expect(f.d.createEmail).not.toHaveBeenCalled();expect(f.d.sendEmail).not.toHaveBeenCalled();});
test('explicit send uses frozen content and no fallback at both seams; repeated send returns the same accepted receipt',async()=>{const f=fixture(),row=await prepared(f);const result=await actOnInvitation(action(row),f.d);expect(result.invitation.state).toBe('sent');expect(f.d.createEmail).toHaveBeenCalledWith(expect.objectContaining({regardingId:requestId,noFallback:true,actingUserSystemId:actor,to:row.to,cc:row.cc}));expect(f.d.sendEmail).toHaveBeenCalledWith(emailId,{actingUserSystemId:actor,noFallback:true});await actOnInvitation(action(result.invitation),f.d);expect(f.d.sendEmail).toHaveBeenCalledTimes(1);});
test.each(['etag','mailbox','signature','attendee'])('changed %s requires a new preview before any email creation',async change=>{const f=fixture(),row=await prepared(f);if(change==='etag'){const data=await f.d.logistics();f.d.logistics.mockResolvedValue({...data,siteVisit:{...data.siteVisit,etag:'v2'}});}if(change==='signature')f.d.signature.mockResolvedValue('Changed');if(change==='attendee')f.d.resolve.mockResolvedValue([{email:'new@example.org'}]);if(change==='mailbox')f.d.authorize.mockResolvedValue({profileId:7,systemUserId:actor,email:'new@wmkeck.org'});await expect(actOnInvitation(action(row),f.d)).rejects.toBeDefined();expect(f.d.createEmail).not.toHaveBeenCalled();expect(f.d.sendEmail).not.toHaveBeenCalled();});
test('changed visit after activity creation leaves an unsent draft and a definite failure',async()=>{const f=fixture(),row=await prepared(f);const create=f.d.createEmail.getMockImplementation();f.d.createEmail.mockImplementation(async input=>{const id=await create(input);const data=await f.d.logistics();f.d.logistics.mockResolvedValue({...data,siteVisit:{...data.siteVisit,etag:'changed'}});return id;});expect((await actOnInvitation(action(row),f.d)).invitation.state).toBe('failed');expect(f.d.sendEmail).not.toHaveBeenCalled();});
test('unknown send is never resubmitted while Dynamics still shows Draft; read-only reconciliation can later confirm acceptance',async()=>{const f=fixture(),row=await prepared(f);f.d.sendEmail.mockRejectedValue(new Error('response lost'));const first=await actOnInvitation(action(row),f.d);expect(first.invitation.state).toBe('unknown');const second=await actOnInvitation(action(first.invitation),f.d);expect(second.invitation.state).toBe('unknown');expect(f.d.sendEmail).toHaveBeenCalledTimes(1);f.message().statuscode=3;expect((await actOnInvitation(action(second.invitation,'reconcile'),f.d)).invitation.state).toBe('sent');expect(f.d.createEmail).toHaveBeenCalledTimes(1);expect(f.d.sendEmail).toHaveBeenCalledTimes(1);});
test('unknown creation retains its fence and cannot create another activity on retry',async()=>{const f=fixture(),row=await prepared(f);f.d.createEmail.mockRejectedValue(new Error('create response lost'));const first=await actOnInvitation(action(row),f.d);expect(first.invitation.state).toBe('unknown');await actOnInvitation(action(first.invitation),f.d);expect(f.d.createEmail).toHaveBeenCalledTimes(1);expect(f.d.sendEmail).not.toHaveBeenCalled();});
test('reconcile can retire a recovered unsent creation draft without dispatching it',async()=>{const f=fixture(),row=await prepared(f);await f.d.createEmail({correlationKey:`wmkf-presentation-invite:${row.id}`,subject:f.row().subject,body:f.row().body_html,from:f.row().from_email,to:f.row().to_recipients,cc:f.row().cc_recipients});f.set({state:'creating'});const result=await actOnInvitation(action(f.row(),'reconcile'),f.d);expect(result.invitation.state).toBe('failed');expect(f.d.sendEmail).not.toHaveBeenCalled();});
test('an intentionally empty To stays empty when only optional attendees were selected',async()=>{const f=fixture();const data=await f.d.logistics();f.d.logistics.mockResolvedValue({...data,siteVisit:{...data.siteVisit,requiredAttendees:[]}});const row=await prepared(f);expect(row.to).toEqual([]);expect(row.cc).toEqual(['consultant@example.org']);});
test('no saved attendees refuses rather than falling back to organizer or applicants',async()=>{const f=fixture();const data=await f.d.logistics();f.d.logistics.mockResolvedValue({...data,siteVisit:{...data.siteVisit,requiredAttendees:[],optionalAttendees:[],organizer:{kind:'staff',profileId:7}}});await expect(prepared(f)).rejects.toMatchObject({code:'presentation_invitation_recipients_required'});expect(f.d.store.create).not.toHaveBeenCalled();});
test('expired preview refuses before claim or mail',async()=>{const f=fixture(),row=await prepared(f);f.set({preview_expires_at:new Date(now.getTime()-1)});await expect(actOnInvitation(action(row),f.d)).rejects.toMatchObject({httpStatus:410});expect(f.d.store.claim).not.toHaveBeenCalled();expect(f.d.createEmail).not.toHaveBeenCalled();});
test('another eligible sender cannot send the original sender preview',async()=>{const f=fixture(),row=await prepared(f);f.d.authorize.mockResolvedValue({profileId:8,systemUserId:visitId,email:'helper@wmkeck.org'});await expect(actOnInvitation({...action(row),profileId:8,actingUserSystemId:visitId,fromEmail:'helper@wmkeck.org'},f.d)).rejects.toMatchObject({httpStatus:403});expect(f.d.store.claim).not.toHaveBeenCalled();});
test('lost app access refuses before any lease or email',async()=>{const f=fixture(),row=await prepared(f);f.d.authorize.mockRejectedValue(new Error('access revoked'));await expect(actOnInvitation(action(row),f.d)).rejects.toThrow('access revoked');expect(f.d.store.claim).not.toHaveBeenCalled();expect(f.d.createEmail).not.toHaveBeenCalled();});
test('flag-off admission touches no storage while retention continues independently',async()=>{const f=fixture();process.env.MEETING_PRESENTATION_INVITATION_ACCESS='off';await expect(prepared(f)).rejects.toMatchObject({httpStatus:503});expect(await cleanupInvitations(f.d)).toMatchObject({deleted:0,redacted:0});process.env.MEETING_PRESENTATION_INVITATION_ACCESS=`test:${requestId}`;await cleanupInvitations(f.d);expect(f.d.store.cleanup).toHaveBeenCalledWith({requestId:null});});


test('another currently authorized staff member may reconcile accepted transport but never dispatch the prior sender email',async()=>{
 const f=fixture(),row=await prepared(f);f.d.sendEmail.mockRejectedValue(new Error('response lost'));const first=await actOnInvitation(action(row),f.d);
 f.message().statuscode=3;f.d.authorize.mockResolvedValue({profileId:8,systemUserId:visitId,email:'helper@wmkeck.org'});
 const result=await actOnInvitation({...action(first.invitation,'reconcile'),profileId:8,actingUserSystemId:visitId,fromEmail:'helper@wmkeck.org'},f.d);
 expect(result.invitation.state).toBe('sent');expect(f.d.sendEmail).toHaveBeenCalledTimes(1);expect(f.d.createEmail).toHaveBeenCalledTimes(1);expect(f.row().actor_profile_id).toBe(7);
});

test('an unknown service action cannot fall through to Send',async()=>{
 const f=fixture(),row=await prepared(f);await expect(actOnInvitation({...action(row),body:{...action(row).body,action:'other'}},f.d)).rejects.toMatchObject({httpStatus:400});expect(f.d.store.claim).not.toHaveBeenCalled();expect(f.d.createEmail).not.toHaveBeenCalled();
});


test('a modified Dynamics draft fails exact-message verification before SendEmail',async()=>{
 const f=fixture(),row=await prepared(f),create=f.d.createEmail.getMockImplementation();f.d.createEmail.mockImplementation(async input=>{const id=await create(input);f.message().description='Someone changed the draft';return id;});
 expect((await actOnInvitation(action(row),f.d)).invitation.state).toBe('failed');expect(f.d.sendEmail).not.toHaveBeenCalled();
});

test('an expired lease after preflight cannot create or dispatch an activity',async()=>{
 const f=fixture(),row=await prepared(f);f.d.store.renew.mockResolvedValue(null);await expect(actOnInvitation(action(row),f.d)).rejects.toMatchObject({code:'presentation_invitation_lease_lost',dispatched:false});expect(f.d.createEmail).not.toHaveBeenCalled();expect(f.d.sendEmail).not.toHaveBeenCalled();
});


test('expired message content is hidden on read even before the bounded cleanup reaches its row',async()=>{
 const f=fixture();await prepared(f);f.set({retention_expires_at:new Date('2000-01-01T00:00:00Z')});const result=await getInvitation(args,f.d);
 expect(result.invitation).toMatchObject({redacted:true,subject:'',bodyText:'',message:'',fromEmail:'',to:[],cc:[]});expect(f.row().body_text).not.toBe('');
});

test('impersonation-off preview refuses without persistence or service-account mail',async()=>{
 const f=fixture();f.d.impersonationEnabled=()=>false;await expect(prepared(f)).rejects.toMatchObject({httpStatus:503,code:'presentation_invitation_impersonation_required'});expect(f.d.store.create).not.toHaveBeenCalled();expect(f.d.createEmail).not.toHaveBeenCalled();
});

test('impersonation disabled after activity creation never dispatches the draft',async()=>{
 const f=fixture(),row=await prepared(f),create=f.d.createEmail.getMockImplementation();let enabled=true;f.d.impersonationEnabled=()=>enabled;f.d.createEmail.mockImplementation(async input=>{const id=await create(input);enabled=false;return id;});
 expect((await actOnInvitation(action(row),f.d)).invitation.state).toBe('failed');expect(f.d.sendEmail).not.toHaveBeenCalled();
});

test('accepted transport tolerates server body normalization only after durable pre-send verification',async()=>{
 const f=fixture(),row=await prepared(f);f.d.sendEmail.mockImplementation(async()=>{expect(f.row().email_verified_at).toBeTruthy();f.message().description='<p>Normalized by Dynamics</p>';f.message().subject+=' [tracking]';f.message().statuscode=3;});
 expect((await actOnInvitation(action(row),f.d)).invitation.state).toBe('sent');expect(f.d.sendEmail).toHaveBeenCalledTimes(1);
});
test('a changed envelope after dispatch remains fenced rather than claiming the reviewed audience',async()=>{
 const f=fixture(),row=await prepared(f);f.d.sendEmail.mockImplementation(async()=>{f.message().email_activity_parties.push({participationtypemask:2,addressused:'unreviewed@example.org'});f.message().statuscode=3;});
 expect((await actOnInvitation(action(row),f.d)).invitation).toMatchObject({state:'unknown',failureCode:'presentation_invitation_email_mismatch'});expect(f.d.sendEmail).toHaveBeenCalledTimes(1);
});
test('duplicate correlation matches retain a distinct administrator recovery receipt',async()=>{
 const f=fixture(),row=await prepared(f);f.set({state:'unknown',failure_code:'presentation_invitation_create_unknown'});f.d.findEmail.mockResolvedValue([{activityid:emailId},{activityid:visitId}]);
 expect((await actOnInvitation(action(f.row(),'reconcile'),f.d)).invitation).toMatchObject({state:'unknown',failureCode:'presentation_invitation_duplicate_activity'});expect(f.d.sendEmail).not.toHaveBeenCalled();
});
test('prepare returns the unresolved receipt without admitting another preview',async()=>{
 const f=fixture(),row=await prepared(f);f.set({state:'unknown',failure_code:'presentation_invitation_send_unknown'});await expect(prepared(f)).rejects.toMatchObject({code:'presentation_invitation_unresolved',body:{invitation:{id:row.id,state:'unknown'},canReconcile:true,canSend:false}});expect(f.d.store.create).toHaveBeenCalledTimes(1);
});
test('a creation-only missing activity can retire, while an unknown Send with missing activity stays fenced',async()=>{
 const f=fixture();await prepared(f);f.set({state:'unknown',failure_code:'presentation_invitation_create_unknown'});expect((await actOnInvitation(action(f.row(),'reconcile'),f.d)).invitation.state).toBe('failed');
 f.set({state:'unknown',email_verified_at:now,failure_code:'presentation_invitation_send_unknown'});expect((await actOnInvitation(action(f.row(),'reconcile'),f.d)).invitation.state).toBe('unknown');expect(f.d.sendEmail).not.toHaveBeenCalled();
});
test('native cancellation resolves an edited uncertain draft without sending it',async()=>{
 const f=fixture(),row=await prepared(f);f.d.sendEmail.mockRejectedValue(new Error('lost response'));await actOnInvitation(action(row),f.d);f.message().description='Edited';f.message().statuscode=5;
 expect((await actOnInvitation(action(f.row(),'reconcile'),f.d)).invitation.state).toBe('failed');expect(f.d.sendEmail).toHaveBeenCalledTimes(1);
});
test('retention safely skips an unapplied schema but surfaces other database failures',async()=>{
 const f=fixture();f.d.store.cleanup.mockRejectedValueOnce({code:'42P01'}).mockRejectedValueOnce(new Error('offline'));expect(await cleanupInvitations(f.d)).toMatchObject({skipped:'schema_not_ready'});await expect(cleanupInvitations(f.d)).rejects.toThrow('offline');
});
