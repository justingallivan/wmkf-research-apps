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
const mockNativeSchemaOverride = jest.fn();
jest.mock('../../lib/services/llm-client.js', () => ({
  DEFAULT_TIMEOUT_MS:120000,LLMClient:jest.fn().mockImplementation(()=>({complete:mockComplete})),
}));
jest.mock('../../lib/services/expertise-finder/recommendations-output-schema.js', () => ({
  buildRecommendationsOutputSchema: args => {
    const schema = jest.requireActual('../../lib/services/expertise-finder/recommendations-output-schema.js')
      .buildRecommendationsOutputSchema(args);
    return mockNativeSchemaOverride(schema);
  },
}));
jest.mock('../../lib/dataverse/adapters/grant-request.js',()=>({getById:jest.fn(()=>{throw new Error('live read forbidden');}),updateById:jest.fn(()=>{throw new Error('live write forbidden');})}));
jest.mock('../../lib/dataverse/adapters/ai-run.js',()=>({create:jest.fn(()=>{throw new Error('live audit forbidden');})}));
import { LLMClient } from '../../lib/services/llm-client.js';
import { executePrompt } from '../../lib/services/execute-prompt.js';
import { createPromptJobStore } from '../../lib/services/prompt-jobs/store.js';
import { advanceJob } from '../../lib/services/prompt-jobs/worker.js';
import { canonical, hashProfile, parseExecutionSpec, sha256 } from '../../lib/services/prompt-jobs/profile.js';
import { composeProfileTask, effectiveProviderOutputSchema, prepareContextSnapshot, recommendationSourceProof, sandboxRecommendationSourceProof } from '../../lib/services/prompt-jobs/context.js';
import { createRecommendationsReader } from '../../lib/services/prompt-jobs/recommendations-reader.js';
import { readStaffRecommendation } from '../../lib/services/prompt-jobs/staff-recommendations-service.js';
import { readRecommendationsAccessPolicy, readRecommendationsTrialPolicy, RECOMMENDATIONS_SANDBOX_ORIGIN, RECOMMENDATIONS_TRIAL_PREDECESSOR_JOB_ID, RECOMMENDATIONS_TRIAL_SECOND_JOB_ID } from '../../lib/services/prompt-jobs/recommendations-sandbox-policy.js';
import { admitSandboxRecommendationTrial, advanceSandboxRecommendationTrial, preflightSandboxRecommendationTrial } from '../../lib/services/prompt-jobs/sandbox-recommendations-trial.js';
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

function expertiseFixture({ withSourceProof = false, compilerVersion = 1, stable = false, roles = [], model, documentLimit } = {}) {
  const id = stable ? n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` : () => randomUUID();
  const requestId = id(1);
  const scope = { environment: 'test', authorizationScope: `expertise-fixture:${id(2)}`, requestId };
  const owner = { ...scope, principalKey: 'app:offline-fixture' };
  const documentRoles = withSourceProof ? ['proposal', 'fixture-appendix'] : ['proposal'];
  const expertiseProfile = { ...profile, documentRoles, recordNames: ['roster_block'],
    limits: { ...profile.limits, maxDocuments: documentRoles.length, maxRecordBytes: 64_000,
      ...(documentLimit ? { maxDocumentBytes: documentLimit, maxTotalDocumentBytes: documentLimit } : {}) } };
  const profileGuid = id(3);
  const userGuid = id(4);
  const etag = 'W/"987654321"';
  const rosterProjection = { complete: true, users: [{ userGuid, disabled: false }], profiles: [{
    ...Object.fromEntries(roster.TEXT.map(key => [key, null])),
    profile_guid: profileGuid, etag, name: 'Fixture Lead', role_type: 'Research Program Staff',
    is_active: true, lead_pd_eligible: true, dataverse_user_id: userGuid, dataverse_contact_id: null,
    expertise: 'VISIBLE_ROSTER_CANARY first line\nSecond line',
  }, ...roles.map((role, i) => ({
    ...Object.fromEntries(roster.TEXT.map(key => [key, null])),
    profile_guid: id(6 + i), etag, name: `Fixture ${role}`, role_type: role, is_active: true,
    lead_pd_eligible: false, dataverse_user_id: null, dataverse_contact_id: null,
  }))] };
  const built = buildRecommendationsSnapshot(rosterProjection);
  const promptRow = { ...prompt('executive-summary'), wmkf_ai_promptid: id(5), wmkf_ai_promptname: EXPERTISE_TASK_KEY,
    ...(model ? { wmkf_ai_model: model } : {}), wmkf_ai_maxtokens: 4096, wmkf_ai_promptbody: 'Recommend expertise for this proposal. {{roster_block}}',
    wmkf_ai_promptvariables: JSON.stringify({ execution: { contractVersion: 2, mode: 'shared-document-task',
      profile: { key: expertiseProfile.key, revision: expertiseProfile.revision, sha256: hashProfile(expertiseProfile) },
      resultContract: EXPERTISE_RESULT_CONTRACT, compilerVersion }, variables: [
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

function fixtureExecution(f) {
  const { profile: definition, scope } = f.snapshotArgs;
  return {
    promptName: EXPERTISE_TASK_KEY, requestId: f.owner.requestId, promptSnapshot: f.promptRow,
    runSource: 'Vercel Test', requireNoPersistence: true, auditMode: 'deferred', auditRetention: 'content-free',
    profiledContext: { profile: definition, scope, snapshot: f.snapshot, nonceSecret, rosterHash: f.rosterHash },
    onDispatch: jest.fn(), onResponse: jest.fn(),
  };
}

function mockProviderWire(output) {
  const actual = jest.requireActual('../../lib/services/llm-client.js');
  LLMClient.mockImplementationOnce(options => new actual.LLMClient(options));
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(options.method).toBe('POST');
    return new Response(JSON.stringify({
      model: 'claude-sonnet-4-6', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(output) }],
      usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 80, cache_read_input_tokens: 0 },
    }), { status: 200 });
  });
}

function nativeFixtureOutput(fixture) {
  return {
    proposal_summary: {}, staff_assignment: {
      primary: { ...fixture.output.staff_assignment.primary, rationale: 'Fabricated central claim match.' }, secondary: null,
    },
    staff_consultation: [],
    ...(fixture.rosterProjection.profiles.some(row => row.role_type === 'Consultant') ? { consultant_overlap: [] } : {}),
    ...(fixture.rosterProjection.profiles.some(row => row.role_type === 'Board') ? { board_interest: [] } : {}),
    expertise_gaps: { has_gaps: false, description: null }, conflicts: [],
  };
}

beforeEach(() => { mockNativeSchemaOverride.mockReset().mockImplementation(schema => schema); });

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

  async function savedCheckpoint(trial) {
    const { attempts: [attempt] } = await trial.read();
    const { rows: [content] } = await pool.query('SELECT payload FROM prompt_job_content WHERE id=$1', [attempt.response_content_id]);
    return JSON.parse(content.payload);
  }

  test('compiler 1 preserves the pre-native composed bytes, actual wire body and checkpoint binding', async () => {
    const t = await typedTrial(expertiseFixture({ stable: true }));
    const { system, body, userContent, prefixHash } = composeProfileTask({ ...t.snapshotArgs, snapshot: t.snapshot, promptRow: t.promptRow });
    expect(sha256(canonical({ system, body, userContent, prefixHash }))).toBe('3d33d9440a506aaa9731974b4f43525b192ae673e83f938a793a6682b1b6d08c');
    const wire = mockProviderWire(t.output);
    try {
      expect((await t.tick()).stage).toBe('snapshot_saved');
      expect((await t.tick({ store: { ...store, saveValidated: async () => { throw new Error('worker loss'); } } })).stage).toBe('needs_attention');
      expect(wire).toHaveBeenCalledTimes(1);
      const request = wire.mock.calls[0][1].body;
      expect(sha256(request)).toBe('323b4dde8768d91a0d31410668b7d65702220de1bfd2d008695cc6f43a019ddb');
      expect(JSON.parse(request)).not.toHaveProperty('output_config');
      expect(await savedCheckpoint(t)).toMatchObject({
        version: 2, binding: 'c9814987af8200e690b92edf2a3ccebbdf08179ea3bd7320ed03b09139743b4d',
      });
      expect((await t.tick()).stage).toBe('validated');
      expect(wire).toHaveBeenCalledTimes(1);
      expect(mockComplete).not.toHaveBeenCalled();
    } finally { wire.mockRestore(); }
  });

  test('compiler 2 sends exact role-constrained wire schema and recovers the saved response without transport', async () => {
    const t = await typedTrial(expertiseFixture({ compilerVersion: 2, roles: ['Consultant', 'Board'] }));
    const compiled = composeProfileTask({ ...t.snapshotArgs, snapshot: t.snapshot, promptRow: t.promptRow });
    const providerSchema = effectiveProviderOutputSchema(compiled, parseExecutionSpec(t.promptRow));
    const wire = mockProviderWire(nativeFixtureOutput(t));
    try {
      expect((await t.tick()).stage).toBe('snapshot_saved');
      expect((await t.tick({ store: { ...store, saveValidated: async () => { throw new Error('worker loss'); } } })).stage).toBe('needs_attention');
      expect(wire).toHaveBeenCalledTimes(1);
      const request = JSON.parse(wire.mock.calls[0][1].body);
      expect(request.output_config).toEqual({ format: { type: 'json_schema', schema: providerSchema.jsonSchema } });
      const { properties } = request.output_config.format.schema;
      const leadGuid = t.output.staff_assignment.primary.profile_guid;
      const consultantGuid = t.rosterProjection.profiles.find(row => row.role_type === 'Consultant').profile_guid;
      const boardGuid = t.rosterProjection.profiles.find(row => row.role_type === 'Board').profile_guid;
      for (const slot of ['primary', 'secondary']) {
        expect(properties.staff_assignment.properties[slot].anyOf[0].properties.profile_guid.enum).toEqual([leadGuid]);
      }
      expect(properties.staff_consultation.items.properties.profile_guid.enum).toEqual([leadGuid]);
      expect(properties.consultant_overlap.items.properties.profile_guid.enum).toEqual([consultantGuid]);
      expect(properties.board_interest.items.properties.profile_guid.enum).toEqual([boardGuid]);
      expect(properties.conflicts.items.properties.profile_guid.enum).toEqual(expect.arrayContaining([leadGuid, consultantGuid, boardGuid]));
      const serialized = JSON.stringify(request.output_config);
      for (const privateValue of [t.etag, t.userGuid, t.rosterHash, 'Fixture Lead', 'VISIBLE_ROSTER_CANARY']) {
        expect(serialized).not.toContain(privateValue);
      }
      expect(await savedCheckpoint(t)).toMatchObject({
        version: 2, binding: sha256(canonical({
          promptRow: t.promptRow, snapshotIntegrity: t.snapshot.integrity, requestId: t.owner.requestId, maxTokens: 4096,
          capability: EXPERTISE_TASK_KEY, resultContract: EXPERTISE_RESULT_CONTRACT, compilerVersion: 2,
          providerSchemaHash: sha256(canonical(providerSchema)),
        })),
      });
      expect((await t.read()).tasks[0].state).toBe('response_saved');
      expect((await t.tick()).stage).toBe('validated');
      expect(wire).toHaveBeenCalledTimes(1);
      expect(mockComplete).not.toHaveBeenCalled();
      expect((await t.readResults()).results).toHaveLength(1);
    } finally { wire.mockRestore(); }
  });

  test('compiler 2 refuses a saved checkpoint if the rebuilt schema changes', async () => {
    const t = await typedTrial(expertiseFixture({ compilerVersion: 2 }));
    mockComplete.mockResolvedValue(providerResponse(JSON.stringify(nativeFixtureOutput(t))));
    expect((await t.tick()).stage).toBe('snapshot_saved');
    expect((await t.tick({ store: { ...store, saveValidated: async () => { throw new Error('worker loss'); } } })).stage).toBe('needs_attention');
    const [{ outputConfig }] = mockComplete.mock.calls[0];
    expect(outputConfig.format.schema.properties).not.toHaveProperty('consultant_overlap');
    expect(outputConfig.format.schema.properties).not.toHaveProperty('board_interest');
    mockNativeSchemaOverride.mockImplementationOnce(schema => ({ ...schema, required: [...schema.required].reverse() }));
    expect((await t.tick()).stage).toBe('failed_validation');
    expect((await t.read()).attempts[0].error_code).toBe('profile_checkpoint_mismatch');
    expect((await t.readResults()).results).toEqual([]);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['wrong role', output => {
      output.consultant_overlap = [{
        profile_guid: output.staff_assignment.primary.profile_guid, relevance: 'strong', rationale: 'Wrong category.',
      }];
    }],
    ['unknown GUID', output => {
      output.staff_assignment.secondary = { profile_guid: '00000000-0000-4000-8000-000000000099', rationale: 'Outside the frozen roster.' };
    }],
    ['metadata wrapper', output => ({ resultContract: EXPERTISE_RESULT_CONTRACT, modelOutput: output })],
    ['duplicate lead', output => { output.staff_assignment.secondary = { ...output.staff_assignment.primary }; }],
    ['oversized rationale', output => { output.staff_assignment.primary.rationale = 'x'.repeat(4001); }],
  ])('compiler 2 retains domain validation for %s after checkpointing', async (_case, mutate) => {
    const t = await typedTrial(expertiseFixture({ compilerVersion: 2, roles: ['Consultant'] }));
    const output = nativeFixtureOutput(t);
    mockComplete.mockResolvedValue(providerResponse(JSON.stringify(mutate(output) ?? output)));
    expect((await t.tick()).stage).toBe('snapshot_saved');
    expect((await t.tick()).stage).toBe('failed_validation');
    const { attempts } = await t.read();
    expect(attempts[0]).toMatchObject({ state: 'failed_validation', error_code: 'profile_output_invalid',
      response_content_id: expect.any(String) });
    expect((await t.readResults()).results).toEqual([]);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  test.each([['refusal', 'claude_output_refused'], ['max_tokens', 'claude_output_truncated']])(
    'compiler 2 retains terminal %s after checkpointing', async (stopReason, errorCode) => {
      const t = await typedTrial(expertiseFixture({ compilerVersion: 2 }));
      mockComplete.mockResolvedValue({ ...providerResponse(JSON.stringify(nativeFixtureOutput(t))), stopReason });
      expect((await t.tick()).stage).toBe('snapshot_saved');
      expect((await t.tick()).stage).toBe('failed_validation');
      const { attempts } = await t.read();
      expect(attempts[0]).toMatchObject({ state: 'failed_validation', error_code: errorCode, response_content_id: expect.any(String) });
      expect((await t.readResults()).results).toEqual([]);
      expect(mockComplete).toHaveBeenCalledTimes(1);
    },
  );

  test('unknown compiler, missing native schema and unsupported native model fail before intent', async () => {
    const unknown = expertiseFixture({ compilerVersion: 99 });
    await expect(store.admit(unknown.input)).rejects.toMatchObject({ code: 'invalid_prompt_job_configuration' });
    expect(await store.listJobs(unknown.owner)).toEqual([]);
    const native = expertiseFixture({ compilerVersion: 2 });
    const spec = parseExecutionSpec(native.promptRow);
    expect(() => effectiveProviderOutputSchema({}, spec)).toThrow(/native recommendation schema unavailable/);
    expect(() => effectiveProviderOutputSchema({}, { ...spec, compilerVersion: 99 })).toThrow(/native recommendation schema unavailable/);
    expect(effectiveProviderOutputSchema({}, { ...spec, compilerVersion: 1 })).toBe(spec.outputSchema);

    const unsupported = expertiseFixture({ compilerVersion: 2, model: 'claude-sonnet-4' });
    const cases = [
      [fixtureExecution(unknown), /recommendations contract does not match/],
      [fixtureExecution(unsupported), /does not support native structured output/],
      [fixtureExecution(native), /schema unavailable/],
    ];
    for (const [options, message] of cases) {
      if (options.promptSnapshot === native.promptRow) mockNativeSchemaOverride.mockImplementationOnce(() => null);
      await expect(executePrompt(options)).rejects.toThrow(message);
      expect(options.onDispatch).not.toHaveBeenCalled();
      expect(options.onResponse).not.toHaveBeenCalled();
    }
    expect(mockComplete).not.toHaveBeenCalled();
  });

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

  // Read-compatible fixture receipt in the disposable SQL schema. The generic
  // admission path still rejects Sandbox recommendations.
  async function sandboxReceipt() {
    const f = expertiseFixture();
    const jobId = randomUUID(), requestId = f.owner.requestId, azureId = randomUUID();
    const ids = { jobId, requestId, systemUserId: randomUUID(), applicationId: randomUUID(), scopeId: randomUUID(), profileId: 7 };
    const policy = readRecommendationsAccessPolicy({ DYNAMICS_URL: RECOMMENDATIONS_SANDBOX_ORIGIN,
      DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on', EXPERTISE_RECOMMENDATIONS_READ_ACCESS: JSON.stringify(ids) }, 'local');
    const { environment, principalKey, authorizationScope, targetHost, profileId, systemUserId } = policy;
    const scope = { environment, authorizationScope, requestId };
    const { tasks: [task] } = f.input;
    const sourceProof = sandboxRecommendationSourceProof(targetHost, task.configuration.profile.documentRoles, f.sourceObservation.documents);
    const configuration = { ...task.configuration, scope, sourceProof };
    await expect(store.admit({ ...f.input, ...scope, principalKey, tasks: [{ ...task, configuration }] }))
      .rejects.toMatchObject({ code: 'invalid_prompt_job_admission' });
    await pool.query(`INSERT INTO prompt_jobs (id,environment,principal_key,authorization_scope,request_id,idempotency_key,payload_hash,operation,source_expires_at,result_expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'generate-draft',clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 hour')`,
    [jobId, environment, principalKey, authorizationScope, requestId, randomUUID(), 'a'.repeat(64)]);
    async function content(kind, value) {
      const payload = canonical(value), hash = sha256(payload);
      const { rows: [row] } = await pool.query(`INSERT INTO prompt_job_content(job_id,kind,payload,sha256,size_bytes,expires_at)
        SELECT id,$2,$3,$4,$5,result_expires_at FROM prompt_jobs WHERE id=$1 RETURNING id`,
      [jobId, kind, payload, hash, Buffer.byteLength(payload)]);
      return { id: row.id, hash };
    }
    const cfg = await content('configuration', configuration);
    const result = validateRecommendationsOutput(f.output, f.built);
    const saved = await content('result', { contractVersion: EXPERTISE_RESULT_CONTRACT, result });
    const { rows: [row] } = await pool.query(`INSERT INTO prompt_job_tasks(job_id,task_key,prompt_hash,profile_hash,model,configuration_content_id,configuration_hash,state,writeback_state,result_content_id,result_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,'validated','not_requested',$8,$9) RETURNING id`,
    [jobId, EXPERTISE_TASK_KEY, sha256(canonical(f.promptRow)), hashProfile(configuration.profile), f.promptRow.wmkf_ai_model, cfg.id, cfg.hash, saved.id, saved.hash]);
    const access = { profileId, session: { user: { userType: 'staff', profileId, azureId, dynamicsSystemuserId: systemUserId } } };
    const deps = { store, policy: jest.fn(() => policy),
      profile: jest.fn(async () => ({ id: profileId, is_active: true, needs_linking: false, azure_id: azureId, dynamics_systemuser_id: systemUserId })),
      user: jest.fn(async () => ({ systemuserid: systemUserId, azureactivedirectoryobjectid: azureId, isdisabled: false, internalemailaddress: 'fixture@wmkeck.org' })),
      hasGrant: jest.fn(async () => true),
      observeSource: jest.fn(async () => ({ ...f.sourceObservation, version: sourceProof.version, targetHost })),
      observeRoster: jest.fn(async () => ({ targetHost, projection: f.rosterProjection })),
    };
    const input = { requestId, jobId, access };
    return { ...f, cfg, taskId: row.id, configuration, deps, policy, input, result, read: () => readStaffRecommendation(input, deps) };
  }

  test('Sandbox staff facade requires live-version retained proof and matching source and roster target', async () => {
    const t = await sandboxReceipt();
    expect(await t.read()).toMatchObject({ requestId: t.input.requestId, jobId: t.input.jobId,
      status: 'available', freshness: 'current', result: t.result });
    expect(t.deps.profile).toHaveBeenCalledTimes(2);
    expect(t.deps.user).toHaveBeenCalledTimes(2);
    expect(t.deps.hasGrant).toHaveBeenCalledTimes(2);
    expect(t.deps.observeSource).toHaveBeenCalledWith({ requestId: t.input.requestId, version: t.configuration.sourceProof.version });
    const unknown = expect.objectContaining({ status: 'unavailable', freshness: 'unknown' });
    t.deps.observeRoster.mockResolvedValueOnce({ targetHost: 'wmkf.crm.dynamics.com', projection: t.rosterProjection });
    expect(await t.read()).toEqual(unknown);
    t.deps.observeSource.mockResolvedValueOnce({ ...t.sourceObservation, version: t.configuration.sourceProof.version, targetHost: 'wmkf.crm.dynamics.com' });
    expect(await t.read()).toEqual(unknown);
    const wrongProof = recommendationSourceProof(t.configuration.profile.documentRoles, t.sourceObservation.documents);
    const hash = await replacePayload(t.cfg.id, { ...t.configuration, sourceProof: wrongProof });
    await pool.query('UPDATE prompt_job_tasks SET configuration_hash=$2 WHERE id=$1', [t.taskId, hash]);
    t.deps.observeSource.mockClear();
    const result = await t.read();
    expect(result).toEqual(unknown);
    expect(result).not.toHaveProperty('result');
    expect(t.deps.observeSource).not.toHaveBeenCalled();
  });

  test('fresh exact Sandbox staff grants and Request/job binding fail closed before evidence reads', async () => {
    const t = await sandboxReceipt();
    expect(await readStaffRecommendation({ ...t.input, requestId: randomUUID() }, t.deps)).toBeNull();
    expect(await readStaffRecommendation({ ...t.input, jobId: randomUUID() }, t.deps)).toBeNull();
    expect(await readStaffRecommendation({ ...t.input, access: { ...t.input.access, authBypassed: true } }, t.deps)).toBeNull();
    expect(t.deps.profile).not.toHaveBeenCalled();
    const profile = await t.deps.profile();
    const user = await t.deps.user();
    for (const malformed of [{ ...profile, needs_linking: true }, { ...profile, dynamics_systemuser_id: randomUUID() }, { ...profile, is_active: false }]) {
      t.deps.profile.mockResolvedValueOnce(malformed);
      expect(await t.read()).toBeNull();
    }
    for (const invalid of [{ ...user, azureactivedirectoryobjectid: randomUUID() }, { ...user, isdisabled: true }, { ...user, isdisabled: undefined }]) {
      t.deps.user.mockResolvedValueOnce(invalid);
      expect(await t.read()).toBeNull();
    }
    t.deps.hasGrant.mockResolvedValueOnce(false);
    expect(await t.read()).toBeNull();
    expect(t.deps.observeSource).not.toHaveBeenCalled();
    expect(t.deps.observeRoster).not.toHaveBeenCalled();
    t.deps.hasGrant.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await t.read()).toBeNull();
    expect(t.deps.observeSource).toHaveBeenCalledTimes(1);
  });

  test('Sandbox read rejects each incompatible frozen binding and keeps the fixture reader separate', async () => {
    const t = await sandboxReceipt();
    const available = { status: 'available', freshness: 'current', result: t.result };
    const validBinding = { configuration: t.configuration, profileHash: hashProfile(t.configuration.profile), model: t.promptRow.wmkf_ai_model };
    async function replaceBinding({ configuration, profileHash, model, promptHash = sha256(canonical(configuration.promptRow)) }) {
      const cfgHash = await replacePayload(t.cfg.id, configuration);
      await pool.query('UPDATE prompt_job_tasks SET configuration_hash=$2,prompt_hash=$3,profile_hash=$4,model=$5 WHERE id=$1',
        [t.taskId, cfgHash, promptHash, profileHash, model]);
    }
    expect(await t.read()).toMatchObject(available);
    t.deps.observeSource.mockClear();
    t.deps.observeRoster.mockClear();
    function changePin(promptRow, patch) {
      const metadata = JSON.parse(promptRow.wmkf_ai_promptvariables);
      Object.assign(metadata.execution.profile, patch);
      promptRow.wmkf_ai_promptvariables = JSON.stringify(metadata);
    }
    const cases = [
      ['foreign scope', ({ configuration }) => { configuration.scope.requestId = randomUUID(); }],
      ['extra scope key', ({ configuration }) => { configuration.scope.actor = 'forged'; }],
      ['foreign prompt', ({ configuration }) => { configuration.promptRow.wmkf_ai_promptname = 'synthetic.executive-summary'; }],
      ['different model', state => { state.model = 'wrong-model'; }],
      ['different prompt hash', state => { state.promptHash = 'b'.repeat(64); }],
      ['different receipt profile hash', state => { state.profileHash = 'b'.repeat(64); }],
      ['different profile content', ({ configuration }) => { configuration.profile.sharedInstructions += ' changed'; }],
      ['wrong profile key', ({ configuration }) => { changePin(configuration.promptRow, { key: 'other-profile' }); }],
      ['wrong profile revision', ({ configuration }) => { changePin(configuration.promptRow, { revision: 2 }); }],
      ['wrong source roles', ({ configuration }) => { configuration.profile.documentRoles = ['fixture-appendix']; }],
    ];
    const observations = [];
    for (const [label, change] of cases) {
      const state = { ...validBinding, configuration: JSON.parse(canonical(validBinding.configuration)) };
      change(state);
      await replaceBinding(state);
      const value = await t.read();
      observations.push([label, value?.status, value?.freshness, value && Object.hasOwn(value, 'result')]);
    }
    expect(observations).toEqual(cases.map(([label]) => [label, 'unavailable', 'unknown', false]));
    expect(t.deps.observeSource).not.toHaveBeenCalled();
    expect(t.deps.observeRoster).not.toHaveBeenCalled();
    await replaceBinding(validBinding);
    expect(await t.read()).toMatchObject(available);
    expect(await store.readRecommendationState(t.policy, { includeProof: true })).toBeNull();
    expect(await store.readValidatedRecommendations(t.policy)).toBeNull();
    const fixture = await readyRecommendation();
    const sandboxReader = createRecommendationsReader({ sandbox: true, store,
      authorizeStaffRead: async () => ({ profileId: 7, systemUserId: randomUUID() }),
      resolveJobOwner: async () => ({ environment: fixture.owner.environment, principalKey: fixture.owner.principalKey,
        authorizationScope: fixture.owner.authorizationScope }),
    });
    expect(await sandboxReader.readResult({ requestId: fixture.owner.requestId, jobId: fixture.jobId })).toBeNull();
    expect(await store.readSandboxRecommendationState({ ...t.policy, requestId: fixture.owner.requestId, jobId: fixture.jobId })).toBeNull();
  });

});

suite('local Sandbox recommendation admission and controlled stages', () => {
  let admin, pool, store, schema, previousEnv, databaseIdentity;
  beforeAll(async () => {
    schema = `prompt_jobs_admission_${randomUUID().replaceAll('-', '')}`;
    admin = new Pool({ connectionString: databaseUrl, max: 2 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: databaseUrl, max: 5, options: `-c search_path=${schema},public` });
    await pool.query(fs.readFileSync(path.join(process.cwd(), 'lib/db/migrations/097_shared_prompt_jobs.sql'), 'utf8'));
    store = createPromptJobStore(pool);
    const { rows: [database] } = await pool.query('SELECT current_database() AS name, system_identifier::text FROM pg_catalog.pg_control_system()');
    databaseIdentity = sha256(canonical([database.system_identifier, database.name]));
  });
  beforeEach(async () => {
    previousEnv = process.env;
    process.env = { ...previousEnv, CLAUDE_API_KEY: 'fabricated-unused-key' };
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.DYNAMICS_SANDBOX_URL;
    delete process.env.SHAREPOINT_SITE_URL;
    await pool.query('TRUNCATE prompt_jobs CASCADE');
    mockComplete.mockReset();
  });
  afterEach(() => { process.env = previousEnv; });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
  });

  function activateGrant(grant) {
    Object.assign(process.env, {
      DYNAMICS_URL: RECOMMENDATIONS_SANDBOX_ORIGIN, DYNAMICS_CLIENT_ID: grant.applicationId,
      DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_TARGET_INTERLOCK: 'on',
      EXPERTISE_RECOMMENDATIONS_TRIAL: 'on', EXPERTISE_RECOMMENDATIONS_TRIAL_ACCESS: JSON.stringify(grant),
    });
  }

  function trial(grantOverride = {}, f = expertiseFixture()) {
    const { profile: definition } = f.input.tasks[0].configuration;
    const targetHost = new URL(RECOMMENDATIONS_SANDBOX_ORIGIN).hostname;
    const proof = sandboxRecommendationSourceProof(targetHost, definition.documentRoles, f.sourceObservation.documents);
    const observation = { ...f.sourceObservation, version: proof.version, targetHost };
    const grant = {
      requestId: f.owner.requestId, profileId: 7, azureId: randomUUID(), systemUserId: randomUUID(), applicationId: randomUUID(),
      scopeId: randomUUID(), idempotencyKey: randomUUID(), promptId: f.promptRow.wmkf_ai_promptid,
      promptHash: sha256(canonical(f.promptRow)), profileHash: hashProfile(definition), sourceHash: proof.hash,
      sourceSiteId: 'appriver3651007194.sharepoint.com,site,web', sourceDriveId: 'b!test-drive', databaseIdentity, ...grantOverride,
    };
    activateGrant(grant);
    const policy = readRecommendationsTrialPolicy();
    const deps = {
      store, nonceSecret: () => nonceSecret, authorize: jest.fn(async () => true), prompt: jest.fn(async () => f.promptRow),
      profiles: async () => ({ profiles: [{ profile: definition, sha256: grant.profileHash }] }),
      source: { prepare: jest.fn(async () => ({ observation, document: f.snapshotArgs.documents[0] })), observe: jest.fn(async () => observation) },
      roster: jest.fn(async () => ({ targetHost, projection: f.rosterProjection })),
    };
    mockComplete.mockResolvedValue(providerResponse(JSON.stringify(f.output)));
    return { ...f, proof, grant, policy, deps, admit: () => admitSandboxRecommendationTrial(deps),
      tick: args => advanceSandboxRecommendationTrial(args, deps) };
  }

  async function admitted(t) {
    const { jobId } = await t.admit();
    expect(await t.tick()).toEqual({ stage: 'snapshot_saved' });
    return jobId;
  }

  function successor(first, { grantPatch = {}, promptPatch = {}, source = first.deps.source } = {}) {
    const promptRow = { ...first.promptRow, wmkf_ai_promptid: randomUUID(),
      wmkf_promptversion: first.promptRow.wmkf_promptversion + 1, ...promptPatch };
    const grant = { ...first.grant, predecessorJobId: RECOMMENDATIONS_TRIAL_PREDECESSOR_JOB_ID,
      scopeId: randomUUID(), idempotencyKey: randomUUID(), promptId: promptRow.wmkf_ai_promptid,
      promptHash: sha256(canonical(promptRow)), ...grantPatch };
    activateGrant(grant);
    const deps = { ...first.deps, prompt: jest.fn(async () => promptRow), source };
    return { ...first, promptRow, grant, policy: readRecommendationsTrialPolicy(), deps,
      admit: () => admitSandboxRecommendationTrial(deps), tick: () => advanceSandboxRecommendationTrial({}, deps) };
  }

  async function admitRecorded(trial, jobId) {
    await pool.query(`ALTER TABLE prompt_jobs ALTER COLUMN id SET DEFAULT '${jobId}'::uuid`);
    try { expect(await admitted(trial)).toBe(jobId); }
    finally { await pool.query('ALTER TABLE prompt_jobs ALTER COLUMN id SET DEFAULT gen_random_uuid()'); }
  }

  async function failFirst(first) {
    mockComplete.mockResolvedValueOnce(providerResponse(JSON.stringify({ ...first.output, unexpected: 'invalid' })));
    expect(await first.tick()).toEqual({ stage: 'failed_validation' });
    const view = await store.readJob({ ...first.policy, jobId: RECOMMENDATIONS_TRIAL_PREDECESSOR_JOB_ID });
    expect(view.tasks[0]).toMatchObject({ state: 'failed_validation', error_code: 'profile_output_invalid' });
    expect(view.attempts[0]).toMatchObject({ state: 'failed_validation', audit_state: 'pending', error_code: 'profile_output_invalid' });
  }

  test('compiler 2 budget counts effective provider schema in Sandbox preflight and before dispatch', async () => {
    const t = trial({}, expertiseFixture({ compilerVersion: 2, roles: ['Consultant', 'Board'], documentLimit: 220_000 }));
    const { environment, requestId, authorizationScope } = t.policy;
    const scope = { environment, requestId, authorizationScope };
    const prepared = await t.deps.source.prepare();
    const spec = parseExecutionSpec(t.promptRow);
    function compile(document) {
      const snapshotArgs = { ...t.snapshotArgs, scope, documents: [document] };
      const snapshot = prepareContextSnapshot(snapshotArgs);
      const composed = composeProfileTask({ ...snapshotArgs, snapshot, promptRow: t.promptRow });
      const schema = effectiveProviderOutputSchema(composed, spec);
      const measure = outputSchema => Buffer.byteLength(canonical({
        system: composed.system, messages: composed.userContent, outputSchema,
      })) + 4096;
      return { snapshot, oldBytes: measure(spec.outputSchema), nativeBytes: measure(schema) };
    }
    const initial = compile(prepared.document);
    expect(await preflightSandboxRecommendationTrial(t.deps)).toMatchObject({ inputUpperBound: initial.nativeBytes });
    const document = { ...prepared.document, text: prepared.document.text + 'x'.repeat(195_000 - initial.oldBytes) };
    const grown = compile(document);
    expect(grown.oldBytes).toBe(195_000);
    expect(grown.nativeBytes).toBeGreaterThan(195_000);
    t.deps.source.prepare.mockResolvedValue({ ...prepared, document });
    await expect(preflightSandboxRecommendationTrial(t.deps)).rejects.toThrow(/exceeds budget/);
    await expect(t.admit()).rejects.toThrow(/exceeds budget/);
    expect(await store.listJobs(t.policy)).toEqual([]);
    const options = fixtureExecution(t);
    Object.assign(options.profiledContext, { scope, snapshot: grown.snapshot, beforeValidation: jest.fn() });
    await expect(executePrompt(options)).rejects.toThrow(/exceeds budget/);
    expect(options.onDispatch).not.toHaveBeenCalled();
    expect(options.onResponse).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  test('bounded admission is idempotent before mutable inputs, then produces one typed draft and a separate audit intent', async () => {
    const fixture = await store.admit(expertiseFixture().input);
    expect(fixture.job.environment).toBe('test');
    const t = trial();
    expect(await preflightSandboxRecommendationTrial(t.deps)).toEqual({
      inputUpperBound: expect.any(Number), maxTokens: 4096, costCeilingMicros: expect.any(Number),
    });
    expect((await pool.query("SELECT 1 FROM prompt_jobs WHERE environment='local-sandbox'")).rowCount).toBe(0);
    expect(mockComplete).not.toHaveBeenCalled();
    const receipts = await Promise.all([t.admit(), t.admit()]);
    expect(receipts.map(r => r.replayed).sort()).toEqual([false, true]);
    const [{ jobId }] = receipts;
    expect(receipts.every(r => r.jobId === jobId)).toBe(true);
    t.deps.prompt.mockRejectedValue(new Error('must reuse frozen prompt'));
    t.deps.source.prepare.mockClear();
    await expect(t.admit()).resolves.toEqual({ jobId, replayed: true });
    expect(t.deps.source.prepare).not.toHaveBeenCalled();
    expect(await t.tick()).toEqual({ stage: 'snapshot_saved' });
    expect(await t.tick({ recoverResponse: true })).toEqual({ stage: 'unavailable' });
    expect(mockComplete).not.toHaveBeenCalled();
    mockComplete.mockImplementationOnce(async () => {
      const { rows } = await pool.query('SELECT state FROM prompt_job_attempts');
      expect(rows).toEqual([{ state: 'dispatching' }]);
      return providerResponse(JSON.stringify(t.output));
    });
    expect(await t.tick()).toEqual({ stage: 'validated' });
    expect(await t.tick()).toEqual({ stage: 'audit_pending' });
    const read = await store.readValidatedSandboxRecommendations({ ...t.policy, jobId });
    expect(read.results).toEqual([expect.objectContaining({
      status: 'available', contractVersion: EXPERTISE_RESULT_CONTRACT,
      result: validateRecommendationsOutput(t.output, t.built),
    })]);
    const view = await store.readJob({ ...t.policy, jobId });
    expect(view.attempts).toEqual([expect.objectContaining({ state: 'validated', audit_state: 'pending' })]);
    expect(view.tasks[0]).toMatchObject({ destination_field: null, writeback_state: 'not_requested' });
    expect(view.publication).toBeNull();
    expect(mockComplete).toHaveBeenCalledTimes(1);
    await pool.query("UPDATE prompt_job_content SET expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1 AND kind='result'", [jobId]);
    const expired = await store.readValidatedSandboxRecommendations({ ...t.policy, jobId });
    expect(expired.results).toEqual([expect.objectContaining({ status: 'expired' })]);
    expect(expired.results[0]).not.toHaveProperty('result');
    expect((await pool.query("SELECT 1 FROM prompt_job_content WHERE job_id=$1 AND kind='result'", [jobId])).rowCount).toBe(1);
  });

  test('same-target changes require a new approval but the Sandbox singleton forbids a second job across owner, scope and Request', async () => {
    const t = trial();
    const { jobId } = await t.admit();
    await pool.query("UPDATE prompt_jobs SET environment = 'preview-sandbox'");
    await pool.query("UPDATE prompt_job_tasks SET state = 'expired'");
    await pool.query("UPDATE prompt_job_content SET expires_at = clock_timestamp() - interval '1 second'");
    expect(await store.expireSandboxRecommendationContent({ ...t.policy, environment: 'preview-sandbox', jobId })).toBe(1);
    const other = trial();
    await expect(other.admit()).rejects.toMatchObject({ code: 'prompt_job_trial_limit' });
    expect((await pool.query('SELECT 1 FROM prompt_jobs')).rowCount).toBe(1);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  test('one explicit successor is concurrently idempotent, executes once, and leaves both permanent receipts counted', async () => {
    const first = trial();
    await admitRecorded(first, RECOMMENDATIONS_TRIAL_PREDECESSOR_JOB_ID);
    await failFirst(first);
    first.deps.audit = jest.fn(async () => {});
    expect(await first.tick()).toEqual({ stage: 'audit_delivered' });
    const next = successor(first);
    const receipts = await Promise.all([next.admit(), next.admit()]);
    expect(receipts.map(r => r.replayed).sort()).toEqual([false, true]);
    const [{ jobId }] = receipts;
    expect(jobId).not.toBe(RECOMMENDATIONS_TRIAL_PREDECESSOR_JOB_ID);
    expect(receipts[1].jobId).toBe(jobId);
    expect(await next.tick()).toEqual({ stage: 'snapshot_saved' });
    expect(await next.tick()).toEqual({ stage: 'validated' });
    expect(mockComplete).toHaveBeenCalledTimes(2);
    await pool.query("UPDATE prompt_job_content SET expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1 AND kind='configuration'",
      [RECOMMENDATIONS_TRIAL_PREDECESSOR_JOB_ID]);
    expect(await store.expireSandboxRecommendationContent({ ...first.policy, jobId: RECOMMENDATIONS_TRIAL_PREDECESSOR_JOB_ID })).toBe(1);
    await expect(next.admit()).resolves.toEqual({ jobId, replayed: true });
    await expect(successor(first).admit()).rejects.toMatchObject({ code: 'prompt_job_trial_limit' });
    expect((await pool.query('SELECT 1 FROM prompt_jobs')).rowCount).toBe(2);
    expect((await pool.query('SELECT 1 FROM prompt_job_attempts')).rowCount).toBe(2);
    expect(mockComplete).toHaveBeenCalledTimes(2);
  });

  test('successor refuses missing, active, unaudited or mismatched predecessor evidence', async () => {
    const first = trial();
    const expectLimit = async next => expect(next.admit()).rejects.toMatchObject({ code: 'prompt_job_trial_limit' });
    await expectLimit(successor(first));
    activateGrant(first.grant);
    await admitRecorded(first, RECOMMENDATIONS_TRIAL_PREDECESSOR_JOB_ID);
    await expectLimit(successor(first));
    activateGrant(first.grant);
    await failFirst(first);
    await expectLimit(successor(first));
    activateGrant(first.grant);
    first.deps.audit = jest.fn(async () => {});
    expect(await first.tick()).toEqual({ stage: 'audit_delivered' });
    await expect(successor(first, { grantPatch: { predecessorJobId: randomUUID() } }).admit())
      .rejects.toMatchObject({ code: 'recommendations_trial_disabled' });
    await expect(successor(first, { grantPatch: { databaseIdentity: '0'.repeat(64) } }).admit())
      .rejects.toMatchObject({ code: 'recommendations_trial_database_mismatch' });
    await expectLimit(successor(first, { grantPatch: { azureId: randomUUID() } }));
    await expectLimit(successor(first, { grantPatch: { applicationId: randomUUID() } }));
    await expectLimit(successor(first, { grantPatch: { sourceDriveId: 'b!another-drive' } }));
    await expectLimit(successor(first, { promptPatch: { wmkf_promptversion: first.promptRow.wmkf_promptversion + 2 } }));
    await expectLimit(successor(first, { promptPatch: { wmkf_ai_promptid: first.promptRow.wmkf_ai_promptid } }));
    await pool.query("UPDATE prompt_job_attempts SET error_code='profile_inputs_changed_after_dispatch'");
    await expectLimit(successor(first));
    await pool.query("UPDATE prompt_job_attempts SET error_code='profile_output_invalid'");

    const prepared = await first.deps.source.prepare();
    const changedDocument = { ...prepared.document, sha256: 'b'.repeat(64) };
    const { text, ...changedMetadata } = changedDocument;
    const changedObservation = { ...prepared.observation, documents: [changedMetadata] };
    const changedProof = sandboxRecommendationSourceProof(first.policy.targetHost, ['proposal'], changedObservation.documents);
    const changedSource = { prepare: async () => ({ observation: changedObservation, document: changedDocument }) };
    await expectLimit(successor(first, { grantPatch: { sourceHash: changedProof.hash }, source: changedSource }));
    await pool.query("UPDATE prompt_job_content SET expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1 AND kind='configuration'",
      [RECOMMENDATIONS_TRIAL_PREDECESSOR_JOB_ID]);
    await expectLimit(successor(first));
    expect((await pool.query('SELECT 1 FROM prompt_jobs')).rowCount).toBe(1);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  test('third admission requires both exact audited failures and retains all three idempotent receipts', async () => {
    const first = trial();
    await admitRecorded(first, RECOMMENDATIONS_TRIAL_PREDECESSOR_JOB_ID);
    await failFirst(first);
    first.deps.audit = jest.fn(async () => {});
    expect(await first.tick()).toEqual({ stage: 'audit_delivered' });

    const second = successor(first);
    const makeThird = (grantPatch = {}, promptPatch = {}) =>
      successor(second, { grantPatch: { predecessorJobId: RECOMMENDATIONS_TRIAL_SECOND_JOB_ID, ...grantPatch }, promptPatch });
    const expectLimit = async trial => expect(trial.admit()).rejects.toMatchObject({ code: 'prompt_job_trial_limit' });
    await expectLimit(makeThird());
    activateGrant(second.grant);
    await admitRecorded(second, RECOMMENDATIONS_TRIAL_SECOND_JOB_ID);
    await expectLimit(makeThird());

    activateGrant(second.grant);
    mockComplete.mockResolvedValueOnce({ ...providerResponse(JSON.stringify(second.output)), stopReason: 'max_tokens' });
    expect(await second.tick()).toEqual({ stage: 'failed_validation' });
    const secondReceipt = await store.readJob({ ...second.policy, jobId: RECOMMENDATIONS_TRIAL_SECOND_JOB_ID });
    expect(secondReceipt.attempts[0]).toMatchObject({ state: 'failed_validation', error_code: 'claude_output_truncated', audit_state: 'pending' });
    await expectLimit(makeThird());
    activateGrant(second.grant);
    expect(await second.tick()).toEqual({ stage: 'audit_delivered' });

    for (const [jobId, version, policy] of [
      [RECOMMENDATIONS_TRIAL_PREDECESSOR_JOB_ID, 1, first.policy],
      [RECOMMENDATIONS_TRIAL_SECOND_JOB_ID, 2, second.policy],
    ]) {
      const digest = sha256(canonical({ kind: `expertise-recommendations-trial-v${version}`, policy }));
      expect((await pool.query('SELECT payload_hash FROM prompt_jobs WHERE id=$1', [jobId])).rows[0].payload_hash).toBe(digest);
      await pool.query('UPDATE prompt_jobs SET payload_hash=$2 WHERE id=$1', [jobId, '0'.repeat(64)]);
      await expectLimit(makeThird());
      await pool.query('UPDATE prompt_jobs SET payload_hash=$2 WHERE id=$1', [jobId, digest]);
    }
    await expectLimit(makeThird({ azureId: randomUUID() }));
    await expectLimit(makeThird({}, { wmkf_promptversion: 4 }));
    await expectLimit(makeThird({}, { wmkf_ai_promptid: first.promptRow.wmkf_ai_promptid }));

    const third = makeThird();
    const receipts = await Promise.all([third.admit(), third.admit()]);
    expect(receipts.map(r => r.replayed).sort()).toEqual([false, true]);
    const [{ jobId }] = receipts;
    expect(receipts[1].jobId).toBe(jobId);
    expect(await third.tick()).toEqual({ stage: 'snapshot_saved' });
    expect(await third.tick()).toEqual({ stage: 'validated' });
    expect(mockComplete).toHaveBeenCalledTimes(3);

    const previousJobs = [RECOMMENDATIONS_TRIAL_PREDECESSOR_JOB_ID, RECOMMENDATIONS_TRIAL_SECOND_JOB_ID];
    await pool.query("UPDATE prompt_job_content SET expires_at=clock_timestamp()-interval '1 second' WHERE job_id=ANY($1::uuid[]) AND kind='configuration'", [previousJobs]);
    for (const [past, id] of [[first, previousJobs[0]], [second, previousJobs[1]]]) {
      expect(await store.expireSandboxRecommendationContent({ ...past.policy, jobId: id })).toBe(1);
      activateGrant(past.grant);
      await expect(past.admit()).resolves.toEqual({ jobId: id, replayed: true });
    }
    activateGrant(third.grant);
    await expect(third.admit()).resolves.toEqual({ jobId, replayed: true });
    await expectLimit(makeThird());
    await expect(makeThird({ predecessorJobId: jobId }).admit()).rejects.toMatchObject({ code: 'recommendations_trial_disabled' });
    expect((await pool.query('SELECT 1 FROM prompt_jobs')).rowCount).toBe(3);
    expect((await pool.query('SELECT 1 FROM prompt_job_attempts')).rowCount).toBe(3);
    expect(mockComplete).toHaveBeenCalledTimes(3);
  });

  test('rejects a mismatched database and same idempotency key with different binding', async () => {
    const wrong = trial({ databaseIdentity: '0'.repeat(64) });
    await expect(wrong.admit()).rejects.toMatchObject({ code: 'recommendations_trial_database_mismatch' });
    expect(wrong.deps.authorize).not.toHaveBeenCalled();
    expect(wrong.deps.source.prepare).not.toHaveBeenCalled();
    const original = trial();
    const { jobId } = await original.admit();
    const priorGrant = process.env.EXPERTISE_RECOMMENDATIONS_TRIAL_ACCESS;
    process.env.EXPERTISE_RECOMMENDATIONS_TRIAL_ACCESS = JSON.stringify({ ...original.grant, sourceHash: 'b'.repeat(64) });
    original.deps.source.prepare.mockClear();
    await expect(original.admit()).rejects.toMatchObject({ code: 'recommendations_trial_receipt_mismatch' });
    expect(original.deps.source.prepare).not.toHaveBeenCalled();
    process.env.EXPERTISE_RECOMMENDATIONS_TRIAL_ACCESS = priorGrant;
    await expect(original.admit()).resolves.toEqual({ jobId, replayed: true });
    const conflict = trial({ applicationId: original.grant.applicationId, idempotencyKey: original.grant.idempotencyKey });
    await expect(conflict.admit()).rejects.toMatchObject({ code: 'prompt_job_idempotency_key_reused' });
    const { rows } = await pool.query('SELECT id FROM prompt_jobs');
    expect(rows).toEqual([{ id: jobId }]);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  test('known source mismatch and insufficient authorization consume no singleton or call', async () => {
    const t = trial();
    t.deps.authorize.mockResolvedValueOnce(false);
    await expect(t.admit()).rejects.toMatchObject({ code: 'recommendations_trial_access_denied' });
    const prepared = await t.deps.source.prepare();
    t.deps.source.prepare.mockResolvedValueOnce({ ...prepared, observation: { ...prepared.observation,
      documents: [{ ...prepared.document, text: undefined, sha256: 'b'.repeat(64) }].map(({ text, ...d }) => d),
    } });
    await expect(t.admit()).rejects.toMatchObject({ code: 'trial_inputs_changed' });
    expect((await pool.query('SELECT 1 FROM prompt_jobs')).rowCount).toBe(0);
    expect(mockComplete).not.toHaveBeenCalled();
    await expect(t.admit()).resolves.toMatchObject({ replayed: false });
  });

  test('post-response unknown holds the durable checkpoint until explicitly recovered, with no second provider call', async () => {
    const t = trial();
    const jobId = await admitted(t);
    mockComplete.mockImplementationOnce(async () => {
      // The dispatch freshness check has already completed at this point.
      t.deps.source.observe.mockRejectedValueOnce(new Error('source unavailable after generation'));
      return providerResponse(JSON.stringify(t.output));
    });
    expect(await t.tick()).toEqual({ stage: 'needs_attention' });
    const held = await store.readJob({ ...t.policy, jobId });
    expect(held.attempts).toEqual([expect.objectContaining({ state: 'response_saved', response_hash: expect.any(String) })]);
    expect(await t.tick()).toEqual({ stage: 'needs_attention' });
    expect(await t.tick({ recoverResponse: true })).toEqual({ stage: 'validated' });
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  test('post-response grant outage holds the checkpoint until a fresh verified grant', async () => {
    const t = trial();
    const jobId = await admitted(t);
    mockComplete.mockImplementationOnce(async () => {
      t.deps.authorize.mockRejectedValue(Object.assign(new Error('grant proof unavailable'), { code: 'expertise_grant_unavailable' }));
      return providerResponse(JSON.stringify(t.output));
    });
    expect(await t.tick()).toEqual({ stage: 'needs_attention' });
    const held = await store.readJob({ ...t.policy, jobId });
    expect(held.attempts).toEqual([expect.objectContaining({ state: 'response_saved' })]);
    t.deps.authorize.mockResolvedValue(true);
    expect(await t.tick({ recoverResponse: true })).toEqual({ stage: 'validated' });
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  test('confirmed post-response source change beats unknown roster, preserving a failed audit receipt', async () => {
    const t = trial();
    const jobId = await admitted(t);
    mockComplete.mockImplementationOnce(async () => {
      t.deps.source.observe.mockRejectedValueOnce(Object.assign(new Error('source changed'), { code: 'proposal_source_changed' }));
      t.deps.roster.mockRejectedValueOnce(new Error('roster unavailable'));
      return providerResponse(JSON.stringify(t.output));
    });
    expect(await t.tick()).toEqual({ stage: 'failed_validation' });
    const view = await store.readJob({ ...t.policy, jobId });
    expect(view.attempts).toEqual([expect.objectContaining({
      state: 'failed_validation', audit_state: 'pending', error_code: 'profile_inputs_changed_after_dispatch',
    })]);
    expect(await t.tick({ recoverResponse: true })).toEqual({ stage: 'unavailable' });
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  test('exact-job cleanup removes expired bytes after revocation and preserves same-scope sibling bytes and tombstone', async () => {
    const t = trial();
    const jobId = await admitted(t);
    t.deps.authorize.mockResolvedValue(false);
    delete process.env.EXPERTISE_RECOMMENDATIONS_TRIAL;
    const sibling = randomUUID();
    await pool.query(`INSERT INTO prompt_jobs (id,environment,principal_key,authorization_scope,request_id,idempotency_key,
      payload_hash,operation,source_expires_at,result_expires_at)
      SELECT $2,environment,principal_key,authorization_scope,request_id,$3,payload_hash,operation,source_expires_at,result_expires_at
      FROM prompt_jobs WHERE id=$1`, [jobId, sibling, randomUUID()]);
    await pool.query(`INSERT INTO prompt_job_content(job_id,kind,payload,sha256,size_bytes,expires_at)
      SELECT $2,kind,payload,sha256,size_bytes,expires_at FROM prompt_job_content WHERE job_id=$1`, [jobId, sibling]);
    await pool.query("UPDATE prompt_job_content SET expires_at=clock_timestamp()-interval '1 second'");
    await expect(store.expireSandboxRecommendationContent(t.policy)).rejects.toMatchObject({ code: 'invalid_prompt_job_id' });
    await expect(store.expireSandboxRecommendationContent({ ...t.policy, jobId, databaseIdentity: '0'.repeat(64) }))
      .rejects.toMatchObject({ code: 'recommendations_trial_database_mismatch' });
    expect(await store.expireSandboxRecommendationContent({ ...t.policy, jobId, principalKey: `app:${randomUUID()}` })).toBe(0);
    expect(await store.expireSandboxRecommendationContent({ ...t.policy, jobId })).toBe(2);
    expect((await pool.query('SELECT DISTINCT job_id FROM prompt_job_content')).rows).toEqual([{ job_id: sibling }]);
    expect((await pool.query('SELECT 1 FROM prompt_job_tasks WHERE job_id=$1', [jobId])).rowCount).toBe(1);
    expect((await pool.query('SELECT 1 FROM prompt_jobs WHERE id=$1', [jobId])).rowCount).toBe(1);
  });
});
