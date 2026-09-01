/** @jest-environment node */

import {
  FINAL_WRITEUPS_DASHBOARD_MAX_ROWS,
  loadFinalWriteupsDashboard,
} from '../../lib/services/final-writeup/dashboard-service.js';
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

function requestRow({ requestId, requestNumber, finalId, pdId, pdName, programId = RESEARCH_PROGRAM_ID, programName = 'Research' }) {
  return {
    akoya_requestid: requestId,
    akoya_requestnum: requestNumber,
    akoya_title: `Proposal ${requestNumber}`,
    wmkf_meetingdate: '2026-12-11T00:00:00Z',
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
    queryRequests: jest.fn(async () => ({
      records: requests,
      totalCount: requests.length,
      hasMore: false,
    })),
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

test('enabled Program Director lens keeps group review plus own stewardship and excludes other leadership rows', async () => {
  const { dependencies } = harness();
  dependencies.resolvePersonas.mockResolvedValue({ enabled: true, personas: ['program-director'] });

  const result = await loadFinalWriteupsDashboard({ actingUserSystemId: ACTOR_ID }, dependencies);

  expect(result.counts).toEqual({ total: 2, open: 1, history: 0, stewardship: 1 });
  expect(result.queues.open.map((row) => row.requestId)).toEqual([REQUEST_A_ID]);
  expect(result.queues.stewardship.map((row) => row.requestId)).toEqual([REQUEST_C_ID]);
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

test('fails loudly instead of silently truncating the dashboard', async () => {
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
      },
    });
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
