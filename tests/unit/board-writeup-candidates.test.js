import { candidates } from '../../lib/services/board-writeups/source';
import { PROGRAM_ID } from '../../lib/services/board-writeups/model';

const row = overrides => ({
  akoya_requestid: '11111111-1111-4111-8111-111111111111',
  akoya_requestnum: '1002988', akoya_requeststatus: 'Phase II Pending',
  _wmkf_grantprogram_value: PROGRAM_ID, wmkf_meetingdate: '2026-12-11',
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
    row({ wmkf_meetingdate: '2026-06-01' }),
    row({ _wmkf_grantprogram_value: '22222222-2222-4222-8222-222222222222' }),
  ] }));
  expect(await candidates('D26', { queryRequests })).toEqual([
    expect.objectContaining({ requestId: eligible.akoya_requestid, number: '1002988' }),
  ]);
  const query = queryRequests.mock.calls[0][0];
  expect(query.select.split(',')).toContain('akoya_requeststatus');
  expect(query.filter).toContain("akoya_requeststatus eq 'Phase II Pending'");
  expect(query.filter).toContain('wmkf_istestrequest eq false');
  expect(query.filter).toContain('wmkf_testcreationrunid eq null');
});

test('legacy null markers are ordinary, but truncated candidate scans are refused', async () => {
  const records = [row({ wmkf_istestrequest: null })];
  expect(await candidates('D26', { queryRequests: async () => ({ records, capped: false }) })).toHaveLength(1);
  await expect(candidates('D26', { queryRequests: async () => ({ records, capped: true }) })).rejects.toThrow();
});
