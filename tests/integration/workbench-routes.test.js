/**
 * Route tests for the Request Workbench dashboard endpoints (Phase 1):
 *   - auth gating (401 / 403 / reviewers-grant reaches)
 *   - the additive allowlist union for the D26 cycle
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

  it('cycle-list mode: a reviewers grant gets cycles incl. the D26 allowlist cycle', async () => {
    mockAuthenticatedUser(1, ['reviewers']);
    // listCycles query: PD has a Dec-2026 proposal → J/D derivation yields D26 anyway,
    // but force a different cycle so we prove D26 is *always* added.
    DynamicsService.queryAllRecords.mockResolvedValueOnce({
      records: [{ akoya_requestid: 'rc', wmkf_meetingdate: '2026-06-04' }],
    });
    const res = createMockRes();
    await handler(createMockReq({ method: 'GET' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    const codes = body.cycles.map((c) => c.code);
    expect(codes).toContain('D26');
    expect(codes).toContain('J26');
    expect(body.defaultCycleCode).toBe('D26');
  });

  it('D26 proposals mode: unions the allowlist-by-number rows on top of the status-gated branch', async () => {
    mockAuthenticatedUser(1, ['reviewers']);
    DynamicsService.queryAllRecords.mockImplementation((entity, opts) => {
      if (entity === 'wmkf_appreviewersuggestions') return Promise.resolve({ records: [] });
      if (entity === 'akoya_requests' && opts.filter?.includes('akoya_requestnum')) {
        // allowlist branch — a Phase-I-Pending going-forward request
        return Promise.resolve({
          records: [{
            akoya_requestid: 'r-allow',
            akoya_requestnum: '1002836',
            wmkf_meetingdate: '2026-12-11',
            akoya_requeststatus: 'Phase I Pending',
            _wmkf_programdirector_value: 'pd-1',
          }],
        });
      }
      // status-gated branch returns nothing for D26 (all Phase I Pending)
      return Promise.resolve({ records: [] });
    });

    const res = createMockRes();
    await handler(createMockReq({ method: 'GET', query: { cycleCode: 'D26', scope: 'all' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0].requestNumber).toBe('1002836');
    expect(body.proposals[0].allowlisted).toBe(true);
    expect(body.proposals[0].cycleCode).toBe('D26');
    expect(body.proposals[0].workRemaining).toBe('find'); // no candidates yet
    expect(body.rollup.total).toBe(1);
  });

  it('a NON-allowlist cycle does not trigger the allowlist branch', async () => {
    mockAuthenticatedUser(1, ['reviewers']);
    const res = createMockRes();
    await handler(createMockReq({ method: 'GET', query: { cycleCode: 'J26', scope: 'my' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    // No queryAllRecords call should carry an akoya_requestnum (allowlist) filter.
    const calledWithNumberFilter = DynamicsService.queryAllRecords.mock.calls
      .some(([, opts]) => opts?.filter?.includes('akoya_requestnum'));
    expect(calledWithNumberFilter).toBe(false);
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
