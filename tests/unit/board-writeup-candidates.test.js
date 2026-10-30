import { candidates, sourceDependencies } from '../../lib/services/board-writeups/source';
import { PROGRAM_ID } from '../../lib/services/board-writeups/model';
import { DynamicsService } from '../../lib/services/dynamics-service';

// The cycle filter and expand check the wmkf_grantcycle restriction; runtime callers hold a Dynamics context.
beforeEach(() => { jest.spyOn(DynamicsService, 'checkRestriction').mockImplementation(() => {}); });
afterEach(() => { jest.restoreAllMocks(); });

const row = overrides => ({
  akoya_requestid: '11111111-1111-4111-8111-111111111111',
  akoya_requestnum: '1002988', akoya_requeststatus: 'Phase II Pending',
  _wmkf_grantprogram_value: PROGRAM_ID, wmkf_meetingdate: '2026-12-11', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' },
  wmkf_istestrequest: false, wmkf_testcreationrunid: null, ...overrides,
});

test('candidate query and row guard admit only ordinary Phase II requests in this cycle', async () => {
  const eligible = row({});
  const queryRequests = jest.fn(async () => ({ capped: false, records: [eligible,
    row({ akoya_requeststatus: 'Phase I Pending' }),
    row({ akoya_requeststatus: 'Phase I Declined' }),
    row({ akoya_requeststatus: null }),
    row({ akoya_requeststatus: undefined }),
    row({ wmkf_istestrequest: true }),
    row({ wmkf_testcreationrunid: 'legacy-test' }),
    row({ wmkf_istestrequest: undefined }),
    row({ wmkf_meetingdate: '2026-06-01', wmkf_GrantCycle: { wmkf_cyclecode: 'J26' } }),
    // December meeting date but no Grant Cycle link: no cycle.
    row({ wmkf_GrantCycle: null }),
    row({ _wmkf_grantprogram_value: '22222222-2222-4222-8222-222222222222' }),
  ] }));
  expect(await candidates('D26', { queryRequests })).toEqual([
    expect.objectContaining({ requestId: eligible.akoya_requestid, number: '1002988' }),
  ]);
  const query = queryRequests.mock.calls[0][0];
  expect(query.select.split(',')).toContain('akoya_requeststatus');
  expect(query.filter).toContain("wmkf_GrantCycle/wmkf_cyclecode eq 'D26'");
  expect(query.filter).not.toContain('wmkf_meetingdate');
  expect(query.expand).toBe('wmkf_GrantCycle($select=wmkf_cyclecode)');
  expect(query.filter).toContain("akoya_requeststatus eq 'Phase II Pending'");
  expect(query.filter).toContain('wmkf_istestrequest eq false');
  expect(query.filter).toContain('wmkf_testcreationrunid eq null');
});

test('legacy null markers are ordinary, but truncated candidate scans are refused', async () => {
  const records = [row({ wmkf_istestrequest: null })];
  expect(await candidates('D26', { queryRequests: async () => ({ records, capped: false }) })).toHaveLength(1);
  await expect(candidates('D26', { queryRequests: async () => ({ records, capped: true }) })).rejects.toThrow();
});

test('the single-request read carries the linked-cycle expand that ordinary() reads', async () => {
  const getRecord = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue(null);
  await sourceDependencies.getRequest('11111111-1111-4111-8111-111111111111');
  expect(getRecord).toHaveBeenCalledWith('akoya_requests', '11111111-1111-4111-8111-111111111111', expect.objectContaining({
    select: expect.stringContaining('wmkf_meetingdate'),
    expand: 'wmkf_GrantCycle($select=wmkf_cyclecode)',
  }));
});
