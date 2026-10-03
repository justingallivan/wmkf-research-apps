/** @jest-environment node */

const queryAllRequests = jest.fn();
const queryRequestBatch = jest.fn();
jest.mock('../../lib/services/workbench/program-scope-service.js', () => ({
  resolveWorkbenchProgramScope: jest.fn(async () => ({
    programs: [{ programId: 'program-1', name: 'Research' }],
    defaultProgramId: 'program-1',
    programId: 'program-1',
    programName: 'Research',
  })),
  buildProgramScopeFilter: jest.fn(() => '_akoya_programid_value eq program-1'),
}));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  queryAllRequests: (...args) => queryAllRequests(...args),
  findByIds: (...args) => queryRequestBatch(...args),
}));
jest.mock('../../lib/services/program-director-resolver', () => ({
  resolveByEmail: jest.fn(async () => ({ systemuserid: 'pd-1', fullName: 'Dr. PD One' })),
}));
jest.mock('../../lib/utils/auth', () => ({ getUserRole: jest.fn(async () => 'read_only') }));
jest.mock('../../lib/services/reviewer-rollup', () => ({
  fetchReviewerRollup: jest.fn(async () => ({
    '11111111-1111-4111-8111-111111111111': {
      candidates: 3, invited: 2, accepted: 1, declined: 0, held: 0, completed: 0,
      progress: { total: 3, accepted: 1, pending: 2, declined: 0, uninvited: 0 },
    },
  })),
  deriveWorkRemaining: jest.fn(() => 'find'),
  emptyCounts: () => ({
    candidates: 0, invited: 0, accepted: 0, declined: 0, held: 0, completed: 0,
    progress: { total: 0, accepted: 0, pending: 0, declined: 0, uninvited: 0 },
  }),
  REVIEWERS_NEEDED: 3,
}));

import { fetchReviewerRollup } from '../../lib/services/reviewer-rollup';
import { loadDashboard, loadMeetingTrackerSelection } from '../../lib/services/workbench/dashboard-service';
import { loadMeetingTrackerDashboard } from '../../lib/services/meeting-tracker/dashboard-service';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const counts = {
  candidates: 3, invited: 2, accepted: 1, declined: 0, held: 0, completed: 0,
  progress: { total: 3, accepted: 1, pending: 2, declined: 0, uninvited: 0 },
};

function sourceRow() {
  return {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002836',
    wmkf_meetingdate: '2026-12-11',
    akoya_requeststatus: 'Advancing',
    wmkf_triagestatus: 100000000,
    _wmkf_programdirector_value: 'pd-1',
    _wmkf_programdirector_value_formatted: 'Dr. PD One',
    _wmkf_projectleader_value_formatted: 'Pat One',
    _akoya_applicantid_value_formatted: 'Caltech',
  };
}

function trackerDependencies() {
  return {
    schemaReady: jest.fn(() => true),
    loadWorkbenchDashboard: loadDashboard,
    loadWorkbenchDashboardSelection: loadMeetingTrackerSelection,
    findRequestsByIds: jest.fn(async () => ({ records: [{
      akoya_requestid: REQUEST_ID,
      akoya_title: 'Proposal A',
      _wmkf_currentpresitevisit_value: null,
    }] })),
    findDocumentsByIds: jest.fn(async () => ({ records: [] })),
    findActiveSiteVisits: jest.fn(async () => []),
    findActiveSiteVisitSummaries: jest.fn(async () => ({ records: [], totalCount: 0, capped: false })),
    getSiteVisitById: jest.fn(),
    getSchedules: jest.fn(async () => new Map([[REQUEST_ID, null]])),
    getMaterialsSummariesWithAvailability: jest.fn(async () => ({
      summaries: new Map([[REQUEST_ID, null]]),
      availability: new Map([[REQUEST_ID, 'available']]),
    })),
  };
}

beforeEach(() => {
  delete process.env.TEST_REQUEST_ISOLATION;
  jest.clearAllMocks();
  queryAllRequests.mockResolvedValue({ records: [sourceRow()], capped: false });
  queryRequestBatch.mockResolvedValue({ records: [] });
  fetchReviewerRollup.mockResolvedValue({ [REQUEST_ID]: counts });
});

test('the complete Tracker path keeps legacy rollup but schedule reads skip it with matching eligibility', async () => {
  const args = {
    azureEmail: 'pd@example.org',
    profileId: 1,
    callerSystemId: 'pd-1',
    cycleCode: 'D26',
    scope: 'my',
    includeSetAside: false,
  };
  const deps = trackerDependencies();
  const legacy = await loadMeetingTrackerDashboard(args, deps);
  expect(fetchReviewerRollup).toHaveBeenCalledTimes(1);
  expect(fetchReviewerRollup).toHaveBeenCalledWith([REQUEST_ID]);
  expect(legacy.rollup.total).toBe(1);

  const full = await loadMeetingTrackerDashboard({ ...args, projection: 'full' }, deps);
  expect(fetchReviewerRollup).toHaveBeenCalledTimes(2);
  expect(full.rollup).toEqual(legacy.rollup);
  expect(full).not.toHaveProperty('projection');

  const schedule = await loadMeetingTrackerDashboard({ ...args, projection: 'schedule' }, deps);
  expect(fetchReviewerRollup).toHaveBeenCalledTimes(2);
  expect(schedule).not.toHaveProperty('rollup');
  expect(schedule.proposals.map(({ requestId }) => requestId)).toEqual(legacy.proposals.map(({ requestId }) => requestId));
  expect(schedule.proposals[0]).toMatchObject({
    requestNumber: legacy.proposals[0].requestNumber,
    title: legacy.proposals[0].title,
    institution: legacy.proposals[0].institution,
    projectLeader: legacy.proposals[0].projectLeader,
    programDirector: legacy.proposals[0].programDirector,
    shareState: legacy.proposals[0].shareState,
    deliberation: legacy.proposals[0].deliberation,
    siteVisit: legacy.proposals[0].siteVisit,
    materials: legacy.proposals[0].materials,
    materialsAvailability: legacy.proposals[0].materialsAvailability,
    siteVisitNeedsReconciliation: legacy.proposals[0].siteVisitNeedsReconciliation,
    needsScheduling: legacy.proposals[0].needsScheduling,
  });
});
