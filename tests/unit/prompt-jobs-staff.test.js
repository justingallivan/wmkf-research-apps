/** @jest-environment node */
jest.mock('../../lib/services/prompt-jobs/proposal-source',()=>({createProposalSource:()=>({})}),{virtual:true});
jest.mock('../../lib/services/board-writeups/config',()=>({eligibleStaff:jest.fn()}));
jest.mock('../../lib/services/prompt-store',()=>({fetchCurrentPrompt:jest.fn()}));
jest.mock('../../lib/services/admin/prompt-profiles-service',()=>({getPromptProfiles:jest.fn()}));
import { readTrialPolicy, scopeForTrial } from '../../lib/services/prompt-jobs/trial-policy';
import { listStaffJobs, readStaffJob, readStaffResults, admitStaffJob, projectStaffJob } from '../../lib/services/prompt-jobs/staff-service';
import { getTaskCapabilities, isTaskEnabled } from '../../lib/services/prompt-jobs/capabilities';
const trialId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',requestId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',systemUserId='cccccccc-cccc-cccc-cccc-cccccccccccc',jobId='dddddddd-dddd-dddd-dddd-dddddddddddd';
const actor={profileId:7,systemUserId};
const access={trialId,requestId,...actor,sourcePolicy:'ai-materials-proposal-pi-v1'};
const env={DYNAMICS_IMPERSONATION_ENABLED:'true',PROMPT_JOB_TRIAL_ACCESS:JSON.stringify(access),PROMPT_JOB_NONCE_SECRET:'n'.repeat(32),DYNAMICS_URL:'https://orgd9e66399.crm.dynamics.com'};
const policy=readTrialPolicy(env,'local');
function setup(){
 const view={job:{id:jobId,request_id:requestId,version:2,created_at:'2026-11-11T00:00:00Z',result_expires_at:new Date(Date.now()+100000),snapshot_content_id:'PRIVATE_SNAPSHOT',idempotency_key:trialId,principal_key:'PRIVATE_ACTOR'},
 tasks:[{task_key:'proposal.executive-summary',state:'validated',result_content_id:'PRIVATE_RESULT',error_code:null},{task_key:'proposal.methodology',state:'validated',error_code:null}],attempts:[{audit_state:'delivered',response_content_id:'PRIVATE_RESPONSE',audit_run_id:'PRIVATE_AUDIT'}]};
 const results={jobId,version:2,expiresAt:view.job.result_expires_at,results:[{taskId:'PRIVATE_TASK',taskKey:'proposal.executive-summary',status:'available',text:'Validated summary'}]};
 const deps={policy:jest.fn(()=>policy),authorize:jest.fn(async()=>true),now:()=>Date.now(),source:{inspect:jest.fn()},prompt:jest.fn(),profiles:jest.fn(),store:{listJobs:jest.fn(async()=>[view]),readValidatedResults:jest.fn(async()=>results),admit:jest.fn(async()=>view)}};
 return{view,results,deps,args:{requestId,jobId,actor}};
}
it('default-off policy and actual Dataverse target determine the exact environment',()=>{
 expect(readTrialPolicy({},'local')).toBeNull();
 expect(policy.environment).toBe('local-sandbox');
 expect(readTrialPolicy({...env,DYNAMICS_URL:'https://wmkf.crm.dynamics.com',DYNAMICS_SANDBOX_URL:env.DYNAMICS_URL},'local').environment).toBe('local-production');
 expect(scopeForTrial(policy)).toEqual({environment:'local-sandbox',principalKey:'profile:7',authorizationScope:`proposal-trial:${trialId}`,requestId});
});
it.each([
 ['production',env],['preview',{...env,DYNAMICS_URL:'https://wmkf.crm.dynamics.com'}],['local',{...env,DYNAMICS_URL:'https://unknown.example'}],
 ['local',{...env,DYNAMICS_IMPERSONATION_ENABLED:'false'}],['local',{...env,PROMPT_JOB_NONCE_SECRET:'short'}],['local',{...env,PROMPT_JOB_TRIAL_ACCESS:'{}'}],
 ['local',{...env,PROMPT_JOB_TRIAL_ACCESS:JSON.stringify({...access,requestId:'*'})}],
 ['local',{...env,PROMPT_JOB_TRIAL_ACCESS:JSON.stringify({...access,sourcePolicy:'anything'})}],
])('policy rejects unsupported deployment or malformed activation %#',(deployment,value)=>{
 expect(()=>readTrialPolicy(value,deployment)).toThrow('prompt_job_trial_configuration');
});
it('capability runtime gate is distinct from definitions and disallows unknown combinations',()=>{
 expect(getTaskCapabilities().map(x=>x.name)).toContain('proposal.methodology');
 const scope={environment:policy.environment,authorizationScope:policy.authorizationScope};
 expect(isTaskEnabled('proposal.methodology',scope)).toBe(true);
 for(const bad of [{...scope,environment:'production'},{...scope,environment:'test'},{...scope,authorizationScope:'proposal-trial:any'}])expect(isTaskEnabled('proposal.methodology',bad)).toBeFalsy();
 expect(isTaskEnabled('synthetic.methodology',scope)).toBe(false);
 expect(isTaskEnabled('__proto__',scope)).toBeFalsy();
});
it('inactive and foreign actor/request discovery does no protected reads',async()=>{
 const{deps,args}=setup();
 expect(await listStaffJobs({...args,actor:{...actor,profileId:8}},deps)).toEqual({enabled:false,jobs:[]});
 expect(await listStaffJobs({...args,requestId:systemUserId},deps)).toEqual({enabled:false,jobs:[]});
 deps.policy.mockReturnValue(null);expect(await listStaffJobs(args,deps)).toEqual({enabled:false,jobs:[]});
 expect(deps.authorize).not.toHaveBeenCalled();expect(deps.store.listJobs).not.toHaveBeenCalled();
});
it('revoked authenticated staff cannot read result content',async()=>{
 const{deps,args}=setup();deps.authorize.mockResolvedValue(false);
 await expect(readStaffResults(args,deps)).rejects.toMatchObject({httpStatus:403});
 expect(deps.store.readValidatedResults).not.toHaveBeenCalled();
});
it('status and admission project only allowlisted fields; result availability uses retained validated content',async()=>{
 const{deps,args,view,results}=setup();
 const listed=await listStaffJobs(args,deps);const status=await readStaffJob(args,deps);
 const admitted=await admitStaffJob({...args,idempotencyKey:trialId},deps);
 expect(listed.jobs[0]).toEqual(status.job);expect(admitted.job).toEqual(status.job);
 expect(JSON.stringify(status)).not.toMatch(/PRIVATE_|idempotency|principal|content_id/);
 expect(status.job.tasks.map(t=>t.resultAvailable)).toEqual([true,false]);
 expect(deps.source.inspect).not.toHaveBeenCalled();expect(deps.prompt).not.toHaveBeenCalled();
 view.job.result_expires_at=new Date(0);expect(projectStaffJob(view,results).tasks.every(t=>!t.resultAvailable)).toBe(true);
 expect(projectStaffJob(view,results).status).toBe('expired');
});
it('results drop internal identifiers even when those identifiers are populated',async()=>{
 const{deps,args}=setup();const result=await readStaffResults(args,deps);
 expect(result.results).toEqual([{taskKey:'proposal.executive-summary',status:'available',text:'Validated summary'}]);
 expect(JSON.stringify(result)).not.toContain('PRIVATE_');
});
it('foreign job is absent and mid-read version change never receives an inconsistent status',async()=>{
 const{deps,args,results}=setup();await expect(readStaffJob({...args,jobId:trialId},deps)).rejects.toMatchObject({httpStatus:404});
 results.version=3;await expect(readStaffJob(args,deps)).rejects.toMatchObject({code:'prompt_job_changed'});
});
it('a different command after the one-job trial does not inspect mutable inputs',async()=>{
 const{deps,args}=setup();await expect(admitStaffJob({...args,idempotencyKey:systemUserId},deps)).rejects.toMatchObject({code:'prompt_job_trial_limit'});
 expect(deps.source.inspect).not.toHaveBeenCalled();expect(deps.store.admit).not.toHaveBeenCalled();
});
it('partial validation and unknown audit are surfaced without pretending the whole job succeeded',()=>{
 const{view,results}=setup();view.tasks[1].state='failed_validation';view.tasks[1].error_code='SECRET_RAW_PROVIDER_TEXT';
 const value=projectStaffJob(view,results);expect(value.status).toBe('needs_attention');expect(value.tasks[1].errorCode).toBe('profile_execution_failed');
 view.tasks[1].state='validated';view.attempts[0].audit_state='pending';expect(projectStaffJob(view,results).status).toBe('running');
 view.attempts[0].audit_state='unknown';expect(projectStaffJob(view,results).status).toBe('needs_attention');
});
