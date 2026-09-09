/**
 * @jest-environment node
 *
 * lib/services/workbench/grantee-deliverables/awardees-service — logic-level
 * tests (adapter mocked), Stage 4 series C extraction. The route suite pins
 * filter shape + envelopes; this pins the service branches: PD-unresolved
 * empty list, per-row deliverable fail-soft, and scope plumbing.
 */

const queryAllRequests = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  queryAllRequests: (...a) => queryAllRequests(...a),
}));

const resolveByEmail = jest.fn();
jest.mock('../../lib/services/program-director-resolver', () => ({
  resolveByEmail: (...a) => resolveByEmail(...a),
}));

const getDeliverableForRequest = jest.fn();
jest.mock('../../lib/services/grantee-deliverable-record', () => ({
  getDeliverableForRequest: (...a) => getDeliverableForRequest(...a),
}));

import { listGranteeAwardees, listGranteeAwardeeCycles } from '../../lib/services/workbench/grantee-deliverables/awardees-service';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';

beforeEach(() => {
  jest.clearAllMocks();
  resolveByEmail.mockResolvedValue({ systemuserid: 'pd-me', fullName: 'Justin Gallivan' });
  queryAllRequests.mockResolvedValue({ records: [], totalCount: 0, capped: false });
  getDeliverableForRequest.mockResolvedValue(null);
});

test('mine-scope with unresolvable PD returns the flagged empty list without querying', async () => {
  resolveByEmail.mockResolvedValue(null);
  const body = await listGranteeAwardees({ cycleCode: 'J26', showAll: false, azureEmail: 'x@wmkeck.org' });
  expect(body).toEqual({
    cycleCode: 'J26', cycleLabel: 'June 2026', count: 0, awardees: [],
    scope: 'mine', pdResolved: false, programDirector: null,
  });
  expect(queryAllRequests).not.toHaveBeenCalled();
});

test('mine-scope appends the server-resolved PD clause; scope=all omits it and pdResolved is undefined', async () => {
  await listGranteeAwardees({ cycleCode: 'J26', showAll: false, azureEmail: 'x@wmkeck.org' });
  expect(queryAllRequests.mock.calls[0][0].filter).toContain('_wmkf_programdirector_value eq pd-me');

  const all = await listGranteeAwardees({ cycleCode: 'J26', showAll: true, azureEmail: 'x@wmkeck.org' });
  expect(queryAllRequests.mock.calls[1][0].filter).not.toContain('_wmkf_programdirector_value');
  expect(all.scope).toBe('all');
  expect(all.pdResolved).toBeUndefined();
});

test('a per-row deliverable lookup failure is fail-soft (status null), other rows keep their status', async () => {
  queryAllRequests.mockResolvedValue({ records: [
    { akoya_requestid: 'r1', akoya_requestnum: '1', wmkf_abstractformatted: 'x' },
    { akoya_requestid: 'r2', akoya_requestnum: '2' },
  ] });
  getDeliverableForRequest
    .mockResolvedValueOnce({ wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.DRAFTED })
    .mockRejectedValueOnce(new Error('lookup down'));
  const body = await listGranteeAwardees({ cycleCode: 'J26', showAll: true, azureEmail: null });
  expect(body.awardees[0]).toMatchObject({ status: GRANTEE_DELIVERABLE_STATUS.DRAFTED, statusLabel: 'Drafted', abstractReady: true });
  expect(body.awardees[1]).toMatchObject({ status: null, statusLabel: null, abstractReady: false });
  expect(body.count).toBe(2);
});

test('retrieves the complete result before enriching rows', async () => {
  queryAllRequests.mockResolvedValue({
    records: Array.from({ length: 26 }, (_, i) => ({
      akoya_requestid: `r${i}`,
      akoya_requestnum: String(i),
    })),
    totalCount: 26,
    capped: false,
  });

  const body = await listGranteeAwardees({ cycleCode: 'J26', showAll: true, azureEmail: null });

  expect(body.count).toBe(26);
  expect(body.awardees).toHaveLength(26);
  expect(queryAllRequests).toHaveBeenCalledWith(expect.objectContaining({
    select: expect.stringContaining('akoya_requestid'),
    filter: expect.stringContaining("akoya_requeststatus eq 'Active'"),
  }));
  expect(getDeliverableForRequest).toHaveBeenCalledTimes(26);
});

test('enriches in a bounded pool while preserving source order and fail-soft rows', async () => {
  const records = Array.from({ length: 10 }, (_, i) => ({
    akoya_requestid: `r${i}`,
    akoya_requestnum: String(i),
  }));
  queryAllRequests.mockResolvedValue({ records, totalCount: records.length, capped: false });
  const lookupDeferred = new Map(records.map(({ akoya_requestid }) => [akoya_requestid, (() => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  })()]));
  let active = 0;
  let maxActive = 0;
  getDeliverableForRequest.mockImplementation(async (requestId) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    const lookup = lookupDeferred.get(requestId);
    try {
      return await lookup.promise;
    } finally {
      active -= 1;
    }
  });

  const run = listGranteeAwardees({ cycleCode: 'J26', showAll: true, azureEmail: null });
  await new Promise((resolve) => setImmediate(resolve));
  expect(getDeliverableForRequest).toHaveBeenCalledTimes(4);
  for (const [index, record] of records.map((record, i) => [i, record]).reverse()) {
    const lookup = lookupDeferred.get(record.akoya_requestid);
    if (record.akoya_requestid === 'r3') lookup.reject(new Error('lookup down'));
    else lookup.resolve({ wmkf_deliverablestatus: index + 100 });
  }
  const body = await run;

  expect(maxActive).toBe(4);
  expect(body.awardees.map((row) => row.requestId)).toEqual(records.map((row) => row.akoya_requestid));
  expect(body.awardees.map((row) => row.status)).toEqual([100, 101, 102, null, 104, 105, 106, 107, 108, 109]);
});

test.each([
  ['capped', { records: [{ akoya_requestid: 'r1' }], totalCount: 26, capped: true }],
  ['hasMore', { records: [{ akoya_requestid: 'r1' }], totalCount: 1, hasMore: true }],
  ['reported total exceeds rows', { records: [{ akoya_requestid: 'r1' }], totalCount: 2, capped: false }],
  ['missing records', { totalCount: 0, capped: false }],
])('fails closed on an incomplete query result (%s) before enrichment', async (_label, result) => {
  queryAllRequests.mockResolvedValue(result);

  await expect(listGranteeAwardees({ cycleCode: 'J26', showAll: true, azureEmail: null }))
    .rejects.toMatchObject({ httpStatus: 503, body: { cycleCode: 'J26' } });
  expect(getDeliverableForRequest).not.toHaveBeenCalled();
});

test('cycle-list mode groups the eligibility population by meeting-date cycle and resolves calendar defaults from it', async () => {
  queryAllRequests.mockResolvedValue({ records: [
    { akoya_requestid: 'a', wmkf_meetingdate: '2026-12-11' },
    { akoya_requestid: 'b', wmkf_meetingdate: '2026-06-04' },
    { akoya_requestid: 'c', wmkf_meetingdate: '2026-06-04' },
    { akoya_requestid: 'd', wmkf_meetingdate: '2026-03-15' }, // off-month: counted, never coded
  ], capped: false });
  const body = await listGranteeAwardeeCycles({ today: new Date('2026-09-08T12:00:00Z') });
  const { filter } = queryAllRequests.mock.calls[0][0];
  // Same population as the row query: Active + PI present + research programs; no cycle window, no PD clause.
  expect(filter).toContain("akoya_requeststatus eq 'Active'");
  expect(filter).toContain('_wmkf_projectleader_value ne null');
  expect(filter).toContain('_akoya_programid_value eq');
  expect(filter).not.toContain('_wmkf_programdirector_value');
  expect(filter).not.toContain('wmkf_meetingdate ge');
  expect(body).toEqual({
    cycles: [
      { code: 'D26', label: 'December 2026', meetingDate: '2026-12-11', count: 1 },
      { code: 'J26', label: 'June 2026', meetingDate: '2026-06-04', count: 2 },
    ],
    defaultCycleCode: 'D26',
    lastDecidedCycleCode: 'J26',
    uncycledCount: 1,
  });
});

test('cycle-list mode fails closed with a typed 503 on a capped scan', async () => {
  queryAllRequests.mockResolvedValue({ records: [], capped: true });
  await expect(listGranteeAwardeeCycles()).rejects.toMatchObject({ httpStatus: 503 });
});

test('the cycle-list predicate and the row predicate share the eligibility clause verbatim', async () => {
  queryAllRequests.mockResolvedValue({ records: [], capped: false });
  await listGranteeAwardeeCycles();
  await listGranteeAwardees({ cycleCode: 'J26', showAll: true, azureEmail: null });
  const [cycleFilter, rowFilter] = queryAllRequests.mock.calls.map(([a]) => a.filter);
  const eligibility = cycleFilter.replace('wmkf_meetingdate ne null and ', '');
  expect(rowFilter).toContain(eligibility);
});
