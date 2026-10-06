/** @jest-environment node */

jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({ findByRequests: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ queryAllRequests: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/site-visit.js', () => ({ findSummariesByRequests: jest.fn() }));
jest.mock('../../lib/services/pre-site-visit/distribution-store.js', () => ({
  sentSourceDocumentIds: jest.fn(), sentSourceVersionReceipts: jest.fn(),
}));
jest.mock('../../lib/services/pre-site-visit/preparation-store.js', () => ({ listPreparationsForSchedules: jest.fn() }));
jest.mock('../../lib/services/deliberation-stage-labels.js', () => ({ readDeliberationStageLabels: jest.fn() }));
jest.mock('../../lib/services/meeting-tracker/schedule-reader.js', () => ({ getDeliberationScheduleByRequestsWithAvailability: jest.fn() }));
jest.mock('../../lib/services/site-visit-materials/summary-reader.js', () => ({ getMaterialsSummaryByRequestsWithAvailability: jest.fn() }));
jest.mock('../../lib/services/workbench/program-scope-service.js', () => ({ resolveWorkbenchProgramScope: jest.fn() }));

import * as requestDocumentAdapter from '../../lib/dataverse/adapters/request-document.js';
import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import * as siteVisitAdapter from '../../lib/dataverse/adapters/site-visit.js';
import { sentSourceDocumentIds, sentSourceVersionReceipts } from '../../lib/services/pre-site-visit/distribution-store.js';
import { listPreparationsForSchedules } from '../../lib/services/pre-site-visit/preparation-store.js';
import { readDeliberationStageLabels } from '../../lib/services/deliberation-stage-labels.js';
import { getDeliberationScheduleByRequestsWithAvailability } from '../../lib/services/meeting-tracker/schedule-reader.js';
import { getMaterialsSummaryByRequestsWithAvailability } from '../../lib/services/site-visit-materials/summary-reader.js';
import { resolveWorkbenchProgramScope } from '../../lib/services/workbench/program-scope-service.js';
import { listPreSiteVisitDrafts } from '../../lib/services/pre-site-visit/cycle-list-service';
import { buildVisibilityFilter } from '../../shared/config/workbenchVisibility';
import {
  PRE_RP_BRIEF_CONTRACT,
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE as L,
  REQUEST_DOCUMENT_OPERATION_STATUS as O,
} from '../../shared/config/requestDocument';

const R1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const R2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const PD_A = 'bbbbbbbb-0000-4000-8000-0000000000aa';
const PD_B = 'bbbbbbbb-0000-4000-8000-0000000000bb';
const PROGRAM = 'dddddddd-0000-4000-8000-000000000001';
const OTHER_PROGRAM = 'dddddddd-0000-4000-8000-000000000002';
const originalStateStatusPairs = process.env.STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS;
const WORD = PRE_SITE_VISIT_CONTRACT.contentType;
const labels = { draft: 'AI draft ready', shared: 'Shared', visit: 'Visit', final: 'Final' };

function req(id, overrides = {}) {
  return {
    akoya_requestid: id,
    akoya_requestnum: id === R1 ? '1002959' : '1003001',
    akoya_title: 'Proposal title',
    _akoya_applicantid_value_formatted: 'University',
    _wmkf_programdirector_value: id === R1 ? PD_A : PD_B,
    _wmkf_programdirector_value_formatted: id === R1 ? 'PD A' : 'PD B',
    _wmkf_grantprogram_value: PROGRAM,
    ...overrides,
  };
}

function doc(id, requestId, overrides = {}) {
  return {
    wmkf_requestdocumentid: id,
    _wmkf_request_value: requestId,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    wmkf_contenttype: WORD,
    wmkf_producer: PRE_SITE_VISIT_CONTRACT.producer,
    wmkf_operationstatus: O.READY,
    wmkf_lifecyclestate: L.DRAFT,
    createdon: '2026-09-01T00:00:00Z',
    wmkf_sharepointitemid: `item-${id}`,
    wmkf_sharepointweburl: `https://sharepoint.test/${id}.docx`,
    wmkf_filename: `${id}.docx`,
    ...overrides,
  };
}

const schedule = (requestIds) => ({
  schedules: new Map(requestIds.map((id) => [id, null])),
  availability: new Map(requestIds.map((id) => [id, 'available'])),
});
const materials = (requestIds) => ({
  summaries: new Map(requestIds.map((id) => [id, null])),
  availability: new Map(requestIds.map((id) => [id, 'available'])),
});

function list(options = {}) {
  return listPreSiteVisitDrafts({ cycleCode: 'D26', programId: PROGRAM, scope: 'all', ...options });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  process.env.STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS = JSON.stringify([
    [1, 2, true], [3, 3, true],
  ]);
  resolveWorkbenchProgramScope.mockResolvedValue({ programId: PROGRAM, programName: 'Research' });
  readDeliberationStageLabels.mockResolvedValue(labels);
  grantRequestAdapter.queryAllRequests.mockResolvedValue({ records: [req(R1), req(R2)], capped: false });
  requestDocumentAdapter.findByRequests.mockImplementation(async (_ids, { artifactType }) => ({
    records: artifactType === REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_RESEARCH_PRESENTATION_BRIEF
      ? [] : [doc('writeup-1', R1)],
    capped: false,
  }));
  siteVisitAdapter.findSummariesByRequests.mockResolvedValue({ records: [], capped: false });
  sentSourceDocumentIds.mockResolvedValue(new Set());
  sentSourceVersionReceipts.mockResolvedValue(new Map());
  listPreparationsForSchedules.mockResolvedValue(new Map());
  getDeliberationScheduleByRequestsWithAvailability.mockImplementation(async (ids) => schedule(ids));
  getMaterialsSummaryByRequestsWithAvailability.mockImplementation(async ({ requestIds }) => materials(requestIds));
});

afterAll(() => {
  if (originalStateStatusPairs === undefined) delete process.env.STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS;
  else process.env.STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS = originalStateStatusPairs;
});

it('uses an active server-resolved program plus the selected cycle and lead-PD filter', async () => {
  await list({ scope: 'my', callerSystemId: PD_A });
  expect(resolveWorkbenchProgramScope).toHaveBeenCalledWith({ callerSystemId: PD_A, programId: PROGRAM });
  const query = grantRequestAdapter.queryAllRequests.mock.calls[0][0];
  expect(query.filter).toContain('wmkf_meetingdate ge 2026-12-01T00:00:00Z');
  expect(query.filter).toContain(`_wmkf_grantprogram_value eq ${PROGRAM}`);
  expect(query.filter).toContain(buildVisibilityFilter(false));
  expect(query.filter).toContain(`_wmkf_programdirector_value eq ${PD_A}`);
});

it('all-PDs removes only the lead-PD predicate and retains request-first documentless rows', async () => {
  grantRequestAdapter.queryAllRequests.mockResolvedValue({ records: [
    req(R1, { _wmkf_currentpresitevisit_value: 'writeup-1' }),
    req(R2, { _wmkf_grantprogram_value: PROGRAM, _wmkf_programdirector_value: PD_B }),
  ], capped: false });
  requestDocumentAdapter.findByRequests.mockImplementation(async (_ids, { artifactType }) => ({
    records: artifactType === REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_RESEARCH_PRESENTATION_BRIEF
      ? [] : [doc('writeup-1', R1)],
    capped: false,
  }));
  const result = await list({ scope: 'all' });
  const query = grantRequestAdapter.queryAllRequests.mock.calls[0][0];
  expect(query.filter).not.toContain('_wmkf_programdirector_value');
  expect(query.filter).toContain(`_wmkf_grantprogram_value eq ${PROGRAM}`);
  expect(query.filter).toContain(buildVisibilityFilter(false));
  expect(result.artifacts.map((item) => item.requestId)).toEqual([R1, R2]);
  expect(result.artifacts[1].writeup).toMatchObject({ availability: 'missing', file: null });
  expect(result.requestCounts).toEqual({ total: 2, ordinary: 2, test: 0 });
});

it('does not promote an orphaned Ready Word row or a broken pointer to the current writeup', async () => {
  grantRequestAdapter.queryAllRequests.mockResolvedValue({
    records: [req(R1, { _wmkf_currentpresitevisit_value: 'missing-pointer' })], capped: false,
  });
  requestDocumentAdapter.findByRequests.mockResolvedValue({ records: [doc('orphan-ready', R1)], capped: false });
  const result = await list();
  expect(result.artifacts[0].writeup).toMatchObject({ availability: 'unavailable', file: null, artifactId: 'missing-pointer' });
});

it('marks schedule duplicates ambiguous and requires a valid end before reporting due', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-12-02T00:00:00Z'));
  siteVisitAdapter.findSummariesByRequests.mockResolvedValue({ records: [
    { _regardingobjectid_value: R1, activityid: 'v1', statecode: 1, statuscode: 2, scheduledstart: '2026-12-01T17:00:00Z', scheduledend: '2026-12-01T18:00:00Z' },
    { _regardingobjectid_value: R2, activityid: 'v2', statecode: 3, statuscode: 3, scheduledstart: '2026-12-01T17:00:00Z', scheduledend: null },
    { _regardingobjectid_value: R2, activityid: 'v3', statecode: 1, statuscode: 2, scheduledend: '2026-12-01T18:00:00Z' },
  ], capped: false });
  const result = await list();
  expect(result.artifacts[0].preparation).toMatchObject({ due: true });
  expect(result.artifacts[1].timing.availability).toBe('ambiguous');
  expect(result.artifacts[1].preparation.due).toBe(false);
});

it('does not show a prepared receipt as current when its document no longer matches the request pointer', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-12-02T00:00:00Z'));
  grantRequestAdapter.queryAllRequests.mockResolvedValue({
    records: [req(R1, { _wmkf_currentpresitevisit_value: 'writeup-current' })], capped: false,
  });
  requestDocumentAdapter.findByRequests.mockResolvedValue({ records: [doc('writeup-current', R1)], capped: false });
  siteVisitAdapter.findSummariesByRequests.mockResolvedValue({ records: [{
    _regardingobjectid_value: R1, activityid: 'visit-current', statecode: 1, statuscode: 2,
    scheduledend: '2026-12-01T18:00:00Z',
  }], capped: false });
  listPreparationsForSchedules.mockResolvedValue(new Map([[R1, {
    state: 'prepared', siteVisitId: 'visit-current', scheduledEndIso: '2026-12-01T18:00:00Z',
    documentId: 'writeup-old', errorCode: null,
  }]]));
  const result = await list();
  expect(result.artifacts[0].preparation).toMatchObject({
    state: 'blocked', documentId: null, errorCode: 'document_pointer_changed',
  });
});

it('fails closed on an unclassified Site Visit state/status pair', async () => {
  delete process.env.STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS;
  siteVisitAdapter.findSummariesByRequests.mockResolvedValue({ records: [
    { _regardingobjectid_value: R1, activityid: 'v1', statecode: 0, statuscode: 1, scheduledend: '2026-12-01T18:00:00Z' },
  ], capped: false });
  const result = await list();
  expect(result.artifacts[0]).toMatchObject({
    timing: { availability: 'unavailable' },
    preparation: { due: false, state: 'none', availability: 'available' },
  });
});

it('preserves request identity when the sharing ledger, schedule, or materials read is unavailable', async () => {
  sentSourceDocumentIds.mockRejectedValueOnce(new Error('ledger down'));
  getDeliberationScheduleByRequestsWithAvailability.mockResolvedValueOnce({
    schedules: new Map([[R1, null], [R2, null]]),
    availability: new Map([[R1, 'unavailable'], [R2, 'unavailable']]),
  });
  getMaterialsSummaryByRequestsWithAvailability.mockResolvedValueOnce({
    summaries: new Map([[R1, null], [R2, null]]),
    availability: new Map([[R1, 'unavailable'], [R2, 'unavailable']]),
  });
  const result = await list();
  expect(result.artifacts).toHaveLength(2);
  expect(result.artifacts[0]).toMatchObject({ sharingAvailability: 'unavailable', sessionAvailability: 'unavailable', materialsAvailability: 'unavailable' });
});

it('fails closed when a request or document projection is capped', async () => {
  grantRequestAdapter.queryAllRequests.mockResolvedValueOnce({ records: [], capped: true });
  await expect(list()).rejects.toMatchObject({ httpStatus: 503, code: 'staff_deliberations_requests_capped' });
  grantRequestAdapter.queryAllRequests.mockResolvedValueOnce({ records: [req(R1)], capped: false });
  requestDocumentAdapter.findByRequests.mockResolvedValueOnce({ records: [], capped: true });
  await expect(list()).rejects.toMatchObject({ httpStatus: 503, code: 'staff_deliberations_documents_capped' });
});

it('uses only the authenticated lead-PD identity and returns empty when it is unavailable', async () => {
  const result = await list({ scope: 'my', callerSystemId: null });
  expect(result.artifacts).toEqual([]);
  expect(grantRequestAdapter.queryAllRequests).not.toHaveBeenCalled();
});

it('keeps the briefing and working writeup identities independent', async () => {
  grantRequestAdapter.queryAllRequests.mockResolvedValue({ records: [
    req(R1, { _wmkf_currentprerpbrief_value: 'brief-1', _wmkf_currentpresitevisit_value: 'writeup-1' }),
  ], capped: false });
  requestDocumentAdapter.findByRequests.mockImplementation(async (_ids, { artifactType }) => ({
    records: artifactType === REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_RESEARCH_PRESENTATION_BRIEF
      ? [{ ...doc('brief-1', R1), wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_RESEARCH_PRESENTATION_BRIEF, wmkf_contenttype: PRE_RP_BRIEF_CONTRACT.contentType }]
      : [doc('writeup-1', R1)],
    capped: false,
  }));
  const result = await list();
  expect(result.artifacts[0].brief.artifactId).toBe('brief-1');
  expect(result.artifacts[0].writeup.artifactId).toBe('writeup-1');
});

it('projects a committed group-review Final row using its real Review lifecycle', async () => {
  grantRequestAdapter.queryAllRequests.mockResolvedValue({ records: [req(R1, {
    _wmkf_currentpresitevisit_value: 'writeup-1',
    _wmkf_currentfinalwriteup_value: 'final-1',
  })], capped: false });
  const source = doc('writeup-1', R1, {
    wmkf_lifecyclestate: L.FINAL,
    wmkf_sharepointdriveid: 'drive-1',
    wmkf_sharepointitemid: 'item-1',
  });
  const final = {
    ...doc('final-1', R1, {
      wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP,
      wmkf_lifecyclestate: L.REVIEW,
      wmkf_sharepointdriveid: 'drive-1',
      wmkf_sharepointitemid: 'item-1',
      wmkf_sharepointversionid: '2.0',
      wmkf_groupreviewstartedat: '2026-12-02T00:00:00Z',
      _wmkf_groupreviewstartedby_value: PD_A,
      _wmkf_sourcedocument_value: 'writeup-1',
    }),
  };
  requestDocumentAdapter.findByRequests.mockImplementation(async (_ids, { artifactType }) => ({
    records: artifactType === REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_RESEARCH_PRESENTATION_BRIEF ? []
      : artifactType === REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP ? [final] : [source],
    capped: false,
  }));
  const result = await list();
  expect(result.artifacts[0].finalReview).toMatchObject({ availability: 'available', phase: 'group-review', artifactId: 'final-1' });
  expect(result.artifacts[0].finalPhase).toBe('group-review');
});

it('selects and returns the PI for rows with and without a current document', async () => {
  grantRequestAdapter.queryAllRequests.mockResolvedValue({ records: [
    req(R1, { _wmkf_currentpresitevisit_value: 'writeup-1', _wmkf_projectleader_value_formatted: 'PI One' }),
    req(R2, { _wmkf_projectleader_value_formatted: 'PI Two' }),
  ], capped: false });
  requestDocumentAdapter.findByRequests.mockImplementation(async (_ids, { artifactType }) => ({
    records: artifactType === REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_RESEARCH_PRESENTATION_BRIEF
      ? [] : [doc('writeup-1', R1)],
    capped: false,
  }));
  const result = await list({ scope: 'all' });
  expect(grantRequestAdapter.queryAllRequests.mock.calls[0][0].select).toContain('_wmkf_projectleader_value');
  expect(result.artifacts.map((item) => item.projectLeader)).toEqual(['PI One', 'PI Two']);
});

it('reports due as waiting only for requests active automation would scan', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-12-02T00:00:00Z'));
  const env = {
    STAFF_DELIBERATIONS_AUTO_PREPARE: 'on',
    STAFF_DELIBERATIONS_AUTO_PREPARE_PROGRAM_IDS: JSON.stringify([PROGRAM]),
    STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES: JSON.stringify(['D26']),
    STAFF_DELIBERATIONS_AUTO_PREPARE_REQUEST_STATUSES: JSON.stringify(['Phase II Pending']),
    STAFF_DELIBERATIONS_AUTO_PREPARE_ATOMIC_FENCE_CONFIRMED: 'on',
    STAFF_DELIBERATIONS_AUTO_PREPARE_EXCLUDED_REQUEST_NUMBERS: JSON.stringify(['1003001']),
    GUARDED_REOPEN_SCHEMA_READY: 'on',
    TEST_REQUEST_ISOLATION: 'on',
  };
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    const eligible = { akoya_requeststatus: 'Phase II Pending', wmkf_meetingdate: '2026-12-10T00:00:00Z', wmkf_istestrequest: false, wmkf_testcreationrunid: null };
    grantRequestAdapter.queryAllRequests.mockResolvedValue({ records: [req(R1, eligible), req(R2, eligible)], capped: false });
    siteVisitAdapter.findSummariesByRequests.mockResolvedValue({ records: [
      { _regardingobjectid_value: R1, activityid: 'v1', statecode: 1, statuscode: 2, scheduledend: '2026-12-01T18:00:00Z' },
      { _regardingobjectid_value: R2, activityid: 'v2', statecode: 1, statuscode: 2, scheduledend: '2026-12-01T18:00:00Z' },
    ], capped: false });
    const result = await list();
    const byNumber = Object.fromEntries(result.artifacts.map((row) => [row.requestNumber, row.preparation]));
    expect(byNumber['1002959']).toMatchObject({ due: true, state: 'due', automationActive: true });
    expect(byNumber['1003001']).toMatchObject({ due: true, state: 'disabled', automationActive: true });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
