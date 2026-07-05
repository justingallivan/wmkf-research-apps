/**
 * GET /api/expertise-finder/proposals — akoya_requests business-filter query
 * contract test. Written tests-before the Wave-5(c)/Scope-B conversion to the
 * grant-request adapter's queryAllRequests passthrough per the data-access-layer
 * migration plan's per-file recipe: golden-path DTO shape + one failure path,
 * pinned against CURRENT behavior (no prior route test existed for this file).
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { queryAllRecords: jest.fn() },
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (labelOrFn, maybeFn) => {
    const fn = typeof labelOrFn === 'function' ? labelOrFn : maybeFn;
    return Promise.resolve().then(() => fn());
  },
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import handler from '../../pages/api/expertise-finder/proposals';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
const reqOf = (query) => ({ method: 'GET', query, headers: {} });

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ session: { user: {} } });
  DynamicsService.queryAllRecords.mockReset();
});

describe('GET /api/expertise-finder/proposals (grant-request adapter contract)', () => {
  test('golden: exact filter/select/orderby shape, projects the DTO', async () => {
    DynamicsService.queryAllRecords.mockResolvedValueOnce({
      records: [{
        akoya_requestid: 'r1', akoya_requestnum: '2025-100', akoya_title: 'A Study',
        akoya_fiscalyear: 'December 2025', _akoya_programid_value_formatted: 'Science & Engineering',
        _akoya_programid_value: 'prog-1', _akoya_applicantid_value_formatted: 'Some University',
        _wmkf_projectleader_value_formatted: 'Dr. PI', _wmkf_programdirector_value_formatted: 'Dr. PD',
        wmkf_phaseistatus_formatted: 'Invited', wmkf_phaseiistatus_formatted: 'Pending',
      }],
    });

    const res = mockRes();
    await handler(reqOf({ fiscalYear: 'December 2025' }), res);

    expect(res.statusCode).toBe(200);
    expect(DynamicsService.queryAllRecords).toHaveBeenCalledWith('akoya_requests', {
      select: [
        'akoya_requestid', 'akoya_requestnum', 'akoya_title', 'akoya_fiscalyear',
        'wmkf_phaseistatus', 'wmkf_phaseiistatus',
        '_akoya_programid_value', '_akoya_applicantid_value', '_wmkf_projectleader_value',
        '_wmkf_programdirector_value',
      ].join(','),
      filter: "akoya_fiscalyear eq 'December 2025' and wmkf_request_type eq 100000001",
      orderby: 'akoya_requestnum asc',
    });
    expect(res.body).toEqual({
      proposals: [{
        requestId: 'r1', requestNumber: '2025-100', title: 'A Study',
        program: 'Science & Engineering', programId: 'prog-1', institution: 'Some University',
        pi: 'Dr. PI', actualPd: 'Dr. PD', phaseIStatus: 'Invited', phaseIIStatus: 'Pending',
      }],
      totalCount: 1,
      fiscalYear: 'December 2025',
      program: 'all',
    });
  });

  test('failure: missing fiscalYear -> 400, envelope pinned, no query issued', async () => {
    const res = mockRes();
    await handler(reqOf({}), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'fiscalYear is required' });
    expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();
  });

  test('405 on non-GET, no auth check performed', async () => {
    const res = mockRes();
    await handler({ method: 'POST', query: {}, headers: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
    expect(requireAppAccess).not.toHaveBeenCalled();
  });

  test('unauth: requireAppAccess short-circuits, no query issued', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    const res = mockRes();
    await handler(reqOf({ fiscalYear: 'December 2025' }), res);
    expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();
    expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'expertise-finder');
  });

  test('domain error: adapter query throws -> 500, details omitted outside development', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    DynamicsService.queryAllRecords.mockRejectedValueOnce(new Error('Dynamics timeout'));
    const res = mockRes();
    try {
      await handler(reqOf({ fiscalYear: 'December 2025' }), res);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to query proposals from Dynamics', details: undefined });
  });
});
