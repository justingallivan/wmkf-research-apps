import { applyProposalRankingTrialCutoff } from '../../lib/services/proposal-ranking/trial-cutoff.js';

test('applies the numeric request cutoff only to December 2026', () => {
  const rows = [
    { akoya_requestnum: '1003219', wmkf_meetingdate: '2026-12-10T00:00:00Z' },
    { akoya_requestnum: '1003220', wmkf_meetingdate: '2026-12-10T00:00:00Z' },
    { akoya_requestnum: '1003221', wmkf_meetingdate: '2026-06-10T00:00:00Z' },
  ];

  expect(applyProposalRankingTrialCutoff(rows)).toEqual({
    requests: [rows[0], rows[2]],
    excludedRequestCount: 1,
  });
});

test.each([undefined, null, '', 'D26-1', '9007199254740992'])(
  'fails closed for a malformed December 2026 request number: %s',
  (akoya_requestnum) => {
    expect(() => applyProposalRankingTrialCutoff([{
      akoya_requestnum,
      wmkf_meetingdate: '2026-12-10T00:00:00Z',
    }])).toThrow('December 2026 Proposal Ranking trial encountered a missing or malformed request number.');
  },
);
