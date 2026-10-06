/** @jest-environment node */
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ getById: jest.fn(), queryAllRequests: jest.fn() }));
import { getById } from '../../lib/dataverse/adapters/grant-request.js';
import { drainStaffDeliberationsPreparations, getPreparationForRequest, requestPreparationRetry, runFactoryTestStaffDeliberationsPreparation } from '../../lib/services/pre-site-visit/preparation-worker.js';
import { readPreparationConfig } from '../../lib/services/pre-site-visit/preparation-config.js';
import { REQUEST_DOCUMENT_LIFECYCLE_STATE as L, REQUEST_DOCUMENT_OPERATION_STATUS as O } from '../../shared/config/requestDocument.js';

const REQUEST = 'aaaaaaaa-0000-4000-8000-000000000001';
const PROGRAM = 'bbbbbbbb-0000-4000-8000-000000000001';
const VISIT = 'cccccccc-0000-4000-8000-000000000001';
const DOC = 'dddddddd-0000-4000-8000-000000000001';
const LEAD_PD = '99999999-0000-4000-8000-000000000001';
const END = '2026-12-01T18:00:00.000Z';
const MODIFIED = '2026-11-01T12:00:00.000Z';

const config = {
  active: true,
  programIds: [PROGRAM],
  cycleCodes: ['D26'],
  requestStatuses: ['Phase II Pending'],
  stateStatusPairs: [{ stateCode: 10, statusCode: 11, eligible: true }],
  batchSize: 1,
  blockedBy: [],
};

function harness({ currentArtifact = null, generatedArtifact = null } = {}) {
  const receipt = {
    id: 'eeeeeeee-0000-4000-8000-000000000001',
    lease_token: 'ffffffff-0000-4000-8000-000000000001',
    attempt_count: 1,
    request_id: REQUEST,
    program_id: PROGRAM,
    cycle_code: 'D26',
    site_visit_id: VISIT,
    scheduled_end: END,
    event_modified_on: MODIFIED,
    event_state_code: 10,
    event_status_code: 11,
    correction_epoch: '',
  };
  const dependencies = {
    config,
    now: () => new Date('2026-12-02T00:00:00.000Z'),
    queryRequests: jest.fn().mockResolvedValue({ records: [{
      akoya_requestid: REQUEST,
      akoya_requeststatus: 'Phase II Pending',
      wmkf_meetingdate: '2026-12-10T00:00:00Z',
      _wmkf_grantprogram_value: PROGRAM,
      _wmkf_programdirector_value: LEAD_PD,
    }], capped: false }),
    findSiteVisits: jest.fn().mockResolvedValue({ records: [{
      activityid: VISIT,
      _regardingobjectid_value: REQUEST,
      scheduledend: END,
      modifiedon: MODIFIED,
      statecode: 10,
      statuscode: 11,
    }], capped: false }),
    getRequest: jest.fn().mockResolvedValue({
      akoya_requestid: REQUEST,
      akoya_requeststatus: 'Phase II Pending',
      wmkf_meetingdate: '2026-12-10T00:00:00Z',
      _wmkf_grantprogram_value: PROGRAM,
      _wmkf_programdirector_value: LEAD_PD,
    }),
    getSiteVisit: jest.fn().mockResolvedValue({
      activityid: VISIT,
      _regardingobjectid_value: REQUEST,
      scheduledend: END,
      modifiedon: MODIFIED,
      statecode: 10,
      statuscode: 11,
    }),
    readArtifactStatus: jest.fn().mockResolvedValue({ currentArtifact }),
    generate: jest.fn().mockResolvedValue({ artifact: generatedArtifact }),
    promote: jest.fn().mockResolvedValue({ artifact: {
      artifactId: DOC, lifecycleState: L.REVIEW,
    } }),
    upsertReceipt: jest.fn().mockResolvedValue(receipt),
    claimReceipt: jest.fn().mockResolvedValue(receipt),
    finishReceipt: jest.fn().mockImplementation(async (_id, _token, outcome) => outcome),
    listReceipts: jest.fn().mockResolvedValue(new Map()),
  };
  return { dependencies, receipt };
}

it('stays disabled without entering the request scan when production automation is off', async () => {
  const { dependencies } = harness();
  dependencies.config = { ...config, active: false, blockedBy: ['feature_disabled'] };
  const result = await drainStaffDeliberationsPreparations(dependencies);
  expect(result).toMatchObject({ status: 'disabled', blockedBy: ['feature_disabled'] });
  expect(dependencies.queryRequests).not.toHaveBeenCalled();
  expect(dependencies.generate).not.toHaveBeenCalled();
});

it('preserves an existing edited draft, skips generation, and records service provenance', async () => {
  const currentArtifact = {
    artifactId: DOC,
    lifecycleState: L.DRAFT,
    operationStatus: O.READY,
    file: { itemId: 'same-word-item' },
  };
  const { dependencies } = harness({ currentArtifact });
  const result = await drainStaffDeliberationsPreparations(dependencies);
  expect(dependencies.generate).not.toHaveBeenCalled();
  expect(dependencies.promote).toHaveBeenCalledWith(expect.objectContaining({ expectedArtifactId: DOC }));
  expect(dependencies.finishReceipt).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
    state: 'prepared',
    documentId: DOC,
    provenance: expect.objectContaining({ principal: 'vercel-cron', documentId: DOC }),
  }));
  expect(result).toMatchObject({ prepared: 1, blocked: 0 });
  expect(dependencies.queryRequests.mock.calls[0][0].filter).toContain("akoya_requeststatus eq 'Phase II Pending'");
});

it('uses canonical OData escaping for allowlisted string statuses', async () => {
  const { dependencies } = harness();
  dependencies.config = { ...config, requestStatuses: ["Phase II O'Pending"] };
  await drainStaffDeliberationsPreparations(dependencies);
  expect(dependencies.queryRequests.mock.calls[0][0].filter)
    .toContain("akoya_requeststatus eq 'Phase II O''Pending'");
});

it('uses missing-only generation and promotes its returned current Word identity', async () => {
  const generatedArtifact = {
    artifactId: DOC,
    operationStatus: O.READY,
    lifecycleState: L.DRAFT,
  };
  const { dependencies } = harness({ generatedArtifact });
  await drainStaffDeliberationsPreparations(dependencies);
  expect(dependencies.generate).toHaveBeenCalledWith(expect.objectContaining({
    requestId: REQUEST,
    generationMode: 'missing-only',
    runSource: 'PowerAutomate Auto',
  }));
  expect(dependencies.promote).toHaveBeenCalledWith(expect.objectContaining({ expectedArtifactId: DOC }));
});

it('re-reads and preserves a concurrent manual missing-only activation after a specific 409', async () => {
  const concurrentDraft = {
    artifactId: DOC,
    operationStatus: O.READY,
    lifecycleState: L.DRAFT,
  };
  const { dependencies } = harness();
  dependencies.readArtifactStatus
    .mockResolvedValueOnce({ currentArtifact: null })
    .mockResolvedValueOnce({ currentArtifact: null })
    .mockResolvedValueOnce({ currentArtifact: concurrentDraft });
  dependencies.generate.mockRejectedValueOnce(Object.assign(new Error('manual generation won'), {
    status: 409,
    code: 'pre_site_visit_missing_only_current_exists',
  }));
  const result = await drainStaffDeliberationsPreparations(dependencies);
  expect(dependencies.generate).toHaveBeenCalledTimes(1);
  expect(dependencies.promote).toHaveBeenCalledWith(expect.objectContaining({ expectedArtifactId: DOC }));
  expect(result.prepared).toBe(1);
});

it('backs off for a matching generation still in flight after a missing-only race', async () => {
  const { dependencies } = harness();
  dependencies.readArtifactStatus
    .mockResolvedValueOnce({ currentArtifact: null })
    .mockResolvedValueOnce({ currentArtifact: null })
    .mockResolvedValueOnce({ currentArtifact: null, pendingArtifact: { artifactId: DOC } });
  dependencies.generate.mockRejectedValueOnce(Object.assign(new Error('generation already claimed'), {
    status: 409,
    code: 'pre_site_visit_missing_only_pending_conflict',
  }));
  await drainStaffDeliberationsPreparations(dependencies);
  expect(dependencies.promote).not.toHaveBeenCalled();
  expect(dependencies.finishReceipt).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
    state: 'pending', retryAfterMs: 30_000, errorCode: 'generation_in_progress',
  }));
});

it('will not automatically promote a staff correction epoch, even when the receipt was scanned after reopen', async () => {
  const currentArtifact = {
    artifactId: DOC,
    lifecycleState: L.DRAFT,
    operationStatus: O.READY,
    correction: { cycleId: 'staff-reopen-7' },
  };
  const { dependencies } = harness({ currentArtifact });
  const result = await drainStaffDeliberationsPreparations(dependencies);
  expect(dependencies.generate).not.toHaveBeenCalled();
  expect(dependencies.promote).not.toHaveBeenCalled();
  expect(dependencies.finishReceipt).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
    state: 'blocked', errorCode: 'correction_reopen_requires_staff',
  }));
  expect(result.blocked).toBe(1);
});

it('reconciles a completed staff-finished correction without clearing its lineage epoch', async () => {
  const currentArtifact = {
    artifactId: DOC,
    lifecycleState: L.REVIEW,
    operationStatus: O.READY,
    correction: { cycleId: 'staff-reopen-7' },
    file: { itemId: 'same-word-item', versionId: '8.0' },
    milestone: { versionId: '8.0', contentHash: 'a'.repeat(64), createdAt: '2026-12-02T01:00:00Z' },
  };
  const { dependencies } = harness({ currentArtifact });
  const result = await drainStaffDeliberationsPreparations(dependencies);
  expect(dependencies.promote).not.toHaveBeenCalled();
  expect(dependencies.generate).not.toHaveBeenCalled();
  expect(dependencies.upsertReceipt).toHaveBeenCalledWith(expect.objectContaining({
    correctionEpoch: 'staff-reopen-7',
    resumeCorrection: true,
  }));
  expect(dependencies.finishReceipt).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
    state: 'prepared',
    documentId: DOC,
    provenance: expect.objectContaining({ operation: 'reconciled-complete-handoff' }),
  }));
  expect(result.prepared).toBe(1);
});

it('repairs a lost receipt acknowledgement from an already completed Final milestone without re-stamping', async () => {
  const currentArtifact = {
    artifactId: DOC,
    lifecycleState: L.FINAL,
    operationStatus: O.READY,
    file: { versionId: 'v17' },
    milestone: { versionId: 'v17', contentHash: 'sha256:fixture', createdAt: '2026-12-01T18:05:00Z' },
  };
  const { dependencies } = harness({ currentArtifact });
  dependencies.findSiteVisits.mockResolvedValue({ records: [{
    activityid: VISIT,
    _regardingobjectid_value: REQUEST,
    scheduledend: '2026-12-01T18:00:00Z',
    modifiedon: '2026-12-02T00:30:00Z',
    statecode: 10,
    statuscode: 11,
  }] });
  const result = await drainStaffDeliberationsPreparations(dependencies);
  expect(dependencies.generate).not.toHaveBeenCalled();
  expect(dependencies.promote).not.toHaveBeenCalled();
  expect(dependencies.finishReceipt).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
    state: 'prepared', documentId: DOC,
    provenance: expect.objectContaining({ operation: 'reconciled-complete-handoff' }),
  }));
  expect(result).toMatchObject({ prepared: 1, blocked: 0 });
});

it('blocks ambiguous events and never starts generation', async () => {
  const { dependencies } = harness();
  dependencies.findSiteVisits.mockResolvedValue({ records: [
    { activityid: VISIT, _regardingobjectid_value: REQUEST, scheduledend: END, modifiedon: MODIFIED, statecode: 10, statuscode: 11 },
    { activityid: 'cccccccc-0000-4000-8000-000000000002', _regardingobjectid_value: REQUEST, scheduledend: END, modifiedon: MODIFIED, statecode: 99, statuscode: 99 },
  ] });
  const result = await drainStaffDeliberationsPreparations(dependencies);
  expect(dependencies.upsertReceipt).toHaveBeenCalledWith(expect.objectContaining({
    initialState: 'blocked', errorCode: 'schedule_requires_reconciliation',
  }));
  expect(dependencies.claimReceipt).toHaveBeenCalledTimes(1);
  expect(dependencies.generate).not.toHaveBeenCalled();
  expect(result.blocked).toBeGreaterThanOrEqual(1);
});

it('retries transient unknown outcomes and blocks nontransient failures', async () => {
  const { dependencies } = harness();
  dependencies.generate.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 503 }));
  await drainStaffDeliberationsPreparations(dependencies);
  expect(dependencies.finishReceipt).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ state: 'pending' }));
});

it('fails closed when correction lineage fields have not passed schema readiness', () => {
  const env = {
    STAFF_DELIBERATIONS_AUTO_PREPARE: 'on',
    STAFF_DELIBERATIONS_AUTO_PREPARE_PROGRAM_IDS: JSON.stringify([PROGRAM]),
    STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES: JSON.stringify(['D26']),
    STAFF_DELIBERATIONS_AUTO_PREPARE_REQUEST_STATUSES: JSON.stringify(['Phase II Pending']),
    STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS: JSON.stringify([[10, 11, true]]),
    STAFF_DELIBERATIONS_AUTO_PREPARE_ATOMIC_FENCE_CONFIRMED: 'on',
    TEST_REQUEST_ISOLATION: 'on',
  };
  expect(readPreparationConfig(env)).toMatchObject({ active: false, blockedBy: expect.arrayContaining(['correction_schema_not_ready']) });
  env.GUARDED_REOPEN_SCHEMA_READY = 'on';
  expect(readPreparationConfig(env).active).toBe(true);
});

it('keeps automation disabled before any worker reads when test-request isolation is off', async () => {
  const env = {
    NODE_ENV: 'test',
    STAFF_DELIBERATIONS_AUTO_PREPARE: 'on',
    STAFF_DELIBERATIONS_AUTO_PREPARE_PROGRAM_IDS: JSON.stringify([PROGRAM]),
    STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES: JSON.stringify(['D26']),
    STAFF_DELIBERATIONS_AUTO_PREPARE_REQUEST_STATUSES: JSON.stringify(['Phase II Pending']),
    STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS: JSON.stringify([[10, 11, true]]),
    STAFF_DELIBERATIONS_AUTO_PREPARE_ATOMIC_FENCE_CONFIRMED: 'on',
    GUARDED_REOPEN_SCHEMA_READY: 'on',
  };
  const { dependencies } = harness();
  dependencies.config = readPreparationConfig(env);
  expect(dependencies.config).toMatchObject({
    active: false,
    blockedBy: expect.arrayContaining(['test_request_isolation_not_ready']),
  });
  const result = await drainStaffDeliberationsPreparations(dependencies);
  expect(result.status).toBe('disabled');
  expect(dependencies.queryRequests).not.toHaveBeenCalled();
  expect(dependencies.findSiteVisits).not.toHaveBeenCalled();
});

it('reports artifact lineage as unavailable instead of missing on detail read failure', async () => {
  const { dependencies } = harness();
  dependencies.listScheduleReceipts = jest.fn().mockResolvedValue(new Map());
  dependencies.readArtifactStatus.mockRejectedValue(new Error('registry unavailable'));
  const projection = await getPreparationForRequest(REQUEST, dependencies);
  expect(projection.writeup).toMatchObject({ availability: 'unavailable', artifactId: null });
});

it('reports due detail as disabled when scheduled preparation is inactive', async () => {
  const { dependencies } = harness();
  dependencies.config = { ...config, active: false, blockedBy: ['feature_disabled'] };
  dependencies.listScheduleReceipts = jest.fn().mockResolvedValue(new Map());
  const projection = await getPreparationForRequest(REQUEST, dependencies);
  expect(projection).toMatchObject({
    timing: { availability: 'available' },
    preparation: { due: true, state: 'disabled', automationActive: false },
  });
});

it('retry requeues only the exact blocked receipt after current request and event revalidation', async () => {
  const { dependencies } = harness();
  dependencies.retryReceipt = jest.fn().mockResolvedValue(true);
  const result = await requestPreparationRetry(REQUEST, dependencies, { callerSystemId: LEAD_PD });
  expect(result).toMatchObject({ success: true, queued: true, requestId: REQUEST, siteVisitId: VISIT });
  expect(dependencies.retryReceipt).toHaveBeenCalledWith(REQUEST, VISIT, END, '');
});

it('retries a completed correction using its retained receipt epoch while keeping Draft correction human-only', async () => {
  const reviewed = {
    artifactId: DOC,
    lifecycleState: L.REVIEW,
    correction: { cycleId: 'staff-reopen-7' },
    file: { versionId: '8.0' },
    milestone: { versionId: '8.0', contentHash: 'a'.repeat(64), createdAt: '2026-12-02T01:00:00Z' },
  };
  const { dependencies } = harness({ currentArtifact: reviewed });
  dependencies.retryReceipt = jest.fn().mockResolvedValue(true);
  await requestPreparationRetry(REQUEST, dependencies, { callerSystemId: LEAD_PD });
  expect(dependencies.retryReceipt).toHaveBeenCalledWith(REQUEST, VISIT, END, 'staff-reopen-7');

  dependencies.readArtifactStatus.mockResolvedValue({
    currentArtifact: { ...reviewed, lifecycleState: L.DRAFT },
  });
  await expect(requestPreparationRetry(REQUEST, dependencies, { callerSystemId: LEAD_PD })).rejects.toMatchObject({
    code: 'preparation_correction_requires_staff',
  });
});

it('requires trusted lead-PD or superuser authorization before retrying', async () => {
  const { dependencies } = harness();
  dependencies.retryReceipt = jest.fn();
  await expect(requestPreparationRetry(REQUEST, dependencies, { callerSystemId: '88888888-0000-4000-8000-000000000001' }))
    .rejects.toMatchObject({ httpStatus: 403, code: 'preparation_retry_forbidden' });
  expect(dependencies.retryReceipt).not.toHaveBeenCalled();
});

it('selects the trusted lead-PD identity for authorization on the default service read', async () => {
  getById.mockResolvedValueOnce({
    akoya_requestid: REQUEST,
    akoya_requeststatus: 'Phase II Pending',
    wmkf_meetingdate: '2026-12-10T00:00:00Z',
    _wmkf_grantprogram_value: PROGRAM,
    _wmkf_programdirector_value: LEAD_PD,
  });
  const dependencies = {
    config,
    now: () => new Date('2026-12-02T00:00:00.000Z'),
    findSiteVisits: jest.fn().mockResolvedValue({ records: [{
      activityid: VISIT, _regardingobjectid_value: REQUEST, scheduledend: END,
      modifiedon: MODIFIED, statecode: 10, statuscode: 11,
    }] }),
    readArtifactStatus: jest.fn().mockResolvedValue({ currentArtifact: null }),
    retryReceipt: jest.fn().mockResolvedValue(true),
  };
  await requestPreparationRetry(REQUEST, dependencies, { callerSystemId: LEAD_PD });
  expect(getById).toHaveBeenCalledWith(REQUEST, expect.objectContaining({
    select: expect.arrayContaining(['_wmkf_programdirector_value']),
  }));
});


const FACTORY_RUN = '11111111-0000-4000-8000-000000000001';
const EXPECTED_APP_USER = '22222222-0000-4000-8000-000000000001';
const OTHER_REQUEST = '33333333-0000-4000-8000-000000000001';
const factoryRun = {
  runId: FACTORY_RUN, destinationRequestId: REQUEST,
  expectedAppUserId: EXPECTED_APP_USER, status: 'ready',
  destinationEnvironment: 'production', recipe: 'basic',
};
const testRequestRow = {
  akoya_requestid: REQUEST,
  akoya_requeststatus: 'Phase II Pending',
  wmkf_meetingdate: '2026-12-10T00:00:00Z',
  _wmkf_grantprogram_value: PROGRAM,
  wmkf_istestrequest: true,
  wmkf_testcreationrunid: FACTORY_RUN,
  _createdby_value: EXPECTED_APP_USER,
  _ownerid_value: EXPECTED_APP_USER,
};
const testConfig = {
  ...config, ready: true, active: false, guardedReopenSchemaReady: true,
  testIsolationReady: true, blockedBy: [],
};

it('runs the real one-request worker path only for its ready Factory identity and keeps cron disabled', async () => {
  const generatedArtifact = { artifactId: DOC, lifecycleState: L.DRAFT, operationStatus: O.READY };
  const { dependencies } = harness({ generatedArtifact });
  dependencies.config = testConfig;
  dependencies.queryRequests.mockResolvedValue({ records: [testRequestRow], capped: false });
  dependencies.getRequest.mockResolvedValue(testRequestRow);
  const result = await runFactoryTestStaffDeliberationsPreparation(
    { requestId: REQUEST, factoryRun }, dependencies,
  );
  expect(result).toMatchObject({ status: 'factory-test-completed', scanned: 1, prepared: 1 });
  expect(dependencies.queryRequests).toHaveBeenCalledWith(expect.objectContaining({
    filter: `akoya_requestid eq ${REQUEST}`,
  }));
  expect(dependencies.claimReceipt).toHaveBeenCalledWith({ requestId: REQUEST });
  expect(dependencies.generate).toHaveBeenCalledWith(expect.objectContaining({
    requestId: REQUEST, generationMode: 'missing-only', runSource: 'Vercel Test',
  }));
  expect(dependencies.promote).toHaveBeenCalledWith(expect.objectContaining({
    eligibility: expect.objectContaining({ factoryTestScope: expect.objectContaining({
      requestId: REQUEST, runId: FACTORY_RUN, expectedAppUserId: EXPECTED_APP_USER,
    }) }),
  }));
  expect(dependencies.finishReceipt).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
    state: 'prepared', provenance: expect.objectContaining({
      principal: 'local-factory-test-operator', factoryRunId: FACTORY_RUN,
    }),
  }));
  const ordinary = await drainStaffDeliberationsPreparations(dependencies);
  expect(ordinary.status).toBe('disabled');
  expect(dependencies.queryRequests).toHaveBeenCalledTimes(1);
});

it('rejects an unrelated row returned for the exact-scope query before receipts or work', async () => {
  const { dependencies } = harness();
  dependencies.config = testConfig;
  dependencies.queryRequests.mockResolvedValue({ records: [{ ...testRequestRow, akoya_requestid: OTHER_REQUEST }], capped: false });
  await expect(runFactoryTestStaffDeliberationsPreparation(
    { requestId: REQUEST, factoryRun }, dependencies,
  )).rejects.toMatchObject({ code: 'factory_preparation_test_request_mismatch' });
  expect(dependencies.upsertReceipt).not.toHaveBeenCalled();
  expect(dependencies.claimReceipt).not.toHaveBeenCalled();
  expect(dependencies.generate).not.toHaveBeenCalled();
});

it('rejects invalid Factory scope before querying the request', async () => {
  const { dependencies } = harness();
  dependencies.config = testConfig;
  await expect(runFactoryTestStaffDeliberationsPreparation(
    { requestId: REQUEST, factoryRun: { ...factoryRun, destinationRequestId: OTHER_REQUEST } }, dependencies,
  )).rejects.toMatchObject({ code: 'factory_preparation_test_run_mismatch' });
  expect(dependencies.queryRequests).not.toHaveBeenCalled();
});

it('blocks when the TEST marker or Factory run changes on the fresh worker read', async () => {
  const generatedArtifact = { artifactId: DOC, lifecycleState: L.DRAFT, operationStatus: O.READY };
  const { dependencies } = harness({ generatedArtifact });
  dependencies.config = testConfig;
  dependencies.queryRequests.mockResolvedValue({ records: [testRequestRow], capped: false });
  dependencies.getRequest.mockResolvedValue({ ...testRequestRow, wmkf_testcreationrunid: OTHER_REQUEST });
  const result = await runFactoryTestStaffDeliberationsPreparation(
    { requestId: REQUEST, factoryRun }, dependencies,
  );
  expect(result).toMatchObject({ blocked: 1, prepared: 0 });
  expect(dependencies.generate).not.toHaveBeenCalled();
  expect(dependencies.promote).not.toHaveBeenCalled();
  expect(dependencies.finishReceipt).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
    state: 'blocked', errorCode: 'request_eligibility_changed',
  }));
});

it('does not process an unrelated receipt even if a claim dependency returns one', async () => {
  const { dependencies, receipt } = harness();
  dependencies.config = testConfig;
  dependencies.queryRequests.mockResolvedValue({ records: [testRequestRow], capped: false });
  dependencies.claimReceipt.mockResolvedValue({ ...receipt, request_id: OTHER_REQUEST });
  await expect(runFactoryTestStaffDeliberationsPreparation(
    { requestId: REQUEST, factoryRun }, dependencies,
  )).rejects.toMatchObject({ code: 'factory_preparation_test_receipt_mismatch' });
  expect(dependencies.finishReceipt).not.toHaveBeenCalled();
  expect(dependencies.generate).not.toHaveBeenCalled();
});

it('keeps ordinary cron filtering marked TEST requests even when they are returned by a faulty query', async () => {
  const priorIsolation = process.env.TEST_REQUEST_ISOLATION;
  process.env.TEST_REQUEST_ISOLATION = 'on';
  try {
    const { dependencies } = harness();
    dependencies.queryRequests.mockResolvedValue({ records: [testRequestRow], capped: false });
    dependencies.claimReceipt.mockResolvedValue(null);
    await drainStaffDeliberationsPreparations(dependencies);
    expect(dependencies.queryRequests.mock.calls[0][0].filter).toContain('wmkf_istestrequest eq false');
    expect(dependencies.findSiteVisits).not.toHaveBeenCalled();
    expect(dependencies.upsertReceipt).not.toHaveBeenCalled();
    expect(dependencies.claimReceipt).toHaveBeenCalled();
  } finally {
    if (priorIsolation === undefined) delete process.env.TEST_REQUEST_ISOLATION;
    else process.env.TEST_REQUEST_ISOLATION = priorIsolation;
  }
});

it('refuses the scoped run when any readiness prerequisite is absent', async () => {
  const { dependencies } = harness();
  dependencies.config = { ...testConfig, ready: false, blockedBy: ['test_request_isolation_not_ready'] };
  await expect(runFactoryTestStaffDeliberationsPreparation(
    { requestId: REQUEST, factoryRun }, dependencies,
  )).rejects.toMatchObject({ code: 'factory_preparation_test_not_ready' });
  expect(dependencies.queryRequests).not.toHaveBeenCalled();
});


it('does not create a receipt or invoke generation before the scheduled end', async () => {
  const { dependencies } = harness();
  dependencies.config = testConfig;
  dependencies.now = () => new Date('2026-11-30T23:59:59.999Z');
  dependencies.queryRequests.mockResolvedValue({ records: [testRequestRow], capped: false });
  dependencies.claimReceipt.mockResolvedValue(null);
  const result = await runFactoryTestStaffDeliberationsPreparation(
    { requestId: REQUEST, factoryRun }, dependencies,
  );
  expect(result).toMatchObject({ status: 'factory-test-completed', scanned: 0, prepared: 0 });
  expect(dependencies.upsertReceipt).not.toHaveBeenCalled();
  expect(dependencies.claimReceipt).toHaveBeenCalledWith({ requestId: REQUEST });
  expect(dependencies.generate).not.toHaveBeenCalled();
  expect(dependencies.promote).not.toHaveBeenCalled();
});

describe('excluded request numbers', () => {
  const EXCLUDED = '1003220';
  const excludedConfig = { ...config, excludedRequestNumbers: [EXCLUDED] };
  const withNumber = (row, number) => ({ ...row, akoya_requestnum: number });

  it('parses only digit-string request numbers and is not a readiness input', () => {
    const env = {
      STAFF_DELIBERATIONS_AUTO_PREPARE: 'on',
      STAFF_DELIBERATIONS_AUTO_PREPARE_PROGRAM_IDS: JSON.stringify([PROGRAM]),
      STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES: JSON.stringify(['D26']),
      STAFF_DELIBERATIONS_AUTO_PREPARE_REQUEST_STATUSES: JSON.stringify(['Phase II Pending']),
      STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS: JSON.stringify([[10, 11, true]]),
      STAFF_DELIBERATIONS_AUTO_PREPARE_ATOMIC_FENCE_CONFIRMED: 'on',
      GUARDED_REOPEN_SCHEMA_READY: 'on',
      TEST_REQUEST_ISOLATION: 'on',
    };
    expect(readPreparationConfig(env)).toMatchObject({ active: true, excludedRequestNumbers: [] });
    env.STAFF_DELIBERATIONS_AUTO_PREPARE_EXCLUDED_REQUEST_NUMBERS = '[]';
    expect(readPreparationConfig(env)).toMatchObject({ active: true, excludedRequestNumbers: [] });
    env.STAFF_DELIBERATIONS_AUTO_PREPARE_EXCLUDED_REQUEST_NUMBERS = JSON.stringify(['1003220', 1003221, ' 1003222 ', '1003220']);
    expect(readPreparationConfig(env)).toMatchObject({ active: true, excludedRequestNumbers: ['1003220', '1003221', '1003222'] });
  });

  it.each([
    ['a bare number', '1003220'],
    ['malformed JSON', '["1003220"'],
    ['an object', '{"1003220":true}'],
    ['a non-numeric entry', '["1003220","abc"]'],
    ['an empty entry', '["1003220",""]'],
    ['a null entry', '["1003220",null]'],
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('blocks automation when the exclusion list is %s', (_label, raw) => {
    const config = readPreparationConfig({
      STAFF_DELIBERATIONS_AUTO_PREPARE: 'on',
      STAFF_DELIBERATIONS_AUTO_PREPARE_PROGRAM_IDS: JSON.stringify([PROGRAM]),
      STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES: JSON.stringify(['D26']),
      STAFF_DELIBERATIONS_AUTO_PREPARE_REQUEST_STATUSES: JSON.stringify(['Phase II Pending']),
      STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS: JSON.stringify([[10, 11, true]]),
      STAFF_DELIBERATIONS_AUTO_PREPARE_ATOMIC_FENCE_CONFIRMED: 'on',
      GUARDED_REOPEN_SCHEMA_READY: 'on',
      TEST_REQUEST_ISOLATION: 'on',
      STAFF_DELIBERATIONS_AUTO_PREPARE_EXCLUDED_REQUEST_NUMBERS: raw,
    });
    expect(config).toMatchObject({ active: false, blockedBy: ['excluded_request_numbers_invalid'] });
  });

  it('never scans requests when a present exclusion setting is blank', async () => {
    const { dependencies } = harness();
    dependencies.config = readPreparationConfig({
      STAFF_DELIBERATIONS_AUTO_PREPARE: 'on',
      STAFF_DELIBERATIONS_AUTO_PREPARE_PROGRAM_IDS: JSON.stringify([PROGRAM]),
      STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES: JSON.stringify(['D26']),
      STAFF_DELIBERATIONS_AUTO_PREPARE_REQUEST_STATUSES: JSON.stringify(['Phase II Pending']),
      STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS: JSON.stringify([[10, 11, true]]),
      STAFF_DELIBERATIONS_AUTO_PREPARE_ATOMIC_FENCE_CONFIRMED: 'on',
      GUARDED_REOPEN_SCHEMA_READY: 'on',
      TEST_REQUEST_ISOLATION: 'on',
      STAFF_DELIBERATIONS_AUTO_PREPARE_EXCLUDED_REQUEST_NUMBERS: '',
    });
    const result = await drainStaffDeliberationsPreparations(dependencies);
    expect(result).toMatchObject({ status: 'disabled', blockedBy: ['excluded_request_numbers_invalid'] });
    expect(dependencies.queryRequests).not.toHaveBeenCalled();
    expect(dependencies.generate).not.toHaveBeenCalled();
    expect(dependencies.promote).not.toHaveBeenCalled();
  });

  it('never enqueues an excluded request during the due scan', async () => {
    const { dependencies } = harness();
    dependencies.config = excludedConfig;
    const [row] = (await dependencies.queryRequests()).records;
    dependencies.queryRequests.mockResolvedValue({ records: [withNumber(row, EXCLUDED)], capped: false });
    dependencies.claimReceipt = jest.fn().mockResolvedValue(null);
    const result = await drainStaffDeliberationsPreparations(dependencies);
    expect(dependencies.upsertReceipt).not.toHaveBeenCalled();
    expect(dependencies.generate).not.toHaveBeenCalled();
    expect(dependencies.promote).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 0 });
  });

  it('still enqueues a non-excluded request under the same configuration', async () => {
    const { dependencies } = harness();
    dependencies.config = excludedConfig;
    const [row] = (await dependencies.queryRequests()).records;
    dependencies.queryRequests.mockResolvedValue({ records: [withNumber(row, '1002963')], capped: false });
    dependencies.claimReceipt = jest.fn().mockResolvedValue(null);
    await drainStaffDeliberationsPreparations(dependencies);
    expect(dependencies.upsertReceipt).toHaveBeenCalledTimes(1);
  });

  it('blocks an already-claimed receipt when the fresh request read is excluded', async () => {
    const { dependencies } = harness({ currentArtifact: { artifactId: DOC, lifecycleState: L.DRAFT, operationStatus: O.READY } });
    dependencies.config = excludedConfig;
    dependencies.queryRequests.mockResolvedValue({ records: [], capped: false });
    dependencies.getRequest.mockResolvedValue(withNumber(await dependencies.getRequest(), EXCLUDED));
    await drainStaffDeliberationsPreparations(dependencies);
    expect(dependencies.promote).not.toHaveBeenCalled();
    expect(dependencies.generate).not.toHaveBeenCalled();
    expect(dependencies.finishReceipt).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      state: 'blocked', errorCode: 'request_eligibility_changed',
    });
  });

  it('refuses retry for an excluded request', async () => {
    const { dependencies } = harness();
    dependencies.config = excludedConfig;
    dependencies.getRequest.mockResolvedValue(withNumber(await dependencies.getRequest(), EXCLUDED));
    dependencies.retryReceipt = jest.fn();
    await expect(requestPreparationRetry(REQUEST, dependencies, { callerSystemId: LEAD_PD }))
      .rejects.toMatchObject({ httpStatus: 409, code: 'preparation_request_ineligible' });
    expect(dependencies.retryReceipt).not.toHaveBeenCalled();
  });

  it('reports an excluded due request as disabled so the manual action stays available', async () => {
    const { dependencies } = harness();
    dependencies.config = excludedConfig;
    dependencies.listScheduleReceipts = jest.fn().mockResolvedValue(new Map());
    dependencies.getRequest.mockResolvedValue(withNumber(await dependencies.getRequest(), EXCLUDED));
    const projection = await getPreparationForRequest(REQUEST, dependencies);
    expect(projection.preparation).toMatchObject({ due: true, state: 'disabled', automationActive: true });
  });

  it('reports a due request outside the program allowlist as disabled, not waiting', async () => {
    const { dependencies } = harness();
    dependencies.listScheduleReceipts = jest.fn().mockResolvedValue(new Map());
    dependencies.getRequest.mockResolvedValue({ ...(await dependencies.getRequest()), _wmkf_grantprogram_value: LEAD_PD });
    const projection = await getPreparationForRequest(REQUEST, dependencies);
    expect(projection.preparation).toMatchObject({ due: true, state: 'disabled' });
  });

  it('keeps an eligible due request waiting for automation', async () => {
    const { dependencies } = harness();
    dependencies.config = excludedConfig;
    dependencies.listScheduleReceipts = jest.fn().mockResolvedValue(new Map());
    const projection = await getPreparationForRequest(REQUEST, dependencies);
    expect(projection.preparation).toMatchObject({ due: true, state: 'due' });
  });

  it('reports unavailable when the request read fails while automation is active', async () => {
    const { dependencies } = harness();
    dependencies.listScheduleReceipts = jest.fn().mockResolvedValue(new Map());
    dependencies.getRequest.mockRejectedValue(new Error('dataverse down'));
    const projection = await getPreparationForRequest(REQUEST, dependencies);
    expect(projection.preparation).toMatchObject({ due: true, state: 'unavailable' });
  });
});

describe('automatic preparation attribution', () => {
  const draft = { artifactId: DOC, lifecycleState: L.DRAFT, operationStatus: O.READY, file: { itemId: 'same-word-item' } };

  it('records a reused promotion as a reconciled handoff, not automatic preparation', async () => {
    const { dependencies } = harness({ currentArtifact: draft });
    dependencies.promote.mockResolvedValue({ artifact: { artifactId: DOC, lifecycleState: L.REVIEW }, reused: true });
    await drainStaffDeliberationsPreparations(dependencies);
    expect(dependencies.finishReceipt).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
      state: 'prepared', provenance: expect.objectContaining({ operation: 'reconciled-complete-handoff' }),
    }));
  });

  it('records a fresh promotion as scheduled-end preparation', async () => {
    const { dependencies } = harness({ currentArtifact: draft });
    dependencies.promote.mockResolvedValue({ artifact: { artifactId: DOC, lifecycleState: L.REVIEW }, reused: false });
    await drainStaffDeliberationsPreparations(dependencies);
    expect(dependencies.finishReceipt).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
      state: 'prepared', provenance: expect.objectContaining({ operation: 'scheduled-end-preparation' }),
    }));
  });

  const receiptFor = (overrides) => new Map([[REQUEST, {
    state: 'prepared', siteVisitId: VISIT, scheduledEndIso: END, documentId: DOC,
    attemptCount: 1, preparedAtIso: '2026-12-01T18:05:00.000Z', preparedByAutomation: true, ...overrides,
  }]]);

  it('exposes automatic preparation only for a prepared receipt bound to the current document', async () => {
    const { dependencies } = harness({ currentArtifact: { artifactId: DOC, lifecycleState: L.REVIEW } });
    dependencies.listScheduleReceipts = jest.fn().mockResolvedValue(receiptFor({}));
    expect((await getPreparationForRequest(REQUEST, dependencies)).preparation)
      .toMatchObject({ state: 'prepared', preparedByAutomation: true, preparedAtIso: '2026-12-01T18:05:00.000Z' });

    dependencies.listScheduleReceipts = jest.fn().mockResolvedValue(receiptFor({ preparedByAutomation: false }));
    expect((await getPreparationForRequest(REQUEST, dependencies)).preparation)
      .toMatchObject({ preparedByAutomation: false });

    dependencies.listScheduleReceipts = jest.fn().mockResolvedValue(receiptFor({ documentId: 'dddddddd-0000-4000-8000-000000000099' }));
    expect((await getPreparationForRequest(REQUEST, dependencies)).preparation)
      .toMatchObject({ preparedByAutomation: false, preparedAtIso: null });
  });
});

describe('existing receipts for requests automation no longer covers', () => {
  const receiptMap = (state, overrides = {}) => new Map([[REQUEST, {
    state, siteVisitId: VISIT, scheduledEndIso: END, documentId: null, attemptCount: 1, ...overrides,
  }]]);
  const excludedRequest = async (dependencies) => ({ ...(await dependencies.getRequest()), akoya_requestnum: '1003220' });

  it.each(['pending', 'blocked'])('shows a %s receipt as disabled once the request is excluded', async (state) => {
    const { dependencies } = harness();
    dependencies.config = { ...config, excludedRequestNumbers: ['1003220'] };
    dependencies.getRequest.mockResolvedValue(await excludedRequest(dependencies));
    dependencies.listScheduleReceipts = jest.fn().mockResolvedValue(receiptMap(state, { errorCode: 'request_eligibility_changed' }));
    expect((await getPreparationForRequest(REQUEST, dependencies)).preparation).toMatchObject({ due: true, state: 'disabled' });
  });

  it('shows a blocked receipt as disabled when automation has been turned off', async () => {
    const { dependencies } = harness();
    dependencies.config = { ...config, active: false, blockedBy: ['feature_disabled'] };
    dependencies.listScheduleReceipts = jest.fn().mockResolvedValue(receiptMap('blocked'));
    expect((await getPreparationForRequest(REQUEST, dependencies)).preparation).toMatchObject({ state: 'disabled' });
  });

  it.each(['pending', 'blocked'])('keeps a %s receipt for a covered request', async (state) => {
    const { dependencies } = harness();
    dependencies.listScheduleReceipts = jest.fn().mockResolvedValue(receiptMap(state));
    expect((await getPreparationForRequest(REQUEST, dependencies)).preparation).toMatchObject({ state });
  });

  it('keeps in-flight and completed receipts even when the request is excluded', async () => {
    const { dependencies } = harness();
    dependencies.config = { ...config, excludedRequestNumbers: ['1003220'] };
    dependencies.getRequest.mockResolvedValue(await excludedRequest(dependencies));
    dependencies.listScheduleReceipts = jest.fn().mockResolvedValue(receiptMap('running'));
    expect((await getPreparationForRequest(REQUEST, dependencies)).preparation).toMatchObject({ state: 'running' });
    dependencies.listScheduleReceipts = jest.fn().mockResolvedValue(receiptMap('prepared', { documentId: 'dddddddd-0000-4000-8000-000000000099' }));
    dependencies.readArtifactStatus.mockResolvedValue({ currentArtifact: { artifactId: DOC, lifecycleState: L.REVIEW } });
    expect((await getPreparationForRequest(REQUEST, dependencies)).preparation)
      .toMatchObject({ state: 'blocked', errorCode: 'document_pointer_changed' });
  });

  it('keeps a pending receipt when the request read fails', async () => {
    const { dependencies } = harness();
    dependencies.getRequest.mockRejectedValue(new Error('dataverse down'));
    dependencies.listScheduleReceipts = jest.fn().mockResolvedValue(receiptMap('pending'));
    expect((await getPreparationForRequest(REQUEST, dependencies)).preparation).toMatchObject({ state: 'pending' });
  });
});
