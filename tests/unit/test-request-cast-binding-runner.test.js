/**
 * Suggested-reviewer binding runner (cast-and-status plan, Design B third
 * bullet): lib/services/test-requests/cast-binding-runner.js, against an
 * in-memory ledger (with the real ledger's state guards) and a fake
 * Dataverse client. No live Dataverse.
 */
import {
  CAST_SUGGESTION_LABEL, buildCastSuggestionBody, runCastBinding,
} from '../../lib/services/test-requests/cast-binding-runner.js';
import { fenceCastBindingClient } from '../../lib/services/test-requests/production-write-fence.js';
import { assertLedgerReceipt } from '../../lib/services/test-requests/run-ledger.js';

const RUN_ID = '7293496e-cbe2-4245-81b7-63f6136cb1af';
const REQUEST_ID = '83162701-82da-4669-94f7-6648bc9abbd3';
const SOURCE_ID = 'e43ae6ea-698f-f111-8076-6045bd018a07';
const PERSON_ID = '99999999-9999-4999-8999-999999999999';
const BINDING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const READY_RUN = { runId: RUN_ID, status: 'ready', destinationEnvironment: 'production', destinationRequestId: REQUEST_ID, sourceRequestId: SOURCE_ID };
const MEMBER = { memberId: PERSON_ID, environment: 'production', role: 'suggested_reviewer', entity: 'wmkf_potentialreviewers', status: 'verified' };

function memoryLedger({ run = READY_RUN, members = [MEMBER], bindings = [] } = {}) {
  const rows = bindings.map((b) => ({ ...b }));
  const find = (id) => rows.find((r) => r.bindingId === id);
  const move = (id, from, to, extra = {}) => {
    const row = find(id);
    if (!row || !from.includes(row.status)) return null;
    Object.assign(row, { status: to }, extra);
    return { ...row };
  };
  return {
    rows,
    getRun: async () => (run ? { ...run } : null),
    listCastMembers: async ({ environment }) => members.filter((m) => m.environment === environment).map((m) => ({ ...m })),
    getCastBinding: async ({ runId, memberId }) => {
      const row = rows.find((r) => r.runId === runId && r.memberId === memberId);
      return row ? { ...row } : null;
    },
    planCastBinding: async ({ bindingId, runId, memberId }) => {
      if (rows.some((r) => r.runId === runId && r.memberId === memberId)) throw new Error('one binding per run and member');
      const row = { bindingId, runId, memberId, status: 'planned', readback: null, error: null };
      rows.push(row);
      return { ...row };
    },
    markCastBindingDispatched: async ({ bindingId }) => move(bindingId, ['planned', 'dispatched'], 'dispatched'),
    markCastBindingVerified: async ({ bindingId, readback }) => move(bindingId, ['dispatched'], 'verified', { readback }),
    markCastBindingNeedsAttention: async ({ bindingId, error }) => move(bindingId, ['planned', 'dispatched'], 'needs_attention', { error }),
  };
}

function suggestionRow(id, overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: id, _wmkf_potentialreviewer_value: PERSON_ID, _wmkf_request_value: REQUEST_ID,
    wmkf_applicantdisposition: 100000000, wmkf_selected: false, statecode: 0, ...overrides,
  };
}

/**
 * `suggestions` is the live table (by GUID). By default a POST inserts its
 * body as a row; `post` overrides the response (and may skip the insert).
 */
function fakeClient({ request = {}, person = {}, suggestions = [], post = null } = {}) {
  const table = new Map(suggestions.map((s) => [s.wmkf_appreviewersuggestionid.toLowerCase(), { ...s }]));
  const requestRow = {
    akoya_requestid: REQUEST_ID, wmkf_istestrequest: true, wmkf_testcreationrunid: RUN_ID, wmkf_meetingdate: '2026-12-03', ...request,
  };
  const personRow = { wmkf_potentialreviewersid: PERSON_ID, statecode: 0, wmkf_issyntheticreviewer: true, ...person };
  const posts = [];
  const ok = (body) => ({ ok: true, status: 200, body });
  const insert = (body) => {
    const id = body.wmkf_appreviewersuggestionid.toLowerCase();
    table.set(id, suggestionRow(id, {
      _wmkf_potentialreviewer_value: body['wmkf_PotentialReviewer@odata.bind'].match(/\(([^)]+)\)/)[1],
      _wmkf_request_value: body['wmkf_Request@odata.bind'].match(/\(([^)]+)\)/)[1],
      wmkf_applicantdisposition: body.wmkf_applicantdisposition, wmkf_selected: body.wmkf_selected,
    }));
  };
  return {
    table,
    posts,
    baseUrl: 'https://wmkf.crm.dynamics.com/api/data/v9.2',
    async get(rawPath) {
      const path = decodeURIComponent(rawPath);
      if (path.startsWith(`/akoya_requests(${REQUEST_ID})`)) return ok({ ...requestRow });
      if (path.startsWith(`/wmkf_potentialreviewerses(${PERSON_ID})`)) return ok({ ...personRow });
      const byId = path.match(/^\/wmkf_appreviewersuggestions\(([^)]+)\)/);
      if (byId) {
        const row = table.get(byId[1].toLowerCase());
        return row ? ok({ ...row }) : { ok: false, status: 404, text: 'Not found' };
      }
      if (path.startsWith('/wmkf_appreviewersuggestions?')) {
        const [, p, r] = path.match(/_wmkf_potentialreviewer_value eq ([0-9a-f-]+) and _wmkf_request_value eq ([0-9a-f-]+)/);
        return ok({ value: [...table.values()].filter((s) => s._wmkf_potentialreviewer_value === p && s._wmkf_request_value === r) });
      }
      throw new Error(`unexpected path ${path}`);
    },
    async post(path, body) {
      posts.push({ path, body });
      if (post) return post(body, insert);
      insert(body);
      return { ok: true, status: 204, body: null };
    },
    async patch() { throw new Error('no PATCH expected'); },
  };
}

describe('runCastBinding', () => {
  test('happy path: journals, POSTs the exact applicant-recommended body, verifies by GUID', async () => {
    const ledger = memoryLedger();
    const client = fakeClient();
    const result = await runCastBinding({ client, ledger, runId: RUN_ID });

    expect(client.posts).toHaveLength(1);
    const { path, body } = client.posts[0];
    expect(path).toBe('/wmkf_appreviewersuggestions');
    expect(body.wmkf_appreviewersuggestionid).toMatch(GUID);
    expect(body).toEqual({
      wmkf_appreviewersuggestionid: body.wmkf_appreviewersuggestionid,
      wmkf_suggestionlabel: CAST_SUGGESTION_LABEL,
      wmkf_grantcyclecode: 'D26',
      wmkf_sources: 'applicant',
      wmkf_selected: false,
      wmkf_applicantdisposition: 100000000,
      'wmkf_PotentialReviewer@odata.bind': `/wmkf_potentialreviewerses(${PERSON_ID})`,
      'wmkf_Request@odata.bind': `/akoya_requests(${REQUEST_ID})`,
    });
    expect(result).toEqual({ bindingId: body.wmkf_appreviewersuggestionid, status: 'verified', recovered: false });
    expect(ledger.rows).toEqual([expect.objectContaining({
      bindingId: body.wmkf_appreviewersuggestionid, runId: RUN_ID, memberId: PERSON_ID, status: 'verified',
      readback: { kind: 'cast_binding', suggestionId: body.wmkf_appreviewersuggestionid, destinationPersonId: PERSON_ID, requestId: REQUEST_ID, recovered: false },
    })]);
    expect(JSON.stringify(result)).not.toMatch(/@/);
  });

  test('the verified readback fits the real ledger receipt grammar (fresh and recovered)', async () => {
    const fresh = memoryLedger();
    await runCastBinding({ client: fakeClient(), ledger: fresh, runId: RUN_ID });
    expect(() => assertLedgerReceipt(fresh.rows[0].readback, 'readback')).not.toThrow();
    const resumed = memoryLedger({ bindings: [{ bindingId: BINDING_ID, runId: RUN_ID, memberId: PERSON_ID, status: 'dispatched' }] });
    await runCastBinding({ client: fakeClient({ suggestions: [suggestionRow(BINDING_ID)] }), ledger: resumed, runId: RUN_ID });
    expect(() => assertLedgerReceipt(resumed.rows[0].readback, 'readback')).not.toThrow();
  });

  test('omits the grant cycle code when the meeting date is not a June or December cycle', async () => {
    const client = fakeClient({ request: { wmkf_meetingdate: '2026-03-01' } });
    await runCastBinding({ client, ledger: memoryLedger(), runId: RUN_ID });
    expect(client.posts[0].body).not.toHaveProperty('wmkf_grantcyclecode');
  });

  test('rerun after verified reports done without writing', async () => {
    const ledger = memoryLedger({ bindings: [{ bindingId: BINDING_ID, runId: RUN_ID, memberId: PERSON_ID, status: 'verified' }] });
    const client = fakeClient({ suggestions: [suggestionRow(BINDING_ID)] });
    await expect(runCastBinding({ client, ledger, runId: RUN_ID }))
      .resolves.toEqual({ bindingId: BINDING_ID, status: 'verified', recovered: false, alreadyVerified: true });
    expect(client.posts).toHaveLength(0);
  });

  test('a verified binding still passes once staff have promoted it (selected true)', async () => {
    const ledger = memoryLedger({ bindings: [{ bindingId: BINDING_ID, runId: RUN_ID, memberId: PERSON_ID, status: 'verified' }] });
    const client = fakeClient({ suggestions: [{ ...suggestionRow(BINDING_ID), wmkf_selected: true }] });
    await expect(runCastBinding({ client, ledger, runId: RUN_ID })).resolves.toMatchObject({ alreadyVerified: true });
  });

  test.each([
    ['deleted', null],
    ['deactivated', { statecode: 1 }],
    ['retargeted to another Request', { _wmkf_request_value: SOURCE_ID }],
    ['flipped to excluded', { wmkf_applicantdisposition: 100000001 }],
  ])('a verified binding whose suggestion was %s is refused as drifted, with no write', async (_label, drift) => {
    const ledger = memoryLedger({ bindings: [{ bindingId: BINDING_ID, runId: RUN_ID, memberId: PERSON_ID, status: 'verified' }] });
    const client = fakeClient({ suggestions: drift === null ? [] : [{ ...suggestionRow(BINDING_ID), ...drift }] });
    await expect(runCastBinding({ client, ledger, runId: RUN_ID })).rejects.toMatchObject({ code: 'cast_binding_drifted' });
    expect(client.posts).toHaveLength(0);
  });

  test('dispatched binding with the row present recovers by GUID read, never re-POSTs', async () => {
    const ledger = memoryLedger({ bindings: [{ bindingId: BINDING_ID, runId: RUN_ID, memberId: PERSON_ID, status: 'dispatched' }] });
    const client = fakeClient({ suggestions: [suggestionRow(BINDING_ID)] });
    await expect(runCastBinding({ client, ledger, runId: RUN_ID }))
      .resolves.toEqual({ bindingId: BINDING_ID, status: 'verified', recovered: true });
    expect(client.posts).toHaveLength(0);
    expect(ledger.rows[0].readback.recovered).toBe(true);
  });

  test('dispatched binding with the row absent stops needs_attention, never re-POSTs', async () => {
    const ledger = memoryLedger({ bindings: [{ bindingId: BINDING_ID, runId: RUN_ID, memberId: PERSON_ID, status: 'dispatched' }] });
    const client = fakeClient();
    await expect(runCastBinding({ client, ledger, runId: RUN_ID })).rejects.toMatchObject({ code: 'cast_binding_ambiguous' });
    expect(client.posts).toHaveLength(0);
    expect(ledger.rows[0].status).toBe('needs_attention');
  });

  test('dispatched binding whose row reads back with the wrong shape stops needs_attention', async () => {
    const ledger = memoryLedger({ bindings: [{ bindingId: BINDING_ID, runId: RUN_ID, memberId: PERSON_ID, status: 'dispatched' }] });
    const client = fakeClient({ suggestions: [suggestionRow(BINDING_ID, { wmkf_selected: true })] });
    await expect(runCastBinding({ client, ledger, runId: RUN_ID })).rejects.toMatchObject({ code: 'cast_binding_needs_attention' });
    expect(ledger.rows[0]).toMatchObject({ status: 'needs_attention', error: 'the suggestion is not unselected' });
  });

  test('planned binding (never sent) is dispatched once with its journaled GUID', async () => {
    const ledger = memoryLedger({ bindings: [{ bindingId: BINDING_ID, runId: RUN_ID, memberId: PERSON_ID, status: 'planned' }] });
    const client = fakeClient();
    await expect(runCastBinding({ client, ledger, runId: RUN_ID }))
      .resolves.toEqual({ bindingId: BINDING_ID, status: 'verified', recovered: false });
    expect(client.posts.map((p) => p.body.wmkf_appreviewersuggestionid)).toEqual([BINDING_ID]);
  });

  test('planned binding whose GUID already holds a row stops needs_attention without POSTing', async () => {
    const ledger = memoryLedger({ bindings: [{ bindingId: BINDING_ID, runId: RUN_ID, memberId: PERSON_ID, status: 'planned' }] });
    const client = fakeClient({ suggestions: [suggestionRow(BINDING_ID)] });
    await expect(runCastBinding({ client, ledger, runId: RUN_ID })).rejects.toMatchObject({ code: 'cast_binding_needs_attention' });
    expect(client.posts).toHaveLength(0);
    expect(ledger.rows[0].status).toBe('needs_attention');
  });

  test('needs_attention binding stops before any read of the pair or write', async () => {
    const ledger = memoryLedger({ bindings: [{ bindingId: BINDING_ID, runId: RUN_ID, memberId: PERSON_ID, status: 'needs_attention', error: 'x' }] });
    const client = fakeClient();
    await expect(runCastBinding({ client, ledger, runId: RUN_ID })).rejects.toMatchObject({ code: 'cast_binding_needs_attention' });
    expect(client.posts).toHaveLength(0);
  });

  test('POST throws but the row landed: GUID readback recovers it', async () => {
    const ledger = memoryLedger();
    const client = fakeClient({ post: (body, insert) => { insert(body); throw new Error('socket hang up'); } });
    const result = await runCastBinding({ client, ledger, runId: RUN_ID });
    expect(result).toMatchObject({ status: 'verified', recovered: true });
    expect(client.posts).toHaveLength(1);
  });

  test('POST throws and no row landed: needs_attention, never re-POSTs on rerun', async () => {
    const ledger = memoryLedger();
    const client = fakeClient({ post: () => { throw new Error('socket hang up'); } });
    await expect(runCastBinding({ client, ledger, runId: RUN_ID })).rejects.toMatchObject({ code: 'cast_binding_ambiguous' });
    expect(ledger.rows[0]).toMatchObject({ status: 'needs_attention' });
    expect(ledger.rows[0].error).toMatch(/socket hang up/);
    await expect(runCastBinding({ client, ledger, runId: RUN_ID })).rejects.toMatchObject({ code: 'cast_binding_needs_attention' });
    expect(client.posts).toHaveLength(1);
  });

  test('POST refused (non-ok) with no row: needs_attention carrying the status', async () => {
    const ledger = memoryLedger();
    const client = fakeClient({ post: () => ({ ok: false, status: 400, text: 'bad' }) });
    await expect(runCastBinding({ client, ledger, runId: RUN_ID })).rejects.toMatchObject({ code: 'cast_binding_ambiguous' });
    expect(ledger.rows[0].error).toMatch(/status 400/);
  });

  test('a non-404 readback failure throws and leaves the binding dispatched for a rerun', async () => {
    const ledger = memoryLedger({ bindings: [{ bindingId: BINDING_ID, runId: RUN_ID, memberId: PERSON_ID, status: 'dispatched' }] });
    const client = fakeClient();
    const get = client.get.bind(client);
    client.get = async (path) => (path.startsWith(`/wmkf_appreviewersuggestions(${BINDING_ID})`) ? { ok: false, status: 503, text: 'busy' } : get(path));
    await expect(runCastBinding({ client, ledger, runId: RUN_ID })).rejects.toThrow(/503/);
    expect(ledger.rows[0].status).toBe('dispatched');
  });

  describe('refusals before any ledger write or POST', () => {
    const cases = [
      ['no run', { ledger: { run: null } }, /No test request run/],
      ['a sandbox run', { ledger: { run: { ...READY_RUN, destinationEnvironment: 'sandbox' } } }, /only on production/],
      ['a non-ready run', { ledger: { run: { ...READY_RUN, status: 'running' } } }, /Run is running/],
      ['the marker missing', { client: { request: { wmkf_istestrequest: false } } }, /test marker/],
      ['a different run ID on the Request', { client: { request: { wmkf_testcreationrunid: FOREIGN_ID } } }, /test marker/],
      ['no cast suggested reviewer', { ledger: { members: [{ ...MEMBER, role: 'pi' }] } }, /no suggested reviewer/],
      ['an unverified cast member', { ledger: { members: [{ ...MEMBER, status: 'dispatched' }] } }, /is dispatched/],
      ['a person without the synthetic marker', { client: { person: { wmkf_issyntheticreviewer: false } } }, /synthetic reviewer marker/],
      ['a person with the marker unset', { client: { person: { wmkf_issyntheticreviewer: null } } }, /synthetic reviewer marker/],
      ['an inactive person', { client: { person: { statecode: 1 } } }, /not active/],
      ['an unjournaled suggestion for the pair', { client: { suggestions: [suggestionRow(FOREIGN_ID)] } }, /did not journal/],
    ];
    test.each(cases)('refuses %s', async (_name, setup, message) => {
      const ledger = memoryLedger(setup.ledger);
      const client = fakeClient(setup.client);
      await expect(runCastBinding({ client, ledger, runId: RUN_ID })).rejects.toThrow(message);
      expect(ledger.rows).toHaveLength(0);
      expect(client.posts).toHaveLength(0);
    });

    test('refuses an unjournaled pair suggestion alongside a dispatched binding', async () => {
      const ledger = memoryLedger({ bindings: [{ bindingId: BINDING_ID, runId: RUN_ID, memberId: PERSON_ID, status: 'dispatched' }] });
      const client = fakeClient({ suggestions: [suggestionRow(BINDING_ID), suggestionRow(FOREIGN_ID)] });
      await expect(runCastBinding({ client, ledger, runId: RUN_ID })).rejects.toMatchObject({ code: 'cast_binding_present_not_owned' });
      expect(ledger.rows[0].status).toBe('dispatched');
    });
  });
});

describe('the fence admits the runner body and nothing shaped otherwise', () => {
  const fence = { bindingId: BINDING_ID, personId: PERSON_ID, destinationRequestId: REQUEST_ID, sourceRequestId: SOURCE_ID, label: CAST_SUGGESTION_LABEL };
  const body = buildCastSuggestionBody({ bindingId: BINDING_ID, personId: PERSON_ID, requestId: REQUEST_ID, meetingDate: '2026-06-04' });

  test('admits the runner body', async () => {
    const client = fakeClient();
    await fenceCastBindingClient(client, fence).post('/wmkf_appreviewersuggestions', body);
    expect(client.posts).toHaveLength(1);
  });

  test.each([
    ['an extra column', { ...body, wmkf_reviewerstatus: 1 }],
    ['a non-recommended disposition', { ...body, wmkf_applicantdisposition: 100000001 }],
    ['another person', { ...body, 'wmkf_PotentialReviewer@odata.bind': `/wmkf_potentialreviewerses(${FOREIGN_ID})` }],
    ['another GUID', { ...body, wmkf_appreviewersuggestionid: FOREIGN_ID }],
  ])('refuses %s', (_name, wrong) => {
    const client = fakeClient();
    expect(() => fenceCastBindingClient(client, fence).post('/wmkf_appreviewersuggestions', wrong)).toThrow(/Production write fence/);
    expect(client.posts).toHaveLength(0);
  });

  test('refuses a PATCH outright', () => {
    const client = fakeClient();
    expect(() => fenceCastBindingClient(client, fence).patch(`/wmkf_appreviewersuggestions(${BINDING_ID})`, {})).toThrow(/not allowed/);
  });
});
