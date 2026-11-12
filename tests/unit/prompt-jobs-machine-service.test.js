/** @jest-environment node */
import { admitMachineJob, readMachineJob } from '../../lib/services/prompt-jobs/machine-service.js';
jest.mock('../../lib/services/prompt-jobs/machine-auth.js',()=>({createMachineAuthenticator:jest.fn(()=>jest.fn())}));
jest.mock('@vercel/postgres',()=>({createPool:jest.fn(()=>{throw new Error('No ambient database');})}));
jest.mock('../../lib/dataverse/adapters/grant-request.js',()=>({getById:jest.fn()}));
jest.mock('../../lib/services/prompt-store.js',()=>({fetchCurrentPrompt:jest.fn()}));
jest.mock('../../lib/services/admin/prompt-profiles-service.js',()=>({getPromptProfiles:jest.fn()}));
const requestId='10000000-0000-4000-8000-000000000001';
const sourceEventId='10000000-0000-4000-8000-000000000002';
const idempotencyKey='10000000-0000-4000-8000-000000000003';
function fixture() {
  const policy={enabled:true,requestId,sourceEventId,expiresAt:new Date(Date.now()+3600000).toISOString()};
  const access={policy,scope:{requestId},assertCurrent:jest.fn()};
  const deps={policy:()=>policy,now:()=>Date.now(),store:{admitMachineTitle:jest.fn(),verifyMachineTitleDatabase:jest.fn(),listJobs:jest.fn(async()=>[])}};
  const body={requestId,sourceEventId,operation:'initialize',taskKeys:['preflight.short-title']};
  return {policy,access,deps,body};
}
it.each([{},null,[],{operation:'initialize'},{requestId,sourceEventId,operation:'initialize',taskKeys:['preflight.short-title'],actor:'forged'}])('rejects malformed command before store: %j',async body=>{
  const {access,deps}=fixture(); await expect(admitMachineJob({body,idempotencyKey,access},deps)).rejects.toMatchObject({httpStatus:400});
  expect(deps.store.admitMachineTitle).not.toHaveBeenCalled();
});
it('rejects foreign Request and changed configuration before store',async()=>{
  const {access,deps,body}=fixture(); body.requestId=sourceEventId;
  await expect(admitMachineJob({body,idempotencyKey,access},deps)).rejects.toMatchObject({httpStatus:403});
  expect(deps.store.admitMachineTitle).not.toHaveBeenCalled();
  body.requestId=requestId; deps.policy=()=>({...access.policy,enabled:false});
  await expect(admitMachineJob({body,idempotencyKey,access},deps)).rejects.toMatchObject({httpStatus:503});
});
it('foreign status is 404 and database identity is checked before read',async()=>{
  const {access,deps}=fixture();
  await expect(readMachineJob({jobId:idempotencyKey,access},deps)).rejects.toMatchObject({httpStatus:404});
  expect(deps.store.verifyMachineTitleDatabase.mock.invocationCallOrder[0]).toBeLessThan(deps.store.listJobs.mock.invocationCallOrder[0]);
});
it('invalid status identifier cannot read database',async()=>{
  const {access,deps}=fixture(); await expect(readMachineJob({jobId:'bad',access},deps)).rejects.toMatchObject({httpStatus:400});
  expect(deps.store.verifyMachineTitleDatabase).not.toHaveBeenCalled();
});
