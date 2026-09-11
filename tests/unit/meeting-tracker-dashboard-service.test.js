/** @jest-environment node */

import { loadMeetingTrackerDashboard } from '../../lib/services/meeting-tracker/dashboard-service';

const REQUEST_A = '11111111-1111-4111-8111-111111111111';
const REQUEST_B = '22222222-2222-4222-8222-222222222222';
const DOC_A = '33333333-3333-4333-8333-333333333333';
const VISIT_A = '44444444-4444-4444-8444-444444444444';

function dependencies(overrides = {}) {
  return {
    schemaReady: jest.fn(() => true),
    loadWorkbenchDashboard: jest.fn(async () => ({
      success: true,
      cycleCode: 'D26',
      programs: [],
      proposals: [
        { requestId: REQUEST_B, requestNumber: '1002', projectLeader: 'Pat Two', programDirector: 'PD Two' },
        { requestId: REQUEST_A, requestNumber: '1001', projectLeader: 'Pat One', programDirector: 'PD One', institution: 'Caltech' },
      ],
    })),
    findRequestsByIds: jest.fn(async () => ({ records: [
      { akoya_requestid: REQUEST_A, akoya_title: 'Proposal A', _wmkf_currentpresitevisit_value: DOC_A },
      { akoya_requestid: REQUEST_B, akoya_title: 'Proposal B', _wmkf_currentpresitevisit_value: null },
    ] })),
    findDocumentsByIds: jest.fn(async () => ({ records: [{
      wmkf_requestdocumentid: DOC_A,
      wmkf_lifecyclestate: 100000002,
      wmkf_operationstatus: 100000001,
    }] })),
    findActiveSiteVisits: jest.fn(async () => [{
      activityid: VISIT_A,
      _regardingobjectid_value: REQUEST_A,
      scheduledstart: '2026-09-20T16:00:00.000Z',
    }]),
    getSiteVisitById: jest.fn(async () => ({
      activityid: VISIT_A,
      _regardingobjectid_value: REQUEST_A,
      scheduledstart: '2026-09-20T16:00:00.000Z',
      scheduledend: '2026-09-20T17:00:00.000Z',
      wmkf_visitformat: 100000002,
      wmkf_locationorlink: 'Board room',
    })),
    getSchedules: jest.fn(async () => new Map([
      [REQUEST_A, {
        sessionId: '55555555-5555-4555-8555-555555555555',
        scheduledStartIso: '2026-09-18T16:00:00.000Z',
        scheduledEndIso: '2026-09-18T17:30:00.000Z',
        ianaTimeZone: 'America/Los_Angeles',
        meetingLink: 'https://zoom.us/j/123',
        location: 'Zoom',
        order: 1,
        minutes: 15,
        attendees: [],
      }],
      [REQUEST_B, null],
    ])),
    getMaterialsSummaries: jest.fn(async ({ requestIds }) => new Map(requestIds.map((id) => [id, id === REQUEST_A ? MATERIALS_A : null]))),
    ...overrides,
  };
}
const MATERIALS_A = { state: 'missing', receivedCount: 1, requiredCount: 3, otherCount: 0, dueAt: '2026-09-18T19:00:00.000Z', closesAt: '2026-09-27T17:00:00.000Z', overdue: false, invited: true };

test('joins share, deliberation, and visit state and sorts by the next meeting', async () => {
  const deps = dependencies();
  const result = await loadMeetingTrackerDashboard({ cycleCode: 'D26' }, deps);

  expect(result.proposals.map((row) => row.requestId)).toEqual([REQUEST_A, REQUEST_B]);
  expect(result.proposals[0]).toMatchObject({
    title: 'Proposal A',
    institution: 'Caltech',
    shareState: { lifecycleState: 100000002 },
    needsScheduling: false,
    nextMeetingIso: '2026-09-18T16:00:00.000Z',
    siteVisit: { formatLabel: 'Hybrid', location: 'Board room' },
    materials: MATERIALS_A,
  });
  expect(deps.getMaterialsSummaries).toHaveBeenCalledWith({
    requestIds: [REQUEST_B, REQUEST_A],
    requestNumbers: new Map([[REQUEST_B, '1002'], [REQUEST_A, '1001']]),
    cycleCode: 'D26',
  });
  expect(result.proposals[1]).toMatchObject({
    title: 'Proposal B',
    institution: null,
    shareState: null,
    deliberation: null,
    siteVisit: null,
    materials: null,
    needsScheduling: true,
  });
});

test('a failing materials reader degrades every row to null instead of failing the cycle page', async () => {
  const deps = dependencies({ getMaterialsSummaries: jest.fn(async () => { throw new Error('pg down'); }) });
  const result = await loadMeetingTrackerDashboard({ cycleCode: 'D26' }, deps);
  expect(result.proposals.map((row) => row.materials)).toEqual([null, null]);
});

test('readiness fails before the Workbench selector or any join runs', async () => {
  const deps = dependencies({ schemaReady: jest.fn(() => false) });
  await expect(loadMeetingTrackerDashboard({ cycleCode: 'D26' }, deps)).rejects.toMatchObject({
    httpStatus: 503,
    code: 'meeting_tracker_schema_not_ready',
  });
  expect(deps.loadWorkbenchDashboard).not.toHaveBeenCalled();
  expect(deps.getSchedules).not.toHaveBeenCalled();
});

// Review finding 3 (S503): data conditions are shown, not fatal.
test('a duplicate active Site Visit picks the earliest-ending one and flags the row', async () => {
  const VISIT_B = '66666666-6666-4666-8666-666666666666';
  const deps = dependencies({
    findActiveSiteVisits: jest.fn(async () => [
      { activityid: VISIT_B, _regardingobjectid_value: REQUEST_A, scheduledstart: '2026-09-25T16:00:00.000Z', scheduledend: '2026-09-25T17:00:00.000Z' },
      { activityid: VISIT_A, _regardingobjectid_value: REQUEST_A, scheduledstart: '2026-09-20T16:00:00.000Z', scheduledend: '2026-09-20T17:00:00.000Z' },
    ]),
  });
  const result = await loadMeetingTrackerDashboard({ cycleCode: 'D26' }, deps);
  expect(deps.getSiteVisitById).toHaveBeenCalledTimes(1);
  expect(deps.getSiteVisitById).toHaveBeenCalledWith(VISIT_A);
  expect(result.proposals[0]).toMatchObject({ siteVisitNeedsReconciliation: true, siteVisit: { activityId: VISIT_A } });
  expect(result.proposals[1].siteVisitNeedsReconciliation).toBe(false);
});

test('an unresolvable request is listed with a notice instead of failing the cycle', async () => {
  const deps = dependencies({
    findRequestsByIds: jest.fn(async () => ({ records: [
      { akoya_requestid: REQUEST_A, akoya_title: 'Proposal A', _wmkf_currentpresitevisit_value: DOC_A },
    ] })),
  });
  const result = await loadMeetingTrackerDashboard({ cycleCode: 'D26' }, deps);
  expect(result.proposals).toHaveLength(2);
  expect(result.proposals.find((row) => row.requestId === REQUEST_B)).toMatchObject({ requestUnresolved: true, title: null, shareState: null });
  expect(result.notices).toEqual([expect.objectContaining({ code: 'meeting_tracker_request_unresolved', requestIds: [REQUEST_B] })]);
});
