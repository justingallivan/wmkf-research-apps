/**
 * Final Writeups cross-request dashboard projection (Slice 3 foundation,
 * cycle-scoped since Slice 6A).
 *
 * The service discovers which grant cycles hold a current Final pointer with
 * one lightweight scan, then enumerates the bounded set of Requests in ONE
 * selected cycle (meeting-date window; the newest cycle with a row visible to
 * the viewer by default), batch-resolves the exact Request Document and
 * acknowledgement rows,
 * refreshes SharePoint publication metadata with bounded concurrency, and
 * derives the caller's queue membership server-side. Superusers also receive
 * a coordinator matrix grouped by each Request's broad Grant Program audience;
 * the exact reviewer-role roster remains the backward-compatible default until
 * an administrator publishes the first versioned audience setting. Ordinary
 * and focused responses receive neither matrix nor configuration. Persona
 * membership is explicit, multi-valued, and intersected with the current
 * reviewer-role roster before it affects a response.
 */

import * as acknowledgementAdapter from '../../dataverse/adapters/final-writeup-review-acknowledgement.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import * as systemUserAdapter from '../../dataverse/adapters/system-user.js';
import { chunk } from '../../utils/chunk.js';
import {
  cycleCodeToLabel,
  cycleCodeToOdataFilter,
  meetingDateToCycleCode,
  parseCycleCode,
} from '../../utils/cycle-code.js';
import { isFinalWriteupAcknowledgementSchemaReady } from '../../utils/final-writeup-acknowledgement-readiness.js';
import { isGuid } from '../../utils/guid.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { resolveFinalWriteupMatrixAudiences } from './matrix-audience-service.js';
import { resolveFinalWriteupPersonas } from './persona-service.js';
import {
  normalizeFinalWriteupPublicationObservation,
  projectFinalWriteupAcknowledgementState,
  resolveCurrentFinalWriteupFromRows,
} from './acknowledgement-service.js';
import {
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
} from '../../../shared/config/requestDocument.js';
import { FINAL_WRITEUP_PERSONA } from '../../../shared/config/finalWriteupPersonas.js';

export const FINAL_WRITEUPS_DASHBOARD_MAX_ROWS = 100;
export const FINAL_WRITEUPS_COORDINATOR_MAX_REVIEWERS = 50;
/** Newest available cycles examined for a viewer-visible row before giving up. */
export const FINAL_WRITEUPS_DEFAULT_CYCLE_WALKBACK = 3;
/** Selector for requests holding a current Final but no meeting date. */
export const FINAL_WRITEUPS_NO_CYCLE = 'none';
const FILE_METADATA_CONCURRENCY = 4;
const CURRENT_FINAL_FILTER = '_wmkf_currentfinalwriteup_value ne null';
const CYCLE_SCAN_SELECT = 'akoya_requestid,akoya_requestnum,wmkf_meetingdate';

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  '_wmkf_programdirector_value',
  '_wmkf_grantprogram_value',
  '_wmkf_currentfinalwriteup_value',
].join(',');

const DEFAULT_DEPENDENCIES = Object.freeze({
  schemaReady: isFinalWriteupAcknowledgementSchemaReady,
  getReviewer: (reviewerId) => systemUserAdapter.getByIdWithSelect(
    reviewerId,
    ['systemuserid', 'fullname', 'isdisabled'],
  ),
  resolvePersonas: (reviewerId) => resolveFinalWriteupPersonas(reviewerId),
  resolveMatrixAudiences: () => resolveFinalWriteupMatrixAudiences(),
  queryRequests: (options) => grantRequestAdapter.queryRequests(options),
  queryAllRequests: (options) => grantRequestAdapter.queryAllRequests(options),
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

/**
 * True for the values the dashboard accepts as a cycle selector: a real cycle
 * code (`J26`, `D26`) or the exact `none` sentinel. `parseCycleCode` alone
 * rejects the sentinel, so callers must not use it as the grammar.
 */
export function isFinalWriteupCycleSelector(value) {
  return value === FINAL_WRITEUPS_NO_CYCLE || parseCycleCode(value) !== null;
}

function normalizeCycleSelector(value) {
  if (value === FINAL_WRITEUPS_NO_CYCLE) return value;
  return String(value).trim().toUpperCase();
}

function cycleFilterFor(cycleSelector) {
  if (cycleSelector === FINAL_WRITEUPS_NO_CYCLE) return 'wmkf_meetingdate eq null';
  return cycleCodeToOdataFilter(cycleSelector);
}

/**
 * One global scan of requests with a current Final, projected to the distinct
 * cycles they fall in (newest first) plus whether any lack a meeting date.
 * Existence only: no per-cycle counts leave this function, because the scan
 * runs before persona filtering. A current Final on a non-June/December
 * meeting date is a data fault and fails loud, naming the request.
 */
async function discoverCycles(dependencies) {
  const result = await dependencies.queryAllRequests({
    select: CYCLE_SCAN_SELECT,
    filter: CURRENT_FINAL_FILTER,
    orderby: 'wmkf_meetingdate desc',
  });
  if (result?.capped) {
    throw dashboardError(
      'The Final Writeups cycle list is temporarily incomplete. Please try again later.',
      'final_writeups_dashboard_cycle_list_capped',
      503,
    );
  }
  const records = rows(result);
  if (records.length >= grantRequestAdapter.QUERY_ALL_REQUESTS_CAP / 2) {
    console.warn('final_writeups_dashboard_cycle_list_near_cap', {
      records: records.length,
      cap: grantRequestAdapter.QUERY_ALL_REQUESTS_CAP,
    });
  }
  const seen = new Map();
  let hasUncycled = false;
  for (const record of records) {
    if (!record.wmkf_meetingdate) {
      hasUncycled = true;
      continue;
    }
    const code = meetingDateToCycleCode(record.wmkf_meetingdate);
    if (!code) {
      throw dashboardError(
        `Request ${record.akoya_requestnum || record.akoya_requestid} holds a current Final Writeup but its meeting date is not in a June or December cycle.`,
        'final_writeups_dashboard_cycle_invalid',
        500,
        { requestNumber: record.akoya_requestnum || null, requestId: record.akoya_requestid || null },
      );
    }
    if (!seen.has(code)) {
      const parsed = parseCycleCode(code);
      seen.set(code, { code, label: cycleCodeToLabel(code), order: parsed.year * 100 + parsed.month });
    }
  }
  const available = [...seen.values()]
    .sort((left, right) => right.order - left.order)
    .map(({ code, label }) => ({ code, label }));
  return { available, hasUncycled };
}

async function loadCurrentRequests(dependencies, { cycleSelector = null, requestId = null } = {}) {
  const clauses = [CURRENT_FINAL_FILTER];
  if (requestId) clauses.push(`akoya_requestid eq ${requestId}`);
  else if (cycleSelector) clauses.push(cycleFilterFor(cycleSelector));
  const result = await dependencies.queryRequests({
    select: REQUEST_SELECT,
    filter: clauses.join(' and '),
    orderby: 'akoya_requestnum asc',
    top: FINAL_WRITEUPS_DASHBOARD_MAX_ROWS,
  });
  if ((result?.totalCount || 0) > FINAL_WRITEUPS_DASHBOARD_MAX_ROWS || result?.hasMore) {
    throw dashboardError(
      `The Final Writeups dashboard supports at most ${FINAL_WRITEUPS_DASHBOARD_MAX_ROWS} current rows in one cycle${cycleSelector ? ` (${cycleSelector})` : ''}.`,
      'final_writeups_dashboard_scope_exceeded',
      503,
      { maximumRows: FINAL_WRITEUPS_DASHBOARD_MAX_ROWS, cycleCode: cycleSelector },
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

/**
 * Rollout-off preserves the existing ordinary dashboard exactly. Once the
 * published-staffing resolver is enabled, persona visibility is a union so
 * approved overlaps (for example PD + leadership) cannot hide either lens.
 * Lenses focus; they do not conceal (owner decision 2026-09-06): a Program
 * Director keeps every row, including writeups that have moved on to
 * leadership review, so nothing they reviewed disappears. Leadership sees
 * leadership-stage rows only because group-review rows have not reached them.
 */
function visibleToPersona(row, personaProjection, isSuperuser) {
  if (!personaProjection?.enabled || isSuperuser === true) return true;
  const personas = new Set(Array.isArray(personaProjection.personas)
    ? personaProjection.personas
    : []);
  if (personas.has(FINAL_WRITEUP_PERSONA.PROGRAM_COORDINATOR)) return true;
  if (personas.has(FINAL_WRITEUP_PERSONA.PROGRAM_DIRECTOR)) return true;
  return personas.has(FINAL_WRITEUP_PERSONA.LEADERSHIP)
    && row.stage.key === 'leadership-review';
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

function coordinatorMatrixRow(writeup, expectedReviewers) {
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
}

function unconfiguredMatrixRow(writeup, request) {
  return {
    requestId: writeup.requestId,
    requestNumber: writeup.requestNumber,
    title: writeup.title,
    institution: writeup.institution,
    grantProgramId: isGuid(request?._wmkf_grantprogram_value)
      ? String(request._wmkf_grantprogram_value).toLowerCase()
      : null,
    grantProgramName: request?._wmkf_grantprogram_value_formatted || null,
  };
}

function coordinatorMatrix(projected, requests, audienceConfiguration) {
  const requestById = new Map(requests.map((request) => [
    String(request.akoya_requestid || '').toLowerCase(),
    request,
  ]));
  if (audienceConfiguration.mode === 'role-default') {
    return {
      mode: 'role-default',
      groups: [{
        grantProgramId: null,
        grantProgramName: 'All Grant Programs',
        reviewers: audienceConfiguration.fallbackReviewers,
        rows: projected.map((writeup) => coordinatorMatrixRow(
          writeup,
          audienceConfiguration.fallbackReviewers,
        )),
      }],
      unconfiguredRows: [],
    };
  }

  const audienceByProgram = new Map(audienceConfiguration.programs.map((program) => [
    program.grantProgramId,
    program.reviewers,
  ]));
  const grouped = new Map();
  const unconfiguredRows = [];
  for (const writeup of projected) {
    const request = requestById.get(String(writeup.requestId || '').toLowerCase());
    const grantProgramId = isGuid(request?._wmkf_grantprogram_value)
      ? String(request._wmkf_grantprogram_value).toLowerCase()
      : null;
    const reviewers = grantProgramId ? audienceByProgram.get(grantProgramId) : null;
    if (!reviewers) {
      unconfiguredRows.push(unconfiguredMatrixRow(writeup, request));
      continue;
    }
    if (!grouped.has(grantProgramId)) {
      grouped.set(grantProgramId, {
        grantProgramId,
        grantProgramName: request?._wmkf_grantprogram_value_formatted || 'Grant Program',
        reviewers,
        rows: [],
      });
    }
    grouped.get(grantProgramId).rows.push(coordinatorMatrixRow(writeup, reviewers));
  }

  return {
    mode: 'configured',
    groups: [...grouped.values()].sort((left, right) => (
      left.grantProgramName.localeCompare(right.grantProgramName)
    )),
    unconfiguredRows,
    ...(audienceConfiguration.warnings
      ? { warnings: audienceConfiguration.warnings }
      : {}),
  };
}

/**
 * Project one already-loaded request set (one cycle, or one focused request's
 * cycle) into persona-visible rows. Shared by the default walk-back and the
 * explicit/focused paths so every candidate read carries the same bounds.
 */
async function projectRequests({
  requests, actingUserSystemId, personaProjection, isSuperuser,
}, dependencies) {
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

  const visibleProjected = projected.filter((row) => (
    visibleToPersona(row, personaProjection, isSuperuser)
  ));
  visibleProjected.sort((left, right) => (
    String(left.requestNumber || '').localeCompare(String(right.requestNumber || ''))
  ));
  return { visibleProjected, requests };
}

async function loadScopedCycle(cycleSelector, context, dependencies) {
  const requests = await loadCurrentRequests(dependencies, { cycleSelector });
  return projectRequests({ ...context, requests }, dependencies);
}

/**
 * Resolve which cycle the index shows and project it.
 *  - explicit selector: that cycle, one read, never walks back;
 *  - otherwise the newest of the `FINAL_WRITEUPS_DEFAULT_CYCLE_WALKBACK`
 *    newest available cycles with a viewer-visible row (`visible`), else the
 *    newest cycle shown empty (`exhausted`). `none` is never a candidate.
 * An oversized cycle throws from the scoped loader and is never skipped.
 */
async function resolveIndexScope({ cycleSelector, available }, context, dependencies) {
  if (cycleSelector) {
    const scope = await loadScopedCycle(cycleSelector, context, dependencies);
    return { ...scope, selected: cycleSelector, defaultResolvedBy: 'explicit' };
  }
  if (available.length === 0) {
    return { visibleProjected: [], requests: [], selected: null, defaultResolvedBy: 'exhausted' };
  }
  const candidates = available.slice(0, FINAL_WRITEUPS_DEFAULT_CYCLE_WALKBACK);
  let newest = null;
  for (const candidate of candidates) {
    const scope = await loadScopedCycle(candidate.code, context, dependencies);
    if (scope.visibleProjected.length > 0) {
      return { ...scope, selected: candidate.code, defaultResolvedBy: 'visible' };
    }
    if (!newest) newest = { ...scope, selected: candidate.code };
  }
  return { ...newest, visibleProjected: [], defaultResolvedBy: 'exhausted' };
}

/**
 * Return the ordinary Workbench-user Final Writeups lens for one cycle.
 * `selectedRequestId` (focused page) derives the cycle from the request itself
 * and never accepts `cycleCode`, so previous/next navigation stays inside the
 * request's own cycle. `cycleCode` is a real code or the `none` sentinel.
 */
export async function loadFinalWriteupsDashboard(
  {
    actingUserSystemId, selectedRequestId = null, cycleCode = null, isSuperuser = false,
  },
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
  if (cycleCode !== null && !isFinalWriteupCycleSelector(cycleCode)) {
    throw dashboardError(
      'cycleCode must be a cycle code such as D26 or the value none.',
      'final_writeups_dashboard_cycle_selector_invalid',
      400,
    );
  }
  if (selectedRequestId !== null && cycleCode !== null) {
    throw dashboardError(
      'A focused request derives its own cycle; cycleCode is not accepted with requestId.',
      'final_writeups_dashboard_cycle_with_request',
      400,
    );
  }
  const cycleSelector = cycleCode === null ? null : normalizeCycleSelector(cycleCode);

  // Focused reads never run the global cycle scan: they derive the cycle from
  // the request itself, and an unrelated data fault elsewhere (off-month row,
  // capped scan) must not replace the focused row's own 200 or 404. Focused
  // responses therefore carry an empty picker, as they already omit the matrix.
  const [viewer, cycles, personaProjection] = await Promise.all([
    resolveViewer(actingUserSystemId, dependencies),
    selectedRequestId === null
      ? discoverCycles(dependencies)
      : Promise.resolve({ available: [], hasUncycled: false }),
    dependencies.resolvePersonas(actingUserSystemId),
  ]);
  const includeCoordinatorMatrix = selectedRequestId === null && (
    isSuperuser === true
    || (personaProjection.enabled === true
      && Array.isArray(personaProjection.personas)
      && personaProjection.personas.includes(FINAL_WRITEUP_PERSONA.PROGRAM_COORDINATOR))
  );
  const matrixAudiences = includeCoordinatorMatrix
    ? await dependencies.resolveMatrixAudiences()
    : null;
  const context = { actingUserSystemId, personaProjection, isSuperuser };

  let scope;
  if (selectedRequestId !== null) {
    const [focusedRequest] = await loadCurrentRequests(dependencies, { requestId: selectedRequestId });
    if (!focusedRequest) {
      throw dashboardError(
        'No current Final Writeup was found for this request.',
        'final_writeups_dashboard_request_not_found',
        404,
      );
    }
    const focusedSelector = focusedRequest.wmkf_meetingdate
      ? meetingDateToCycleCode(focusedRequest.wmkf_meetingdate)
      : FINAL_WRITEUPS_NO_CYCLE;
    if (!focusedSelector) {
      throw dashboardError(
        `Request ${focusedRequest.akoya_requestnum || focusedRequest.akoya_requestid} holds a current Final Writeup but its meeting date is not in a June or December cycle.`,
        'final_writeups_dashboard_cycle_invalid',
        500,
        { requestNumber: focusedRequest.akoya_requestnum || null, requestId: focusedRequest.akoya_requestid || null },
      );
    }
    scope = {
      ...await loadScopedCycle(focusedSelector, context, dependencies),
      selected: focusedSelector,
      defaultResolvedBy: 'explicit',
    };
  } else {
    scope = await resolveIndexScope({ cycleSelector, available: cycles.available }, context, dependencies);
  }
  const { visibleProjected, requests } = scope;

  const queues = {
    open: visibleProjected.filter((row) => row.bucket === 'open'),
    history: visibleProjected.filter((row) => row.bucket === 'history'),
    stewardship: visibleProjected.filter((row) => row.bucket === 'stewardship'),
  };
  const selected = selectedRequestId
    ? visibleProjected.find((row) => sameId(row.requestId, selectedRequestId)) || null
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
      ...(personaProjection.enabled === true && Array.isArray(personaProjection.warnings)
        ? { personaWarnings: personaProjection.warnings }
        : {}),
    },
    cycles: {
      selected: scope.selected,
      available: cycles.available,
      hasUncycled: cycles.hasUncycled,
      defaultResolvedBy: scope.defaultResolvedBy,
    },
    limits: { maximumRows: FINAL_WRITEUPS_DASHBOARD_MAX_ROWS, scope: 'cycle' },
    counts: {
      total: visibleProjected.length,
      open: queues.open.length,
      history: queues.history.length,
      stewardship: queues.stewardship.length,
    },
    queues,
    coordinatorMatrix: matrixAudiences
      ? coordinatorMatrix(visibleProjected, requests, matrixAudiences)
      : null,
    selected,
    navigation: navigationFor(selected, queues),
  };
}
