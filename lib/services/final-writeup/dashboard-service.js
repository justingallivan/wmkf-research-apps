/**
 * Final Writeups cross-request dashboard projection (Slice 3 foundation).
 *
 * The service enumerates the bounded set of Requests with a current Final
 * pointer, batch-resolves the exact Request Document and acknowledgement rows,
 * refreshes SharePoint publication metadata with bounded concurrency, and
 * derives the caller's queue membership server-side. It intentionally exposes
 * no PC/leadership persona lens or full coordinator matrix until that separate
 * persona contract exists.
 */

import * as acknowledgementAdapter from '../../dataverse/adapters/final-writeup-review-acknowledgement.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import * as systemUserAdapter from '../../dataverse/adapters/system-user.js';
import { chunk } from '../../utils/chunk.js';
import { cycleCodeToLabel, meetingDateToCycleCode } from '../../utils/cycle-code.js';
import { isFinalWriteupAcknowledgementSchemaReady } from '../../utils/final-writeup-acknowledgement-readiness.js';
import { isGuid } from '../../utils/guid.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import {
  normalizeFinalWriteupPublicationObservation,
  projectFinalWriteupAcknowledgementState,
  resolveCurrentFinalWriteupFromRows,
} from './acknowledgement-service.js';
import {
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
} from '../../../shared/config/requestDocument.js';

export const FINAL_WRITEUPS_DASHBOARD_MAX_ROWS = 100;
const FILE_METADATA_CONCURRENCY = 4;

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  '_wmkf_programdirector_value',
  '_wmkf_currentfinalwriteup_value',
].join(',');

const DEFAULT_DEPENDENCIES = Object.freeze({
  schemaReady: isFinalWriteupAcknowledgementSchemaReady,
  getReviewer: (reviewerId) => systemUserAdapter.getByIdWithSelect(
    reviewerId,
    ['systemuserid', 'fullname', 'isdisabled'],
  ),
  queryRequests: (options) => grantRequestAdapter.queryRequests(options),
  findDocumentsByIds: (ids) => requestDocumentAdapter.findByIds(ids),
  findAcknowledgementsByFinalDocuments: (ids) => (
    acknowledgementAdapter.findByFinalDocuments(ids)
  ),
  getFileMetadataById: (...args) => GraphService.getFileMetadataById(...args),
});

function dashboardError(message, code, httpStatus = 409, extra = {}) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code, ...extra },
  });
}

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function rows(result) {
  return Array.isArray(result?.records) ? result.records : [];
}

function assertReady(dependencies) {
  if (!dependencies.schemaReady?.()) {
    throw dashboardError(
      'Final Writeup review tracking is unavailable until its Dataverse schema is verified.',
      'final_writeups_dashboard_schema_not_ready',
      503,
    );
  }
}

async function resolveViewer(actingUserSystemId, dependencies) {
  if (!isGuid(actingUserSystemId)) {
    throw dashboardError(
      'A resolved staff identity is required to view Final Writeups.',
      'final_writeups_dashboard_actor_required',
      403,
    );
  }
  const reviewer = await dependencies.getReviewer(actingUserSystemId);
  if (!reviewer
    || !sameId(reviewer.systemuserid, actingUserSystemId)
    || reviewer.isdisabled !== false) {
    throw dashboardError(
      'The signed-in staff identity is not an enabled Dataverse user.',
      'final_writeups_dashboard_reviewer_unavailable',
      403,
    );
  }
  return reviewer;
}

async function loadCurrentRequests(dependencies) {
  const result = await dependencies.queryRequests({
    select: REQUEST_SELECT,
    filter: '_wmkf_currentfinalwriteup_value ne null',
    orderby: 'akoya_requestnum asc',
    top: FINAL_WRITEUPS_DASHBOARD_MAX_ROWS,
  });
  if ((result?.totalCount || 0) > FINAL_WRITEUPS_DASHBOARD_MAX_ROWS || result?.hasMore) {
    throw dashboardError(
      `The Final Writeups dashboard supports at most ${FINAL_WRITEUPS_DASHBOARD_MAX_ROWS} current rows.`,
      'final_writeups_dashboard_scope_exceeded',
      503,
      { maximumRows: FINAL_WRITEUPS_DASHBOARD_MAX_ROWS },
    );
  }
  return rows(result);
}

async function loadBatches(ids, batchSize, readBatch, label) {
  const combined = [];
  for (const idBatch of chunk(ids, batchSize)) {
    const result = await readBatch(idBatch);
    if (result?.capped) {
      throw dashboardError(
        `The ${label} projection exceeded its safe read bound.`,
        'final_writeups_dashboard_projection_capped',
        503,
        { projection: label },
      );
    }
    combined.push(...rows(result));
  }
  return combined;
}

async function mapWithConcurrency(items, limit, project) {
  const projected = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      projected[index] = await project(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return projected;
}

function lifecycleStage(finalDocument) {
  if (finalDocument.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW) {
    return { key: 'group-review', label: 'Group review' };
  }
  if (finalDocument.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL) {
    return { key: 'leadership-review', label: 'Leadership review' };
  }
  throw dashboardError(
    'A current Final Writeup has an unsupported lifecycle state.',
    'final_writeups_dashboard_lifecycle_invalid',
    500,
  );
}

function supportLinks(requestId, requestNumber) {
  const encodedId = encodeURIComponent(requestId);
  const numberQuery = requestNumber ? `&n=${encodeURIComponent(requestNumber)}` : '';
  return [
    {
      key: 'proposal',
      label: 'Proposal',
      href: `/workbench/${encodedId}?tab=proposal${numberQuery}`,
    },
    {
      key: 'initial-assessment',
      label: 'Initial Assessment',
      href: `/workbench/${encodedId}?tab=initial-writeup${numberQuery}`,
    },
    {
      key: 'reviews',
      label: 'Reviews',
      href: `/workbench/${encodedId}?tab=reviews${numberQuery}`,
    },
  ];
}

function projectRequestRow({ request, finalDocument, metadata, observation, acknowledgement }) {
  const owner = sameId(request._wmkf_programdirector_value, acknowledgement.actingUserSystemId);
  const stage = lifecycleStage(finalDocument);
  const requestId = request.akoya_requestid;
  const requestNumber = request.akoya_requestnum || null;
  const cycleCode = meetingDateToCycleCode(request.wmkf_meetingdate);
  const bucket = owner
    ? 'stewardship'
    : (acknowledgement.hasAcknowledgement ? 'history' : 'open');
  return {
    requestId,
    requestNumber,
    title: request.akoya_title || null,
    institution: request.wmkf_organizationname
      || request._akoya_applicantid_value_formatted
      || null,
    projectLeader: request._wmkf_projectleader_value_formatted || null,
    responsibleProgramDirector: {
      id: request._wmkf_programdirector_value || null,
      name: request._wmkf_programdirector_value_formatted || null,
    },
    cycleCode,
    cycleLabel: cycleCode ? cycleCodeToLabel(cycleCode) : null,
    relationship: owner ? 'responsible-pd' : 'reviewer',
    bucket,
    stage,
    finalArtifactId: finalDocument.wmkf_requestdocumentid,
    document: {
      url: metadata.webUrl || finalDocument.wmkf_sharepointweburl || null,
      publicationVersionId: observation.publicationVersionId,
      lastModified: observation.lastModified,
    },
    personalState: acknowledgement.personalState,
    acknowledgedAt: acknowledgement.acknowledgedAt,
    mayAcknowledge: acknowledgement.mayAcknowledge,
    reviewers: acknowledgement.reviewers,
    primaryAction: {
      key: owner ? 'edit' : 'review',
      label: owner ? 'Edit in Word' : 'Open review',
    },
    fullRequestHref: `/workbench/${encodeURIComponent(requestId)}?tab=final-writeup`
      + (requestNumber ? `&n=${encodeURIComponent(requestNumber)}` : ''),
    supportingMaterials: supportLinks(requestId, requestNumber),
  };
}

function navigationFor(selected, queues) {
  if (!selected) return null;
  const queue = queues[selected.bucket] || [];
  const index = queue.findIndex((row) => sameId(row.requestId, selected.requestId));
  if (index < 0) return { previous: null, next: null };
  const compact = (row) => (row ? {
    requestId: row.requestId,
    requestNumber: row.requestNumber,
    title: row.title,
  } : null);
  return {
    previous: compact(queue[index - 1]),
    next: compact(queue[index + 1]),
  };
}

/**
 * Return the ordinary Workbench-user Final Writeups lens. `selectedRequestId`
 * narrows only the response shape after the full bounded queue is projected so
 * focused-page previous/next navigation stays server-derived.
 */
export async function loadFinalWriteupsDashboard(
  { actingUserSystemId, selectedRequestId = null },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  assertReady(dependencies);
  if (selectedRequestId !== null && !isGuid(selectedRequestId)) {
    throw dashboardError(
      'selectedRequestId must be a GUID.',
      'final_writeups_dashboard_request_invalid',
      400,
    );
  }
  const [viewer, requests] = await Promise.all([
    resolveViewer(actingUserSystemId, dependencies),
    loadCurrentRequests(dependencies),
  ]);
  const finalIds = requests
    .map((request) => request._wmkf_currentfinalwriteup_value)
    .filter(Boolean);
  const uniqueFinalIds = [...new Set(finalIds.map((id) => String(id).toLowerCase()))];

  const [documents, acknowledgements] = await Promise.all([
    loadBatches(
      uniqueFinalIds,
      requestDocumentAdapter.REQUEST_DOCUMENT_BATCH_MAX_IDS,
      dependencies.findDocumentsByIds,
      'current Final document',
    ),
    loadBatches(
      uniqueFinalIds,
      acknowledgementAdapter.ACKNOWLEDGEMENT_BATCH_MAX_FINAL_IDS,
      dependencies.findAcknowledgementsByFinalDocuments,
      'Final acknowledgement',
    ),
  ]);

  const acknowledgementsByFinal = new Map();
  for (const row of acknowledgements) {
    const finalId = String(row?._wmkf_finaldocument_value || '').toLowerCase();
    if (!acknowledgementsByFinal.has(finalId)) acknowledgementsByFinal.set(finalId, []);
    acknowledgementsByFinal.get(finalId).push(row);
  }

  const metadataFlights = new Map();
  const projected = await mapWithConcurrency(
    requests,
    FILE_METADATA_CONCURRENCY,
    async (request) => {
      const { finalDocument } = resolveCurrentFinalWriteupFromRows({
        requestId: request.akoya_requestid,
        request,
        documents,
      });
      const identity = `${finalDocument.wmkf_sharepointdriveid}:${finalDocument.wmkf_sharepointitemid}`;
      if (!metadataFlights.has(identity)) {
        metadataFlights.set(identity, dependencies.getFileMetadataById(
          finalDocument.wmkf_sharepointdriveid,
          finalDocument.wmkf_sharepointitemid,
          { siteId: finalDocument.wmkf_sharepointsiteid || null },
        ));
      }
      const metadata = await metadataFlights.get(identity);
      const observation = normalizeFinalWriteupPublicationObservation(finalDocument, metadata);
      if (typeof (metadata?.webUrl || finalDocument.wmkf_sharepointweburl) !== 'string'
        || !(metadata.webUrl || finalDocument.wmkf_sharepointweburl).trim()) {
        throw dashboardError(
          'A current Final Writeup has no canonical SharePoint link.',
          'final_writeups_dashboard_document_url_missing',
          500,
        );
      }
      const finalId = String(finalDocument.wmkf_requestdocumentid).toLowerCase();
      const acknowledgement = projectFinalWriteupAcknowledgementState({
        request,
        finalDocument,
        actingUserSystemId,
        observation,
        acknowledgementResult: { records: acknowledgementsByFinal.get(finalId) || [] },
      });
      return projectRequestRow({
        request,
        finalDocument,
        metadata,
        observation,
        acknowledgement: { ...acknowledgement, actingUserSystemId },
      });
    },
  );

  projected.sort((left, right) => (
    String(left.requestNumber || '').localeCompare(String(right.requestNumber || ''))
  ));
  const queues = {
    open: projected.filter((row) => row.bucket === 'open'),
    history: projected.filter((row) => row.bucket === 'history'),
    stewardship: projected.filter((row) => row.bucket === 'stewardship'),
  };
  const selected = selectedRequestId
    ? projected.find((row) => sameId(row.requestId, selectedRequestId)) || null
    : null;
  if (selectedRequestId && !selected) {
    throw dashboardError(
      'No current Final Writeup was found for this request.',
      'final_writeups_dashboard_request_not_found',
      404,
    );
  }

  return {
    success: true,
    viewer: { id: viewer.systemuserid, name: viewer.fullname || null },
    limits: { maximumRows: FINAL_WRITEUPS_DASHBOARD_MAX_ROWS },
    counts: {
      total: projected.length,
      open: queues.open.length,
      history: queues.history.length,
      stewardship: queues.stewardship.length,
    },
    queues,
    selected,
    navigation: navigationFor(selected, queues),
  };
}
