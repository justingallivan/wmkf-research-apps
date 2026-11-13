/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { prepareContextSnapshot } from '../../lib/services/prompt-jobs/context.js';
import { machineDatabaseEndpoint, machinePilotScope } from '../../lib/services/prompt-jobs/machine-pilot-policy.js';
import { buildMachineTitleDefinition, MACHINE_TITLE_TASK, MACHINE_TITLE_FIELD } from '../../lib/services/prompt-jobs/machine-title-contract.js';
import { canonical, hashProfile, sha256 } from '../../lib/services/prompt-jobs/profile.js';
import { createPromptJobStore } from '../../lib/services/prompt-jobs/store.js';

const url = process.env.PROMPT_JOB_PG_TEST_URL || '';
if (!url && process.env.PROMPT_JOB_PG_TEST_REQUIRE === '1') throw new Error('Explicit loopback scratch PostgreSQL URL required');
if (url) {
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['127.0.0.1', '[::1]'].includes(parsed.hostname)
    || !parsed.port || parsed.pathname.length < 2 || parsed.search || parsed.hash || url === process.env.POSTGRES_URL) {
    throw new Error('Explicit loopback scratch PostgreSQL URL without options required');
  }
}
const describePg = url ? describe : describe.skip;

describePg('Short Title ledger policy, replay and publication', () => {
  let pool;
  let admin;
  let schema;
  let endpoint;
  let databaseIdentity;
  const nonceSecret = 'fixture-only snapshot nonce longer than 32 bytes';

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    schema = `prompt_title_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 6 });
    await pool.query(readFileSync('lib/db/migrations/097_shared_prompt_jobs.sql', 'utf8'));
    const { rows: [row] } = await pool.query('SELECT current_database() AS database_name, system_identifier::text FROM pg_catalog.pg_control_system()');
    endpoint = machineDatabaseEndpoint(url);
    databaseIdentity = sha256(canonical([endpoint, row.system_identifier, row.database_name]));
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (schema) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    if (admin) await admin.end();
  });

  function fixture(destinationField) {
    const { profile, task } = buildMachineTitleDefinition({destinationField});
    const promptId = randomUUID();
    const promptRow = {
      wmkf_ai_promptid: promptId, wmkf_promptversion: 1, wmkf_ai_promptname: task.name,
      wmkf_ai_promptbody: task.body, wmkf_ai_systemprompt: task.systemPrompt, wmkf_ai_model: task.model,
      wmkf_ai_maxtokens: task.maxTokens, wmkf_ai_temperature: task.temperature,
      wmkf_ai_promptvariables: task.variables, wmkf_ai_promptoutputschema: task.outputSchema,
    };
    const pilotId = randomUUID();
    const requestId = randomUUID();
    const records = [
      { name: 'source_title', present: true, value: 'Applicant title', provenance: `akoya_request:${requestId}:akoya_title` },
      { name: 'source_abstract', present: true, value: 'Applicant abstract from the configured Request fixture.', provenance: `akoya_request:${requestId}:wmkf_abstract` },
    ];
    const manifest = { requestId, version: 'request-title-abstract-v1', hash: sha256(canonical(records)) };
    let policy = {
      pilotId, enabled: true, requestId, sourceEventId: randomUUID(),
      authorizationScope: `pa-short-title:${pilotId}`, principalKey: 'app:entra-v2:fixture-client',
      environment: 'test-sandbox', expiresAt: new Date(Date.now() + 86400000).toISOString(),
      databaseEndpoint: endpoint, databaseIdentity, promptId, promptVersion: 1, role: 'PromptJobs.Admit',
      promptHash: sha256(canonical(promptRow)), profileHash: hashProfile(profile),
      ...(destinationField ? {destinationGrant:{field:destinationField,type:'Memo',maxLength:2000}} : {}),
    };
    const store = createPromptJobStore(pool, { readMachinePolicy: () => policy, machineDatabaseEndpoint: endpoint });
    const command = { ...machinePilotScope(policy), operation: 'initialize', sourceEventId: policy.sourceEventId,
      idempotencyKey: randomUUID(), tasks: [{ taskKey: MACHINE_TITLE_TASK }] };
    return {
      command, store, profile, records, getPolicy:()=>policy, configuration: { promptRow, profile, manifest },
      setPolicy: patch => { policy = { ...policy, ...patch }; },
    };
  }

  test('an enabled valid Short Title policy still rejects Summary before configuration loading', async () => {
    const f = fixture();
    const loadConfiguration = jest.fn(async () => f.configuration);
    await expect(f.store.admitMachineTitle({ ...f.command, tasks: [{ taskKey: 'proposal.executive-summary' }] },
      { loadConfiguration })).rejects.toMatchObject({ code: 'invalid_prompt_job_admission' });
    expect(loadConfiguration).not.toHaveBeenCalled();
    expect(await f.store.listJobs(f.command)).toEqual([]);
  });

  test('destination edits with stale prompt hash cannot admit even when grant is edited to match',async()=>{
    const f=fixture('wmkf_trialtitleone');const schema=JSON.parse(f.configuration.promptRow.wmkf_ai_promptoutputschema);
    schema.outputs[0].target.field='wmkf_trialtitletwo';f.configuration.promptRow.wmkf_ai_promptoutputschema=JSON.stringify(schema);
    f.setPolicy({destinationGrant:{field:'wmkf_trialtitletwo',type:'Memo',maxLength:2000}});
    await expect(f.store.admitMachineTitle(f.command,{loadConfiguration:async()=>f.configuration})).rejects.toMatchObject({code:'machine_pilot_configuration'});
    expect(await f.store.listJobs(f.command)).toEqual([]);
  });
  test('new event and scope cannot evade the physical-field reservation, including after failure and expiry', async()=>{
    const field='wmkf_trialtitleone';const a=fixture(field);
    const admitted=await a.store.admitMachineTitle(a.command,{loadConfiguration:async()=>a.configuration});
    const lease=await a.store.claim({jobId:admitted.job.id,leaseMs:60000});
    await a.store.markAttemptFailed({jobId:admitted.job.id,leaseToken:lease.leaseToken,taskId:admitted.tasks[0].id,outcome:'failed_pre_dispatch',errorCode:'dispatch_denied'});
    const b=fixture(field);b.command.requestId=a.command.requestId;b.setPolicy({requestId:a.command.requestId});b.configuration.manifest.requestId=a.command.requestId;
    await expect(b.store.admitMachineTitle(b.command,{loadConfiguration:async()=>b.configuration})).rejects.toMatchObject({code:'prompt_job_initialization_reserved'});
    await pool.query("UPDATE prompt_jobs SET source_expires_at=now()-interval '2 days',result_expires_at=now()-interval '1 day' WHERE id=$1",[admitted.job.id]);
    await a.store.expireContent({scope:a.command});
    await expect(b.store.admitMachineTitle(b.command,{loadConfiguration:async()=>b.configuration})).rejects.toMatchObject({code:'prompt_job_initialization_reserved'});
    const c=fixture('wmkf_trialtitletwo');c.command.requestId=a.command.requestId;c.setPolicy({requestId:a.command.requestId});c.configuration.manifest.requestId=a.command.requestId;
    expect((await c.store.admitMachineTitle(c.command,{loadConfiguration:async()=>c.configuration})).tasks[0].destination_field).toBe('wmkf_trialtitletwo');
  });
  test('rejects the generic entry point, admits once and replays before source load', async () => {
    const f = fixture();
    const { store, command, configuration } = f;
    await expect(store.admit(command)).rejects.toMatchObject({ code: 'invalid_prompt_job_admission' });
    await expect(store.admit({ ...command, environment: 'test', tasks: [{ taskKey: 'synthetic.executive-summary' }] }))
      .rejects.toMatchObject({ code: 'invalid_prompt_job_admission' });
    const loadConfiguration = jest.fn(async () => {
      const key = JSON.stringify(['prompt-job-cohort', command.authorizationScope]);
      const { rows: [row] } = await pool.query(
        'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired', [key],
      );
      expect(row.acquired).toBe(true);
      return configuration;
    });
    const first = await store.admitMachineTitle(command, { loadConfiguration });
    expect(first).toMatchObject({ replayed: false, tasks: [{ task_key: MACHINE_TITLE_TASK, destination_field: MACHINE_TITLE_FIELD,
      state: 'queued', writeback_state: 'pending' }] });
    loadConfiguration.mockRejectedValue(new Error('source changed'));
    const replay = await store.admitMachineTitle(command, { loadConfiguration });
    expect(replay).toMatchObject({ replayed: true, job: { id: first.job.id } });
    await expect(store.admitMachineTitle({ ...command, idempotencyKey: randomUUID() }, { loadConfiguration }))
      .rejects.toMatchObject({ httpStatus: 429 });
    expect(loadConfiguration).toHaveBeenCalledTimes(1);
  });

  test('conflicts when the same key is reused for a changed authorized event', async () => {
    const f = fixture();
    const loadConfiguration = jest.fn(async () => f.configuration);
    await f.store.admitMachineTitle(f.command, { loadConfiguration });
    const sourceEventId = randomUUID();
    await expect(f.store.admitMachineTitle({ ...f.command, sourceEventId }, { loadConfiguration }))
      .rejects.toMatchObject({ httpStatus: 400, code: 'invalid_prompt_job_admission' });
    f.setPolicy({ sourceEventId });
    await expect(f.store.admitMachineTitle({ ...f.command, sourceEventId }, { loadConfiguration }))
      .rejects.toMatchObject({ httpStatus: 409, code: 'prompt_job_idempotency_key_reused' });
    expect(loadConfiguration).toHaveBeenCalledTimes(1);
  });

  test('advisory quota and idempotency serialize competing admissions', async () => {
    const f = fixture();
    const duplicate = await Promise.all([1, 2].map(() =>
      f.store.admitMachineTitle(f.command, { loadConfiguration: async () => f.configuration })));
    expect(duplicate.map(result => result.job.id)).toEqual([duplicate[0].job.id, duplicate[0].job.id]);
    expect(duplicate.map(result => result.replayed).sort()).toEqual([false, true]);
    const other = fixture();
    const competing = await Promise.allSettled([randomUUID(), randomUUID()].map(idempotencyKey =>
      other.store.admitMachineTitle({ ...other.command, idempotencyKey }, { loadConfiguration: async () => other.configuration })));
    expect(competing.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(competing.find(result => result.status === 'rejected')?.reason).toMatchObject({ httpStatus: 429 });
  });

  test('rejects incorrect DB identity and changed policy before insertion', async () => {
    const f = fixture();
    const loadConfiguration = jest.fn(async () => f.configuration);
    f.setPolicy({ databaseIdentity: 'a'.repeat(64) });
    await expect(f.store.admitMachineTitle(f.command, { loadConfiguration })).rejects.toMatchObject({ code: 'machine_pilot_database_mismatch' });
    expect(loadConfiguration).not.toHaveBeenCalled();
    f.setPolicy({ databaseIdentity });
    await expect(f.store.admitMachineTitle(f.command, { loadConfiguration: async () => {
      f.setPolicy({ enabled: false });
      return f.configuration;
    } })).rejects.toMatchObject({ code: 'machine_pilot_unavailable' });
    expect(await f.store.listJobs(f.command)).toEqual([]);
  });

  test('binds the source snapshot, rejects altered policy, and freezes canonical title publication', async () => {
    const f = fixture();
    const { store, command, profile, records, configuration } = f;
    const { job, tasks: [task] } = await store.admitMachineTitle(command, { loadConfiguration: async () => configuration });
    const { leaseToken } = await store.claim({ jobId: job.id });
    const fence = { jobId: job.id, leaseToken };
    const scope = { environment: command.environment, authorizationScope: command.authorizationScope, requestId: command.requestId };
    const snapshot = data => prepareContextSnapshot({ scope, profile, nonceSecret, documents: [], records: data });
    await expect(store.saveSnapshot({ ...fence, snapshot: snapshot([{ ...records[0], value: 'Changed title' }, records[1]]) }))
      .rejects.toMatchObject({ code: 'invalid_prompt_job_snapshot' });
    await store.saveSnapshot({ ...fence, snapshot: snapshot(records) });
    const etag = 'W/"original"';
    await store.captureTarget({ ...fence, etag, fields: { [MACHINE_TITLE_FIELD]: { blank: true, sha256: sha256('null') } } });
    f.setPolicy({ role: 'Changed.Role' });
    await expect(store.markDispatching({ ...fence, taskId: task.id })).rejects.toMatchObject({ code: 'machine_pilot_unavailable' });
    f.setPolicy({ role: 'PromptJobs.Admit' });
    const attempt = await store.markDispatching({ ...fence, taskId: task.id });
    const attemptFence = { ...fence, taskId: task.id, attemptId: attempt.id };
    await store.saveResponse({ ...attemptFence, response: { response: { text: 'To study' } } });
    await expect(store.saveValidated({ ...attemptFence, result: 'To study.', deferredAudit: { status: 'complete' } }))
      .rejects.toMatchObject({ code: 'invalid_prompt_job_result' });
    await store.saveValidated({ ...attemptFence, result: 'To study', deferredAudit: { status: 'complete' } });
    expect(await store.freezePublication(fence)).toBeNull();
    await store.markAuditDispatching(attemptFence);
    await store.markAudit({ ...attemptFence, outcome: 'delivered' });
    const publication = await store.freezePublication(fence);
    expect(publication).toMatchObject({ task_ids: [task.id], expected_etag: etag, state: 'ready' });
    await expect(store.readContent({ ...fence, contentId: publication.payload_content_id, expectedHash: publication.payload_hash }))
      .resolves.toEqual({ [MACHINE_TITLE_FIELD]: 'To study' });
    await store.markPublicationDispatched({ ...fence, operationId: publication.id });
    await store.finishPublication({ ...fence, operationId: publication.id, outcome: 'applied' });
    expect((await store.listJobs(command))[0]).toMatchObject({ publication: { state: 'applied' },
      tasks: [{ writeback_state: 'applied' }] });
  });
});
