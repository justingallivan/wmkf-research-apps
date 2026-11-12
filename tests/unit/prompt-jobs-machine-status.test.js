/** @jest-environment node */
import { projectMachineJob } from '../../lib/services/prompt-jobs/machine-status.js';
import { ServiceHttpError } from '../../lib/services/service-http-error.js';

const JOB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SUMMARY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const METHODOLOGY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ATTEMPT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ATTEMPT_2 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const PUBLICATION = '10101010-1010-4010-8010-101010101010';
const CANARY = 'private-proposal-canary';
const NOW = Date.parse('2026-11-11T08:00:00Z');
const EXPIRES = NOW + 60_000;
const ETAG = 'W/"fixture"';
const HASH = 'a'.repeat(64);
const SUMMARY_KEY = 'synthetic.executive-summary';
const METHODOLOGY_KEY = 'synthetic.methodology';

function ledger(operation = 'generate-draft') {
  const initialize = operation === 'initialize';
  return {
    job: {
      id: JOB, request_id: REQUEST, version: 1, operation, snapshot_content_id: null, target_etag: null,
      source_expires_at: new Date(NOW + 30_000), result_expires_at: new Date(EXPIRES),
    },
    tasks: [{
      id: SUMMARY, job_id: JOB, task_key: SUMMARY_KEY, state: 'queued',
      destination_field: initialize ? 'fixture_summary' : null,
      writeback_state: initialize ? 'pending' : 'not_requested', error_code: null,
    }],
    attempts: [],
    publication: null,
  };
}

function sibling(view) {
  const task = {
    ...ledger(view.job.operation).tasks[0], id: METHODOLOGY, task_key: METHODOLOGY_KEY,
    destination_field: view.job.operation === 'initialize' ? 'fixture_methodology' : null,
  };
  view.tasks.push(task);
  return task;
}

function setTask(view, { index = 0, state, audit, writeback, errorCode = null }) {
  const task = view.tasks[index];
  Object.assign(task, { state, error_code: errorCode, ...(writeback ? { writeback_state: writeback } : {}) });
  if (state === 'validated') Object.assign(task, { result_content_id: PUBLICATION, result_hash: HASH });
  if (audit) view.attempts.push({
    id: index === 0 ? ATTEMPT : ATTEMPT_2, task_id: task.id, attempt_number: 1, state, audit_state: audit,
    ...(['response_saved', 'validated', 'failed_validation'].includes(state)
      ? { response_content_id: PUBLICATION, response_hash: HASH } : {}),
  });
}

function publish(view, state, taskIds = [SUMMARY]) {
  view.job.target_etag = ETAG;
  view.publication = { id: PUBLICATION, job_id: JOB, task_ids: taskIds, expected_etag: ETAG, state };
}

function expectInconsistent(view, now = NOW) {
  const project = () => projectMachineJob(view, now);
  expect(project).toThrow(ServiceHttpError);
  expect(project).toThrow(expect.objectContaining({
    httpStatus: 503, code: 'job_state_inconsistent', body: { error: 'job_state_inconsistent' },
  }));
}

test.each([
  ['queued', undefined, 'queued'],
  ['dispatching', 'none', 'running'],
  ['response_saved', 'none', 'running'],
  ['validated', 'pending', 'running'],
  ['validated', 'dispatching', 'running'],
  ['validated', 'delivered', 'succeeded'],
  ['validated', 'failed', 'needs_attention'],
  ['validated', 'unknown', 'needs_attention'],
  ['failed_pre_dispatch', undefined, 'failed'],
  ['failed_pre_dispatch', 'none', 'failed'],
  ['failed_validation', 'pending', 'running'],
  ['failed_validation', 'delivered', 'failed'],
  ['unknown', 'none', 'needs_attention'],
  ['unknown', 'pending', 'needs_attention'],
  ['expired', undefined, 'failed'],
  ['expired', 'none', 'failed'],
])('projects draft generation %s with audit %s as %s', (state, audit, expected) => {
  const view = ledger();
  setTask(view, { state, audit });
  const status = projectMachineJob(view, NOW);
  expect(status.state).toBe(expected);
  expect(status.pollAfterSeconds).toBe(['queued', 'running'].includes(expected) || audit === 'pending' ? 5 : null);
  expect(status.tasks[0]).toMatchObject({ generationState: state, writebackState: 'not_requested' });
});

test.each([
  ['queued', undefined, 'pending', 'queued'],
  ['dispatching', 'none', 'pending', 'running'],
  ['response_saved', 'none', 'pending', 'running'],
  ['validated', 'pending', 'pending', 'running'],
  ['validated', 'delivered', 'pending', 'running'],
  ['failed_pre_dispatch', undefined, 'blocked', 'failed'],
  ['failed_validation', 'delivered', 'blocked', 'failed'],
  ['unknown', 'none', 'pending', 'needs_attention'],
  ['expired', 'none', 'expired', 'needs_attention'],
])('projects initialize generation %s, audit %s and writeback %s as %s', (state, audit, writeback, expected) => {
  const view = ledger('initialize');
  setTask(view, { state, audit, writeback });
  expect(projectMachineJob(view, NOW).state).toBe(expected);
});

test.each([
  ['ready', 'pending', 'running', 'needs_attention'],
  ['dispatching', 'pending', 'running', 'running'],
  ['applied', 'applied', 'succeeded', 'succeeded'],
  ['conflict', 'conflict', 'needs_attention', 'needs_attention'],
  ['unknown', 'unknown', 'needs_attention', 'needs_attention'],
  ['expired', 'expired', 'needs_attention', 'needs_attention'],
])('projects publication %s with writeback %s before and after retention expiry', (publication, writeback, before, after) => {
  const view = ledger('initialize');
  setTask(view, { state: 'validated', audit: 'delivered', writeback });
  publish(view, publication);
  expect(projectMachineJob(view, NOW).state).toBe(before);
  expect(projectMachineJob(view, EXPIRES)).toMatchObject({
    state: after, pollAfterSeconds: ['ready', 'dispatching'].includes(publication) ? 5 : null,
  });
});

test('reports an applied task and a protected staff field as partial, including after retention expiry', () => {
  const view = ledger('initialize');
  sibling(view);
  setTask(view, { state: 'validated', audit: 'delivered', writeback: 'applied' });
  setTask(view, { index: 1, state: 'failed_pre_dispatch', writeback: 'blocked', errorCode: 'protected_staff_content' });
  publish(view, 'applied');

  const status = projectMachineJob(view, EXPIRES);
  expect(status).toMatchObject({ state: 'partial', pollAfterSeconds: null, tasks: [
    { taskId: SUMMARY, writebackState: 'applied', errorCode: null },
    { taskId: METHODOLOGY, writebackState: 'blocked', errorCode: 'protected_staff_content' },
  ] });
});

test('reports draft delivery after result expiry and detects expired pending audit at the same version', () => {
  const view = ledger();
  setTask(view, { state: 'validated', audit: 'pending' });
  const before = projectMachineJob(view, NOW + 30_000);
  const after = projectMachineJob(view, EXPIRES);
  expect(before).toMatchObject({ state: 'running', observedAt: new Date(NOW + 30_000).toISOString() });
  expect(after).toMatchObject({
    state: 'needs_attention', pollAfterSeconds: 5, version: before.version, observedAt: new Date(EXPIRES).toISOString(),
  });
  view.attempts[0].audit_state = 'delivered';
  expect(projectMachineJob(view, EXPIRES).state).toBe('succeeded');
});

test('reports expired pending initialize delivery even before publication freeze', () => {
  const view = ledger('initialize');
  setTask(view, { state: 'validated', audit: 'delivered' });
  expect(projectMachineJob(view, EXPIRES).state).toBe('needs_attention');
});

test('gives an unknown audit precedence while continuing to poll active generation', () => {
  const view = ledger();
  sibling(view);
  setTask(view, { state: 'validated', audit: 'unknown' });
  setTask(view, { index: 1, state: 'dispatching', audit: 'none' });
  expect(projectMachineJob(view, NOW)).toMatchObject({ state: 'needs_attention', pollAfterSeconds: 5 });
});

test('distinguishes preparation and mixed queued progress from initial queueing', () => {
  const view = ledger();
  expect(projectMachineJob(view, NOW).state).toBe('queued');
  view.job.snapshot_content_id = PUBLICATION;
  expect(projectMachineJob(view, NOW).state).toBe('running');
  view.job.snapshot_content_id = null;
  sibling(view);
  setTask(view, { index: 1, state: 'failed_pre_dispatch' });
  expect(projectMachineJob(view, NOW).state).toBe('running');
});

test('canonicalizes GUIDs and emits only the public content-free fields', () => {
  const view = ledger();
  view.job.id = JOB.toUpperCase();
  view.tasks[0].id = SUMMARY.toUpperCase();
  view.job.principal_key = CANARY;
  view.job.source_event_id = CANARY;
  view.job.configuration = CANARY;
  view.tasks[0].result = CANARY;
  setTask(view, { state: 'failed_validation', audit: 'delivered', errorCode: CANARY });
  view.attempts[0].audit_content = CANARY;
  const status = projectMachineJob(view, NOW);
  expect(status).toEqual({
    jobId: JOB, version: 1, observedAt: new Date(NOW).toISOString(), state: 'failed', pollAfterSeconds: null,
    tasks: [{
      taskId: SUMMARY, taskKey: SUMMARY_KEY, generationState: 'failed_validation',
      writebackState: 'not_requested', errorCode: 'prompt_job_failed', resultAvailable: false, recoveryActions: [],
    }],
  });
  expect(JSON.stringify(status)).not.toContain(CANARY);
});

test.each([
  ['unknown job operation', v => { v.job.operation = CANARY; }],
  ['invalid Request GUID', v => { v.job.request_id = CANARY; }],
  ['invalid job version', v => { v.job.version = 0; }],
  ['invalid result expiry', v => { v.job.result_expires_at = null; }],
  ['invalid snapshot reference', v => { v.job.snapshot_content_id = CANARY; }],
  ['target ETag on a draft', v => { v.job.target_etag = ETAG; }],
  ['missing tasks', v => { v.tasks = []; }],
  ['unknown generation', v => { v.tasks[0].state = CANARY; }],
  ['unknown writeback', v => { v.tasks[0].writeback_state = CANARY; }],
  ['unknown task key', v => { v.tasks[0].task_key = CANARY; }],
  ['non-GUID task ID', v => { v.tasks[0].id = CANARY; }],
  ['foreign task job', v => { v.tasks[0].job_id = REQUEST; }],
  ['duplicate task ID', v => { sibling(v).id = SUMMARY; }],
  ['duplicate task key', v => { sibling(v).task_key = SUMMARY_KEY; }],
  ['destination on a draft', v => { v.tasks[0].destination_field = 'fixture_summary'; }],
  ['writeback on a draft', v => { v.tasks[0].writeback_state = 'pending'; }],
  ['publication on a draft', v => { publish(v, 'ready'); }],
  ['queued with an attempt', v => { setTask(v, { state: 'queued', audit: 'none' }); }],
  ['dispatching without an attempt', v => { setTask(v, { state: 'dispatching' }); }],
  ['validated without an attempt', v => { setTask(v, { state: 'validated' }); }],
  ['validated without an audit', v => { setTask(v, { state: 'validated', audit: 'none' }); }],
  ['failed validation without an audit', v => { setTask(v, { state: 'failed_validation', audit: 'none' }); }],
  ['unknown audit enum', v => { setTask(v, { state: 'validated', audit: CANARY }); }],
  ['audit before response validation', v => { setTask(v, { state: 'response_saved', audit: 'delivered' }); }],
  ['validated task without a result checkpoint', v => {
    setTask(v, { state: 'validated', audit: 'delivered' });
    v.tasks[0].result_content_id = null;
  }],
  ['invalid result digest', v => {
    setTask(v, { state: 'validated', audit: 'delivered' });
    v.tasks[0].result_hash = CANARY;
  }],
  ['validated attempt without a response checkpoint', v => {
    setTask(v, { state: 'validated', audit: 'delivered' });
    v.attempts[0].response_content_id = null;
  }],
  ['invalid response digest', v => {
    setTask(v, { state: 'response_saved', audit: 'none' });
    v.attempts[0].response_hash = CANARY;
  }],
  ['mismatched attempt state', v => {
    setTask(v, { state: 'validated', audit: 'delivered' });
    v.attempts[0].state = 'failed_validation';
  }],
  ['attempt without a task', v => {
    setTask(v, { state: 'validated', audit: 'delivered' });
    v.attempts[0].task_id = METHODOLOGY;
  }],
  ['multiple attempts on one task', v => {
    sibling(v);
    setTask(v, { state: 'validated', audit: 'delivered' });
    v.attempts.push({ ...v.attempts[0], id: ATTEMPT_2, attempt_number: 2 });
  }],
])('rejects a malformed ledger with %s', (_name, change) => {
  const view = ledger();
  change(view);
  expectInconsistent(view);
});

test.each([
  ['unknown publication enum', v => { v.publication.state = CANARY; }],
  ['mismatched publication ETag', v => { v.publication.expected_etag = 'different'; }],
  ['foreign publication job', v => { v.publication.job_id = REQUEST; }],
  ['foreign publication task', v => { v.publication.task_ids = [METHODOLOGY]; }],
  ['selected task with pending audit', v => { v.attempts[0].audit_state = 'pending'; }],
  ['selected task state mismatch', v => { v.tasks[0].writeback_state = 'applied'; }],
  ['active sibling', v => { sibling(v); }],
  ['incomplete membership', v => {
    sibling(v);
    setTask(v, { index: 1, state: 'validated', audit: 'delivered' });
  }],
])('rejects initialize publication with %s', (_name, change) => {
  const view = ledger('initialize');
  setTask(view, { state: 'validated', audit: 'delivered' });
  publish(view, 'ready');
  change(view);
  expectInconsistent(view);
});

test.each([
  ['unrequested initialize writeback', v => { v.tasks[0].writeback_state = 'not_requested'; }],
  ['initialize without a destination', v => { v.tasks[0].destination_field = null; }],
  ['duplicate initialize destination', v => { sibling(v).destination_field = 'fixture_summary'; }],
  ['unmapped initialize destination', v => { v.tasks[0].destination_field = 'unrelated_field'; }],
  ['draft-only capability', v => { v.tasks[0].task_key = 'proposal.executive-summary'; }],
  ['wildcard ETag', v => { v.job.target_etag = '*'; }],
  ['oversized ETag', v => { v.job.target_etag = `"${'a'.repeat(200)}"`; }],
  ['applied without publication', v => { setTask(v, { state: 'validated', audit: 'delivered', writeback: 'applied' }); }],
])('rejects an initialize job with %s', (_name, change) => {
  const view = ledger('initialize');
  change(view);
  expectInconsistent(view);
});
