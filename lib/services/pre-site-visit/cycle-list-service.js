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
import { ServiceHttpError } from '../service-http-error.js';
import { requestInstitution } from '../../../shared/utils/institution.js';
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

function projectRow(row, request, isCurrent) {
  const operationLabel = requestDocumentLabel(REQUEST_DOCUMENT_OPERATION_LABEL, row.wmkf_operationstatus);
  const lifecycleLabel = requestDocumentLabel(REQUEST_DOCUMENT_LIFECYCLE_LABEL, row.wmkf_lifecyclestate);
  if (!operationLabel || !lifecycleLabel) {
    throw new ServiceHttpError('Request document registry contains an unknown contract value.', {
      httpStatus: 500,
    });
  }
  return {
    artifactId: row.wmkf_requestdocumentid,
    requestId: row._wmkf_request_value,
    requestNumber: request.akoya_requestnum || null,
    title: request.akoya_title || null,
    institution: requestInstitution(request) || null,
    programDirector: request._wmkf_programdirector_value_formatted || null,
    isCurrent,
    operationStatus: row.wmkf_operationstatus,
    operationLabel,
    lifecycleState: row.wmkf_lifecyclestate,
    lifecycleLabel,
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

export async function listPreSiteVisitDrafts({ cycleCode }) {
  const code = String(cycleCode || '').trim().toUpperCase();
  if (!CYCLE_CODE_RE.test(code)) {
    throw new ServiceHttpError('cycleCode is invalid', { httpStatus: 400 });
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

  const artifacts = [];
  for (const [ownerId, rows] of byRequest.entries()) {
    const request = byId.get(ownerId);
    if (!request) {
      throw new ServiceHttpError('Pre-Site registry owner request could not be resolved.', {
        httpStatus: 500,
      });
    }
    rows.sort(newestFirst);
    const pointerId = request._wmkf_currentpresitevisit_value || null;
    const current = pointerId
      ? rows.find((row) => sameId(row.wmkf_requestdocumentid, pointerId)) || null
      : null;
    const chosen = current || rows[0];
    artifacts.push(projectRow(chosen, request, Boolean(current)));
  }
  artifacts.sort((left, right) => String(left.requestNumber || '').localeCompare(String(right.requestNumber || '')));
  return { success: true, cycleCode: code, artifacts };
}
