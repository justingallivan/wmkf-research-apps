/** @jest-environment node */
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ getById: jest.fn(), queryAllRequests: jest.fn() }));
import { getById } from '../../lib/dataverse/adapters/grant-request.js';
import { drainStaffDeliberationsPreparations, getPreparationForRequest, requestPreparationRetry } from '../../lib/services/pre-site-visit/preparation-worker.js';
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
