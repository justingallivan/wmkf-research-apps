/**
 * Lock the current governed Pre-Research Presentation Brief for Share.
 *
 * docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md §3.4, §5
 * slice 3. One-time lifecycle transition, shaped exactly like the Pre-Site
 * Site Visit handoff
 * (lib/services/pre-site-visit/site-visit-transition-service.js:173-201,
 * 249-299): an already-Review row returns before any write; otherwise the
 * service reads stable Graph drive/item/version metadata before and after
 * downloading the current bytes, computes the governed hash, and performs
 * one ETag-fenced PATCH from Draft to Review recording
 * `wmkf_milestoneversionid`/`wmkf_milestonecontenthash`/`wmkf_milestonecreatedat`
 * (+ Wave 24 `MilestoneCreatedBy` when the explicit-actor schema is ready).
 * The SharePoint item itself is never copied or mutated.
 *
 * No review gate here — that is the prepare-time gate in plan §3.4b
 * (slice 4).
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
  isPreSiteDistributionSnapshot,
  PRE_RP_BRIEF_CONTRACT,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import { projectPreRpBriefArtifact } from './artifact-service.js';

const REQUEST_SELECT = [
  'akoya_requestid',
  '_wmkf_currentprerpbrief_value',
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

function lockError(message, code, httpStatus = 409) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code },
  });
}

function isEditableBriefRow(row) {
  return row?.wmkf_artifacttype === PRE_RP_BRIEF_CONTRACT.artifactType
    && row?.wmkf_contenttype === PRE_RP_BRIEF_CONTRACT.contentType
    && !isPreSiteDistributionSnapshot(row);
}

async function resolveCurrent(requestId, dependencies) {
  const [request, result] = await Promise.all([
    dependencies.getRequest(requestId),
    dependencies.findByRequest(requestId, {
      artifactType: PRE_RP_BRIEF_CONTRACT.artifactType,
    }),
  ]);
  if (!request || !sameId(request.akoya_requestid, requestId)) {
    throw lockError('The Pre-RP Brief request could not be resolved.', 'brief_request_not_found', 404);
  }

  const pointerId = request._wmkf_currentprerpbrief_value;
  if (!pointerId) {
    throw lockError(
      'Generate the Pre-Research Presentation Brief before sharing.',
      'brief_current_draft_missing',
    );
  }
  const rows = (result?.records || []).filter((row) => sameId(row?._wmkf_request_value, requestId));
  const row = rows.find((candidate) => sameId(candidate.wmkf_requestdocumentid, pointerId));
  if (!row
    || !isEditableBriefRow(row)
    || row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
    || ![REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW]
      .includes(row.wmkf_lifecyclestate)) {
    throw lockError('The current Pre-RP Brief request pointer requires reconciliation.', 'brief_pointer_invalid');
  }
  return row;
}

function assertCompleteMilestone(row) {
  if (!row.wmkf_milestoneversionid
    || !row.wmkf_milestonecontenthash
    || !row.wmkf_milestonecreatedat) {
    throw lockError(
      'The brief is locked for Share, but its handoff milestone is incomplete.',
      'brief_milestone_incomplete',
    );
  }
}

function assertStableMetadata(before, after, row) {
  if (!before || !after) {
    throw lockError('The current Pre-RP Brief file could not be found in SharePoint.', 'brief_sharepoint_file_missing');
  }
  if (!sameId(before.driveId, row.wmkf_sharepointdriveid)
    || !sameId(before.id, row.wmkf_sharepointitemid)
    || !sameId(after.driveId, row.wmkf_sharepointdriveid)
    || !sameId(after.id, row.wmkf_sharepointitemid)) {
    throw lockError(
      'SharePoint returned a different file identity for the current Pre-RP Brief.',
      'brief_sharepoint_identity_mismatch',
    );
  }
  if (!before.versionId || !after.versionId) {
    throw lockError(
      'SharePoint did not return the exact current version needed for the Share lock.',
      'brief_sharepoint_version_missing',
    );
  }
  if (before.versionId !== after.versionId
    || before.eTag !== after.eTag
    || before.lastModified !== after.lastModified
    || before.size !== after.size) {
    throw lockError(
      'The brief changed while the Share lock was being prepared. Retry to use the latest version.',
      'brief_sharepoint_version_changed',
    );
  }
}

function matchesCommittedMilestone(row, milestone, { requireActor = false } = {}) {
  return row?.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
    && row.wmkf_milestoneversionid === milestone.versionId
    && row.wmkf_milestonecontenthash === milestone.contentHash
    && Boolean(row.wmkf_milestonecreatedat)
    && (!requireActor || Boolean(row._wmkf_milestonecreatedby_value));
}

function projectedResult(row, { reused }) {
  return { artifact: projectPreRpBriefArtifact(row), reused };
}

/**
 * Lock the current Pre-RP Brief Word draft into the Review lifecycle so it
 * can be shared. `expectedArtifactId` is an optimistic UI guard only — the
 * server resolves the current request pointer independently before any
 * Graph or Dataverse write.
 */
export async function lockPreRpBriefForShare(
  { requestId, expectedArtifactId, actingUserSystemId = null },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(requestId) || !isGuid(expectedArtifactId)) {
    throw lockError('Valid requestId and expectedArtifactId values are required.', 'brief_invalid_identity', 400);
  }

  let row = await resolveCurrent(requestId, dependencies);
  if (!sameId(row.wmkf_requestdocumentid, expectedArtifactId)) {
    throw lockError(
      'A newer Pre-RP Brief is current. Reload before continuing.',
      'brief_stale_artifact',
    );
  }
  if (row.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW) {
    assertCompleteMilestone(row);
    return projectedResult(row, { reused: true });
  }
  if (row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT) {
    throw lockError('The current Pre-RP Brief is not eligible for the Share lock.', 'brief_lifecycle_ineligible');
  }
  if (!row._etag) {
    throw lockError(
      'The current Pre-RP Brief registry row is missing the ETag required for the Share lock.',
      'brief_etag_missing',
      500,
    );
  }
  if (!row.wmkf_sharepointdriveid || !row.wmkf_sharepointitemid) {
    throw lockError(
      'The current Pre-RP Brief has no stable SharePoint file identity.',
      'brief_sharepoint_identity_missing',
    );
  }

  const resolveActor = dependencies.resolveActor || DEFAULT_DEPENDENCIES.resolveActor;
  const actorResolution = await resolveActor({
    actingUserSystemId,
    policy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED,
  });
  const milestoneActorId = actorResolution.actorId || null;
  const requireActorOnReadback = actorResolution.schemaReady && Boolean(milestoneActorId);

  const metadataBefore = await dependencies.getFileMetadataById(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    { siteId: row.wmkf_sharepointsiteid || null },
  );
  if (!metadataBefore) {
    throw lockError('The current Pre-RP Brief file could not be found in SharePoint.', 'brief_sharepoint_file_missing');
  }
  const downloaded = await dependencies.downloadFile(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
  );
  let contentHash;
  try {
    contentHash = await dependencies.hashDocx(downloaded.buffer);
  } catch {
    throw lockError(
      'The current SharePoint item could not be verified as a valid Word document.',
      'brief_word_verification_failed',
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

  const recordUnattributed = async () => {
    if (!actorResolution.schemaReady || milestoneActorId) return;
    const recordActorNotCaptured = dependencies.recordActorNotCaptured
      || DEFAULT_DEPENDENCIES.recordActorNotCaptured;
    await recordActorNotCaptured({
      context: {
        operation: 'pre-rp-brief-share-lock',
        requestId,
        requestDocumentId: row.wmkf_requestdocumentid,
        operationId: `pre-rp-brief-lock:${row.wmkf_requestdocumentid}:${milestone.versionId}`,
      },
      reason: actorResolution.reason,
    });
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
      await recordUnattributed();
      return projectedResult(observed, { reused: true });
    }
    if (error?.status === 412 || /\b412\b/.test(error?.message || '')) {
      throw lockError(
        'The Pre-RP Brief changed while the Share lock was being applied. Reload and retry.',
        'brief_lock_conflict',
      );
    }
    throw error;
  }

  row = await resolveCurrent(requestId, dependencies);
  if (!sameId(row.wmkf_requestdocumentid, expectedArtifactId)
    || !matchesCommittedMilestone(row, milestone, { requireActor: requireActorOnReadback })) {
    throw lockError(
      'The Share lock could not be confirmed from Dataverse.',
      'brief_lock_unconfirmed',
      500,
    );
  }
  await recordUnattributed();
  return projectedResult(row, { reused: false });
}
