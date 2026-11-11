/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { canonical, hashProfile, sha256 } from '../../lib/services/prompt-jobs/profile.js';
import { createPromptJobStore } from '../../lib/services/prompt-jobs/store.js';

const url = process.env.PROMPT_JOB_PG_TEST_URL || '';
if (!url && process.env.PROMPT_JOB_PG_TEST_REQUIRE === '1') {
  throw new Error('PROMPT_JOB_PG_TEST_URL is required for the real PostgreSQL proof.');
}
if (url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Invalid prompt-job scratch PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['127.0.0.1', '[::1]'].includes(parsed.hostname)
    || !parsed.port || parsed.pathname.length < 2 || parsed.search || parsed.hash || url === process.env.POSTGRES_URL) {
    throw new Error('Prompt-job proof requires an explicit loopback scratch PostgreSQL URL without options.');
  }
}
const describePg = url ? describe : describe.skip;

const SUMMARY = 'synthetic.executive-summary';
const METHODOLOGY = 'synthetic.methodology';
const PROPOSAL_SUMMARY = 'proposal.executive-summary';
const PROPOSAL_METHODOLOGY = 'proposal.methodology';
const profile = {
  key: 'proposal-analysis', revision: 1, wrapperVersion: 1, sharedInstructions: 'Analyze the fixture.',
  documentRoles: ['proposal'], recordNames: [],
  limits: { maxDocuments: 1, maxDocumentBytes: 3000, maxTotalDocumentBytes: 3000, maxRecordBytes: 1000 },
};
const profileHash = hashProfile(profile);
const proposalProfile = { ...profile, recordNames: ['pi_name'] };
const blankField = { blank: true, sha256: sha256('') };
const baseline = { fixture_summary: blankField, fixture_methodology: blankField };
const response = {
  version: 1, binding: sha256('fixture'),
  response: { text: 'Temporary fixture response.', model: 'claude-sonnet-4-6', stopReason: 'end_turn',
    usageComplete: true, usage: { input_tokens: 120, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 10 } },
};
const audit = { status: 'completed' };

function fixtureTask(taskKey, scope) {
  const proposal = taskKey.startsWith('proposal.');
  const taskProfile = proposal ? proposalProfile : profile;
  const variables = [{ name: 'proposal_context', source: { kind: 'prepared_context' }, required: true }];
  if (proposal) variables.push({ name: 'pi_name', source: { kind: 'frozen_record' }, required: true });
  const output = taskKey.endsWith('.executive-summary') ? { name: 'summary', maxWords: 200 }
    : { name: 'methodology', maxChars: 12_000 };
  const promptRow = {
    wmkf_ai_promptid: randomUUID(),
    wmkf_ai_promptname: taskKey,
    wmkf_promptversion: 1,
    wmkf_ai_systemprompt: '',
    wmkf_ai_promptbody: proposal ? 'Analyze the proposal using {{pi_name}}.' : 'Analyze the synthetic proposal.',
    wmkf_ai_model: 'claude-sonnet-4-6',
    wmkf_ai_maxtokens: 1000,
    wmkf_ai_temperature: 0,
    wmkf_ai_promptvariables: JSON.stringify({
      execution: { contractVersion: 1, mode: 'shared-document-task', profile: { key: taskProfile.key, revision: 1, sha256: hashProfile(taskProfile) } },
      variables,
    }),
    wmkf_ai_promptoutputschema: JSON.stringify({ parseMode: 'raw', outputs: [{ ...output, target: { kind: 'none' } }] }),
  };
  return { taskKey, configuration: { promptRow, profile: taskProfile, scope } };
}

function input(overrides = {}, keys = [SUMMARY, METHODOLOGY]) {
  const environment = 'test';
  const requestId = randomUUID();
  const now = Date.now();
  const command = {
    environment, principalKey: 'human:trial-staff', authorizationScope: 'proposal:fixture', requestId,
    idempotencyKey: randomUUID(), operation: 'initialize', sourceEventId: 'event-1',
    sourceExpiresAt: new Date(now + 60_000), resultExpiresAt: new Date(now + 120_000), ...overrides,
  };
  command.tasks = overrides.tasks || keys.map(taskKey => fixtureTask(taskKey, {
    environment: command.environment, authorizationScope: command.authorizationScope, requestId: command.requestId,
  }));
  return command;
}

function proposalInput(overrides = {}, keys = [PROPOSAL_SUMMARY, PROPOSAL_METHODOLOGY]) {
  return input({ environment: 'local-sandbox', authorizationScope: `proposal-trial:${randomUUID()}`,
    operation: 'generate-draft', sourceEventId: null, ...overrides }, keys);
}

describePg('durable shared Executor ledger on PostgreSQL', () => {
  let admin;
  let pool;
  let schema;
  let store;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    schema = `prompt_jobs_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 6 });
    await pool.query(readFileSync('lib/db/migrations/097_shared_prompt_jobs.sql', 'utf8'));
    store = createPromptJobStore(pool);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (schema) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    if (admin) await admin.end();
  });

  function scope(command) {
    return { environment: command.environment, authorizationScope: command.authorizationScope, requestId: command.requestId };
  }

  async function open(command = input(), fields = baseline, etag = 'W/"baseline"') {
    const admitted = await store.admit(command);
    const claim = await store.claim({ jobId: admitted.job.id });
    const fence = { jobId: claim.job.id, leaseToken: claim.leaseToken };
    const snapshot = { scope: scope(command), profileHash, documents: [{ text: 'Temporary fixture document.' }] };
    await store.saveSnapshot({ ...fence, snapshot });
    if (command.operation === 'initialize') await store.captureTarget({ ...fence, etag, fields });
    return { ...admitted, claim, fence, snapshot };
  }

  async function expireLease(jobId) {
    await pool.query("UPDATE prompt_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1", [jobId]);
  }

  async function checkpoint(fence, taskId) {
    const attempt = await store.markDispatching({ ...fence, taskId });
    const saved = await store.saveResponse({ ...fence, taskId, attemptId: attempt.id, response });
    return saved;
  }

  async function validate(fence, taskId, result = 'Approved fixture prose.') {
    const attempt = await checkpoint(fence, taskId);
    const validated = await store.saveValidated({ ...fence, taskId, attemptId: attempt.id, result, deferredAudit: audit });
    expect(validated.state).toBe('validated');
    return { ...fence, taskId, attemptId: attempt.id };
  }

  async function deliverAudit(attempt) {
    expect(await store.markAuditDispatching(attempt)).toMatchObject({ audit_state: 'dispatching' });
    expect(await store.markAudit({ ...attempt, outcome: 'delivered' })).toMatchObject({ audit_state: 'delivered' });
  }

  it('atomically caps a proposal cohort across concurrent distinct keys, Requests, actors and environments', async () => {
    const first = proposalInput();
    const second = proposalInput({ requestId: first.requestId, authorizationScope: first.authorizationScope });
    const third = proposalInput({ environment: 'preview-sandbox', principalKey: 'human:other', authorizationScope: first.authorizationScope });
    const outcome = await Promise.allSettled([first, second, third].map(command => store.admit(command)));
    expect(outcome.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(outcome.filter(x => x.status === 'rejected').map(x => x.reason.code)).toEqual(['prompt_job_trial_limit', 'prompt_job_trial_limit']);
    const { job, tasks } = outcome.find(x => x.status === 'fulfilled').value;
    expect(tasks.map(task => [task.task_key, task.destination_field, task.writeback_state])).toEqual([
      [PROPOSAL_SUMMARY, null, 'not_requested'], [PROPOSAL_METHODOLOGY, null, 'not_requested'],
    ]);
    expect((await pool.query('SELECT count(*)::int AS count FROM prompt_jobs WHERE authorization_scope = $1', [first.authorizationScope])).rows[0].count).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS count FROM prompt_job_initializations WHERE job_id = $1', [job.id])).rows[0].count).toBe(0);
    await pool.query("UPDATE prompt_job_content SET expires_at = clock_timestamp() - interval '1 second' WHERE job_id = $1", [job.id]);
    await store.expireContent();
    await expect(store.admit(proposalInput({ authorizationScope: first.authorizationScope }))).rejects.toMatchObject({ code: 'prompt_job_trial_limit' });
  });

  it('re-finds an identical concurrent proposal receipt before quota and skips re-resolved configuration on replay', async () => {
    const command = proposalInput({ environment: 'local-production' });
    const [a, b] = await Promise.all([store.admit(command), store.admit({ ...command, tasks: [...command.tasks].reverse() })]);
    expect(a.job.id).toBe(b.job.id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const tasks = command.tasks.map(({taskKey}) => ({taskKey}));
    const replay = await store.admit({ ...command, tasks, sourceExpiresAt: undefined, resultExpiresAt: undefined });
    expect(replay).toMatchObject({ job: { id: a.job.id }, tasks: a.tasks, replayed: true });
    await expect(store.admit({ ...command, requestId: randomUUID() })).rejects.toMatchObject({ code: 'prompt_job_idempotency_key_reused' });
  });

  it('expires only matching trial content while preserving live content, receipts and quota', async () => {
    const command = proposalInput();
    const selected = await store.admit(command);
    const otherCommand = proposalInput({ requestId: command.requestId });
    const other = await store.admit(otherCommand);
    const selectedScope = { ...scope(command), principalKey: command.principalKey };
    const expiredIds = [selected.tasks[0].configuration_content_id, other.tasks[0].configuration_content_id];
    await pool.query("UPDATE prompt_job_content SET expires_at = clock_timestamp() - interval '1 second' WHERE id = ANY($1::uuid[])", [expiredIds]);
    await expect(store.expireContent({ scope: { ...selectedScope, requestId: undefined } })).rejects.toMatchObject({ code: 'invalid_prompt_job_id' });
    for (const changed of [
      { environment: 'preview-sandbox' }, { principalKey: 'human:other' },
      { authorizationScope: `proposal-trial:${randomUUID()}` }, { requestId: randomUUID() },
    ]) {
      expect(await store.expireContent({ scope: { ...selectedScope, ...changed } })).toBe(0);
    }
    expect(await store.expireContent({ scope: selectedScope })).toBe(1);
    const { rows } = await pool.query('SELECT id FROM prompt_job_content WHERE job_id = ANY($1::uuid[])', [[selected.job.id, other.job.id]]);
    expect(rows.map(row => row.id).sort()).toEqual([
      selected.tasks[1].configuration_content_id, ...other.tasks.map(task => task.configuration_content_id),
    ].sort());
    expect(await store.listJobs(selectedScope)).toEqual([{ job: selected.job, tasks: selected.tasks, attempts: [], publication: null }]);
    expect(await store.admit(command)).toMatchObject({ job: { id: selected.job.id }, replayed: true });
    await expect(store.admit({ ...command, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'prompt_job_trial_limit' });
    expect(await store.expireContent({ scope: { ...scope(otherCommand), principalKey: otherCommand.principalKey } })).toBe(1);
  });

  it('refuses proposal admission outside the bounded draft capability or with a destination override', async () => {
    const command = proposalInput();
    const invalidCommands = [
      proposalInput({ environment: 'production' }),
      proposalInput({ environment: 'test' }),
      proposalInput({ operation: 'initialize', sourceEventId: 'forbidden-event' }),
      proposalInput({}, [PROPOSAL_SUMMARY]),
      proposalInput({}, [PROPOSAL_SUMMARY, PROPOSAL_SUMMARY]),
      proposalInput({}, [PROPOSAL_SUMMARY, METHODOLOGY]),
      proposalInput({ authorizationScope: 'proposal-trial:AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }),
      proposalInput({ authorizationScope: 'proposal:unbounded' }),
    ];
    for (const invalid of invalidCommands) {
      await expect(store.admit(invalid)).rejects.toMatchObject({ code: 'invalid_prompt_job_admission' });
    }
    const [summary, methodology] = command.tasks;
    await expect(store.admit({ ...command, tasks: [{ ...summary, destinationField: 'fixture_summary' }, methodology] }))
      .rejects.toMatchObject({ code: 'invalid_prompt_job_configuration' });
    expect(await store.admit(command)).toMatchObject({ replayed: false });
  });

  it('finds the oldest exact-scope actionable draft while skipping terminal and uncertain work', async () => {
    const command = input({ operation: 'generate-draft' }, [SUMMARY]);
    const readScope = { ...scope(command), principalKey: command.principalKey };
    const next = () => input({ ...readScope, operation: 'generate-draft' }, [SUMMARY]);
    const completed = await open(next());
    await deliverAudit(await validate(completed.fence, completed.tasks[0].id));
    await store.releaseClaim(completed.fence);
    const failed = await open(next());
    await store.markAttemptFailed({ ...failed.fence, taskId: failed.tasks[0].id, outcome: 'failed_pre_dispatch', errorCode: 'fixture_failure' });
    await store.releaseClaim(failed.fence);
    for (const outcome of ['failed', 'unknown']) {
      const auditJob = await open(next());
      const attempt = await validate(auditJob.fence, auditJob.tasks[0].id);
      await store.markAuditDispatching(attempt);
      await store.markAudit({ ...attempt, outcome });
      await store.releaseClaim(auditJob.fence);
    }
    const uncertain = await open(next());
    const attempt = await store.markDispatching({ ...uncertain.fence, taskId: uncertain.tasks[0].id });
    await store.markAttemptFailed({ ...uncertain.fence, taskId: uncertain.tasks[0].id, attemptId: attempt.id, outcome: 'unknown', errorCode: 'fixture_uncertainty' });
    await store.releaseClaim(uncertain.fence);
    expect(await store.findRunnableJob(readScope)).toBeNull();

    const first = await store.admit(next());
    const second = await store.admit(next());
    await pool.query("UPDATE prompt_jobs SET created_at = '2026-01-02T00:00:00Z' WHERE id = ANY($1::uuid[])", [[first.job.id, second.job.id]]);
    expect(await store.findRunnableJob(readScope)).toEqual({ id: [first.job.id, second.job.id].sort()[0] });
    expect(await store.findRunnableJob({ ...readScope, principalKey: 'human:other' })).toBeNull();
    expect(await store.findRunnableJob({ ...readScope, authorizationScope: 'proposal:other' })).toBeNull();
    expect(await store.findRunnableJob({ ...readScope, requestId: randomUUID() })).toBeNull();
    expect(await store.findRunnableJob({ ...readScope, environment: 'preview-sandbox' })).toBeNull();
  });

  it('selects recoverable expired dispatches and saved response or pending audit, while excluding live leases', async () => {
    const command = input({ operation: 'generate-draft' }, [SUMMARY]);
    const readScope = { ...scope(command), principalKey: command.principalKey };
    const dispatching = await open(command);
    await store.markDispatching({ ...dispatching.fence, taskId: dispatching.tasks[0].id });
    expect(await store.findRunnableJob(readScope)).toBeNull();
    await expireLease(dispatching.job.id);
    expect(await store.findRunnableJob(readScope)).toEqual({ id: dispatching.job.id });
    const recovered = await store.claim({ jobId: dispatching.job.id });
    expect(recovered.tasks[0].state).toBe('unknown');
    await store.releaseClaim({ jobId: dispatching.job.id, leaseToken: recovered.leaseToken });
    expect(await store.findRunnableJob(readScope)).toBeNull();

    const later = input({ operation: 'generate-draft' }, [SUMMARY]);
    const laterScope = { ...scope(later), principalKey: later.principalKey };
    const saved = await open(later);
    const attempt = await checkpoint(saved.fence, saved.tasks[0].id);
    await store.releaseClaim(saved.fence);
    expect(await store.findRunnableJob(laterScope)).toEqual({ id: saved.job.id });
    const validating = await store.claim({ jobId: saved.job.id });
    const fence = { jobId: saved.job.id, leaseToken: validating.leaseToken };
    await store.saveValidated({ ...fence, taskId: saved.tasks[0].id, attemptId: attempt.id, result: 'Approved draft.', deferredAudit: audit });
    await store.releaseClaim(fence);
    expect(await store.findRunnableJob(laterScope)).toEqual({ id: saved.job.id });
    const auditing = await store.claim({ jobId: saved.job.id });
    await store.markAuditDispatching({ jobId: saved.job.id, leaseToken: auditing.leaseToken, taskId: saved.tasks[0].id, attemptId: attempt.id });
    await expireLease(saved.job.id);
    expect(await store.findRunnableJob(laterScope)).toEqual({ id: saved.job.id });
    const auditRecovered = await store.claim({ jobId: saved.job.id });
    expect(auditRecovered.attempts[0].audit_state).toBe('unknown');
  });

  it('lists only jobs in the full Request scope, with a bounded stable newest-first order', async () => {
    const command = input({ operation: 'generate-draft' }, [SUMMARY]);
    const readScope = { ...scope(command), principalKey: command.principalKey };
    const admissions = [];
    for (let index = 0; index < 6; index += 1) {
      admissions.push(await store.admit({ ...command, idempotencyKey: randomUUID() }));
    }
    const ids = admissions.map(({job}) => job.id);
    const newest = ids.pop();
    await pool.query("UPDATE prompt_jobs SET created_at = '2026-01-01T00:00:00Z' WHERE id = ANY($1::uuid[])", [ids]);
    await pool.query("UPDATE prompt_jobs SET created_at = '2026-01-02T00:00:00Z' WHERE id = $1", [newest]);

    for (const overrides of [{ principalKey: 'human:other' }, { requestId: randomUUID() }, { authorizationScope: 'proposal:other' }]) {
      await store.admit(input({ ...readScope, ...overrides, operation: 'generate-draft' }, [SUMMARY]));
    }
    const foreign = await store.admit({ ...command, idempotencyKey: randomUUID() });
    // Admission stays synthetic-only. Seed a distinct environment for the read isolation proof.
    await pool.query("UPDATE prompt_jobs SET environment = 'preview' WHERE id = $1", [foreign.job.id]);

    const expected = [newest, ...ids.sort().reverse()];
    expect((await store.listJobs(readScope)).map(({job}) => job.id)).toEqual(expected.slice(0, 5));
    expect((await store.listJobs({ ...readScope, limit: 10 })).map(({job}) => job.id)).toEqual(expected);
    expect((await store.listJobs({ ...readScope, environment: 'preview' })).map(({job}) => job.id)).toEqual([foreign.job.id]);
    await expect(store.listJobs({ ...readScope, limit: 11 })).rejects.toMatchObject({ code: 'invalid_prompt_job_list_limit' });
    await expect(store.listJobs({ ...readScope, authorizationScope: undefined })).rejects.toMatchObject({ code: 'invalid_prompt_job_read_scope' });
    await expect(store.listJobs({ ...readScope, requestId: undefined })).rejects.toMatchObject({ code: 'invalid_prompt_job_id' });
  });

  it('returns only validated results for the exact Request and actor scope, even beside a raw checkpoint', async () => {
    const command = input({ operation: 'generate-draft' });
    const { job, tasks, fence } = await open(command);
    const readScope = { ...scope(command), principalKey: command.principalKey, jobId: job.id };
    await validate(fence, tasks[0].id, 'Approved staff draft.');
    const responseAttempt = await checkpoint(fence, tasks[1].id);
    const expected = [{ taskId: tasks[0].id, taskKey: SUMMARY, status: 'available', text: 'Approved staff draft.' }];
    const read = await store.readValidatedResults(readScope);
    expect(read).toEqual({ jobId: job.id, version: expect.any(Number), expiresAt: job.result_expires_at, results: expected });
    expect(JSON.stringify(read)).not.toMatch(/Temporary fixture|Analyze the synthetic proposal|configuration_content_id/);

    for (const overrides of [
      { principalKey: 'human:other' }, { requestId: randomUUID() }, { authorizationScope: 'proposal:other' },
      { environment: 'preview' }, { jobId: randomUUID() },
    ]) {
      expect(await store.readValidatedResults({ ...readScope, ...overrides })).toBeNull();
    }
    await expect(store.readValidatedResults({ ...readScope, environment: undefined })).rejects.toMatchObject({ code: 'invalid_prompt_job_read_scope' });
    await store.markAttemptFailed({
      ...fence, taskId: tasks[1].id, attemptId: responseAttempt.id,
      outcome: 'failed_validation', errorCode: 'invalid_fixture', deferredAudit: { status: 'failed' },
    });
    expect((await store.readValidatedResults(readScope)).results).toEqual(expected);
  });

  it('refuses a validated result pointing at a different content kind even with a matching hash', async () => {
    const command = input({ operation: 'generate-draft' });
    const { job, tasks, fence } = await open(command);
    await validate(fence, tasks[0].id);
    const attempt = await checkpoint(fence, tasks[1].id);
    const payload = JSON.stringify('Raw checkpoint text must never surface.');
    const hash = sha256(payload);
    await pool.query('UPDATE prompt_job_content SET payload = $2, sha256 = $3, size_bytes = octet_length($2) WHERE id = $1', [attempt.response_content_id, payload, hash]);
    await pool.query('UPDATE prompt_job_tasks SET result_content_id = $2, result_hash = $3 WHERE id = $1', [tasks[0].id, attempt.response_content_id, hash]);
    await expect(store.readValidatedResults({ ...scope(command), principalKey: command.principalKey, jobId: job.id }))
      .rejects.toMatchObject({ code: 'prompt_job_content_integrity' });
  });

  it('reports expired results and checks both the stored bytes and the pinned job deadline', async () => {
    const command = input({ operation: 'generate-draft' }, [SUMMARY]);
    const { job, tasks, fence } = await open(command);
    const readScope = { ...scope(command), principalKey: command.principalKey, jobId: job.id };
    const original = 'Approved staff draft.';
    await validate(fence, tasks[0].id, original);
    const [{ result_content_id: id }] = (await pool.query('SELECT result_content_id FROM prompt_job_tasks WHERE id = $1', [tasks[0].id])).rows;
    await pool.query('UPDATE prompt_job_content SET payload = $2, size_bytes = octet_length($2) WHERE id = $1', [id, JSON.stringify('Tampered draft.')]);
    await expect(store.readValidatedResults(readScope)).rejects.toMatchObject({ code: 'prompt_job_content_integrity' });
    await pool.query(`UPDATE prompt_job_content SET payload = $2, size_bytes = octet_length($2),
      expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`, [id, JSON.stringify(original)]);
    const expired = [{ taskId: tasks[0].id, taskKey: SUMMARY, status: 'expired' }];
    expect((await store.readValidatedResults(readScope)).results).toEqual(expired);
    await pool.query("UPDATE prompt_job_content SET expires_at = clock_timestamp() + interval '1 day' WHERE id = $1", [id]);
    await pool.query(`UPDATE prompt_jobs SET source_expires_at = clock_timestamp() - interval '2 seconds',
      result_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`, [job.id]);
    expect((await store.readValidatedResults(readScope)).results).toEqual(expired);
    await pool.query('DELETE FROM prompt_job_content WHERE id = $1', [id]);
    expect((await store.readValidatedResults(readScope)).results).toEqual(expired);
  });

  it('staff reads leave a worker lease and interrupted attempt untouched', async () => {
    const command = input({ operation: 'generate-draft' });
    const { job, tasks, fence } = await open(command);
    await validate(fence, tasks[0].id);
    const interrupted = await store.markDispatching({ ...fence, taskId: tasks[1].id });
    await expireLease(job.id);
    const readScope = { ...scope(command), principalKey: command.principalKey };
    const readLease = async () => (await pool.query('SELECT version, lease_token, lease_expires_at FROM prompt_jobs WHERE id = $1', [job.id])).rows[0];
    const before = await readLease();
    const [listed] = await store.listJobs(readScope);
    expect(listed.job).not.toHaveProperty('lease_token');
    expect(listed.attempts.find(attempt => attempt.id === interrupted.id).state).toBe('dispatching');
    expect(await store.readValidatedResults({ ...readScope, jobId: job.id })).toMatchObject({ version: before.version });
    expect(await readLease()).toEqual(before);
    expect((await pool.query('SELECT state FROM prompt_job_attempts WHERE id = $1', [interrupted.id])).rows[0].state).toBe('dispatching');
  });

  it('atomically admits one job under concurrency, scopes replay, and preserves the original frozen configuration', async () => {
    const command = input();
    const [a, b] = await Promise.all([store.admit(command), store.admit(command)]);
    expect(a.job.id).toBe(b.job.id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.tasks).toHaveLength(2);
    const replay = await store.admit({ ...command, tasks: [...command.tasks].reverse().map(({ taskKey }) => ({ taskKey })) });
    expect(replay.tasks).toEqual(a.tasks);
    await expect(store.admit({ ...command, sourceEventId: 'event-changed' })).rejects.toMatchObject({ code: 'prompt_job_idempotency_key_reused' });
    await expect(store.admit({ ...command, authorizationScope: 'proposal:other' })).rejects.toMatchObject({ code: 'prompt_job_idempotency_key_reused' });
    await expect(store.readJob({ jobId: a.job.id, environment: 'test', principalKey: 'human:other' })).resolves.toBeNull();
    expect(a.tasks[0].prompt_hash).toBe(sha256(canonical(command.tasks[0].configuration.promptRow)));
    expect((await pool.query('SELECT count(*)::int AS count FROM prompt_job_content WHERE job_id = $1', [a.job.id])).rows[0].count).toBe(2);
  });

  it('checks fixed task capabilities and scope before mutation', async () => {
    const command = input();
    const [summary, methodology] = command.tasks;
    for (const tasks of [
      [{ ...summary, promptHash: 'a'.repeat(64) }, methodology],
      [{ ...summary, profileHash: 'a'.repeat(64) }, methodology],
      [{ ...summary, model: 'other' }, methodology],
      [{ ...summary, destinationField: 'real_field' }, methodology],
      [{ ...summary, configuration: { ...summary.configuration, promptRow: { ...summary.configuration.promptRow, wmkf_ai_maxtokens: 1537 } } }, methodology],
      [{ ...summary, configuration: { ...summary.configuration, promptRow: { ...summary.configuration.promptRow, wmkf_ai_temperature: 2 } } }, methodology],
      [{ ...summary, configuration: { ...summary.configuration, scope: { ...summary.configuration.scope, requestId: randomUUID() } } }, methodology],
    ]) {
      await expect(store.admit({ ...command, tasks })).rejects.toMatchObject({ code: 'invalid_prompt_job_configuration' });
    }
    const admitted = await store.admit(command);
    expect(admitted.replayed).toBe(false);
    expect(admitted.tasks.map(task => task.destination_field)).toEqual(['fixture_summary', 'fixture_methodology']);
  });

  it('arbitrates concurrent initialization slots across different events and rolls back the losing job', async () => {
    const first = input();
    const second = input({ requestId: first.requestId, sourceEventId: 'event-2' });
    const results = await Promise.allSettled([store.admit(first), store.admit(second)]);
    expect(results.map(x => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.find(x => x.status === 'rejected').reason).toMatchObject({ code: 'prompt_job_initialization_reserved' });
    expect((await pool.query('SELECT count(*)::int AS count FROM prompt_jobs WHERE request_id = $1', [first.requestId])).rows[0].count).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS count FROM prompt_job_initializations WHERE request_id = $1', [first.requestId])).rows[0].count).toBe(2);
  });

  it('allows one active claim per Request and fences late provider completion after uncertain dispatch', async () => {
    const first = await open();
    const siblingJob = await store.admit(input({ operation: 'generate-draft', requestId: first.job.request_id }));
    const contenders = await Promise.all([store.claim({ jobId: first.job.id }), store.claim({ jobId: siblingJob.job.id })]);
    expect(contenders).toEqual([null, null]);
    const task = first.tasks[0];
    const attempt = await store.markDispatching({ ...first.fence, taskId: task.id });
    expect(attempt.audit_run_id).toBeTruthy();
    await expireLease(first.job.id);
    expect(await store.claim({ jobId: siblingJob.job.id })).toBeNull();
    const recovered = await store.claim({ jobId: first.job.id });
    expect(recovered.attempts[0]).toMatchObject({ id: attempt.id, state: 'unknown', usage_complete: null });
    expect(await store.markDispatching({ jobId: first.job.id, leaseToken: recovered.leaseToken, taskId: first.tasks[1].id })).toBeNull();
    expect(await store.saveResponse({ ...first.fence, taskId: task.id, attemptId: attempt.id, response })).toBeNull();
    const unrelated = await store.admit(input({ operation: 'generate-draft' }));
    const [one, two] = await Promise.all([store.claim({ jobId: unrelated.job.id }), store.claim({ jobId: unrelated.job.id })]);
    expect([one, two].filter(Boolean)).toHaveLength(1);
    expect((one || two).lease_expires_at).toBeInstanceOf(Date);
  });

  it('recovers the exact atomic response checkpoint and never repeats dispatch after worker death', async () => {
    const { job, tasks, fence, snapshot } = await open();
    const saved = await checkpoint(fence, tasks[0].id);
    await expireLease(job.id);
    const recovered = await store.claim({ jobId: job.id });
    const next = { jobId: job.id, leaseToken: recovered.leaseToken, taskId: tasks[0].id, attemptId: saved.id };
    expect(recovered.tasks[0].state).toBe('response_saved');
    expect(recovered.attempts[0]).toMatchObject({ state: 'response_saved', usage_complete: true, usage: response.response.usage });
    await expect(store.saveSnapshot({ ...next, snapshot: { ...snapshot, documents: [] } })).rejects.toMatchObject({ code: 'prompt_job_snapshot_frozen' });
    expect(await store.markDispatching(next)).toBeNull();
    expect(await store.readContent({ ...next, contentId: saved.response_content_id, expectedHash: saved.response_hash })).toEqual(response);
    await expect(store.readContent({ ...next, contentId: saved.response_content_id, expectedHash: '0'.repeat(64) })).rejects.toMatchObject({ code: 'prompt_job_content_integrity' });
    expect(await store.saveValidated({ ...next, result: 'Recovered fixture prose.', deferredAudit: audit })).toMatchObject({ state: 'validated' });
    expect(await store.markAudit({ ...next, outcome: 'delivered' })).toBeNull();
    expect(await store.markAuditDispatching(next)).toMatchObject({ audit_state: 'dispatching' });
    expect(await store.markAudit({ ...next, outcome: 'delivered' })).toMatchObject({ audit_state: 'delivered' });
    const publicReceipt = await store.readJob({ jobId: job.id, environment: 'test', principalKey: job.principal_key });
    expect(JSON.stringify(publicReceipt)).not.toMatch(/Temporary fixture|Recovered fixture prose/);
  });

  it('releases known failure slots while preserving occupied fields and saves validation failure audit', async () => {
    const command = input();
    const occupied = { ...baseline, fixture_methodology: { blank: false, sha256: sha256('staff work') } };
    const { job, fence, tasks } = await open(command, occupied);
    expect(await store.markDispatching({ ...fence, taskId: tasks[1].id })).toBeNull();
    const attempt = await checkpoint(fence, tasks[0].id);
    const transition = { ...fence, taskId: tasks[0].id, attemptId: attempt.id };
    expect(await store.markAttemptFailed({ ...transition, outcome: 'failed_validation', errorCode: 'invalid_fixture', deferredAudit: { status: 'failed' } }))
      .toMatchObject({ state: 'failed_validation', writeback_state: 'blocked' });
    expect(await store.markAuditDispatching(transition)).toMatchObject({ audit_state: 'dispatching' });
    const retry = input({ requestId: job.request_id, sourceEventId: 'event-new' }, [SUMMARY]);
    const retryAdmission = await store.admit(retry);
    await expect(store.admit(input({ requestId: job.request_id, sourceEventId: 'event-occupied' }, [METHODOLOGY])))
      .rejects.toMatchObject({ code: 'prompt_job_initialization_reserved' });
    await store.releaseClaim(fence);
    const replacement = await store.claim({ jobId: retryAdmission.job.id });
    expect(await store.markAttemptFailed({
      jobId: retryAdmission.job.id, leaseToken: replacement.leaseToken, taskId: retryAdmission.tasks[0].id,
      outcome: 'failed_pre_dispatch', errorCode: 'before_provider',
    })).toMatchObject({ state: 'failed_pre_dispatch' });
    expect(await store.admit(input({ requestId: job.request_id, sourceEventId: 'event-again' }, [SUMMARY]))).toMatchObject({ replayed: false });
  });

  it.each([
    ['a released failed-validation slot', [SUMMARY, METHODOLOGY]],
    ['disjoint field slots', [METHODOLOGY]],
  ])('waits for the earlier Request baseline with %s', async (_case, firstKeys) => {
    let version = 1;
    const etag = () => `W/"${version}"`;
    const firstFields = firstKeys.includes(SUMMARY) ? baseline : { fixture_methodology: blankField };
    const first = await open(input({}, firstKeys), firstFields, etag());
    if (firstKeys.includes(SUMMARY)) {
      const summary = first.tasks.find(task => task.task_key === SUMMARY);
      const saved = await checkpoint(first.fence, summary.id);
      const attempt = { ...first.fence, taskId: summary.id, attemptId: saved.id };
      expect(await store.markAttemptFailed({ ...attempt, outcome: 'failed_validation', errorCode: 'invalid_fixture', deferredAudit: { status: 'failed' } }))
        .toMatchObject({ writeback_state: 'blocked' });
      await deliverAudit(attempt);
    }
    const secondInput = input({ requestId: first.job.request_id, sourceEventId: 'event-2' }, [SUMMARY]);
    const second = await store.admit(secondInput);
    await store.releaseClaim(first.fence);
    const blocked = await store.claim({ jobId: second.job.id });
    const blockedFence = { jobId: second.job.id, leaseToken: blocked.leaseToken };
    const fields = { fixture_summary: blankField };
    await expect(store.captureTarget({ ...blockedFence, etag: etag(), fields }))
      .rejects.toMatchObject({ code: 'prompt_job_request_publication_pending', httpStatus: 409 });
    const secondView = await store.readJob({ jobId: second.job.id, environment: 'test', principalKey: second.job.principal_key });
    expect(secondView.job.target_etag).toBeNull();
    await store.releaseClaim(blockedFence);

    async function publish(fence, taskId, expectedFields) {
      await deliverAudit(await validate(fence, taskId, 'Ready for the Request.'));
      const operation = await store.freezePublication(fence);
      const publication = { ...fence, operationId: operation.id };
      expect(await store.markPublicationDispatched(publication)).toMatchObject({ state: 'dispatching' });
      expect(operation.expected_etag).toBe(etag());
      expect(await store.readContent({ ...fence, contentId: operation.payload_content_id, expectedHash: operation.payload_hash }))
        .toEqual(expectedFields);
      version += 1;
      expect(await store.finishPublication({ ...publication, outcome: 'applied' })).toMatchObject({ state: 'applied' });
      await store.releaseClaim(fence);
    }

    const firstAgain = await store.claim({ jobId: first.job.id });
    const firstFence = { jobId: first.job.id, leaseToken: firstAgain.leaseToken };
    await publish(firstFence, first.tasks.find(task => task.task_key === METHODOLOGY).id, { fixture_methodology: 'Ready for the Request.' });
    const secondAgain = await store.claim({ jobId: second.job.id });
    const secondFence = { jobId: second.job.id, leaseToken: secondAgain.leaseToken };
    await store.saveSnapshot({ ...secondFence, snapshot: { scope: scope(secondInput), profileHash } });
    expect(await store.captureTarget({ ...secondFence, etag: etag(), fields })).toMatchObject({ target_etag: 'W/"2"' });
    await publish(secondFence, second.tasks[0].id, { fixture_summary: 'Ready for the Request.' });
  });

  it('retains the frozen prompt for delayed audit after source expiry while fencing new dispatch', async () => {
    const { job, tasks, fence } = await open();
    const attempt = await validate(fence, tasks[0].id);
    await store.releaseClaim(fence);
    // Age every payload on the source deadline, independent of its content kind.
    await pool.query(`UPDATE prompt_job_content SET expires_at = clock_timestamp() - interval '1 second'
      WHERE job_id = $1 AND expires_at <= (SELECT source_expires_at FROM prompt_jobs WHERE id = $1)`, [job.id]);
    await store.expireContent();
    const recovered = await store.claim({ jobId: job.id });
    const next = { jobId: job.id, leaseToken: recovered.leaseToken };
    const read = (contentId, expectedHash) => store.readContent({ ...next, contentId, expectedHash });
    expect(await read(recovered.job.snapshot_content_id, recovered.job.snapshot_hash)).toBeNull();
    expect(await read(recovered.attempts[0].response_content_id, recovered.attempts[0].response_hash)).toBeNull();
    expect(await read(tasks[0].configuration_content_id, tasks[0].configuration_hash))
      .toMatchObject({ promptRow: { wmkf_ai_promptname: SUMMARY } });
    expect(await read(recovered.attempts[0].audit_content_id, recovered.attempts[0].audit_hash)).toEqual(audit);
    expect(await store.markDispatching({ ...next, taskId: tasks[1].id })).toBeNull();
    await deliverAudit({ ...attempt, ...next });
  });

  it('freezes one exact coalesced operation after both tasks, and a 412 cannot permit recapture or replay', async () => {
    const { job, fence, tasks } = await open();
    await deliverAudit(await validate(fence, tasks[0].id, 'Summary output.'));
    expect(await store.freezePublication(fence)).toBeNull();
    await deliverAudit(await validate(fence, tasks[1].id, 'Methodology output.'));
    const publication = await store.freezePublication(fence);
    expect(publication).toMatchObject({ expected_etag: 'W/"baseline"', state: 'ready' });
    expect(publication.task_ids).toEqual(expect.arrayContaining(tasks.map(task => task.id)));
    expect(publication.initialization_ids).toHaveLength(2);
    expect(await store.readContent({ ...fence, contentId: publication.payload_content_id, expectedHash: publication.payload_hash }))
      .toEqual({ fixture_summary: 'Summary output.', fixture_methodology: 'Methodology output.' });
    const operation = { ...fence, operationId: publication.id };
    expect(await store.markPublicationDispatched(operation)).toMatchObject({ state: 'dispatching' });
    expect(await store.finishPublication({ ...operation, outcome: 'conflict' })).toMatchObject({ state: 'conflict' });
    expect(await store.markPublicationDispatched(operation)).toBeNull();
    await expect(store.captureTarget({ ...fence, etag: 'W/"staff-cleared"', fields: baseline })).rejects.toMatchObject({ code: 'prompt_job_target_frozen' });
    await expect(store.admit(input({ requestId: job.request_id, sourceEventId: 'event-after-clear' }))).rejects.toMatchObject({ code: 'prompt_job_initialization_reserved' });
    const view = await store.readJob({ jobId: job.id, environment: 'test', principalKey: job.principal_key });
    expect(view.tasks.every(task => task.writeback_state === 'conflict')).toBe(true);
  });

  it('keeps audit uncertainty after lease expiry and blocks publication without replaying audit', async () => {
    const command = input({}, [SUMMARY]);
    const { job, fence, tasks } = await open(command, { fixture_summary: blankField });
    const attempt = await validate(fence, tasks[0].id);
    expect(await store.markAuditDispatching(attempt)).toMatchObject({ audit_state: 'dispatching' });
    await expireLease(job.id);
    const recovered = await store.claim({ jobId: job.id });
    const next = { ...attempt, leaseToken: recovered.leaseToken };
    expect(recovered.attempts[0].audit_state).toBe('unknown');
    expect(await store.markAudit({ ...attempt, outcome: 'delivered' })).toBeNull();
    expect(await store.markAuditDispatching(next)).toBeNull();
    expect(await store.freezePublication(next)).toBeNull();
  });

  it('blocks publication on pending or failed audit, including a previously frozen ready receipt', async () => {
    const { fence, tasks } = await open(input({}, [SUMMARY]), { fixture_summary: blankField });
    const attempt = await validate(fence, tasks[0].id);
    expect(await store.freezePublication(fence)).toBeNull();
    await deliverAudit(attempt);
    const publication = await store.freezePublication(fence);
    // Recreate a ready receipt from the former store, which froze before audit delivery.
    await pool.query("UPDATE prompt_job_attempts SET audit_state = 'pending' WHERE id = $1", [attempt.attemptId]);
    const operation = { ...fence, operationId: publication.id };
    expect(await store.markPublicationDispatched(operation)).toBeNull();
    await store.markAuditDispatching(attempt);
    expect(await store.markAudit({ ...attempt, outcome: 'failed' })).toMatchObject({ audit_state: 'failed' });
    expect(await store.freezePublication(fence)).toBeNull();
    expect(await store.markPublicationDispatched(operation)).toBeNull();
  });

  it('keeps a lost remote write receipt uncertain after content expiry and blocks a new initialization', async () => {
    const command = input({}, [SUMMARY]);
    const { job, fence, tasks } = await open(command, { fixture_summary: blankField });
    await deliverAudit(await validate(fence, tasks[0].id));
    const publication = await store.freezePublication(fence);
    const operation = { ...fence, operationId: publication.id };
    await store.markPublicationDispatched(operation);
    await expireLease(job.id);
    const recovered = await store.claim({ jobId: job.id });
    const next = { ...operation, leaseToken: recovered.leaseToken };
    expect(recovered.publication).toMatchObject({ id: publication.id, state: 'unknown', payload_hash: publication.payload_hash, expected_etag: publication.expected_etag });
    expect(await store.finishPublication({ ...operation, outcome: 'applied' })).toBeNull();
    await pool.query("UPDATE prompt_job_content SET expires_at = clock_timestamp() - interval '1 second' WHERE job_id = $1", [job.id]);
    expect(await store.expireContent()).toBe(6);
    expect(await store.readContent({ ...next, contentId: publication.payload_content_id, expectedHash: publication.payload_hash })).toBeNull();
    expect(await store.freezePublication(next)).toMatchObject({ id: publication.id, state: 'unknown' });
    expect(await store.markPublicationDispatched(next)).toBeNull();
    expect(await store.admit(command)).toMatchObject({ replayed: true, publication: { state: 'unknown' } });
    await expect(store.admit(input({ requestId: job.request_id, sourceEventId: 'event-new' }, [SUMMARY])))
      .rejects.toMatchObject({ code: 'prompt_job_initialization_reserved' });
  });
});
