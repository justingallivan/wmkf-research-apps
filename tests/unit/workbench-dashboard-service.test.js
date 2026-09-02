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

import { loadDashboard } from '../../lib/services/workbench/dashboard-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

const PD = { systemuserid: 'pd-1', fullName: 'Dr. PD One' };

beforeEach(() => {
  jest.clearAllMocks();
  resolveByEmail.mockResolvedValue(PD);
  getUserRole.mockResolvedValue('read_only');
  queryAllRequests.mockResolvedValue({ records: [], capped: false });
  fetchReviewerRollup.mockResolvedValue({});
});

const args = (over = {}) => ({
  azureEmail: 'pd@example.org', profileId: 1, callerSystemId: 'pd-1', cycleCode: undefined, scope: 'my', includeSetAside: false, ...over,
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
      { wmkf_meetingdate: '2026-06-04', _wmkf_programdirector_value: 'pd-1' },
      { wmkf_meetingdate: '2026-12-11', _wmkf_programdirector_value: 'pd-2' },
      { wmkf_meetingdate: '2026-12-12', _wmkf_programdirector_value: 'pd-2', wmkf_triagestatus: 100000001 },
      { wmkf_meetingdate: null }, // no code → skipped
    ],
    capped: false,
  });
  const body = await loadDashboard(args());
  expect(body.success).toBe(true);
  expect(body.cycles.map((c) => [c.code, c.count, c.setAsideCount]))
    .toEqual([['D26', 1, 1], ['J26', 1, 0]]);
  expect(body.defaultCycleCode).toBe('J26');
  expect(body.programDirector).toEqual({ systemuserid: 'pd-1', fullName: 'Dr. PD One' });
  expect(queryAllRequests).toHaveBeenCalledWith({
    select: 'akoya_requestid,wmkf_meetingdate,akoya_requeststatus,_wmkf_programdirector_value,wmkf_triagestatus',
    filter: "wmkf_meetingdate ne null and (akoya_requeststatus eq 'Phase II Pending' or wmkf_triagestatus eq 100000000 or wmkf_triagestatus eq 100000001)",
    orderby: 'wmkf_meetingdate desc',
  });
});

test('cycle-list mode: falls back to newest active org cycle, then set-aside-only cycle', async () => {
  queryAllRequests.mockResolvedValue({
    records: [
      { wmkf_meetingdate: '2026-12-11', _wmkf_programdirector_value: 'pd-2', wmkf_triagestatus: 100000001 },
      { wmkf_meetingdate: '2026-06-04', _wmkf_programdirector_value: 'pd-2' },
    ],
    capped: false,
  });
  await expect(loadDashboard(args({ callerSystemId: null }))).resolves.toMatchObject({ defaultCycleCode: 'J26' });

  queryAllRequests.mockResolvedValue({
    records: [{ wmkf_meetingdate: '2026-12-11', wmkf_triagestatus: 100000001 }],
    capped: false,
  });
  await expect(loadDashboard(args({ callerSystemId: null }))).resolves.toMatchObject({ defaultCycleCode: 'D26' });
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
      wmkf_meetingdate: '2026-12-11',
      akoya_requeststatus: 'Phase II Pending',
      wmkf_triagestatus: 100000000,
      _wmkf_programdirector_value: 'someone-else',
    }],
  });
  const body = await loadDashboard(args({ cycleCode: 'D26', scope: 'all' }));
  expect(body.proposals[0].canManage).toBe(true); // superuser override
  expect(body.proposals[0].advancing).toBe(true);
  expect(body.proposals[0].reviewers.needed).toBe(3);
  expect(body.rollup).toEqual({ total: 1, stages: { find: 1, invite: 0, awaiting: 0, review: 0, done: 0 } });
  expect(body.cycleCode).toBe('D26');
  expect(body.scope).toBe('all');
});

test('proposal mode: non-lead non-superuser rows project canManage false', async () => {
  queryAllRequests.mockResolvedValue({
    records: [{
      akoya_requestid: 'r-1',
      akoya_requestnum: '1002836',
      wmkf_meetingdate: '2026-12-11',
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
      wmkf_meetingdate: '2026-12-11',
      _wmkf_programdirector_value: 'PD-1',
    }],
  });
  await expect(loadDashboard(args({ cycleCode: 'D26', scope: 'all', callerSystemId: 'pd-1' })))
    .resolves.toMatchObject({ proposals: [{ canManage: true }] });
  await expect(loadDashboard(args({ cycleCode: 'D26', scope: 'all', callerSystemId: null })))
    .resolves.toMatchObject({ proposals: [{ canManage: false }] });
});
