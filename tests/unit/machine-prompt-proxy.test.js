/** @jest-environment node */
jest.mock('next-auth/middleware',()=>({withAuth:jest.fn(()=>jest.fn(async()=>({shared:true})))}));
jest.mock('next-auth/jwt',()=>({getToken:jest.fn()}));
jest.mock('next/server',()=>({NextResponse:{next:jest.fn(()=>({passed:true})),redirect:jest.fn()}}));
jest.mock('../../lib/services/meeting-tracker-transcription/test-deployment-policy',()=>({decideMeetingTranscriptionTestRequest:jest.fn(()=>({dedicated:false}))}));
jest.mock('../../lib/services/transcription-pilot/deployment-policy',()=>({decideTranscriptionPilotRequest:jest.fn(()=>({dedicated:false})),isDedicatedTranscriptionAuthConfigured:jest.fn(),isLegacyProxyPassThrough:jest.fn(()=>false)}));
import proxy from '../../proxy';
import {decideMeetingTranscriptionTestRequest} from '../../lib/services/meeting-tracker-transcription/test-deployment-policy';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function req(pathname,method='GET'){return {nextUrl:new URL(`https://example.invalid${pathname}`),method};}
beforeEach(()=>jest.clearAllMocks());
test.each(['GET','POST','DELETE'])('all %s methods reach route auth for exact machine paths',async method=>{
 expect(await proxy(req('/api/automation/prompt-jobs',method))).toEqual({passed:true});expect(await proxy(req(`/api/automation/prompt-jobs/${id}`,method))).toEqual({passed:true});
});
test.each(['/api/automation/prompt-jobs/','/api/automation/prompt-jobs/nope',`/api/automation/prompt-jobs/${id}/result`])('adjacent route %s retains shared gate',async path=>{expect(await proxy(req(path))).toEqual({shared:true});});
test('dedicated test deployment denial happens before machine pass-through',async()=>{
 decideMeetingTranscriptionTestRequest.mockReturnValueOnce({dedicated:true,identityVerified:true,enabled:true,allowed:false});
 expect((await proxy(req('/api/automation/prompt-jobs','POST'))).status).toBe(404);
});
