/** @jest-environment node */
jest.mock('../../lib/utils/auth.js',()=>({requireAppAccess:jest.fn()}));
jest.mock('../../lib/dataverse/core/context.js',()=>({withDalContext:(_tag,fn)=>fn()}));
jest.mock('../../lib/services/post-presentation-materials/edition-service.js',()=>({getPresentationApproval:jest.fn(),mutatePresentationApproval:jest.fn()}));
import { requireAppAccess } from '../../lib/utils/auth.js';
import { getPresentationApproval, mutatePresentationApproval } from '../../lib/services/post-presentation-materials/edition-service.js';
import handler from '../../pages/api/meeting-tracker/visits/[requestId]/presentation-approval.js';
const id='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
function res(){const r={headers:{},statusCode:200};r.setHeader=(k,v)=>{r.headers[k]=v;};r.status=c=>{r.statusCode=c;return r;};r.json=b=>{r.body=b;return r;};return r;}
beforeEach(()=>{jest.clearAllMocks();requireAppAccess.mockResolvedValue({profileId:7,session:{user:{dynamicsSystemuserId:actor}}});});
test('validates request and strict payload before executing a mutation; identity is always from session',async()=>{
 const bad=res();await handler({method:'POST',query:{requestId:'invalid'},body:{action:'enroll',expectedVersion:0}},bad);expect(bad.statusCode).toBe(400);expect(requireAppAccess).not.toHaveBeenCalled();
 const forged=res();await handler({method:'POST',query:{requestId:id},body:{action:'enroll',expectedVersion:0,profileId:99}},forged);expect(forged.statusCode).toBe(400);expect(mutatePresentationApproval).not.toHaveBeenCalled();
 mutatePresentationApproval.mockResolvedValue({enrolled:true,version:1});const ok=res();await handler({method:'POST',query:{requestId:id},body:{action:'enroll',expectedVersion:0}},ok);
 expect(mutatePresentationApproval).toHaveBeenCalledWith({requestId:id,profileId:7,actingUserSystemId:actor,body:{action:'enroll',expectedVersion:0}});expect(ok.headers['Cache-Control']).toBe('private, no-store');
});
test('missing linked staff profile fails closed; GET does not accept repeated/query-supplied identities',async()=>{
 requireAppAccess.mockResolvedValue({profileId:null,session:{user:{dynamicsSystemuserId:actor}}});const missing=res();await handler({method:'GET',query:{requestId:id}},missing);expect(missing.statusCode).toBe(401);expect(getPresentationApproval).not.toHaveBeenCalled();
 const extra=res();await handler({method:'GET',query:{requestId:id,profileId:'7'}},extra);expect(extra.statusCode).toBe(400);
 const repeated=res();await handler({method:'GET',query:{requestId:[id]}},repeated);expect(repeated.statusCode).toBe(400);
});
