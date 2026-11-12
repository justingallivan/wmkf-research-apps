/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from 'jose';
import pg from 'pg';
import { createMachineAuthenticator } from '../../lib/services/prompt-jobs/machine-auth.js';
import { createMachineAdmissionProof } from '../../lib/services/prompt-jobs/machine-admission-proof.js';
import { createPromptJobStore } from '../../lib/services/prompt-jobs/store.js';

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
