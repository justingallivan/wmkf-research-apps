/**
 * Final Writeups cross-request dashboard projection (Slice 3 foundation).
 *
 * The service enumerates the bounded set of Requests with a current Final
 * pointer, batch-resolves the exact Request Document and acknowledgement rows,
 * refreshes SharePoint publication metadata with bounded concurrency, and
 * derives the caller's queue membership server-side. Superusers also receive
 * a complete request-by-reviewer coordinator matrix. Persona-team membership
 * is multi-valued but remains rollout-disabled until its separate access proof.
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
import { resolveFinalWriteupPersonas } from './persona-service.js';
import {
  normalizeFinalWriteupPublicationObservation,
  projectFinalWriteupAcknowledgementState,
  resolveCurrentFinalWriteupFromRows,
} from './acknowledgement-service.js';
import {
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
} from '../../../shared/config/requestDocument.js';
import {
  FINAL_WRITEUP_REVIEWER_ROLE_NAME,
} from '../../../shared/config/finalWriteupPersonas.js';

export const FINAL_WRITEUPS_DASHBOARD_MAX_ROWS = 100;
export const FINAL_WRITEUPS_COORDINATOR_MAX_REVIEWERS = 50;
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
  resolvePersonas: (reviewerId) => resolveFinalWriteupPersonas(reviewerId),
  listExpectedReviewers: () => systemUserAdapter.listEnabledBySecurityRoleName(
    FINAL_WRITEUP_REVIEWER_ROLE_NAME,
    { top: FINAL_WRITEUPS_COORDINATOR_MAX_REVIEWERS + 1 },
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

function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return `${words[0][0] || ''}${words.length > 1 ? words[words.length - 1][0] || '' : ''}`
    .toUpperCase() || null;
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

async function loadExpectedReviewers(dependencies) {
  const result = await dependencies.listExpectedReviewers();
  if (result?.hasMore
    || (result?.totalCount || 0) > FINAL_WRITEUPS_COORDINATOR_MAX_REVIEWERS
    || rows(result).length > FINAL_WRITEUPS_COORDINATOR_MAX_REVIEWERS) {
    throw dashboardError(
      `The coordinator matrix supports at most ${FINAL_WRITEUPS_COORDINATOR_MAX_REVIEWERS} reviewers.`,
      'final_writeups_dashboard_reviewer_scope_exceeded',
      503,
      { maximumReviewers: FINAL_WRITEUPS_COORDINATOR_MAX_REVIEWERS },
    );
  }
  const reviewers = rows(result).map((reviewer) => ({
    reviewerId: String(reviewer?.systemuserid || '').toLowerCase(),
    name: typeof reviewer?.fullname === 'string' && reviewer.fullname.trim()
      ? reviewer.fullname.trim()
      : null,
    isEnabled: reviewer?.isdisabled === false,
  }));
  if (!reviewers.length
    || reviewers.some((reviewer) => (
      !isGuid(reviewer.reviewerId) || !reviewer.name || !reviewer.isEnabled
    ))
    || new Set(reviewers.map((reviewer) => reviewer.reviewerId)).size !== reviewers.length) {
    throw dashboardError(
      'The Final Writeup reviewer audience requires reconciliation.',
      'final_writeups_dashboard_reviewer_roster_invalid',
      500,
    );
  }
  return reviewers
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((reviewer) => ({
      reviewerId: reviewer.reviewerId,
      name: reviewer.name,
      initials: initials(reviewer.name),
    }));
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

function coordinatorMatrix(projected, expectedReviewers) {
  return {
    reviewers: expectedReviewers,
    rows: projected.map((writeup) => {
      const recorded = new Map();
      for (const reviewer of writeup.reviewers) {
        const reviewerId = String(reviewer?.reviewerId || '').toLowerCase();
        if (!isGuid(reviewerId) || recorded.has(reviewerId)) {
          throw dashboardError(
            'The Final Writeup acknowledgement matrix requires reconciliation.',
            'final_writeups_dashboard_matrix_invalid',
            500,
          );
        }
        recorded.set(reviewerId, reviewer);
      }
      return {
        requestId: writeup.requestId,
        requestNumber: writeup.requestNumber,
        title: writeup.title,
        institution: writeup.institution,
        responsibleProgramDirector: writeup.responsibleProgramDirector,
        stage: writeup.stage,
        documentUrl: writeup.document.url,
        cells: expectedReviewers.map((reviewer) => {
          if (sameId(writeup.responsibleProgramDirector?.id, reviewer.reviewerId)) {
            return { reviewerId: reviewer.reviewerId, state: 'not-applicable', acknowledgedAt: null };
          }
          const acknowledgement = recorded.get(reviewer.reviewerId);
          return {
            reviewerId: reviewer.reviewerId,
            state: acknowledgement?.state || 'unreviewed',
            acknowledgedAt: acknowledgement?.acknowledgedAt || null,
          };
        }),
      };
    }),
  };
}

/**
 * Return the ordinary Workbench-user Final Writeups lens. `selectedRequestId`
 * narrows only the response shape after the full bounded queue is projected so
 * focused-page previous/next navigation stays server-derived.
 */
export async function loadFinalWriteupsDashboard(
  { actingUserSystemId, selectedRequestId = null, isSuperuser = false },
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
  const includeCoordinatorMatrix = isSuperuser === true && selectedRequestId === null;
  const [viewer, requests, personaProjection, expectedReviewers] = await Promise.all([
    resolveViewer(actingUserSystemId, dependencies),
    loadCurrentRequests(dependencies),
    dependencies.resolvePersonas(actingUserSystemId),
    includeCoordinatorMatrix ? loadExpectedReviewers(dependencies) : Promise.resolve(null),
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
    viewer: {
      id: viewer.systemuserid,
      name: viewer.fullname || null,
      personas: personaProjection.personas,
      personaLensesEnabled: personaProjection.enabled,
      isSuperuser: isSuperuser === true,
    },
    limits: { maximumRows: FINAL_WRITEUPS_DASHBOARD_MAX_ROWS },
    counts: {
      total: projected.length,
      open: queues.open.length,
      history: queues.history.length,
      stewardship: queues.stewardship.length,
    },
    queues,
    coordinatorMatrix: expectedReviewers ? coordinatorMatrix(projected, expectedReviewers) : null,
    selected,
    navigation: navigationFor(selected, queues),
  };
}
