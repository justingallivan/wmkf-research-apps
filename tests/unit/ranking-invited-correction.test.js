import {
  correctSnapshot, appendCorrectionEvent, EVENT_TYPE, sha, decideApply, decideRollback, roundStateVs,
} from '../../scripts/lib/ranking-invited-correction.mjs';

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

describe('apply and rollback decide from stored state', () => {
  const original = snapshotOf(frozen);
  const corrected = correctSnapshot(original, live([row('a', 1600000, 1300000), row('b', 500000, 500000)])).snapshotJson;
  const correctedLog = appendCorrectionEvent('[]', { operationId: 'op' });
  const lists = [{ key: 'pd:1:se:x', etag: 'W/"10"', status: 100000000, version: 2 }];
  const plan = {
    etag: 'W/"1"',
    original: { snapshotSha: sha(original), snapshotJson: original, logJson: '[]' },
    corrected: { snapshotSha: sha(corrected), snapshotJson: corrected, logJson: correctedLog },
    baseline: { lastOperationId: 'pd-op-1', workflowSha: sha('{"stage":"private"}'), lists },
  };
  const round = (over = {}) => ({
    '@odata.etag': 'W/"1"', wmkf_snapshotjson: original, wmkf_administrationlogjson: '[]',
    wmkf_lastoperationid: 'pd-op-1', wmkf_workflowjson: '{"stage":"private"}', ...over,
  });
  const appliedRound = (over = {}) => round({ '@odata.etag': 'W/"2"', wmkf_snapshotjson: corrected, wmkf_administrationlogjson: correctedLog, ...over });

  test('apply patches the planned original and is done once corrected (lost response, crash before journal)', () => {
    expect(decideApply(round(), plan)).toEqual({ action: 'patch' });
    expect(decideApply(appliedRound(), plan)).toEqual({ action: 'done' });
  });

  test('apply refuses when the round moved since the plan or holds an unknown state', () => {
    expect(decideApply(round({ '@odata.etag': 'W/"5"' }), plan).action).toBe('refuse');
    expect(decideApply(round({ wmkf_administrationlogjson: '[{"type":"x"}]' }), plan).action).toBe('refuse');
  });

  test('rollback patches only when no app write happened since the plan', () => {
    expect(decideRollback(appliedRound(), lists, plan)).toEqual({ action: 'patch' });
  });

  test.each([
    ['a PD action stamped the round after apply', appliedRound({ wmkf_lastoperationid: 'pd-op-2', '@odata.etag': 'W/"3"' }), lists],
    ['workflow state changed', appliedRound({ wmkf_workflowjson: '{"stage":"ready"}' }), lists],
    ['a list row changed', appliedRound(), [{ ...lists[0], etag: 'W/"11"', version: 3 }]],
  ])('rollback refuses when %s', (_label, current, currentLists) => {
    const decision = decideRollback(current, currentLists, plan);
    expect(decision.action).toBe('refuse');
    expect(decision.reason).toMatch(/app activity since the plan/);
  });

  test('rollback is done once the original is back (committed rollback, failed readback)', () => {
    expect(decideRollback(round({ '@odata.etag': 'W/"4"' }), lists, plan)).toEqual({ action: 'done' });
    expect(roundStateVs(round(), plan)).toBe('original');
  });
});
