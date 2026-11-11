/**
 * @jest-environment node
 *
 * lib/services/workbench/dashboard-service — logic-level tests (adapters
 * mocked), Stage 4 series A extraction. The route-level characterization
 * (tests/integration/workbench-routes.test.js) pins the exact OData filters;
 * this suite pins the service's own branches: typed 404/400 errors, cycle
 * sorting/dedupe, canManage projection, and the rollup summary.
 */

const queryAllRequests = jest.fn();
const listBoardDates = jest.fn();
const getCycleDatesById = jest.fn();
jest.mock('../../lib/dataverse/adapters/operations-grant-cycle.js', () => ({
  ...jest.requireActual('../../lib/dataverse/adapters/operations-grant-cycle.js'),
  listBoardDatesOrNone: (...a) => listBoardDates(...a),
  getCycleDatesById: (...a) => getCycleDatesById(...a),
}));
const existsAnySuggestionForRequests = jest.fn(async () => new Set());
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  existsAnySuggestionForRequests: (...a) => existsAnySuggestionForRequests(...a),
}));
const readLatestIntegrityStates = jest.fn(async () => new Map());
jest.mock('../../lib/services/workbench/j27-integrity-jobs', () => ({
  readLatestIntegrityStates: (...a) => readLatestIntegrityStates(...a),
}));
const loadJ27LaterFacts = jest.fn();
jest.mock('../../lib/services/workbench/j27-later-facts', () => ({
  ...jest.requireActual('../../lib/services/workbench/j27-later-facts'),
  loadJ27LaterFacts: (...a) => loadJ27LaterFacts(...a),
}));
/** Neutral later-phase facts: no presentation, no roster, no Board draft, no review stage. */
const neutralLater = () => ({
  presentation: { status: 'present', exists: false, id: null, ended: null, legacyException: false },
  roster: { status: 'absent' },
  boardDraft: { status: 'present', exists: false },
  transition: { status: 'present', phase: null },
});
const getLandingCycle = jest.fn(async () => ({ code: null, reason: null }));
jest.mock('../../lib/services/landing-cycle-service.js', () => ({ getLandingCycle: (...a) => getLandingCycle(...a) }));
jest.mock('../../lib/services/workbench/program-scope-service.js', () => ({
  resolveWorkbenchProgramScope: jest.fn(async () => ({
    programs: [{ programId: '94cab30b-958f-ee11-8179-000d3a341e8f', name: 'Research' }],
    discoveryScope: { readinessOnlyProgramIds: ['94cab30b-958f-ee11-8179-000d3a341e8f'] },
    defaultProgramId: '94cab30b-958f-ee11-8179-000d3a341e8f',
    programId: '94cab30b-958f-ee11-8179-000d3a341e8f',
    programName: 'Research',
  })),
  buildProgramScopeFilter: jest.fn(() => '(_akoya_programid_value eq 8dcab30b-958f-ee11-8179-000d3a341e8f or _akoya_programid_value eq 94cab30b-958f-ee11-8179-000d3a341e8f)'),
}));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  queryAllRequests: (...a) => queryAllRequests(...a),
}));

const resolveByEmail = jest.fn();
jest.mock('../../lib/services/program-director-resolver', () => ({
  resolveByEmail: (...a) => resolveByEmail(...a),
}));

const getUserRole = jest.fn(async () => 'read_only');
jest.mock('../../lib/utils/auth', () => ({
  getUserRole: (...a) => getUserRole(...a),
}));

const fetchReviewerRollup = jest.fn(async () => ({}));
jest.mock('../../lib/services/reviewer-rollup', () => ({
  fetchReviewerRollup: (...a) => fetchReviewerRollup(...a),
  deriveWorkRemaining: jest.fn(() => 'find'),
  emptyCounts: () => ({
    candidates: 0,
    invited: 0,
    accepted: 0,
    declined: 0,
    held: 0,
    completed: 0,
    progress: { total: 0, accepted: 0, pending: 0, declined: 0, uninvited: 0 },
  }),
  REVIEWERS_NEEDED: 3,
}));

import { loadDashboard, loadMeetingTrackerSelection } from '../../lib/services/workbench/dashboard-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { resolveWorkbenchProgramScope, buildProgramScopeFilter } from '../../lib/services/workbench/program-scope-service.js';

const PD = { systemuserid: 'pd-1', fullName: 'Dr. PD One' };
// Calendar Board dates (wmkf_grantcycle); a cycle's date comes from here, never from a request.
const BOARD_DATES = [
  { wmkf_cyclecode: 'J26', wmkf_meetingdate: '2026-06-04' },
  { wmkf_cyclecode: 'D26', wmkf_meetingdate: '2026-12-11' },
  { wmkf_cyclecode: 'J27', wmkf_meetingdate: '2027-06-10' },
];

beforeEach(() => {
  delete process.env.TEST_REQUEST_ISOLATION;
  jest.clearAllMocks();
  resolveByEmail.mockResolvedValue(PD);
  getUserRole.mockResolvedValue('read_only');
  getCycleDatesById.mockResolvedValue({ wmkf_grantcycleid: 'cycle-j27', wmkf_cyclecode: 'J27', wmkf_researchofframpmeetingdate: '2027-03-15', wmkf_researchreviewsduedate: '2027-03-01' });
  existsAnySuggestionForRequests.mockResolvedValue(new Set());
  readLatestIntegrityStates.mockResolvedValue(new Map());
  loadJ27LaterFacts.mockImplementation(async (rows) => new Map(rows.map((r) => [String(r.akoya_requestid).toLowerCase(), neutralLater()])));
  queryAllRequests.mockResolvedValue({ records: [], capped: false });
  listBoardDates.mockResolvedValue(BOARD_DATES);
  fetchReviewerRollup.mockResolvedValue({});
  // The link helpers check the wmkf_grantcycle restriction (covered in grant-cycle-link.test.js).
  jest.spyOn(DynamicsService, 'checkRestriction').mockImplementation(() => {});
});

afterEach(() => { delete process.env.TEST_REQUEST_ISOLATION; });

// Fixed "today" so the calendar-based default is deterministic: 2026-09-08.
const TODAY = new Date('2026-09-08T12:00:00Z');
const args = (over = {}) => ({
  azureEmail: 'pd@example.org', profileId: 1, callerSystemId: 'pd-1', cycleCode: undefined, scope: 'my', includeSetAside: false, today: TODAY, ...over,
});

test('no active systemuser → ServiceHttpError 404 with the historical message', async () => {
  resolveByEmail.mockResolvedValue(null);
  await expect(loadDashboard(args())).rejects.toMatchObject({
    httpStatus: 404,
    message: 'No active Dynamics systemuser found for pd@example.org.',
  });
});

test('invalid cycleCode → ServiceHttpError 400', async () => {
  const err = await loadDashboard(args({ cycleCode: 'nope' })).catch((e) => e);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(400);
  expect(err.message).toBe('Invalid cycleCode: nope');
});

test('cycle-list mode: lists organization-wide eligible cycles with honest active/set-aside counts', async () => {
  queryAllRequests.mockResolvedValue({
    records: [
      { akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2026-06-04', wmkf_GrantCycle: { wmkf_cyclecode: 'J26' }, _wmkf_programdirector_value: 'pd-1' },
      { akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2026-12-11', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, _wmkf_programdirector_value: 'pd-2' },
      { akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2026-12-12', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, _wmkf_programdirector_value: 'pd-1', wmkf_triagestatus: 100000001 },
      { wmkf_meetingdate: null }, // no link → skipped
      // A December meeting date with no Grant Cycle link has no cycle.
      { wmkf_meetingdate: '2025-12-11', _wmkf_programdirector_value: 'pd-1' },
      // A historical (non-J/D) linked code has no cycle either.
      { akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2016-06-04', wmkf_GrantCycle: { wmkf_cyclecode: 'R16' }, _wmkf_programdirector_value: 'pd-1' },
    ],
    capped: false,
  });
  const body = await loadDashboard(args());
  expect(body.success).toBe(true);
  // meetingDate is the calendar Board date, not the latest request meeting date (2026-12-12).
  expect(body.cycles.map((c) => [c.code, c.count, c.setAsideCount, c.myCount, c.mySetAsideCount, c.meetingDate]))
    .toEqual([['D26', 1, 1, 0, 1, '2026-12-11'], ['J26', 1, 0, 1, 0, '2026-06-04']]);
  // Calendar default: the working cycle is the upcoming December meeting, even
  // though the caller's only active request is in June.
  expect(body.defaultCycleCode).toBe('D26');
  expect(body.lastDecidedCycleCode).toBe('J26');
  expect(body.programDirector).toEqual({ systemuserid: 'pd-1', fullName: 'Dr. PD One' });
  expect(queryAllRequests).toHaveBeenCalledWith({
    select: 'akoya_requestid,akoya_requeststatus,_wmkf_grantprogram_value,_wmkf_programdirector_value,wmkf_triagestatus,wmkf_readyforreview',
    expand: 'wmkf_GrantCycle($select=wmkf_cyclecode)',
    filter: "_wmkf_grantcycle_value ne null and (_akoya_programid_value eq 8dcab30b-958f-ee11-8179-000d3a341e8f or _akoya_programid_value eq 94cab30b-958f-ee11-8179-000d3a341e8f) and (((akoya_requeststatus eq 'Phase II Pending' or wmkf_triagestatus eq 100000000 or wmkf_triagestatus eq 100000001)) or ((_wmkf_grantprogram_value eq 94cab30b-958f-ee11-8179-000d3a341e8f) and wmkf_readyforreview eq true))",
    orderby: 'akoya_requestnum desc',
  });
  expect(listBoardDates).toHaveBeenCalledTimes(1);
});

test('cycle-list mode: a cycle the calendar has no date for is listed code-only and resolves by month', async () => {
  listBoardDates.mockResolvedValue([]);
  queryAllRequests.mockResolvedValue({
    records: [{ akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2026-12-11', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, _wmkf_programdirector_value: 'pd-1' }],
    capped: false,
  });
  const body = await loadDashboard(args());
  expect(body.cycles).toEqual([expect.objectContaining({ code: 'D26', year: 2026, month: 12, meetingDate: null })]);
  expect(body.defaultCycleCode).toBe('D26');
});

test('cycle-list mode: the calendar alone never adds a cycle', async () => {
  queryAllRequests.mockResolvedValue({
    records: [{ akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2026-06-04', wmkf_GrantCycle: { wmkf_cyclecode: 'J26' }, _wmkf_programdirector_value: 'pd-1' }],
    capped: false,
  });
  const body = await loadDashboard(args());
  expect(body.cycles.map((c) => c.code)).toEqual(['J26']);
});

test('cycle-list mode: a calendar read failure fails the cycle list', async () => {
  listBoardDates.mockRejectedValue(new Error('Grant cycle Board dates read failed (503).'));
  await expect(loadDashboard(args())).rejects.toThrow('Board dates read failed');
});

test('Stage 1d: cycle discovery keeps test requests but leaves them out of counts', async () => {
  process.env.TEST_REQUEST_ISOLATION = 'on';
  const testRow = {
    akoya_requeststatus: 'Phase II Pending', akoya_requestid: 'r-test', wmkf_meetingdate: '2026-12-11', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, _wmkf_programdirector_value: 'pd-1',
    wmkf_istestrequest: true, wmkf_testcreationrunid: '22222222-2222-4222-8222-222222222222',
  };
  const ordinaryRow = {
    akoya_requeststatus: 'Phase II Pending', akoya_requestid: 'r-1', wmkf_meetingdate: '2027-06-11', wmkf_GrantCycle: { wmkf_cyclecode: 'J27' }, wmkf_readyforreview: true, _wmkf_programdirector_value: 'pd-1',
    wmkf_istestrequest: null, wmkf_testcreationrunid: null,
  };
  queryAllRequests.mockResolvedValue({ records: [testRow, ordinaryRow], capped: false });
  const body = await loadDashboard(args());
  const call = queryAllRequests.mock.calls[0][0];
  expect(call.filter).not.toContain('wmkf_istestrequest');
  expect(call.select).toContain('wmkf_istestrequest,wmkf_testcreationrunid');
  expect(body.cycles.map((c) => [c.code, c.count, c.myCount])).toEqual([['J27', 1, 1], ['D26', 0, 0]]);
  // The earlier test-only D26 must not displace the ordinary J27 as the default.
  expect(body.defaultCycleCode).toBe('J27');
});

test('Stage 1d: an all-test program lists its cycles without choosing a default', async () => {
  process.env.TEST_REQUEST_ISOLATION = 'on';
  const run = '22222222-2222-4222-8222-222222222222';
  queryAllRequests.mockResolvedValue({
    capped: false,
    records: [
      { akoya_requeststatus: 'Phase II Pending', akoya_requestid: 'r-t1', wmkf_meetingdate: '2026-06-04', wmkf_GrantCycle: { wmkf_cyclecode: 'J26' }, wmkf_istestrequest: true, wmkf_testcreationrunid: run },
      { akoya_requeststatus: 'Phase II Pending', akoya_requestid: 'r-t2', wmkf_meetingdate: '2026-12-11', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, wmkf_istestrequest: true, wmkf_testcreationrunid: run },
    ],
  });
  const body = await loadDashboard(args());
  expect(body.cycles.map((cycle) => [cycle.code, cycle.count, cycle.myCount]))
    .toEqual([['D26', 0, 0], ['J26', 0, 0]]);
  expect(body.defaultCycleCode).toBeNull();
  expect(body.lastDecidedCycleCode).toBeNull();
});

test('Stage 1d: a test request in a mixed cycle does not change its calendar date', async () => {
  process.env.TEST_REQUEST_ISOLATION = 'on';
  const run = '22222222-2222-4222-8222-222222222222';
  queryAllRequests.mockResolvedValue({
    capped: false,
    records: [
      { akoya_requeststatus: 'Phase II Pending', akoya_requestid: 'r-1', wmkf_meetingdate: '2026-12-04', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, wmkf_istestrequest: null, wmkf_testcreationrunid: null },
      { akoya_requeststatus: 'Phase II Pending', akoya_requestid: 'r-t', wmkf_meetingdate: '2026-12-18', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, wmkf_istestrequest: true, wmkf_testcreationrunid: run },
    ],
  });
  const body = await loadDashboard(args());
  expect(body.cycles).toEqual([expect.objectContaining({ code: 'D26', meetingDate: '2026-12-11', count: 1 })]);
});

test('cycle-list mode: the default cycle is the same for every caller regardless of assignments or visibility', async () => {
  const records = [
    { akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2026-12-11', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, _wmkf_programdirector_value: 'pd-2', wmkf_triagestatus: 100000001 },
    { akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2026-06-04', wmkf_GrantCycle: { wmkf_cyclecode: 'J26' }, _wmkf_programdirector_value: 'pd-1' },
  ];
  queryAllRequests.mockResolvedValue({ records, capped: false });
  const pd1 = await loadDashboard(args({ callerSystemId: 'pd-1' }));
  queryAllRequests.mockResolvedValue({ records, capped: false });
  const pd2 = await loadDashboard(args({ callerSystemId: 'pd-2' }));
  queryAllRequests.mockResolvedValue({ records, capped: false });
  const anon = await loadDashboard(args({ callerSystemId: null }));
  // D26 is set-aside-only and nobody's "active" cycle; it is still the working cycle.
  expect([pd1.defaultCycleCode, pd2.defaultCycleCode, anon.defaultCycleCode]).toEqual(['D26', 'D26', 'D26']);
});

test('cycle-list mode: the default is per Grant Program — a caller whose default program differs sees that program\'s cycles', async () => {
  const otherProgram = '11111111-1111-4111-8111-111111111111';
  resolveWorkbenchProgramScope.mockResolvedValueOnce({
    programs: [{ programId: otherProgram, name: 'SoCal' }],
    defaultProgramId: otherProgram,
    programId: otherProgram,
    programName: 'SoCal',
  });
  buildProgramScopeFilter.mockImplementationOnce((programId) => `_wmkf_grantprogram_value eq ${programId}`);
  queryAllRequests.mockResolvedValue({ records: [{ akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2027-06-10', wmkf_GrantCycle: { wmkf_cyclecode: 'J27' }, wmkf_readyforreview: true, _wmkf_programdirector_value: 'pd-9' }], capped: false });
  const body = await loadDashboard(args({ callerSystemId: 'pd-9' }));
  expect(queryAllRequests).toHaveBeenCalledWith(expect.objectContaining({
    filter: expect.stringContaining(`_wmkf_grantprogram_value eq ${otherProgram}`),
  }));
  // Same calendar rule, applied to that program's own cycle list.
  expect(body).toMatchObject({ programId: otherProgram, defaultCycleCode: 'J27', lastDecidedCycleCode: null });
});

test('cycle-list mode: the default flips the day after the working meeting, and falls back to the newest cycle once all have passed', async () => {
  const records = [
    { akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2026-12-11', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, _wmkf_programdirector_value: 'pd-1' },
    { akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2026-06-04', wmkf_GrantCycle: { wmkf_cyclecode: 'J26' }, _wmkf_programdirector_value: 'pd-1' },
  ];
  queryAllRequests.mockResolvedValue({ records, capped: false });
  await expect(loadDashboard(args({ today: new Date('2026-12-11T23:00:00Z') })))
    .resolves.toMatchObject({ defaultCycleCode: 'D26', lastDecidedCycleCode: 'J26' });
  queryAllRequests.mockResolvedValue({ records, capped: false });
  await expect(loadDashboard(args({ today: new Date('2026-12-12T00:00:00Z') })))
    .resolves.toMatchObject({ defaultCycleCode: 'D26', lastDecidedCycleCode: 'D26' });
  queryAllRequests.mockResolvedValue({ records: [], capped: false });
  await expect(loadDashboard(args())).resolves.toMatchObject({ cycles: [], defaultCycleCode: null, lastDecidedCycleCode: null });
});

test('cycle-list mode: fails closed with typed 503 when the organization scan is capped', async () => {
  queryAllRequests.mockResolvedValue({ records: [], capped: true });
  await expect(loadDashboard(args())).rejects.toMatchObject({ httpStatus: 503 });
});

test('proposal mode: superuser gets canManage on rows they do not lead; rollup summarizes', async () => {
  getUserRole.mockResolvedValue('superuser');
  queryAllRequests.mockResolvedValue({
    records: [{
      akoya_requestid: 'r-1',
      akoya_requestnum: '1002836',
      akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2026-12-11', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' },
      akoya_requeststatus: 'Phase II Pending',
      wmkf_triagestatus: 100000000,
      _wmkf_programdirector_value: 'someone-else',
    }],
  });
  const body = await loadDashboard(args({ cycleCode: 'D26', scope: 'all' }));
  expect(body.proposals[0].canManage).toBe(true); // superuser override
  expect(body.proposals[0].isMine).toBe(false);
  expect(body.proposals[0].advancing).toBe(true);
  expect(body.proposals[0].reviewers.needed).toBe(3);
  expect(body.rollup).toEqual({ total: 1, stages: { find: 1, invite: 0, awaiting: 0, review: 0, done: 0 } });
  expect(body.cycleCode).toBe('D26');
  expect(body.scope).toBe('all');
  expect(body.proposals[0]).toMatchObject({ cycleCode: 'D26', cycleLabel: 'December 2026' });
  expect(body.proposals[0]).not.toHaveProperty('meetingDate');
  expect(queryAllRequests).toHaveBeenCalledWith(expect.objectContaining({
    expand: 'wmkf_GrantCycle($select=wmkf_cyclecode)',
    filter: expect.stringMatching(/^\(wmkf_GrantCycle\/wmkf_cyclecode eq 'D26'\) and /),
  }));
});

test('proposal mode: a lowercase code is normalized and a December meeting date with no link has no cycle', async () => {
  queryAllRequests.mockResolvedValue({
    records: [{ akoya_requestid: 'r-1', akoya_requestnum: '1002836', wmkf_meetingdate: '2026-12-11', _wmkf_programdirector_value: 'pd-1' }],
  });
  const body = await loadDashboard(args({ cycleCode: 'd26', scope: 'all' }));
  expect(queryAllRequests.mock.calls[0][0].filter).toContain("(wmkf_GrantCycle/wmkf_cyclecode eq 'D26')");
  expect(body.proposals).toEqual([]); // no linked cycle cannot establish the legacy exemption
});

test('proposal mode: non-lead non-superuser rows project canManage false', async () => {
  queryAllRequests.mockResolvedValue({
    records: [{
      akoya_requestid: 'r-1',
      akoya_requestnum: '1002836',
      akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2026-12-11', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' },
      _wmkf_programdirector_value: 'someone-else',
    }],
  });
  const body = await loadDashboard(args({ cycleCode: 'D26', scope: 'all' }));
  expect(body.proposals[0].canManage).toBe(false);
});

test('proposal mode: canonical session actor is case-insensitive and missing actor fails closed', async () => {
  queryAllRequests.mockResolvedValue({
    records: [{
      akoya_requestid: 'r-1',
      akoya_requestnum: '1002836',
      akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2026-12-11', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' },
      _wmkf_programdirector_value: 'PD-1',
    }],
  });
  await expect(loadDashboard(args({ cycleCode: 'D26', scope: 'all', callerSystemId: 'pd-1' })))
    .resolves.toMatchObject({ proposals: [{ canManage: true, isMine: true }] });
  await expect(loadDashboard(args({ cycleCode: 'D26', scope: 'all', callerSystemId: null })))
    .resolves.toMatchObject({ proposals: [{ canManage: false, isMine: true }] });
});

test('Tracker selection matches Workbench visibility and metadata without reading reviewer progress', async () => {
  process.env.TEST_REQUEST_ISOLATION = 'on';
  const records = [{
    akoya_requestid: 'r-1',
    akoya_requestnum: '1002836',
    akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2026-12-11', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' },
    _akoya_applicantid_value_formatted: 'Caltech',
    _wmkf_projectleader_value_formatted: 'Pat One',
    _wmkf_programdirector_value_formatted: 'Dr. PD One',
    _wmkf_programdirector_value: 'pd-1',
    wmkf_istestrequest: true,
    wmkf_testcreationrunid: '22222222-2222-4222-8222-222222222222',
  }];
  queryAllRequests.mockResolvedValue({ records, capped: false });
  const dashboard = await loadDashboard(args({ cycleCode: 'D26', scope: 'my' }));
  expect(fetchReviewerRollup).toHaveBeenCalledWith(['r-1']);
  const legacyRollup = { total: 1, stages: { find: 1 } };
  dashboard.rollup = legacyRollup;

  queryAllRequests.mockClear();
  fetchReviewerRollup.mockClear();
  const selection = await loadMeetingTrackerSelection(args({ cycleCode: 'D26', scope: 'my' }));

  expect(getUserRole).toHaveBeenCalledWith(1);
  expect(fetchReviewerRollup).not.toHaveBeenCalled();
  expect(queryAllRequests).toHaveBeenCalledWith(expect.objectContaining({
    select: expect.stringContaining('wmkf_istestrequest'),
    filter: expect.stringContaining('_wmkf_programdirector_value eq pd-1'),
    orderby: 'akoya_requestnum asc',
  }));
  expect(selection).toMatchObject({
    programDirector: dashboard.programDirector,
    programs: dashboard.programs,
    programId: dashboard.programId,
    defaultProgramId: dashboard.defaultProgramId,
    programName: dashboard.programName,
    cycleCode: dashboard.cycleCode,
    cycleLabel: dashboard.cycleLabel,
    scope: dashboard.scope,
    includeSetAside: dashboard.includeSetAside,
    proposals: [{ requestId: 'r-1', requestNumber: '1002836', institution: 'Caltech', projectLeader: 'Pat One', programDirector: 'Dr. PD One', isTestRequest: true }],
  });
  expect(selection).not.toHaveProperty('rollup');
  expect(selection.proposals[0]).not.toHaveProperty('reviewers');
  expect(selection.proposals[0]).not.toHaveProperty('workRemaining');
});

test('Stage 1d: on mode badges test rows but excludes them from rollup totals', async () => {
  process.env.TEST_REQUEST_ISOLATION = 'on';
  queryAllRequests.mockResolvedValue({
    records: [{
      akoya_requeststatus: 'Phase II Pending', akoya_requestid: 'r-test', akoya_requestnum: '1009999', wmkf_meetingdate: '2026-12-11', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' },
      wmkf_istestrequest: true, wmkf_testcreationrunid: '22222222-2222-4222-8222-222222222222',
    }],
  });
  const body = await loadDashboard(args({ cycleCode: 'D26', scope: 'all' }));
  expect(queryAllRequests).toHaveBeenCalledWith(expect.objectContaining({
    select: expect.stringContaining('wmkf_istestrequest,wmkf_testcreationrunid'),
  }));
  expect(body.proposals).toEqual([expect.objectContaining({ isTestRequest: true })]);
  expect(body.rollup).toEqual({ total: 0, stages: { find: 0, invite: 0, awaiting: 0, review: 0, done: 0 } });
});

describe('landing cycle (docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md)', () => {
  beforeEach(() => {
    queryAllRequests.mockResolvedValue({
      records: [
        { akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2026-06-04', wmkf_GrantCycle: { wmkf_cyclecode: 'J26' }, _wmkf_programdirector_value: 'pd-1' },
        { akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2026-12-11', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, _wmkf_programdirector_value: 'pd-2' },
      ],
      capped: false,
    });
  });

  test('a listed landing cycle becomes the default; lastDecided is unchanged', async () => {
    getLandingCycle.mockResolvedValueOnce({ code: 'J26', reason: null });
    const body = await loadDashboard(args());
    expect(body.defaultCycleCode).toBe('J26');
    expect(body.lastDecidedCycleCode).toBe('J26');
  });

  test('a landing cycle with no visible requests leaves the date rule in place', async () => {
    getLandingCycle.mockResolvedValueOnce({ code: 'J27', reason: null });
    await expect(loadDashboard(args())).resolves.toMatchObject({ defaultCycleCode: 'D26' });
  });

  test('Meeting Tracker selection shares the same default', async () => {
    getLandingCycle.mockResolvedValueOnce({ code: 'J26', reason: null });
    await expect(loadMeetingTrackerSelection(args())).resolves.toMatchObject({ defaultCycleCode: 'J26' });
  });
});

test.each([false, null, undefined, 1, 'true'])('readiness %s: hides J27/D27 before dashboard and Tracker lists, rollups and cycle counts', async (ready) => {
  const make = (id, code, value) => ({ akoya_requestid: id, akoya_requestnum: id, wmkf_GrantCycle: { wmkf_cyclecode: code }, wmkf_readyforreview: value, akoya_requeststatus: 'Phase II Pending', wmkf_triagestatus: 100000000 });
  const records = [make('old', 'D26', false), make('unready-june', 'J27', ready), make('unready-dec', 'D27', ready), make('ready', 'J28', true)];
  queryAllRequests.mockResolvedValue({ records, capped: false });
  const cycles = await loadDashboard(args());
  expect(cycles.cycles.map((c) => [c.code, c.count])).toEqual([['J28', 1], ['D26', 1]]);
  const proposals = await loadDashboard(args({ cycleCode: 'J27', scope: 'all', includeSetAside: true }));
  expect(proposals.proposals.map((r) => r.requestId)).toEqual(['old', 'ready']);
  expect(proposals.rollup.total).toBe(2);
  expect(fetchReviewerRollup).toHaveBeenLastCalledWith(['old', 'ready']);
  const tracker = await loadMeetingTrackerSelection(args({ cycleCode: 'J27', scope: 'all' }));
  expect(tracker.proposals.map((r) => r.requestId)).toEqual(['old', 'ready']);
  // This shared Tracker selection is also Discussion Sentiment's picker source.
  for (const [query] of queryAllRequests.mock.calls) {
    expect(query.select.split(',')).toContain('wmkf_readyforreview');
    expect(query.expand).toBe('wmkf_GrantCycle($select=wmkf_cyclecode)');
  }
});

test.each([{ capped: true }, { hasMore: true }, { records: null }])('incomplete request reads never return partial proposal success: %j', async (extra) => {
  queryAllRequests.mockResolvedValue({ records: [], ...extra });
  await expect(loadDashboard(args({ cycleCode: 'J27' }))).rejects.toMatchObject({ httpStatus: 503 });
  await expect(loadDashboard(args())).rejects.toMatchObject({ httpStatus: 503 });
});

test('a readiness change is reflected on the next request; a selected cycle can become empty', async () => {
  const record = { akoya_requeststatus: 'Phase II Pending', akoya_requestid: 'ready', akoya_requestnum: '1', wmkf_GrantCycle: { wmkf_cyclecode: 'J27' }, wmkf_readyforreview: true };
  queryAllRequests.mockResolvedValue({ records: [record] });
  expect((await loadDashboard(args({ cycleCode: 'J27' }))).proposals).toHaveLength(1);
  queryAllRequests.mockResolvedValue({ records: [{ ...record, wmkf_readyforreview: false }] });
  expect(await loadDashboard(args({ cycleCode: 'J27' }))).toMatchObject({ proposals: [], rollup: { total: 0 } });
});

describe('J27 read model on the proposal list (plan C7)', () => {
  const j27 = (n, over = {}) => ({
    akoya_requestid: `r-${n}`, akoya_requestnum: `10003${n}`, _wmkf_grantcycle_value: 'cycle-j27', wmkf_GrantCycle: { wmkf_cyclecode: 'J27' },
    // A J27 Research row is discoverable by readiness alone (plan F1 / D1): not Phase II Pending, not triaged.
    akoya_requeststatus: 'Phase I Pending', wmkf_readyforreview: true, _wmkf_programdirector_value: 'pd-1', _wmkf_grantprogram_value: '94cab30b-958f-ee11-8179-000d3a341e8f', ...over,
  });
  test('in-scope rows carry the slim stage; reads are batched once per page; pre-2027 rows are unchanged', async () => {
    queryAllRequests.mockResolvedValue({ capped: false, records: [
      j27(80), j27(85, { wmkf_phaseistatus: 707510005 }),
      { akoya_requestid: 'r-d26', akoya_requestnum: '1002836', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, akoya_requeststatus: 'Phase II Pending', wmkf_triagestatus: 100000000, _wmkf_programdirector_value: 'pd-1' },
    ] });
    existsAnySuggestionForRequests.mockResolvedValue(new Set(['r-85']));
    readLatestIntegrityStates.mockResolvedValue(new Map([['r-85', { status: 'present', latest: { flagged: true, reviewed: false, provenance: 'automated' } }]]));
    fetchReviewerRollup.mockResolvedValue({ 'r-85': { candidates: 1, invited: 0, accepted: 0, declined: 0, held: 0, received: 0, completed: 0, progress: {} } });
    const body = await loadDashboard(args({ cycleCode: 'J27', scope: 'all' }));
    expect(queryAllRequests.mock.calls[0][0].select).toContain('_wmkf_grantcycle_value');
    expect(queryAllRequests.mock.calls[0][0].select).toContain('wmkf_phaseiistatus');
    expect(existsAnySuggestionForRequests).toHaveBeenCalledTimes(1);
    expect(existsAnySuggestionForRequests).toHaveBeenCalledWith(['r-80', 'r-85']);
    expect(readLatestIntegrityStates).toHaveBeenCalledTimes(1);
    expect(getCycleDatesById).toHaveBeenCalledTimes(1);
    expect(getCycleDatesById).toHaveBeenCalledWith('cycle-j27');
    const byNumber = Object.fromEntries(body.proposals.map((p) => [p.requestNumber, p]));
    expect(byNumber['1002836']).not.toHaveProperty('j27');
    // Memo waves are off in this env: their keys are not-provisioned and do not degrade; the later-phase facts are mocked neutral, so the basis is full.
    expect(byNumber['1000380'].j27).toEqual({
      phase: 'initial-assessment', basis: 'full', primaryTask: 'record-scoring',
      taskKeys: ['record-scoring', 'identify-reviewers'], blockerKeys: ['presentation-end-unverified'],
      recorded: { scoring: 'unset', chairsRecommendation: 'unset', chairsOutcome: 'pending', label: null, unmapped: false }, outcome: 'none',
      timing: 'not-scheduled', review: null,
    });
    expect(byNumber['1000385'].j27).toMatchObject({
      phase: 'peer-review', primaryTask: 'review-integrity',
      taskKeys: ['review-integrity', 'identify-reviewers', 'record-offramp'],
      blockerKeys: ['chairs-outcome-pending', 'integrity-unreviewed', 'presentation-end-unverified'],
    });
    expect(byNumber['1000385'].j27).not.toHaveProperty('input');
    expect(byNumber['1000385'].reviewers.candidates).toBe(1);
  });
  test('later-phase facts load once per list, for 2027-or-later Research rows only', async () => {
    const d26 = { akoya_requestid: 'r-d26', akoya_requestnum: '1002836', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, akoya_requeststatus: 'Phase II Pending', wmkf_triagestatus: 100000000, _wmkf_grantprogram_value: '94cab30b-958f-ee11-8179-000d3a341e8f', _wmkf_programdirector_value: 'pd-1' };
    const socal = j27(82, { akoya_requeststatus: 'Phase II Pending', _wmkf_grantprogram_value: '8dcab30b-958f-ee11-8179-000d3a341e8f' });
    queryAllRequests.mockResolvedValue({ capped: false, records: [j27(80), d26, socal, j27(81)] });
    const body = await loadDashboard(args({ cycleCode: 'J27', scope: 'all' }));
    expect(body.proposals.map((p) => p.requestNumber)).toEqual(expect.arrayContaining(['1002836', '1000382']));
    expect(loadJ27LaterFacts).toHaveBeenCalledTimes(1);
    expect(loadJ27LaterFacts.mock.calls[0][0].map((r) => r.akoya_requestid)).toEqual(['r-80', 'r-81']);
  });
  test('the later-phase facts are not loaded when no row qualifies', async () => {
    queryAllRequests.mockResolvedValue({ capped: false, records: [
      { akoya_requestid: 'r-d26', akoya_requestnum: '1002836', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, akoya_requeststatus: 'Phase II Pending', wmkf_triagestatus: 100000000, _wmkf_grantprogram_value: '94cab30b-958f-ee11-8179-000d3a341e8f', _wmkf_programdirector_value: 'pd-1' },
      j27(82, { akoya_requeststatus: 'Phase II Pending', _wmkf_grantprogram_value: '8dcab30b-958f-ee11-8179-000d3a341e8f' }),
    ] });
    const body = await loadDashboard(args({ cycleCode: 'J27', scope: 'all' }));
    expect(body.proposals.map((p) => p.requestNumber)).toEqual(expect.arrayContaining(['1002836', '1000382']));
    expect(loadJ27LaterFacts).not.toHaveBeenCalled();
  });
  test('the later-phase facts place a row: an ended presentation is Deliberations, a Board draft is Final Assessment', async () => {
    queryAllRequests.mockResolvedValue({ capped: false, records: [j27(80), j27(81)] });
    loadJ27LaterFacts.mockResolvedValue(new Map([
      ['r-80', { ...neutralLater(), presentation: { status: 'present', exists: true, id: 'p1', ended: true, legacyException: false } }],
      ['r-81', { ...neutralLater(), boardDraft: { status: 'present', exists: true } }],
    ]));
    const body = await loadDashboard(args({ cycleCode: 'J27', scope: 'all' }));
    const byNumber = Object.fromEntries(body.proposals.map((p) => [p.requestNumber, p]));
    expect(byNumber['1000380'].j27).toMatchObject({ phase: 'deliberations', timing: 'after' });
    expect(byNumber['1000381'].j27).toMatchObject({ phase: 'final-assessment', review: 'board-draft' });
  });
  test('a page with no in-scope rows makes none of the new reads', async () => {
    queryAllRequests.mockResolvedValue({ capped: false, records: [
      { akoya_requestid: 'r-d26', akoya_requestnum: '1002836', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, akoya_requeststatus: 'Phase II Pending', wmkf_triagestatus: 100000000, _wmkf_programdirector_value: 'pd-1' },
    ] });
    await loadDashboard(args({ cycleCode: 'D26', scope: 'all' }));
    expect(existsAnySuggestionForRequests).not.toHaveBeenCalled();
    expect(readLatestIntegrityStates).not.toHaveBeenCalled();
    expect(getCycleDatesById).not.toHaveBeenCalled();
  });
  test('a failed batch read marks its key unavailable on every row and the list still renders', async () => {
    queryAllRequests.mockResolvedValue({ capped: false, records: [j27(80), j27(81)] });
    existsAnySuggestionForRequests.mockRejectedValue(new Error('dataverse 503'));
    readLatestIntegrityStates.mockRejectedValue(new Error('no POSTGRES_URL'));
    getCycleDatesById.mockRejectedValue(new Error('calendar 503'));
    const body = await loadDashboard(args({ cycleCode: 'J27', scope: 'all' }));
    expect(body.proposals).toHaveLength(2);
    for (const proposal of body.proposals) expect(proposal.j27.basis).toBe('degraded');
  });
});

describe('plan F2: discovery contract on the real queries', () => {
  const { assertDiscoveryQuery } = jest.requireActual('../../shared/config/workbenchVisibility.js');
  const RESEARCH_ID = '94cab30b-958f-ee11-8179-000d3a341e8f';
  const readySetAside = { akoya_requestid: 'r-sa', akoya_requestnum: '1000390', akoya_requeststatus: 'Phase I Pending', wmkf_triagestatus: 100000001,
    _wmkf_grantprogram_value: RESEARCH_ID, wmkf_readyforreview: true, _wmkf_grantcycle_value: 'cycle-j27', wmkf_GrantCycle: { wmkf_cyclecode: 'J27' }, _wmkf_programdirector_value: 'pd-1' };
  test('cycle list and proposal list send the discovery projection with the linked-cycle expansion', async () => {
    queryAllRequests.mockResolvedValue({ records: [readySetAside], capped: false });
    await loadDashboard(args());
    assertDiscoveryQuery(queryAllRequests.mock.calls[0][0]);
    await loadDashboard(args({ cycleCode: 'J27', scope: 'all' }));
    assertDiscoveryQuery(queryAllRequests.mock.calls[1][0]);
  });
  test('a ready J27 Research Set-aside row counts as active in the cycle list and appears in the default proposal list', async () => {
    queryAllRequests.mockResolvedValue({ records: [readySetAside], capped: false });
    const cycles = await loadDashboard(args());
    expect(cycles.cycles.map((c) => [c.code, c.count, c.setAsideCount, c.myCount, c.mySetAsideCount])).toEqual([['J27', 1, 0, 1, 0]]);
    const list = await loadDashboard(args({ cycleCode: 'J27', scope: 'all' }));
    expect(list.proposals.map((p) => p.requestNumber)).toEqual(['1000390']);
  });
  test('a D26 Set-aside row still counts as Set aside and stays out of the default list', async () => {
    const d26 = { ...readySetAside, akoya_requestid: 'r-d26sa', akoya_requestnum: '1002999', akoya_requeststatus: 'Phase II Pending', _wmkf_grantcycle_value: 'cycle-d26', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' } };
    queryAllRequests.mockResolvedValue({ records: [d26], capped: false });
    const cycles = await loadDashboard(args());
    expect(cycles.cycles.map((c) => [c.code, c.count, c.setAsideCount])).toEqual([['D26', 0, 1]]);
    const list = await loadDashboard(args({ cycleCode: 'D26', scope: 'all' }));
    expect(list.proposals).toEqual([]);
  });
});

test('plan F1 program gate: a J27 row outside the Research scope lists without a read model', async () => {
  queryAllRequests.mockResolvedValue({ capped: false, records: [{
    akoya_requestid: 'r-socal', akoya_requestnum: '1000399', akoya_requeststatus: 'Phase II Pending', _wmkf_grantcycle_value: 'cycle-j27',
    wmkf_GrantCycle: { wmkf_cyclecode: 'J27' }, wmkf_readyforreview: true, _wmkf_programdirector_value: 'pd-1', _wmkf_grantprogram_value: '8dcab30b-958f-ee11-8179-000d3a341e8f',
  }] });
  const body = await loadDashboard(args({ cycleCode: 'J27', scope: 'all' }));
  expect(body.proposals.map((p) => p.requestNumber)).toEqual(['1000399']);
  expect(body.proposals[0]).not.toHaveProperty('j27');
});

// J27 cycle page (docs/plans/J27_CYCLE_PAGE_BUILD_PLAN_2026-11-09.md, slice 1).
test('cycle page fields: both modes name the stage programs; rows carry the request title', async () => {
  const RESEARCH = '94cab30b-958f-ee11-8179-000d3a341e8f';
  const cycles = await loadDashboard(args());
  expect(cycles.stageProgramIds).toEqual([RESEARCH]);

  queryAllRequests.mockResolvedValue({
    records: [
      { akoya_requestid: 'r-1', akoya_requestnum: '1009001', akoya_title: 'Mapping signalling lipids', akoya_requeststatus: 'Phase II Pending', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, wmkf_triagestatus: 100000000 },
      { akoya_requestid: 'r-2', akoya_requestnum: '1009002', akoya_requeststatus: 'Phase II Pending', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, wmkf_triagestatus: 100000000 },
    ],
  });
  const body = await loadDashboard(args({ cycleCode: 'D26', scope: 'all' }));
  expect(body.stageProgramIds).toEqual([RESEARCH]);
  expect(body.proposals.map((p) => p.title)).toEqual(['Mapping signalling lipids', null]);
  expect(queryAllRequests.mock.calls.at(-1)[0].select.split(',')).toContain('akoya_title');

  resolveWorkbenchProgramScope.mockResolvedValueOnce({
    programs: [{ programId: RESEARCH, name: 'Research' }], discoveryScope: { readinessOnlyProgramIds: [] },
    defaultProgramId: RESEARCH, programId: RESEARCH, programName: 'Research',
  });
  await expect(loadDashboard(args())).resolves.toMatchObject({ stageProgramIds: [] });
});
