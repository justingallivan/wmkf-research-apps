/** @jest-environment node */

jest.mock('../../lib/services/dynamics/http.js', () => ({ fetchWithTimeout: jest.fn() }));

import { fetchWithTimeout } from '../../lib/services/dynamics/http.js';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { loadMeetingTrackerDashboard } from '../../lib/services/meeting-tracker/dashboard-service.js';
import { findActiveSummariesByRequests } from '../../lib/dataverse/adapters/site-visit.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const LATER_VISIT = '22222222-2222-4222-8222-222222222222';
const EARLIER_VISIT = '33333333-3333-4333-8333-333333333333';
const ORIGINAL_URL = process.env.DYNAMICS_URL;
const ORIGINAL_SCHEMA_READY = process.env.SITE_VISIT_LOGISTICS_SCHEMA_READY;

beforeAll(() => {
  jest.spyOn(DynamicsService, 'getAccessToken').mockResolvedValue('token');
  jest.spyOn(DynamicsService, 'resolveLogicalName').mockReturnValue('wmkf_sitevisit');
  jest.spyOn(DynamicsService, 'checkRestriction').mockImplementation(() => {});
  jest.spyOn(DynamicsService, 'buildHeaders').mockReturnValue({ Authorization: 'Bearer token' });
  jest.spyOn(DynamicsService, 'processAnnotations').mockImplementation((row) => row);
});

beforeEach(() => {
  process.env.DYNAMICS_URL = 'https://org.crm.test';
  process.env.SITE_VISIT_LOGISTICS_SCHEMA_READY = 'on';
  fetchWithTimeout.mockReset();
});

afterAll(() => {
  jest.restoreAllMocks();
  if (ORIGINAL_URL === undefined) delete process.env.DYNAMICS_URL; else process.env.DYNAMICS_URL = ORIGINAL_URL;
  if (ORIGINAL_SCHEMA_READY === undefined) delete process.env.SITE_VISIT_LOGISTICS_SCHEMA_READY;
  else process.env.SITE_VISIT_LOGISTICS_SCHEMA_READY = ORIGINAL_SCHEMA_READY;
});

test('actual summary adapter follows Dataverse pages and selects a later-page winner without per-visit reads', async () => {
  fetchWithTimeout
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        value: [{
          activityid: LATER_VISIT,
          _regardingobjectid_value: REQUEST_ID,
          scheduledstart: '2026-09-25T16:00:00.000Z',
          scheduledend: '2026-09-25T17:00:00.000Z',
          wmkf_visitformat: 100000001,
          wmkf_locationorlink: 'Later page one',
        }],
        '@odata.count': 2,
        '@odata.nextLink': 'https://org.crm.test/api/data/v9.2/wmkf_sitevisits?skiptoken=page2',
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        value: [{
          activityid: EARLIER_VISIT,
          _regardingobjectid_value: REQUEST_ID,
          scheduledstart: '2026-09-20T16:00:00.000Z',
          scheduledend: '2026-09-20T17:00:00.000Z',
          wmkf_visitformat: 100000002,
          wmkf_locationorlink: 'Later page winner',
        }],
        '@odata.count': 2,
      }),
    });

  const dependencies = {
    schemaReady: jest.fn(() => true),
    loadWorkbenchDashboard: jest.fn(),
    loadWorkbenchDashboardSelection: jest.fn(async () => ({
      success: true,
      cycleCode: 'D26',
      proposals: [{ requestId: REQUEST_ID, requestNumber: '1001' }],
    })),
    findRequestsByIds: jest.fn(async () => ({ records: [{
      akoya_requestid: REQUEST_ID,
      akoya_title: 'Proposal A',
      _wmkf_currentpresitevisit_value: null,
    }] })),
    findDocumentsByIds: jest.fn(async () => ({ records: [] })),
    findActiveSiteVisits: jest.fn(),
    findActiveSiteVisitSummaries: findActiveSummariesByRequests,
    getSiteVisitById: jest.fn(),
    getSchedules: jest.fn(async () => new Map([[REQUEST_ID, null]])),
    getMaterialsSummariesWithAvailability: jest.fn(async () => ({
      summaries: new Map([[REQUEST_ID, null]]),
      availability: new Map([[REQUEST_ID, 'available']]),
    })),
  };

  const result = await loadMeetingTrackerDashboard({ cycleCode: 'D26', projection: 'schedule' }, dependencies);

  expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
  expect(dependencies.findActiveSiteVisits).not.toHaveBeenCalled();
  expect(dependencies.getSiteVisitById).not.toHaveBeenCalled();
  expect(result.proposals[0].siteVisit).toMatchObject({
    activityId: EARLIER_VISIT,
    formatLabel: 'Hybrid',
    location: 'Later page winner',
  });
  expect(result.proposals[0].siteVisitNeedsReconciliation).toBe(true);
  const queryUrl = new URL(fetchWithTimeout.mock.calls[0][0]);
  expect(queryUrl.searchParams.get('$select')).toBe('activityid,_regardingobjectid_value,scheduledstart,scheduledend,wmkf_visitformat,wmkf_locationorlink');
  expect(queryUrl.searchParams.has('$expand')).toBe(false);
});
