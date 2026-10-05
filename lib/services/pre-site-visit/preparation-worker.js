import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as siteVisitAdapter from '../../dataverse/adapters/site-visit.js';
import { cycleCodeToOdataFilter, meetingDateToCycleCode } from '../../utils/cycle-code.js';
import { withTestRequestIsolationSelect, withOrdinaryTestRequestODataFilter, testRequestCountsAsOrdinary } from '../test-requests/isolation.js';
import { getPreSiteVisitArtifactStatus } from './artifact-reader.js';
import { generatePreSiteVisitArtifact } from './artifact-service.js';
import { prepareSiteVisitStageAutomatically } from './site-visit-transition-service.js';
import { readPreparationConfig } from './preparation-config.js';
import { ServiceHttpError } from '../service-http-error.js';
import { REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS } from '../../../shared/config/requestDocument.js';
import {
  claimNextPreparation, finishPreparation, listLatestPreparations,
  listPreparationsForSchedules, retryBlockedPreparation, upsertDuePreparation,
} from './preparation-store.js';

const REQUEST_SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'akoya_requeststatus', 'wmkf_meetingdate',
  '_wmkf_grantprogram_value', '_wmkf_currentpresitevisit_value',
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

function asMs(value) {
  const result = Date.parse(value || '');
  return Number.isFinite(result) ? result : null;
}

function requestFilter(config, programId, cycleCode) {
  const clauses = [
    cycleCodeToOdataFilter(cycleCode),
    `_wmkf_grantprogram_value eq ${programId}`,
    `(${config.requestStatuses.map((value) => `akoya_requeststatus eq '${String(value).replace(/'/g, "''")}'`).join(' or ')})`,
  ];
  return withOrdinaryTestRequestODataFilter(clauses.map((clause) => `(${clause})`).join(' and '));
}

async function scanDueReceipts(dependencies, report) {
  const { config } = dependencies;
  const nowMs = dependencies.now().getTime();
  for (const programId of config.programIds) {
    for (const cycleCode of config.cycleCodes) {
      const result = await dependencies.queryRequests({
        select: withTestRequestIsolationSelect(REQUEST_SELECT),
        filter: requestFilter(config, programId, cycleCode),
        orderby: 'akoya_requestnum asc',
      });
      if (result?.capped || result?.hasMore) throw new Error('eligible_request_scan_capped');
      const requests = (result?.records || []).filter((request) => (
        testRequestCountsAsOrdinary(request)
        && config.requestStatuses.includes(String(request.akoya_requeststatus || '').trim())
      ));
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
          let initialState = duplicateOrUnknown ? 'blocked' : 'pending';
          let errorCode = duplicateOrUnknown ? 'schedule_requires_reconciliation' : null;
          if (asMs(visit.modifiedon) === null) {
            initialState = 'blocked';
            errorCode = 'schedule_revision_unavailable';
          }
          try {
            const artifactStatus = await dependencies.readArtifactStatus({ requestId: request.akoya_requestid });
            correctionEpoch = artifactStatus.currentArtifact?.correction?.cycleId || '';
          } catch (error) {
            initialState = 'blocked';
            errorCode = error?.code || 'document_lineage_unavailable';
          }
          try {
            await dependencies.upsertReceipt({
              requestId: request.akoya_requestid,
              programId,
              cycleCode,
              siteVisitId: visit.activityid,
              scheduledEnd: visit.scheduledend,
              eventModifiedOn: visit.modifiedon || null,
              stateCode: visit.statecode,
              statusCode: visit.statuscode,
              correctionEpoch,
              initialState,
              errorCode,
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
}

function transientFailure(error) {
  const status = Number(error?.status || error?.httpStatus || 0);
  return status === 412 || status === 429 || status >= 500
    || ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'fetch_failed'].includes(error?.code);
}

async function processReceipt(receipt, dependencies) {
  const request = await dependencies.getRequest(receipt.request_id);
  if (!request || !testRequestCountsAsOrdinary(request)
    || !dependencies.config.programIds.includes(String(request._wmkf_grantprogram_value || '').toLowerCase())
    || !dependencies.config.requestStatuses.includes(String(request.akoya_requeststatus || '').trim())) {
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
    const invalidSchedule = !freshRequest || !testRequestCountsAsOrdinary(freshRequest)
      || !dependencies.config.programIds.includes(String(freshRequest._wmkf_grantprogram_value || '').toLowerCase())
      || !dependencies.config.requestStatuses.includes(String(freshRequest.akoya_requeststatus || '').trim())
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
  const correctionEpoch = currentArtifact?.correction?.cycleId || '';
  if (correctionEpoch) {
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
      provenance: { principal: 'vercel-cron', operation: 'reconciled-complete-handoff' },
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
    const generated = await dependencies.generate({
      requestId: receipt.request_id,
      generationMode: 'missing-only',
      runSource: 'Vercel Scheduled Staff Deliberations Preparation',
      assertEligibleBeforeModel: assertCurrentSchedule,
    });
    artifact = generated?.artifact || null;
    if (artifact?.operationStatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
      return dependencies.finishReceipt(receipt.id, receipt.lease_token, {
        state: 'pending', retryAfterMs: 30_000, errorCode: 'generation_in_progress',
        provenance: { principal: 'vercel-cron', operation: 'missing-only-generation' },
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
      provenance: { principal: 'vercel-cron', operation: 'generated-foundation-retained' },
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
    eligibility: dependencies.config,
  });
  if (promoted?.artifact?.lifecycleState !== REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW) {
    return dependencies.finishReceipt(receipt.id, receipt.lease_token, {
      state: 'blocked', errorCode: 'promotion_readback_incomplete',
    });
  }
  return dependencies.finishReceipt(receipt.id, receipt.lease_token, {
    state: 'prepared', documentId: artifact.artifactId,
    provenance: {
      principal: 'vercel-cron', operation: 'scheduled-end-preparation',
      siteVisitId: receipt.site_visit_id,
      scheduledEnd: new Date(receipt.scheduled_end).toISOString(),
      documentId: artifact.artifactId,
    },
  });
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
        : receiptMatchesDocument ? receipt.state : receiptMatchesEvent && receipt.state === 'prepared'
        ? 'blocked' : due ? 'due' : 'none',
      due,
      automationActive: config.active === true,
      blockedBy: config.blockedBy || [],
      scheduledEndIso: display?.scheduledend || null,
      documentId: receiptMatchesDocument ? receipt.documentId : null,
      errorCode: receiptMatchesDocument ? receipt.errorCode
        : receiptMatchesEvent && receipt.state === 'prepared' ? 'document_pointer_changed'
          : receiptMatchesEvent ? receipt.errorCode : null,
      attemptCount: receiptMatchesEvent ? receipt.attemptCount : 0,
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

export async function requestPreparationRetry(requestId, dependencies = DEFAULT_DEPENDENCIES) {
  const config = dependencies.config || readPreparationConfig();
  dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies, config };
  if (!config.active) {
    throw new ServiceHttpError('Scheduled preparation is disabled or not fully configured.', {
      httpStatus: 409, code: 'preparation_automation_disabled',
    });
  }
  const request = await dependencies.getRequest(requestId);
  const cycleCode = meetingDateToCycleCode(request?.wmkf_meetingdate);
  if (!request || !testRequestCountsAsOrdinary(request)
    || !config.programIds.includes(String(request._wmkf_grantprogram_value || '').toLowerCase())
    || !config.cycleCodes.includes(cycleCode)
    || !config.requestStatuses.includes(String(request.akoya_requeststatus || '').trim())) {
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
  if (status.currentArtifact?.correction?.cycleId) {
    throw new ServiceHttpError('Staff must finish the reopened correction before automatic preparation can resume.', {
      httpStatus: 409, code: 'preparation_correction_requires_staff',
    });
  }
  const queued = await dependencies.retryReceipt(
    requestId, eligible[0].activityid, eligible[0].scheduledend, '',
  );
  if (!queued) {
    throw new ServiceHttpError('There is no blocked preparation for the current schedule to retry.', {
      httpStatus: 409, code: 'preparation_retry_not_available',
    });
  }
  return { success: true, queued: true, requestId, siteVisitId: eligible[0].activityid };
}

export async function drainStaffDeliberationsPreparations(dependencies = DEFAULT_DEPENDENCIES) {
  const config = dependencies.config || readPreparationConfig();
  dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies, config };
  if (!config.active) return { status: 'disabled', blockedBy: config.blockedBy };
  const report = { status: 'completed', scanned: 0, prepared: 0, blocked: 0, retried: 0, outcomes: [] };
  await scanDueReceipts(dependencies, report);
  for (let index = 0; index < config.batchSize; index += 1) {
    const receipt = await dependencies.claimReceipt();
    if (!receipt) break;
    try {
      const outcome = await processReceipt(receipt, dependencies);
      if (outcome?.state === 'prepared') report.prepared += 1;
      else if (outcome?.state === 'blocked') report.blocked += 1;
      else report.retried += 1;
      report.outcomes.push({ receiptId: receipt.id, state: outcome?.state || 'unknown' });
    } catch (error) {
      const retry = transientFailure(error) && Number(receipt.attempt_count) < 5;
      const outcome = await dependencies.finishReceipt(receipt.id, receipt.lease_token, {
        state: retry ? 'pending' : 'blocked',
        retryAfterMs: retry ? Math.min(300_000, 30_000 * (2 ** Number(receipt.attempt_count || 0))) : null,
        errorCode: error?.code || 'preparation_failed',
        errorMessage: error?.message,
        provenance: { principal: 'vercel-cron', operation: 'scheduled-end-preparation' },
      }).catch(() => null);
      if (retry) report.retried += 1;
      else report.blocked += 1;
      report.outcomes.push({ receiptId: receipt.id, state: outcome?.state || (retry ? 'pending' : 'blocked') });
    }
  }
  return report;
}

export const _internal = { requestFilter, scanDueReceipts, processReceipt, transientFailure };
