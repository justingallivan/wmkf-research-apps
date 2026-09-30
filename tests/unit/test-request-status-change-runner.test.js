/**
 * Status setter runner (cast-and-status plan, slice C):
 * lib/services/test-requests/status-change-runner.js, against an in-memory
 * ledger and a fake Dataverse client.
 */
import { jest } from '@jest/globals';
import { recheckStatusChange, runStatusChange } from '../../lib/services/test-requests/status-change-runner.js';

const RUN_ID = '7293496e-cbe2-4245-81b7-63f6136cb1af';
const REQUEST_ID = '83162701-82da-4669-94f7-6648bc9abbd3';
const SOURCE_ID = 'e43ae6ea-698f-f111-8076-6045bd018a07';
const PROGRAM_ID = '77777777-7777-4777-8777-777777777777';
const PHASE2 = 'wmkf_phaseiistatus';
const PHASE1 = 'wmkf_phaseistatus';
const T0 = Date.parse('2026-09-28T22:00:00Z');

function memoryLedger(run, changes = []) {
  const rows = changes.map((c) => ({ ...c }));
  const find = (id) => rows.find((r) => r.changeId === id);
  const move = (id, from, to, extra = {}) => {
    const row = find(id);
    if (!row || !from.includes(row.status)) return null;
    Object.assign(row, { status: to }, extra);
    return { ...row };
  };
  return {
    rows,
    getRun: async () => (run ? { ...run } : null),
    listStatusChanges: async () => rows.map((r) => ({ ...r })),
    planStatusChange: async (input) => {
      if (rows.some((r) => ['planned', 'dispatched', 'applied'].includes(r.status))) throw new Error('one open change per run');
      const row = { ...input, sequence: rows.length + 1, status: 'planned', dispatchedAt: null, effects: null, error: null };
      rows.push(row);
      return { ...row };
    },
    markStatusChangeDispatched: async ({ changeId }) => move(changeId, ['planned', 'dispatched'], 'dispatched', { dispatchedAt: find(changeId)?.dispatchedAt || new Date(T0).toISOString() }),
    markStatusChangeApplied: async ({ changeId }) => move(changeId, ['dispatched', 'applied'], 'applied'),
    completeStatusChange: async ({ changeId, effects }) => move(changeId, ['applied'], 'complete', { effects }),
    markStatusChangeNeedsAttention: async ({ changeId, error, effects }) => move(changeId, ['planned', 'dispatched', 'applied'], 'needs_attention', { error, effects: effects ?? find(changeId)?.effects }),
    recordLateStatusChangeEffects: async ({ changeId, effects }) => move(changeId, ['complete', 'needs_attention'], find(changeId)?.status, { effects }),
  };
}

const READY_RUN = { runId: RUN_ID, status: 'ready', destinationEnvironment: 'production', destinationRequestId: REQUEST_ID, sourceRequestId: SOURCE_ID };

function fakeClient({
  request = {}, program = 'Research', patch = async () => ({ ok: true, status: 204 }), jobs = [[]], emails = [], tracking = [], payments = [],
  onPatch = null,
} = {}) {
  const state = {
    akoya_requestid: REQUEST_ID, wmkf_istestrequest: true, wmkf_testcreationrunid: RUN_ID, wmkf_phaseistatus: null,
    wmkf_phaseiistatus: null, _wmkf_grantprogram_value: PROGRAM_ID, akoya_requeststatus: 'Pending', '@odata.etag': 'W/"100"', ...request,
  };
  let jobPoll = 0;
  const patches = [];
  const ok = (body) => ({ ok: true, status: 200, body });
  return {
    state,
    patches,
    baseUrl: 'https://wmkf.crm.dynamics.com/api/data/v9.2',
    async get(rawPath) {
      const path = decodeURIComponent(rawPath);
      if (path.startsWith(`/akoya_requests(${REQUEST_ID})`)) return ok({ ...state });
      if (path.startsWith(`/wmkf_grantprograms(${PROGRAM_ID})`)) return ok({ wmkf_name: program });
      if (path.includes("LogicalName='wmkf_phaseiistatus'")) {
        return ok({ OptionSet: { Options: [] }, GlobalOptionSet: { Options: [
          { Value: 100000002, Label: { UserLocalizedLabel: { Label: 'Phase II Pending Committee Review' } } },
          { Value: 100000004, Label: { UserLocalizedLabel: { Label: 'Recommended' } } },
        ] } });
      }
      if (path.includes("LogicalName='wmkf_phaseistatus'")) {
        return ok({ GlobalOptionSet: { Options: [{ Value: 100000003, Label: { UserLocalizedLabel: { Label: 'Invited' } } }] } });
      }
      if (path.startsWith('/asyncoperations')) return ok({ value: typeof jobs === 'function' ? jobs() : jobs[Math.min(jobPoll++, jobs.length - 1)] });
      if (path.startsWith('/emails')) return ok({ value: emails });
      if (path.startsWith('/akoya_goapplystatustrackings')) return ok({ value: tracking });
      if (path.startsWith('/akoya_requestpayments')) return ok({ value: payments });
      throw new Error(`unexpected path ${path}`);
    },
    async patchWithOptions(path, body, headers) {
      patches.push({ path, body, headers });
      const result = await patch(path, body, headers);
      if (result?.ok) { Object.assign(state, body, { '@odata.etag': 'W/"101"' }); onPatch?.(state); }
      return result;
    },
  };
}

// A clock that advances 1 s per read, with no real waiting.
const fastCompletion = () => {
  let t = T0;
  return { pollMs: 1000, maxWaitMs: 300_000, minQuietMs: 90_000, now: () => (t += 1000), sleep: async () => {} };
};
const change = (client, ledger, overrides = {}) => runStatusChange({
  client, ledger, runId: RUN_ID, field: PHASE2, optionLabel: 'Phase II Pending Committee Review', completion: fastCompletion(), ...overrides,
});
const AFTER = '2026-09-28T22:00:05Z';

describe('runStatusChange', () => {
  test('the characterization change: one fenced PATCH with If-Match, then complete with its effects', async () => {
    const client = fakeClient({ onPatch: (s) => { s.akoya_requeststatus = 'Phase II Pending'; }, jobs: [[{ asyncoperationid: '11111111-1111-4111-8111-111111111111', statecode: 3, statuscode: 30, createdon: AFTER }]] });
    const ledger = memoryLedger(READY_RUN);
    const result = await change(client, ledger);
    expect(client.patches).toEqual([{ path: `/akoya_requests(${REQUEST_ID})`, body: { wmkf_phaseiistatus: 100000002 }, headers: { 'If-Match': 'W/"100"' } }]);
    expect(result).toMatchObject({ sequence: 1, before: null, after: 100000002, requestStatus: 'Phase II Pending', jobs: 1, emails: 0, payments: 0 });
    expect(ledger.rows[0]).toMatchObject({ status: 'complete', etagBefore: 'W/"100"', optionBefore: null });
    expect(ledger.rows[0].effects).toMatchObject({ kind: 'status_change', outcome: 'complete', jobIds: ['11111111-1111-4111-8111-111111111111'] });
    expect(ledger.rows[0].effects.requestStatusSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test.each([
    ['a run that is not ready', { run: { ...READY_RUN, status: 'needs_attention' } }, /Run is needs_attention/],
    ['a sandbox run', { run: { ...READY_RUN, destinationEnvironment: 'sandbox' } }, /only on production/],
    ['a Request without the marker', { request: { wmkf_istestrequest: null } }, /test marker/],
    ['a Request marked by another run', { request: { wmkf_testcreationrunid: SOURCE_ID } }, /test marker/],
    ['a non-Research program', { program: 'Southern California' }, /Research program only/],
    ['a no-op', { request: { wmkf_phaseiistatus: 100000002 } }, /already holds/],
    ['an unknown label', { label: 'Pending' }, /matches 0 live options/],
  ])('refuses %s before any ledger row or write', async (_label, { run = READY_RUN, request, program, label }, message) => {
    const client = fakeClient({ request, program });
    const ledger = memoryLedger(run);
    await expect(change(client, ledger, label ? { optionLabel: label } : {})).rejects.toThrow(message);
    expect(client.patches).toHaveLength(0);
    expect(ledger.rows).toHaveLength(0);
  });

  test('a 412 stops the change needs_attention and writes nothing more', async () => {
    const client = fakeClient({ patch: async () => ({ ok: false, status: 412 }) });
    const ledger = memoryLedger(READY_RUN);
    await expect(change(client, ledger)).rejects.toMatchObject({ code: 'status_change_conflict' });
    expect(ledger.rows[0].status).toBe('needs_attention');
    expect(client.patches).toHaveLength(1);
  });

  test('a lost response leaves the change dispatched; the same command recovers it without a second PATCH', async () => {
    let first = true;
    const client = fakeClient({ patch: async (path, body) => {
      if (first) { first = false; Object.assign(client.state, body, { '@odata.etag': 'W/"101"' }); throw new Error('timeout'); }
      return { ok: true, status: 204 };
    } });
    const ledger = memoryLedger(READY_RUN);
    await expect(change(client, ledger)).rejects.toMatchObject({ code: 'status_change_ambiguous' });
    expect(ledger.rows[0].status).toBe('dispatched');
    await expect(change(client, ledger)).resolves.toMatchObject({ sequence: 1, after: 100000002 });
    expect(client.patches).toHaveLength(1);
    expect(ledger.rows[0].status).toBe('complete');
  });

  test('a lost response that never landed is re-sent once, with the original If-Match', async () => {
    let first = true;
    const client = fakeClient({ patch: async () => { if (first) { first = false; throw new Error('timeout'); } return { ok: true, status: 204 }; } });
    const ledger = memoryLedger(READY_RUN);
    await expect(change(client, ledger)).rejects.toMatchObject({ code: 'status_change_ambiguous' });
    await change(client, ledger);
    expect(client.patches.map((p) => p.headers['If-Match'])).toEqual(['W/"100"', 'W/"100"']);
    expect(ledger.rows[0].status).toBe('complete');
  });

  test('a resumed change whose Request moved on otherwise stops needs_attention', async () => {
    const client = fakeClient({ request: { '@odata.etag': 'W/"105"' } });
    const ledger = memoryLedger(READY_RUN, [{ changeId: 'c1', sequence: 1, field: PHASE2, optionBefore: null, optionAfter: 100000002, etagBefore: 'W/"100"', status: 'dispatched', dispatchedAt: AFTER }]);
    await expect(change(client, ledger)).rejects.toMatchObject({ code: 'status_change_resume' });
    expect(client.patches).toHaveLength(0);
  });

  test('an unexpected payment stops the change needs_attention with its effects recorded', async () => {
    const client = fakeClient({ payments: [{ akoya_requestpaymentid: '22222222-2222-4222-8222-222222222222', createdon: AFTER }] });
    const ledger = memoryLedger(READY_RUN);
    await expect(change(client, ledger)).rejects.toThrow(/unexpected payments/);
    expect(ledger.rows[0]).toMatchObject({ status: 'needs_attention' });
    expect(ledger.rows[0].effects.paymentIds).toEqual(['22222222-2222-4222-8222-222222222222']);
  });

  test('an expected payment (Recommended with Phase I Invited) completes', async () => {
    const client = fakeClient({ request: { wmkf_phaseistatus: 100000003 }, payments: [{ akoya_requestpaymentid: '22222222-2222-4222-8222-222222222222', createdon: AFTER }] });
    const ledger = memoryLedger(READY_RUN);
    await expect(change(client, ledger, { optionLabel: 'Recommended' })).resolves.toMatchObject({ payments: 1 });
  });

  test('background jobs still running at the deadline stop the change; the same command re-checks without re-sending', async () => {
    const running = [{ asyncoperationid: '33333333-3333-4333-8333-333333333333', statecode: 1, statuscode: 10, createdon: AFTER }];
    const done = [{ ...running[0], statecode: 3, statuscode: 30 }];
    let finished = false;
    const client = fakeClient({ jobs: () => (finished ? done : running) });
    const ledger = memoryLedger(READY_RUN);
    await expect(change(client, ledger)).rejects.toMatchObject({ code: 'status_change_jobs_open' });
    expect(ledger.rows[0].status).toBe('applied');
    finished = true;
    await expect(change(client, ledger)).resolves.toMatchObject({ jobs: 1 });
    expect(client.patches).toHaveLength(1);
    expect(ledger.rows[0].status).toBe('complete');
  });

  test('an empty first poll is not completion: a job that appears later is waited for', async () => {
    const job = { asyncoperationid: '66666666-6666-4666-8666-666666666666', createdon: AFTER };
    let polls = 0;
    const client = fakeClient({ jobs: () => {
      polls += 1;
      if (polls < 3) return [];
      if (polls < 6) return [{ ...job, statecode: 0, statuscode: 0 }];
      return [{ ...job, statecode: 3, statuscode: 30 }];
    } });
    const ledger = memoryLedger(READY_RUN);
    await expect(change(client, ledger)).resolves.toMatchObject({ jobs: 1 });
    expect(polls).toBeGreaterThan(6);
    expect(ledger.rows[0].effects.jobIds).toEqual(['66666666-6666-4666-8666-666666666666']);
  });

  test('completion waits at least the minimum quiet period after the write', async () => {
    let polls = 0;
    const client = fakeClient({ jobs: () => { polls += 1; return []; } });
    await change(client, memoryLedger(READY_RUN));
    // 1 s per clock read; at least 90 s must pass before two quiet polls count.
    expect(polls).toBeGreaterThanOrEqual(30);
  });

  test('a failed background job stops the change needs_attention', async () => {
    const client = fakeClient({ jobs: [[{ asyncoperationid: '33333333-3333-4333-8333-333333333333', statecode: 3, statuscode: 31, createdon: AFTER }]] });
    const ledger = memoryLedger(READY_RUN);
    await expect(change(client, ledger)).rejects.toThrow(/background job\(s\) regarding the Request failed/);
    expect(ledger.rows[0].status).toBe('needs_attention');
  });

  test('a payment-producing change from an unlisted state is refused before any write', async () => {
    const client = fakeClient({ request: { wmkf_phaseistatus: 100000003, wmkf_phaseiistatus: 100000003 } });
    const ledger = memoryLedger(READY_RUN);
    await expect(change(client, ledger, { optionLabel: 'Recommended' })).rejects.toMatchObject({ code: 'status_change_edge' });
    expect(client.patches).toHaveLength(0);
    expect(ledger.rows).toHaveLength(0);
  });

  test('a repeat of a change that created a tracking row is refused unless re-run', async () => {
    const prior = [{ changeId: 'c1', sequence: 1, field: PHASE1, optionBefore: null, optionAfter: 100000003, etagBefore: 'W/"90"', status: 'complete', dispatchedAt: AFTER, effects: { trackingIds: ['t'] } }];
    const client = fakeClient({ request: { wmkf_phaseistatus: 100000000 } });
    await expect(change(client, memoryLedger(READY_RUN, prior), { field: PHASE1, optionLabel: 'Invited' })).rejects.toMatchObject({ code: 'status_change_replay' });
    expect(client.patches).toHaveLength(0);
  });
});

describe('recheckStatusChange', () => {
  test('reports effects that arrived after the change completed', async () => {
    const late = [{ activityid: '44444444-4444-4444-8444-444444444444', createdon: AFTER }];
    const client = fakeClient({ emails: late });
    const ledger = memoryLedger(READY_RUN, [{ changeId: 'c1', sequence: 1, field: PHASE2, optionBefore: null, optionAfter: 100000002, etagBefore: 'W/"100"', status: 'complete', dispatchedAt: '2026-09-28T22:00:00Z', effects: { emailIds: [] } }]);
    await expect(recheckStatusChange({ client, ledger, runId: RUN_ID })).resolves.toMatchObject({ ok: false, lateEffects: { emails: 1, tracking: 0, payments: 0 } });
    expect(ledger.rows[0].effects.emailIds).toEqual(['44444444-4444-4444-8444-444444444444']);
    expect(ledger.rows[0].status).toBe('complete');
  });

  test('reports jobs still open or failed after the change', async () => {
    const client = fakeClient({ jobs: [[{ asyncoperationid: '55555555-5555-4555-8555-555555555555', statecode: 1, statuscode: 10, createdon: AFTER }]] });
    const ledger = memoryLedger(READY_RUN, [{ changeId: 'c1', sequence: 1, field: PHASE2, optionBefore: null, optionAfter: 100000002, etagBefore: 'W/"100"', status: 'complete', dispatchedAt: '2026-09-28T22:00:00Z', effects: {} }]);
    await expect(recheckStatusChange({ client, ledger, runId: RUN_ID })).resolves.toMatchObject({ ok: false, openJobs: 1, failedJobs: 0 });
  });
});
