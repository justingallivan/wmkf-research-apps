/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const mockComplete = jest.fn();
jest.mock('../../lib/services/llm-client.js', () => ({
  DEFAULT_TIMEOUT_MS: 120000,
  LLMClient: jest.fn().mockImplementation(() => ({ complete: mockComplete })),
}));
jest.mock('../../lib/services/prompt-jobs/proposal-source.js', () => ({
  createProposalSource: () => ({}),
}));
jest.mock('@vercel/postgres', () => ({
  db: { connect: jest.fn(async () => { throw new Error('Application Postgres forbidden'); }) },
}));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  getById: jest.fn(async () => { throw new Error('Live Request read forbidden'); }),
  updateById: jest.fn(async () => { throw new Error('Live Request write forbidden'); }),
}));
jest.mock('../../lib/dataverse/adapters/ai-run.js', () => ({
  create: jest.fn(async () => { throw new Error('Live audit write forbidden'); }),
}));
jest.mock('../../lib/services/board-writeups/config.js', () => ({
  eligibleStaff: jest.fn(async () => { throw new Error('Live staff lookup forbidden'); }),
}));
jest.mock('../../lib/services/admin/prompt-profiles-service.js', () => ({
  getPromptProfiles: jest.fn(async () => { throw new Error('Live profile lookup forbidden'); }),
}));
jest.mock('../../lib/services/prompt-store.js', () => ({
  ...jest.requireActual('../../lib/services/prompt-store.js'),
  fetchCurrentPrompt: jest.fn(async () => { throw new Error('Live prompt lookup forbidden'); }),
}));

import { executePrompt } from '../../lib/services/execute-prompt.js';
import { createPromptJobStore } from '../../lib/services/prompt-jobs/store.js';
import { prepareContextSnapshot } from '../../lib/services/prompt-jobs/context.js';
import { canonical, hashProfile, sha256 } from '../../lib/services/prompt-jobs/profile.js';
import { SOURCE_POLICY, scopeForTrial } from '../../lib/services/prompt-jobs/trial-policy.js';
import {
  admitStaffJob, listStaffJobs, readStaffJob, readStaffResults,
} from '../../lib/services/prompt-jobs/staff-service.js';
import { runStaffJobTick } from '../../lib/services/prompt-jobs/staff-worker.js';
import * as grantRequest from '../../lib/dataverse/adapters/grant-request.js';
import * as aiRun from '../../lib/dataverse/adapters/ai-run.js';

const databaseUrl = process.env.PROMPT_JOB_PG_TEST_URL || '';
if (!databaseUrl && process.env.PROMPT_JOB_PG_TEST_REQUIRE === '1') {
  throw new Error('PROMPT_JOB_PG_TEST_URL is required for the real staff trial proof.');
}
if (databaseUrl) {
  let url;
  try { url = new URL(databaseUrl); } catch { throw new Error('Invalid staff trial scratch PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || !url.port || url.pathname.length < 2 || url.search || url.hash || databaseUrl === process.env.POSTGRES_URL) {
    throw new Error('Staff trial proof requires an explicit loopback scratch PostgreSQL URL without options.');
  }
}
const describePg = databaseUrl ? describe : describe.skip;
const SUMMARY = 'proposal.executive-summary';
const METHODOLOGY = 'proposal.methodology';
const nonceSecret = 'staff fixture wrapper seed, never used outside this test';
const model = 'claude-sonnet-4-6';
const profile = {
  key: 'proposal-analysis', revision: 1, wrapperVersion: 1, sharedInstructions: 'Analyze the synthetic applicant proposal.',
  documentRoles: ['proposal'], recordNames: ['pi_name'],
  limits: { maxDocuments: 1, maxDocumentBytes: 3000, maxTotalDocumentBytes: 3000, maxRecordBytes: 1000 },
};
const profileHash = hashProfile(profile);
const summaryDraft = 'The staff summary explains the synthetic proposal and its possible impact.';
const methodsDraft = 'The methodology draft describes the experiment and control group.';

function promptRow(taskKey) {
  const summary = taskKey === SUMMARY;
  const output = summary ? { name: 'summary', maxWords: 200 } : { name: 'methodology', maxChars: 12000 };
  return {
    wmkf_ai_promptid: randomUUID(), wmkf_ai_promptname: taskKey, wmkf_promptversion: 1,
    wmkf_ai_model: model, wmkf_ai_maxtokens: 1000, wmkf_ai_temperature: 0, wmkf_ai_systemprompt: null,
    wmkf_ai_promptbody: summary ? 'Summarize the proposal for staff. PI: {{pi_name}}.' : 'Describe the methodology. PI: {{pi_name}}.',
    wmkf_ai_promptvariables: JSON.stringify({
      execution: { contractVersion: 1, mode: 'shared-document-task', profile: { key: profile.key, revision: 1, sha256: profileHash } },
      variables: [
        { name: 'proposal_context', source: { kind: 'prepared_context' }, required: true },
        { name: 'pi_name', source: { kind: 'frozen_record' }, required: true },
      ],
    }),
    wmkf_ai_promptoutputschema: JSON.stringify({ parseMode: 'raw', outputs: [{ ...output, target: { kind: 'none' } }] }),
  };
}

function providerResponse(text, stopReason = 'end_turn') {
  return {
    text, content: [{ type: 'text', text }], model, stopReason, stopDetails: null, refused: false,
    usageComplete: true, usage: { inputTokens: 100, outputTokens: 20, cacheCreationTokens: 80, cacheReadTokens: 0 },
  };
}

describePg('staff proposal drafts with real PostgreSQL and the canonical Executor', () => {
  let admin;
  let pool;
  let schema;
  let store;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    schema = `staff_prompt_jobs_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: databaseUrl, max: 5, options: `-c search_path=${schema}` });
    await pool.query(readFileSync('lib/db/migrations/097_shared_prompt_jobs.sql', 'utf8'));
    store = createPromptJobStore(pool);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (schema) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    if (admin) await admin.end();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLAUDE_API_KEY = 'fixture-key-for-mocked-provider';
    mockComplete.mockReset().mockResolvedValueOnce(providerResponse(summaryDraft)).mockResolvedValue(providerResponse(methodsDraft));
  });

  afterEach(() => {
    expect(grantRequest.getById).not.toHaveBeenCalled();
    expect(grantRequest.updateById).not.toHaveBeenCalled();
    expect(aiRun.create).not.toHaveBeenCalled();
    delete process.env.CLAUDE_API_KEY;
  });

  function fixture() {
    const actor = { profileId: 7, systemUserId: randomUUID() };
    const trialId = randomUUID();
    const requestId = randomUUID();
    const policy = Object.freeze({
      ...actor, trialId, requestId, environment: 'local-sandbox', authorizationScope: `proposal-trial:${trialId}`,
      principalKey: 'profile:7', sourcePolicy: SOURCE_POLICY,
    });
    const scope = scopeForTrial(policy);
    const manifest = { requestId, itemId: 'fixture-item', version: 'v1', piHash: sha256('Structured PI canary') };
    const documents = [{
      role: 'proposal', id: 'fixture-item', version: 'v1', extractionVersion: 'fixture-v1', sha256: sha256('Fixture bytes'),
      text: 'DOCUMENT_CANARY. The applicant document supplies an inconsistent PI name.',
    }];
    const records = [{ name: 'pi_name', present: true, value: 'Structured PI canary', provenance: 'contact:fixture:v1' }];
    const rows = new Map([[SUMMARY, promptRow(SUMMARY)], [METHODOLOGY, promptRow(METHODOLOGY)]]);
    const source = {
      inspect: jest.fn(async () => manifest),
      isCurrent: jest.fn(async ({ manifest: observed }) => canonical(observed) === canonical(manifest)),
      prepare: jest.fn(async ({ manifest: observed, scope: frozenScope, profile: frozenProfile, nonceSecret: frozenSecret }) => {
        expect(observed).toEqual(manifest);
        return prepareContextSnapshot({ scope: frozenScope, profile: frozenProfile, nonceSecret: frozenSecret, documents, records });
      }),
    };
    const auditRows = new Map();
    const deps = {
      store, source, policy: () => policy, now: () => Date.now(), executePrompt,
      authorize: jest.fn(async candidate => canonical(candidate) === canonical(actor)),
      prompt: jest.fn(async name => rows.get(name)),
      profiles: jest.fn(async () => ({ profiles: [{ profile, sha256: profileHash }] })),
      nonceSecret: () => nonceSecret,
      audit: jest.fn(async ({ runId, payload, actor: auditedActor }) => {
        expect(auditedActor).toEqual(actor);
        if (auditRows.has(runId)) throw new Error('Duplicate audit');
        auditRows.set(runId, payload);
      }),
    };
    const command = { actor, requestId, idempotencyKey: randomUUID() };
    return {
      deps, source, auditRows, scope, command,
      admit: (overrides = {}) => admitStaffJob({ ...command, ...overrides }, deps),
      list: () => listStaffJobs(command, deps),
      read: jobId => readStaffJob({ ...command, jobId }, deps),
      results: jobId => readStaffResults({ ...command, jobId }, deps),
      tick: (overrides = {}) => runStaffJobTick({ ...deps, ...overrides }),
    };
  }

  async function drain(trial) {
    for (let count = 0; count < 8; count += 1) {
      if ((await trial.tick()).stage === 'idle') return;
    }
    throw new Error('Staff draft worker did not settle');
  }

  test('admits both drafts, shares the provider prefix, and projects only staff-safe data', async () => {
    const t = fixture();
    const { job } = await t.admit();
    expect(job.status).toBe('queued');
    expect(t.source.inspect).toHaveBeenCalledWith({ requestId: t.command.requestId });
    expect(mockComplete).not.toHaveBeenCalled();
    expect((await t.results(job.id)).results).toEqual([]);
    await drain(t);
    expect(t.source.prepare).toHaveBeenCalledTimes(1);
    expect(mockComplete).toHaveBeenCalledTimes(2);
    const [summary, methods] = mockComplete.mock.calls.map(([args]) => args);
    expect(summary.system).toEqual(methods.system);
    expect(summary.messages[0].content[0]).toEqual(methods.messages[0].content[0]);
    expect(summary.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(summary.messages[0].content[0].text).not.toContain('Structured PI canary');
    expect(summary.messages[0].content[1].text).toContain('Structured PI canary');
    expect(methods.messages[0].content[1].text).not.toEqual(summary.messages[0].content[1].text);
    expect(t.auditRows.size).toBe(2);
    expect(JSON.stringify([...t.auditRows.values()])).not.toMatch(/DOCUMENT_CANARY|Structured PI canary|synthetic proposal and its possible impact/);

    const list = await t.list();
    expect(list.enabled).toBe(true);
    expect(list.jobs).toHaveLength(1);
    const [current] = list.jobs;
    expect(await t.read(job.id)).toEqual({ job: current });
    expect(Object.keys(current).sort()).toEqual(['createdAt', 'id', 'requestId', 'status', 'tasks', 'version']);
    expect(current.status).toBe('complete');
    expect(current.tasks).toEqual([
      { taskKey: SUMMARY, state: 'validated', resultAvailable: true, errorCode: null },
      { taskKey: METHODOLOGY, state: 'validated', resultAvailable: true, errorCode: null },
    ]);
    const result = await t.results(job.id);
    expect(Object.keys(result).sort()).toEqual(['expiresAt', 'jobId', 'results', 'version']);
    expect(result).toMatchObject({ jobId: job.id, version: current.version });
    expect(result.results).toEqual([
      { taskKey: SUMMARY, status: 'available', text: summaryDraft },
      { taskKey: METHODOLOGY, status: 'available', text: methodsDraft },
    ]);
    const exposed = JSON.stringify({ list, result });
    expect(exposed).not.toContain(t.command.actor.systemUserId);
    expect(exposed).not.toContain(t.command.idempotencyKey);
    expect(exposed).not.toContain(t.scope.authorizationScope);
    const [internal] = await store.listJobs(t.scope);
    expect(internal.publication).toBeNull();
    expect(internal.tasks.every(task => task.destination_field === null && task.writeback_state === 'not_requested')).toBe(true);
    for (const task of internal.tasks) {
      expect(exposed).not.toContain(task.configuration_content_id);
      expect(exposed).not.toContain(task.result_content_id);
    }
    await expect(t.results(randomUUID())).rejects.toMatchObject({ code: 'prompt_job_not_found', httpStatus: 404 });
  });

  test('retains the successful sibling after validation failure without exposing the failed response', async () => {
    const t = fixture();
    const { job } = await t.admit();
    await t.tick();
    mockComplete.mockReset()
      .mockResolvedValueOnce(providerResponse('FAILED_RESPONSE_CANARY output stopped at the provider limit.', 'max_tokens'))
      .mockResolvedValueOnce(providerResponse(methodsDraft));
    expect(await t.tick()).toEqual({ stage: 'failed_validation' });
    await drain(t);
    const status = (await t.read(job.id)).job;
    expect(status.status).toBe('needs_attention');
    expect(status.tasks[0]).toEqual({ taskKey: SUMMARY, state: 'failed_validation', resultAvailable: false, errorCode: 'claude_output_truncated' });
    const result = await t.results(job.id);
    expect(result.results).toEqual([{ taskKey: METHODOLOGY, status: 'available', text: methodsDraft }]);
    expect(JSON.stringify({ result, status })).not.toContain('FAILED_RESPONSE_CANARY');
    expect(mockComplete).toHaveBeenCalledTimes(2);
    expect(t.auditRows.size).toBe(2);
  });

  test('an ambiguous provider failure fences the sibling and repeated staff ticks', async () => {
    const t = fixture();
    const { job } = await t.admit();
    await t.tick();
    mockComplete.mockReset().mockRejectedValueOnce(new Error('Transport interrupted after dispatch'));
    expect(await t.tick()).toEqual({ stage: 'unknown' });
    expect(await t.tick()).toEqual({ stage: 'idle' });
    expect(await t.tick()).toEqual({ stage: 'idle' });
    const status = (await t.read(job.id)).job;
    expect(status.status).toBe('needs_attention');
    expect(status.tasks.map(task => task.state)).toEqual(['unknown', 'queued']);
    expect((await t.results(job.id)).results).toEqual([]);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  test('source drift between tasks keeps the saved draft and prevents the remaining dispatch', async () => {
    const t = fixture();
    const { job } = await t.admit();
    await t.tick();
    expect(await t.tick()).toEqual({ stage: 'validated' });
    t.source.isCurrent.mockResolvedValue(false);
    expect(await t.tick()).toEqual({ stage: 'failed_pre_dispatch' });
    await drain(t);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect((await t.read(job.id)).job.tasks.map(task => task.state)).toEqual(['validated', 'failed_pre_dispatch']);
    expect((await t.results(job.id)).results).toEqual([{ taskKey: SUMMARY, status: 'available', text: summaryDraft }]);
  });

  test.each(['proposal_source_changed', 'proposal_source_unavailable'])('terminal %s during preparation ends the draft without provider work', async code => {
    const t = fixture();
    const { job } = await t.admit();
    t.source.prepare.mockRejectedValueOnce(Object.assign(new Error('Synthetic extraction failed'), { code }));
    expect(await t.tick()).toEqual({ stage: 'failed_pre_dispatch' });
    expect(await t.tick()).toEqual({ stage: 'idle' });
    expect(t.source.prepare).toHaveBeenCalledTimes(1);
    expect(mockComplete).not.toHaveBeenCalled();
    const status = (await t.read(job.id)).job;
    expect(status.status).toBe('needs_attention');
    expect(status.tasks.map(task => [task.state, task.errorCode])).toEqual([
      ['failed_pre_dispatch', code], ['failed_pre_dispatch', code],
    ]);
    expect((await t.results(job.id)).results).toEqual([]);
  });

  test('revocation after one result blocks the worker and all staff reads', async () => {
    const t = fixture();
    const { job } = await t.admit();
    await t.tick();
    expect(await t.tick()).toEqual({ stage: 'validated' });
    t.deps.authorize.mockResolvedValue(false);
    await expect(t.tick()).rejects.toMatchObject({ code: 'prompt_job_access_denied', httpStatus: 403 });
    await expect(t.list()).rejects.toMatchObject({ code: 'prompt_job_access_denied' });
    await expect(t.read(job.id)).rejects.toMatchObject({ code: 'prompt_job_access_denied' });
    await expect(t.results(job.id)).rejects.toMatchObject({ code: 'prompt_job_access_denied' });
    expect(mockComplete).toHaveBeenCalledTimes(1);
    const [internal] = await store.listJobs(t.scope);
    expect(internal.tasks.map(task => task.state)).toEqual(['validated', 'queued']);
  });

  test('resumes a durable response checkpoint without calling the provider again', async () => {
    const t = fixture();
    const { job } = await t.admit();
    await t.tick();
    const interruptedStore = { ...store, saveValidated: async () => { throw new Error('Simulated loss after checkpoint'); } };
    expect(await t.tick({ store: interruptedStore })).toEqual({ stage: 'needs_attention' });
    expect((await t.read(job.id)).job.tasks[0].state).toBe('response_saved');
    expect((await t.results(job.id)).results).toEqual([]);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(await t.tick()).toEqual({ stage: 'validated' });
    expect(mockComplete).toHaveBeenCalledTimes(1);
    await drain(t);
    expect(mockComplete).toHaveBeenCalledTimes(2);
    expect((await t.results(job.id)).results.map(result => result.text)).toEqual([summaryDraft, methodsDraft]);
  });

  test('replays the accepted receipt before mutable source or prompt reads and rejects a second cohort key', async () => {
    const t = fixture();
    const { job } = await t.admit();
    t.source.inspect.mockRejectedValue(new Error('Source has moved'));
    t.deps.prompt.mockRejectedValue(new Error('Current prompt changed'));
    t.deps.profiles.mockRejectedValue(new Error('Current profile catalog unavailable'));
    expect((await t.admit()).job.id).toBe(job.id);
    await expect(t.admit({ idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'prompt_job_trial_limit', httpStatus: 409 });
    expect(t.source.inspect).toHaveBeenCalledTimes(1);
    expect(t.deps.prompt).toHaveBeenCalledTimes(2);
    expect(t.deps.profiles).toHaveBeenCalledTimes(1);
    expect((await t.list()).jobs).toHaveLength(1);
    expect(mockComplete).not.toHaveBeenCalled();
  });
});
