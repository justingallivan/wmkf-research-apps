/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
const mockComplete = jest.fn();
let mockMachinePolicy = null;
jest.mock('../../lib/services/prompt-jobs/machine-summary-policy.js', () => ({
  ...jest.requireActual('../../lib/services/prompt-jobs/machine-summary-policy.js'),
  readMachineSummaryPolicy: () => mockMachinePolicy,
}));
jest.mock('../../lib/services/llm-client.js', () => ({ DEFAULT_TIMEOUT_MS:120000,
  LLMClient:jest.fn().mockImplementation(()=>({complete:mockComplete})) }));
jest.mock('../../lib/dataverse/adapters/grant-request.js',()=>({getById:jest.fn(()=>{throw Error('Live read forbidden');}),updateById:jest.fn(()=>{throw Error('Live write forbidden');})}));
jest.mock('../../lib/dataverse/adapters/ai-run.js',()=>({create:jest.fn(()=>{throw Error('Live audit forbidden');})}));
import { executePrompt } from '../../lib/services/execute-prompt.js';
import { createPromptJobStore } from '../../lib/services/prompt-jobs/store.js';
import { admitSummaryJob, readSummaryJob } from '../../lib/services/prompt-jobs/machine-summary-service.js';
import { runSummaryJobTick } from '../../lib/services/prompt-jobs/machine-summary-worker.js';
import { createSummarySource } from '../../lib/services/prompt-jobs/summary-source.js';
import { MACHINE_SUMMARY_TASK, MACHINE_SUMMARY_FIELD } from '../../lib/services/prompt-jobs/machine-summary-contract.js';
import candidate from '../../docs/plans/SHARED_EXECUTOR_PROPOSAL_RETRY_CANDIDATE_2026-11-11.json';

import { machinePilotScope, machineDatabaseEndpoint } from '../../lib/services/prompt-jobs/machine-pilot-policy.js';
import { canonical, hashProfile, sha256 } from '../../lib/services/prompt-jobs/profile.js';

const url=process.env.PA_PROOF_PG_TEST_URL || '';
if(!url && process.env.PA_PROOF_PG_TEST_REQUIRE==='1')throw Error('PA_PROOF_PG_TEST_URL required');
if(url){const u=new URL(url);if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!=='127.0.0.1'||u.port!=='55441'||u.pathname!=='/pa_proof'||u.search||u.hash||url===process.env.POSTGRES_URL)throw Error('Dedicated PA scratch database required');}
const suite=url?describe:describe.skip;
const originalKey=process.env.CLAUDE_API_KEY;
suite('machine Summary actual admission/source/worker/Executor with real isolated PG',()=>{
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
  beforeEach(()=>{process.env.CLAUDE_API_KEY='synthetic-unused-key';mockComplete.mockReset().mockResolvedValue({text:'To explore cell signaling',content:[{type:'text',text:'To explore cell signaling'}],model:'claude-sonnet-4-6',stopReason:'end_turn',stopDetails:null,refused:false,usageComplete:true,usage:{inputTokens:100,outputTokens:10,cacheCreationTokens:0,cacheReadTokens:0}});});
  function fixture(initial=null){
    const profile=candidate.profile,task=candidate.tasks[0];const field=MACHINE_SUMMARY_FIELD;const promptId=randomUUID();
    const promptRow={wmkf_ai_promptid:promptId,wmkf_promptversion:1,wmkf_ai_promptname:task.name,wmkf_ai_promptbody:task.body,wmkf_ai_systemprompt:task.systemPrompt,wmkf_ai_model:task.model,wmkf_ai_maxtokens:task.maxTokens,wmkf_ai_temperature:task.temperature,wmkf_ai_promptvariables:task.variables,wmkf_ai_promptoutputschema:task.outputSchema};
    const pilotId=randomUUID();let policy={pilotId,enabled:true,requestId:randomUUID(),sourceEventId:randomUUID(),authorizationScope:`pa-executive-summary:${pilotId}`,principalKey:'app:entra-v2:worker-fixture',environment:'test-sandbox',expiresAt:new Date(Date.now()+86400000).toISOString(),databaseEndpoint:endpoint,databaseIdentity,promptId,promptVersion:1,promptHash:sha256(canonical(promptRow)),profileHash:hashProfile(profile)};
    mockMachinePolicy = policy;
    let row={_etag:'W/"1"',akoya_title:'Applicant title',wmkf_abstract:'A synthetic abstract that explains the experimental hypothesis and research approach.',wmkf_phaseistatus:null,[field]:initial};
    const store=createPromptJobStore(pool,{readMachinePolicy:()=>policy,machineDatabaseEndpoint:endpoint});
    const readRequest=jest.fn(async id=>{expect(id).toBe(policy.requestId);return {...row};});
    const patchRequest=jest.fn(async(id,fields,options)=>{
      expect(id).toBe(policy.requestId);expect(options.noFallback).toBe(true);
      if(options.ifMatch!==row._etag)throw Object.assign(Error('Concurrent edit'),{status:412});
      row={...row,...fields,_etag:'W/"2"'};
    });
    const audit=jest.fn(async()=>{});
    let sourceVersion = '1'; const contactId=randomUUID();
    const source=createSummarySource({
      readRequest:async()=>({akoya_requestid:policy.requestId,akoya_requestnum:'1003109',_wmkf_projectleader_value:contactId}),
      readContact:async()=>({contactid:contactId,fullname:'Synthetic PI'}),
      getBuckets:async()=>[{library:'akoya_request',folder:'fixture',source:'dynamics'}],
      getFileMetadataByPath:async(_library,folder,name)=>{expect(folder).toBe('fixture/Submission-Documents');expect(name).toBe('Project-Narrative_1003109.pdf');return {name,siteId:'site',driveId:'drive',id:'narrative',eTag:sourceVersion,versionId:sourceVersion};},
      downloadFile:async()=>({filename:'Project-Narrative_1003109.pdf',buffer:Buffer.from('%PDF-synthetic')}),
      extractText:async()=> 'Synthetic narrative about cell signaling.',
    });
    const checkDestination=jest.fn(async()=>{});
    const deps={store,checkDestination,policy:()=>policy,source,readRequest,patchRequest,audit,executePrompt,prompt:jest.fn(async()=>promptRow),profiles:jest.fn(async()=>({profiles:[{profile,sha256:hashProfile(profile)}]})),now:()=>Date.now(),nonceSecret:()=> 'offline-machine-summary-nonce-secret-32bytes'};
    const access={policy,scope:machinePilotScope(policy),assertCurrent:()=>{}};
    const args={access,idempotencyKey:randomUUID(),body:{requestId:policy.requestId,sourceEventId:policy.sourceEventId,taskKeys:[MACHINE_SUMMARY_TASK],operation:'initialize'}};
    return {replaceSource:()=>{sourceVersion='2';},deps,args,store,patchRequest,audit,readRequest,field,getRow:()=>row,edit:(value='Staff edit')=>{row={...row,_etag:'W/"edited"',[field]:value};},policy:patch=>{policy={...policy,...patch};mockMachinePolicy=policy;}};
  }
  async function throughAudit(f){
    const admitted=await admitSummaryJob(f.args,f.deps);const stages=[];
    for(let i=0;i<4;i++)stages.push((await runSummaryJobTick(f.deps)).stage);
    expect(stages).toEqual(['snapshot_saved','target_captured','validated','audit_delivered']);
    expect(mockComplete).toHaveBeenCalledTimes(1);expect(f.audit).toHaveBeenCalledTimes(1);
    return admitted.job.jobId;
  }
  test('real Summary mode saves once through source, Executor, audit and conditional publication',async()=>{
    const f=fixture();const jobId=await throughAudit(f);
    expect(await runSummaryJobTick(f.deps)).toEqual({stage:'published'});
    expect((await readSummaryJob({jobId,access:f.args.access},f.deps)).job.state).toBe('succeeded');
    expect(f.getRow()[MACHINE_SUMMARY_FIELD]).toBe('To explore cell signaling');
    expect(JSON.stringify(mockComplete.mock.calls[0])).toContain('Synthetic narrative about cell signaling.');
    expect(JSON.stringify(mockComplete.mock.calls[0])).toContain('Synthetic PI');
    expect(f.patchRequest).toHaveBeenCalledWith(f.args.body.requestId,{[MACHINE_SUMMARY_FIELD]:'To explore cell signaling'},{ifMatch:'W/"1"',noFallback:true});
    f.edit(null);
    expect((await admitSummaryJob(f.args,f.deps)).job.state).toBe('succeeded');
    await runSummaryJobTick(f.deps);
    expect(mockComplete).toHaveBeenCalledTimes(1);expect(f.patchRequest).toHaveBeenCalledTimes(1);
    expect(f.getRow()[MACHINE_SUMMARY_FIELD]).toBeNull();
  });
  test('concurrent identical submits share one receipt, changed key cannot create a second job',async()=>{
    const f=fixture();const results=await Promise.all([admitSummaryJob(f.args,f.deps),admitSummaryJob(f.args,f.deps)]);
    expect(results[0].job.jobId).toBe(results[1].job.jobId);
    await expect(admitSummaryJob({...f.args,idempotencyKey:randomUUID()},f.deps)).rejects.toMatchObject({code:'prompt_job_trial_limit'});
  });
  test('narrative replacement before dispatch prevents generation',async()=>{
    const f=fixture();await admitSummaryJob(f.args,f.deps);await runSummaryJobTick(f.deps);await runSummaryJobTick(f.deps);
    f.replaceSource();expect(await runSummaryJobTick(f.deps)).toEqual({stage:'failed_pre_dispatch'});
    expect(mockComplete).not.toHaveBeenCalled();expect(f.patchRequest).not.toHaveBeenCalled();
  });
  test('narrative replacement after generation terminalizes as conflict without publication',async()=>{
    const f=fixture();const jobId=await throughAudit(f);f.replaceSource();
    expect(await runSummaryJobTick(f.deps)).toEqual({stage:'conflict'});
    const status=await readSummaryJob({jobId,access:f.args.access},f.deps);
    expect(status.job).toMatchObject({state:'needs_attention',pollAfterSeconds:null});
    await runSummaryJobTick(f.deps);expect(f.patchRequest).not.toHaveBeenCalled();expect(mockComplete).toHaveBeenCalledTimes(1);
  });
  test('staff edit during generation is preserved by original ETag',async()=>{
    const f=fixture();const jobId=await throughAudit(f);f.edit();
    expect(await runSummaryJobTick(f.deps)).toEqual({stage:'conflict'});
    expect((await readSummaryJob({jobId,access:f.args.access},f.deps)).job.state).toBe('needs_attention');
    expect(f.getRow()[MACHINE_SUMMARY_FIELD]).toBe('Staff edit');
  });
  test('existing text prevents a provider call',async()=>{
    const f=fixture('Existing text');await admitSummaryJob(f.args,f.deps);
    await runSummaryJobTick(f.deps);await runSummaryJobTick(f.deps);await runSummaryJobTick(f.deps);
    expect(mockComplete).not.toHaveBeenCalled();expect(f.patchRequest).not.toHaveBeenCalled();
  });
  test('lost publication response remains unknown and is never retried',async()=>{
    const f=fixture();const jobId=await throughAudit(f);f.patchRequest.mockRejectedValue(Error('lost reply'));
    expect(await runSummaryJobTick(f.deps)).toEqual({stage:'unknown'});
    await runSummaryJobTick(f.deps);await admitSummaryJob(f.args,f.deps);
    expect((await readSummaryJob({jobId,access:f.args.access},f.deps)).job.state).toBe('needs_attention');
    expect(f.patchRequest).toHaveBeenCalledTimes(1);expect(mockComplete).toHaveBeenCalledTimes(1);
  });
  test('audit failure blocks publication',async()=>{
    const f=fixture();await admitSummaryJob(f.args,f.deps);
    await runSummaryJobTick(f.deps);await runSummaryJobTick(f.deps);await runSummaryJobTick(f.deps);
    f.audit.mockRejectedValue(Error('lost audit reply'));expect(await runSummaryJobTick(f.deps)).toEqual({stage:'audit_unknown'});
    await runSummaryJobTick(f.deps);expect(f.patchRequest).not.toHaveBeenCalled();expect(f.audit).toHaveBeenCalledTimes(1);
  });
  test('missing narrative during preparation produces durable failure without a call',async()=>{
    const f=fixture();const {job:{jobId}}=await admitSummaryJob(f.args,f.deps);
    f.deps.source.prepare=async()=>{throw Object.assign(Error('missing'),{code:'summary_source_missing'});};
    expect(await runSummaryJobTick(f.deps)).toEqual({stage:'failed_pre_dispatch'});
    const status=await readSummaryJob({jobId,access:f.args.access},f.deps);
    expect(status.job).toMatchObject({state:'failed',pollAfterSeconds:null});
    expect(status.job.tasks[0].errorCode).toBe('summary_source_missing');expect(mockComplete).not.toHaveBeenCalled();
  });
  test('Summary scope cannot admit title or methodology or generic initialization',async()=>{
    const f=fixture();
    for(const taskKey of ['preflight.short-title','proposal.methodology']) await expect(admitSummaryJob({...f.args,body:{...f.args.body,taskKeys:[taskKey]}},f.deps)).rejects.toMatchObject({httpStatus:400});
    await expect(f.store.admit({...f.args.access.scope,operation:'initialize',sourceEventId:randomUUID(),tasks:[{taskKey:MACHINE_SUMMARY_TASK}]})).rejects.toThrow();
    expect(mockComplete).not.toHaveBeenCalled();
  });
  test('unknown provider outcome is not regenerated',async()=>{
    const f=fixture();const {job:{jobId}}=await admitSummaryJob(f.args,f.deps);
    await runSummaryJobTick(f.deps);await runSummaryJobTick(f.deps);
    mockComplete.mockRejectedValue(Error('lost provider reply'));
    await runSummaryJobTick(f.deps);await runSummaryJobTick(f.deps);
    expect(mockComplete).toHaveBeenCalledTimes(1);expect(f.patchRequest).not.toHaveBeenCalled();
    expect((await readSummaryJob({jobId,access:f.args.access},f.deps)).job.state).toBe('needs_attention');
  });
  test('disabled policy stops a prepared job before dispatch',async()=>{
    const f=fixture();await admitSummaryJob(f.args,f.deps);await runSummaryJobTick(f.deps);await runSummaryJobTick(f.deps);
    f.policy({enabled:false});expect(await runSummaryJobTick(f.deps)).toEqual({stage:'disabled'});
    expect(mockComplete).not.toHaveBeenCalled();expect(f.patchRequest).not.toHaveBeenCalled();
  });
  test('foreign Request and changed event reject before source loading',async()=>{
    const f=fixture();f.deps.source.inspect=jest.fn();
    for(const key of ['requestId','sourceEventId']) await expect(admitSummaryJob({...f.args,body:{...f.args.body,[key]:randomUUID()}},f.deps)).rejects.toMatchObject({httpStatus:403});
    expect(f.deps.source.inspect).not.toHaveBeenCalled();
  });

});
