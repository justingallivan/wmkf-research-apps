/**
 * @jest-environment node
 *
 * Unit tests for lib/services/reviewer-finder/my-proposals-service.js
 * (Route→Service Consolidation Plan, Stage 3 wave) — logic-level coverage
 * with the PD resolver and adapters mocked: cycle dedupe/sort, status
 * filters, reviewer-count aggregation buckets/chunking, and the typed
 * 404/400 domain errors.
 */

jest.mock('../../lib/services/program-director-resolver', () => ({
  resolveByEmail: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  __esModule: true,
  queryAllRequests: jest.fn(),
}));
// The live program catalog names exactly one Research program (plan F2: discovery scope by name).
const RESEARCH_PROGRAM = '94cab30b-958f-ee11-8179-000d3a341e8f';
jest.mock('../../lib/dataverse/adapters/grant-program', () => ({
  __esModule: true,
  listActive: jest.fn(async () => ({ records: [{ wmkf_grantprogramid: '94cab30b-958f-ee11-8179-000d3a341e8f', wmkf_name: 'Research' }] })),
}));
const ADMISSION = `(((_wmkf_grantprogram_value eq ${RESEARCH_PROGRAM}) and wmkf_readyforreview eq true) or (akoya_requeststatus eq 'Phase II Pending'))`;
// Grant Cycle link helpers: real strings and the real row reader, without the
// restriction context the adapter-mocked service never establishes.
jest.mock('../../lib/dataverse/adapters/operations-grant-cycle', () => ({
  LINKED_CYCLE_ID_FIELD: '_wmkf_grantcycle_value',
  linkedCycleFilter: (code) => `wmkf_GrantCycle/wmkf_cyclecode eq '${code}'`,
  linkedCycleExpand: () => 'wmkf_GrantCycle($select=wmkf_cyclecode)',
  linkedCycleCode: (row) => {
    const code = row?.wmkf_GrantCycle?.wmkf_cyclecode;
    return typeof code === 'string' && /^[JD]\d{2}$/.test(code) ? code : null;
  },
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  queryAllSuggestions: jest.fn(),
  notExcludedFilter: jest.fn(() => 'not-excluded'),
  RESPONSE_TYPE_MAP: { accepted: 100000001, declined: 100000002, held: 100000003 },
}));

const { resolveByEmail } = require('../../lib/services/program-director-resolver');
const { queryAllRequests } = require('../../lib/dataverse/adapters/grant-request');
const { queryAllSuggestions } = require('../../lib/dataverse/adapters/reviewer-suggestion');
const { getMyProposals, MyProposalsError } = require('../../lib/services/reviewer-finder/my-proposals-service');

const PD = { systemuserid: 'pd-1', fullName: 'Dr. PD' };
const EMAIL = 'pd@example.org';

beforeEach(() => {
  jest.clearAllMocks();
  resolveByEmail.mockResolvedValue(PD);
  queryAllRequests.mockResolvedValue({ records: [] });
  queryAllSuggestions.mockResolvedValue({ records: [] });
});

test('404 MyProposalsError when no active systemuser resolves for the email', async () => {
  resolveByEmail.mockResolvedValue(null);
  const err = await getMyProposals({ azureEmail: EMAIL }).catch((e) => e);
  expect(err).toBeInstanceOf(MyProposalsError);
  expect(err.httpStatus).toBe(404);
  expect(err.message).toBe(`No active Dynamics systemuser found for ${EMAIL}.`);
  expect(err.body).toBeUndefined();
});

test('400 MyProposalsError on an invalid cycleCode', async () => {
  const err = await getMyProposals({ azureEmail: EMAIL, cycleCode: 'not-a-cycle' }).catch((e) => e);
  expect(err).toBeInstanceOf(MyProposalsError);
  expect(err.httpStatus).toBe(400);
  expect(err.message).toBe('Invalid cycleCode: not-a-cycle');
});

test('cycle-list mode dedupes linked Grant Cycle codes with counts, newest first', async () => {
  queryAllRequests.mockResolvedValue({
    records: [
      { akoya_requestid: 'r1', wmkf_meetingdate: '2026-06-15', wmkf_GrantCycle: { wmkf_cyclecode: 'J26' } },
      { akoya_requestid: 'r2', wmkf_meetingdate: '2026-06-20', wmkf_GrantCycle: { wmkf_cyclecode: 'J26' } },
      { akoya_requestid: 'r3', wmkf_meetingdate: '2025-12-10', wmkf_GrantCycle: { wmkf_cyclecode: 'D25' } },
      // A June meeting date with no link (or a historical non-J/D link) is in no cycle.
      { akoya_requestid: 'r4', wmkf_meetingdate: '2024-06-12' },
      { akoya_requestid: 'r5', wmkf_meetingdate: '2023-06-12', wmkf_GrantCycle: { wmkf_cyclecode: '2023' } },
    ],
  });

  const out = await getMyProposals({ azureEmail: EMAIL });

  expect(queryAllRequests.mock.calls[0][0]).toMatchObject({
    filter: '_wmkf_programdirector_value eq pd-1 and _wmkf_grantcycle_value ne null',
    expand: 'wmkf_GrantCycle($select=wmkf_cyclecode)',
  });
  expect(queryAllRequests.mock.calls[0][0].select.split(',')).not.toContain('wmkf_meetingdate');

  expect(out).toEqual({
    success: true,
    programDirector: { systemuserid: 'pd-1', fullName: 'Dr. PD' },
    cycles: [
      { code: 'J26', year: 2026, month: 6, count: 2},
      { code: 'D25', year: 2025, month: 12, count: 1},
    ],
  });
});

test('the admission filter is the ready-Research branch OR the Phase II Pending gate; the actionable phase rule is a post-filter', async () => {
  await getMyProposals({ azureEmail: EMAIL, cycleCode: 'J26' });
  const { filter } = queryAllRequests.mock.calls[0][0];
  expect(filter).toBe(`_wmkf_programdirector_value eq pd-1 and wmkf_GrantCycle/wmkf_cyclecode eq 'J26' and ${ADMISSION}`);
  expect(filter).not.toContain('wmkf_phaseiistatus');
});

test("status='all' and actionable send the same admission filter; unknown statuses fall back to actionable", async () => {
  queryAllRequests.mockResolvedValue({ records: [
    { akoya_requestid: 'open', akoya_requestnum: 'open', akoya_requeststatus: 'Phase II Pending', wmkf_phaseiistatus: null, wmkf_GrantCycle: { wmkf_cyclecode: 'J26' } },
    { akoya_requestid: 'declined', akoya_requestnum: 'declined', akoya_requeststatus: 'Phase II Pending', wmkf_phaseiistatus: 100000001, wmkf_GrantCycle: { wmkf_cyclecode: 'J26' } },
  ] });
  const all = await getMyProposals({ azureEmail: EMAIL, cycleCode: 'J26', status: 'all' });
  expect(all.proposals.map((p) => p.requestId)).toEqual(['open', 'declined']);
  const bogus = await getMyProposals({ azureEmail: EMAIL, cycleCode: 'J26', status: 'bogus' });
  expect(bogus.proposals.map((p) => p.requestId)).toEqual(['open']);
  expect(queryAllRequests.mock.calls[0][0].filter).toBe(queryAllRequests.mock.calls[1][0].filter);
});

test('proposals-in-cycle projects slots, counts all four lifecycle buckets, and uppercases the cycle code', async () => {
  queryAllRequests.mockResolvedValue({
    records: [{
      akoya_requestid: 'r1',
      akoya_requestnum: 'REQ-1',
      wmkf_GrantCycle: { wmkf_cyclecode: 'J26' }, wmkf_meetingdate: '2026-06-15',
      akoya_requeststatus: 'Phase II Pending',
      _wmkf_potentialreviewer1_value: 'p1',
      _wmkf_potentialreviewer3_value: 'p3',
    }],
  });
  queryAllSuggestions.mockResolvedValue({
    records: [
      { _wmkf_request_value: 'r1', wmkf_invited: true },
      { _wmkf_request_value: 'r1', wmkf_emailsentat: '2026-01-01', wmkf_responsetype: 100000001 },
      { _wmkf_request_value: 'r1', wmkf_declined: true },
      { _wmkf_request_value: 'r1', wmkf_responsetype: 100000003 },
    ],
  });

  const out = await getMyProposals({ azureEmail: EMAIL, cycleCode: 'j26' });

  expect(out.cycleCode).toBe('J26');
  expect(out.status).toBe('actionable');
  expect(out.proposals[0]).toMatchObject({
    requestId: 'r1',
    reviewerInvited: 2, // wmkf_invited OR wmkf_emailsentat
    reviewerAccepted: 1, // responsetype accepted
    reviewerDeclined: 1,
    reviewerHeld: 1,
    reviewerSlotsFilled: 2,
    reviewerSlotsTotal: 5,
  });
});

test('a request with no suggestion rows gets 0/0/0/0 counts', async () => {
  queryAllRequests.mockResolvedValue({
    records: [{ akoya_requestid: 'r1', akoya_requestnum: 'REQ-1', akoya_requeststatus: 'Phase II Pending', wmkf_GrantCycle: { wmkf_cyclecode: 'J26' }, wmkf_meetingdate: '2026-06-15' }],
  });
  const out = await getMyProposals({ azureEmail: EMAIL, cycleCode: 'J26' });
  expect(out.proposals[0]).toMatchObject({
    reviewerInvited: 0, reviewerAccepted: 0, reviewerDeclined: 0, reviewerHeld: 0,
  });
});

test('reviewer-count aggregation chunks the OR-chain at 25 request ids per query: first call gets ids 0-24 in order, second gets ids 25-29', async () => {
  const ids = Array.from({ length: 30 }, (_, i) => `r${i}`);
  queryAllRequests.mockResolvedValue({
    records: ids.map((id) => ({
      akoya_requestid: id, akoya_requestnum: `REQ-${id}`, akoya_requeststatus: 'Phase II Pending', wmkf_GrantCycle: { wmkf_cyclecode: 'J26' }, wmkf_meetingdate: '2026-06-15',
    })),
  });

  await getMyProposals({ azureEmail: EMAIL, cycleCode: 'J26' });

  expect(queryAllSuggestions).toHaveBeenCalledTimes(2);
  const firstFilter = queryAllSuggestions.mock.calls[0][0].filter;
  const secondFilter = queryAllSuggestions.mock.calls[1][0].filter;
  expect(firstFilter.split(' or ')).toHaveLength(25);
  expect(secondFilter.split(' or ')).toHaveLength(5);
  expect(firstFilter).toContain('not-excluded');
  // Exact contents + order: first call gets elements 0..24 in order, second gets element 25..29.
  const firstOrChainStart = firstFilter.indexOf('(') + 1;
  const firstOrChain = firstFilter.slice(firstOrChainStart, firstFilter.indexOf(')'));
  expect(firstOrChain.split(' or ')).toEqual(ids.slice(0, 25).map((id) => `_wmkf_request_value eq ${id}`));
  const secondOrChainStart = secondFilter.indexOf('(') + 1;
  const secondOrChain = secondFilter.slice(secondOrChainStart, secondFilter.indexOf(')'));
  expect(secondOrChain.split(' or ')).toEqual(ids.slice(25).map((id) => `_wmkf_request_value eq ${id}`));
});

test('a suggestion-count chunk failure propagates untyped (clean 500 beats an undercount)', async () => {
  queryAllRequests.mockResolvedValue({
    records: [{ akoya_requestid: 'r1', akoya_requestnum: 'REQ-1', akoya_requeststatus: 'Phase II Pending', wmkf_GrantCycle: { wmkf_cyclecode: 'J26' }, wmkf_meetingdate: '2026-06-15' }],
  });
  queryAllSuggestions.mockRejectedValue(new Error('Dataverse unavailable'));
  await expect(getMyProposals({ azureEmail: EMAIL, cycleCode: 'J26' })).rejects.toThrow('Dataverse unavailable');
});

test.each(['all', 'actionable'])('readiness gates %s and cycle counts before suggestion reads', async (status) => {
  const make = (id, code, ready) => ({ akoya_requestid: id, akoya_requestnum: id, akoya_requeststatus: 'Phase II Pending', wmkf_GrantCycle: { wmkf_cyclecode: code }, wmkf_readyforreview: ready });
  queryAllRequests.mockResolvedValue({ records: [make('legacy', 'D26', false), make('hidden', 'J27', false), make('ready', 'J27', true)] });
  const cycles = await getMyProposals({ azureEmail: EMAIL });
  expect(cycles.cycles.map((c) => [c.code, c.count])).toEqual([['J27', 1], ['D26', 1]]);
  const result = await getMyProposals({ azureEmail: EMAIL, cycleCode: 'J27', status });
  expect(result.proposals.map((r) => r.requestId)).toEqual(['legacy', 'ready']);
  expect(queryAllSuggestions.mock.calls[0][0].filter).not.toContain('hidden');
  expect(queryAllSuggestions.mock.calls[0][0].filter).toContain('ready');
  for (const [query] of queryAllRequests.mock.calls) {
    expect(query.select.split(',')).toContain('wmkf_readyforreview');
    expect(query.expand).toBe('wmkf_GrantCycle($select=wmkf_cyclecode)');
  }
});

test.each([undefined, 'J27'])('refuses incomplete %s discovery rather than returning partial counts', async (cycleCode) => {
  queryAllRequests.mockResolvedValue({ records: [], capped: true });
  await expect(getMyProposals({ azureEmail: EMAIL, cycleCode })).rejects.toMatchObject({ httpStatus: 503 });
});

// Interpret the two emitted phase predicates against real-shaped rows. The
// expected set below is independent of the service's cutover calculation.
function phaseQueryRecords(records, filter) {
  // The emitted filter admits by status gate or ready Research row; the phase rule is applied in code.
  expect(filter).toContain(ADMISSION);
  expect(filter).not.toContain('wmkf_phaseiistatus');
  return records.filter((r) => r.akoya_requeststatus === 'Phase II Pending'
    || (String(r._wmkf_grantprogram_value || '').toLowerCase() === RESEARCH_PROGRAM && r.wmkf_readyforreview === true));
}

const PHASE_II_OPTIONS = [100000000, 100000001, 100000002, 100000003, 100000004, 100000005, 707510001, 707510002, 999999999];

test.each([
  ['J25', ['null']], ['D26', ['null']],
  ['j27', ['null', '100000002']], ['D27', ['null', '100000002']], ['J28', ['null', '100000002']],
])('%s actionable admits only its allowed Phase II states', async (cycleCode, expected) => {
  const records = [null, ...PHASE_II_OPTIONS].map((value) => ({
    akoya_requestid: String(value), akoya_requestnum: String(value),
    akoya_requeststatus: 'Phase II Pending', wmkf_phaseiistatus: value,
    wmkf_phaseiistatus_formatted: value === 100000002 ? 'Phase II Pending Committee Review' : null,
    wmkf_GrantCycle: { wmkf_cyclecode: cycleCode.toUpperCase() }, wmkf_readyforreview: true,
  }));
  // The new option is also present on a Phase I / declined / concept request:
  // none may leak through the parenthesized OR branch.
  for (const status of ['Phase I Pending', 'Phase I Declined', 'Concept Pending']) {
    records.push({ ...records[3], akoya_requestid: status, akoya_requeststatus: status });
  }
  queryAllRequests.mockImplementation(async ({ filter }) => ({ records: phaseQueryRecords(records, filter) }));
  const result = await getMyProposals({ azureEmail: EMAIL, cycleCode });
  expect(result.proposals.map((r) => r.requestId)).toEqual(expected);
  const { filter } = queryAllRequests.mock.calls[0][0];
  expect(filter).toBe(`_wmkf_programdirector_value eq pd-1 and wmkf_GrantCycle/wmkf_cyclecode eq '${cycleCode.toUpperCase()}' and ${ADMISSION}`);
  if (expected.length === 2) expect(result.proposals[1].phaseIIStatus).toBe('Phase II Pending Committee Review');
});

test.each([false, null, undefined, 1, 'true'])('explicit J27 pending-committee status does not bypass readiness %s', async (ready) => {
  queryAllRequests.mockResolvedValue({ records: [{
    akoya_requestid: 'unready', akoya_requestnum: 'unready',
    akoya_requeststatus: 'Phase II Pending', wmkf_phaseiistatus: 100000002,
    wmkf_GrantCycle: { wmkf_cyclecode: 'J27' }, wmkf_readyforreview: ready,
  }] });
  expect((await getMyProposals({ azureEmail: EMAIL, cycleCode: 'J27' })).proposals).toEqual([]);
  expect(queryAllSuggestions).not.toHaveBeenCalled();
});

test.each(['D26', 'J27'])('%s status=all retains its prior phase-unrestricted query', async (cycleCode) => {
  const records = [null, ...PHASE_II_OPTIONS].map((value) => ({
    akoya_requestid: String(value), akoya_requestnum: String(value),
    akoya_requeststatus: 'Phase II Pending', wmkf_phaseiistatus: value,
    wmkf_GrantCycle: { wmkf_cyclecode: cycleCode }, wmkf_readyforreview: true,
  }));
  queryAllRequests.mockImplementation(async ({ filter }) => ({ records: phaseQueryRecords(records, filter) }));
  expect((await getMyProposals({ azureEmail: EMAIL, cycleCode, status: 'all' })).proposals).toHaveLength(records.length);
  expect(queryAllRequests.mock.calls[0][0].filter).toBe(`_wmkf_programdirector_value eq pd-1 and wmkf_GrantCycle/wmkf_cyclecode eq '${cycleCode}' and ${ADMISSION}`);
});
