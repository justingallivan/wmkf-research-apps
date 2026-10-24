/** @jest-environment node */
jest.mock('../../lib/utils/auth.js',()=>({requireAppAccess:jest.fn()}));
jest.mock('../../lib/dataverse/core/context.js',()=>({withDalContext:(_tag,fn)=>fn()}));
jest.mock('../../lib/services/meeting-coordination/preparation-service.js',()=>({...jest.requireActual('../../lib/services/meeting-coordination/preparation-service.js'),startPreparation:jest.fn(),getPreparation:jest.fn(),retryPreparation:jest.fn()}));
jest.mock('../../lib/services/meeting-tracker-transcription/service.js',()=>({getMeetingTranscriptionOverview:jest.fn(),getMeetingCorrectionDraft:jest.fn()}));
import {requireAppAccess} from '../../lib/utils/auth.js';
import {startPreparation,getPreparation,retryPreparation} from '../../lib/services/meeting-coordination/preparation-service.js';
import handler from '../../pages/api/meeting-tracker/visits/[requestId]/preparation.js';
const id='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
function response(){const r={headers:{},statusCode:200};r.setHeader=(k,v)=>{r.headers[k]=v;};r.status=c=>{r.statusCode=c;return r;};r.json=b=>{r.body=b;return r;};return r;}
beforeEach(()=>{jest.clearAllMocks();requireAppAccess.mockResolvedValue({profileId:1,session:{user:{dynamicsSystemuserId:actor}}});});
test.each([{action:'start',source:{kind:'published',artifactId:id,fingerprint:'a'.repeat(64)}},{action:'start',source:{kind:'correction',operationId:id,expectedVersion:2}}])('queues strictly validated source %j with session actor',async body=>{
 startPreparation.mockResolvedValue({preparation:{id}});const res=response();await handler({method:'POST',query:{requestId:id},body},res);expect(res.statusCode).toBe(202);expect(startPreparation).toHaveBeenCalledWith({requestId:id,profileId:1,actingUserSystemId:actor,body});expect(res.headers['Cache-Control']).toBe('private, no-store');
});
test.each([{action:'start',source:{kind:'published',artifactId:id,fingerprint:'a'.repeat(64)},profileId:99},{action:'retry',preparationId:id,stepId:id,expectedVersion:0},{action:'retry',preparationId:id,stepId:id,expectedVersion:1,acknowledgePotentialDuplicateCharge:false},{action:'retry',preparationId:id,stepId:id,expectedVersion:1,replaceDraft:{draftId:id,expectedVersion:2,force:true}}])('refuses unsupported or stale command shape %j',async body=>{
 const res=response();await handler({method:'POST',query:{requestId:id},body},res);expect(res.statusCode).toBe(400);expect(startPreparation).not.toHaveBeenCalled();expect(retryPreparation).not.toHaveBeenCalled();
});
test('missing active profile and query-supplied identities fail closed',async()=>{
 requireAppAccess.mockResolvedValue({profileId:null});const res=response();await handler({method:'GET',query:{requestId:id}},res);expect(res.statusCode).toBe(401);expect(getPreparation).not.toHaveBeenCalled();
 const extra=response();await handler({method:'GET',query:{requestId:id,profileId:'1'}},extra);expect(extra.statusCode).toBe(400);
});
