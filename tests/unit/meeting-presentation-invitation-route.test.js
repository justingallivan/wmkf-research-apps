/** @jest-environment node */
jest.mock('../../lib/utils/auth',()=>({requireAppAccess:jest.fn()}));
jest.mock('../../lib/dataverse/core/context',()=>({withDalContext:(_label,fn)=>fn()}));
jest.mock('../../shared/config/meetingTracker',()=>({isMeetingTrackerSchemaReady:()=>true}));
jest.mock('../../lib/services/meeting-coordination/invitation-service',()=>({getInvitation:jest.fn(),prepareInvitation:jest.fn(),actOnInvitation:jest.fn()}));
import handler from '../../pages/api/meeting-tracker/visits/[requestId]/invitation';
import {requireAppAccess} from '../../lib/utils/auth';
import * as service from '../../lib/services/meeting-coordination/invitation-service';
const id='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
const response=()=>{const r={statusCode:200,headers:{},body:null};r.status=c=>{r.statusCode=c;return r;};r.json=b=>{r.body=b;return r;};r.setHeader=(k,v)=>{r.headers[k]=v;};return r;};
beforeEach(()=>{jest.clearAllMocks();requireAppAccess.mockResolvedValue({profileId:7,session:{user:{dynamicsSystemuserId:actor,azureEmail:'PC@wmkeck.org'}}});service.prepareInvitation.mockResolvedValue({invitation:{id,version:1}});service.actOnInvitation.mockResolvedValue({invitation:{id,version:3,state:'sent'}});});
test.each([{action:'prepare',subject:'Meeting',message:'Join us'},{action:'send',invitationId:id,expectedVersion:1},{action:'reconcile',invitationId:id,expectedVersion:3}])('strict %j uses only authenticated actor and path request',async body=>{const res=response();await handler({method:'POST',query:{requestId:id},body},res);expect(res.statusCode).toBe(200);expect(res.headers['Cache-Control']).toBe('private, no-store');const fn=body.action==='prepare'?service.prepareInvitation:service.actOnInvitation;expect(fn).toHaveBeenCalledWith({requestId:id,profileId:7,actingUserSystemId:actor,fromEmail:'pc@wmkeck.org',body});});
test.each([{action:'send',invitationId:id,expectedVersion:1,actorId:actor},{action:'prepare',subject:'Meeting',message:'Join',to:['forged@example.org']},{action:'send',invitationId:'bad',expectedVersion:1},{action:'send',invitationId:id,expectedVersion:-1},{action:'prepare',subject:'Meeting'}])('forged or malformed %j refuses before service',async body=>{const res=response();await handler({method:'POST',query:{requestId:id},body},res);expect(res.statusCode).toBe(400);expect(service.prepareInvitation).not.toHaveBeenCalled();expect(service.actOnInvitation).not.toHaveBeenCalled();});
test('missing app access cannot read the ledger',async()=>{requireAppAccess.mockResolvedValue(null);await handler({method:'GET',query:{requestId:id}},response());expect(service.getInvitation).not.toHaveBeenCalled();});
