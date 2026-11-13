/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { sha256 } from '../../lib/services/prompt-jobs/profile.js';
import { createPromptJobStore } from '../../lib/services/prompt-jobs/store.js';

const url = process.env.PROMPT_JOB_PG_TEST_URL || '';
if (!url && process.env.PROMPT_JOB_PG_TEST_REQUIRE === '1') throw new Error('Explicit scratch PostgreSQL URL required');
if (url) {
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.hostname !== '127.0.0.1'
    || !parsed.port || parsed.pathname !== '/summary_reservations' || parsed.search || parsed.hash
    || url === process.env.POSTGRES_URL) throw new Error('Dedicated loopback summary_reservations database required');
}
const describePg = url ? describe : describe.skip;
const SUMMARY = 'proposal.executive-summary';
const FIELD = 'wmkf_layabstract';

describePg('offline Summary reservation lifecycle (not machine admission)', () => {
  let admin, pool, schema, store;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    schema = `summary_slots_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 4 });
    await pool.query(readFileSync('lib/db/migrations/097_shared_prompt_jobs.sql', 'utf8'));
    store = createPromptJobStore(pool);
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (schema) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    if (admin) await admin.end();
  });

  // SQL constructs only hypothetical durable receipts. No admission bypass is
  // exported by runtime code; configuration is deliberately non-executable.
  async function receipt({ requestId = randomUUID(), taskKey = SUMMARY, field = FIELD,
    environment = 'test', reserve = true } = {}) {
    const id = randomUUID(), taskId = randomUUID(), contentId = randomUUID();
    const principal = `fixture:${randomUUID()}`, scope = `offline-summary:${randomUUID()}`;
    await pool.query(`INSERT INTO prompt_jobs
      (id,environment,principal_key,authorization_scope,request_id,idempotency_key,payload_hash,
       operation,source_event_id,source_expires_at,result_expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'initialize',$8,now()+interval '1 hour',now()+interval '1 day')`,
    [id, environment, principal, scope, requestId, randomUUID(), sha256(id), randomUUID()]);
    await pool.query(`INSERT INTO prompt_job_content (id,job_id,kind,payload,sha256,size_bytes,expires_at)
      VALUES ($1,$2,'configuration','{}',$3,2,now()+interval '1 day')`, [contentId,id,sha256('{}')]);
    await pool.query(`INSERT INTO prompt_job_tasks
      (id,job_id,task_key,destination_field,prompt_hash,profile_hash,model,configuration_content_id,configuration_hash,writeback_state)
      VALUES ($1,$2,$3,$4,$5,$5,'synthetic-test',$6,$7,'pending')`,
    [taskId,id,taskKey,field,sha256(id),contentId,sha256('{}')]);
    const f = { id, taskId, requestId, environment, field, principal, scope };
    if (reserve) await reserveSlot(f);
    return f;
  }
  const reserveSlot = f => pool.query(`INSERT INTO prompt_job_initializations
    (job_id,task_id,environment,request_id,destination_field) VALUES ($1,$2,$3,$4,$5)`,
  [f.id,f.taskId,f.environment,f.requestId,f.field]);
  const slots = f => pool.query('SELECT released_at,initially_blank FROM prompt_job_initializations WHERE job_id=$1', [f.id]);
  async function fail(f, outcome) {
    const lease = await store.claim({ jobId: f.id, leaseMs: 60000 });
    const fence = { jobId: f.id, leaseToken: lease.leaseToken };
    await store.captureTarget({ ...fence, etag: 'W/"original"', fields: { [f.field]: { blank: true, sha256: sha256('') } } });
    let attemptId = null;
    if (['failed_validation', 'unknown'].includes(outcome)) {
      attemptId = randomUUID();
      const state = outcome === 'unknown' ? 'dispatching' : 'response_saved';
      await pool.query('UPDATE prompt_job_tasks SET state=$2 WHERE id=$1', [f.taskId,state]);
      await pool.query(`INSERT INTO prompt_job_attempts (id,task_id,state,response_content_id,response_hash)
        VALUES ($1,$2,$3,$4,$5)`, [attemptId,f.taskId,state,
        outcome === 'failed_validation' ? randomUUID() : null,
        outcome === 'failed_validation' ? sha256('synthetic response') : null]);
    }
    await expect(store.markAttemptFailed({ ...fence, taskId: f.taskId, attemptId, outcome,
      errorCode: 'synthetic_failure', ...(outcome === 'failed_validation' ? { deferredAudit: { status: 'failed' } } : {}) }))
      .resolves.toMatchObject({ state: outcome });
    await store.releaseClaim(fence);
    return fence;
  }

  test.each(['failed_pre_dispatch','failed_validation','expired','unknown'])('%s retains Summary slot through cleanup and new events/scopes', async outcome => {
    const f = await receipt();
    await fail(f, outcome);
    expect((await slots(f)).rows).toEqual([{ released_at: null, initially_blank: true }]);
    // A new event, principal, key and scope cannot evade physical-field uniqueness,
    // even when a subsequent observer would see an empty/cleared destination.
    const competitor = await receipt({ requestId:f.requestId, reserve:false });
    await expect(reserveSlot(competitor)).rejects.toMatchObject({ code:'23505' });
    await pool.query("UPDATE prompt_job_content SET expires_at=now()-interval '1 second' WHERE job_id=$1", [f.id]);
    await expect(store.expireContent({ scope: { environment:f.environment,principalKey:f.principal,
      authorizationScope:f.scope,requestId:f.requestId } })).resolves.toBeGreaterThan(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM prompt_job_content WHERE job_id=$1',[f.id])).rows[0].n).toBe(0);
    expect((await slots(f)).rows[0].released_at).toBeNull();
    await expect(reserveSlot(competitor)).rejects.toMatchObject({ code:'23505' });
    const read = {jobId:f.id,environment:f.environment,principalKey:f.principal};
    const first = await store.readJob(read);
    expect(await store.readJob(read)).toEqual(first);
    expect(first.tasks[0].state).toBe(outcome);
    expect(first.publication).toBeNull();
  });

  test('concurrent different-event receipts can reserve the same physical field only once', async () => {
    const requestId = randomUUID();
    const a = await receipt({requestId,reserve:false}), b = await receipt({requestId,reserve:false});
    const results = await Promise.allSettled([reserveSlot(a),reserveSlot(b)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected').reason.code).toBe('23505');
  });

  test.each([
    ['synthetic.executive-summary','test',true],
    ['synthetic.executive-summary','preview-sandbox',false],
    ['future.unknown-task','test',false],
    [SUMMARY,'test',false],
  ])('release exception for %s in %s is %s', async (taskKey,environment,released) => {
    const f=await receipt({taskKey,environment});
    await fail(f,'failed_pre_dispatch');
    expect((await slots(f)).rows[0].released_at !== null).toBe(released);
  });

  test('Summary initialization remains rejected by generic and machine admission', async () => {
    const command={environment:'local-sandbox',principalKey:'fixture:caller',authorizationScope:`proposal-trial:${randomUUID()}`,
      requestId:randomUUID(),idempotencyKey:randomUUID(),operation:'initialize',sourceEventId:randomUUID(),
      tasks:[{taskKey:SUMMARY}]};
    await expect(store.admit(command)).rejects.toMatchObject({code:'invalid_prompt_job_admission'});
    const loadConfiguration=jest.fn();
    await expect(store.admitMachineTitle(command,{loadConfiguration})).rejects.toBeDefined();
    expect(loadConfiguration).not.toHaveBeenCalled();
    expect((await pool.query('SELECT count(*)::int AS n FROM prompt_jobs WHERE request_id=$1',[command.requestId])).rows[0].n).toBe(0);
  });
});
