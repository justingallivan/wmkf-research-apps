/**
 * @jest-environment node
 *
 * lib/services/workbench/grantee-deliverables/awardees-service — logic-level
 * tests (adapter mocked), Stage 4 series C extraction. The route suite pins
 * filter shape + envelopes; this pins the service branches: PD-unresolved
 * empty list, per-row deliverable fail-soft, scope plumbing, and the
 * Liaison of record (docs/plans/LIAISON_FROM_INSTITUTION_PLAN_2026-09-29.md
 * reader 3). Rows outside that block carry blank Liaison inputs (NO_LIAISON).
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

const queryAccounts = jest.fn();
jest.mock('../../lib/dataverse/adapters/account.js', () => ({
  __esModule: true,
  queryAccounts: (...a) => queryAccounts(...a),
}));

import { listGranteeAwardees, listGranteeAwardeeCycles } from '../../lib/services/workbench/grantee-deliverables/awardees-service';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';
import { RESEARCH_PROGRAM_IDS } from '../../shared/config/researchPrograms';

const NO_LIAISON = { _akoya_programid_value: null, _akoya_applicantid_value: null, _akoya_primarycontactid_value: null };

beforeEach(() => {
  delete process.env.TEST_REQUEST_ISOLATION;
  jest.clearAllMocks();
  resolveByEmail.mockResolvedValue({ systemuserid: 'pd-me', fullName: 'Justin Gallivan' });
  queryAllRequests.mockResolvedValue({ records: [], totalCount: 0, capped: false });
  getDeliverableForRequest.mockResolvedValue(null);
});

afterEach(() => { delete process.env.TEST_REQUEST_ISOLATION; });

test('Stage 1d: awardee report filters name marker fields only when enabled', async () => {
  await listGranteeAwardeeCycles();
  expect(queryAllRequests.mock.calls[0][0].filter).not.toContain('wmkf_istestrequest');
  process.env.TEST_REQUEST_ISOLATION = 'on';
  await listGranteeAwardeeCycles();
  expect(queryAllRequests.mock.calls[1][0].filter).toContain('wmkf_istestrequest');
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
    { akoya_requestid: 'r1', akoya_requestnum: '1', wmkf_abstractformatted: 'x', ...NO_LIAISON },
    { akoya_requestid: 'r2', akoya_requestnum: '2', ...NO_LIAISON },
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
      ...NO_LIAISON,
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
    ...NO_LIAISON,
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

describe('Liaison of record', () => {
  const ACCOUNT_A = '22222222-2222-2222-2222-222222222222';
  const ACCOUNT_B = '33333333-3333-3333-3333-333333333333';
  const research = (id, account) => ({
    akoya_requestid: id,
    akoya_requestnum: id,
    _akoya_programid_value: RESEARCH_PROGRAM_IDS[0],
    _akoya_applicantid_value: account,
    _akoya_primarycontactid_value: 'copy-contact',
    _akoya_primarycontactid_value_formatted: 'Former Liaison',
  });

  test('the list selects the applicant for the batched Liaison read', async () => {
    await listGranteeAwardees({ cycleCode: 'J26', showAll: true, azureEmail: null });
    expect(queryAllRequests.mock.calls[0][0].select.split(',')).toEqual(expect.arrayContaining([
      '_akoya_programid_value', '_akoya_applicantid_value', '_akoya_primarycontactid_value',
    ]));
  });

  test('shows the institution Primary Contact\'s formatted name, never the divergent Request copy, with no contact reads', async () => {
    queryAllRequests.mockResolvedValue({ records: [research('r1', ACCOUNT_A), research('r2', ACCOUNT_B)], totalCount: 2, capped: false });
    queryAccounts.mockResolvedValue({
      records: [
        { accountid: ACCOUNT_A, _primarycontactid_value: 'inst-a', _primarycontactid_value_formatted: 'Institution Liaison A' },
        { accountid: ACCOUNT_B, _primarycontactid_value: 'inst-b' },
      ],
      totalCount: 2,
      hasMore: false,
    });
    const body = await listGranteeAwardees({ cycleCode: 'J26', showAll: true, azureEmail: null });
    expect(queryAccounts).toHaveBeenCalledTimes(1);
    expect(body.awardees[0].liaison).toEqual({ contactId: 'inst-a', name: 'Institution Liaison A' });
    // A missing formatted label displays as no name; the Liaison is still found.
    expect(body.awardees[1].liaison).toEqual({ contactId: 'inst-b', name: null });
  });

  test('no institution Primary Contact → no Liaison shown (no fallback to the copy)', async () => {
    queryAllRequests.mockResolvedValue({ records: [research('r1', ACCOUNT_A)], totalCount: 1, capped: false });
    queryAccounts.mockResolvedValue({ records: [{ accountid: ACCOUNT_A, _primarycontactid_value: null }], totalCount: 1, hasMore: false });
    const body = await listGranteeAwardees({ cycleCode: 'J26', showAll: true, azureEmail: null });
    expect(body.awardees[0].liaison).toEqual({ contactId: null, name: null });
  });

  test.each([
    ['a batch missing an account', () => queryAccounts.mockResolvedValue({ records: [{ accountid: ACCOUNT_A, _primarycontactid_value: 'inst-a' }], totalCount: 1, hasMore: false })],
    ['an account read failure', () => queryAccounts.mockRejectedValue(new Error('dataverse 503'))],
  ])('%s fails the list with a typed 503', async (_label, arrange) => {
    queryAllRequests.mockResolvedValue({ records: [research('r1', ACCOUNT_A), research('r2', ACCOUNT_B)], totalCount: 2, capped: false });
    arrange();
    await expect(listGranteeAwardees({ cycleCode: 'J26', showAll: true, azureEmail: null }))
      .rejects.toMatchObject({ httpStatus: 503, body: { cycleCode: 'J26' } });
  });
});
