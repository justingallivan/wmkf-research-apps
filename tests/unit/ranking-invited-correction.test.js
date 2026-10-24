import { correctSnapshot, appendCorrectionEvent, EVENT_TYPE } from '../../scripts/lib/ranking-invited-correction.mjs';

const usd = { code: 'USD', name: 'US Dollar', precision: 2 };
const snapshotOf = (proposals) => JSON.stringify({ version: 2, cycleCode: 'D26', proposals, seedOrders: { se: [], mr: [] }, roster: [] });
const frozen = [
  { requestId: 'a', requestNumber: '1001', amountMinorUnits: 160000000, currency: usd, score: { mean: 4 } },
  { requestId: 'b', requestNumber: '1002', amountMinorUnits: 50000000, currency: usd },
];
const live = (rows) => new Map(rows.map((r) => [r.akoya_requestid, r]));
const row = (id, requested, invited, extra = {}) => ({ akoya_requestid: id, akoya_request: requested, wmkf_invitedamount: invited, wmkf_istestrequest: false, wmkf_testcreationrunid: null, ...extra });

test('changes only differing amounts, tags every proposal invited, keeps all other keys', () => {
  const { snapshotJson, changes } = correctSnapshot(snapshotOf(frozen), live([row('a', 1600000, 1300000), row('b', 500000, 500000)]));
  const out = JSON.parse(snapshotJson);
  expect(changes).toEqual([{ requestId: 'a', requestNumber: '1001', fromMinorUnits: 160000000, toMinorUnits: 130000000 }]);
  expect(out.proposals).toEqual([
    { ...frozen[0], amountMinorUnits: 130000000, amountSource: 'invited' },
    { ...frozen[1], amountSource: 'invited' },
  ]);
  const { proposals: _p, ...rest } = out;
  const { proposals: _q, ...before } = JSON.parse(snapshotOf(frozen));
  expect(rest).toEqual(before);
});

test.each([
  ['a blank invited amount', row('a', 1600000, null), /invited amount is blank/],
  ['a test request', row('a', 1600000, 1300000, { wmkf_istestrequest: true }), /test request/],
  ['a frozen amount that is not the live requested amount', row('a', 1700000, 1300000), /refusing to guess/],
])('refuses %s', (_label, liveRow, message) => {
  expect(() => correctSnapshot(snapshotOf(frozen), live([liveRow, row('b', 500000, 500000)]))).toThrow(message);
});

test('refuses a missing live request and a snapshot that does not round-trip', () => {
  expect(() => correctSnapshot(snapshotOf(frozen), live([row('b', 500000, 500000)]))).toThrow(/not found/);
  expect(() => correctSnapshot(`${snapshotOf(frozen)} `, live([]))).toThrow(/round-trip/);
});

test('appends one typed event and keeps existing events', () => {
  const json = appendCorrectionEvent('[{"type":"x"}]', { operationId: 'op' });
  expect(JSON.parse(json)).toEqual([{ type: 'x' }, { type: EVENT_TYPE, operationId: 'op' }]);
  expect(JSON.parse(appendCorrectionEvent(null, { operationId: 'op' }))).toHaveLength(1);
  expect(() => appendCorrectionEvent('[]', { pad: 'x'.repeat(200) }, 100)).toThrow(/storage limit/);
});
