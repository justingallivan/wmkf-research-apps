/**
 * Cycle-wide Staff Deliberations list — every request in a cycle that has a
 * Pre-Site Visit Word draft, with the request's current draft and its stage.
 *
 * Read-only. Reads `wmkf_requestdocument` rows of the Pre Site Visit artifact
 * type stamped with the cycle, drops distribution snapshots (frozen DOCX/PDF
 * copies) and superseded rows, groups by request, and picks each request's
 * canonical row: the `akoya_request.wmkf_CurrentPreSiteVisit` pointer when it
 * resolves among the rows, else the newest active Word row (a draft that is
 * still generating, or a failed attempt with no Ready row yet).
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
  DELIBERATION_STAGE_KEYS,
  deriveDeliberationStage,
} from '../../../shared/utils/deliberation-stage.js';
import { readDeliberationStageLabels } from '../deliberation-stage-labels.js';
import {
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_LABEL,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_LABEL,
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
  return row.wmkf_contenttype === PRE_SITE_VISIT_CONTRACT.contentType
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

function projectRow(row, request, isCurrent, { siteVisitStartIso, siteVisit, everSent }) {
  const operationLabel = requestDocumentLabel(REQUEST_DOCUMENT_OPERATION_LABEL, row.wmkf_operationstatus);
  const lifecycleLabel = requestDocumentLabel(REQUEST_DOCUMENT_LIFECYCLE_LABEL, row.wmkf_lifecyclestate);
  if (!operationLabel || !lifecycleLabel) {
    throw new ServiceHttpError('Request document registry contains an unknown contract value.', {
      httpStatus: 500,
    });
  }
  const { stage, substate, visit } = deriveDeliberationStage({
    currentArtifact: currentArtifactShape(row),
    siteVisitStartIso,
    everSent,
  });
  return {
    artifactId: row.wmkf_requestdocumentid,
    requestId: row._wmkf_request_value,
    requestNumber: request.akoya_requestnum || null,
    title: request.akoya_title || null,
    institution: requestInstitution(request) || null,
    programDirector: request._wmkf_programdirector_value_formatted || null,
    programDirectorId: request._wmkf_programdirector_value || null,
    isCurrent,
    operationStatus: row.wmkf_operationstatus,
    operationLabel,
    lifecycleState: row.wmkf_lifecyclestate,
    lifecycleLabel,
    stage,
    substate,
    visit,
    everSent,
    siteVisit,
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
      counts: Object.fromEntries(DELIBERATION_STAGE_KEYS.map((key) => [key, 0])),
      artifacts: [],
    };
  }

  const result = await requestDocumentAdapter.findByCycle(code, {
    artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
  });
  const byRequest = new Map();
  for (const row of result.records || []) {
    if (!row._wmkf_request_value || !isActiveWordDraft(row)) continue;
    const key = String(row._wmkf_request_value).toLowerCase();
    if (!byRequest.has(key)) byRequest.set(key, []);
    byRequest.get(key).push(row);
  }
  const requestIds = [...byRequest.keys()];
  const requests = [];
  for (let index = 0; index < requestIds.length; index += REQUEST_BATCH) {
    const batch = requestIds.slice(index, index + REQUEST_BATCH);
    const batchResult = await grantRequestAdapter.findByIds(batch, {
      select: REQUEST_SELECT,
      top: batch.length,
    });
    requests.push(...(batchResult.records || []));
  }
  const byId = new Map(requests.map((request) => [String(request.akoya_requestid).toLowerCase(), request]));

  // Resolve the chosen (pointer-or-newest) row per request before joining the
  // site visit and distribution reads, so both joins run once per request,
  // not once per candidate row.
  const chosenByRequest = new Map();
  for (const [ownerId, rows] of byRequest.entries()) {
    const request = byId.get(ownerId);
    if (!request) {
      throw new ServiceHttpError('Pre-Site registry owner request could not be resolved.', {
        httpStatus: 500,
      });
    }
    if (scope === 'my' && !sameId(request._wmkf_programdirector_value, callerSystemId)) continue;
    rows.sort(newestFirst);
    const pointerId = request._wmkf_currentpresitevisit_value || null;
    const current = pointerId
      ? rows.find((row) => sameId(row.wmkf_requestdocumentid, pointerId)) || null
      : null;
    const chosen = current || rows[0];
    chosenByRequest.set(ownerId, { request, row: chosen, isCurrent: Boolean(current) });
  }

  const chosenEntries = [...chosenByRequest.values()];
  const requestIdsForVisit = chosenEntries.map((entry) => entry.request.akoya_requestid);
  const sourceDocumentIds = chosenEntries.map((entry) => entry.row.wmkf_requestdocumentid);

  const [siteVisitRows, sentIds] = await Promise.all([
    siteVisitAdapter.findActiveByRequests(requestIdsForVisit),
    sentSourceDocumentIds(sourceDocumentIds),
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
  for (const [ownerId, { request, row, isCurrent }] of chosenByRequest.entries()) {
    const visitRow = visitByRequest.get(ownerId) || null;
    const siteVisit = visitRow ? {
      startIso: visitRow.scheduledstart || null,
      endIso: visitRow.scheduledend || null,
      format: visitRow.wmkf_visitformat ?? null,
      locationOrLink: visitRow.wmkf_locationorlink || null,
    } : null;
    const everSent = sentIds.has(row.wmkf_requestdocumentid);
    artifacts.push(projectRow(row, request, isCurrent, {
      siteVisitStartIso: siteVisit?.startIso || null,
      siteVisit,
      everSent,
    }));
  }
  artifacts.sort((left, right) => String(left.requestNumber || '').localeCompare(String(right.requestNumber || '')));

  const counts = Object.fromEntries(DELIBERATION_STAGE_KEYS.map((key) => [
    key,
    artifacts.filter((artifact) => artifact.stage === key).length,
  ]));

  return { success: true, cycleCode: code, scope, stageLabels, counts, artifacts };
}
