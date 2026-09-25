/**
 * Cycle-wide Staff Deliberations list — every request in a cycle that has a
 * Pre-Research Presentation Brief and/or a Pre-Site Visit Word draft, with
 * the request's current stage source and its stage.
 *
 * Read-only. Reads `wmkf_requestdocument` rows of both the Pre-RP Brief and
 * the Pre Site Visit artifact types stamped with the cycle, drops
 * distribution snapshots (frozen DOCX/PDF copies) and superseded rows,
 * groups by request, and unions the two artifact-type queries so a
 * brief-only request (no Pre-Site row at all) is still listed.
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
import { sentSourceDocumentIds } from './distribution-store.js';
import { ServiceHttpError } from '../service-http-error.js';
import { requestInstitution } from '../../../shared/utils/institution.js';
import {
  projectDeliberationSession,
  DELIBERATION_STAGE_KEYS,
  deriveDeliberationStage,
  visitExpected,
} from '../../../shared/utils/deliberation-stage.js';
import { getDeliberationScheduleByRequests } from '../meeting-tracker/schedule-reader.js';
import { getMaterialsSummaryByRequests } from '../site-visit-materials/summary-reader.js';
import { readDeliberationStageLabels } from '../deliberation-stage-labels.js';
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
  '_wmkf_currentpresitevisit_value',
  '_wmkf_currentprerpbrief_value',
].join(',');

// DynamicsService.queryRecords clamps a page to 100 rows; keep the OR filter
// and requested page below that so a cycle list cannot omit request pointers.
const REQUEST_BATCH = 50;

const CYCLE_CODE_RE = /^[A-Za-z]\d{2}$/;

function sameId(left, right) {
  return Boolean(left) && Boolean(right)
    && String(left).toLowerCase() === String(right).toLowerCase();
}

function newestFirst(left, right) {
  const time = Date.parse(right.createdon || '') - Date.parse(left.createdon || '');
  if (Number.isFinite(time) && time !== 0) return time;
  return String(right.wmkf_requestdocumentid).localeCompare(String(left.wmkf_requestdocumentid));
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

export async function listPreSiteVisitDrafts({ cycleCode, scope = 'all', callerSystemId = null }) {
  const code = String(cycleCode || '').trim().toUpperCase();
  if (!CYCLE_CODE_RE.test(code)) {
    throw new ServiceHttpError('cycleCode is invalid', { httpStatus: 400 });
  }
  const stageLabels = await readDeliberationStageLabels();

  // Fail closed like the dashboard's own scope=my: no caller identity means
  // an empty "my" list rather than an unscoped one.
  if (scope === 'my' && !callerSystemId) {
    return {
      success: true,
      cycleCode: code,
      scope,
      stageLabels,
      counts: Object.fromEntries(
        DELIBERATION_STAGE_KEYS.filter((key) => key !== 'visit' || visitExpected()).map((key) => [key, 0]),
      ),
      artifacts: [],
    };
  }

  const [preSiteResult, briefResult] = await Promise.all([
    requestDocumentAdapter.findByCycle(code, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    }),
    requestDocumentAdapter.findByCycle(code, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_RESEARCH_PRESENTATION_BRIEF,
    }),
  ]);

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
  // Union: a brief-only request has no Pre-Site rows and vice versa (legacy).
  const requestIds = [...new Set([...preSiteByRequest.keys(), ...briefByRequest.keys()])];
  const requests = [];
  for (let index = 0; index < requestIds.length; index += REQUEST_BATCH) {
    const batch = requestIds.slice(index, index + REQUEST_BATCH);
    const batchResult = await grantRequestAdapter.findByIds(batch, {
      select: withTestRequestIsolationSelect(REQUEST_SELECT),
      top: batch.length,
    });
    requests.push(...(batchResult.records || []));
  }
  const byId = new Map(requests.map((request) => [String(request.akoya_requestid).toLowerCase(), request]));

  // Resolve the chosen stage-source row per request (§3.5) before joining the
  // site visit and distribution reads, so both joins run once per request,
  // not once per candidate row.
  const chosenByRequest = new Map();
  for (const ownerId of requestIds) {
    const request = byId.get(ownerId);
    if (!request) {
      throw new ServiceHttpError('Pre-Site registry owner request could not be resolved.', {
        httpStatus: 500,
      });
    }
    if (scope === 'my' && !sameId(request._wmkf_programdirector_value, callerSystemId)) continue;
    const preSiteRows = preSiteByRequest.get(ownerId) || [];
    const briefRows = briefByRequest.get(ownerId) || [];
    preSiteRows.sort(newestFirst);
    briefRows.sort(newestFirst);
    const { row, isCurrent, needsReconciliation, finalReached } = resolveStageSource({
      request,
      preSiteRows,
      briefRows,
    });
    if (!row) continue;
    chosenByRequest.set(ownerId, {
      request, row, isCurrent, needsReconciliation, finalReached,
    });
  }

  const chosenEntries = [...chosenByRequest.values()];
  const requestIdsForVisit = chosenEntries.map((entry) => entry.request.akoya_requestid);
  const sourceDocumentIds = chosenEntries.map((entry) => entry.row.wmkf_requestdocumentid);

  const [siteVisitRows, sentIds, scheduleByRequest, materialsByRequest] = await Promise.all([
    siteVisitAdapter.findActiveByRequests(requestIdsForVisit),
    sentSourceDocumentIds(sourceDocumentIds),
    // Tracker §5.4 reader: fail-open all-null map while the tracker is off.
    getDeliberationScheduleByRequests(requestIdsForVisit).catch(() => new Map()),
    // Applicant materials (plan §16.3, PR 3): same fail-open posture.
    getMaterialsSummaryByRequests({
      requestIds: requestIdsForVisit,
      requestNumbers: new Map(chosenEntries.map((entry) => [entry.request.akoya_requestid, entry.request.akoya_requestnum])),
      cycleCode: code,
    }).catch(() => new Map()),
  ]);
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

  const artifacts = [];
  for (const [ownerId, {
    request, row, isCurrent, needsReconciliation, finalReached,
  }] of chosenByRequest.entries()) {
    const visitRow = visitByRequest.get(ownerId) || null;
    const siteVisit = visitRow ? {
      startIso: visitRow.scheduledstart || null,
      endIso: visitRow.scheduledend || null,
    } : null;
    const everSent = sentIds.has(String(row.wmkf_requestdocumentid).toLowerCase());
    artifacts.push(projectRow(row, request, { isCurrent, needsReconciliation, finalReached }, {
      siteVisitStartIso: siteVisit?.startIso || null,
      siteVisit,
      everSent,
      session: projectDeliberationSession(scheduleByRequest.get(request.akoya_requestid) || null),
      materials: materialsByRequest.get(request.akoya_requestid) || null,
    }));
  }
  artifacts.sort((left, right) => String(left.requestNumber || '').localeCompare(String(right.requestNumber || '')));

  // D8/J27-083: the visit stop is only counted when a visit is expected this
  // cycle (D26: always). J27's "reviewed but not visited" case removes it
  // without a code change beyond flipping visitExpected().
  const countedStageKeys = DELIBERATION_STAGE_KEYS.filter((key) => key !== 'visit' || visitExpected());
  const countedArtifacts = artifacts.filter((artifact) => (
    testRequestCountsAsOrdinary(byId.get(String(artifact.requestId).toLowerCase()))
  ));
  const counts = Object.fromEntries(countedStageKeys.map((key) => [
    key,
    countedArtifacts.filter((artifact) => artifact.stage === key).length,
  ]));

  return { success: true, cycleCode: code, scope, stageLabels, counts, artifacts };
}
