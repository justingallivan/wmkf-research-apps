/**
 * Synthetic cast runner (cast-and-status plan, Design A, slice A):
 * lib/services/test-requests/cast-runner.js, against an in-memory ledger and
 * a fake Dataverse client. No live Dataverse.
 */
import {
  CAST_DEFAULT_NAMES, buildCastBody, planCastAddresses, readCast, runCastCreate,
} from '../../lib/services/test-requests/cast-runner.js';
import * as fenceModule from '../../lib/services/test-requests/production-write-fence.js';
import { assertLedgerReceipt, reviewerAddressSha256 } from '../../lib/services/test-requests/run-ledger.js';

// Spy on the real fence so a test can prove the runner wraps the client it is
// given. `mockTamper` makes the returned fenced client add a column the fence
// must refuse: only a runner that POSTs through the fence sees the refusal.
let mockTamper = false;
jest.mock('../../lib/services/test-requests/production-write-fence.js', () => {
  const actual = jest.requireActual('../../lib/services/test-requests/production-write-fence.js');
  return {
    ...actual,
    fenceCastCreateClient: jest.fn((client, fence) => {
      const real = actual.fenceCastCreateClient(client, fence);
      return mockTamper ? { ...real, post: (p, b, ...rest) => real.post(p, { ...b, telephone1: '555' }, ...rest) } : real;
    }),
  };
});

const SANDBOX_URL = 'https://orgd9e66399.crm.dynamics.com/api/data/v9.2';
const ADDRESSES = { pi: 'Owner+PI@Example.org', liaison: 'owner+liaison@example.org', suggested_reviewer: 'owner+reviewer@example.org' };
const ALLOWLIST = new Set(['owner@example.org']);
const ENV = 'sandbox';
const FOUNDATION = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0';
const PARENT_BIND = 'parentcustomerid_account@odata.bind';
const SET_ENTITY = { contacts: 'contact', wmkf_potentialreviewerses: 'wmkf_potentialreviewers' };
const ID_FIELD = { contact: 'contactid', wmkf_potentialreviewers: 'wmkf_potentialreviewersid' };

function memoryLedger(initial = []) {
  const rows = initial.map((r) => ({ ...r }));
  const calls = [];
  const move = (memberId, from, to, extra = {}) => {
    const row = rows.find((r) => r.memberId === memberId);
    if (!row || !from.includes(row.status)) return null;
    Object.assign(row, { status: to }, extra);
    return { ...row };
  };
  const entityOf = { pi: 'contact', liaison: 'contact', suggested_reviewer: 'wmkf_potentialreviewers' };
  return {
    rows,
    calls,
    planCastMember: jest.fn(async (input) => {
      calls.push(['plan', input.role]);
      if (rows.some((r) => r.environment === input.environment && r.role === input.role)) throw new Error('unique (environment, role)');
      const row = { ...input, entity: entityOf[input.role], status: 'planned', readback: null, error: null };
      rows.push(row);
      return { ...row };
    }),
    markCastMemberDispatched: jest.fn(async ({ memberId }) => { calls.push(['dispatched', memberId]); return move(memberId, ['planned', 'dispatched'], 'dispatched'); }),
    markCastMemberVerified: jest.fn(async ({ memberId, readback }) => {
      calls.push(['verified', memberId]);
      assertLedgerReceipt(readback, 'readback');
      return move(memberId, ['dispatched'], 'verified', { readback });
    }),
    markCastMemberNeedsAttention: jest.fn(async ({ memberId, error, readback }) => {
      calls.push(['needs_attention', memberId]);
      if (readback) assertLedgerReceipt(readback, 'readback');
      return move(memberId, ['planned', 'dispatched'], 'needs_attention', { error, readback });
    }),
    listCastMembers: jest.fn(async ({ environment }) => rows.filter((r) => r.environment === environment).map((r) => ({ ...r }))),
  };
}

// Evaluates the `a eq 'x' and b eq 'y'` filters the runner builds, with
// OData quote-doubling and Dataverse's case-insensitive string equality.
function matchesFilter(row, filter) {
  return filter.split(' and ').every((clause) => {
    const m = /^(\w+) eq '((?:[^']|'')*)'$/.exec(clause);
    if (!m) throw new Error(`fake cannot parse ${clause}`);
    return String(row[m[1]] ?? '').toLowerCase() === m[2].replace(/''/g, "'").toLowerCase();
  });
}

function fakeClient({ rows = [], onPost } = {}) {
  const store = rows.map((r) => ({ ...r }));
  const posts = [];
  const gets = [];
  const client = {
    baseUrl: SANDBOX_URL,
    store,
    posts,
    gets,
    get: async (path) => {
      gets.push(path);
      const byId = /^\/(contacts|wmkf_potentialreviewerses)\(([0-9a-f-]{36})\)\?\$select=/.exec(path);
      if (byId) {
        const entity = SET_ENTITY[byId[1]];
        const row = store.find((r) => r.entity === entity && r[ID_FIELD[entity]] === byId[2]);
        return row ? { ok: true, status: 200, body: { ...row } } : { ok: false, status: 404, body: null };
      }
      const list = /^\/(contacts|wmkf_potentialreviewerses)\?\$select=\w+&\$filter=([^&]+)&\$top=5$/.exec(path);
      if (list) {
        const entity = SET_ENTITY[list[1]];
        const filter = decodeURIComponent(list[2]);
        const value = store.filter((r) => r.entity === entity && matchesFilter(r, filter)).map((r) => ({ [ID_FIELD[entity]]: r[ID_FIELD[entity]] }));
        return { ok: true, status: 200, body: { value } };
      }
      throw new Error(`fake GET not handled: ${path}`);
    },
    post: async (path, body) => {
      posts.push({ path, body });
      const entity = SET_ENTITY[path.slice(1)];
      const { [PARENT_BIND]: parentBind, ...fields } = body;
      const row = entity === 'contact'
        ? { entity, statecode: 0, '@odata.etag': 'W/"1"', ...fields, _parentcustomerid_value: parentBind ? /\(([0-9a-f-]{36})\)/.exec(parentBind)[1] : null }
        : { entity, statecode: 0, _wmkf_contact_value: null, wmkf_name: `${body.wmkf_firstname} ${body.wmkf_lastname}`, ...body };
      if (onPost) return onPost({ path, body, row, store });
      store.push(row);
      return { ok: true, status: 204, body: null };
    },
    patches: [],
    patchWithOptions: async (path, body, headers) => {
      client.patches.push({ path, body, headers });
      const id = /^\/contacts\(([0-9a-f-]{36})\)$/.exec(path)[1];
      const row = store.find((r) => r.entity === 'contact' && r.contactid === id);
      row._parentcustomerid_value = /\(([0-9a-f-]{36})\)/.exec(body[PARENT_BIND])[1];
      return { ok: true, status: 204, body: null };
    },
    patch: async () => { throw new Error('patch must not be called'); },
    delete_: async () => { throw new Error('delete must not be called'); },
    raw: async () => { throw new Error('raw must not be called'); },
  };
  return client;
}

const run = (client, ledger, extra = {}) => runCastCreate({ client, ledger, environment: ENV, addresses: ADDRESSES, allowlist: ALLOWLIST, parentAccountId: FOUNDATION, ...extra });
const digest = (a) => reviewerAddressSha256(a).addressSha256;

beforeEach(() => {
  mockTamper = false;
  fenceModule.fenceCastCreateClient.mockClear();
});

describe('planCastAddresses', () => {
  test('normalizes, digests, and accepts plus-tags of a listed address', () => {
    const out = planCastAddresses({ addresses: ADDRESSES, allowlist: ALLOWLIST });
    expect(out.pi).toEqual({ address: 'owner+pi@example.org', addressSha256: digest('owner+pi@example.org') });
    expect(Object.keys(out)).toEqual(['pi', 'liaison', 'suggested_reviewer']);
  });

  test.each([
    ['missing', { ...ADDRESSES, liaison: undefined }, 'cast_address_invalid'],
    ['malformed', { ...ADDRESSES, pi: 'not an address' }, 'cast_address_invalid'],
    ['off the allowlist', { ...ADDRESSES, suggested_reviewer: 'someone@elsewhere.org' }, 'cast_address_not_allowlisted'],
    ['a Foundation address', { ...ADDRESSES, pi: 'staff@wmkeck.org' }, 'cast_address_not_allowlisted'],
    ['a shared address (case-insensitive)', { ...ADDRESSES, liaison: 'OWNER+pi@example.org' }, 'cast_address_duplicate'],
  ])('refuses %s', (_label, addresses, code) => {
    expect(() => planCastAddresses({ addresses, allowlist: ALLOWLIST })).toThrow(expect.objectContaining({ code }));
  });

  test('refuses an unloaded allowlist', () => {
    expect(() => planCastAddresses({ addresses: ADDRESSES, allowlist: null })).toThrow(expect.objectContaining({ code: 'cast_allowlist_unavailable' }));
  });
});

describe('runCastCreate', () => {
  test('happy path: three creates with exact closed bodies, each fenced, verified by GUID readback', async () => {
    const client = fakeClient();
    const ledger = memoryLedger();
    const result = await run(client, ledger);

    expect(client.posts.map((p) => p.path)).toEqual(['/contacts', '/contacts', '/wmkf_potentialreviewerses']);
    const [pi, liaison, reviewer] = ledger.rows;
    expect(client.posts[0].body).toEqual({
      contactid: pi.memberId, firstname: 'TEST · Factory', lastname: 'PI', emailaddress1: 'owner+pi@example.org', [PARENT_BIND]: `/accounts(${FOUNDATION})`,
    });
    expect(client.posts[1].body).toEqual({
      contactid: liaison.memberId, firstname: 'TEST · Factory', lastname: 'Liaison', emailaddress1: 'owner+liaison@example.org', [PARENT_BIND]: `/accounts(${FOUNDATION})`,
    });
    expect(client.posts[2].body).toEqual({
      wmkf_potentialreviewersid: reviewer.memberId, wmkf_firstname: 'TEST · Factory', wmkf_lastname: 'Reviewer',
      wmkf_emailaddress: 'owner+reviewer@example.org', wmkf_issyntheticreviewer: true,
    });
    expect(ledger.rows.map((r) => [r.role, r.status, r.addressSha256])).toEqual([
      ['pi', 'verified', digest('owner+pi@example.org')],
      ['liaison', 'verified', digest('owner+liaison@example.org')],
      ['suggested_reviewer', 'verified', digest('owner+reviewer@example.org')],
    ]);
    expect(ledger.rows[0].readback).toEqual(expect.objectContaining({ exists: true, matched: true, recovered: false }));
    expect(result.members.map((m) => [m.role, m.status, m.outcome])).toEqual([
      ['pi', 'verified', 'created'], ['liaison', 'verified', 'created'], ['suggested_reviewer', 'verified', 'created'],
    ]);
    expect(JSON.stringify(result)).not.toMatch(/example\.org/);
    expect(fenceModule.fenceCastCreateClient.mock.calls.map(([, f]) => f)).toEqual([
      { parentAccountId: FOUNDATION, members: [{ memberId: pi.memberId, entity: 'contact', firstName: 'TEST · Factory', lastName: 'PI', address: 'owner+pi@example.org' }] },
      { parentAccountId: FOUNDATION, members: [{ memberId: liaison.memberId, entity: 'contact', firstName: 'TEST · Factory', lastName: 'Liaison', address: 'owner+liaison@example.org' }] },
      { parentAccountId: FOUNDATION, members: [{ memberId: reviewer.memberId, entity: 'wmkf_potentialreviewers', firstName: 'TEST · Factory', lastName: 'Reviewer', address: 'owner+reviewer@example.org' }] },
    ]);
  });

  test('rerun reuses the verified cast: re-read by GUID, no POST, no plan', async () => {
    const client = fakeClient();
    const ledger = memoryLedger();
    await run(client, ledger);
    ledger.planCastMember.mockClear();
    const result = await run(client, ledger);
    expect(client.posts).toHaveLength(3);
    expect(ledger.planCastMember).not.toHaveBeenCalled();
    expect(result.members.map((m) => m.outcome)).toEqual(['reused', 'reused', 'reused']);
  });

  test('rerun refuses a verified member that drifted, and one supplied with a different address', async () => {
    const client = fakeClient();
    const ledger = memoryLedger();
    await run(client, ledger);
    await expect(run(client, ledger, { addresses: { ...ADDRESSES, pi: 'owner+other@example.org' } }))
      .rejects.toMatchObject({ code: 'cast_address_changed', role: 'pi' });
    client.store.find((r) => r.lastname === 'Liaison').statecode = 1;
    await expect(run(client, ledger)).rejects.toMatchObject({ code: 'cast_member_drifted', role: 'liaison' });
    expect(client.posts).toHaveLength(3);
  });

  test('collision by address (any case, any state) refuses before any plan or POST', async () => {
    const client = fakeClient({ rows: [{ entity: 'contact', contactid: '11111111-1111-4111-8111-111111111111', firstname: 'Real', lastname: 'Person', emailaddress1: 'OWNER+LIAISON@example.org', statecode: 1 }] });
    const ledger = memoryLedger();
    await expect(run(client, ledger)).rejects.toMatchObject({ code: 'cast_ownership_collision', role: 'liaison' });
    expect(client.posts).toHaveLength(0);
    expect(ledger.planCastMember).not.toHaveBeenCalled();
  });

  test('collision by exact name pair (person, inactive) refuses before any plan or POST', async () => {
    const client = fakeClient({ rows: [{ entity: 'wmkf_potentialreviewers', wmkf_potentialreviewersid: '22222222-2222-4222-8222-222222222222', wmkf_firstname: 'TEST · Factory', wmkf_lastname: 'Reviewer', wmkf_emailaddress: 'x@y.org', statecode: 1 }] });
    const ledger = memoryLedger();
    await expect(run(client, ledger)).rejects.toMatchObject({ code: 'cast_ownership_collision', role: 'suggested_reviewer' });
    expect(client.posts).toHaveLength(0);
    expect(ledger.planCastMember).not.toHaveBeenCalled();
  });

  test('name lookups escape OData quotes', async () => {
    const names = { ...CAST_DEFAULT_NAMES, pi: { firstName: "TEST · O'Brien", lastName: "D'Arcy" } };
    const client = fakeClient({ rows: [{ entity: 'contact', contactid: '33333333-3333-4333-8333-333333333333', firstname: "TEST · O'Brien", lastname: "D'Arcy", emailaddress1: 'z@y.org' }] });
    await expect(run(client, memoryLedger(), { names })).rejects.toMatchObject({ code: 'cast_ownership_collision', role: 'pi' });
    expect(client.gets.some((g) => decodeURIComponent(g).includes("firstname eq 'TEST · O''Brien' and lastname eq 'D''Arcy'"))).toBe(true);
  });

  test('POST throws but the row landed: recovered by GUID readback, no second POST', async () => {
    const client = fakeClient({ onPost: ({ path, row, store }) => { store.push(row); if (path === '/contacts' && row.lastname === 'PI') throw new Error('socket hang up'); return { ok: true, status: 204 }; } });
    const ledger = memoryLedger();
    const result = await run(client, ledger);
    expect(client.posts).toHaveLength(3);
    expect(result.members[0]).toMatchObject({ role: 'pi', status: 'verified', outcome: 'recovered' });
    expect(ledger.rows[0].readback).toMatchObject({ recovered: true, matched: true });
  });

  test('POST throws and the row is absent: needs_attention, no second POST, and a rerun stops', async () => {
    const client = fakeClient({ onPost: () => { throw new Error('socket hang up'); } });
    const ledger = memoryLedger();
    await expect(run(client, ledger)).rejects.toMatchObject({ code: 'cast_create_unverified', role: 'pi' });
    expect(client.posts).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({ role: 'pi', status: 'needs_attention' });
    expect(ledger.rows[0].error).toMatch(/^cast_create_unverified/);
    await expect(run(client, ledger)).rejects.toMatchObject({ code: 'cast_member_needs_attention', role: 'pi' });
    expect(client.posts).toHaveLength(1);
  });

  test('a non-ok POST response is settled by readback the same way', async () => {
    const client = fakeClient({ onPost: () => ({ ok: false, status: 400, text: 'bad' }) });
    const ledger = memoryLedger();
    await expect(run(client, ledger)).rejects.toMatchObject({ code: 'cast_create_unverified' });
    expect(client.posts).toHaveLength(1);
  });

  test('a failed readback leaves the member dispatched for the same command to resume', async () => {
    const client = fakeClient();
    const realGet = client.get;
    let failOnce = true;
    client.get = async (path) => {
      if (failOnce && /^\/contacts\([0-9a-f-]{36}\)/.test(path)) { failOnce = false; return { ok: false, status: 503 }; }
      return realGet(path);
    };
    const ledger = memoryLedger();
    await expect(run(client, ledger)).rejects.toMatchObject({ code: 'cast_read_failed' });
    expect(ledger.rows[0].status).toBe('dispatched');
    const result = await run(client, ledger);
    expect(result.members[0]).toMatchObject({ role: 'pi', outcome: 'recovered' });
    expect(client.posts).toHaveLength(3);
  });

  test('dispatched on entry with the row present: recovered without POSTing it', async () => {
    const memberId = '44444444-4444-4444-8444-444444444444';
    const ledger = memoryLedger([{ memberId, environment: ENV, role: 'pi', entity: 'contact', firstName: 'TEST · Factory', lastName: 'PI', addressSha256: digest('owner+pi@example.org'), status: 'dispatched' }]);
    const client = fakeClient({ rows: [{ entity: 'contact', contactid: memberId, firstname: 'TEST · Factory', lastname: 'PI', emailaddress1: 'owner+pi@example.org', statecode: 0, _parentcustomerid_value: FOUNDATION }] });
    const result = await run(client, ledger);
    expect(client.posts.map((p) => p.path)).toEqual(['/contacts', '/wmkf_potentialreviewerses']);
    expect(client.posts.some((p) => p.body.contactid === memberId)).toBe(false);
    expect(result.members[0]).toMatchObject({ memberId, outcome: 'recovered', status: 'verified' });
  });

  test('planned on entry with the row absent: dispatched then needs_attention, never POSTed', async () => {
    const memberId = '55555555-5555-4555-8555-555555555555';
    const ledger = memoryLedger([{ memberId, environment: ENV, role: 'pi', entity: 'contact', firstName: 'TEST · Factory', lastName: 'PI', addressSha256: digest('owner+pi@example.org'), status: 'planned' }]);
    const client = fakeClient();
    await expect(run(client, ledger)).rejects.toMatchObject({ code: 'cast_create_unverified', role: 'pi' });
    expect(client.posts).toHaveLength(0);
    expect(ledger.calls.filter(([, id]) => id === memberId).map(([kind]) => kind)).toEqual(['dispatched', 'needs_attention']);
  });

  test('readback mismatch: a plug-in sets a parent account on the contact → needs_attention', async () => {
    const client = fakeClient({ onPost: ({ row, store }) => { store.push({ ...row, _parentcustomerid_value: '66666666-6666-4666-8666-666666666666' }); return { ok: true, status: 204 }; } });
    const ledger = memoryLedger();
    await expect(run(client, ledger)).rejects.toMatchObject({ code: 'cast_readback_mismatch', role: 'pi' });
    expect(ledger.rows[0].status).toBe('needs_attention');
    expect(ledger.rows[0].error).toMatch(/_parentcustomerid_value/);
    expect(client.posts).toHaveLength(1);
  });

  test('readback mismatch: the person marker reads false → needs_attention', async () => {
    const client = fakeClient({ onPost: ({ row, store }) => { store.push(row.entity === 'contact' ? row : { ...row, wmkf_issyntheticreviewer: false }); return { ok: true, status: 204 }; } });
    const ledger = memoryLedger();
    await expect(run(client, ledger)).rejects.toMatchObject({ code: 'cast_readback_mismatch', role: 'suggested_reviewer' });
    expect(ledger.rows.map((r) => r.status)).toEqual(['verified', 'verified', 'needs_attention']);
    expect(ledger.rows[2].error).toMatch(/wmkf_issyntheticreviewer/);
  });

  test('the runner POSTs through the cast fence: a body with an extra column is refused before it is sent', async () => {
    mockTamper = true;
    const client = fakeClient();
    const ledger = memoryLedger();
    await expect(run(client, ledger)).rejects.toMatchObject({ code: 'cast_create_refused_locally', role: 'pi' });
    expect(client.posts).toHaveLength(0);
    expect(ledger.rows[0].status).toBe('needs_attention');
  });

  test('a concurrent run that journaled the role first stops with a coded conflict and no POST', async () => {
    const client = fakeClient();
    const ledger = memoryLedger();
    ledger.planCastMember.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));
    await expect(run(client, ledger)).rejects.toMatchObject({ code: 'cast_ledger_conflict', role: 'pi' });
    expect(client.posts).toHaveLength(0);
  });

  test('refusals before any write: allowlist, duplicate address, wrong org, name without prefix', async () => {
    const ledger = memoryLedger();
    const client = fakeClient();
    await expect(run(client, ledger, { allowlist: new Set(['other@example.org']) })).rejects.toMatchObject({ code: 'cast_address_not_allowlisted' });
    await expect(run(client, ledger, { addresses: { ...ADDRESSES, suggested_reviewer: ADDRESSES.pi } })).rejects.toMatchObject({ code: 'cast_address_duplicate' });
    await expect(run({ ...client, baseUrl: 'https://wmkf.crm.dynamics.com/api/data/v9.2' }, ledger)).rejects.toMatchObject({ code: 'cast_environment_mismatch' });
    await expect(run(client, ledger, { names: { ...CAST_DEFAULT_NAMES, pi: { firstName: 'Factory', lastName: 'PI' } } })).rejects.toMatchObject({ code: 'cast_name_invalid' });
    expect(client.posts).toHaveLength(0);
    expect(ledger.planCastMember).not.toHaveBeenCalled();
  });
});

describe('buildCastBody', () => {
  test('every role body passes the real fence as-is and is refused with an extra column', async () => {
    const actual = jest.requireActual('../../lib/services/test-requests/production-write-fence.js');
    for (const [role, entity] of [['pi', 'contact'], ['suggested_reviewer', 'wmkf_potentialreviewers']]) {
      const memberId = '77777777-7777-4777-8777-777777777777';
      const inner = { baseUrl: SANDBOX_URL, post: jest.fn(async () => ({ ok: true, status: 204 })) };
      const fenced = actual.fenceCastCreateClient(inner, { parentAccountId: FOUNDATION, members: [{ memberId, entity, firstName: 'TEST · Factory', lastName: 'X', address: 'a@b.org' }] });
      const body = buildCastBody({ role, memberId, firstName: 'TEST · Factory', lastName: 'X', address: 'a@b.org', parentAccountId: FOUNDATION });
      const path = entity === 'contact' ? '/contacts' : '/wmkf_potentialreviewerses';
      await fenced.post(path, body);
      expect(() => fenced.post(path, { ...body, extra: 1 })).toThrow(expect.objectContaining({ code: 'create_rejected' }));
      expect(inner.post).toHaveBeenCalledTimes(1);
    }
  });
});

describe('the Foundation parent (owner, S548)', () => {
  const verifiedContact = (memberId, role, lastName, address) => ({
    memberId, environment: ENV, role, entity: 'contact', firstName: 'TEST · Factory', lastName, addressSha256: digest(address), status: 'verified',
  });
  const liveContact = (memberId, lastName, address, parent) => ({
    entity: 'contact', contactid: memberId, firstname: 'TEST · Factory', lastname: lastName, emailaddress1: address,
    statecode: 0, _parentcustomerid_value: parent, '@odata.etag': 'W/"7"',
  });
  const PI = '61616161-6161-4616-8616-616161616161';
  const LI = '62626262-6262-4626-8626-626262626262';

  test('a verified contact created parentless gets its parent attached by one fenced PATCH under its ETag, then reads back', async () => {
    const ledger = memoryLedger([verifiedContact(PI, 'pi', 'PI', 'owner+pi@example.org'), verifiedContact(LI, 'liaison', 'Liaison', 'owner+liaison@example.org')]);
    const client = fakeClient({ rows: [liveContact(PI, 'PI', 'owner+pi@example.org', null), liveContact(LI, 'Liaison', 'owner+liaison@example.org', FOUNDATION)] });
    const result = await run(client, ledger);
    expect(client.patches).toEqual([{ path: `/contacts(${PI})`, body: { [PARENT_BIND]: `/accounts(${FOUNDATION})` }, headers: { 'If-Match': 'W/"7"' } }]);
    expect(result.members.slice(0, 2).map((m) => m.outcome)).toEqual(['parent_attached', 'reused']);
    await expect(readCast({ client, ledger, environment: ENV, parentAccountId: FOUNDATION, roles: ['pi', 'liaison'] })).resolves.toBeTruthy();
  });

  test('a verified contact under another account is drift, never re-parented', async () => {
    const OTHER = '63636363-6363-4636-8636-636363636363';
    const ledger = memoryLedger([verifiedContact(PI, 'pi', 'PI', 'owner+pi@example.org')]);
    const client = fakeClient({ rows: [liveContact(PI, 'PI', 'owner+pi@example.org', OTHER)] });
    await expect(run(client, ledger)).rejects.toMatchObject({ code: 'cast_member_drifted', role: 'pi' });
    expect(client.patches).toEqual([]);
  });

  test('readCast refuses a parentless cast contact and a missing parent account', async () => {
    const ledger = memoryLedger([verifiedContact(PI, 'pi', 'PI', 'owner+pi@example.org')]);
    const client = fakeClient({ rows: [liveContact(PI, 'PI', 'owner+pi@example.org', null)] });
    await expect(readCast({ client, ledger, environment: ENV, parentAccountId: FOUNDATION, roles: ['pi'] }))
      .rejects.toMatchObject({ code: 'cast_member_drifted' });
    await expect(readCast({ client, ledger, environment: ENV, roles: ['pi'] })).rejects.toMatchObject({ code: 'cast_parent_invalid' });
    await expect(run(client, ledger, { parentAccountId: undefined })).rejects.toMatchObject({ code: 'cast_parent_invalid' });
  });
});

describe('readCast', () => {
  test('returns the three verified members confirmed live, with no addresses', async () => {
    const client = fakeClient();
    const ledger = memoryLedger();
    await run(client, ledger);
    const cast = await readCast({ client, ledger, environment: ENV, parentAccountId: FOUNDATION });
    expect(Object.keys(cast)).toEqual(['pi', 'liaison', 'suggested_reviewer']);
    expect(cast.pi).toEqual({ memberId: ledger.rows[0].memberId, entity: 'contact', firstName: 'TEST · Factory', lastName: 'PI' });
    expect(JSON.stringify(cast)).not.toMatch(/example\.org/);
  });

  test('refuses a missing role, an unverified member, and a live email that no longer matches the digest', async () => {
    const client = fakeClient();
    const ledger = memoryLedger();
    await expect(readCast({ client, ledger, environment: ENV, parentAccountId: FOUNDATION })).rejects.toMatchObject({ code: 'cast_member_missing', role: 'pi' });
    await run(client, ledger);
    client.store.find((r) => r.entity === 'wmkf_potentialreviewers').wmkf_emailaddress = 'owner+swapped@example.org';
    await expect(readCast({ client, ledger, environment: ENV, parentAccountId: FOUNDATION })).rejects.toMatchObject({ code: 'cast_member_drifted', role: 'suggested_reviewer' });
    ledger.rows[1].status = 'dispatched';
    await expect(readCast({ client, ledger, environment: ENV, parentAccountId: FOUNDATION })).rejects.toMatchObject({ code: 'cast_member_unverified', role: 'liaison' });
  });
});
