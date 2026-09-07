/** @jest-environment node */

import {
  FINAL_WRITEUPS_DASHBOARD_MAX_ROWS,
  FINAL_WRITEUPS_DEFAULT_CYCLE_WALKBACK,
  isFinalWriteupCycleSelector,
  loadFinalWriteupsDashboard,
} from '../../lib/services/final-writeup/dashboard-service.js';
import { QUERY_ALL_REQUESTS_CAP } from '../../lib/dataverse/adapters/grant-request.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const ACTOR_ID = '10000000-0000-4000-8000-000000000001';
const PD_A_ID = '20000000-0000-4000-8000-000000000001';
const PD_B_ID = '20000000-0000-4000-8000-000000000002';
const REQUEST_A_ID = '30000000-0000-4000-8000-000000000001';
const REQUEST_B_ID = '30000000-0000-4000-8000-000000000002';
const REQUEST_C_ID = '30000000-0000-4000-8000-000000000003';
const FINAL_A_ID = '40000000-0000-4000-8000-000000000001';
const FINAL_B_ID = '40000000-0000-4000-8000-000000000002';
const FINAL_C_ID = '40000000-0000-4000-8000-000000000003';
const ACK_B_ID = '50000000-0000-4000-8000-000000000002';
const RESEARCH_PROGRAM_ID = '60000000-0000-4000-8000-000000000001';
const SOCAL_PROGRAM_ID = '60000000-0000-4000-8000-000000000002';

const D26 = '2026-12-11T00:00:00Z';
const J26 = '2026-06-04T00:00:00Z';
const D25 = '2025-12-10T00:00:00Z';
const J25 = '2025-06-05T00:00:00Z';

function requestRow({
  requestId, requestNumber, finalId, pdId, pdName, meetingDate = D26,
  programId = RESEARCH_PROGRAM_ID, programName = 'Research',
}) {
  return {
    akoya_requestid: requestId,
    akoya_requestnum: requestNumber,
    akoya_title: `Proposal ${requestNumber}`,
    wmkf_meetingdate: meetingDate,
    wmkf_organizationname: `Institution ${requestNumber}`,
    _wmkf_projectleader_value_formatted: `PI ${requestNumber}`,
    _wmkf_programdirector_value: pdId,
    _wmkf_programdirector_value_formatted: pdName,
    _wmkf_grantprogram_value: programId,
    _wmkf_grantprogram_value_formatted: programName,
    _wmkf_currentfinalwriteup_value: finalId,
  };
}

function finalRow({ requestId, finalId, version = '1.0', lifecycle = REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW }) {
  return {
    wmkf_requestdocumentid: finalId,
    _wmkf_request_value: requestId,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: lifecycle,
    wmkf_sharepointsiteid: 'site-1',
    wmkf_sharepointdriveid: 'drive-1',
    wmkf_sharepointitemid: `item-${finalId.slice(-1)}`,
    wmkf_sharepointweburl: `https://example.sharepoint.com/${finalId}`,
    wmkf_sharepointversionid: version,
  };
}

function acknowledgementRow() {
  return {
    wmkf_finalwriteupreviewacknowledgementid: ACK_B_ID,
    _wmkf_finaldocument_value: FINAL_B_ID,
    _wmkf_reviewer_value: ACTOR_ID,
    _wmkf_reviewer_value_formatted: 'Ada Reviewer',
    wmkf_sharepointdriveid: 'drive-1',
    wmkf_sharepointitemid: `item-${FINAL_B_ID.slice(-1)}`,
    wmkf_publicationversionid: '1.0',
    wmkf_acknowledgedetag: '"etag-1"',
    wmkf_sharepointlastmodified: '2026-08-30T12:00:00.000Z',
    wmkf_acknowledgedat: '2026-08-30T12:05:00.000Z',
    _etag: 'W/"1"',
  };
}

/**
 * Evaluate the exact OData filter shapes the service emits against a fixture
 * row, so a scoped read returns only rows inside the requested window.
 */
function matchesFilter(row, filter) {
  if (!filter.startsWith('_wmkf_currentfinalwriteup_value ne null')) {
    throw new Error(`unexpected filter: ${filter}`);
  }
  if (!row._wmkf_currentfinalwriteup_value) return false;
  const byId = filter.match(/akoya_requestid eq ([0-9a-f-]{36})/);
  if (byId) return row.akoya_requestid === byId[1];
  if (filter.includes('wmkf_meetingdate eq null')) return !row.wmkf_meetingdate;
  const window = filter.match(/wmkf_meetingdate ge (\S+) and wmkf_meetingdate lt (\S+)/);
  if (window) {
    if (!row.wmkf_meetingdate) return false;
    const at = Date.parse(row.wmkf_meetingdate);
    return at >= Date.parse(window[1]) && at < Date.parse(window[2]);
  }
  if (filter === '_wmkf_currentfinalwriteup_value ne null') {
    throw new Error('the dashboard must never issue an unscoped request read');
  }
  throw new Error(`unexpected filter: ${filter}`);
}

function scopedFilters(dependencies) {
  return dependencies.queryRequests.mock.calls.map(([options]) => options.filter);
}

function harness() {
  const requests = [
    requestRow({
      requestId: REQUEST_A_ID,
      requestNumber: '1001',
      finalId: FINAL_A_ID,
      pdId: PD_A_ID,
      pdName: 'Program Director A',
    }),
    requestRow({
      requestId: REQUEST_B_ID,
      requestNumber: '1002',
      finalId: FINAL_B_ID,
      pdId: PD_B_ID,
      pdName: 'Program Director B',
    }),
    requestRow({
      requestId: REQUEST_C_ID,
      requestNumber: '1003',
      finalId: FINAL_C_ID,
      pdId: ACTOR_ID,
      pdName: 'Ada Reviewer',
    }),
  ];
  const documents = [
    finalRow({ requestId: REQUEST_A_ID, finalId: FINAL_A_ID }),
    finalRow({
      requestId: REQUEST_B_ID,
      finalId: FINAL_B_ID,
      lifecycle: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
    }),
    finalRow({ requestId: REQUEST_C_ID, finalId: FINAL_C_ID }),
  ];
  const dependencies = {
    schemaReady: jest.fn(() => true),
    getReviewer: jest.fn(async () => ({
      systemuserid: ACTOR_ID,
      fullname: 'Ada Reviewer',
      isdisabled: false,
    })),
    resolvePersonas: jest.fn(async () => ({ enabled: false, personas: [] })),
    resolveMatrixAudiences: jest.fn(async () => ({
      mode: 'role-default',
      fallbackReviewers: [
        { reviewerId: ACTOR_ID, name: 'Ada Reviewer', initials: 'AR' },
        { reviewerId: PD_A_ID, name: 'Program Director A', initials: 'PA' },
        { reviewerId: PD_B_ID, name: 'Program Director B', initials: 'PB' },
      ],
      programs: [],
    })),
    queryAllRequests: jest.fn(async () => ({
      records: requests.filter((row) => row._wmkf_currentfinalwriteup_value).map((row) => ({
        akoya_requestid: row.akoya_requestid,
        akoya_requestnum: row.akoya_requestnum,
        wmkf_meetingdate: row.wmkf_meetingdate,
      })),
      totalCount: requests.filter((row) => row._wmkf_currentfinalwriteup_value).length,
      capped: false,
    })),
    queryRequests: jest.fn(async ({ filter }) => {
      const matching = requests.filter((row) => matchesFilter(row, filter));
      return { records: matching, totalCount: matching.length, hasMore: false };
    }),
    findDocumentsByIds: jest.fn(async (ids) => ({
      records: documents.filter((row) => ids.includes(row.wmkf_requestdocumentid)),
      totalCount: ids.length,
      capped: false,
    })),
    findAcknowledgementsByFinalDocuments: jest.fn(async (ids) => ({
      records: ids.includes(FINAL_B_ID) ? [acknowledgementRow()] : [],
      totalCount: ids.includes(FINAL_B_ID) ? 1 : 0,
      capped: false,
    })),
    getFileMetadataById: jest.fn(async (_driveId, itemId) => ({
      driveId: 'drive-1',
      id: itemId,
      versionId: itemId.endsWith('2') ? '2.0' : '1.0',
      eTag: itemId.endsWith('2') ? '"etag-2"' : '"etag-1"',
      lastModified: itemId.endsWith('2')
        ? '2026-08-31T12:00:00.000Z'
        : '2026-08-30T12:00:00.000Z',
      webUrl: `https://example.sharepoint.com/${itemId}`,
    })),
  };
  return { dependencies, requests, documents };
}

test('derives open, reviewed-history, and responsible-PD stewardship queues server-side', async () => {
  const { dependencies } = harness();
  const result = await loadFinalWriteupsDashboard({
    actingUserSystemId: ACTOR_ID,
  }, dependencies);

  expect(result.counts).toEqual({ total: 3, open: 1, history: 1, stewardship: 1 });
  expect(result.queues.open[0]).toMatchObject({
    requestId: REQUEST_A_ID,
    relationship: 'reviewer',
    personalState: 'unreviewed',
    primaryAction: { key: 'review', label: 'Open review' },
  });
  expect(result.queues.history[0]).toMatchObject({
    requestId: REQUEST_B_ID,
    personalState: 'updated',
    stage: { key: 'leadership-review', label: 'Leadership review' },
  });
  expect(result.queues.stewardship[0]).toMatchObject({
    requestId: REQUEST_C_ID,
    relationship: 'responsible-pd',
    personalState: 'not-applicable',
    mayAcknowledge: false,
    primaryAction: { key: 'edit', label: 'Edit in Word' },
  });
  expect(result.queues.open[0]).not.toHaveProperty('grantProgram');
  expect(result.viewer).not.toHaveProperty('personaWarnings');
  expect(dependencies.findDocumentsByIds).toHaveBeenCalledTimes(1);
  expect(dependencies.findAcknowledgementsByFinalDocuments).toHaveBeenCalledTimes(1);
  expect(dependencies.getFileMetadataById).toHaveBeenCalledTimes(3);
});

test('superuser index includes the complete neutral coordinator matrix', async () => {
  const { dependencies } = harness();
  const result = await loadFinalWriteupsDashboard({
    actingUserSystemId: ACTOR_ID,
    isSuperuser: true,
  }, dependencies);

  expect(result.viewer).toMatchObject({ isSuperuser: true, personas: [], personaLensesEnabled: false });
  expect(result.coordinatorMatrix.mode).toBe('role-default');
  expect(result.coordinatorMatrix.groups).toHaveLength(1);
  expect(result.coordinatorMatrix.groups[0].reviewers.map((reviewer) => reviewer.name)).toEqual([
    'Ada Reviewer',
    'Program Director A',
    'Program Director B',
  ]);
  expect(result.coordinatorMatrix.groups[0].rows).toHaveLength(3);
  expect(result.coordinatorMatrix.groups[0].rows[0].cells).toEqual([
    { reviewerId: ACTOR_ID, state: 'unreviewed', acknowledgedAt: null },
    { reviewerId: PD_A_ID, state: 'not-applicable', acknowledgedAt: null },
    { reviewerId: PD_B_ID, state: 'unreviewed', acknowledgedAt: null },
  ]);
  expect(result.coordinatorMatrix.groups[0].rows[1].cells[0]).toMatchObject({
    reviewerId: ACTOR_ID,
    state: 'updated',
    acknowledgedAt: '2026-08-30T12:05:00.000Z',
  });
});

test('ordinary and focused responses do not load or expose the coordinator matrix', async () => {
  const ordinary = harness();
  const ordinaryResult = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, ordinary.dependencies);
  expect(ordinaryResult.coordinatorMatrix).toBeNull();
  expect(ordinary.dependencies.resolveMatrixAudiences).not.toHaveBeenCalled();

  const focused = harness();
  const focusedResult = await loadFinalWriteupsDashboard({
    actingUserSystemId: ACTOR_ID,
    selectedRequestId: REQUEST_A_ID,
    isSuperuser: true,
  }, focused.dependencies);
  expect(focusedResult.coordinatorMatrix).toBeNull();
  expect(focused.dependencies.resolveMatrixAudiences).not.toHaveBeenCalled();
});

test('enabled Program Coordinator lens keeps all active rows and receives the neutral matrix', async () => {
  const { dependencies } = harness();
  dependencies.resolvePersonas.mockResolvedValue({
    enabled: true,
    personas: ['program-coordinator'],
    warnings: ['final_writeup_persona_stale_assignments_pruned'],
  });

  const result = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, dependencies);

  expect(result.counts).toEqual({ total: 3, open: 1, history: 1, stewardship: 1 });
  expect(result.viewer).toMatchObject({
    isSuperuser: false,
    personaLensesEnabled: true,
    personas: ['program-coordinator'],
    personaWarnings: ['final_writeup_persona_stale_assignments_pruned'],
  });
  expect(result.coordinatorMatrix).not.toBeNull();
  expect(dependencies.resolveMatrixAudiences).toHaveBeenCalledTimes(1);
});

test('enabled Leadership lens includes only leadership-stage rows', async () => {
  const { dependencies } = harness();
  dependencies.resolvePersonas.mockResolvedValue({ enabled: true, personas: ['leadership'] });

  const result = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, dependencies);

  expect(result.counts).toEqual({ total: 1, open: 0, history: 1, stewardship: 0 });
  expect(result.queues.history.map((row) => row.requestId)).toEqual([REQUEST_B_ID]);
  expect(result.coordinatorMatrix).toBeNull();
});

test("enabled Program Director lens retains every row, including other PDs' leadership-stage writeups", async () => {
  const { dependencies } = harness();
  dependencies.resolvePersonas.mockResolvedValue({ enabled: true, personas: ['program-director'] });

  const result = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, dependencies);

  // Request B is another PD's writeup already in leadership review; it must not disappear.
  expect(result.counts).toEqual({ total: 3, open: 1, history: 1, stewardship: 1 });
  expect(result.queues.open.map((row) => row.requestId)).toEqual([REQUEST_A_ID]);
  expect(result.queues.history[0]).toMatchObject({
    requestId: REQUEST_B_ID,
    stage: { key: 'leadership-review', label: 'Leadership review' },
  });
  expect(result.queues.stewardship.map((row) => row.requestId)).toEqual([REQUEST_C_ID]);
  expect(result.coordinatorMatrix).toBeNull();
});

test('enabled multi-persona visibility is a union and an unassigned viewer fails closed', async () => {
  const overlapping = harness();
  overlapping.dependencies.resolvePersonas.mockResolvedValue({
    enabled: true,
    personas: ['program-director', 'leadership'],
  });
  const overlapResult = await loadFinalWriteupsDashboard(
    { actingUserSystemId: ACTOR_ID },
    overlapping.dependencies,
  );
  expect(overlapResult.counts.total).toBe(3);

  const unassigned = harness();
  unassigned.dependencies.resolvePersonas.mockResolvedValue({ enabled: true, personas: [] });
  const unassignedResult = await loadFinalWriteupsDashboard(
    { actingUserSystemId: ACTOR_ID },
    unassigned.dependencies,
  );
  expect(unassignedResult.counts).toEqual({ total: 0, open: 0, history: 0, stewardship: 0 });
  expect(unassignedResult.coordinatorMatrix).toBeNull();
});

test('focused reads fail closed when the selected row is outside the enabled persona lens', async () => {
  const { dependencies } = harness();
  dependencies.resolvePersonas.mockResolvedValue({ enabled: true, personas: ['leadership'] });

  await expect(loadFinalWriteupsDashboard({
    actingUserSystemId: ACTOR_ID,
    selectedRequestId: REQUEST_A_ID,
  }, dependencies)).rejects.toMatchObject({
    httpStatus: 404,
    body: { code: 'final_writeups_dashboard_request_not_found' },
  });
});

test('superuser matrix propagates malformed configured-audience failures', async () => {
  const { dependencies } = harness();
  dependencies.resolveMatrixAudiences.mockRejectedValue(Object.assign(new Error('invalid audience'), {
    httpStatus: 503,
    body: { code: 'final_writeup_staffing_config_invalid' },
  }));
  await expect(loadFinalWriteupsDashboard({
    actingUserSystemId: ACTOR_ID,
    isSuperuser: true,
  }, dependencies)).rejects.toMatchObject({
    httpStatus: 503,
    body: { code: 'final_writeup_staffing_config_invalid' },
  });
});

test('configured audiences create separate program matrices and call out unconfigured rows', async () => {
  const { dependencies, requests } = harness();
  requests[1]._wmkf_grantprogram_value = SOCAL_PROGRAM_ID;
  requests[1]._wmkf_grantprogram_value_formatted = 'Southern California';
  dependencies.resolveMatrixAudiences.mockResolvedValue({
    mode: 'configured',
    fallbackReviewers: null,
    programs: [{
      grantProgramId: RESEARCH_PROGRAM_ID,
      reviewers: [
        { reviewerId: ACTOR_ID, name: 'Ada Reviewer', initials: 'AR' },
        { reviewerId: PD_A_ID, name: 'Program Director A', initials: 'PA' },
      ],
    }],
  });

  const result = await loadFinalWriteupsDashboard({
    actingUserSystemId: ACTOR_ID,
    isSuperuser: true,
  }, dependencies);

  expect(result.coordinatorMatrix.mode).toBe('configured');
  expect(result.coordinatorMatrix.groups).toHaveLength(1);
  expect(result.coordinatorMatrix.groups[0]).toMatchObject({
    grantProgramId: RESEARCH_PROGRAM_ID,
    grantProgramName: 'Research',
  });
  expect(result.coordinatorMatrix.groups[0].reviewers.map((reviewer) => reviewer.name)).toEqual([
    'Ada Reviewer',
    'Program Director A',
  ]);
  expect(result.coordinatorMatrix.groups[0].rows.map((row) => row.requestNumber)).toEqual(['1001', '1003']);
  expect(result.coordinatorMatrix.unconfiguredRows).toEqual([
    expect.objectContaining({
      requestNumber: '1002',
      grantProgramId: SOCAL_PROGRAM_ID,
      grantProgramName: 'Southern California',
    }),
  ]);
});

test('keeps a later Word version in reviewed history and labels freshness separately', async () => {
  const { dependencies } = harness();
  const result = await loadFinalWriteupsDashboard({
    actingUserSystemId: ACTOR_ID,
    selectedRequestId: REQUEST_B_ID,
  }, dependencies);
  expect(result.selected.bucket).toBe('history');
  expect(result.selected.personalState).toBe('updated');
  expect(result.selected.acknowledgedAt).toBe('2026-08-30T12:05:00.000Z');
  expect(result.navigation).toEqual({ previous: null, next: null });
});

test('schema-off and missing actor fail before any request or Graph read', async () => {
  const { dependencies } = harness();
  dependencies.schemaReady.mockReturnValue(false);
  await expect(loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, dependencies))
    .rejects.toMatchObject({
      httpStatus: 503,
      body: { code: 'final_writeups_dashboard_schema_not_ready' },
    });
  expect(dependencies.queryRequests).not.toHaveBeenCalled();

  dependencies.schemaReady.mockReturnValue(true);
  await expect(loadFinalWriteupsDashboard({ actingUserSystemId: null }, dependencies))
    .rejects.toMatchObject({
      httpStatus: 403,
      body: { code: 'final_writeups_dashboard_actor_required' },
    });
  expect(dependencies.getFileMetadataById).not.toHaveBeenCalled();
});

test('fails loudly instead of silently truncating the dashboard, naming the oversized cycle', async () => {
  const { dependencies } = harness();
  dependencies.queryRequests.mockResolvedValue({
    records: [],
    totalCount: FINAL_WRITEUPS_DASHBOARD_MAX_ROWS + 1,
    hasMore: true,
  });
  await expect(loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, dependencies))
    .rejects.toMatchObject({
      httpStatus: 503,
      body: {
        code: 'final_writeups_dashboard_scope_exceeded',
        maximumRows: FINAL_WRITEUPS_DASHBOARD_MAX_ROWS,
        cycleCode: 'D26',
      },
    });
  expect(scopedFilters(dependencies)).toEqual([
    '_wmkf_currentfinalwriteup_value ne null and wmkf_meetingdate ge 2026-12-01T00:00:00Z and wmkf_meetingdate lt 2027-01-01T00:00:00Z',
  ]);
  expect(dependencies.findDocumentsByIds).not.toHaveBeenCalled();
  expect(dependencies.getFileMetadataById).not.toHaveBeenCalled();
});

test('selected request must identify a projected current Final row', async () => {
  const { dependencies } = harness();
  const missingId = '30000000-0000-4000-8000-000000000099';
  await expect(loadFinalWriteupsDashboard({
    actingUserSystemId: ACTOR_ID,
    selectedRequestId: missingId,
  }, dependencies)).rejects.toMatchObject({
    httpStatus: 404,
    body: { code: 'final_writeups_dashboard_request_not_found' },
  });
});

describe('cycle scoping (Slice 6A)', () => {
  const REQUEST_D_ID = '30000000-0000-4000-8000-000000000004';
  const FINAL_D_ID = '40000000-0000-4000-8000-000000000004';
  const REQUEST_E_ID = '30000000-0000-4000-8000-000000000005';
  const FINAL_E_ID = '40000000-0000-4000-8000-000000000005';
  const REQUEST_F_ID = '30000000-0000-4000-8000-000000000006';
  const FINAL_F_ID = '40000000-0000-4000-8000-000000000006';

  function addRequest(fixture, { requestId, finalId, requestNumber, meetingDate, pdId = PD_A_ID, lifecycle }) {
    fixture.requests.push(requestRow({
      requestId, finalId, requestNumber, pdId, pdName: 'Another PD', meetingDate,
    }));
    fixture.documents.push(finalRow({ requestId, finalId, lifecycle }));
  }

  test('accepts real cycle codes and the none sentinel only', () => {
    expect(isFinalWriteupCycleSelector('D26')).toBe(true);
    expect(isFinalWriteupCycleSelector('j25')).toBe(true);
    expect(isFinalWriteupCycleSelector('none')).toBe(true);
    for (const value of ['NONE', 'X26', '', null, undefined, 'D2026', 'D 26']) {
      expect(isFinalWriteupCycleSelector(value)).toBe(false);
    }
  });

  test('scopes the request query to the selected cycle and returns the available cycle list without counts', async () => {
    const fixture = harness();
    addRequest(fixture, { requestId: REQUEST_D_ID, finalId: FINAL_D_ID, requestNumber: '0999', meetingDate: J26 });
    const result = await loadFinalWriteupsDashboard({
      actingUserSystemId: ACTOR_ID, cycleCode: 'j26',
    }, fixture.dependencies);

    expect(result.cycles).toEqual({
      selected: 'J26',
      available: [{ code: 'D26', label: 'December 2026' }, { code: 'J26', label: 'June 2026' }],
      hasUncycled: false,
      defaultResolvedBy: 'explicit',
    });
    expect(result.limits).toEqual({ maximumRows: FINAL_WRITEUPS_DASHBOARD_MAX_ROWS, scope: 'cycle' });
    expect(result.counts.total).toBe(1);
    expect(result.queues.open.map((row) => row.requestId)).toEqual([REQUEST_D_ID]);
    expect(result.queues.open.every((row) => row.cycleCode === 'J26')).toBe(true);
    expect(scopedFilters(fixture.dependencies)).toHaveLength(1);
    expect(fixture.dependencies.queryAllRequests).toHaveBeenCalledWith({
      select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate',
      filter: '_wmkf_currentfinalwriteup_value ne null',
      orderby: 'wmkf_meetingdate desc',
    });
    expect(JSON.stringify(result.cycles)).not.toMatch(/count/i);
  });

  test('defaults to the newest cycle with a current Final in one read', async () => {
    const fixture = harness();
    addRequest(fixture, { requestId: REQUEST_D_ID, finalId: FINAL_D_ID, requestNumber: '0999', meetingDate: J26 });
    const result = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, fixture.dependencies);
    expect(result.cycles.selected).toBe('D26');
    expect(result.cycles.defaultResolvedBy).toBe('visible');
    expect(result.counts.total).toBe(3);
    expect(scopedFilters(fixture.dependencies)).toHaveLength(1);
  });

  test('a well-formed cycle absent from the list succeeds empty; no cycles at all yields a null selection', async () => {
    const fixture = harness();
    const result = await loadFinalWriteupsDashboard({
      actingUserSystemId: ACTOR_ID, cycleCode: 'J25',
    }, fixture.dependencies);
    expect(result.cycles.selected).toBe('J25');
    expect(result.counts).toEqual({ total: 0, open: 0, history: 0, stewardship: 0 });

    const empty = harness();
    empty.requests.splice(0, empty.requests.length);
    const emptyResult = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, empty.dependencies);
    expect(emptyResult.cycles).toEqual({
      selected: null, available: [], hasUncycled: false, defaultResolvedBy: 'exhausted',
    });
    expect(scopedFilters(empty.dependencies)).toHaveLength(0);
  });

  test('counts null-meeting-date rows as uncycled and serves them under none, never in a real cycle', async () => {
    const fixture = harness();
    addRequest(fixture, { requestId: REQUEST_D_ID, finalId: FINAL_D_ID, requestNumber: '0999', meetingDate: null });

    const d26 = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID, cycleCode: 'D26' }, fixture.dependencies);
    expect(d26.cycles.hasUncycled).toBe(true);
    expect(d26.cycles.available).toEqual([{ code: 'D26', label: 'December 2026' }]);
    expect(d26.queues.open.map((row) => row.requestId)).not.toContain(REQUEST_D_ID);

    const none = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID, cycleCode: 'none' }, fixture.dependencies);
    expect(none.cycles.selected).toBe('none');
    expect(none.queues.open.map((row) => row.requestId)).toEqual([REQUEST_D_ID]);
    expect(none.queues.open[0].cycleCode).toBeNull();
    expect(scopedFilters(fixture.dependencies).at(-1)).toBe(
      '_wmkf_currentfinalwriteup_value ne null and wmkf_meetingdate eq null',
    );
  });

  test('serves none as an empty success when no uncycled rows exist', async () => {
    const fixture = harness();
    const result = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID, cycleCode: 'none' }, fixture.dependencies);
    expect(result.cycles.hasUncycled).toBe(false);
    expect(result.cycles.selected).toBe('none');
    expect(result.counts.total).toBe(0);
  });

  test('fails loud on a current Final whose meeting date is not a June/December cycle, naming the request number', async () => {
    const fixture = harness();
    addRequest(fixture, { requestId: REQUEST_D_ID, finalId: FINAL_D_ID, requestNumber: '0999', meetingDate: '2026-03-15T00:00:00Z' });
    await expect(loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, fixture.dependencies))
      .rejects.toMatchObject({
        httpStatus: 500,
        body: { code: 'final_writeups_dashboard_cycle_invalid', requestNumber: '0999', requestId: REQUEST_D_ID },
      });
    expect(fixture.dependencies.queryRequests).not.toHaveBeenCalled();
    expect(fixture.dependencies.findDocumentsByIds).not.toHaveBeenCalled();

    const unnumbered = harness();
    addRequest(unnumbered, { requestId: REQUEST_D_ID, finalId: FINAL_D_ID, requestNumber: null, meetingDate: '2026-03-15T00:00:00Z' });
    await expect(loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, unnumbered.dependencies))
      .rejects.toMatchObject({ body: { error: expect.stringContaining(REQUEST_D_ID) } });
  });

  test('fails closed when the cycle list scan is capped', async () => {
    const fixture = harness();
    fixture.dependencies.queryAllRequests.mockResolvedValue({ records: [], totalCount: 0, capped: true });
    await expect(loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, fixture.dependencies))
      .rejects.toMatchObject({ httpStatus: 503, body: { code: 'final_writeups_dashboard_cycle_list_capped' } });
    expect(fixture.dependencies.queryRequests).not.toHaveBeenCalled();
  });

  test('warns once with final_writeups_dashboard_cycle_list_near_cap when the scan reaches half the export cap', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const half = QUERY_ALL_REQUESTS_CAP / 2;
      const scan = (count) => Array.from({ length: count }, (_, index) => ({
        akoya_requestid: REQUEST_A_ID, akoya_requestnum: String(index), wmkf_meetingdate: D26,
      }));
      const fixture = harness();
      fixture.dependencies.queryAllRequests.mockResolvedValue({ records: scan(half), totalCount: half, capped: false });
      await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, fixture.dependencies);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe('final_writeups_dashboard_cycle_list_near_cap');

      warn.mockClear();
      fixture.dependencies.queryAllRequests.mockResolvedValue({ records: scan(half - 1), totalCount: half - 1, capped: false });
      await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, fixture.dependencies);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test('a cleared current Final pointer drops the request and, if last, its cycle', async () => {
    const fixture = harness();
    addRequest(fixture, { requestId: REQUEST_D_ID, finalId: FINAL_D_ID, requestNumber: '0999', meetingDate: J26 });
    fixture.requests[3]._wmkf_currentfinalwriteup_value = null;
    const result = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, fixture.dependencies);
    expect(result.cycles.available.map((cycle) => cycle.code)).toEqual(['D26']);
  });

  describe('default walk-back', () => {
    // Fixture: D26 holds only group-review rows (hidden from Leadership), J26 holds one
    // leadership-stage row owned by another PD (visible to Leadership).
    function walkbackFixture() {
      const fixture = harness();
      fixture.documents[1].wmkf_lifecyclestate = REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW;
      addRequest(fixture, {
        requestId: REQUEST_D_ID, finalId: FINAL_D_ID, requestNumber: '0999', meetingDate: J26,
        lifecycle: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
      });
      return fixture;
    }

    test('the cycle list carries no counts and the default cycle is the newest visible within the walk-back window', async () => {
      const leadership = walkbackFixture();
      leadership.dependencies.resolvePersonas.mockResolvedValue({ enabled: true, personas: ['leadership'] });
      const result = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, leadership.dependencies);
      expect(result.cycles.available).toEqual([
        { code: 'D26', label: 'December 2026' },
        { code: 'J26', label: 'June 2026' },
      ]);
      expect(result.cycles.selected).toBe('J26');
      expect(result.cycles.defaultResolvedBy).toBe('visible');
      expect(result.counts.total).toBe(1);
      expect(result.queues.open.map((row) => row.requestId)).toEqual([REQUEST_D_ID]);
      expect(scopedFilters(leadership.dependencies)).toHaveLength(2);

      const superuser = walkbackFixture();
      const superResult = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID, isSuperuser: true }, superuser.dependencies);
      expect(superResult.cycles.selected).toBe('D26');
      expect(superResult.cycles.defaultResolvedBy).toBe('visible');
      expect(scopedFilters(superuser.dependencies)).toHaveLength(1);

      const pd = walkbackFixture();
      pd.dependencies.resolvePersonas.mockResolvedValue({ enabled: true, personas: ['program-director'] });
      const pdResult = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, pd.dependencies);
      expect(pdResult.cycles.selected).toBe('D26');
      expect(scopedFilters(pd.dependencies)).toHaveLength(1);
    });

    test('explicit cycleCode never walks back', async () => {
      const fixture = walkbackFixture();
      fixture.dependencies.resolvePersonas.mockResolvedValue({ enabled: true, personas: ['leadership'] });
      const result = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID, cycleCode: 'D26' }, fixture.dependencies);
      expect(result.cycles).toMatchObject({ selected: 'D26', defaultResolvedBy: 'explicit' });
      expect(result.counts.total).toBe(0);
      expect(scopedFilters(fixture.dependencies)).toHaveLength(1);
    });

    test('stops after the walk-back bound and shows the newest cycle empty as exhausted', async () => {
      const fixture = harness();
      fixture.documents[1].wmkf_lifecyclestate = REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW;
      addRequest(fixture, { requestId: REQUEST_D_ID, finalId: FINAL_D_ID, requestNumber: '0999', meetingDate: J26 });
      addRequest(fixture, { requestId: REQUEST_E_ID, finalId: FINAL_E_ID, requestNumber: '0998', meetingDate: D25 });
      addRequest(fixture, {
        requestId: REQUEST_F_ID, finalId: FINAL_F_ID, requestNumber: '0997', meetingDate: J25,
        lifecycle: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
      });
      fixture.dependencies.resolvePersonas.mockResolvedValue({ enabled: true, personas: ['leadership'] });
      const result = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, fixture.dependencies);
      expect(result.cycles.available.map((cycle) => cycle.code)).toEqual(['D26', 'J26', 'D25', 'J25']);
      expect(result.cycles.selected).toBe('D26');
      expect(result.cycles.defaultResolvedBy).toBe('exhausted');
      expect(result.counts.total).toBe(0);
      expect(scopedFilters(fixture.dependencies)).toHaveLength(FINAL_WRITEUPS_DEFAULT_CYCLE_WALKBACK);
    });

    test('stops when the list is exhausted before the bound', async () => {
      const fixture = harness();
      fixture.documents[1].wmkf_lifecyclestate = REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW;
      addRequest(fixture, { requestId: REQUEST_D_ID, finalId: FINAL_D_ID, requestNumber: '0999', meetingDate: J26 });
      fixture.dependencies.resolvePersonas.mockResolvedValue({ enabled: true, personas: ['leadership'] });
      const result = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, fixture.dependencies);
      expect(result.cycles).toMatchObject({ selected: 'D26', defaultResolvedBy: 'exhausted' });
      expect(scopedFilters(fixture.dependencies)).toHaveLength(2);
    });

    test('an oversized newest cycle fails closed with its cycle code before any walk-back read', async () => {
      const fixture = walkbackFixture();
      fixture.dependencies.resolvePersonas.mockResolvedValue({ enabled: true, personas: ['leadership'] });
      const realQuery = fixture.dependencies.queryRequests.getMockImplementation();
      fixture.dependencies.queryRequests.mockImplementation(async (options) => {
        if (options.filter.includes('2026-12-01')) {
          return { records: [], totalCount: FINAL_WRITEUPS_DASHBOARD_MAX_ROWS + 1, hasMore: true };
        }
        return realQuery(options);
      });
      await expect(loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, fixture.dependencies))
        .rejects.toMatchObject({
          httpStatus: 503,
          body: { code: 'final_writeups_dashboard_scope_exceeded', cycleCode: 'D26' },
        });
      expect(scopedFilters(fixture.dependencies)).toHaveLength(1);
    });

    test('a cycle containing only rows hidden from the viewer still appears in available with no count', async () => {
      const fixture = walkbackFixture();
      fixture.dependencies.resolvePersonas.mockResolvedValue({ enabled: true, personas: ['leadership'] });
      const result = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID, cycleCode: 'J26' }, fixture.dependencies);
      expect(result.cycles.available).toEqual([
        { code: 'D26', label: 'December 2026' },
        { code: 'J26', label: 'June 2026' },
      ]);
    });
  });

  describe('focused reads', () => {
    test('derive the cycle from the request and navigate within it', async () => {
      const fixture = harness();
      addRequest(fixture, { requestId: REQUEST_D_ID, finalId: FINAL_D_ID, requestNumber: '0999', meetingDate: J26 });
      addRequest(fixture, { requestId: REQUEST_E_ID, finalId: FINAL_E_ID, requestNumber: '0998', meetingDate: J26 });
      const result = await loadFinalWriteupsDashboard({
        actingUserSystemId: ACTOR_ID, selectedRequestId: REQUEST_D_ID,
      }, fixture.dependencies);
      expect(result.cycles).toMatchObject({ selected: 'J26', defaultResolvedBy: 'explicit' });
      expect(result.selected.requestId).toBe(REQUEST_D_ID);
      expect(result.navigation).toEqual({
        previous: { requestId: REQUEST_E_ID, requestNumber: '0998', title: 'Proposal 0998' },
        next: null,
      });
      expect(result.counts.total).toBe(2);
      const filters = scopedFilters(fixture.dependencies);
      expect(filters[0]).toBe(`_wmkf_currentfinalwriteup_value ne null and akoya_requestid eq ${REQUEST_D_ID}`);
      expect(filters[1]).toContain('2026-06-01');
    });

    test('reject cycleCode alongside requestId and a malformed selector before any read', async () => {
      const fixture = harness();
      await expect(loadFinalWriteupsDashboard({
        actingUserSystemId: ACTOR_ID, selectedRequestId: REQUEST_A_ID, cycleCode: 'D26',
      }, fixture.dependencies)).rejects.toMatchObject({ httpStatus: 400, body: { code: 'final_writeups_dashboard_cycle_with_request' } });
      await expect(loadFinalWriteupsDashboard({
        actingUserSystemId: ACTOR_ID, cycleCode: 'NONE',
      }, fixture.dependencies)).rejects.toMatchObject({ httpStatus: 400, body: { code: 'final_writeups_dashboard_cycle_selector_invalid' } });
      expect(fixture.dependencies.queryAllRequests).not.toHaveBeenCalled();
      expect(fixture.dependencies.queryRequests).not.toHaveBeenCalled();
    });

    test('a focused request without a meeting date is served under none', async () => {
      const fixture = harness();
      addRequest(fixture, { requestId: REQUEST_D_ID, finalId: FINAL_D_ID, requestNumber: '0999', meetingDate: null });
      const result = await loadFinalWriteupsDashboard({
        actingUserSystemId: ACTOR_ID, selectedRequestId: REQUEST_D_ID,
      }, fixture.dependencies);
      expect(result.cycles.selected).toBe('none');
      expect(result.selected.requestId).toBe(REQUEST_D_ID);
    });
  });
});
