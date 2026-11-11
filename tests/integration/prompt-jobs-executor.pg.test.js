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
import { composeProfileTask, prepareContextSnapshot, recommendationSourceProof } from '../../lib/services/prompt-jobs/context.js';
import { createRecommendationsReader } from '../../lib/services/prompt-jobs/recommendations-reader.js';
import { EXPERTISE_RESULT_CONTRACT, EXPERTISE_TASK_KEY } from '../../lib/services/prompt-jobs/capabilities.js';
import { buildRecommendationsSnapshot, validateRecommendationsOutput } from '../../lib/services/expertise-finder/recommendations-contract.js';
import roster from '../../lib/services/expertise-finder/roster-contract.cjs';

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

function expertiseFixture({ withSourceProof = false } = {}) {
  const requestId = randomUUID();
  const scope = { environment: 'test', authorizationScope: `expertise-fixture:${randomUUID()}`, requestId };
  const owner = { ...scope, principalKey: 'app:offline-fixture' };
  const documentRoles = withSourceProof ? ['proposal', 'fixture-appendix'] : ['proposal'];
  const expertiseProfile = { ...profile, documentRoles, recordNames: ['roster_block'],
    limits: { ...profile.limits, maxDocuments: documentRoles.length, maxRecordBytes: 64_000 } };
  const profileGuid = randomUUID();
  const userGuid = randomUUID();
  const etag = 'W/"987654321"';
  const rosterProjection = { complete: true, users: [{ userGuid, disabled: false }], profiles: [{
    ...Object.fromEntries(roster.TEXT.map(key => [key, null])),
    profile_guid: profileGuid, etag, name: 'Fixture Lead', role_type: 'Research Program Staff',
    is_active: true, lead_pd_eligible: true, dataverse_user_id: userGuid, dataverse_contact_id: null,
    expertise: 'VISIBLE_ROSTER_CANARY first line\nSecond line',
  }] };
  const built = buildRecommendationsSnapshot(rosterProjection);
  const promptRow = { ...prompt('executive-summary'), wmkf_ai_promptname: EXPERTISE_TASK_KEY,
    wmkf_ai_maxtokens: 4096, wmkf_ai_promptbody: 'Recommend expertise for this proposal. {{roster_block}}',
    wmkf_ai_promptvariables: JSON.stringify({ execution: { contractVersion: 2, mode: 'shared-document-task',
      profile: { key: expertiseProfile.key, revision: expertiseProfile.revision, sha256: hashProfile(expertiseProfile) },
      resultContract: EXPERTISE_RESULT_CONTRACT, compilerVersion: 1 }, variables: [
      { name: 'proposal_context', source: { kind: 'prepared_context' }, required: true },
      { name: 'roster_block', source: { kind: 'frozen_record' }, required: true },
    ] }),
    wmkf_ai_promptoutputschema: JSON.stringify({ parseMode: 'json', outputs: [{ name: 'recommendations', target: { kind: 'none' } }] }),
  };
  const sourceDocuments = documentRoles.map(role => ({ role, id: `fabricated-${role}`, version: '1', extractionVersion: 'fixture-v1', sha256: 'a'.repeat(64) }));
  const sourceProof = recommendationSourceProof(documentRoles, sourceDocuments);
  const sourceObservation = { requestId, version: sourceProof.version, complete: true, documents: sourceDocuments };
  const snapshotArgs = { scope, profile: expertiseProfile, nonceSecret,
    documents: sourceDocuments.map(document => ({ ...document, text: 'Fabricated proposal about scientific instrumentation.' })),
    records: [built.rosterRecord], rosterSnapshot: built.snapshot,
  };
  const snapshot = prepareContextSnapshot(snapshotArgs);
  const rosterHash = built.snapshot.manifest.rosterHash;
  const configuration = { promptRow, profile: expertiseProfile, scope, runSource: 'Vercel Test', rosterHash,
    ...(withSourceProof ? { sourceProof } : {}), };
  const input = { ...owner, idempotencyKey: randomUUID(), operation: 'generate-draft',
    sourceExpiresAt: new Date(Date.now() + 60_000), resultExpiresAt: new Date(Date.now() + 120_000),
    tasks: [{ taskKey: EXPERTISE_TASK_KEY, configuration }],
  };
  const output = { proposal_summary: { title: 'Fabricated recommendation' },
    staff_assignment: { primary: { profile_guid: profileGuid }, secondary: null } };
  return { owner, input, promptRow, snapshotArgs, snapshot, built, rosterHash, etag, userGuid, output, rosterProjection, sourceObservation };
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
    expect((await t.tick({store:{...store,saveValidated:async()=>{throw new Error('simulated worker loss');}}})).stage).toBe('needs_attention');
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
  test('mismatched provider model terminates validation and allows the successful sibling',async()=>{
    const t=await trial();await t.tick();await t.tick();mockComplete.mockResolvedValueOnce({...providerResponse(),model:'claude-sonnet-4-6-x'});
    expect((await t.tick()).stage).toBe('failed_validation');await until(t,'published');
    expect(mockComplete).toHaveBeenCalledTimes(2);expect(Object.keys(t.writer.mock.calls[0][0].fields)).toEqual(['fixture_methodology']);
    expect((await t.read()).tasks.find(x=>x.task_key==='synthetic.executive-summary').error_code).toBe('profile_response_model_mismatch');
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
    await until(t,'audit_unknown');await until(t,'needs_attention');
    expect((await t.read()).attempts.every(a=>a.audit_state==='unknown')).toBe(true);
    const ids=t.args.audit.mock.calls.map(([arg])=>arg.runId);
    expect(ids).toHaveLength(2);expect(new Set(ids).size).toBe(2);
    expect((await t.tick()).stage).toBe('needs_attention');
    expect(t.args.audit).toHaveBeenCalledTimes(2);expect(t.writer).not.toHaveBeenCalled();expect(mockComplete).toHaveBeenCalledTimes(2);
  });
  test('source drift stops before provider and existing staff text is protected',async()=>{
    const denied=await trial();await denied.tick();await denied.tick();
    expect((await denied.tick({checkFreshness:async()=>false})).stage).toBe('failed_pre_dispatch');
    expect((await denied.read()).attempts).toHaveLength(0);expect(mockComplete).not.toHaveBeenCalled();
    const t=await trial();t.fields.fixture_summary='Staff-written text';await t.tick();await t.tick();
    await until(t,'published');expect(t.fields.fixture_summary).toBe('Staff-written text');expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(Object.keys(t.writer.mock.calls[0][0].fields)).toEqual(['fixture_methodology']);
  });
  test('a received provider rejection revokes its attempt and releases only its slot', async()=>{
    const t=await trial();await t.tick();await t.tick();
    mockComplete.mockRejectedValueOnce(Object.assign(new Error('Claude API error 429 after 1 attempts: synthetic rejection'),{status:429}));
    expect((await t.tick()).stage).toBe('failed_pre_dispatch');
    const rejected=await t.read();
    expect(rejected.attempts[0]).toMatchObject({state:'failed_pre_dispatch',error_code:'provider_rejected',response_content_id:null});
    expect(rejected.tasks[0].writeback_state).toBe('blocked');
    const command={...t.input,tasks:[t.input.tasks[0]],idempotencyKey:randomUUID(),sourceEventId:'new-fixture-event'};
    expect(await store.admit(command)).toMatchObject({replayed:false});
    await until(t,'published');
    expect(mockComplete).toHaveBeenCalledTimes(2);
    expect(Object.keys(t.writer.mock.calls[0][0].fields)).toEqual(['fixture_methodology']);
  });
  test('oversized encoded source terminates preparation and releases eligible slots before transport', async()=>{
    const t=await trial();
    const prepareSnapshot=jest.fn(async()=>({escaped:'\u0001'.repeat(700_000)}));
    expect((await t.tick({prepareSnapshot})).stage).toBe('failed_pre_dispatch');
    expect((await t.tick({prepareSnapshot})).stage).toBe('needs_attention');
    expect(prepareSnapshot).toHaveBeenCalledTimes(1);
    const terminal=await t.read();
    expect(terminal.job.snapshot_content_id).toBeNull();
    expect(terminal.tasks.map(task=>task.error_code)).toEqual(['snapshot_too_large','snapshot_too_large']);
    expect(terminal.attempts).toHaveLength(0);expect(mockComplete).not.toHaveBeenCalled();
    expect(await store.admit({...t.input,idempotencyKey:randomUUID(),sourceEventId:'new-fixture-event'})).toMatchObject({replayed:false});
  });
  test('oversized received response checkpoints known usage and reaches terminal validation', async()=>{
    const t=await trial();await t.tick();await t.tick();
    mockComplete.mockResolvedValueOnce(providerResponse('RESULT_CANARY ' + '\u0001'.repeat(50_000)));
    expect((await t.tick()).stage).toBe('failed_validation');
    const failed=await t.read();
    expect(failed.attempts[0]).toMatchObject({state:'failed_validation',error_code:'profile_response_too_large',usage_complete:true,usage:{output_tokens:20}});
    expect(failed.attempts[0].response_content_id).toBeTruthy();
    await until(t,'published');
    expect(Object.keys(t.writer.mock.calls[0][0].fields)).toEqual(['fixture_methodology']);
    expect(mockComplete).toHaveBeenCalledTimes(2);
  });
  async function typedTrial(fixture = expertiseFixture()) {
    const admitted = await store.admit(fixture.input);
    const jobId = admitted.job.id;
    const audit = jest.fn(async () => {});
    const writer = jest.fn(async () => { throw new Error('recommendations never publish'); });
    const args = { jobId, store, executePrompt, nonceSecret, leaseMs: 60_000,
      authorize: async () => true, checkFreshness: async () => true,
      prepareSnapshot: async () => fixture.snapshot, audit, writer,
    };
    mockComplete.mockResolvedValue(providerResponse(JSON.stringify(fixture.output)));
    return { ...fixture, jobId, audit, writer,
      read: () => store.readJob({ jobId, ...fixture.owner }),
      readResults: () => store.readValidatedRecommendations({ jobId, ...fixture.owner }),
      tick: extra => advanceJob({ ...args, ...extra }),
    };
  }

  test('expertise checkpoint resumes a structured result, with the visible roster rendered once', async () => {
    const t = await typedTrial();
    expect((await t.tick()).stage).toBe('snapshot_saved');
    const crashAfterResponse = { ...store, saveValidated: async () => { throw new Error('worker loss'); } };
    expect((await t.tick({ store: crashAfterResponse })).stage).toBe('needs_attention');
    expect((await t.read()).tasks[0].state).toBe('response_saved');
    expect((await t.readResults()).results).toEqual([]);
    expect((await t.tick()).stage).toBe('validated');
    expect(mockComplete).toHaveBeenCalledTimes(1);
    const [transport] = mockComplete.mock.calls[0];
    expect(transport.maxTokens).toBe(4096);
    const [prefix, suffix] = transport.messages[0].content;
    expect(prefix.text).not.toContain('VISIBLE_ROSTER_CANARY');
    expect(suffix.text.split(t.built.rosterBlock)).toHaveLength(2);
    expect(suffix.text).toContain('label="roster_block"');
    expect(suffix.text.match(/OUTPUT CONTRACT:/g)).toHaveLength(1);
    const outbound = JSON.stringify(transport);
    for (const privateValue of [t.etag, t.userGuid, t.rosterHash, 'candidateUsers', 'fingerprintVersion']) {
      expect(outbound).not.toContain(privateValue);
    }
    const receipt = await t.read();
    expect(receipt.tasks[0]).toMatchObject({ state: 'validated', writeback_state: 'not_requested', destination_field: null });
    expect(JSON.stringify(receipt)).not.toContain('Fixture Lead');
    const { results } = await t.readResults();
    expect(results).toEqual([expect.objectContaining({ status: 'available', taskKey: EXPERTISE_TASK_KEY,
      contractVersion: EXPERTISE_RESULT_CONTRACT, result: expect.objectContaining({
        staff_assignment: { primary: expect.objectContaining({ name: 'Fixture Lead' }), secondary: null },
      }),
    })]);
    expect((await store.readValidatedResults({ jobId: t.jobId, ...t.owner })).results).toEqual([]);
    for (const other of [{ requestId: randomUUID() }, { authorizationScope: `expertise-fixture:${randomUUID()}` },
      { environment: 'preview-sandbox' }, { principalKey: 'app:foreign' }]) {
      expect(await store.readValidatedRecommendations({ jobId: t.jobId, ...t.owner, ...other })).toBeNull();
    }
    expect((await t.tick()).stage).toBe('audit_delivered');
    expect(JSON.stringify(t.audit.mock.calls[0][0].payload)).not.toMatch(/Fixture Lead|VISIBLE_ROSTER_CANARY|rosterHash/);
    expect((await t.tick()).stage).toBe('complete');
    expect(t.writer).not.toHaveBeenCalled();
  });

  test('expertise rejects unknown nested model keys after checkpointing', async () => {
    const t = await typedTrial();
    mockComplete.mockResolvedValue(providerResponse(JSON.stringify({ ...t.output,
      staff_assignment: { ...t.output.staff_assignment, primary: { ...t.output.staff_assignment.primary, name: 'Spoofed name' } },
    })));
    await t.tick();
    expect((await t.tick()).stage).toBe('failed_validation');
    const failed = await t.read();
    expect(failed.attempts[0]).toMatchObject({ state: 'failed_validation', error_code: 'profile_output_invalid' });
    expect(failed.attempts[0].response_content_id).toBeTruthy();
    expect((await t.readResults()).results).toEqual([]);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  test('expertise admission, resolved cap and sealed roster mismatch fail before transport', async () => {
    const f = expertiseFixture();
    const [task] = f.input.tasks;
    for (const patch of [{ environment: 'preview-sandbox' }, { authorizationScope: 'synthetic:tenant' },
      { operation: 'initialize', sourceEventId: 'fixture-event' },
      { tasks: [task, { ...task, taskKey: 'synthetic.executive-summary' }] }]) {
      await expect(store.admit({ ...f.input, ...patch })).rejects.toMatchObject({ code: 'invalid_prompt_job_admission' });
    }
    const highPrompt = { ...f.promptRow, wmkf_ai_maxtokens: 4097 };
    await expect(store.admit({ ...f.input, tasks: [{ ...task, configuration: { ...task.configuration, promptRow: highPrompt } }] }))
      .rejects.toMatchObject({ code: 'invalid_prompt_job_configuration' });
    await expect(store.admit({ ...f.input, tasks: [{ ...task, configuration: { ...task.configuration, rosterSnapshot: f.built.snapshot } }] }))
      .rejects.toMatchObject({ code: 'invalid_prompt_job_configuration' });
    const onDispatch = jest.fn(), onResponse = jest.fn();
    const options = { promptName: EXPERTISE_TASK_KEY, requestId: f.owner.requestId, promptSnapshot: f.promptRow,
      runSource: 'Vercel Test', requireNoPersistence: true, auditMode: 'deferred', auditRetention: 'content-free', onDispatch, onResponse,
      profiledContext: { profile: task.configuration.profile, scope: task.configuration.scope, snapshot: f.snapshot, nonceSecret, rosterHash: f.rosterHash },
    };
    await expect(executePrompt({ promptName: EXPERTISE_TASK_KEY, runSource: 'Vercel Test' })).rejects.toThrow(/frozen fixture/);
    await expect(executePrompt({ ...options, maxTokensOverride: 4097 })).rejects.toThrow(/output token budget/);
    expect(() => prepareContextSnapshot({ ...f.snapshotArgs, profile: { ...task.configuration.profile,
      limits: { ...task.configuration.profile.limits, maxRecordBytes: 80 },
    } })).toThrow(expect.objectContaining({ code: 'snapshot_too_large' }));
    await expect(executePrompt({ ...options, profiledContext: { ...options.profiledContext, rosterHash: 'b'.repeat(64) } }))
      .rejects.toThrow(/roster fingerprint/);
    expect(() => prepareContextSnapshot({ ...f.snapshotArgs, records: [{ ...f.built.rosterRecord, value: 'Changed visible roster' }] }))
      .toThrow(/visible roster differs/);
    const altered = { ...f.snapshot, rosterSnapshot: { ...f.built.snapshot, rows: [] } };
    await expect(executePrompt({ ...options, profiledContext: { ...options.profiledContext, snapshot: altered } })).rejects.toThrow();
    const badOutputSchema = { ...f.promptRow, wmkf_ai_promptoutputschema: JSON.stringify({
      ...JSON.parse(f.promptRow.wmkf_ai_promptoutputschema), validationSchema: { type: 'object', fields: {} },
    }) };
    await expect(executePrompt({ ...options, promptSnapshot: badOutputSchema })).rejects.toThrow(/unexpected field validationSchema/);
    expect(onDispatch).not.toHaveBeenCalled();
    expect(onResponse).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  test('expertise store rejects a different frozen roster or v1 snapshot without transport', async () => {
    const t = await typedTrial();
    const other = expertiseFixture();
    const changedRoster = prepareContextSnapshot({ ...other.snapshotArgs, scope: t.snapshotArgs.scope });
    const oldSeal = await typedTrial();
    const v1 = prepareContextSnapshot({ ...oldSeal.snapshotArgs, rosterSnapshot: undefined });
    for (const [job, snapshot] of [[t, changedRoster], [oldSeal, v1]]) {
      expect((await job.tick({ prepareSnapshot: async () => snapshot })).stage).toBe('failed_pre_dispatch');
      const receipt = await job.read();
      expect(receipt.job.snapshot_content_id).toBeNull();
      expect(receipt.tasks[0]).toMatchObject({ state: 'failed_pre_dispatch', error_code: 'invalid_prompt_job_snapshot' });
    }
    const metadata = JSON.parse(t.promptRow.wmkf_ai_promptvariables);
    const { profile: pin, mode } = metadata.execution;
    const textPrompt = { ...prompt('executive-summary'), wmkf_ai_promptbody: t.promptRow.wmkf_ai_promptbody,
      wmkf_ai_promptvariables: JSON.stringify({ ...metadata, execution: { contractVersion: 1, profile: pin, mode } }),
    };
    expect(() => composeProfileTask({ ...t.snapshotArgs, promptRow: textPrompt, snapshot: t.snapshot }))
      .toThrow('snapshot version does not match task contract');
    expect(mockComplete).not.toHaveBeenCalled();
  });

  test('an invalid snapshot for a v1 job still throws without terminalizing queued tasks', async () => {
    const t = await trial();
    await expect(t.tick({ prepareSnapshot: async () => ({ scope: {}, profileHash: 'b'.repeat(64) }) }))
      .rejects.toMatchObject({ code: 'invalid_prompt_job_snapshot' });
    expect((await t.read()).tasks.map(task => task.state)).toEqual(['queued', 'queued']);
    expect((await t.tick()).stage).toBe('snapshot_saved');
    expect(mockComplete).not.toHaveBeenCalled();
  });

  async function replacePayload(id, value) {
    const payload = canonical(value), hash = sha256(payload);
    await pool.query('UPDATE prompt_job_content SET payload=$2, sha256=$3, size_bytes=$4 WHERE id=$1',
      [id, payload, hash, Buffer.byteLength(payload)]);
    return hash;
  }

  test('typed result commit and scoped reads enforce kind, version and encoded bytes', async () => {
    const t = await typedTrial();
    await t.tick();
    await t.tick({ store: { ...store, saveValidated: async () => { throw new Error('worker loss'); } } });
    const claim = await store.claim({ jobId: t.jobId, leaseMs: 60_000 });
    const { tasks: [task], attempts: [attempt] } = claim;
    try {
      const save = result => store.saveValidated({ jobId: t.jobId, leaseToken: claim.leaseToken,
        taskId: task.id, attemptId: attempt.id, result, deferredAudit: {},
      });
      await expect(save('legacy prose')).rejects.toMatchObject({ code: 'invalid_prompt_job_result' });
      const normalized = validateRecommendationsOutput(t.output, t.built);
      await expect(save({ contractVersion: 'unreviewed', result: normalized })).rejects.toMatchObject({ code: 'invalid_prompt_job_result' });
      for (const result of [[normalized], { arbitrary: 'value' }, { ...normalized, staff_assignment: [] }]) {
        await expect(save({ contractVersion: EXPERTISE_RESULT_CONTRACT, result })).rejects.toMatchObject({ code: 'invalid_prompt_job_result' });
      }
      await expect(save({ contractVersion: EXPERTISE_RESULT_CONTRACT,
        result: { ...normalized, roster_warnings: ['\u0001'.repeat(24_000)] },
      })).rejects.toMatchObject({ code: 'invalid_prompt_job_content' });
    } finally {
      await store.releaseClaim({ jobId: t.jobId, leaseToken: claim.leaseToken });
    }
    expect((await t.readResults()).results).toEqual([]);
    expect((await t.tick()).stage).toBe('validated');
    const { tasks: [saved] } = await t.read();
    await pool.query("UPDATE prompt_job_content SET kind='response' WHERE id=$1", [saved.result_content_id]);
    await expect(t.readResults()).rejects.toMatchObject({ code: 'prompt_job_content_integrity' });
    await pool.query("UPDATE prompt_job_content SET kind='result' WHERE id=$1", [saved.result_content_id]);
    for (const bad of [{ contractVersion: 'unreviewed', result: t.output },
      { contractVersion: EXPERTISE_RESULT_CONTRACT, result: { arbitrary: 'shape' } }]) {
      const hash = await replacePayload(saved.result_content_id, bad);
      await pool.query('UPDATE prompt_job_tasks SET result_hash=$2 WHERE id=$1', [saved.id, hash]);
      await expect(t.readResults()).rejects.toMatchObject({ code: 'prompt_job_content_integrity' });
    }
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  test.each([['version', 1], ['binding', 'b'.repeat(64)]])('a mismatched checkpoint %s cannot replay a typed result', async (field, value) => {
    const t = await typedTrial();
    await t.tick();
    const crashingStore = { ...store, saveValidated: async () => { throw new Error('worker loss'); } };
    await t.tick({ store: crashingStore });
    const { attempts: [attempt] } = await t.read();
    const { rows: [content] } = await pool.query('SELECT payload FROM prompt_job_content WHERE id=$1', [attempt.response_content_id]);
    const saved = JSON.parse(content.payload);
    expect(saved.version).toBe(2);
    const hash = await replacePayload(attempt.response_content_id, { ...saved, [field]: value });
    await pool.query('UPDATE prompt_job_attempts SET response_hash=$2 WHERE id=$1', [attempt.id, hash]);
    expect((await t.tick()).stage).toBe('failed_validation');
    expect((await t.read()).attempts[0].error_code).toBe('profile_checkpoint_mismatch');
    expect((await t.tick()).stage).toBe('audit_delivered');
    expect(t.audit.mock.calls[0][0].payload.wmkf_ai_notes).toContain('code=profile_checkpoint_mismatch');
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  test('expired typed source blocks checkpoint recovery and does not erase validated results', async () => {
    const validated = await typedTrial();
    await validated.tick();
    await validated.tick();
    const recovering = await typedTrial();
    await recovering.tick();
    await recovering.tick({ store: { ...store, saveValidated: async () => { throw new Error('worker loss'); } } });
    for (const t of [validated, recovering]) {
      await pool.query("UPDATE prompt_job_content SET expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1 AND kind IN ('snapshot','response')", [t.jobId]);
      expect(await store.expireContent({ scope: t.owner })).toBe(2);
    }
    expect((await recovering.tick()).stage).toBe('expired');
    expect((await recovering.readResults()).results).toEqual([]);
    expect((await validated.readResults()).results[0].status).toBe('available');
    expect(mockComplete).toHaveBeenCalledTimes(2);
    const { rows: [configuration] } = await pool.query("SELECT payload FROM prompt_job_content WHERE job_id=$1 AND kind='configuration'", [validated.jobId]);
    expect(JSON.parse(configuration.payload).rosterHash).toBe(validated.rosterHash);
    expect(configuration.payload).not.toMatch(/Fixture Lead|VISIBLE_ROSTER_CANARY|candidateUsers/);
    await pool.query("UPDATE prompt_job_content SET expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1 AND kind='result'", [validated.jobId]);
    expect((await validated.readResults()).results[0]).toEqual(expect.objectContaining({ status: 'expired' }));
    expect((await validated.readResults()).results[0]).not.toHaveProperty('result');
    expect((await store.admit(validated.input)).replayed).toBe(true);
  });

  test('structured content cannot leak through a fixture text publication', async () => {
    const t = await trial();
    for (const stage of ['snapshot_saved', 'target_captured', 'validated', 'validated', 'audit_delivered', 'audit_delivered']) {
      expect((await t.tick()).stage).toBe(stage);
    }
    const { tasks: [task] } = await t.read();
    const hash = await replacePayload(task.result_content_id, { contractVersion: EXPERTISE_RESULT_CONTRACT, result: { fixture: 'malformed' } });
    await pool.query('UPDATE prompt_job_tasks SET result_hash=$2 WHERE id=$1', [task.id, hash]);
    const claim = await store.claim({ jobId: t.args.jobId, leaseMs: 60_000 });
    try {
      await expect(store.freezePublication({ jobId: t.args.jobId, leaseToken: claim.leaseToken })).rejects.toMatchObject({ code: 'prompt_job_content_integrity' });
    } finally {
      await store.releaseClaim({ jobId: t.args.jobId, leaseToken: claim.leaseToken });
    }
    expect(t.writer).not.toHaveBeenCalled();
  });

  function resultReader(t, overrides = {}) {
    const subject = { profileId: 7, systemUserId: randomUUID() };
    const { environment, principalKey, authorizationScope } = t.owner;
    const owner = { environment, principalKey, authorizationScope };
    const query = { requestId: t.owner.requestId, jobId: t.jobId };
    const deps = { store, authorizeStaffRead: jest.fn(async () => subject), resolveJobOwner: jest.fn(async () => owner),
      readSourceObservation: jest.fn(async () => t.sourceObservation), readRosterProjection: jest.fn(async () => t.rosterProjection), ...overrides };
    return { ...createRecommendationsReader(deps), deps, subject, owner, query };
  }

  async function readyRecommendation() {
    const t = await typedTrial(expertiseFixture({ withSourceProof: true }));
    expect((await t.tick()).stage).toBe('snapshot_saved');
    expect((await t.tick()).stage).toBe('validated');
    return t;
  }

  test('staff result has exact current DTO after source cleanup, while status reads SQL metadata only', async () => {
    const t = await readyRecommendation();
    const sql = [];
    const recordingStore = createPromptJobStore({ connect: async () => {
      const client = await pool.connect();
      return { query: (statement, ...args) => { sql.push(statement); return client.query(statement, ...args); }, release: () => client.release() };
    } });
    const reader = resultReader(t, { store: recordingStore });
    const before = await t.read();
    const status = await reader.readStatus({ requestId: ` ${reader.query.requestId.toUpperCase()} `, jobId: reader.query.jobId.toUpperCase() });
    expect(status).toEqual({ jobId: t.jobId, requestId: t.owner.requestId, taskKey: EXPERTISE_TASK_KEY,
      contractVersion: EXPERTISE_RESULT_CONTRACT, expiresAt: before.job.result_expires_at.toISOString(), state: 'validated' });
    expect(sql.some(statement => /FROM prompt_jobs/.test(statement))).toBe(true);
    expect(sql.some(statement => /payload/.test(statement))).toBe(false);
    expect(reader.deps.readSourceObservation).not.toHaveBeenCalled();
    expect(reader.deps.readRosterProjection).not.toHaveBeenCalled();
    await pool.query("UPDATE prompt_job_content SET expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1 AND kind IN ('snapshot','response')", [t.jobId]);
    expect(await store.expireContent({ scope: t.owner })).toBe(2);
    reader.deps.readSourceObservation.mockResolvedValue({ ...t.sourceObservation, documents: [...t.sourceObservation.documents].reverse() });
    const { state, ...base } = status;
    expect(await reader.readResult(reader.query)).toEqual({ ...base, status: 'available', freshness: 'current', result: validateRecommendationsOutput(t.output, t.built) });
    expect(reader.deps.readSourceObservation).toHaveBeenCalledWith({ requestId: t.owner.requestId, version: t.sourceObservation.version });
    expect(reader.deps.readRosterProjection).toHaveBeenCalledWith({ requestId: t.owner.requestId });
    expect((await t.read()).job.version).toBe(before.job.version);
  });

  test('staff result suppresses changed or incomplete source and roster, with unknown taking precedence', async () => {
    const t = await readyRecommendation();
    const reader = resultReader(t);
    const sourceChanged = { ...t.sourceObservation, documents: t.sourceObservation.documents.map((d, index) => index ? d : { ...d, version: '2' }) };
    const rosterChanged = { ...t.rosterProjection, users: [{ userGuid: t.userGuid, disabled: true }] };
    const cases = [
      [sourceChanged, t.rosterProjection, 'stale'],
      [t.sourceObservation, rosterChanged, 'stale'],
      [sourceChanged, { ...t.rosterProjection, complete: false }, 'unknown'],
      [{ ...t.sourceObservation, documents: [...t.sourceObservation.documents, { ...t.sourceObservation.documents[0], role: 'unapproved' }] }, rosterChanged, 'unknown'],
      [{ ...t.sourceObservation, requestId: randomUUID() }, t.rosterProjection, 'unknown'],
      [{ ...t.sourceObservation, documents: t.sourceObservation.documents.map(d => ({ ...d, sha256: `${d.sha256}\n` })) }, t.rosterProjection, 'unknown'],
      [{ ...t.sourceObservation, version: 'unreviewed' }, t.rosterProjection, 'unknown'],
    ];
    for (const [source, rosterValue, freshness] of cases) {
      reader.deps.readSourceObservation.mockResolvedValueOnce(source);
      reader.deps.readRosterProjection.mockResolvedValueOnce(rosterValue);
      const value = await reader.readResult(reader.query);
      expect(value).toMatchObject({ status: 'unavailable', freshness });
      expect(value).not.toHaveProperty('result');
      expect(JSON.stringify(value)).not.toMatch(/fixture-appendix|VISIBLE_ROSTER_CANARY|rosterHash/);
    }
  });

  test('staff and machine ownership gates deny without revealing whether the job exists', async () => {
    const t = await readyRecommendation();
    const reader = resultReader(t);
    reader.deps.authorizeStaffRead.mockResolvedValueOnce(null);
    expect(await reader.readResult(reader.query)).toBeNull();
    expect(reader.deps.resolveJobOwner).not.toHaveBeenCalled();
    expect(await reader.readResult({ ...reader.query, actor: reader.subject })).toBeNull();
    expect(await reader.readResult({ ...reader.query, principalKey: t.owner.principalKey })).toBeNull();
    expect(await reader.readResult({ ...reader.query, requestId: randomUUID() })).toBeNull();
    expect(await reader.readResult({ ...reader.query, jobId: randomUUID() })).toBeNull();
    reader.deps.resolveJobOwner.mockResolvedValueOnce(reader.owner)
      .mockResolvedValueOnce({ ...reader.owner, principalKey: 'app:rebound' });
    expect(await reader.readStatus(reader.query)).toBeNull();
    for (const owner of [null, { ...reader.owner, principalKey: 'app:foreign' }, { ...reader.owner, environment: 'preview-sandbox' },
      { ...reader.owner, authorizationScope: `expertise-fixture:${randomUUID()}` }, { ...reader.owner, principalKey: 'profile:7' },
      { ...reader.owner, authorizationScope: 123 }, { ...reader.owner, principalKey: 'app:offline-fixture\n' },
      { ...reader.owner, authorizationScope: `${reader.owner.authorizationScope} ` }, { ...reader.owner, requestId: t.owner.requestId }]) {
      reader.deps.resolveJobOwner.mockResolvedValueOnce(owner);
      expect(await reader.readResult(reader.query)).toBeNull();
    }
    expect(reader.deps.readSourceObservation).not.toHaveBeenCalled();
    const staffFixture = expertiseFixture({ withSourceProof: true });
    const staffOwner = { ...staffFixture.owner, principalKey: 'profile:7' };
    const staffJob = await typedTrial({ ...staffFixture, owner: staffOwner, input: { ...staffFixture.input, ...staffOwner } });
    expect(await store.readRecommendationState({ ...staffOwner, jobId: staffJob.jobId })).toBeNull();
    await pool.query("UPDATE prompt_jobs SET operation='initialize', source_event_id='fabricated' WHERE id=$1", [t.jobId]);
    expect(await reader.readResult(reader.query)).toBeNull();
  });

  test('authorized result rejects revocation and actor substitution during asynchronous reads', async () => {
    const t = await readyRecommendation();
    const reader = resultReader(t);
    let resume, entered;
    const observed = new Promise(resolve => { entered = resolve; });
    reader.deps.readSourceObservation.mockImplementationOnce(async () => {
      entered();
      return new Promise(resolve => { resume = resolve; });
    });
    const pending = reader.readResult(reader.query);
    await observed;
    reader.deps.authorizeStaffRead.mockResolvedValueOnce(null);
    resume(t.sourceObservation);
    expect(await pending).toBeNull();
    reader.deps.authorizeStaffRead.mockResolvedValueOnce(reader.subject).mockResolvedValueOnce({ ...reader.subject, systemUserId: randomUUID() });
    expect(await reader.readResult(reader.query)).toBeNull();
    reader.deps.authorizeStaffRead.mockResolvedValueOnce(reader.subject).mockResolvedValueOnce(null);
    expect(await reader.readStatus(reader.query)).toBeNull();
  });

  test('result fences owner rebinding on unavailable paths and receipt version changes before payload', async () => {
    const t = await readyRecommendation();
    const reboundOwner = { environment: t.owner.environment, principalKey: 'app:rebound', authorizationScope: t.owner.authorizationScope };
    let rebound = false;
    const original = resultReader(t);
    const changedStore = { ...store, readRecommendationState: async (scope, options) => {
      const receipt = await store.readRecommendationState(scope, options);
      if (!options.includeProof) rebound = true;
      return receipt;
    } };
    const reader = resultReader(t, { store: changedStore,
      resolveJobOwner: async () => rebound ? reboundOwner : original.owner,
      readSourceObservation: async () => ({ ...t.sourceObservation, complete: false }),
    });
    expect(await reader.readResult(reader.query)).toBeNull();
    const valueRead = jest.fn(store.readValidatedRecommendations);
    const versionReader = resultReader(t, { store: { ...store, readValidatedRecommendations: valueRead },
      readSourceObservation: async () => { expect((await t.tick()).stage).toBe('audit_delivered'); return t.sourceObservation; },
    });
    expect(await versionReader.readResult(versionReader.query)).toMatchObject({ status: 'unavailable', freshness: 'unknown' });
    expect(valueRead).not.toHaveBeenCalled();
  });

  test('status mapping handles no result, task expiry and the audit states independently', async () => {
    const t = await typedTrial(expertiseFixture({ withSourceProof: true }));
    const reader = resultReader(t);
    expect(await reader.readResult(reader.query)).toMatchObject({ status: 'not-ready', freshness: 'unknown' });
    expect(reader.deps.readSourceObservation).not.toHaveBeenCalled();
    await t.tick();
    const { tasks: [task] } = await t.read();
    await pool.query("UPDATE prompt_job_tasks SET state='expired' WHERE id=$1", [task.id]);
    expect(await reader.readResult(reader.query)).toMatchObject({ status: 'unavailable', freshness: 'unknown' });
    expect(reader.deps.readSourceObservation).not.toHaveBeenCalled();
    const validated = await readyRecommendation();
    const available = resultReader(validated);
    const { attempts: [attempt] } = await validated.read();
    for (const state of ['pending', 'dispatching', 'failed', 'unknown', 'delivered']) {
      await pool.query('UPDATE prompt_job_attempts SET audit_state=$2 WHERE id=$1', [attempt.id, state]);
      expect(await available.readResult(available.query)).toMatchObject({ status: 'available', freshness: 'current' });
    }
  });

  test('clock skew, payload deletion and corrupt result cannot expose content', async () => {
    const t = await readyRecommendation();
    await pool.query("UPDATE prompt_job_content SET expires_at=clock_timestamp()+interval '5 seconds' WHERE job_id=$1 AND kind='configuration'", [t.jobId]);
    let monotonic = 100;
    const skewed = resultReader(t, { now: () => monotonic });
    expect(await skewed.readResult(skewed.query)).toMatchObject({ status: 'available', freshness: 'current' });
    skewed.deps.authorizeStaffRead.mockResolvedValueOnce(skewed.subject).mockImplementationOnce(async () => {
      monotonic += 6_000;
      return skewed.subject;
    });
    expect(await skewed.readResult(skewed.query)).toMatchObject({ status: 'expired', freshness: 'unknown' });
    const corrupt = await readyRecommendation();
    const { tasks: [task] } = await corrupt.read();
    await pool.query("UPDATE prompt_job_content SET payload='{}', size_bytes=2 WHERE id=$1", [task.result_content_id]);
    const bad = resultReader(corrupt);
    expect(await bad.readResult(bad.query)).toEqual(expect.objectContaining({ status: 'unavailable', freshness: 'unknown' }));
    const deletion = { ...store, readValidatedRecommendations: async scope => {
      await pool.query("UPDATE prompt_job_content SET expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1 AND kind='result'", [t.jobId]);
      expect(await store.expireContent({ scope: t.owner })).toBe(1);
      return store.readValidatedRecommendations(scope);
    } };
    const reader = resultReader(t, { store: deletion });
    const gone = await reader.readResult(reader.query);
    expect(gone).toMatchObject({ status: 'expired', freshness: 'unknown' });
    expect(gone).not.toHaveProperty('result');
  });

  test('legacy fixture without proof stays unknown and replay retains the original source proof', async () => {
    const older = await typedTrial();
    await older.tick();
    await older.tick();
    const unknown = resultReader(older);
    expect(await unknown.readResult(unknown.query)).toMatchObject({ status: 'unavailable', freshness: 'unknown' });
    expect(unknown.deps.readSourceObservation).not.toHaveBeenCalled();
    const t = await readyRecommendation();
    const [task] = t.input.tasks;
    const documents = t.sourceObservation.documents.map(d => ({ ...d, version: '2' }));
    const sourceProof = recommendationSourceProof(task.configuration.profile.documentRoles, documents);
    expect((await store.admit({ ...t.input, tasks: [{ ...task, configuration: { ...task.configuration, sourceProof } }] })).replayed).toBe(true);
    const reader = resultReader(t);
    reader.deps.readSourceObservation.mockResolvedValueOnce({ ...t.sourceObservation, documents });
    expect(await reader.readResult(reader.query)).toMatchObject({ status: 'unavailable', freshness: 'stale' });
    expect(await reader.readResult(reader.query)).toMatchObject({ status: 'available', freshness: 'current' });
    const conflicting = expertiseFixture({ withSourceProof: true });
    const [changed] = conflicting.input.tasks;
    changed.configuration.sourceProof = sourceProof;
    const mismatch = await typedTrial(conflicting);
    expect((await mismatch.tick()).stage).toBe('failed_pre_dispatch');
    expect((await mismatch.read()).tasks[0].error_code).toBe('invalid_prompt_job_snapshot');
  });

});
