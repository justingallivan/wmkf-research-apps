/**
 * Request-first Staff Deliberations list for the selected program and cycle.
 * Optional brief, writeup, schedule, sharing and preparation facts are joined
 * after the complete request cohort is read, so documentless requests remain
 * visible and “my” scope is applied to request ownership rather than artifacts.
 *
 * Per request (plan docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md
 * §3.5), the stage source is: the brief pointer target when it resolves
 * among the brief rows (Ready, Draft|Review); else, when the pointer is
 * missing/invalid and an orphaned Ready brief row exists, that row flagged
 * for reconciliation (never a Ready row picked by recency); else the newest
 * non-Ready/non-superseded brief row (a draft still generating, or a failed
 * attempt); else — only when the request has no brief rows at all (legacy) —
 * the `akoya_request.wmkf_CurrentPreSiteVisit` pointer when it resolves
 * among the Pre-Site rows, else the newest active Pre-Site Word row.
 * `finalReached` resolves the Pre-Site pointer separately and accepts its
 * READY/FINAL target, so a newer failed row cannot hide the Final source;
 * when no pointer exists, legacy recency behavior remains. This signal is
 * independent of which rail supplies the stage source because Final Writeup
 * activation marks the Pre-Site row, not the brief
 * (`lib/services/final-writeup/transition-service.js:653-669`).
 *
 * Rows come back with registry-snapshot file metadata only (no Graph
 * read-through), so the panel renders "recorded link" affordances. A row whose
 * owner request cannot be resolved is a registry fault and fails the list
 * rather than silently disappearing from it.
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import * as siteVisitAdapter from '../../dataverse/adapters/site-visit.js';
import { sentSourceDocumentIds, sentSourceVersionReceipts } from './distribution-store.js';
import { ServiceHttpError } from '../service-http-error.js';
import { requestInstitution } from '../../../shared/utils/institution.js';
import { isGuid } from '../../utils/guid.js';
import { cycleCodeToOdataFilter } from '../../utils/cycle-code.js';
import { buildVisibilityFilter } from '../../../shared/config/workbenchVisibility.js';
import { readScheduledPreparationStateStatusPairs } from '../../../shared/config/siteVisit.js';
import {
  projectDeliberationSession,
  DELIBERATION_STAGE_KEYS,
  deriveDeliberationStage,
  visitExpected,
} from '../../../shared/utils/deliberation-stage.js';
import { getDeliberationScheduleByRequestsWithAvailability } from '../meeting-tracker/schedule-reader.js';
import { getMaterialsSummaryByRequestsWithAvailability } from '../site-visit-materials/summary-reader.js';
import { resolveWorkbenchProgramScope } from '../workbench/program-scope-service.js';
import { readDeliberationStageLabels } from '../deliberation-stage-labels.js';
import { listPreparationsForSchedules } from './preparation-store.js';
import { readPreparationConfig, requestMatchesPreparationAllowlists } from './preparation-config.js';
import { canSeeDraftWriteup, isDraftWriteupLifecycle } from './writeup-visibility.js';
import { testRequestCountsAsOrdinary, testRequestVisibilityDto, withTestRequestIsolationSelect } from '../test-requests/isolation.js';
import {
  PRE_RP_BRIEF_CONTRACT,
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_LABEL,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_LABEL,
  REQUEST_DOCUMENT_OPERATION_STATUS,
  isPreSiteDistributionSnapshot,
  requestDocumentLabel,
} from '../../../shared/config/requestDocument.js';

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_programdirector_value',
  '_wmkf_projectleader_value',
  '_wmkf_grantprogram_value',
  'wmkf_meetingdate',
  'akoya_requeststatus',
  '_wmkf_currentpresitevisit_value',
  '_wmkf_currentprerpbrief_value',
  '_wmkf_currentfinalwriteup_value',
].join(',');

// DynamicsService.queryRecords clamps a page to 100 rows; keep the OR filter
// and requested page below that so a cycle list cannot omit request pointers.
const CYCLE_CODE_RE = /^[JD]\d{2}$/i;

function sameId(left, right) {
  return Boolean(left) && Boolean(right)
    && String(left).toLowerCase() === String(right).toLowerCase();
}

function newestFirst(left, right) {
  const time = Date.parse(right.createdon || '') - Date.parse(left.createdon || '');
  if (Number.isFinite(time) && time !== 0) return time;
  return String(right.wmkf_requestdocumentid).localeCompare(String(left.wmkf_requestdocumentid));
}

function isPreSiteWriteupRow(row) {
  return row.wmkf_artifacttype === REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT
    && !isPreSiteDistributionSnapshot(row);
}

function isActiveWordDraft(row) {
  return row.wmkf_artifacttype === REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT
    && row.wmkf_contenttype === PRE_SITE_VISIT_CONTRACT.contentType
    && !isPreSiteDistributionSnapshot(row)
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED;
}

function isActiveBriefRow(row) {
  return row.wmkf_artifacttype === REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_RESEARCH_PRESENTATION_BRIEF
    && row.wmkf_contenttype === PRE_RP_BRIEF_CONTRACT.contentType
    && !isPreSiteDistributionSnapshot(row)
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED;
}

function isActiveFinalRow(row) {
  return row.wmkf_artifacttype === REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP
    && !isPreSiteDistributionSnapshot(row)
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED;
}

function currentArtifactShape(row) {
  return {
    lifecycleState: row.wmkf_lifecyclestate,
    operationStatus: row.wmkf_operationstatus,
    file: row.wmkf_sharepointitemid ? { webUrl: row.wmkf_sharepointweburl || null } : null,
  };
}

/**
 * Resolve a request's canonical row among a set of same-owner rows: the
 * request's pointer target when it resolves among `rows` and is Ready with
 * a Draft/Review lifecycle, else null. `rows` must already be sorted
 * newest-first.
 */
function resolvePointerRow(rows, pointerId) {
  if (!pointerId) return null;
  const row = rows.find((candidate) => sameId(candidate.wmkf_requestdocumentid, pointerId));
  if (!row
    || row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
    || ![REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW]
      .includes(row.wmkf_lifecyclestate)) {
    return null;
  }
  return row;
}

function resolveFinalPointerRow(rows, pointerId) {
  if (!pointerId) return null;
  const row = rows.find((candidate) => sameId(candidate.wmkf_requestdocumentid, pointerId));
  if (!row
    || row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
    || row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL) {
    return null;
  }
  return row;
}

/**
 * Plan §3.5 stage-source resolution for one request: prefer the brief rail,
 * falling back to the legacy Pre-Site rail only when the request has no
 * brief rows at all. `preSiteRows`/`briefRows` must already be sorted
 * newest-first (mutated in place by the caller before this runs).
 */
function resolveStageSource({ request, preSiteRows, briefRows }) {
  const preSitePointerId = request._wmkf_currentpresitevisit_value || null;
  const preSitePointerRow = resolvePointerRow(preSiteRows, preSitePointerId);
  // Final activation keeps the request pointer on the Pre-Site source while
  // changing that row to READY/FINAL. Resolve that fact independently from
  // the Draft/Review stage-source resolver: a newer failed attempt must never
  // hide a valid FINAL pointer target through the recency fallback below.
  const preSiteFinalPointerRow = resolveFinalPointerRow(preSiteRows, preSitePointerId);
  const preSiteChosen = preSitePointerRow || preSiteFinalPointerRow || preSiteRows[0] || null;
  const finalReached = Boolean(preSiteFinalPointerRow)
    || (!preSitePointerId
      && preSiteChosen?.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL);

  if (briefRows.length === 0) {
    // Legacy: no brief rows at all — today's Pre-Site derivation, unchanged.
    return {
      row: preSiteChosen,
      isCurrent: Boolean(preSitePointerRow || preSiteFinalPointerRow),
      needsReconciliation: false,
      finalReached,
    };
  }

  const briefPointerId = request._wmkf_currentprerpbrief_value || null;
  const briefPointerRow = briefPointerId
    ? briefRows.find((candidate) => sameId(candidate.wmkf_requestdocumentid, briefPointerId)) || null
    : null;
  const validPointerRow = briefPointerRow ? resolvePointerRow(briefRows, briefPointerId) : null;

  if (briefPointerId) {
    if (validPointerRow) {
      return { row: validPointerRow, isCurrent: true, needsReconciliation: false, finalReached };
    }
    // Pointer set but does not resolve to a Ready Draft/Review brief row —
    // reconciliation, never a Ready row picked by recency.
    return {
      row: briefPointerRow || briefRows[0],
      isCurrent: false,
      needsReconciliation: true,
      finalReached,
    };
  }

  const orphanedReady = briefRows.find((row) => row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY);
  if (orphanedReady) {
    return { row: orphanedReady, isCurrent: false, needsReconciliation: true, finalReached };
  }
  // No pointer, no orphaned Ready row: newest non-Ready/non-superseded brief
  // pending attempt (generating or failed).
  return { row: briefRows[0], isCurrent: false, needsReconciliation: false, finalReached };
}

function projectRow(row, request, { isCurrent, needsReconciliation, finalReached }, {
  siteVisitStartIso, siteVisit, everSent, session = null, materials = null,
}) {
  const operationLabel = requestDocumentLabel(REQUEST_DOCUMENT_OPERATION_LABEL, row.wmkf_operationstatus);
  const lifecycleLabel = requestDocumentLabel(REQUEST_DOCUMENT_LIFECYCLE_LABEL, row.wmkf_lifecyclestate);
  if (!operationLabel || !lifecycleLabel) {
    throw new ServiceHttpError('Request document registry contains an unknown contract value.', {
      httpStatus: 500,
    });
  }
  const derived = deriveDeliberationStage({
    stageArtifact: currentArtifactShape(row),
    finalReached,
    siteVisitStartIso,
    everSent,
  });
  // A pointer that does not resolve to a usable row is a registry fault, not
  // a normal stage: fail closed to 'beyond' rather than deriving a stage from
  // whatever row happened to be picked for its file/label metadata.
  const { stage, substate, visit } = needsReconciliation
    ? { ...derived, stage: 'beyond', substate: 'pointer-invalid' }
    : derived;
  return {
    artifactId: row.wmkf_requestdocumentid,
    requestId: row._wmkf_request_value,
    requestNumber: request.akoya_requestnum || null,
    title: request.akoya_title || null,
    institution: requestInstitution(request) || null,
    programDirector: request._wmkf_programdirector_value_formatted || null,
    projectLeader: request._wmkf_projectleader_value_formatted || null,
    ...testRequestVisibilityDto(request),
    isCurrent,
    needsReconciliation,
    operationStatus: row.wmkf_operationstatus,
    operationLabel,
    lifecycleState: row.wmkf_lifecyclestate,
    lifecycleLabel,
    stage,
    substate,
    visit,
    everSent,
    siteVisit,
    session,
    materials,
    sharedAtIso: row.wmkf_milestonecreatedat || null,
    file: row.wmkf_sharepointitemid ? {
      webUrl: row.wmkf_sharepointweburl || null,
      name: row.wmkf_filename || null,
      size: row.wmkf_filesize ?? null,
      versionId: row.wmkf_sharepointversionid || null,
      lastModified: row.wmkf_sharepointlastmodified || null,
      metadataStatus: 'unchecked',
    } : null,
  };
}

export async function listPreSiteVisitDrafts({
  cycleCode, programId, scope = 'all', callerSystemId = null, writeupViewer = null,
}) {
  const code = String(cycleCode || '').trim().toUpperCase();
  if (!CYCLE_CODE_RE.test(code)) {
    throw new ServiceHttpError('cycleCode is invalid', { httpStatus: 400 });
  }
  if (!isGuid(programId)) {
    throw new ServiceHttpError('programId must be a valid Grant Program GUID', { httpStatus: 400 });
  }
  const stageLabels = await readDeliberationStageLabels();
  const programScope = await resolveWorkbenchProgramScope({ callerSystemId, programId });

  // Fail closed like the dashboard's own scope=my: no caller identity means
  // an empty "my" list rather than an unscoped one.
  if (scope === 'my' && !isGuid(callerSystemId)) {
    return {
      success: true,
      cycleCode: code,
      programId,
      scope,
      serverNowIso: new Date().toISOString(),
      stageLabels,
      counts: Object.fromEntries(
        DELIBERATION_STAGE_KEYS.filter((key) => key !== 'visit' || visitExpected()).map((key) => [key, 0]),
      ),
      requestCounts: { total: 0, ordinary: 0, test: 0 },
      artifacts: [],
      completeness: { requests: true, documents: true, schedule: true, capped: false },
    };
  }

  const requestFilters = [
    cycleCodeToOdataFilter(code),
    `_wmkf_grantprogram_value eq ${programScope.programId}`,
    buildVisibilityFilter(false),
    ...(scope === 'my' ? [`_wmkf_programdirector_value eq ${callerSystemId}`] : []),
  ];
  const requestResult = await grantRequestAdapter.queryAllRequests({
    select: withTestRequestIsolationSelect(REQUEST_SELECT),
    filter: requestFilters.map((filter) => `(${filter})`).join(' and '),
    orderby: 'akoya_requestnum asc',
  });
  if (requestResult?.capped || requestResult?.hasMore) {
    throw new ServiceHttpError('The selected program and cycle exceed the complete request-list limit.', {
      httpStatus: 503,
      code: 'staff_deliberations_requests_capped',
    });
  }
  const requests = requestResult.records || [];
  const requestIds = requests.map((request) => request.akoya_requestid).filter(Boolean);
  const [preSiteResult, briefResult, finalResult] = await Promise.all([
    requestDocumentAdapter.findByRequests(requestIds, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
      includeGuardedReopen: true,
    }),
    requestDocumentAdapter.findByRequests(requestIds, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_RESEARCH_PRESENTATION_BRIEF,
    }),
    requestDocumentAdapter.findByRequests(requestIds, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP,
    }),
  ]);
  if (preSiteResult?.capped || briefResult?.capped || finalResult?.capped) {
    throw new ServiceHttpError('The selected requests have more documents than the complete list can read.', {
      httpStatus: 503,
      code: 'staff_deliberations_documents_capped',
    });
  }

  function groupActive(rows, isActive) {
    const grouped = new Map();
    for (const row of rows || []) {
      if (!row._wmkf_request_value || !isActive(row)) continue;
      const key = String(row._wmkf_request_value).toLowerCase();
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    return grouped;
  }

  const preSiteByRequest = groupActive(preSiteResult.records, isActiveWordDraft);
  const briefByRequest = groupActive(briefResult.records, isActiveBriefRow);
  const finalByRequest = groupActive(finalResult.records, isActiveFinalRow);
  // Union: a brief-only request has no Pre-Site rows and vice versa (legacy).
  const byId = new Map(requests.map((request) => [String(request.akoya_requestid).toLowerCase(), request]));

  // Resolve the chosen stage-source row per request (§3.5) before joining the
  // site visit and distribution reads, so both joins run once per request,
  // not once per candidate row.
  const chosenByRequest = new Map();
  for (const ownerId of requestIds.map((id) => String(id).toLowerCase())) {
    const request = byId.get(ownerId);
    if (!request) continue;
    const preSiteRows = preSiteByRequest.get(ownerId) || [];
    const briefRows = briefByRequest.get(ownerId) || [];
    preSiteRows.sort(newestFirst);
    briefRows.sort(newestFirst);
    const { row, isCurrent, needsReconciliation, finalReached } = resolveStageSource({
      request,
      preSiteRows,
      briefRows,
    });
    chosenByRequest.set(ownerId, row ? {
      request, row, isCurrent, needsReconciliation, finalReached,
    } : { request, row: null, isCurrent: false, needsReconciliation: false, finalReached: false });
  }

  const chosenEntries = [...chosenByRequest.values()];
  const requestIdsForVisit = chosenEntries.map((entry) => entry.request.akoya_requestid);
  const allActiveDocumentIds = [...preSiteResult.records, ...briefResult.records]
    .filter((row) => isActiveWordDraft(row) || isActiveBriefRow(row))
    .map((row) => row.wmkf_requestdocumentid);
  const sourceDocumentIds = chosenEntries.filter((entry) => entry.row).map((entry) => entry.row.wmkf_requestdocumentid);

  const [siteVisitResult, sentResult, sentVersionResult, scheduleResult, materialsResult] = await Promise.all([
    siteVisitAdapter.findSummariesByRequests(requestIdsForVisit),
    sentSourceDocumentIds(sourceDocumentIds).then((ids) => ({ ids, available: true }))
      .catch(() => ({ ids: new Set(), available: false })),
    sentSourceVersionReceipts(allActiveDocumentIds).then((receipts) => ({ receipts, available: true }))
      .catch(() => ({ receipts: new Map(), available: false })),
    getDeliberationScheduleByRequestsWithAvailability(requestIdsForVisit),
    getMaterialsSummaryByRequestsWithAvailability({
      requestIds: requestIdsForVisit,
      requestNumbers: new Map(chosenEntries.map((entry) => [entry.request.akoya_requestid, entry.request.akoya_requestnum])),
      cycleCode: code,
    }),
  ]);
  if (siteVisitResult?.capped || siteVisitResult?.hasMore) {
    throw new ServiceHttpError('The Site Visit schedule is incomplete; reload to retry.', {
      httpStatus: 503,
      code: 'staff_deliberations_schedule_capped',
    });
  }
  const siteVisitRows = siteVisitResult?.records || [];
  const scheduleByRequest = scheduleResult.schedules;
  const materialsByRequest = materialsResult.summaries;
  const visitByRequest = new Map();
  for (const visitRow of siteVisitRows) {
    const key = String(visitRow._regardingobjectid_value || '').toLowerCase();
    if (!key) continue;
    // D3-adjacent: keep the soonest-scheduled active visit per request.
    const existing = visitByRequest.get(key);
    if (!existing || Date.parse(visitRow.scheduledstart || '') < Date.parse(existing.scheduledstart || '')) {
      visitByRequest.set(key, visitRow);
    }
  }

  const stateStatusPairs = readScheduledPreparationStateStatusPairs();
  const scheduleReceiptKeys = [];
  for (const requestId of requestIdsForVisit) {
    const rows = siteVisitRows.filter((candidate) => sameId(candidate._regardingobjectid_value, requestId));
    const classifications = rows.map((candidate) => stateStatusPairs.find((pair) => (
      pair.stateCode === Number(candidate.statecode) && pair.statusCode === Number(candidate.statuscode)
    )) || null);
    const eligible = rows.filter((_candidate, index) => classifications[index]?.eligible);
    if (rows.length && classifications.every(Boolean) && eligible.length === 1
      && eligible[0].scheduledend && Number.isFinite(Date.parse(eligible[0].scheduledend))) {
      scheduleReceiptKeys.push({
        requestId,
        siteVisitId: eligible[0].activityid,
        scheduledEnd: eligible[0].scheduledend,
      });
    }
  }
  let preparationMap = null;
  try {
    preparationMap = await listPreparationsForSchedules(scheduleReceiptKeys);
  } catch {
    preparationMap = null;
  }

  const nowMs = Date.now();
  const serverNowIso = new Date(nowMs).toISOString();
  const preparationConfig = readPreparationConfig();
  const artifacts = [];
  for (const [ownerId, {
    request, row, isCurrent, needsReconciliation, finalReached,
  }] of chosenByRequest.entries()) {
    const visitRow = visitByRequest.get(ownerId) || null;
    const siteVisit = visitRow ? {
      startIso: visitRow.scheduledstart || null,
      endIso: visitRow.scheduledend || null,
    } : null;
    const everSent = row && sentResult.ids.has(String(row.wmkf_requestdocumentid).toLowerCase());
    const projected = row ? projectRow(row, request, { isCurrent, needsReconciliation, finalReached }, {
      siteVisitStartIso: siteVisit?.startIso || null,
      siteVisit,
      everSent,
      session: projectDeliberationSession(scheduleByRequest.get(request.akoya_requestid) || null),
      materials: materialsByRequest.get(request.akoya_requestid) || null,
    }) : {
      requestId: request.akoya_requestid,
      requestNumber: request.akoya_requestnum || null,
      title: request.akoya_title || null,
      institution: requestInstitution(request) || null,
      programDirector: request._wmkf_programdirector_value_formatted || null,
      projectLeader: request._wmkf_projectleader_value_formatted || null,
      isTestRequest: testRequestVisibilityDto(request).isTestRequest,
      stage: 'draft',
      substate: 'none',
      isCurrent: false,
      needsReconciliation: false,
      file: null,
      everSent: false,
    };
    const preSiteRows = preSiteByRequest.get(ownerId) || [];
    const briefRows = briefByRequest.get(ownerId) || [];
    const toFact = (rows, pointerId) => {
      let candidate = null;
      let availability = 'missing';
      if (pointerId) {
        const pointer = rows.find((item) => sameId(item.wmkf_requestdocumentid, pointerId)) || null;
        const valid = pointer
          && pointer.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
          && [REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW, REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL]
            .includes(pointer.wmkf_lifecyclestate);
        candidate = valid ? pointer : null;
        availability = valid ? 'available' : 'unavailable';
      } else if (rows.length === 1 && rows[0].wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
        availability = 'pending';
        return { availability, artifactId: null, lifecycleState: null,
          operationStatus: rows[0].wmkf_operationstatus, file: null };
      } else if (rows.some((item) => item.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY)) {
        availability = 'unavailable';
      } else if (rows.length > 0) {
        availability = 'ambiguous';
      }
      return candidate ? ({
        availability,
        artifactId: candidate.wmkf_requestdocumentid,
        lifecycleState: candidate.wmkf_lifecyclestate,
        operationStatus: candidate.wmkf_operationstatus,
        file: candidate.wmkf_sharepointitemid ? {
          webUrl: candidate.wmkf_sharepointweburl || null,
          name: candidate.wmkf_filename || null,
          versionId: candidate.wmkf_sharepointversionid || null,
        } : null,
        milestone: candidate.wmkf_milestoneversionid || candidate.wmkf_milestonecontenthash
          || candidate.wmkf_milestonecreatedat ? {
            versionId: candidate.wmkf_milestoneversionid || null,
            contentHash: candidate.wmkf_milestonecontenthash || null,
            createdAt: candidate.wmkf_milestonecreatedat || null,
          } : null,
      }) : ({ availability, artifactId: pointerId || null, lifecycleState: null, operationStatus: null, file: null, milestone: null });
    };
    const scheduleRows = siteVisitRows.filter((candidate) => sameId(candidate._regardingobjectid_value, request.akoya_requestid));
    const classifiedRows = scheduleRows.map((candidate) => ({
      candidate,
      classification: stateStatusPairs.find((pair) => pair.stateCode === Number(candidate.statecode)
        && pair.statusCode === Number(candidate.statuscode)) || null,
    }));
    const classificationComplete = classifiedRows.every(({ classification }) => classification);
    const eligibleScheduleRows = classifiedRows
      .filter(({ classification }) => classification?.eligible)
      .map(({ candidate }) => candidate);
    const schedule = classificationComplete && eligibleScheduleRows.length === 1
      ? eligibleScheduleRows[0] : null;
    const displaySchedule = schedule || (scheduleRows.length === 1 ? scheduleRows[0] : null);
    const endMs = Date.parse(schedule?.scheduledend || '');
    const due = Boolean(schedule && Number.isFinite(endMs) && endMs <= nowMs);
    projected.programId = request._wmkf_grantprogram_value || null;
    projected.brief = toFact(briefRows, request._wmkf_currentprerpbrief_value);
    projected.writeup = toFact(preSiteRows, request._wmkf_currentpresitevisit_value);
    projected.writeup.milestoneComplete = Boolean(projected.writeup.availability === 'available'
      && projected.writeup.milestone?.versionId
      && projected.writeup.milestone?.contentHash
      && projected.writeup.milestone?.createdAt
      && projected.writeup.file?.versionId === projected.writeup.milestone.versionId);
    // The lead PD drafts alone until group review (writeup-visibility.js);
    // milestoneComplete above is computed before the file is withheld.
    if (!canSeeDraftWriteup(writeupViewer, request._wmkf_programdirector_value)) {
      if (isDraftWriteupLifecycle(projected.writeup.lifecycleState) && projected.writeup.file) {
        projected.writeup = { ...projected.writeup, file: null, fileHidden: true };
      }
      if (row && isPreSiteWriteupRow(row) && isDraftWriteupLifecycle(row.wmkf_lifecyclestate) && projected.file) {
        projected.file = null;
        projected.fileHidden = true;
      }
    }
    projected.timing = {
      availability: scheduleRows.length === 0 ? 'missing'
        : !classificationComplete ? 'unavailable'
          : eligibleScheduleRows.length > 1 ? 'ambiguous'
            : eligibleScheduleRows.length === 0 ? 'missing'
              : schedule && Number.isFinite(endMs) ? 'available' : 'unavailable',
      startIso: displaySchedule?.scheduledstart || null,
      endIso: displaySchedule?.scheduledend || null,
      timeZone: displaySchedule?.wmkf_ianatimezone || null,
      stateCode: displaySchedule?.statecode ?? null,
      statusCode: displaySchedule?.statuscode ?? null,
    };
    const preparationReceipt = preparationMap?.get(ownerId) || null;
    const preparationReceiptMatchesDocument = !preparationReceipt?.documentId
      || sameId(preparationReceipt.documentId, projected.writeup.artifactId);
    const automationCovers = preparationConfig.active
      && testRequestCountsAsOrdinary(request)
      && requestMatchesPreparationAllowlists(request, preparationConfig);
    projected.preparation = {
      // Unfinished work the worker will no longer pick up falls back to the
      // manual path, matching request detail.
      state: !preparationMap ? 'unavailable'
        : ['pending', 'blocked'].includes(preparationReceipt?.state) && !automationCovers ? 'disabled'
          : preparationReceipt && !preparationReceiptMatchesDocument ? 'blocked'
            : preparationReceipt?.state || (due ? (automationCovers ? 'due' : 'disabled') : 'none'),
      due,
      automationActive: preparationConfig.active,
      blockedBy: preparationConfig.blockedBy,
      scheduledEndIso: schedule?.scheduledend || null,
      documentId: preparationReceiptMatchesDocument ? preparationReceipt?.documentId || null : null,
      errorCode: preparationReceiptMatchesDocument ? preparationReceipt?.errorCode || null : 'document_pointer_changed',
      attemptCount: preparationReceipt?.attemptCount || 0,
      updatedAtIso: preparationReceipt?.updatedAtIso || null,
      availability: preparationMap ? 'available' : 'unavailable',
    };
    const finalRows = finalByRequest.get(ownerId) || [];
    const finalPointerId = request._wmkf_currentfinalwriteup_value || null;
    const finalCandidate = finalPointerId
      ? finalRows.find((candidate) => sameId(candidate.wmkf_requestdocumentid, finalPointerId)) || null
      : null;
    const currentSource = preSiteRows.find((candidate) => sameId(
      candidate.wmkf_requestdocumentid, request._wmkf_currentpresitevisit_value,
    ));
    projected.writeup.correctionInProgress = Boolean(currentSource?.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT
      && currentSource?.wmkf_reopencycleid);
    const committedFinal = finalCandidate
      && currentSource?.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL
      && finalCandidate.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
      && [REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW, REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL]
        .includes(finalCandidate.wmkf_lifecyclestate)
      && sameId(finalCandidate._wmkf_sourcedocument_value, currentSource.wmkf_requestdocumentid)
      && sameId(finalCandidate.wmkf_sharepointdriveid, currentSource.wmkf_sharepointdriveid)
      && sameId(finalCandidate.wmkf_sharepointitemid, currentSource.wmkf_sharepointitemid)
      && Boolean(finalCandidate.wmkf_groupreviewstartedat && finalCandidate._wmkf_groupreviewstartedby_value)
      && (finalCandidate.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL
        || Boolean(finalCandidate.wmkf_leadershipreviewstartedat && finalCandidate._wmkf_leadershipreviewstartedby_value));
    projected.finalReview = committedFinal ? {
      availability: 'available',
      phase: finalCandidate.wmkf_leadershipreviewstartedat
        && finalCandidate._wmkf_leadershipreviewstartedby_value ? 'leadership-review' : 'group-review',
      artifactId: finalCandidate.wmkf_requestdocumentid,
      groupReviewStartedAt: finalCandidate.wmkf_groupreviewstartedat,
      leadershipReviewStartedAt: finalCandidate.wmkf_leadershipreviewstartedat || null,
      file: finalCandidate.wmkf_sharepointweburl ? {
        webUrl: finalCandidate.wmkf_sharepointweburl,
        name: finalCandidate.wmkf_filename || null,
        versionId: finalCandidate.wmkf_sharepointversionid || null,
      } : null,
    } : { availability: finalPointerId ? 'unavailable' : 'missing', phase: 'none', artifactId: finalPointerId, file: null };
    projected.finalPhase = projected.finalReview.phase;
    const briefPointer = request._wmkf_currentprerpbrief_value || null;
    const brief = projected.brief;
    const matchingSentReceipt = briefPointer && brief.file?.versionId
      ? (sentVersionResult.receipts.get(String(briefPointer).toLowerCase()) || [])
        .find((receipt) => receipt.versionId === brief.file.versionId) || null
      : null;
    projected.briefSharing = {
      availability: sentVersionResult.available ? 'available' : 'unavailable',
      sentAtIso: matchingSentReceipt?.sentAtIso || null,
      sourceVersionId: matchingSentReceipt?.versionId || null,
      currentVersionSent: Boolean(matchingSentReceipt),
    };
    projected.sessionAvailability = scheduleResult.availability.get(request.akoya_requestid) || 'unavailable';
    projected.materialsAvailability = materialsResult.availability.get(request.akoya_requestid) || 'unavailable';
    projected.sharingAvailability = sentResult.available ? 'available' : 'unavailable';
    projected.session = projectDeliberationSession(scheduleByRequest.get(request.akoya_requestid) || null);
    projected.materials = materialsByRequest.get(request.akoya_requestid) || null;
    artifacts.push(projected);
  }
  artifacts.sort((left, right) => String(left.requestNumber || '').localeCompare(String(right.requestNumber || '')));

  // D8/J27-083: the visit stop is only counted when a visit is expected this
  // cycle (D26: always). J27's "reviewed but not visited" case removes it
  // without a code change beyond flipping visitExpected().
  const countedStageKeys = DELIBERATION_STAGE_KEYS.filter((key) => key !== 'visit' || visitExpected());
  const countedArtifacts = artifacts.filter((artifact) => (
    testRequestCountsAsOrdinary(byId.get(String(artifact.requestId).toLowerCase()))
  ));
  const testCount = artifacts.filter((artifact) => artifact.isTestRequest === true).length;
  const counts = Object.fromEntries(countedStageKeys.map((key) => [
    key,
    countedArtifacts.filter((artifact) => artifact.stage === key).length,
  ]));

  return {
    success: true,
    cycleCode: code,
    programId: programScope.programId,
    scope,
    serverNowIso,
    requestCounts: { total: artifacts.length, ordinary: countedArtifacts.length, test: testCount },
    completeness: { requests: true, documents: true, schedule: true },
    stageLabels,
    counts,
    artifacts,
  };
}
