/**
 * Final Writeup personal review acknowledgement service (Wave 23).
 *
 * The caller supplies only request/current-artifact fences and a trusted
 * session-derived Dataverse systemuser id. The service resolves the current
 * Final row and responsible PD server-side, rejects PD self-acknowledgement,
 * takes one current Graph publication observation, and conditionally creates
 * or replaces the caller's one durable acknowledgement row. Publication
 * version is the freshness authority; eTag and last-modified are diagnostic.
 */

import * as acknowledgementAdapter from '../../dataverse/adapters/final-writeup-review-acknowledgement.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import * as systemUserAdapter from '../../dataverse/adapters/system-user.js';
import { isFinalWriteupAcknowledgementSchemaReady } from '../../utils/final-writeup-acknowledgement-readiness.js';
import { isGuid } from '../../utils/guid.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { isAcceptedFinalLifecycle } from './leadership-checkpoint.js';
import { resolveFinalWriteupProgramDirectorAudience } from './matrix-audience-service.js';
import {
  FINAL_WRITEUP_SIGN_OFF_ROSTER_STATUS,
  FINAL_WRITEUP_SIGN_OFF_STATE,
} from '../../../shared/config/finalWriteupSignOff.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  '_wmkf_programdirector_value',
  '_wmkf_currentfinalwriteup_value',
  '_wmkf_grantprogram_value',
].join(',');

const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  findDocumentsByRequest: requestDocumentAdapter.findByRequest,
  getReviewer: (reviewerId) => systemUserAdapter.getByIdWithSelect(
    reviewerId,
    ['systemuserid', 'fullname', 'isdisabled'],
  ),
  findAcknowledgements: acknowledgementAdapter.findByFinalDocument,
  findAcknowledgement: acknowledgementAdapter.findByFinalDocumentAndReviewer,
  createAcknowledgement: acknowledgementAdapter.create,
  updateAcknowledgement: acknowledgementAdapter.update,
  getFileMetadataById: (...args) => GraphService.getFileMetadataById(...args),
  now: () => new Date(),
  schemaReady: isFinalWriteupAcknowledgementSchemaReady,
  resolveProgramDirectorAudience: (grantProgramId) => (
    resolveFinalWriteupProgramDirectorAudience(grantProgramId)
  ),
});

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function sameStableFileId(left, right) {
  return typeof left === 'string' && typeof right === 'string' && left === right;
}

function acknowledgementError(message, code, httpStatus = 409, extra = {}) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code, ...extra },
  });
}

function assertReady(dependencies) {
  if (!dependencies.schemaReady?.()) {
    throw acknowledgementError(
      'Final Writeup review tracking is unavailable until its Dataverse schema is verified.',
      'final_writeup_acknowledgement_schema_not_ready',
      503,
    );
  }
}

function assertInput({
  requestId,
  expectedFinalArtifactId = null,
  actingUserSystemId,
  requireExpectedFinalArtifactId = false,
}) {
  if (!isGuid(requestId)
    || (requireExpectedFinalArtifactId && !isGuid(expectedFinalArtifactId))
    || (!requireExpectedFinalArtifactId
      && expectedFinalArtifactId !== null
      && !isGuid(expectedFinalArtifactId))) {
    throw acknowledgementError(
      'Valid requestId and expectedFinalArtifactId values are required.',
      'final_writeup_acknowledgement_invalid_identity',
      400,
    );
  }
  if (!isGuid(actingUserSystemId)) {
    throw acknowledgementError(
      'A resolved staff identity is required to record Final Writeup review.',
      'final_writeup_acknowledgement_actor_required',
      403,
    );
  }
}

function rows(result) {
  return Array.isArray(result?.records) ? result.records : [];
}

async function resolveCurrentFinal(requestId, expectedFinalArtifactId, dependencies) {
  const [request, documentResult] = await Promise.all([
    dependencies.getRequest(requestId),
    dependencies.findDocumentsByRequest(requestId),
  ]);
  return resolveCurrentFinalFromRows({
    requestId,
    expectedFinalArtifactId,
    request,
    documents: rows(documentResult),
  });
}

function resolveCurrentFinalFromRows({
  requestId,
  expectedFinalArtifactId = null,
  request,
  documents,
}) {
  if (!request || !sameId(request.akoya_requestid, requestId)) {
    throw acknowledgementError(
      'The request could not be resolved.',
      'final_writeup_acknowledgement_request_not_found',
      404,
    );
  }
  const finalId = request._wmkf_currentfinalwriteup_value || null;
  if (!finalId) {
    throw acknowledgementError(
      'This request has no current Final Writeup.',
      'final_writeup_acknowledgement_final_missing',
    );
  }
  if (expectedFinalArtifactId && !sameId(finalId, expectedFinalArtifactId)) {
    throw acknowledgementError(
      'A different Final Writeup is now current. Reload before recording review.',
      'final_writeup_acknowledgement_stale_final',
    );
  }
  const matching = (Array.isArray(documents) ? documents : []).filter((row) => (
    sameId(row?._wmkf_request_value, requestId)
    && sameId(row?.wmkf_requestdocumentid, finalId)
  ));
  if (matching.length !== 1) {
    throw acknowledgementError(
      'The current Final Writeup pointer requires reconciliation.',
      'final_writeup_acknowledgement_final_pointer_invalid',
      500,
    );
  }
  const finalDocument = matching[0];
  if (finalDocument.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL
    && !isAcceptedFinalLifecycle(finalDocument)) {
    // A FINAL Final row without the complete leadership checkpoint is a
    // half-written transition: reconciliation, not a reviewable document.
    throw acknowledgementError(
      'The current Final Writeup leadership checkpoint requires reconciliation.',
      'final_writeup_acknowledgement_final_state_invalid',
      500,
    );
  }
  if (finalDocument.wmkf_artifacttype !== REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP
    || finalDocument.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
    || !isAcceptedFinalLifecycle(finalDocument)) {
    throw acknowledgementError(
      'Only a current Ready Final Writeup can be reviewed.',
      'final_writeup_acknowledgement_final_ineligible',
    );
  }
  if (!finalDocument.wmkf_sharepointdriveid || !finalDocument.wmkf_sharepointitemid) {
    throw acknowledgementError(
      'The current Final Writeup has no stable SharePoint identity.',
      'final_writeup_acknowledgement_file_identity_missing',
      500,
    );
  }
  return { request, finalDocument };
}

async function resolveReviewer(actingUserSystemId, dependencies) {
  const reviewer = await dependencies.getReviewer(actingUserSystemId);
  if (!reviewer || !sameId(reviewer.systemuserid, actingUserSystemId) || reviewer.isdisabled !== false) {
    throw acknowledgementError(
      'The signed-in staff identity is not an enabled Dataverse user.',
      'final_writeup_acknowledgement_reviewer_unavailable',
      403,
    );
  }
  return reviewer;
}

function assertMayAcknowledge(request, actingUserSystemId) {
  if (request._wmkf_programdirector_value
    && sameId(request._wmkf_programdirector_value, actingUserSystemId)) {
    throw acknowledgementError(
      'The responsible Program Director does not mark their own Final Writeup reviewed.',
      'final_writeup_acknowledgement_responsible_pd',
      403,
    );
  }
}

async function observeCurrentPublication(finalDocument, dependencies) {
  const metadata = await dependencies.getFileMetadataById(
    finalDocument.wmkf_sharepointdriveid,
    finalDocument.wmkf_sharepointitemid,
    { siteId: finalDocument.wmkf_sharepointsiteid || null },
  );
  return normalizePublicationObservation(finalDocument, metadata);
}

function normalizePublicationObservation(finalDocument, metadata) {
  const validLastModified = typeof metadata?.lastModified === 'string'
    && Number.isFinite(Date.parse(metadata.lastModified));
  if (!metadata
    || !sameStableFileId(metadata.driveId, finalDocument.wmkf_sharepointdriveid)
    || !sameStableFileId(metadata.id, finalDocument.wmkf_sharepointitemid)
    || typeof metadata.versionId !== 'string'
    || !metadata.versionId.trim()
    || typeof metadata.eTag !== 'string'
    || !metadata.eTag.trim()
    || !validLastModified) {
    throw acknowledgementError(
      'The current Final Writeup publication could not be verified in SharePoint.',
      'final_writeup_acknowledgement_publication_unavailable',
    );
  }
  return {
    driveId: metadata.driveId,
    itemId: metadata.id,
    publicationVersionId: metadata.versionId,
    eTag: metadata.eTag,
    lastModified: new Date(metadata.lastModified).toISOString(),
  };
}

function assertSingleAcknowledgement(result) {
  const found = rows(result);
  if (found.length > 1) {
    throw acknowledgementError(
      'Duplicate Final Writeup acknowledgements require reconciliation.',
      'final_writeup_acknowledgement_duplicate_key',
      500,
    );
  }
  return found[0] || null;
}

function assertAcknowledgementIdentity(row, finalDocumentId, reviewerId) {
  if (!row) return null;
  if (!sameId(row._wmkf_finaldocument_value, finalDocumentId)
    || !sameId(row._wmkf_reviewer_value, reviewerId)) {
    throw acknowledgementError(
      'The stored Final Writeup acknowledgement has contradictory identity.',
      'final_writeup_acknowledgement_identity_mismatch',
      500,
    );
  }
  return row;
}

function assertStoredAcknowledgement(row, finalDocumentId, reviewerId) {
  if (!row) return null;
  assertAcknowledgementIdentity(row, finalDocumentId, reviewerId);
  const valid = isGuid(row.wmkf_finalwriteupreviewacknowledgementid)
    && typeof row.wmkf_sharepointdriveid === 'string'
    && Boolean(row.wmkf_sharepointdriveid.trim())
    && typeof row.wmkf_sharepointitemid === 'string'
    && Boolean(row.wmkf_sharepointitemid.trim())
    && typeof row.wmkf_publicationversionid === 'string'
    && Boolean(row.wmkf_publicationversionid.trim())
    && typeof row.wmkf_acknowledgedetag === 'string'
    && Boolean(row.wmkf_acknowledgedetag.trim())
    && Number.isFinite(Date.parse(row.wmkf_sharepointlastmodified || ''))
    && Number.isFinite(Date.parse(row.wmkf_acknowledgedat || ''));
  if (!valid) {
    throw acknowledgementError(
      'The stored Final Writeup acknowledgement is incomplete.',
      'final_writeup_acknowledgement_stored_state_invalid',
      500,
    );
  }
  return row;
}

function validatedAcknowledgements(result, finalDocumentId) {
  const seen = new Set();
  return rows(result).map((row) => {
    const reviewerId = row?._wmkf_reviewer_value;
    if (!isGuid(reviewerId) || seen.has(reviewerId.toLowerCase())) {
      throw acknowledgementError(
        'Duplicate or invalid Final Writeup reviewer acknowledgements require reconciliation.',
        'final_writeup_acknowledgement_duplicate_key',
        500,
      );
    }
    seen.add(reviewerId.toLowerCase());
    return assertStoredAcknowledgement(row, finalDocumentId, reviewerId);
  });
}

function sameObservedPublication(row, observation) {
  return Boolean(row)
    && sameStableFileId(row.wmkf_sharepointdriveid, observation.driveId)
    && sameStableFileId(row.wmkf_sharepointitemid, observation.itemId)
    && row.wmkf_publicationversionid === observation.publicationVersionId;
}

function exactObservedPersistence(row, observation) {
  const storedLastModified = Date.parse(row?.wmkf_sharepointlastmodified || '');
  return sameObservedPublication(row, observation)
    && row.wmkf_acknowledgedetag === observation.eTag
    && Number.isFinite(storedLastModified)
    && new Date(storedLastModified).toISOString() === observation.lastModified
    && typeof row.wmkf_acknowledgedat === 'string'
    && Number.isFinite(Date.parse(row.wmkf_acknowledgedat));
}

function personalState(row, observation) {
  if (!row) return 'unreviewed';
  return sameObservedPublication(row, observation) ? 'reviewed' : 'updated';
}

function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return `${words[0][0] || ''}${words.length > 1 ? words[words.length - 1][0] || '' : ''}`
    .toUpperCase() || null;
}

function projectReviewers(reviewRows, observation) {
  return reviewRows.map((row) => ({
    reviewerId: row._wmkf_reviewer_value || null,
    name: row._wmkf_reviewer_value_formatted || null,
    initials: initials(row._wmkf_reviewer_value_formatted),
    state: personalState(row, observation),
    acknowledgedAt: row.wmkf_acknowledgedat || null,
  }));
}

function projectAcknowledgementState({
  request,
  finalDocument,
  actingUserSystemId,
  observation,
  acknowledgementResult,
}) {
  const allRows = validatedAcknowledgements(
    acknowledgementResult,
    finalDocument.wmkf_requestdocumentid,
  );
  const personalRows = allRows.filter((row) => (
    sameId(row._wmkf_reviewer_value, actingUserSystemId)
  ));
  if (personalRows.length > 1) assertSingleAcknowledgement({ records: personalRows });
  const personal = assertAcknowledgementIdentity(
    personalRows[0] || null,
    finalDocument.wmkf_requestdocumentid,
    actingUserSystemId,
  );
  const isResponsiblePd = sameId(request._wmkf_programdirector_value, actingUserSystemId);
  return {
    mayAcknowledge: !isResponsiblePd,
    personalState: isResponsiblePd ? 'not-applicable' : personalState(personal, observation),
    acknowledgedAt: personal?.wmkf_acknowledgedat || null,
    // The publication version this viewer's acknowledgement keys to (Slice 6C).
    // Null for the responsible PD even when a historical row exists, so a stale
    // version never surfaces on a stewardship row.
    acknowledgedPublicationVersionId: isResponsiblePd
      ? null
      : (personal?.wmkf_publicationversionid || null),
    hasAcknowledgement: Boolean(personal),
    reviewers: projectReviewers(allRows, observation),
  };
}

function signOffState(row, observation) {
  if (!row) return FINAL_WRITEUP_SIGN_OFF_STATE.NOT_YET;
  return sameObservedPublication(row, observation)
    ? FINAL_WRITEUP_SIGN_OFF_STATE.SIGNED
    : FINAL_WRITEUP_SIGN_OFF_STATE.SIGNED_EDITED_SINCE;
}

/**
 * Sign-off roster for the lead Program Director and superusers (group-review
 * handoff Stage 3). Everyone else gets null. Names only, no internal ids.
 * `expected` = the request's program audience ∩ Program Director persona,
 * minus the lead PD. `others` = everyone else who signed off (Program
 * Coordinators, other staff); they are listed but not counted.
 * A staffing read failure degrades to `unavailable` and never throws, because
 * the POST path calls this after the acknowledgement write has succeeded.
 */
async function projectSignOffRoster({
  request, allRows, observation, actingUserSystemId, isSuperuser, dependencies,
}) {
  const leadId = request._wmkf_programdirector_value || null;
  const isLead = Boolean(leadId) && sameId(leadId, actingUserSystemId);
  if (!isLead && isSuperuser !== true) return null;

  const rowsByReviewer = new Map(allRows.map((row) => [
    String(row._wmkf_reviewer_value || '').toLowerCase(),
    row,
  ]));
  let audience;
  try {
    audience = await dependencies.resolveProgramDirectorAudience(
      request._wmkf_grantprogram_value || null,
    );
  } catch (error) {
    console.error('Final Writeup sign-off roster could not be resolved:', error?.code || error?.message);
    audience = null;
  }
  const knownStatus = audience
    && Object.values(FINAL_WRITEUP_SIGN_OFF_ROSTER_STATUS).includes(audience.status)
    && audience.status !== FINAL_WRITEUP_SIGN_OFF_ROSTER_STATUS.UNAVAILABLE
    && Array.isArray(audience.programDirectors);
  const status = knownStatus ? audience.status : FINAL_WRITEUP_SIGN_OFF_ROSTER_STATUS.UNAVAILABLE;
  const expectedPeople = status === FINAL_WRITEUP_SIGN_OFF_ROSTER_STATUS.CONFIGURED
    ? audience.programDirectors.filter((person) => !sameId(person.reviewerId, leadId))
    : [];
  const expectedIds = new Set(expectedPeople.map((person) => String(person.reviewerId).toLowerCase()));

  return {
    status,
    expected: expectedPeople.map((person) => {
      const row = rowsByReviewer.get(String(person.reviewerId).toLowerCase()) || null;
      return {
        name: person.name,
        state: signOffState(row, observation),
        signedAt: row?.wmkf_acknowledgedat || null,
      };
    }),
    others: allRows
      .filter((row) => {
        const reviewerId = String(row._wmkf_reviewer_value || '').toLowerCase();
        return !expectedIds.has(reviewerId) && !sameId(reviewerId, leadId);
      })
      .map((row) => ({
        name: row._wmkf_reviewer_value_formatted || 'Staff member',
        state: signOffState(row, observation),
        signedAt: row.wmkf_acknowledgedat || null,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function acknowledgementPatch(observation, acknowledgedAt) {
  return {
    wmkf_sharepointdriveid: observation.driveId,
    wmkf_sharepointitemid: observation.itemId,
    wmkf_publicationversionid: observation.publicationVersionId,
    wmkf_acknowledgedetag: observation.eTag,
    wmkf_sharepointlastmodified: observation.lastModified,
    wmkf_acknowledgedat: acknowledgedAt,
  };
}

function acknowledgementName(request, reviewer) {
  const requestLabel = String(request.akoya_requestnum || 'Final Writeup').trim();
  const reviewerLabel = String(reviewer.fullname || reviewer.systemuserid).trim();
  return `${requestLabel} — ${reviewerLabel}`.slice(0, 200);
}

async function rereadExact(finalDocumentId, reviewerId, dependencies) {
  const result = await dependencies.findAcknowledgement(finalDocumentId, reviewerId);
  return assertStoredAcknowledgement(
    assertSingleAcknowledgement(result),
    finalDocumentId,
    reviewerId,
  );
}

export async function getFinalWriteupAcknowledgementState(
  { requestId, actingUserSystemId, isSuperuser = false },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  assertReady(dependencies);
  assertInput({ requestId, actingUserSystemId });
  const { request, finalDocument } = await resolveCurrentFinal(requestId, null, dependencies);
  await resolveReviewer(actingUserSystemId, dependencies);
  const observation = await observeCurrentPublication(finalDocument, dependencies);
  const allResult = await dependencies.findAcknowledgements(finalDocument.wmkf_requestdocumentid);
  const projection = projectAcknowledgementState({
    request,
    finalDocument,
    actingUserSystemId,
    observation,
    acknowledgementResult: allResult,
  });
  const signOffRoster = await projectSignOffRoster({
    request,
    allRows: validatedAcknowledgements(allResult, finalDocument.wmkf_requestdocumentid),
    observation,
    actingUserSystemId,
    isSuperuser,
    dependencies,
  });
  return {
    available: true,
    finalArtifactId: finalDocument.wmkf_requestdocumentid,
    ...projection,
    publicationVersionId: observation.publicationVersionId,
    publicationLastModified: observation.lastModified,
    signOffRoster,
  };
}

export async function markFinalWriteupReviewed(
  { requestId, expectedFinalArtifactId, actingUserSystemId, isSuperuser = false },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  assertReady(dependencies);
  assertInput({
    requestId,
    expectedFinalArtifactId,
    actingUserSystemId,
    requireExpectedFinalArtifactId: true,
  });
  const { request, finalDocument } = await resolveCurrentFinal(
    requestId,
    expectedFinalArtifactId,
    dependencies,
  );
  assertMayAcknowledge(request, actingUserSystemId);
  const reviewer = await resolveReviewer(actingUserSystemId, dependencies);
  const observation = await observeCurrentPublication(finalDocument, dependencies);
  let existing = await rereadExact(
    finalDocument.wmkf_requestdocumentid,
    actingUserSystemId,
    dependencies,
  );

  let reused = false;
  if (sameObservedPublication(existing, observation)) {
    reused = true;
  } else {
    const now = dependencies.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw acknowledgementError(
        'The acknowledgement timestamp could not be established.',
        'final_writeup_acknowledgement_time_invalid',
        500,
      );
    }
    const acknowledgedAt = now.toISOString();
    const patch = acknowledgementPatch(observation, acknowledgedAt);
    try {
      if (existing) {
        if (!existing._etag) {
          throw acknowledgementError(
            'The existing acknowledgement is missing its Dataverse concurrency token.',
            'final_writeup_acknowledgement_etag_missing',
            500,
          );
        }
        await dependencies.updateAcknowledgement(
          existing.wmkf_finalwriteupreviewacknowledgementid,
          patch,
          { ifMatch: existing._etag, actingUserSystemId, noFallback: true },
        );
      } else {
        await dependencies.createAcknowledgement({
          wmkf_name: acknowledgementName(request, reviewer),
          'wmkf_FinalDocument@odata.bind':
            `/wmkf_requestdocuments(${finalDocument.wmkf_requestdocumentid})`,
          'wmkf_Reviewer@odata.bind': `/systemusers(${actingUserSystemId})`,
          ...patch,
        }, { actingUserSystemId, noFallback: true });
      }
    } catch (error) {
      const observed = await rereadExact(
        finalDocument.wmkf_requestdocumentid,
        actingUserSystemId,
        dependencies,
      ).catch(() => null);
      if (!observed || !exactObservedPersistence(observed, observation)) {
        if (error?.status === 409 || error?.status === 412
          || /duplicate|alternate key/i.test(error?.message || '')) {
          throw acknowledgementError(
            'The acknowledgement changed concurrently. Reload and try again.',
            'final_writeup_acknowledgement_conflict',
          );
        }
        throw error;
      }
      existing = observed;
      reused = true;
    }
  }

  if (!reused) {
    existing = await rereadExact(
      finalDocument.wmkf_requestdocumentid,
      actingUserSystemId,
      dependencies,
    );
    if (!existing || !exactObservedPersistence(existing, observation)) {
      throw acknowledgementError(
        'The Final Writeup acknowledgement could not be confirmed from Dataverse.',
        'final_writeup_acknowledgement_unconfirmed',
        500,
      );
    }
  }

  const allResult = await dependencies.findAcknowledgements(finalDocument.wmkf_requestdocumentid);
  const allRows = validatedAcknowledgements(allResult, finalDocument.wmkf_requestdocumentid);
  const signOffRoster = await projectSignOffRoster({
    request, allRows, observation, actingUserSystemId, isSuperuser, dependencies,
  });
  return {
    available: true,
    finalArtifactId: finalDocument.wmkf_requestdocumentid,
    mayAcknowledge: true,
    personalState: 'reviewed',
    acknowledgedAt: existing.wmkf_acknowledgedat,
    acknowledgedPublicationVersionId: existing.wmkf_publicationversionid,
    publicationVersionId: observation.publicationVersionId,
    publicationLastModified: observation.lastModified,
    reused,
    reviewers: projectReviewers(allRows, observation),
    signOffRoster,
  };
}

export {
  personalState as deriveFinalWriteupAcknowledgementState,
  initials as finalWriteupReviewerInitials,
  normalizePublicationObservation as normalizeFinalWriteupPublicationObservation,
  projectAcknowledgementState as projectFinalWriteupAcknowledgementState,
  resolveCurrentFinalFromRows as resolveCurrentFinalWriteupFromRows,
};
