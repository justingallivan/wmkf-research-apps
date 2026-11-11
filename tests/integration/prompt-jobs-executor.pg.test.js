/** @jest-environment node */
/**
 * Synthetic vertical proof: real SQL + worker + canonical Executor/parser;
 * only provider, authorization/source observations and destination are fixtures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
const mockComplete = jest.fn();
jest.mock('../../lib/services/llm-client.js', () => ({
  DEFAULT_TIMEOUT_MS:120000,LLMClient:jest.fn().mockImplementation(()=>({complete:mockComplete})),
}));
jest.mock('../../lib/dataverse/adapters/grant-request.js',()=>({getById:jest.fn(()=>{throw new Error('live read forbidden');}),updateById:jest.fn(()=>{throw new Error('live write forbidden');})}));
jest.mock('../../lib/dataverse/adapters/ai-run.js',()=>({create:jest.fn(()=>{throw new Error('live audit forbidden');})}));
import { executePrompt } from '../../lib/services/execute-prompt.js';
import { createPromptJobStore } from '../../lib/services/prompt-jobs/store.js';
import { advanceJob } from '../../lib/services/prompt-jobs/worker.js';
import { canonical, hashProfile, sha256 } from '../../lib/services/prompt-jobs/profile.js';
import { prepareContextSnapshot } from '../../lib/services/prompt-jobs/context.js';

const databaseUrl=process.env.TEST_REQUEST_LEDGER_TEST_URL;
if (!databaseUrl && process.env.TEST_REQUEST_LEDGER_REQUIRE==='1') throw new Error('TEST_REQUEST_LEDGER_TEST_URL required');
if (databaseUrl) {
  const url=new URL(databaseUrl);
  if (!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.search||url.hash) throw new Error('synthetic trial requires loopback PostgreSQL URL without overrides');
}
const suite=databaseUrl?describe:describe.skip;
const profile={key:'proposal-analysis',revision:1,wrapperVersion:1,sharedInstructions:'Analyze the applicant proposal.',documentRoles:['proposal'],recordNames:['pi_name'],limits:{maxDocuments:1,maxDocumentBytes:10000,maxTotalDocumentBytes:10000,maxRecordBytes:1000}};
const nonceSecret='synthetic private secret for the local trial';
const originalKey=process.env.CLAUDE_API_KEY;
function prompt(kind) {
  const summary=kind==='executive-summary';
  return {wmkf_ai_promptid:randomUUID(),wmkf_ai_promptname:`synthetic.${kind}`,wmkf_promptversion:1,
    wmkf_ai_model:'claude-sonnet-4-6',wmkf_ai_maxtokens:1000,wmkf_ai_temperature:0.2,wmkf_ai_systemprompt:'',
    wmkf_ai_promptbody:`${summary?'Summarize the hypothesis, innovation, approach and impact':'Explain the methodology'} using {{pi_name}}.`,
    wmkf_ai_promptvariables:JSON.stringify({execution:{contractVersion:1,mode:'shared-document-task',profile:{key:profile.key,revision:1,sha256:hashProfile(profile)}},variables:[{name:'proposal_context',source:{kind:'prepared_context'},required:true},{name:'pi_name',source:{kind:'frozen_record'},required:false}]}),
    wmkf_ai_promptoutputschema:JSON.stringify({parseMode:'raw',outputs:[{name:summary?'summary':'methodology',target:{kind:'none'},...(summary?{maxWords:200}:{maxChars:12000})}]})};
}
function providerResponse(text='RESULT_CANARY This synthetic response describes the proposal and its experimental approach.') {
  return {text,content:[{type:'text',text}],model:'claude-sonnet-4-6',stopReason:'end_turn',stopDetails:null,refused:false,usageComplete:true,
    usage:{inputTokens:100,outputTokens:20,cacheCreationTokens:80,cacheReadTokens:0}};
}

suite('shared prompt job synthetic vertical trial',()=>{
  let admin,pool,store,schema;
  beforeAll(async()=>{
    schema=`prompt_jobs_vertical_${randomUUID().replaceAll('-','')}`;
    admin=new Pool({connectionString:databaseUrl,max:2});
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool=new Pool({connectionString:databaseUrl,max:5,options:`-c search_path=${schema},public`});
    await pool.query(fs.readFileSync(path.join(process.cwd(),'lib/db/migrations/097_shared_prompt_jobs.sql'),'utf8'));
    store=createPromptJobStore(pool);
  });
  afterAll(async()=>{
    await pool?.end();
    if(admin){await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();}
    if(originalKey===undefined)delete process.env.CLAUDE_API_KEY;else process.env.CLAUDE_API_KEY=originalKey;
  });
  beforeEach(()=>{process.env.CLAUDE_API_KEY='synthetic-unused-key';mockComplete.mockReset().mockResolvedValue(providerResponse());});
  async function trial(extra={}) {
    const requestId=randomUUID(),scope={environment:'test',authorizationScope:'synthetic:tenant',requestId};
    const snapshot=prepareContextSnapshot({scope,profile,nonceSecret,documents:[{role:'proposal',id:'fixture-doc',version:'1',extractionVersion:'fixture-v1',sha256:'a'.repeat(64),text:'DOCUMENT_CANARY applicant says the PI is Wrong.'}],records:[{name:'pi_name',present:true,value:'RECORD_CANARY Actual PI',provenance:'request:v1:pi_name'}]});
    const tasks=['executive-summary','methodology'].map(kind=>{
      const promptRow=prompt(kind);
      return {taskKey:promptRow.wmkf_ai_promptname,promptHash:sha256(canonical(promptRow)),profileHash:hashProfile(profile),model:promptRow.wmkf_ai_model,
        configuration:{promptRow,profile,scope,runSource:'Vercel Test'}};
    });
    const input={environment:'test',principalKey:'human:fixture',authorizationScope:scope.authorizationScope,requestId,idempotencyKey:randomUUID(),operation:'initialize',sourceEventId:`event:${randomUUID()}`,sourceExpiresAt:new Date(Date.now()+3600000),resultExpiresAt:new Date(Date.now()+7200000),tasks,...extra};
    const admitted=await store.admit(input);
    const fields={fixture_summary:'',fixture_methodology:''};let etag='W/"1"';
    const auditRows=new Map();
    const writer=jest.fn(async({expectedEtag,fields:patch})=>{
      if(expectedEtag!==etag)return 'conflict';Object.assign(fields,patch);etag='W/"2"';return 'applied';
    });
    const args={jobId:admitted.job.id,store,executePrompt,nonceSecret,leaseMs:60000,
      authorize:jest.fn(async()=>true),checkFreshness:jest.fn(async()=>true),prepareSnapshot:async()=>snapshot,
      readTarget:async()=>({etag,fields:Object.fromEntries(Object.entries(fields).map(([field,value])=>[field,{blank:value==='',sha256:sha256(value)}]))}),
      writer,audit:jest.fn(async({runId,payload})=>{if(auditRows.has(runId))throw new Error('duplicate audit');auditRows.set(runId,payload);})};
    const tick=(options={})=>advanceJob({...args,...options});
    const read=()=>store.readJob({jobId:args.jobId,environment:'test',principalKey:'human:fixture'});
    return {args,tick,read,input,fields,writer,auditRows,setEtag:value=>{etag=value;}};
  }
  async function until(t,stage,max=12) {
    for(let n=0;n<max;n++){const status=await t.tick();expect(JSON.stringify(status)).not.toContain('CANARY');if(status.stage===stage)return status;}
    throw new Error(`stage ${stage} not reached`);
  }
  test('two tasks share actual provider prefix, coalesce one write and survive replay/human clearing',async()=>{
    const t=await trial();await until(t,'published');
    expect(mockComplete).toHaveBeenCalledTimes(2);expect(t.writer).toHaveBeenCalledTimes(1);expect(t.auditRows.size).toBe(2);
    const calls=mockComplete.mock.calls.map(([p])=>p);
    expect(calls[0].system).toEqual(calls[1].system);expect(calls[0].messages[0].content[0]).toEqual(calls[1].messages[0].content[0]);
    expect(t.fields.fixture_summary).toContain('RESULT_CANARY');expect(t.fields.fixture_methodology).toContain('RESULT_CANARY');
    expect(JSON.stringify([...t.auditRows.values()])).not.toContain('CANARY');
    expect(JSON.stringify(await t.read())).not.toContain('CANARY');
    expect((await store.admit(t.input)).replayed).toBe(true);
    t.fields.fixture_summary='';expect((await t.tick()).stage).toBe('complete');expect(t.fields.fixture_summary).toBe('');
    await expect(store.admit({...t.input,idempotencyKey:randomUUID(),sourceEventId:'new-event'})).rejects.toThrow();
    expect(t.writer).toHaveBeenCalledTimes(1);expect(mockComplete).toHaveBeenCalledTimes(2);
  });
  test('worker loss after response checkpoint resumes canonical parser without another provider call',async()=>{
    const t=await trial();await t.tick();await t.tick();
    await expect(t.tick({store:{...store,saveValidated:async()=>{throw new Error('simulated worker loss');}}})).rejects.toThrow('worker loss');
    expect((await t.read()).tasks.filter(x=>x.state==='response_saved')).toHaveLength(1);expect(mockComplete).toHaveBeenCalledTimes(1);
    expect((await t.tick()).stage).toBe('validated');expect(mockComplete).toHaveBeenCalledTimes(1);
    await until(t,'published');expect(mockComplete).toHaveBeenCalledTimes(2);
  });
  test('unknown provider outcome blocks queued sibling and publication',async()=>{
    const t=await trial();await t.tick();await t.tick();mockComplete.mockRejectedValueOnce(new Error('timeout after dispatch'));
    expect((await t.tick()).stage).toBe('unknown');
    for(let n=0;n<3;n++)expect((await t.tick()).stage).toBe('needs_attention');
    expect(mockComplete).toHaveBeenCalledTimes(1);expect(t.writer).not.toHaveBeenCalled();
    const read=await t.read();expect(read.tasks.map(x=>x.state).sort()).toEqual(['queued','unknown']);
  });
  test('failed validation publishes only successful sibling after the barrier',async()=>{
    const t=await trial();await t.tick();await t.tick();mockComplete.mockResolvedValueOnce({...providerResponse(),stopReason:'max_tokens'});
    expect((await t.tick()).stage).toBe('failed_validation');await until(t,'published');
    expect(t.writer).toHaveBeenCalledTimes(1);expect(Object.keys(t.writer.mock.calls[0][0].fields)).toEqual(['fixture_methodology']);
    expect(t.fields.fixture_summary).toBe('');expect(mockComplete).toHaveBeenCalledTimes(2);
  });
  test.each(['conflict','unknown'])('conditional write %s retains original operation and never repeats',async(outcome)=>{
    const t=await trial();t.args.writer=jest.fn(async()=>outcome);
    await until(t,outcome);const first=await t.read();t.setEtag('W/"100"');
    expect((await t.tick()).stage).toBe('needs_attention');expect((await t.tick()).stage).toBe('needs_attention');
    const second=await t.read();expect(second.publication.id).toBe(first.publication.id);expect(second.publication.expected_etag).toBe('W/"1"');
    expect(t.args.writer).toHaveBeenCalledTimes(1);expect(mockComplete).toHaveBeenCalledTimes(2);
  });
  test('audit failure remains visible and never regenerates or publishes',async()=>{
    const t=await trial();t.args.audit=jest.fn(async()=>{throw new Error('audit transport uncertain');});
    await until(t,'audit_failed');await until(t,'needs_attention');
    const ids=t.args.audit.mock.calls.map(([arg])=>arg.runId);
    expect(ids).toHaveLength(2);expect(new Set(ids).size).toBe(2);
    expect((await t.tick()).stage).toBe('needs_attention');
    expect(t.args.audit).toHaveBeenCalledTimes(2);expect(t.writer).not.toHaveBeenCalled();expect(mockComplete).toHaveBeenCalledTimes(2);
  });
  test('source drift stops before provider and existing staff text is protected',async()=>{
    const t=await trial();t.fields.fixture_summary='Staff-written text';await t.tick();await t.tick();
    await expect(t.tick({checkFreshness:async()=>false})).rejects.toThrow('freshness denied');expect(mockComplete).not.toHaveBeenCalled();
    await until(t,'published');expect(t.fields.fixture_summary).toBe('Staff-written text');expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(Object.keys(t.writer.mock.calls[0][0].fields)).toEqual(['fixture_methodology']);
  });
});
