/** Cycle list and schedule joins for the Meeting Tracker home page. */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import * as siteVisitAdapter from '../../dataverse/adapters/site-visit.js';
import { loadDashboard } from '../workbench/dashboard-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { getDeliberationScheduleByRequests } from './schedule-reader.js';
import {
  REQUEST_DOCUMENT_LIFECYCLE_LABEL,
  requestDocumentLabel,
} from '../../../shared/config/requestDocument.js';
import { SITE_VISIT_FORMAT_LABEL } from '../../../shared/config/siteVisit.js';
import { isMeetingTrackerSchemaReady } from '../../../shared/config/meetingTracker.js';

const REQUEST_BATCH = 50;
const DOCUMENT_BATCH = requestDocumentAdapter.REQUEST_DOCUMENT_BATCH_MAX_IDS;
const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_title',
  '_wmkf_currentpresitevisit_value',
  '_wmkf_programdirector_value',
].join(',');

const DEFAULT_DEPENDENCIES = Object.freeze({
  schemaReady: isMeetingTrackerSchemaReady,
  loadWorkbenchDashboard: loadDashboard,
  findRequestsByIds: grantRequestAdapter.findByIds,
  findDocumentsByIds: requestDocumentAdapter.findByIds,
  findActiveSiteVisits: siteVisitAdapter.findActiveByRequests,
  getSiteVisitById: siteVisitAdapter.getById,
  getSchedules: getDeliberationScheduleByRequests,
});

function dashboardError(message, code, httpStatus = 500) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code },
  });
}

function earlier(left, right) {
  const values = [left, right]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  return values.length ? new Date(Math.min(...values)).toISOString() : null;
}

async function batch(ids, size, reader) {
  const rows = [];
  for (let index = 0; index < ids.length; index += size) {
    const result = await reader(ids.slice(index, index + size));
    rows.push(...(result?.records || []));
  }
  return rows;
}

function shareState(row) {
  if (!row) return null;
  return {
    lifecycleState: row.wmkf_lifecyclestate,
    lifecycleLabel: requestDocumentLabel(
      REQUEST_DOCUMENT_LIFECYCLE_LABEL,
      row.wmkf_lifecyclestate,
    ) || 'Unknown',
    operationStatus: row.wmkf_operationstatus,
  };
}

function siteVisitShape(row) {
  if (!row) return null;
  return {
    activityId: row.activityid,
    scheduledStartIso: row.scheduledstart || null,
    scheduledEndIso: row.scheduledend || null,
    format: row.wmkf_visitformat ?? null,
    formatLabel: SITE_VISIT_FORMAT_LABEL[row.wmkf_visitformat] || null,
    location: row.wmkf_locationorlink || '',
  };
}

export async function loadMeetingTrackerDashboard(
  args,
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!dependencies.schemaReady()) {
    throw dashboardError(
      'Meeting Tracker is not enabled for this environment.',
      'meeting_tracker_schema_not_ready',
      503,
    );
  }
  const base = await dependencies.loadWorkbenchDashboard(args);
  if (!args.cycleCode) return base;

  const requestIds = (base.proposals || []).map((row) => row.requestId).filter(Boolean);
  const requests = await batch(requestIds, REQUEST_BATCH, (ids) => (
    dependencies.findRequestsByIds(ids, { select: REQUEST_SELECT, top: ids.length })
  ));
  const requestById = new Map(requests.map((row) => [
    String(row.akoya_requestid || '').toLowerCase(),
    row,
  ]));
  if (requestById.size !== new Set(requestIds.map((id) => String(id).toLowerCase())).size) {
    throw dashboardError(
      'A scheduled request could not be resolved.',
      'meeting_tracker_request_unresolved',
    );
  }

  const documentIds = requests
    .map((row) => row._wmkf_currentpresitevisit_value)
    .filter(Boolean);
  const [documents, schedules, activeVisits] = await Promise.all([
    batch(documentIds, DOCUMENT_BATCH, dependencies.findDocumentsByIds),
    dependencies.getSchedules(requestIds),
    dependencies.findActiveSiteVisits(requestIds),
  ]);
  const documentById = new Map(documents.map((row) => [
    String(row.wmkf_requestdocumentid || '').toLowerCase(),
    row,
  ]));

  const visitRowsByRequest = new Map();
  for (const row of activeVisits || []) {
    const key = String(row._regardingobjectid_value || '').toLowerCase();
    if (!key) continue;
    if (visitRowsByRequest.has(key)) {
      throw dashboardError(
        'Multiple active Site Visits require reconciliation.',
        'meeting_tracker_site_visit_duplicate',
        409,
      );
    }
    visitRowsByRequest.set(key, row);
  }
  const visitDetails = await Promise.all([...visitRowsByRequest.values()].map((row) => (
    dependencies.getSiteVisitById(row.activityid)
  )));
  const visitByRequest = new Map();
  for (const row of visitDetails) {
    const key = String(row?._regardingobjectid_value || '').toLowerCase();
    if (key) visitByRequest.set(key, siteVisitShape(row));
  }

  const proposals = (base.proposals || []).map((proposal) => {
    const key = String(proposal.requestId).toLowerCase();
    const request = requestById.get(key);
    const deliberation = schedules.get(proposal.requestId) || null;
    const siteVisit = visitByRequest.get(key) || null;
    return {
      requestId: proposal.requestId,
      requestNumber: proposal.requestNumber,
      title: request.akoya_title || null,
      programDirector: proposal.programDirector || null,
      leadPdId: request._wmkf_programdirector_value || null,
      projectLeader: proposal.projectLeader || null,
      shareState: shareState(documentById.get(
        String(request._wmkf_currentpresitevisit_value || '').toLowerCase(),
      )),
      deliberation,
      siteVisit,
      needsScheduling: !deliberation || !siteVisit,
      nextMeetingIso: earlier(deliberation?.scheduledStartIso, siteVisit?.scheduledStartIso),
    };
  });
  proposals.sort((left, right) => (
    (left.nextMeetingIso ? 0 : 1) - (right.nextMeetingIso ? 0 : 1)
      || String(left.nextMeetingIso || '').localeCompare(String(right.nextMeetingIso || ''))
      || String(left.requestNumber || '').localeCompare(String(right.requestNumber || ''))
  ));

  return { ...base, proposals };
}

export const MEETING_TRACKER_DASHBOARD_DEPENDENCIES = DEFAULT_DEPENDENCIES;
export const _internal = { earlier, shareState, siteVisitShape };
