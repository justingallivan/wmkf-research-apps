/**
 * Governed Site Visit -> Final Writeup compatibility facade.
 *
 * The facade retains the two public command bodies and their existing create
 * seam. State, model, and claim helpers live in explicit leaves while callers
 * continue to import this original module.
 */
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../request-document-actor-service.js';
import { isGuid } from '../../utils/guid.js';
import {
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import { DEFAULT_DEPENDENCIES } from './transition-dependencies.js';
import {
   assertEligibleSource,
  claimPayload, committedFinal, conditionalOptions, finalError, findCurrentFinal, generationKey,
  leadershipCommittedByThisCall, leadershipConflict, leadershipResult, projectArtifact,
  resolveAuthorization, resolveSource, sameId, stableMetadataMatches,
  LEADERSHIP_VERIFY_ERRORS,
} from './transition-model.js';
import {
  getFinalWriteupStatus, readState, verifyDocument, verifySource,
} from './transition-state.js';
import {
  activate, assertClaimIdentity, assertOwned, claimExisting, markFailedIfOwned,
  reconcileCompetingClaim, rereadByGenerationKey,
} from './transition-claims.js';

export async function startFinalWriteup(
  { requestId, expectedArtifactId, isSuperuser = false, actingUserSystemId = null },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!dependencies.schemaReady?.()) {
    throw finalError(
      'Final Writeup is unavailable until its Dataverse schema is verified.',
      'final_writeup_schema_not_ready',
      503,
    );
  }
  if (!isGuid(requestId) || !isGuid(expectedArtifactId)) {
    throw finalError(
      'Valid requestId and expectedArtifactId values are required.',
      'final_writeup_invalid_identity',
      400,
    );
  }
  if (!isGuid(actingUserSystemId)) {
    throw finalError(
      'A resolved staff identity is required to start Final Writeup.',
      'final_writeup_actor_required',
      403,
    );
  }

  let state = await readState(requestId, dependencies);
  const existingCurrent = findCurrentFinal(state);
  if (existingCurrent) {
    const committed = committedFinal(state, expectedArtifactId, existingCurrent.wmkf_requestdocumentid);
    if (!committed) {
      throw finalError(
        'A different or incomplete Final Writeup is already current.',
        'final_writeup_already_exists',
      );
    }
    return { artifact: projectArtifact(committed), reused: true, inProgress: false };
  }

  let source = assertEligibleSource(resolveSource(state, expectedArtifactId));
  const authorization = resolveAuthorization(
    state,
    { isSuperuser, actingUserSystemId },
  );
  if (!authorization.canStart) {
    throw finalError(
      'Only the lead Program Director (or a superuser) can start Final Writeup for this request.',
      'final_writeup_forbidden',
      403,
    );
  }

  const resolveActor = dependencies.resolveActor || DEFAULT_DEPENDENCIES.resolveActor;
  const actorResolution = await resolveActor({
    actingUserSystemId,
    policy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
  });
  const verifiedActingUserSystemId = actorResolution.schemaReady
    ? actorResolution.actorId
    : actingUserSystemId;

  const verified = await verifySource(source, dependencies);
  const key = generationKey(requestId, source, verified);
  state = await readState(requestId, dependencies);
  source = assertEligibleSource(resolveSource(state, expectedArtifactId));
  const competing = await reconcileCompetingClaim(
    state,
    source,
    key,
    verifiedActingUserSystemId,
    dependencies,
  );
  if (competing) {
    return { artifact: projectArtifact(competing), reused: true, inProgress: true };
  }
  let row = await rereadByGenerationKey(key, dependencies);
  let claimToken = null;
  try {
    if (!row) {
      claimToken = dependencies.newClaimToken();
      try {
        await dependencies.createDocument(
          claimPayload(state, source, verified, key, claimToken),
          {
            actingUserSystemId: verifiedActingUserSystemId,
            actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
            actorContext: {
              operation: 'final-writeup-claim',
              requestId,
              requestNumber: state.request.akoya_requestnum || null,
              operationId: key,
            },
          },
        );
      } catch (error) {
        if (![409, 412].includes(error?.status)
          && !/duplicate|alternate key/i.test(error?.message || '')) throw error;
      }
      row = await rereadByGenerationKey(key, dependencies);
      if (!row) {
        throw finalError(
          'The Final Writeup claim could not be read back.',
          'final_writeup_claim_missing',
          500,
        );
      }
      assertClaimIdentity(row, source, verified, key);
      if (row.wmkf_claimtoken !== claimToken) claimToken = null;
    } else {
      assertClaimIdentity(row, source, verified, key);
    }

    state = await readState(requestId, dependencies);
    const committed = committedFinal(
      state,
      source.wmkf_requestdocumentid,
      row.wmkf_requestdocumentid,
    );
    if (committed) {
      return { artifact: projectArtifact(committed), reused: true, inProgress: false };
    }

    if (!claimToken) {
      claimToken = await claimExisting(row, verifiedActingUserSystemId, dependencies);
      if (!claimToken) {
        return { artifact: projectArtifact(row), reused: true, inProgress: true };
      }
    }
    row = await assertOwned(key, claimToken, dependencies);
    source = assertEligibleSource(resolveSource(state, expectedArtifactId));
    const activated = await activate(
      state,
      source,
      row,
      verified,
      verifiedActingUserSystemId,
      dependencies,
    );
    return {
      artifact: projectArtifact(activated.row),
      reused: activated.reused,
      inProgress: false,
    };
  } catch (error) {
    await markFailedIfOwned(
      key,
      claimToken,
      error,
      verifiedActingUserSystemId,
      dependencies,
    );
    throw error;
  }
}
export async function advanceToLeadershipReview(
  { requestId, expectedFinalArtifactId, isSuperuser = false, actingUserSystemId = null },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!dependencies.schemaReady?.()) {
    throw finalError(
      'Final Writeup is unavailable until its Dataverse schema is verified.',
      'final_writeup_schema_not_ready',
      503,
    );
  }
  if (!isGuid(requestId) || !isGuid(expectedFinalArtifactId)) {
    throw finalError(
      'Valid requestId and expectedFinalArtifactId values are required.',
      'final_writeup_invalid_identity',
      400,
    );
  }
  if (!isGuid(actingUserSystemId)) {
    throw finalError(
      'A resolved staff identity is required to start leadership review.',
      'final_writeup_actor_required',
      403,
    );
  }

  const state = await readState(requestId, dependencies);
  const authorization = resolveAuthorization(state, { isSuperuser, actingUserSystemId });
  if (!authorization.canStart) {
    throw finalError(
      'Only the lead Program Director (or a superuser) can move this writeup to leadership review.',
      'final_writeup_leadership_forbidden',
      403,
    );
  }
  const resolveActor = dependencies.resolveActor || DEFAULT_DEPENDENCIES.resolveActor;
  const actorResolution = await resolveActor({
    actingUserSystemId,
    policy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
  });
  const actorId = actorResolution.schemaReady ? actorResolution.actorId : actingUserSystemId;

  const current = findCurrentFinal(state);
  if (!current) {
    throw finalError(
      'This request has no current Final Writeup to move to leadership review.',
      'final_writeup_leadership_final_missing',
    );
  }
  if (!sameId(current.wmkf_requestdocumentid, expectedFinalArtifactId)) {
    throw finalError(
      'A different Final Writeup is now current. Reload before continuing.',
      'final_writeup_leadership_stale_final',
    );
  }
  const finalId = current.wmkf_requestdocumentid;
  const sourceId = current._wmkf_sourcedocument_value;
  const committed = committedFinal(state, sourceId, finalId);
  if (!committed) {
    throw finalError(
      'The Final Writeup transition requires reconciliation.',
      'final_writeup_committed_state_invalid',
      500,
    );
  }
  if (committed.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL) {
    return leadershipResult(committed, true);
  }
  if (!committed.wmkf_sharepointdriveid || !committed.wmkf_sharepointitemid) {
    throw finalError(
      'The Final Writeup has no stable SharePoint identity.',
      'final_writeup_leadership_identity_missing',
    );
  }
  conditionalOptions(committed);

  const verified = await verifyDocument(committed, dependencies, LEADERSHIP_VERIFY_ERRORS);

  // Commit-time check: same current pointer, same row version, same document.
  const fresh = await readState(requestId, dependencies);
  const freshRow = fresh.rows.find((row) => sameId(row.wmkf_requestdocumentid, finalId));
  if (!sameId(fresh.request._wmkf_currentfinalwriteup_value, finalId) || !freshRow) {
    throw leadershipConflict();
  }
  if (freshRow.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL) {
    const concurrent = committedFinal(fresh, sourceId, finalId);
    if (concurrent) return leadershipResult(concurrent, true);
    throw leadershipConflict();
  }
  if (freshRow.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
    || freshRow.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
    || freshRow._etag !== committed._etag) {
    throw leadershipConflict();
  }
  const metadataNow = await dependencies.getFileMetadataById(
    freshRow.wmkf_sharepointdriveid,
    freshRow.wmkf_sharepointitemid,
    { siteId: freshRow.wmkf_sharepointsiteid || null },
  );
  if (!metadataNow
    || !sameId(metadataNow.driveId, freshRow.wmkf_sharepointdriveid)
    || !sameId(metadataNow.id, freshRow.wmkf_sharepointitemid)
    || !stableMetadataMatches(verified.metadata, metadataNow)) {
    throw finalError(...LEADERSHIP_VERIFY_ERRORS.changed);
  }

  const startedAt = dependencies.now().toISOString();
  const operations = [
    {
      method: 'PATCH',
      entitySet: requestDocumentAdapter.ENTITY_SET_NAME,
      key: finalId,
      body: {
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
        wmkf_leadershipreviewstartedat: startedAt,
        'wmkf_LeadershipReviewStartedBy@odata.bind': `/systemusers(${actorId})`,
        wmkf_sharepointversionid: verified.metadata.versionId,
        wmkf_sharepointetag: verified.metadata.eTag,
        wmkf_sharepointlastmodified: verified.metadata.lastModified,
        wmkf_filesize: verified.metadata.size,
        wmkf_contenthash: verified.contentHash,
      },
      ifMatch: conditionalOptions(freshRow).ifMatch,
    },
    {
      method: 'PATCH',
      entitySet: grantRequestAdapter.ENTITY_SET_NAME,
      key: fresh.request.akoya_requestid,
      body: {
        'wmkf_CurrentFinalWriteup@odata.bind': `/wmkf_requestdocuments(${finalId})`,
      },
      ifMatch: conditionalOptions(fresh.request).ifMatch,
    },
  ];
  try {
    await dependencies.commitChangeset(operations, { actingUserSystemId: actorId });
  } catch (error) {
    const observed = await readState(requestId, dependencies).catch(() => null);
    const landed = observed && leadershipCommittedByThisCall(observed, sourceId, finalId, verified);
    if (landed) return leadershipResult(landed, true);
    if (error?.status === 412 || /\b412\b/.test(error?.message || '')) {
      throw leadershipConflict();
    }
    throw error;
  }
  const observed = await readState(requestId, dependencies);
  const landed = leadershipCommittedByThisCall(observed, sourceId, finalId, verified);
  if (!landed) {
    throw finalError(
      'The leadership review transition could not be confirmed from Dataverse.',
      'final_writeup_leadership_unconfirmed',
      500,
    );
  }
  return leadershipResult(landed, false);
}

export {
  getFinalWriteupStatus,
  generationKey as buildFinalWriteupGenerationKey,
  projectArtifact as projectFinalWriteupArtifact,
};
