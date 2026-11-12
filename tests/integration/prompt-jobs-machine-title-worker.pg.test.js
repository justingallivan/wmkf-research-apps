/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
const mockComplete = jest.fn();
jest.mock('../../lib/services/llm-client.js', () => ({ DEFAULT_TIMEOUT_MS:120000,
  LLMClient:jest.fn().mockImplementation(()=>({complete:mockComplete})) }));
jest.mock('../../lib/dataverse/adapters/grant-request.js',()=>({getById:jest.fn(()=>{throw Error('Live read forbidden');}),updateById:jest.fn(()=>{throw Error('Live write forbidden');})}));
jest.mock('../../lib/dataverse/adapters/ai-run.js',()=>({create:jest.fn(()=>{throw Error('Live audit forbidden');})}));
import { executePrompt } from '../../lib/services/execute-prompt.js';
import { createPromptJobStore } from '../../lib/services/prompt-jobs/store.js';
import { admitMachineJob, readMachineJob } from '../../lib/services/prompt-jobs/machine-service.js';
import { runMachineJobTick } from '../../lib/services/prompt-jobs/machine-worker.js';
import { createMachineTitleSource } from '../../lib/services/prompt-jobs/machine-title-source.js';
import { buildMachineTitleDefinition, MACHINE_TITLE_TASK, MACHINE_TITLE_FIELD } from '../../lib/services/prompt-jobs/machine-title-contract.js';
import { machinePilotScope, machineDatabaseEndpoint } from '../../lib/services/prompt-jobs/machine-pilot-policy.js';
import { canonical, hashProfile, sha256 } from '../../lib/services/prompt-jobs/profile.js';

const url=process.env.PA_PROOF_PG_TEST_URL || '';
if(!url && process.env.PA_PROOF_PG_TEST_REQUIRE==='1')throw Error('PA_PROOF_PG_TEST_URL required');
if(url){const u=new URL(url);if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!=='127.0.0.1'||u.port!=='55441'||u.pathname!=='/pa_proof'||u.search||u.hash||url===process.env.POSTGRES_URL)throw Error('Dedicated PA scratch database required');}
const suite=url?describe:describe.skip;
const originalKey=process.env.CLAUDE_API_KEY;
suite('machine title actual admission/worker/Executor with real isolated PG',()=>{
  let admin,pool,schema,endpoint,databaseIdentity;
  beforeAll(async()=>{
    admin=new pg.Client({connectionString:url});await admin.connect();
    schema=`pa_proof_${randomUUID().replaceAll('-','')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`,max:6});
    await pool.query(readFileSync('lib/db/migrations/097_shared_prompt_jobs.sql','utf8'));
    const {rows:[row]}=await pool.query('SELECT current_database() AS database_name,system_identifier::text FROM pg_catalog.pg_control_system()');
    endpoint=machineDatabaseEndpoint(url);databaseIdentity=sha256(canonical([endpoint,row.system_identifier,row.database_name]));
  });
  afterAll(async()=>{if(originalKey===undefined)delete process.env.CLAUDE_API_KEY;else process.env.CLAUDE_API_KEY=originalKey;
    try{if(pool)await pool.end();}finally{try{if(schema)await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{if(admin)await admin.end();}}});
  beforeEach(()=>{process.env.CLAUDE_API_KEY='synthetic-unused-key';mockComplete.mockReset().mockResolvedValue({text:'To explore cell signaling',content:[{type:'text',text:'To explore cell signaling'}],model:'claude-sonnet-5-5',stopReason:'end_turn',stopDetails:null,refused:false,usageComplete:true,usage:{inputTokens:100,outputTokens:10,cacheCreationTokens:0,cacheReadTokens:0}});});
  function fixture(initial=null){
    const {profile,task}=buildMachineTitleDefinition();const promptId=randomUUID();
    const promptRow={wmkf_ai_promptid:promptId,wmkf_promptversion:1,wmkf_ai_promptname:task.name,wmkf_ai_promptbody:task.body,wmkf_ai_systemprompt:task.systemPrompt,wmkf_ai_model:task.model,wmkf_ai_maxtokens:task.maxTokens,wmkf_ai_temperature:task.temperature,wmkf_ai_promptvariables:task.variables,wmkf_ai_promptoutputschema:task.outputSchema};
    const pilotId=randomUUID();let policy={pilotId,enabled:true,requestId:randomUUID(),sourceEventId:randomUUID(),authorizationScope:`pa-short-title:${pilotId}`,principalKey:'app:entra-v2:worker-fixture',environment:'test-sandbox',expiresAt:new Date(Date.now()+86400000).toISOString(),databaseEndpoint:endpoint,databaseIdentity,promptId,promptVersion:1,promptHash:sha256(canonical(promptRow)),profileHash:hashProfile(profile)};
    let row={_etag:'W/"1"',akoya_title:'Applicant title',wmkf_abstract:'A synthetic abstract that explains the experimental hypothesis and research approach.',wmkf_phaseistatus:null,[MACHINE_TITLE_FIELD]:initial};
    const store=createPromptJobStore(pool,{readMachinePolicy:()=>policy,machineDatabaseEndpoint:endpoint});
    const readRequest=jest.fn(async id=>{expect(id).toBe(policy.requestId);return {...row};});
    const patchRequest=jest.fn(async(id,fields,options)=>{
      expect(id).toBe(policy.requestId);expect(options.noFallback).toBe(true);
      if(options.ifMatch!==row._etag)throw Object.assign(Error('Concurrent edit'),{status:412});
      row={...row,...fields,_etag:'W/"2"'};
    });
    const audit=jest.fn(async()=>{});const source=createMachineTitleSource({readRequest});
    const deps={store,policy:()=>policy,source,readRequest,patchRequest,audit,executePrompt,prompt:jest.fn(async()=>promptRow),profiles:jest.fn(async()=>({profiles:[{profile,sha256:hashProfile(profile)}]})),now:()=>Date.now(),nonceSecret:()=> 'offline-machine-title-nonce-secret-32bytes'};
    const access={policy,scope:machinePilotScope(policy),assertCurrent:()=>{}};
    const args={access,idempotencyKey:randomUUID(),body:{requestId:policy.requestId,sourceEventId:policy.sourceEventId,taskKeys:[MACHINE_TITLE_TASK],operation:'initialize'}};
    return {deps,args,store,patchRequest,audit,readRequest,getRow:()=>row,edit:(value='Staff edit')=>{row={...row,_etag:'W/"edited"',[MACHINE_TITLE_FIELD]:value};},policy:patch=>{policy={...policy,...patch};}};
  }
  async function throughAudit(f){
    const admitted=await admitMachineJob(f.args,f.deps);const stages=[];
    for(let i=0;i<4;i++)stages.push((await runMachineJobTick(f.deps)).stage);
    expect(stages).toEqual(['snapshot_saved','target_captured','validated','audit_delivered']);
    expect(mockComplete).toHaveBeenCalledTimes(1);expect(f.audit).toHaveBeenCalledTimes(1);
    return admitted.job.jobId;
  }
  test('one call traverses snapshot, dispatch, audit and conditional write; stable replay never regenerates',async()=>{
    const f=fixture();const jobId=await throughAudit(f);
    expect(await runMachineJobTick(f.deps)).toEqual({stage:'published'});
    const status=await readMachineJob({jobId,access:f.args.access},f.deps);
    expect(status.job.state).toBe('succeeded');expect(f.getRow()[MACHINE_TITLE_FIELD]).toBe('To explore cell signaling');
    expect(f.patchRequest).toHaveBeenCalledWith(f.args.body.requestId,{[MACHINE_TITLE_FIELD]:'To explore cell signaling'},{ifMatch:'W/"1"',noFallback:true});
    expect((await admitMachineJob(f.args,f.deps)).job).toEqual({...status.job,observedAt:expect.any(String)});
    await runMachineJobTick(f.deps);expect(mockComplete).toHaveBeenCalledTimes(1);expect(f.patchRequest).toHaveBeenCalledTimes(1);
    expect((await pool.query('SELECT state,audit_state FROM prompt_job_attempts WHERE task_id IN (SELECT id FROM prompt_job_tasks WHERE job_id=$1)',[jobId])).rows).toEqual([{state:'validated',audit_state:'delivered'}]);
  });
  test('human clear after successful write survives exact replay without regeneration or rewrite',async()=>{
    const f=fixture();const jobId=await throughAudit(f);
    expect(await runMachineJobTick(f.deps)).toEqual({stage:'published'});
    f.edit(null);
    expect((await admitMachineJob(f.args,f.deps)).job.state).toBe('succeeded');
    await runMachineJobTick(f.deps);await runMachineJobTick(f.deps);
    expect((await readMachineJob({jobId,access:f.args.access},f.deps)).job.state).toBe('succeeded');
    expect(f.getRow()).toMatchObject({_etag:'W/"edited"',[MACHINE_TITLE_FIELD]:null});
    expect(mockComplete).toHaveBeenCalledTimes(1);expect(f.patchRequest).toHaveBeenCalledTimes(1);expect(f.audit).toHaveBeenCalledTimes(1);
    expect((await pool.query('SELECT state FROM prompt_job_publications WHERE job_id=$1',[jobId])).rows).toEqual([{state:'applied'}]);
  });
  test('write transport 500 persists unknown and exact replay never retries delivery',async()=>{
    const f=fixture();const jobId=await throughAudit(f);
    f.patchRequest.mockRejectedValue(Object.assign(Error('Synthetic transport failure'),{status:500}));
    expect(await runMachineJobTick(f.deps)).toEqual({stage:'unknown'});
    expect((await admitMachineJob(f.args,f.deps)).job.state).toBe('needs_attention');
    await runMachineJobTick(f.deps);await runMachineJobTick(f.deps);
    expect((await readMachineJob({jobId,access:f.args.access},f.deps)).job.state).toBe('needs_attention');
    expect((await pool.query('SELECT state FROM prompt_job_publications WHERE job_id=$1',[jobId])).rows).toEqual([{state:'unknown'}]);
    expect(f.getRow()[MACHINE_TITLE_FIELD]).toBeNull();expect(mockComplete).toHaveBeenCalledTimes(1);expect(f.patchRequest).toHaveBeenCalledTimes(1);
  });
  test('audit transport failure is durable unknown and blocks write without audit retry',async()=>{
    const f=fixture();const {job:{jobId}}=await admitMachineJob(f.args,f.deps);
    await runMachineJobTick(f.deps);await runMachineJobTick(f.deps);await runMachineJobTick(f.deps);
    f.audit.mockRejectedValue(Object.assign(Error('Synthetic audit transport failure'),{status:500}));
    expect(await runMachineJobTick(f.deps)).toEqual({stage:'audit_unknown'});
    expect((await admitMachineJob(f.args,f.deps)).job.state).toBe('needs_attention');
    await runMachineJobTick(f.deps);await runMachineJobTick(f.deps);
    expect((await pool.query('SELECT state,audit_state FROM prompt_job_attempts WHERE task_id IN (SELECT id FROM prompt_job_tasks WHERE job_id=$1)',[jobId])).rows).toEqual([{state:'validated',audit_state:'unknown'}]);
    expect(mockComplete).toHaveBeenCalledTimes(1);expect(f.audit).toHaveBeenCalledTimes(1);expect(f.patchRequest).not.toHaveBeenCalled();
    expect(f.getRow()[MACHINE_TITLE_FIELD]).toBeNull();
  });
  test('edit after generation preserves original ETag and records durable 412 conflict without retry',async()=>{
    const f=fixture();const jobId=await throughAudit(f);f.edit();
    expect(await runMachineJobTick(f.deps)).toEqual({stage:'conflict'});
    expect((await readMachineJob({jobId,access:f.args.access},f.deps)).job.state).toBe('needs_attention');
    expect(f.getRow()[MACHINE_TITLE_FIELD]).toBe('Staff edit');await runMachineJobTick(f.deps);
    expect(f.patchRequest).toHaveBeenCalledTimes(1);expect(mockComplete).toHaveBeenCalledTimes(1);
  });
  test.each(['Staff text',' '])('nonblank destination %j is protected before provider work',async initial=>{
    const f=fixture(initial);const result=await admitMachineJob(f.args,f.deps);
    await runMachineJobTick(f.deps);await runMachineJobTick(f.deps);await runMachineJobTick(f.deps);
    expect((await readMachineJob({jobId:result.job.jobId,access:f.args.access},f.deps)).job.state).toBe('failed');
    expect(mockComplete).not.toHaveBeenCalled();expect(f.patchRequest).not.toHaveBeenCalled();expect(f.getRow()[MACHINE_TITLE_FIELD]).toBe(initial);
  });
  test('expired source terminalizes without provider or destination writes',async()=>{
    const f=fixture();const result=await admitMachineJob(f.args,f.deps);
    await pool.query("UPDATE prompt_jobs SET source_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[result.job.jobId]);
    await runMachineJobTick(f.deps);
    expect((await readMachineJob({jobId:result.job.jobId,access:f.args.access},f.deps)).job.state).toBe('needs_attention');
    expect(mockComplete).not.toHaveBeenCalled();expect(f.patchRequest).not.toHaveBeenCalled();
  });
  test.each(['policy','source','source_unavailable'])('%s change after durable dispatch prevents provider call',async change=>{
    const f=fixture();const result=await admitMachineJob(f.args,f.deps);
    await runMachineJobTick(f.deps);await runMachineJobTick(f.deps);
    const mark=f.store.markDispatching.bind(f.store);
    f.store.markDispatching=async input=>{const receipt=await mark(input);if(change==='policy')f.policy({enabled:false});else if(change==='source')f.edit();else f.deps.source.isCurrent=async()=>{throw Object.assign(Error('Unavailable'),{httpStatus:503});};return receipt;};
    await runMachineJobTick(f.deps);
    expect(mockComplete).not.toHaveBeenCalled();expect(f.patchRequest).not.toHaveBeenCalled();expect(f.audit).not.toHaveBeenCalled();
    const attempts=await pool.query('SELECT state,error_code,audit_state FROM prompt_job_attempts WHERE task_id IN (SELECT id FROM prompt_job_tasks WHERE job_id=$1)',[result.job.jobId]);
    expect(attempts.rows).toEqual([{state:'failed_pre_dispatch',error_code:change==='source_unavailable'?'profile_execution_failed':'dispatch_denied',audit_state:'none'}]);
    const slots=await pool.query('SELECT released_at IS NOT NULL AS released FROM prompt_job_initializations WHERE job_id=$1',[result.job.jobId]);
    expect(slots.rows).toEqual([{released:true}]);
    if(change==='policy')f.policy({enabled:true});
    await expect(admitMachineJob({...f.args,idempotencyKey:randomUUID()},f.deps)).rejects.toMatchObject({httpStatus:429,code:'prompt_job_trial_limit'});
    expect(mockComplete).not.toHaveBeenCalled();expect(f.patchRequest).not.toHaveBeenCalled();

  });
  test.each([{enabled:false},{expiresAt:'2000-01-01T00:00:00.000Z'}])('inactive pilot cleans only its expired content and preserves both receipts: %j',async change=>{
    const first=fixture();const second=fixture();
    const firstId=(await admitMachineJob(first.args,first.deps)).job.jobId;
    const secondId=(await admitMachineJob(second.args,second.deps)).job.jobId;
    const ids=[firstId,secondId];
    const before=await pool.query('SELECT id,job_id,payload FROM prompt_job_content WHERE job_id=ANY($1::uuid[]) ORDER BY id',[ids]);
    expect(before.rows.filter(row=>row.job_id===firstId).length).toBeGreaterThan(0);
    const otherContent=before.rows.filter(row=>row.job_id===secondId);
    expect(otherContent.length).toBeGreaterThan(0);
    const receipts=await pool.query('SELECT * FROM prompt_jobs WHERE id=ANY($1::uuid[]) ORDER BY id',[ids]);
    await pool.query("UPDATE prompt_job_content SET expires_at=clock_timestamp()-interval '1 second' WHERE job_id=ANY($1::uuid[])",[ids]);
    first.policy(change);
    expect(await runMachineJobTick(first.deps)).toEqual({stage:'disabled'});
    const after=await pool.query('SELECT id,job_id,payload FROM prompt_job_content WHERE job_id=ANY($1::uuid[]) ORDER BY id',[ids]);
    expect(after.rows).toEqual(otherContent);
    expect((await pool.query('SELECT * FROM prompt_jobs WHERE id=ANY($1::uuid[]) ORDER BY id',[ids])).rows).toEqual(receipts.rows);
    expect(receipts.rows).toHaveLength(2);
    expect(mockComplete).not.toHaveBeenCalled();
    for(const f of [first,second]){expect(f.readRequest).toHaveBeenCalledTimes(1);expect(f.patchRequest).not.toHaveBeenCalled();expect(f.audit).not.toHaveBeenCalled();}
  });
  test.each([{enabled:false},{expiresAt:'2000-01-01T00:00:00.000Z'}])('disabled or expired grant stops worker and replay: %j',async change=>{
    const f=fixture();await admitMachineJob(f.args,f.deps);f.policy(change);
    expect(await runMachineJobTick(f.deps)).toEqual({stage:'disabled'});
    await expect(admitMachineJob(f.args,f.deps)).rejects.toMatchObject({httpStatus:503});
    expect(mockComplete).not.toHaveBeenCalled();expect(f.patchRequest).not.toHaveBeenCalled();
  });
});
