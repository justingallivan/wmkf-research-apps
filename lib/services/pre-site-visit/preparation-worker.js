import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as siteVisitAdapter from '../../dataverse/adapters/site-visit.js';
import * as odata from '../../dataverse/core/odata.js';
import { cycleCodeToOdataFilter, meetingDateToCycleCode } from '../../utils/cycle-code.js';
import { withTestRequestIsolationSelect, withOrdinaryTestRequestODataFilter, testRequestCountsAsOrdinary } from '../test-requests/isolation.js';
import { getPreSiteVisitArtifactStatus } from './artifact-reader.js';
import { generatePreSiteVisitArtifact } from './artifact-service.js';
import { prepareSiteVisitStageAutomatically } from './site-visit-transition-service.js';
import { readPreparationConfig, requestMatchesPreparationAllowlists } from './preparation-config.js';
import { ServiceHttpError } from '../service-http-error.js';
import { REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS } from '../../../shared/config/requestDocument.js';
import { createFactoryPreparationTestScope, isFactoryPreparationTestRequest } from './factory-test-scope.js';
import {
  claimNextPreparation, finishPreparation, listLatestPreparations,
  listPreparationsForSchedules, retryBlockedPreparation, upsertDuePreparation,
} from './preparation-store.js';

const REQUEST_SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'akoya_requeststatus', 'wmkf_meetingdate',
  '_wmkf_grantprogram_value', '_wmkf_programdirector_value', '_wmkf_currentpresitevisit_value',
  '_ownerid_value', '_createdby_value',
];

const DEFAULT_DEPENDENCIES = Object.freeze({
  config: readPreparationConfig(),
  queryRequests: (query) => grantRequestAdapter.queryAllRequests(query),
  getRequest: (id) => grantRequestAdapter.getById(id, {
    select: withTestRequestIsolationSelect(REQUEST_SELECT),
  }),
  getSiteVisit: siteVisitAdapter.getById,
  findSiteVisits: siteVisitAdapter.findSummariesByRequests,
  readArtifactStatus: getPreSiteVisitArtifactStatus,
  generate: generatePreSiteVisitArtifact,
  promote: prepareSiteVisitStageAutomatically,
  upsertReceipt: upsertDuePreparation,
  claimReceipt: claimNextPreparation,
  finishReceipt: finishPreparation,
  listReceipts: listLatestPreparations,
  listScheduleReceipts: listPreparationsForSchedules,
  retryReceipt: retryBlockedPreparation,
  now: () => new Date(),
});

const UNFINISHED_RECEIPT_STATES = new Set(['pending', 'blocked']);

function asMs(value) {
  const result = Date.parse(value || '');
  return Number.isFinite(result) ? result : null;
}

function requestFilter(config, programId, cycleCode) {
  const clauses = [
    cycleCodeToOdataFilter(cycleCode),
    `_wmkf_grantprogram_value eq ${programId}`,
    `(${config.requestStatuses.map((value) => odata.eq('akoya_requeststatus', value)).join(' or ')})`,
  ];
  return withOrdinaryTestRequestODataFilter(clauses.map((clause) => `(${clause})`).join(' and '));
}

function eligiblePreparationRequest(request, config, factoryTestScope = null) {
  const identityMatches = factoryTestScope
    ? isFactoryPreparationTestRequest(request, factoryTestScope)
    : testRequestCountsAsOrdinary(request);
  return identityMatches && requestMatchesPreparationAllowlists(request, config);
}

async function scanDueReceipts(dependencies, report, factoryTestScope = null) {
  const { config } = dependencies;
  const nowMs = dependencies.now().getTime();
  const scanScopes = factoryTestScope ? [{ programId: null, cycleCode: null }]
    : config.programIds.flatMap((programId) => config.cycleCodes.map((cycleCode) => ({ programId, cycleCode })));
  for (const { programId, cycleCode } of scanScopes) {
      const result = await dependencies.queryRequests({
        select: withTestRequestIsolationSelect(REQUEST_SELECT),
        filter: factoryTestScope ? odata.eqGuid('akoya_requestid', factoryTestScope.requestId)
          : requestFilter(config, programId, cycleCode),
        orderby: 'akoya_requestnum asc',
      });
      if (result?.capped || result?.hasMore) throw new Error('eligible_request_scan_capped');
      const records = result?.records || [];
      if (factoryTestScope && (records.length !== 1 || !eligiblePreparationRequest(records[0], config, factoryTestScope))) {
        throw Object.assign(new Error('The exact Factory test request is missing or its identity/eligibility changed.'), {
          code: 'factory_preparation_test_request_mismatch',
        });
      }
      const requests = factoryTestScope ? records : records.filter((request) => eligiblePreparationRequest(request, config));
      if (!requests.length) continue;
      const ids = requests.map((request) => request.akoya_requestid);
      const visits = await dependencies.findSiteVisits(ids);
      if (visits?.capped || visits?.hasMore) throw new Error('site_visit_scan_capped');
      const rowsByRequest = new Map();
      for (const visit of visits?.records || []) {
        const key = String(visit._regardingobjectid_value || '').toLowerCase();
        if (!rowsByRequest.has(key)) rowsByRequest.set(key, []);
        rowsByRequest.get(key).push(visit);
      }
      for (const request of requests) {
        const requestId = String(request.akoya_requestid).toLowerCase();
        const requestProgramId = factoryTestScope ? String(request._wmkf_grantprogram_value || '').toLowerCase() : programId;
        const requestCycleCode = factoryTestScope ? meetingDateToCycleCode(request.wmkf_meetingdate) : cycleCode;
        const visitsForRequest = rowsByRequest.get(requestId) || [];
        if (!visitsForRequest.length) continue;
        const classified = visitsForRequest.map((visit) => ({
          visit,
          pair: config.stateStatusPairs.find((item) => (
            item.stateCode === Number(visit.statecode)
            && item.statusCode === Number(visit.statuscode)
          )) || null,
        }));
        const allKnown = classified.every(({ pair }) => pair);
        const eligible = classified.filter(({ pair }) => pair?.eligible).map(({ visit }) => visit);
        const duplicateOrUnknown = !allKnown || eligible.length > 1;
        const targetVisits = duplicateOrUnknown
          ? visitsForRequest.filter((visit) => asMs(visit.scheduledend) !== null && asMs(visit.scheduledend) <= nowMs)
          : eligible.length === 1 ? eligible : [];
        for (const visit of targetVisits) {
          const endMs = asMs(visit.scheduledend);
          if (endMs === null || endMs > nowMs) continue;
          let correctionEpoch = '';
          let resumeCorrection = false;
          let initialState = duplicateOrUnknown ? 'blocked' : 'pending';
          let errorCode = duplicateOrUnknown ? 'schedule_requires_reconciliation' : null;
          if (asMs(visit.modifiedon) === null) {
            initialState = 'blocked';
            errorCode = 'schedule_revision_unavailable';
          }
          try {
            const artifactStatus = await dependencies.readArtifactStatus({ requestId: request.akoya_requestid });
            correctionEpoch = artifactStatus.currentArtifact?.correction?.cycleId || '';
            const current = artifactStatus.currentArtifact;
            resumeCorrection = Boolean(correctionEpoch
              && current?.lifecycleState !== REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT
              && current?.milestone?.versionId
              && current?.milestone?.contentHash
              && current?.milestone?.createdAt
              && current.file?.versionId === current.milestone.versionId
              && [REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
                REQUEST_DOCUMENT_LIFECYCLE_STATE.BOARD_READY,
                REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL].includes(current.lifecycleState));
          } catch (error) {
            initialState = 'blocked';
            errorCode = error?.code || 'document_lineage_unavailable';
          }
          try {
            await dependencies.upsertReceipt({
              requestId: request.akoya_requestid,
              programId: requestProgramId,
              cycleCode: requestCycleCode,
              siteVisitId: visit.activityid,
              scheduledEnd: visit.scheduledend,
              eventModifiedOn: visit.modifiedon || null,
              stateCode: visit.statecode,
              statusCode: visit.statuscode,
              correctionEpoch,
              initialState,
              errorCode,
              resumeCorrection,
            });
          } catch {
            report.receiptWriteFailures = (report.receiptWriteFailures || 0) + 1;
            continue;
          }
          report.scanned += 1;
          if (initialState === 'blocked') report.blocked += 1;
        }
      }
  }
}

function transientFailure(error) {
  const status = Number(error?.status || error?.httpStatus || 0);
  return status === 412 || status === 429 || status >= 500
    || ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'fetch_failed',
      // SharePoint metadata moved between the handoff's two reads; the next
      // attempt re-reads it (first production run, 2026-10-06).
      'site_visit_sharepoint_version_changed'].includes(error?.code);
}

async function processReceipt(receipt, dependencies, factoryTestScope = null) {
  const request = await dependencies.getRequest(receipt.request_id);
  if (!eligiblePreparationRequest(request, dependencies.config, factoryTestScope)) {
    return dependencies.finishReceipt(receipt.id, receipt.lease_token, {
      state: 'blocked', errorCode: 'request_eligibility_changed',
    });
  }
  const assertCurrentSchedule = async ({ allowModifiedOnDrift = false } = {}) => {
    const freshRequest = await dependencies.getRequest(receipt.request_id);
    const scheduleResult = await dependencies.findSiteVisits([receipt.request_id]);
    if (scheduleResult?.capped || scheduleResult?.hasMore) throw Object.assign(new Error('schedule scan capped'), { code: 'schedule_scan_capped' });
    const rows = (scheduleResult?.records || []).filter((visit) => (
      String(visit._regardingobjectid_value || '').toLowerCase() === String(receipt.request_id).toLowerCase()
    ));
    const mapped = rows.map((visit) => ({ visit, pair: dependencies.config.stateStatusPairs.find((pair) => (
      pair.stateCode === Number(visit.statecode) && pair.statusCode === Number(visit.statuscode)
    )) || null }));
    const eligible = mapped.filter(({ pair }) => pair?.eligible).map(({ visit }) => visit);
    const current = rows.find((visit) => String(visit.activityid).toLowerCase() === String(receipt.site_visit_id).toLowerCase());
    const pair = current && dependencies.config.stateStatusPairs.find((item) => (
      item.stateCode === Number(current.statecode) && item.statusCode === Number(current.statuscode)
    ));
    const invalidSchedule = !eligiblePreparationRequest(freshRequest, dependencies.config, factoryTestScope)
      || meetingDateToCycleCode(freshRequest.wmkf_meetingdate) !== receipt.cycle_code
      || !dependencies.config.cycleCodes.includes(receipt.cycle_code)
      || mapped.some(({ pair: classifiedPair }) => !classifiedPair)
      || eligible.length !== 1 || !pair?.eligible || !current
      || String(eligible[0]?.activityid || '').toLowerCase() !== String(receipt.site_visit_id).toLowerCase()
      || asMs(current.scheduledend) !== asMs(receipt.scheduled_end)
      || (!allowModifiedOnDrift && asMs(current.modifiedon) !== asMs(receipt.event_modified_on))
      || asMs(current.scheduledend) === null || asMs(current.scheduledend) > dependencies.now().getTime();
    if (invalidSchedule) {
      throw Object.assign(new Error('The request or scheduled presentation changed.'), { code: 'schedule_or_request_changed' });
    }
    return freshRequest;
  };
  const status = await dependencies.readArtifactStatus({ requestId: receipt.request_id });
  const currentArtifact = status.currentArtifact;
  let generationInvoked = false;
  const correctionEpoch = currentArtifact?.correction?.cycleId || '';
  const correctionInProgress = currentArtifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT
    && Boolean(correctionEpoch);
  if (correctionInProgress) {
    return dependencies.finishReceipt(receipt.id, receipt.lease_token, {
      state: 'blocked', errorCode: 'correction_reopen_requires_staff',
      documentId: currentArtifact.artifactId,
    });
  }
  const hasCompleteMilestone = currentArtifact?.milestone?.versionId
    && currentArtifact?.milestone?.contentHash
    && currentArtifact?.milestone?.createdAt
    && currentArtifact.file?.versionId === currentArtifact.milestone.versionId;
  if (hasCompleteMilestone && [
    REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
    REQUEST_DOCUMENT_LIFECYCLE_STATE.BOARD_READY,
    REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
  ].includes(currentArtifact.lifecycleState)) {
    try { await assertCurrentSchedule({ allowModifiedOnDrift: true }); }
    catch (error) {
      return dependencies.finishReceipt(receipt.id, receipt.lease_token, {
        state: 'blocked', errorCode: error?.code || 'schedule_or_request_changed',
        documentId: currentArtifact.artifactId,
      });
    }
    return dependencies.finishReceipt(receipt.id, receipt.lease_token, {
      state: 'prepared', documentId: currentArtifact.artifactId,
      provenance: factoryTestScope
        ? { principal: 'local-factory-test-operator', operation: 'reconciled-complete-handoff', factoryRunId: factoryTestScope.runId }
        : { principal: 'vercel-cron', operation: 'reconciled-complete-handoff' },
    });
  }
  try { await assertCurrentSchedule(); }
  catch (error) {
    return dependencies.finishReceipt(receipt.id, receipt.lease_token, {
      state: 'blocked', errorCode: error?.code || 'schedule_or_request_changed',
    });
  }
  if (String(correctionEpoch) !== String(receipt.correction_epoch || '')) {
    return dependencies.finishReceipt(receipt.id, receipt.lease_token, {
      state: 'blocked', errorCode: 'correction_epoch_changed',
    });
  }
  let artifact = status.currentArtifact;
  if (!artifact) {
    let generated;
    try {
      generationInvoked = true;
      generated = await dependencies.generate({
        requestId: receipt.request_id,
        generationMode: 'missing-only',
        // Executor accepts only its closed run-source picklist; use the
        // established background value for scheduled automation and the
        // explicit test value for the owner-run Factory acceptance path.
        runSource: factoryTestScope ? 'Vercel Test' : 'PowerAutomate Auto',
        assertEligibleBeforeModel: assertCurrentSchedule,
      });
    } catch (error) {
      error.factoryPreparationGenerationInvoked = true;
      const missingOnlyRaceCodes = new Set([
        'pre_site_visit_missing_only_current_exists',
        'pre_site_visit_missing_only_changed',
        'pre_site_visit_missing_only_pending_conflict',
        'pre_site_visit_pointer_changed',
      ]);
      if (!missingOnlyRaceCodes.has(error?.code)) throw error;
      const reconciled = await dependencies.readArtifactStatus({ requestId: receipt.request_id });
      const racedArtifact = reconciled?.currentArtifact || null;
      if (racedArtifact?.artifactId) {
        const completeMilestone = racedArtifact.milestone?.versionId
          && racedArtifact.milestone?.contentHash
          && racedArtifact.milestone?.createdAt
          && racedArtifact.file?.versionId === racedArtifact.milestone.versionId;
        if (completeMilestone && [
          REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
          REQUEST_DOCUMENT_LIFECYCLE_STATE.BOARD_READY,
          REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
        ].includes(racedArtifact.lifecycleState)) {
          try { await assertCurrentSchedule({ allowModifiedOnDrift: true }); }
          catch (scheduleError) {
            return dependencies.finishReceipt(receipt.id, receipt.lease_token, {
              state: 'blocked', errorCode: scheduleError?.code || 'schedule_or_request_changed',
              documentId: racedArtifact.artifactId,
            });
          }
          return dependencies.finishReceipt(receipt.id, receipt.lease_token, {
            state: 'prepared', documentId: racedArtifact.artifactId,
            provenance: factoryTestScope
        ? { principal: 'local-factory-test-operator', operation: 'reconciled-complete-handoff', factoryRunId: factoryTestScope.runId }
        : { principal: 'vercel-cron', operation: 'reconciled-complete-handoff' },
          });
        }
        if (racedArtifact.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT
          && racedArtifact.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
          artifact = racedArtifact;
        }
      }
      if (!artifact) {
        return dependencies.finishReceipt(receipt.id, receipt.lease_token, {
          state: 'pending', retryAfterMs: 30_000,
          errorCode: racedArtifact ? 'missing_only_race_requires_reconcile' : 'generation_in_progress',
          provenance: factoryTestScope
            ? { principal: 'local-factory-test-operator', operation: 'missing-only-race-reconcile', factoryRunId: factoryTestScope.runId }
            : { principal: 'vercel-cron', operation: 'missing-only-race-reconcile' },
        });
      }
    }
    if (generated) {
      artifact = generated?.artifact || null;
    }
    if (artifact?.operationStatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
      return dependencies.finishReceipt(receipt.id, receipt.lease_token, {
        state: 'pending', retryAfterMs: 30_000, errorCode: 'generation_in_progress',
        provenance: factoryTestScope
          ? { principal: 'local-factory-test-operator', operation: 'missing-only-generation', factoryRunId: factoryTestScope.runId }
          : { principal: 'vercel-cron', operation: 'missing-only-generation' },
      });
    }
  }
  if (!artifact?.artifactId) {
    return dependencies.finishReceipt(receipt.id, receipt.lease_token, {
      state: 'blocked', errorCode: 'current_document_missing',
    });
  }
  try { await assertCurrentSchedule(); }
  catch (error) {
    return dependencies.finishReceipt(receipt.id, receipt.lease_token, {
      state: 'blocked', errorCode: error?.code || 'schedule_or_request_changed',
      documentId: artifact.artifactId,
      provenance: factoryTestScope
        ? { principal: 'local-factory-test-operator', operation: 'generated-foundation-retained', factoryRunId: factoryTestScope.runId }
        : { principal: 'vercel-cron', operation: 'generated-foundation-retained' },
    });
  }
  const promoted = await dependencies.promote({
    requestId: receipt.request_id,
    expectedArtifactId: artifact.artifactId,
    siteVisitId: receipt.site_visit_id,
    scheduledEnd: new Date(receipt.scheduled_end).toISOString(),
    eventModifiedOn: new Date(receipt.event_modified_on).toISOString(),
    stateCode: receipt.event_state_code,
    statusCode: receipt.event_status_code,
    eligibility: { ...dependencies.config, ...(factoryTestScope ? { factoryTestScope } : {}) },
  });
  if (promoted?.artifact?.lifecycleState !== REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW) {
    return dependencies.finishReceipt(receipt.id, receipt.lease_token, {
      state: 'blocked', errorCode: 'promotion_readback_incomplete',
    });
  }
  const finished = await dependencies.finishReceipt(receipt.id, receipt.lease_token, {
    state: 'prepared', documentId: artifact.artifactId,
    provenance: {
      principal: factoryTestScope ? 'local-factory-test-operator' : 'vercel-cron',
      // A reused result means the document was already in Review (staff, or a
      // lost commit response); never claim it as automatic preparation.
      operation: promoted.reused ? 'reconciled-complete-handoff'
        : factoryTestScope ? 'factory-test-one-shot-preparation' : 'scheduled-end-preparation',
      ...(factoryTestScope ? { factoryRunId: factoryTestScope.runId } : {}),
      siteVisitId: receipt.site_visit_id,
      scheduledEnd: new Date(receipt.scheduled_end).toISOString(),
      documentId: artifact.artifactId,
    },
  });
  return { ...finished, _generationInvoked: generationInvoked };
}

export async function getPreparationByRequests(requestIds, dependencies = DEFAULT_DEPENDENCIES) {
  return dependencies.listReceipts(requestIds);
}

export async function getPreparationForRequest(requestId, dependencies = DEFAULT_DEPENDENCIES) {
  const config = dependencies.config || readPreparationConfig();
  dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies, config };
  const visitsResult = await dependencies.findSiteVisits([requestId]);
  const artifactStatus = await dependencies.readArtifactStatus({ requestId }).catch(() => null);
  if (visitsResult?.capped || visitsResult?.hasMore) {
    return { timing: { availability: 'unavailable', startIso: null, endIso: null, timeZone: null },
      preparation: { state: 'blocked', due: false, errorCode: 'schedule_read_incomplete' } };
  }
  const rows = (visitsResult?.records || []).filter((row) => String(row._regardingobjectid_value || '').toLowerCase() === String(requestId).toLowerCase());
  const classified = rows.map((visit) => ({
    visit,
    pair: config.stateStatusPairs.find((item) => item.stateCode === Number(visit.statecode)
      && item.statusCode === Number(visit.statuscode)) || null,
  }));
  const classificationComplete = classified.every(({ pair }) => pair);
  const eligible = classified.filter(({ pair }) => pair?.eligible).map(({ visit }) => visit);
  const dueVisit = classificationComplete && eligible.length === 1 ? eligible[0] : null;
  const display = dueVisit || (rows.length === 1 ? rows[0] : null);
  let receiptMap = null;
  if (dueVisit) {
    try {
      receiptMap = await dependencies.listScheduleReceipts([{
        requestId,
        siteVisitId: dueVisit.activityid,
        scheduledEnd: dueVisit.scheduledend,
      }]);
    } catch {
      receiptMap = null;
    }
  } else {
    receiptMap = new Map();
  }
  const endMs = asMs(dueVisit?.scheduledend);
  const due = Boolean(dueVisit && endMs !== null && endMs <= dependencies.now().getTime());
  // Active automation only waits on requests the worker would actually scan;
  // an excluded or non-allowlisted request keeps the manual path ('disabled').
  let automationCovers = config.active === true;
  if (automationCovers && due) {
    const request = await dependencies.getRequest(requestId).catch(() => undefined);
    automationCovers = request === undefined ? null : Boolean(request && eligiblePreparationRequest(request, config));
  }
  const timingAvailability = !classificationComplete ? (rows.length ? 'unavailable' : 'missing')
    : eligible.length > 1 ? 'ambiguous'
      : eligible.length === 0 ? 'missing'
        : endMs === null ? 'unavailable' : 'available';
  const receipt = receiptMap?.get(String(requestId).toLowerCase()) || null;
  const receiptMatchesEvent = receipt && display
    && String(receipt.siteVisitId || '').toLowerCase() === String(display.activityid || '').toLowerCase()
    && asMs(receipt.scheduledEndIso) === asMs(display.scheduledend);
  const receiptMatchesDocument = receiptMatchesEvent
    && (!receipt.documentId || String(receipt.documentId).toLowerCase()
      === String(artifactStatus?.currentArtifact?.artifactId || '').toLowerCase());
  return {
    timing: {
      availability: timingAvailability,
      startIso: display?.scheduledstart || null,
      endIso: display?.scheduledend || null,
      timeZone: display?.wmkf_ianatimezone || null,
    },
    preparation: {
      state: !receiptMap ? 'unavailable'
        // Unfinished work the worker will no longer pick up (excluded, outside
        // the allowlists, or automation off) falls back to the manual path.
        : receiptMatchesEvent && UNFINISHED_RECEIPT_STATES.has(receipt.state) && automationCovers === false ? 'disabled'
          : receiptMatchesDocument ? receipt.state : receiptMatchesEvent && receipt.state === 'prepared'
            ? 'blocked' : due ? (automationCovers === null ? 'unavailable' : automationCovers ? 'due' : 'disabled') : 'none',
      due,
      automationActive: config.active === true,
      blockedBy: config.blockedBy || [],
      scheduledEndIso: display?.scheduledend || null,
      documentId: receiptMatchesDocument ? receipt.documentId : null,
      errorCode: receiptMatchesDocument ? receipt.errorCode
        : receiptMatchesEvent && receipt.state === 'prepared' ? 'document_pointer_changed'
          : receiptMatchesEvent ? receipt.errorCode : null,
      attemptCount: receiptMatchesEvent ? receipt.attemptCount : 0,
      preparedByAutomation: Boolean(receiptMatchesDocument && receipt.state === 'prepared' && receipt.preparedByAutomation),
      preparedAtIso: receiptMatchesDocument && receipt.state === 'prepared' ? receipt.preparedAtIso || null : null,
      updatedAtIso: receiptMatchesEvent ? receipt.updatedAtIso : null,
      availability: receiptMap ? 'available' : 'unavailable',
    },
    writeup: artifactStatus?.currentArtifact ? {
      availability: 'available',
      artifactId: artifactStatus.currentArtifact.artifactId,
      lifecycleState: artifactStatus.currentArtifact.lifecycleState,
      operationStatus: artifactStatus.currentArtifact.operationStatus,
      file: artifactStatus.currentArtifact.file || null,
      milestone: artifactStatus.currentArtifact.milestone || null,
      correctionInProgress: artifactStatus.currentArtifact.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT
        && Boolean(artifactStatus.currentArtifact.correction?.cycleId),
    } : artifactStatus ? { availability: 'missing', artifactId: null, file: null, milestone: null }
      : { availability: 'unavailable', artifactId: null, file: null, milestone: null },
  };
}

export async function requestPreparationRetry(requestId, dependencies = DEFAULT_DEPENDENCIES, authorization = {}) {
  const config = dependencies.config || readPreparationConfig();
  dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies, config };
  if (!config.active) {
    throw new ServiceHttpError('Scheduled preparation is disabled or not fully configured.', {
      httpStatus: 409, code: 'preparation_automation_disabled',
    });
  }
  const request = await dependencies.getRequest(requestId);
  if (!request?.akoya_requestid) {
    throw new ServiceHttpError('Request not found.', { httpStatus: 404, code: 'preparation_request_not_found' });
  }
  const isLeadPd = request._wmkf_programdirector_value && authorization.callerSystemId
    && String(request._wmkf_programdirector_value).toLowerCase() === String(authorization.callerSystemId).toLowerCase();
  if (!authorization.isSuperuser && !isLeadPd) {
    throw new ServiceHttpError('Only the lead Program Director can retry preparation.', {
      httpStatus: 403, code: 'preparation_retry_forbidden',
    });
  }
  if (!request || !testRequestCountsAsOrdinary(request)
    || !requestMatchesPreparationAllowlists(request, config)) {
    throw new ServiceHttpError('This request is no longer eligible for preparation.', {
      httpStatus: 409, code: 'preparation_request_ineligible',
    });
  }
  const result = await dependencies.findSiteVisits([requestId]);
  if (result?.capped || result?.hasMore) {
    throw new ServiceHttpError('The Site Visit schedule could not be completely verified.', {
      httpStatus: 503, code: 'preparation_schedule_unavailable',
    });
  }
  const visits = (result?.records || []).filter((visit) => String(visit._regardingobjectid_value || '').toLowerCase() === requestId.toLowerCase());
  const classified = visits.map((visit) => config.stateStatusPairs.find((pair) => (
    pair.stateCode === Number(visit.statecode) && pair.statusCode === Number(visit.statuscode)
  )) || null);
  const eligible = visits.filter((_visit, index) => classified[index]?.eligible);
  if (!visits.length || !classified.every(Boolean) || eligible.length !== 1
    || asMs(eligible[0]?.scheduledend) === null || asMs(eligible[0].scheduledend) > dependencies.now().getTime()
    || asMs(eligible[0]?.modifiedon) === null) {
    throw new ServiceHttpError('A unique completed scheduled presentation is required before retry.', {
      httpStatus: 409, code: 'preparation_schedule_ineligible',
    });
  }
  const status = await dependencies.readArtifactStatus({ requestId });
  if (status.currentArtifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT
    && status.currentArtifact?.correction?.cycleId) {
    throw new ServiceHttpError('Staff must finish the reopened correction before automatic preparation can resume.', {
      httpStatus: 409, code: 'preparation_correction_requires_staff',
    });
  }
  const correctionEpoch = status.currentArtifact?.correction?.cycleId || '';
  const queued = await dependencies.retryReceipt(
    requestId, eligible[0].activityid, eligible[0].scheduledend, correctionEpoch,
  );
  if (!queued) {
    throw new ServiceHttpError('There is no blocked preparation for the current schedule to retry.', {
      httpStatus: 409, code: 'preparation_retry_not_available',
    });
  }
  return { success: true, queued: true, requestId, siteVisitId: eligible[0].activityid };
}

async function drainPreparationQueue(dependencies, factoryTestScope = null) {
  const config = dependencies.config;
  const report = { status: factoryTestScope ? 'factory-test-completed' : 'completed', scanned: 0, prepared: 0, blocked: 0, retried: 0, outcomes: [] };
  await scanDueReceipts(dependencies, report, factoryTestScope);
  for (let index = 0; index < config.batchSize; index += 1) {
    const receipt = await dependencies.claimReceipt(factoryTestScope ? { requestId: factoryTestScope.requestId } : undefined);
    if (!receipt) break;
    if (factoryTestScope && String(receipt.request_id || '').toLowerCase() !== factoryTestScope.requestId) {
      throw Object.assign(new Error('Scoped receipt claim returned a different request; no receipt was processed.'), {
        code: 'factory_preparation_test_receipt_mismatch',
      });
    }
    try {
      const outcome = await processReceipt(receipt, dependencies, factoryTestScope);
      if (outcome?._generationInvoked) report.generated = (report.generated || 0) + 1;
      if (outcome?.state === 'prepared') report.prepared += 1;
      else if (outcome?.state === 'blocked') report.blocked += 1;
      else report.retried += 1;
      report.outcomes.push({ receiptId: receipt.id, state: outcome?.state || 'unknown',
        ...(outcome?._generationInvoked ? { generationInvoked: true } : {}),
        documentId: outcome?.documentId || outcome?.document_id || null });
    } catch (error) {
      const retry = transientFailure(error) && Number(receipt.attempt_count) < 5;
      const testProvenance = factoryTestScope
        ? { principal: 'local-factory-test-operator', operation: 'factory-test-one-shot-preparation', factoryRunId: factoryTestScope.runId }
        : { principal: 'vercel-cron', operation: 'scheduled-end-preparation' };
      const outcome = await dependencies.finishReceipt(receipt.id, receipt.lease_token, {
        state: retry ? 'pending' : 'blocked',
        retryAfterMs: retry ? Math.min(300_000, 30_000 * (2 ** Number(receipt.attempt_count || 0))) : null,
        errorCode: error?.code || 'preparation_failed',
        errorMessage: [error?.message, error?.diagnostic].filter(Boolean).join(' | '),
        provenance: testProvenance,
      }).catch(() => null);
      if (error?.factoryPreparationGenerationInvoked) report.generated = (report.generated || 0) + 1;
      if (retry) report.retried += 1;
      else report.blocked += 1;
      report.outcomes.push({ receiptId: receipt.id, state: outcome?.state || (retry ? 'pending' : 'blocked'), ...(error?.factoryPreparationGenerationInvoked ? { generationInvoked: true } : {}) });
    }
  }
  return report;
}

export async function drainStaffDeliberationsPreparations(dependencies = DEFAULT_DEPENDENCIES) {
  const config = dependencies.config || readPreparationConfig();
  dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies, config };
  if (!config.active) return { status: 'disabled', blockedBy: config.blockedBy };
  return drainPreparationQueue(dependencies);
}

/**
 * Owner-run, exact-request test entry. It overlays only the two global worker
 * activation switches in an in-memory config; all program/cycle/status,
 * schedule-pair, isolation, reopen-schema, and atomic-fence readiness still
 * must pass. This function is called only by the local Factory test CLI.
 */
export async function runFactoryTestStaffDeliberationsPreparation({ requestId, factoryRun }, overrides = {}) {
  const factoryTestScope = createFactoryPreparationTestScope(requestId, factoryRun);
  const env = { ...process.env, STAFF_DELIBERATIONS_AUTO_PREPARE_PRODUCTION: 'on' };
  const baseConfig = overrides.config || readPreparationConfig(env);
  if (baseConfig.ready !== true) {
    throw Object.assign(new Error(`Preparation prerequisites are not ready: ${(baseConfig.blockedBy || []).filter((item) => item !== 'feature_disabled').join(', ') || 'configuration unavailable'}`), {
      code: 'factory_preparation_test_not_ready',
    });
  }
  if (!baseConfig.guardedReopenSchemaReady || !baseConfig.testIsolationReady
    || !baseConfig.stateStatusPairs?.some((pair) => pair.eligible)
    || (baseConfig.blockedBy || []).some((item) => item !== 'feature_disabled')) {
    throw Object.assign(new Error('Preparation requires schedule, isolation, reopen, and atomic-fence readiness.'), {
      code: 'factory_preparation_test_not_ready',
    });
  }
  const config = { ...baseConfig, enabled: true, active: true, blockedBy: [] };
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides, config, factoryTestScope };
  return drainPreparationQueue(dependencies, factoryTestScope);
}

export const _internal = { requestFilter, scanDueReceipts, processReceipt, transientFailure, eligiblePreparationRequest };
