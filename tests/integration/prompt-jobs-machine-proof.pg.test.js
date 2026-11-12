/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from 'jose';
import pg from 'pg';
import { createMachineAuthenticator } from '../../lib/services/prompt-jobs/machine-auth.js';
import { createMachineAdmissionProof } from '../../lib/services/prompt-jobs/machine-admission-proof.js';
import { createPromptJobStore } from '../../lib/services/prompt-jobs/store.js';
import { createRequestFieldDelivery, TITLE_DESTINATION } from '../../lib/services/prompt-jobs/request-field-delivery.js';
import { projectMachineJob } from '../../lib/services/prompt-jobs/machine-status.js';
import { advanceJob } from '../../lib/services/prompt-jobs/worker.js';
import { canonical, sha256, hashProfile } from '../../lib/services/prompt-jobs/profile.js';

// Deliberately separate from both application configuration and other trial DBs.
const url = process.env.PA_PROOF_PG_TEST_URL || '';
if (!url && process.env.PA_PROOF_PG_TEST_REQUIRE === '1') throw Error('PA_PROOF_PG_TEST_URL required');
if (url) {
  const u = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || u.hostname !== '127.0.0.1' || !u.port
    || u.pathname !== '/pa_proof' || u.search || u.hash || url === process.env.POSTGRES_URL) {
    throw Error('Proof requires explicit loopback pa_proof scratch database without URL options');
  }
}
const describePg = url ? describe : describe.skip;
const TASK = 'synthetic.executive-summary';
const config = { enabled: true, tenantId: randomUUID(), audience: randomUUID(), clientId: randomUUID(),
  servicePrincipalId: randomUUID(), role: 'PromptJobs.Proof' };
const principalKey = `app:entra-v2:${config.tenantId}:${config.clientId}:${config.servicePrincipalId}`;

describePg('offline authenticated machine admission on isolated PostgreSQL', () => {
  let admin, pool, schema, store, authenticate, token, proof, currentGrant, currentPolicy;
  const commandCapture = [];
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    schema = `pa_proof_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 8 });
    await pool.query(readFileSync('lib/db/migrations/097_shared_prompt_jobs.sql', 'utf8'));
    store = createPromptJobStore(pool);
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = { ...await exportJWK(publicKey), kid: 'offline-proof', alg: 'RS256', use: 'sig' };
    authenticate = createMachineAuthenticator({ readPolicy: () => currentPolicy,
      createKeySet: () => createLocalJWKSet({ keys: [jwk] }) });
    const seconds = Math.floor(Date.now() / 1000);
    token = 'Bearer ' + await new SignJWT({ tid: config.tenantId, ver: '2.0', idtyp: 'app',
      azp: config.clientId, oid: config.servicePrincipalId, roles: [config.role], iat: seconds, nbf: seconds, exp: seconds + 600 })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer(`https://login.microsoftonline.com/${config.tenantId}/v2.0`)
      .setAudience(config.audience).sign(privateKey);
  });
  beforeEach(() => {
    currentPolicy = { ...config };
    currentGrant = { enabled: true, policyId: randomUUID(), requestId: randomUUID(), idempotencyKey: randomUUID(), principalKey };
    commandCapture.length = 0;
    proof = createMachineAdmissionProof({ authenticate, readGrant: () => currentGrant,
      store: { ...store, admit: async command => { commandCapture.push(command); return store.admit(command); } } });
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (schema) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    if (admin) await admin.end();
  });
  function args(extra = {}) {
    return { authorization: token, idempotencyKey: currentGrant.idempotencyKey,
      body: { requestId: currentGrant.requestId, taskKeys: [TASK], operation: 'generate-draft' }, ...extra };
  }
  async function counts(jobId) {
    const result = {};
    for (const table of ['prompt_job_tasks', 'prompt_job_content', 'prompt_job_initializations', 'prompt_job_publications']) {
      result[table] = Number((await pool.query(`SELECT count(*) FROM ${table} WHERE job_id=$1`, [jobId])).rows[0].count);
    }
    result.attempts = Number((await pool.query('SELECT count(*) FROM prompt_job_attempts a JOIN prompt_job_tasks t ON t.id=a.task_id WHERE t.job_id=$1', [jobId])).rows[0].count);
    return result;
  }
  test('concurrent duplicate admission commits one queued receipt and only one configuration; status/replay are stable', async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => proof.admit(args())));
    expect(new Set(responses.map(r => r.receipt.jobId)).size).toBe(1);
    const first = responses[0];
    expect(first).toEqual({ statusCode: 202, receipt: { jobId: expect.any(String), version: 1, state: 'queued', modelExecutionEnabled: false } });
    expect(await counts(first.receipt.jobId)).toEqual({ prompt_job_tasks: 1, prompt_job_content: 1,
      prompt_job_initializations: 0, prompt_job_publications: 0, attempts: 0 });
    const kinds = (await pool.query('SELECT kind FROM prompt_job_content WHERE job_id=$1', [first.receipt.jobId])).rows;
    expect(kinds).toEqual([{ kind: 'configuration' }]);
    expect(commandCapture.every(c => c.sourceEventId === null)).toBe(true);
    const status = await proof.read({ authorization: token, jobId: first.receipt.jobId });
    expect(status).toEqual({ statusCode: 200, receipt: first.receipt });
    expect(await proof.admit(args({ idempotencyKey: currentGrant.idempotencyKey.toUpperCase(),
      body: { requestId: currentGrant.requestId.toUpperCase(), taskKeys: [TASK], operation: 'generate-draft' } }))).toEqual(first);
    // After configuration retention expires, idempotency remains a receipt.
    await pool.query('DELETE FROM prompt_job_content WHERE job_id=$1', [first.receipt.jobId]);
    expect(await proof.admit(args())).toEqual(first);
  });
  test('known valid bearer reauthorizes before replay and polling', async () => {
    const admitted = await proof.admit(args());
    currentGrant.enabled = false;
    await expect(proof.admit(args())).rejects.toMatchObject({ httpStatus: 503 });
    await expect(proof.read({ authorization: token, jobId: admitted.receipt.jobId })).rejects.toMatchObject({ httpStatus: 503 });
    expect(commandCapture).toHaveLength(1);
  });
  test('foreign principal, request, and scope cannot read existing receipt', async () => {
    const admitted = await proof.admit(args());
    expect(await store.readJob({ jobId: admitted.receipt.jobId, environment: 'test', principalKey: 'human:fixture' })).toBeNull();
    currentGrant.requestId = randomUUID();
    await expect(proof.read({ authorization: token, jobId: admitted.receipt.jobId })).rejects.toMatchObject({ httpStatus: 404 });
    currentGrant.requestId = commandCapture[0].requestId;
    currentGrant.policyId = randomUUID();
    await expect(proof.read({ authorization: token, jobId: admitted.receipt.jobId })).rejects.toMatchObject({ httpStatus: 404 });
    currentGrant.principalKey = `app:entra-v2:${config.tenantId}:${randomUUID()}:${randomUUID()}`;
    await expect(proof.read({ authorization: token, jobId: admitted.receipt.jobId })).rejects.toMatchObject({ httpStatus: 403 });
  });
  test('authentication and closed request shape reject before persistence', async () => {
    await expect(proof.admit(args({ authorization: 'Bearer invalid' }))).rejects.toMatchObject({ httpStatus: 401 });
    for (const extra of [{ sourceEventId: 'untrusted' }, { principalKey: 'human:admin' }, { model: 'anything' }, { sourceUrl: 'https://example.com' }]) {
      await expect(proof.admit(args({ body: { ...args().body, ...extra } }))).rejects.toMatchObject({ httpStatus: 400 });
    }
    for (const body of [{ ...args().body, operation: 'initialize' }, { ...args().body, taskKeys: ['proposal.executive-summary'] },
      { ...args().body, taskKeys: [TASK, TASK] }]) {
      await expect(proof.admit(args({ body }))).rejects.toMatchObject({ httpStatus: 400 });
    }
    await expect(proof.admit(args({ body: { ...args().body, requestId: randomUUID() } }))).rejects.toMatchObject({ httpStatus: 403 });
    await expect(proof.admit(args({ idempotencyKey: randomUUID() }))).rejects.toMatchObject({ httpStatus: 403 });
    expect(commandCapture).toHaveLength(0);
  });
  test('policy change across SQL await hides committed receipt; exact reauthorized replay recovers', async () => {
    const original = { ...currentGrant };
    const changing = createMachineAdmissionProof({ authenticate, readGrant: () => currentGrant, store: { ...store,
      admit: async command => { const v = await store.admit(command); currentGrant.enabled = false; return v; } } });
    await expect(changing.admit(args())).rejects.toMatchObject({ httpStatus: 503 });
    const committed = await pool.query('SELECT id FROM prompt_jobs WHERE environment=$1 AND principal_key=$2 AND idempotency_key=$3',
      ['test', principalKey, original.idempotencyKey]);
    expect(committed.rows).toHaveLength(1);
    currentGrant = original;
    const recovered = await proof.admit(args());
    expect(recovered.receipt.state).toBe('queued');
    expect(recovered.receipt.jobId).toBe(committed.rows[0].id);
    expect((await pool.query('SELECT id FROM prompt_jobs WHERE environment=$1 AND principal_key=$2 AND idempotency_key=$3',
      ['test', principalKey, original.idempotencyKey])).rows).toHaveLength(1);
    expect(await counts(recovered.receipt.jobId)).toMatchObject({ prompt_job_tasks: 1, attempts: 0 });
  });
  test('status projection excludes present private fields and rejects any worker progress', async () => {
    const admitted = await proof.admit(args());
    const command = commandCapture[0];
    const view = await store.readJob({ jobId: admitted.receipt.jobId, environment: 'test', principalKey });
    expect(view.tasks[0].configuration_hash).toBeTruthy();
    const poisoned = { ...view, job: { ...view.job, privateNote: 'private-canary' }, tasks: view.tasks.map(t => ({ ...t, privateNote: 'private-canary' })) };
    const projected = createMachineAdmissionProof({ authenticate, readGrant: () => currentGrant, store: { readJob: async () => poisoned } });
    const output = await projected.read({ authorization: token, jobId: view.job.id });
    expect(JSON.stringify(output)).not.toContain('private-canary');
    expect(JSON.stringify(output)).not.toContain(view.tasks[0].configuration_hash);
    poisoned.tasks[0].state = 'dispatching';
    await expect(projected.read({ authorization: token, jobId: view.job.id })).rejects.toMatchObject({ httpStatus: 409 });
    // The real row remains untouched and has no source or attempt.
    expect(command.sourceEventId).toBeNull();
  });
  test('raw storage errors never expose diagnostic details in either operation', async () => {
    const privateError = Object.assign(new Error('private-schema-host-canary'), { detail: 'private-principal-canary' });
    const broken = createMachineAdmissionProof({ authenticate, readGrant: () => currentGrant,
      store: { admit: async () => { throw privateError; }, readJob: async () => { throw privateError; } } });
    for (const run of [() => broken.admit(args()), () => broken.read({ authorization: token, jobId: randomUUID() })]) {
      try { await run(); throw Error('expected rejection'); }
      catch (error) {
        expect(error).toMatchObject({ httpStatus: 503, code: 'admission_proof_unavailable', body: { error: 'admission_proof_unavailable' } });
        expect(error.message).toBe('admission_proof_unavailable');
        expect(error.detail).toBeUndefined();
        expect(error.cause).toBeUndefined();
      }
    }
  });
  test.each([null, '', ' ', 'Staff revision'])('delivery baseline is preserved by actual ledger capture: %j', async value => {
    await proof.admit(args());
    const base = commandCapture[0];
    const admitted = await store.admit({ ...base, operation: 'initialize', idempotencyKey: randomUUID(), sourceEventId: 'fixture-event' });
    const delivery = createRequestFieldDelivery({ authorize: async () => true,
      readRequest: async () => ({ _etag: 'W/"baseline"', [TITLE_DESTINATION]: value }),
      patchRequest: async () => { throw Error('No writes in capture proof'); } });
    const target = await delivery.readTarget({ job: admitted.job,
      tasks: [{ task_key: 'grantee-title.generate', destination_field: TITLE_DESTINATION }] });
    const claim = await store.claim({ jobId: admitted.job.id });
    const fence = { jobId: admitted.job.id, leaseToken: claim.leaseToken };
    // The current ledger enables only synthetic initialization. Test its opaque
    // baseline/hash contract under that fixture label; this is NOT production
    // admission of grantee-title.generate or a physical field mapping.
    await store.captureTarget({ ...fence, etag: target.etag, fields: { fixture_summary: target.fields[TITLE_DESTINATION] } });
    const baseline = (await pool.query('SELECT initially_blank,initial_content_hash FROM prompt_job_initializations WHERE job_id=$1', [admitted.job.id])).rows;
    expect(baseline).toEqual([{ initially_blank: value === null || value === '', initial_content_hash: sha256(canonical(value)) }]);
    await store.releaseClaim(fence);
    const view = await store.readJob({ jobId: admitted.job.id, environment: 'test', principalKey });
    const status = projectMachineJob(view);
    expect(status.state).toBe(value === null || value === '' ? 'running' : 'failed');
    expect(status.tasks[0].errorCode).toBe(value === null || value === '' ? null : 'protected_staff_content');
  });
  async function initializedThroughAudit(withProtectedSibling = false) {
    await proof.admit(args());
    const base = commandCapture[0];
    const taskInputs = JSON.parse(JSON.stringify(base.tasks));
    if (withProtectedSibling) {
      const second = JSON.parse(JSON.stringify(taskInputs[0]));
      second.taskKey = 'synthetic.methodology';
      second.configuration.promptRow.wmkf_ai_promptname = second.taskKey;
      second.configuration.promptRow.wmkf_ai_promptoutputschema = JSON.stringify({ parseMode: 'raw', outputs: [{ name: 'methodology', target: { kind: 'none' }, maxChars: 12000 }] });
      taskInputs.push(second);
    }
    const admitted = await store.admit({ ...base, tasks: taskInputs, operation: 'initialize', idempotencyKey: randomUUID(), sourceEventId: 'fixture-event' });
    const jobId = admitted.job.id;
    const projected = async () => projectMachineJob(await store.readJob({ jobId, environment: 'test', principalKey }));
    expect((await projected()).state).toBe('queued');
    const claim = await store.claim({ jobId });
    const fence = { jobId, leaseToken: claim.leaseToken };
    const config = base.tasks[0].configuration;
    await store.saveSnapshot({ ...fence, snapshot: { scope: config.scope, profileHash: hashProfile(config.profile), documents: [{ text: 'Offline fixture' }] } });
    expect((await projected()).state).toBe('running');
    await store.captureTarget({ ...fence, etag: 'W/"baseline"', fields: { fixture_summary: { blank: true, sha256: sha256(canonical(null)) },
      ...(withProtectedSibling ? { fixture_methodology: { blank: false, sha256: sha256(canonical('Staff content')) } } : {}) } });
    expect((await projected()).state).toBe('running');
    const taskId = admitted.tasks[0].id;
    const attempt = await store.markDispatching({ ...fence, taskId });
    expect((await projected()).tasks[0].generationState).toBe('dispatching');
    const attemptFence = { ...fence, taskId, attemptId: attempt.id };
    await store.saveResponse({ ...attemptFence, response: { version: 1, response: { text: 'To explore cell signaling' } } });
    expect((await projected()).tasks[0].generationState).toBe('response_saved');
    await store.saveValidated({ ...attemptFence, result: 'To explore cell signaling', deferredAudit: { fixture: 'audit' } });
    expect((await projected()).state).toBe('running');
    await store.markAuditDispatching(attemptFence);
    expect((await projected()).state).toBe('running');
    await store.markAudit({ ...attemptFence, outcome: 'delivered' });
    expect((await projected()).state).toBe('running');
    const publication = await store.freezePublication(fence);
    expect((await projected()).state).toBe('running');
    return { jobId, fence, publication, projected, scope: { environment: 'test', principalKey,
      authorizationScope: base.authorizationScope, requestId: base.requestId } };
  }
  test.each(['applied', 'conflict', 'unknown', 'expired'])('real initialize lifecycle projects every transition through %s and retention', async outcome => {
    const { jobId, fence, publication, projected, scope } = await initializedThroughAudit();
    if (outcome !== 'expired') {
      await store.markPublicationDispatched({ ...fence, operationId: publication.id });
      expect((await projected()).state).toBe('running');
    }
    await store.finishPublication({ ...fence, operationId: publication.id, outcome });
    expect((await projected()).state).toBe(outcome === 'applied' ? 'succeeded' : 'needs_attention');
    await store.releaseClaim(fence);
    await pool.query("UPDATE prompt_jobs SET source_expires_at=clock_timestamp()-interval '2 seconds',result_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [jobId]);
    await pool.query("UPDATE prompt_job_content SET expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1", [jobId]);
    await store.expireContent({ scope });
    expect((await counts(jobId)).prompt_job_content).toBe(0);
    expect((await projected()).state).toBe(outcome === 'applied' ? 'succeeded' : 'needs_attention');
  });
  test('real partial initialization retains protected sibling while applying the validated task', async () => {
    const { fence, publication, projected } = await initializedThroughAudit(true);
    await store.markPublicationDispatched({ ...fence, operationId: publication.id });
    await store.finishPublication({ ...fence, operationId: publication.id, outcome: 'applied' });
    const view = await projected();
    expect(view.state).toBe('partial');
    expect(view.tasks.map(t => [t.taskKey, t.writebackState])).toEqual([
      ['synthetic.executive-summary', 'applied'], ['synthetic.methodology', 'blocked'],
    ]);
    expect(view.tasks[1].errorCode).toBe('protected_staff_content');
    await store.releaseClaim(fence);
  });
  test.each(['expired-before-dispatch', 'expired-after-response', 'failed-validation', 'unknown-provider'])('real draft failure tuple is projectable: %s', async outcome => {
    const admitted = await proof.admit(args());
    const jobId = admitted.receipt.jobId;
    const base = commandCapture[0];
    const claim = await store.claim({ jobId });
    const fence = { jobId, leaseToken: claim.leaseToken, taskId: claim.tasks[0].id };
    let attemptId;
    if (outcome !== 'expired-before-dispatch') {
      const config = base.tasks[0].configuration;
      await store.saveSnapshot({ ...fence, snapshot: { scope: config.scope, profileHash: hashProfile(config.profile), documents: [{ text: 'Offline fixture' }] } });
      attemptId = (await store.markDispatching(fence)).id;
      if (outcome !== 'unknown-provider') await store.saveResponse({ ...fence, attemptId, response: { version: 1, response: { text: 'Offline response' } } });
    }
    const unknown = outcome === 'unknown-provider';
    const failedValidation = outcome === 'failed-validation';
    await store.markAttemptFailed({ ...fence, ...(attemptId ? { attemptId } : {}),
      outcome: unknown ? 'unknown' : failedValidation ? 'failed_validation' : 'expired',
      errorCode: unknown ? 'provider_outcome_unknown' : failedValidation ? 'profile_output_invalid' : 'content_expired',
      ...(failedValidation ? { deferredAudit: { fixture: 'failed audit' } } : {}) });
    const projected = async () => projectMachineJob(await store.readJob({ jobId, environment: 'test', principalKey }));
    expect((await projected()).state).toBe(unknown ? 'needs_attention' : failedValidation ? 'running' : 'failed');
    if (failedValidation) {
      await store.markAuditDispatching({ ...fence, attemptId });
      await store.markAudit({ ...fence, attemptId, outcome: 'delivered' });
      expect((await projected()).state).toBe('failed');
    }
    await store.releaseClaim(fence);
  });
  test('existing worker checkpoints a writer authorization throw as unknown, not perpetual dispatching', async () => {
    const { jobId, fence, projected } = await initializedThroughAudit();
    await store.releaseClaim(fence);
    const patchRequest = jest.fn();
    const delivery = createRequestFieldDelivery({ authorize: async () => false, readRequest: jest.fn(), patchRequest });
    const result = await advanceJob({ jobId, store, executePrompt: async () => { throw Error('No model expected'); },
      authorize: async () => true, checkFreshness: async () => true,
      // Explicit fixture-to-physical label translation for this offline catch
      // proof only. No actual title capability or live writer is enabled.
      writer: command => delivery.writer({ ...command, fields: { [TITLE_DESTINATION]: command.fields.fixture_summary } }),
    });
    expect(result).toEqual({ stage: 'unknown' });
    expect(patchRequest).not.toHaveBeenCalled();
    expect((await projected()).state).toBe('needs_attention');
    expect((await projected()).pollAfterSeconds).toBeNull();
  });
  test('ledger arbitrates racing conflicting payloads with one winner and no partial children', async () => {
    await proof.admit(args());
    const base = commandCapture[0];
    const idempotencyKey = randomUUID();
    const commands = [null, 'different-event'].map(sourceEventId => ({ ...base, idempotencyKey, sourceEventId }));
    const outcomes = await Promise.allSettled(commands.map(c => store.admit(c)));
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const failed = outcomes.find(r => r.status === 'rejected');
    expect(failed.reason).toMatchObject({ httpStatus: 409, code: 'prompt_job_idempotency_key_reused' });
    const winner = outcomes.find(r => r.status === 'fulfilled').value;
    expect(await counts(winner.job.id)).toEqual({ prompt_job_tasks: 1, prompt_job_content: 1,
      prompt_job_initializations: 0, prompt_job_publications: 0, attempts: 0 });
  });
});
