/** @jest-environment node */
jest.mock('../../lib/services/meeting-tracker-transcription/service.js', () => ({ getMeetingTranscriptionOverview: jest.fn(), getMeetingCorrectionDraft: jest.fn() }));
import { startPreparation } from '../../lib/services/meeting-coordination/preparation-service';
const id='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
const keys=['MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY','MEETING_TRACKER_TRANSCRIPTION_ACCESS','MEETING_MATERIAL_PREPARATION_ACCESS'];
let prior;
beforeEach(()=>{prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));keys.forEach(key=>{process.env[key]='on';});});
afterEach(()=>keys.forEach(key=>{if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}));
const fixture=()=>({authorize:jest.fn(),binding:jest.fn(async()=>({siteVisitActivityId:id})),visibility:jest.fn(async()=>({request_id:id})),correction:jest.fn(async()=>({correction:{version:2,discussionAttribution:{version:1,rows:[]}}})),documents:jest.fn(async()=>({records:[]})),store:{create:jest.fn(async()=>({id,version:1,steps:[]}))}});
const args={requestId:id,profileId:7,actingUserSystemId:actor,body:{source:{kind:'correction',operationId:id,expectedVersion:2}}};
test('direct admission refuses an unconfirmed attendance review before creating durable work',async()=>{
 const d=fixture();d.correction.mockResolvedValue({correction:{version:2,discussionAttribution:null}});
 await expect(startPreparation(args,d)).rejects.toMatchObject({code:'preparation_attendance_required'});
 expect(d.store.create).not.toHaveBeenCalled();expect(d.documents).not.toHaveBeenCalled();
});
test('admission freezes the exact saved, attendance-confirmed review version',async()=>{
 const d=fixture();await startPreparation(args,d);
 expect(d.store.create).toHaveBeenCalledWith(expect.objectContaining({input:expect.objectContaining({source:args.body.source}),profileId:7,actingUserSystemId:actor}));
});
test('a concurrent saved version change cannot enter the queue',async()=>{
 const d=fixture();d.correction.mockResolvedValue({correction:{version:3,discussionAttribution:{version:1,rows:[]}}});
 await expect(startPreparation(args,d)).rejects.toMatchObject({code:'preparation_source_changed'});expect(d.store.create).not.toHaveBeenCalled();
});
