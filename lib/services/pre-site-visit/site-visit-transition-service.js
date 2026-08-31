/**
 * Promote the current governed Pre-Site Word draft into the Site Visit workspace.
 *
 * The SharePoint item is not copied or mutated. The current request pointer remains
 * authoritative while the request-document lifecycle and exact handoff milestone
 * are recorded with an ETag-fenced Dataverse update.
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { GraphService } from '../graph-service.js';
import { hashGovernedDocxContent } from '../initial-assessment/artifact-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import {
  recordRequestDocumentActorNotCaptured,
  REQUEST_DOCUMENT_ACTOR_POLICY,
  resolveRequestDocumentActor,
} from '../request-document-actor-service.js';
import { isGuid } from '../../utils/guid.js';
import {
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import { projectPreSiteVisitArtifact } from './artifact-service.js';

const REQUEST_SELECT = [
  'akoya_requestid',
  '_wmkf_currentpresitevisit_value',
].join(',');

const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  findByRequest: requestDocumentAdapter.findByRequest,
  updateDocument: requestDocumentAdapter.update,
  getFileMetadataById: (...args) => GraphService.getFileMetadataById(...args),
  downloadFile: (...args) => GraphService.downloadFile(...args),
  hashDocx: hashGovernedDocxContent,
  now: () => new Date(),
  resolveActor: resolveRequestDocumentActor,
  recordActorNotCaptured: recordRequestDocumentActorNotCaptured,
});

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function transitionError(message, code, httpStatus = 409) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code },
  });
}

function assertKnownState(row) {
  if (!Object.values(REQUEST_DOCUMENT_OPERATION_STATUS).includes(row?.wmkf_operationstatus)
    || !Object.values(REQUEST_DOCUMENT_LIFECYCLE_STATE).includes(row?.wmkf_lifecyclestate)) {
    throw transitionError(
      'The current Pre-Site document has an unknown registry state.',
      'site_visit_state_unknown',
      500,
    );
  }
}

async function resolveCurrent(requestId, dependencies) {
  const [request, result] = await Promise.all([
    dependencies.getRequest(requestId),
    dependencies.findByRequest(requestId, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    }),
  ]);
  if (!request || !sameId(request.akoya_requestid, requestId)) {
    throw transitionError(
      'The Pre-Site request could not be resolved.',
      'site_visit_request_not_found',
      404,
    );
  }

  const pointerId = request._wmkf_currentpresitevisit_value;
  if (!pointerId) {
    throw transitionError(
      'Generate a Pre-Site Visit Word draft before starting the Site Visit stage.',
      'site_visit_current_draft_missing',
    );
  }
  const rows = (result?.records || []).filter((row) => (
    sameId(row?._wmkf_request_value, requestId)
    && row.wmkf_artifacttype === REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT
  ));
  const row = rows.find((candidate) => sameId(candidate.wmkf_requestdocumentid, pointerId));
  if (!row
    || row.wmkf_contenttype !== PRE_SITE_VISIT_CONTRACT.contentType
    || row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
    || row.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED) {
    throw transitionError(
      'The current Pre-Site request pointer requires reconciliation.',
      'site_visit_pointer_invalid',
    );
  }
  assertKnownState(row);
  return row;
}

function assertCompleteMilestone(row) {
  if (!row.wmkf_milestoneversionid
    || !row.wmkf_milestonecontenthash
    || !row.wmkf_milestonecreatedat) {
    throw transitionError(
      'The Site Visit lifecycle is active, but its handoff milestone is incomplete.',
      'site_visit_milestone_incomplete',
    );
  }
}

function assertStableMetadata(before, after, row) {
  if (!before || !after) {
    throw transitionError(
      'The current Pre-Site Word file could not be found in SharePoint.',
      'site_visit_sharepoint_file_missing',
    );
  }
  if (!sameId(before.driveId, row.wmkf_sharepointdriveid)
    || !sameId(before.id, row.wmkf_sharepointitemid)
    || !sameId(after.driveId, row.wmkf_sharepointdriveid)
    || !sameId(after.id, row.wmkf_sharepointitemid)) {
    throw transitionError(
      'SharePoint returned a different file identity for the current Pre-Site draft.',
      'site_visit_sharepoint_identity_mismatch',
    );
  }
  if (!before.versionId || !after.versionId) {
    throw transitionError(
      'SharePoint did not return the exact current Word version needed for handoff.',
      'site_visit_sharepoint_version_missing',
    );
  }
  if (before.versionId !== after.versionId
    || before.eTag !== after.eTag
    || before.lastModified !== after.lastModified
    || before.size !== after.size) {
    throw transitionError(
      'The Word draft changed while the Site Visit handoff was being prepared. Retry to use the latest version.',
      'site_visit_sharepoint_version_changed',
    );
  }
}

function projectedResult(row, { reused }) {
  return {
    artifact: projectPreSiteVisitArtifact(row),
    reused,
  };
}

function matchesCommittedMilestone(row, milestone, { requireActor = false } = {}) {
  return row?.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
    && row.wmkf_milestoneversionid === milestone.versionId
    && row.wmkf_milestonecontenthash === milestone.contentHash
    && Boolean(row.wmkf_milestonecreatedat)
    && (!requireActor || Boolean(row._wmkf_milestonecreatedby_value));
}

/**
 * Start the Site Visit stage from the current Pre-Site Word draft.
 *
 * `expectedArtifactId` is an optimistic UI guard only. The server resolves the
 * current request pointer independently before any Graph or Dataverse write.
 */
export async function startSiteVisitStage(
  { requestId, expectedArtifactId, actingUserSystemId = null },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(requestId) || !isGuid(expectedArtifactId)) {
    throw transitionError(
      'Valid requestId and expectedArtifactId values are required.',
      'site_visit_invalid_identity',
      400,
    );
  }

  let row = await resolveCurrent(requestId, dependencies);
  if (!sameId(row.wmkf_requestdocumentid, expectedArtifactId)) {
    throw transitionError(
      'A newer Pre-Site draft is current. Reload the Site Visit tab before continuing.',
      'site_visit_stale_artifact',
    );
  }
  if (row.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW) {
    assertCompleteMilestone(row);
    return projectedResult(row, { reused: true });
  }
  if (row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT) {
    throw transitionError(
      'The current Pre-Site document is not eligible to start the Site Visit stage.',
      'site_visit_lifecycle_ineligible',
    );
  }
  if (!row._etag) {
    throw transitionError(
      'The current Pre-Site registry row is missing the ETag required for handoff.',
      'site_visit_etag_missing',
      500,
    );
  }
  if (!row.wmkf_sharepointdriveid || !row.wmkf_sharepointitemid) {
    throw transitionError(
      'The current Pre-Site draft has no stable SharePoint file identity.',
      'site_visit_sharepoint_identity_missing',
    );
  }

  const resolveActor = dependencies.resolveActor || DEFAULT_DEPENDENCIES.resolveActor;
  const actorResolution = await resolveActor({
    actingUserSystemId,
    policy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED,
  });
  const milestoneActorId = actorResolution.actorId || null;
  const requireActorOnReadback = actorResolution.schemaReady && Boolean(milestoneActorId);
  const recordUnattributed = async () => {
    if (!actorResolution.schemaReady || milestoneActorId) return;
    const recordActorNotCaptured = dependencies.recordActorNotCaptured
      || DEFAULT_DEPENDENCIES.recordActorNotCaptured;
    await recordActorNotCaptured({
      context: {
        operation: 'site-visit-handoff',
        requestId,
        requestDocumentId: row.wmkf_requestdocumentid,
        operationId: `site-visit:${row.wmkf_requestdocumentid}:${milestone.versionId}`,
      },
      reason: actorResolution.reason,
    });
  };

  const metadataBefore = await dependencies.getFileMetadataById(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    { siteId: row.wmkf_sharepointsiteid || null },
  );
  if (!metadataBefore) {
    throw transitionError(
      'The current Pre-Site Word file could not be found in SharePoint.',
      'site_visit_sharepoint_file_missing',
    );
  }
  const downloaded = await dependencies.downloadFile(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
  );
  let contentHash;
  try {
    contentHash = await dependencies.hashDocx(downloaded.buffer);
  } catch (error) {
    throw transitionError(
      'The current SharePoint item could not be verified as a valid Word document.',
      'site_visit_word_verification_failed',
    );
  }
  const metadataAfter = await dependencies.getFileMetadataById(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    { siteId: row.wmkf_sharepointsiteid || null },
  );
  assertStableMetadata(metadataBefore, metadataAfter, row);

  const milestone = {
    versionId: metadataAfter.versionId,
    contentHash,
    createdAt: dependencies.now().toISOString(),
  };
  const patch = {
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
    wmkf_milestoneversionid: milestone.versionId,
    wmkf_milestonecontenthash: milestone.contentHash,
    wmkf_milestonecreatedat: milestone.createdAt,
    wmkf_sharepointsiteid: metadataAfter.siteId || row.wmkf_sharepointsiteid || null,
    wmkf_sharepointdriveid: metadataAfter.driveId,
    wmkf_sharepointitemid: metadataAfter.id,
    wmkf_sharepointweburl: metadataAfter.webUrl,
    wmkf_sharepointversionid: metadataAfter.versionId,
    wmkf_sharepointetag: metadataAfter.eTag,
    wmkf_filename: metadataAfter.name,
    wmkf_filesize: metadataAfter.size,
    wmkf_sharepointlastmodified: metadataAfter.lastModified,
    ...(milestoneActorId ? {
      'wmkf_MilestoneCreatedBy@odata.bind': `/systemusers(${milestoneActorId})`,
    } : {}),
  };

  try {
    await dependencies.updateDocument(row.wmkf_requestdocumentid, patch, {
      ifMatch: row._etag,
      ...((actorResolution.schemaReady ? milestoneActorId : actingUserSystemId)
        ? { actingUserSystemId: actorResolution.schemaReady ? milestoneActorId : actingUserSystemId }
        : {}),
    });
  } catch (error) {
    const observed = await resolveCurrent(requestId, dependencies).catch(() => null);
    if (sameId(observed?.wmkf_requestdocumentid, row.wmkf_requestdocumentid)
      && matchesCommittedMilestone(observed, milestone, { requireActor: requireActorOnReadback })) {
      row = observed;
      await recordUnattributed();
      return projectedResult(observed, { reused: true });
    }
    if (error?.status === 412 || /\b412\b/.test(error?.message || '')) {
      throw transitionError(
        'The Pre-Site draft changed while the Site Visit stage was starting. Reload and retry.',
        'site_visit_transition_conflict',
      );
    }
    throw error;
  }

  row = await resolveCurrent(requestId, dependencies);
  if (!sameId(row.wmkf_requestdocumentid, expectedArtifactId)
    || !matchesCommittedMilestone(row, milestone, { requireActor: requireActorOnReadback })) {
    throw transitionError(
      'The Site Visit handoff could not be confirmed from Dataverse.',
      'site_visit_transition_unconfirmed',
      500,
    );
  }
  await recordUnattributed();
  return projectedResult(row, { reused: false });
}
