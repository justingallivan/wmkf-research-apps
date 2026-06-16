/**
 * Route tests for the Request Workbench dashboard endpoints (Phase 1):
 *   - auth gating (401 / 403 / reviewers-grant reaches)
 *   - triage-driven visibility (S261): Advancing + Phase II Pending, hide Set aside,
 *     ?includeSetAside toggle, scope=my/all parenthesization
 *   - number→GUID resolve
 */

import {
  mockUnauthenticated,
  mockAuthenticatedUser,
  createMockReq,
  createMockRes,
  clearAppAccessCache,
} from '../helpers/auth-mock';

import { DynamicsService } from '../../lib/services/dynamics-service';
import { resolveByEmail } from '../../lib/services/program-director-resolver';
import { cycleCodeToOdataFilter } from '../../lib/utils/cycle-code';

// Exact OData fragments the dashboard builds (S261 triage switch). The cycle range
// is derived from the same helper so the assertions pin STRUCTURE/grouping, not
// the date-format details — a regression that dropped the cycle filter or changed
// the parenthesization would fail these.
const D26_CYCLE = cycleCodeToOdataFilter('D26');
const TRIAGE_BASE = "akoya_requeststatus eq 'Phase II Pending' or wmkf_triagestatus eq 100000000";
const HIDE_SET_ASIDE = '(wmkf_triagestatus eq null or wmkf_triagestatus ne 100000001)';
const PD_FILTER = '_wmkf_programdirector_value eq pd-1';

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    queryAllRecords: jest.fn(() => Promise.resolve({ records: [] })),
    queryRecords: jest.fn(() => Promise.resolve({ records: [] })),
    getRecord: jest.fn(),
  },
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));

jest.mock('../../lib/services/program-director-resolver', () => ({
  resolveByEmail: jest.fn(),
}));

beforeEach(() => {
  clearAppAccessCache();
  jest.clearAllMocks();
  resolveByEmail.mockResolvedValue({ systemuserid: 'pd-1', fullName: 'Dr. PD One' });
});

async function load(path) {
  const mod = await import(path);
  return mod.default;
}

describe('/api/workbench/dashboard', () => {
  let handler;
  beforeAll(async () => { handler = await load('../../pages/api/workbench/dashboard'); });

  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticated();
    const res = createMockRes();
    await handler(createMockReq({ method: 'GET' }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 403 for an unrelated grant', async () => {
    mockAuthenticatedUser(1, ['dynamics-explorer']);
    const res = createMockRes();
    await handler(createMockReq({ method: 'GET' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('cycle-list mode: cycles derive from the PD\'s meeting-dated proposals; default = latest', async () => {
    mockAuthenticatedUser(1, ['reviewers']);
    // Derived purely from meeting dates (S261: no hardcoded D26 anchor). The PD has
    // a Dec-2026 (D26) and a June-2026 (J26) proposal; latest (D26) is the default.
    DynamicsService.queryAllRecords.mockResolvedValueOnce({
      records: [
        { akoya_requestid: 'rd', wmkf_meetingdate: '2026-12-11' },
        { akoya_requestid: 'rj', wmkf_meetingdate: '2026-06-04' },
      ],
    });
    const res = createMockRes();
    await handler(createMockReq({ method: 'GET' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.cycles.map((c) => c.code)).toEqual(['D26', 'J26']); // sorted latest-first
    expect(body.defaultCycleCode).toBe('D26');
  });

  it('cycle-list mode: a PD with no D26 proposals gets NO synthetic D26 anchor (allowlist retired)', async () => {
    mockAuthenticatedUser(1, ['reviewers']);
    DynamicsService.queryAllRecords.mockResolvedValueOnce({
      records: [{ akoya_requestid: 'rj', wmkf_meetingdate: '2026-06-04' }], // only J26
    });
    const res = createMockRes();
    await handler(createMockReq({ method: 'GET' }), res);
    const body = res.json.mock.calls[0][0];
    expect(body.cycles.map((c) => c.code)).toEqual(['J26']); // D26 not force-added
    expect(body.defaultCycleCode).toBe('J26');
  });

  it('proposals mode: triage-driven filter (Advancing + Phase II Pending), hides Set aside, no allowlist query', async () => {
    mockAuthenticatedUser(1, ['reviewers']);
    let proposalFilter = null;
    DynamicsService.queryAllRecords.mockImplementation((entity, opts) => {
      if (entity === 'wmkf_appreviewersuggestions') return Promise.resolve({ records: [] });
      if (entity === 'akoya_requests') {
        proposalFilter = opts.filter;
        return Promise.resolve({
          records: [{
            akoya_requestid: 'r-adv',
            akoya_requestnum: '1002836',
            wmkf_meetingdate: '2026-12-11',
            akoya_requeststatus: 'Phase I Pending',
            wmkf_triagestatus: 100000000, // Advancing
            _wmkf_programdirector_value: 'pd-1',
          }],
        });
      }
      return Promise.resolve({ records: [] });
    });

    const res = createMockRes();
    await handler(createMockReq({ method: 'GET', query: { cycleCode: 'D26', scope: 'all' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Exact filter (scope=all): cycle ∧ (Phase II Pending ∨ Advancing) ∧ hide-Set-aside.
    expect(proposalFilter).toBe(`(${D26_CYCLE}) and (${TRIAGE_BASE}) and ${HIDE_SET_ASIDE}`);
    expect(proposalFilter).not.toContain('akoya_requestnum'); // allowlist branch is gone
    expect(proposalFilter).not.toContain('_wmkf_programdirector_value'); // scope=all → no PD filter

    const body = res.json.mock.calls[0][0];
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0].requestNumber).toBe('1002836');
    expect(body.proposals[0].advancing).toBe(true);
    expect(body.proposals[0].setAside).toBe(false);
    expect(body.proposals[0].canManage).toBe(true); // caller is the lead PD
    expect(body.proposals[0].programDirectorId).toBeUndefined();
    expect(body.proposals[0].allowlisted).toBeUndefined(); // replaced by triage fields
    expect(body.proposals[0].cycleCode).toBe('D26');
    expect(body.proposals[0].workRemaining).toBe('find'); // no candidates yet
    expect(body.rollup.total).toBe(1);
  });

  it('?includeSetAside=1 reveals Set aside rows (filter drops the hide clause; row projects setAside)', async () => {
    mockAuthenticatedUser(1, ['reviewers']);
    let proposalFilter = null;
    DynamicsService.queryAllRecords.mockImplementation((entity, opts) => {
      if (entity === 'akoya_requests') {
        proposalFilter = opts.filter;
        return Promise.resolve({
          records: [{
            akoya_requestid: 'r-aside',
            akoya_requestnum: '1002999',
            wmkf_meetingdate: '2026-12-11',
            akoya_requeststatus: 'Phase I Pending',
            wmkf_triagestatus: 100000001, // Set aside
          }],
        });
      }
      return Promise.resolve({ records: [] });
    });
    const res = createMockRes();
    await handler(createMockReq({ method: 'GET', query: { cycleCode: 'D26', scope: 'all', includeSetAside: '1' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Exact filter: cycle ∧ (Phase II Pending ∨ Advancing ∨ Set aside); no hide clause.
    expect(proposalFilter).toBe(`(${D26_CYCLE}) and (${TRIAGE_BASE} or wmkf_triagestatus eq 100000001)`);
    expect(proposalFilter).not.toContain('ne 100000001'); // hide clause dropped
    const body = res.json.mock.calls[0][0];
    expect(body.includeSetAside).toBe(true);
    expect(body.proposals[0].setAside).toBe(true);
    expect(body.proposals[0].advancing).toBe(false);
  });

  it('scope=my appends the lead-PD filter as its own AND term (triage OR stays parenthesized)', async () => {
    mockAuthenticatedUser(1, ['reviewers']);
    let proposalFilter = null;
    DynamicsService.queryAllRecords.mockImplementation((entity, opts) => {
      if (entity === 'akoya_requests') { proposalFilter = opts.filter; return Promise.resolve({ records: [] }); }
      return Promise.resolve({ records: [] });
    });
    const res = createMockRes();
    await handler(createMockReq({ method: 'GET', query: { cycleCode: 'D26', scope: 'my' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    // Exact filter: default + an appended PD AND term; triage OR stays parenthesized.
    expect(proposalFilter).toBe(`(${D26_CYCLE}) and (${TRIAGE_BASE}) and ${HIDE_SET_ASIDE} and ${PD_FILTER}`);
  });

  it('default filter cannot surface untriaged Concept rows (visibility requires Phase II Pending or Advancing)', async () => {
    mockAuthenticatedUser(1, ['reviewers']);
    let proposalFilter = null;
    DynamicsService.queryAllRecords.mockImplementation((entity, opts) => {
      if (entity === 'akoya_requests') { proposalFilter = opts.filter; return Promise.resolve({ records: [] }); }
      return Promise.resolve({ records: [] });
    });
    const res = createMockRes();
    await handler(createMockReq({ method: 'GET', query: { cycleCode: 'D26', scope: 'all' } }), res);
    // A Concept row is untriaged AND not Phase II Pending, so it matches neither
    // side of the base visibility OR → the Dataverse filter excludes it. `eq null`
    // appears ONLY inside the hide-Set-aside guard, never as a standalone
    // "include untriaged" clause.
    expect(proposalFilter).toContain("(akoya_requeststatus eq 'Phase II Pending' or wmkf_triagestatus eq 100000000)");
    expect(proposalFilter).toContain('(wmkf_triagestatus eq null or wmkf_triagestatus ne 100000001)');
  });

  it('rejects a non-GET method', async () => {
    mockAuthenticatedUser(1, ['reviewers']);
    const res = createMockRes();
    await handler(createMockReq({ method: 'POST' }), res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe('/api/workbench/resolve-request', () => {
  let handler;
  beforeAll(async () => { handler = await load('../../pages/api/workbench/resolve-request'); });

  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticated();
    const res = createMockRes();
    await handler(createMockReq({ method: 'GET', query: { requestNumber: '1002836' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 400 when requestNumber is missing', async () => {
    mockAuthenticatedUser(1, ['reviewers']);
    const res = createMockRes();
    await handler(createMockReq({ method: 'GET' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('resolves a request number to its GUID + cycle for a reviewers grant', async () => {
    mockAuthenticatedUser(1, ['reviewers']);
    DynamicsService.queryRecords.mockResolvedValue({
      records: [{
        akoya_requestid: 'guid-1',
        akoya_requestnum: '1002836',
        akoya_title: 'Test',
        wmkf_meetingdate: '2026-12-11',
        akoya_requeststatus: 'Phase I Pending',
      }],
    });
    const res = createMockRes();
    await handler(createMockReq({ method: 'GET', query: { requestNumber: '1002836' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.requestId).toBe('guid-1');
    expect(body.cycleCode).toBe('D26');
  });

  it('returns 404 for an unknown request number', async () => {
    mockAuthenticatedUser(1, ['reviewers']);
    DynamicsService.queryRecords.mockResolvedValue({ records: [] });
    const res = createMockRes();
    await handler(createMockReq({ method: 'GET', query: { requestNumber: '9999999' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
