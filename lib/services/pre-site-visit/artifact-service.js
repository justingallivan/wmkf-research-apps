/**
 * Durable Pre-Site Visit Word producer.
 *
 * The model output is first persisted on a claimed wmkf_requestdocument row.
 * Rendering then reads that row back, uploads one Word item, and atomically
 * activates the row with akoya_request.wmkf_CurrentPreSiteVisit.
 * Proposal-core envelope v3 stores the normalized canonical core plus bounded
 * diagnostics; v2 remains readable. Every projection derives the same warning
 * DTO and envelope/named-field divergence fails closed. Wave 20 correction
 * fields participate in reads and create payloads only behind the literal-on
 * guarded-reopen schema readiness interlock.
 */

import { ServiceHttpError } from '../service-http-error.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../request-document-actor-service.js';
import { isGuid } from '../../utils/guid.js';
import {
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import {
  DEFAULT_DEPENDENCIES,
} from './artifact-dependencies.js';
import {
  SECTION_FIELDS,
  buildPreSiteVisitInputSnapshot,
  buildPreSiteVisitIdentity,
  conditionalOptions,
  fileNameFor,
  prepareGeneratedCore,
  persistedDraft,
  projectPreSiteVisitArtifact,
  projectReopenHistory,
  proposalCorePatch,
  renderFingerprint,
  sanitizeError,
  sameNullableId,
  staleGenerationReplayError,
  validateDiagnostics,
  validateNarrativePrompt,
  validateTemplateContract,
} from './artifact-model.js';
import { getPreSiteVisitArtifactStatus } from './artifact-reader.js';
import {
  assertOwnedClaim,
  activeRequestBucket,
  claimExisting,
  commitReadyLineage,
  markFailedIfOwned,
  prepareFreshFilename,
  rereadByGenerationKey,
} from './artifact-lineage.js';
import { recordCleanup, recoverUploadedFile } from './artifact-upload-recovery.js';


/** Generate, recover, or safely reuse one governed Pre-Site Word draft. */
export async function generatePreSiteVisitArtifact(
  { requestId, actingUserSystemId = null },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(requestId)) {
    throw new ServiceHttpError('A valid requestId is required.', {
      httpStatus: 400,
      code: 'invalid_request_id',
    });
  }

  // Promotion makes the current Word item the staff-owned Site Visit workspace.
  // Check that lifecycle before loading inputs, resolving the prompt, claiming a
  // row, calling Claude, rendering, or touching SharePoint.
  const currentStatus = await getPreSiteVisitArtifactStatus({ requestId }, dependencies);
  if (currentStatus.currentArtifact
    && currentStatus.currentArtifact.lifecycleState !== REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT) {
    throw new ServiceHttpError(
      'This Word draft is already the Site Visit workspace and can no longer be regenerated.',
      {
        httpStatus: 409,
        code: 'pre_site_visit_regeneration_locked',
        body: {
          error: 'This Word draft is already the Site Visit workspace and can no longer be regenerated.',
          code: 'pre_site_visit_regeneration_locked',
        },
      },
    );
  }

  // The exact narrative and all authoritative structured inputs are frozen before
  // a claim is created. A missing source therefore has no durable side effect.
  const inputs = await dependencies.loadInputs({ requestId });
  if (String(inputs?.context?.requestId || '').toLowerCase() !== requestId.toLowerCase()) {
    throw new ServiceHttpError('The loaded Pre-Site inputs do not belong to the requested record.', {
      httpStatus: 409,
      code: 'pre_site_visit_request_mismatch',
    });
  }
  if (!inputs.context.cycleCode) {
    throw new ServiceHttpError('The request needs a meeting-date cycle before generation.', {
      httpStatus: 409,
      code: 'pre_site_visit_cycle_missing',
    });
  }
  const promptIdentity = validateNarrativePrompt(
    await dependencies.getCurrentPrompt(PRE_SITE_VISIT_CONTRACT.promptName),
  );
  validateTemplateContract();
  const inputSnapshot = buildPreSiteVisitInputSnapshot(inputs);
  const inputSnapshotJson = JSON.stringify(inputSnapshot);
  const { inputFingerprint, generationKey } = buildPreSiteVisitIdentity({
    requestId,
    inputSnapshot,
    promptIdentity,
    reopenCycleId: currentStatus.currentArtifact?.correction?.cycleId || null,
  });

  let row = await rereadByGenerationKey(generationKey, dependencies);
  let claimToken = null;
  let observedRunId = null;
  // Replay guard (parity with the Pre-RP Brief service, plan §8): a replayed
  // request whose generation key resolves to a SUPERSEDED row, or to a READY
  // row that is no longer the current pointer target, is refused rather than
  // reactivated over the newer lineage.
  // The pointer observed before any claim is the activation fence: if a
  // concurrent generation moves it before this one activates,
  // `commitReadyLineage` refuses rather than superseding the newer document.
  const expectedPointerId = currentStatus.currentArtifact?.artifactId || null;
  if (row?.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED) {
    throw staleGenerationReplayError();
  }
  if (row && expectedPointerId && !sameNullableId(expectedPointerId, row.wmkf_requestdocumentid)) {
    if (row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
      throw staleGenerationReplayError();
    }
    // A FAILED or expired-GENERATING row from before the current document
    // (an older lineage whose inputs recur) must not be reclaimed over it;
    // only a pending attempt newer than the current document may be retried.
    // Fails closed when either creation time is unreadable.
    const result = await dependencies.findByRequest(requestId, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    });
    const currentRow = (result?.records || []).find((candidate) => (
      sameNullableId(candidate.wmkf_requestdocumentid, expectedPointerId)
    ));
    const rowCreatedAt = Date.parse(row.createdon || '');
    const currentCreatedAt = Date.parse(currentRow?.createdon || '');
    if (!Number.isFinite(rowCreatedAt) || !Number.isFinite(currentCreatedAt) || rowCreatedAt <= currentCreatedAt) {
      throw staleGenerationReplayError();
    }
  }
  if (row?.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
    const ready = await commitReadyLineage(row, { actingUserSystemId, expectedPointerId }, dependencies);
    return { artifact: projectPreSiteVisitArtifact(ready), reused: true, recovered: false };
  }

  try {
    if (row) {
      claimToken = await claimExisting(row, actingUserSystemId, dependencies);
      if (!claimToken) {
        const current = await rereadByGenerationKey(generationKey, dependencies);
        return {
          artifact: projectPreSiteVisitArtifact(current || row),
          reused: true,
          recovered: false,
        };
      }
      row = await assertOwnedClaim(generationKey, claimToken, dependencies);
      const recovered = await recoverUploadedFile(row, claimToken, actingUserSystemId, dependencies, { expectedPointerId });
      if (recovered) {
        return { artifact: projectPreSiteVisitArtifact(recovered), reused: true, recovered: true };
      }
      row = await prepareFreshFilename(
        row,
        inputs.context.requestNumber,
        claimToken,
        actingUserSystemId,
        dependencies,
      );
    } else {
      const bucket = await activeRequestBucket(
        requestId,
        inputs.context.requestNumber,
        dependencies,
      );
      if (!String(bucket.folder || '').trim()) {
        throw new ServiceHttpError('The active request SharePoint location has no folder path.', {
          httpStatus: 409,
        });
      }
      claimToken = dependencies.newClaimToken();
      const folderPath = `${String(bucket.folder).replace(/\/+$/, '')}`
        + `/${PRE_SITE_VISIT_CONTRACT.relativeFolder}`;
      await dependencies.createDocument({
        wmkf_name: `${inputs.context.requestNumber} Pre-Site Visit`,
        'wmkf_Request@odata.bind': `/akoya_requests(${requestId})`,
        wmkf_artifacttype: PRE_SITE_VISIT_CONTRACT.artifactType,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
        wmkf_generationkey: generationKey,
        wmkf_cyclecode: inputs.context.cycleCode,
        wmkf_inputfingerprint: inputFingerprint,
        wmkf_claimtoken: claimToken,
        wmkf_producer: PRE_SITE_VISIT_CONTRACT.producer,
        wmkf_templateid: PRE_SITE_VISIT_CONTRACT.templateId,
        wmkf_templateversion: PRE_SITE_VISIT_CONTRACT.templateVersion,
        wmkf_promptname: promptIdentity.promptName,
        wmkf_promptversion: promptIdentity.promptVersion,
        'wmkf_AIPrompt@odata.bind': `/wmkf_ai_prompts(${promptIdentity.promptId})`,
        wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
        wmkf_sharepointfolderpath: folderPath,
        wmkf_filename: fileNameFor(inputs.context.requestNumber, generationKey, claimToken),
        ...(dependencies.isGuardedReopenSchemaReady?.() ? {
          wmkf_reopencycleid: currentStatus.currentArtifact?.correction?.cycleId || null,
        } : {}),
        wmkf_attemptcount: 1,
      }, {
        actingUserSystemId,
        actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED,
        actorContext: {
          operation: 'pre-site-generation',
          requestId,
          requestNumber: inputs.context.requestNumber,
          operationId: generationKey,
        },
      });
      row = await assertOwnedClaim(generationKey, claimToken, dependencies);
    }

    let draft = persistedDraft(row, inputSnapshot);
    let runId = row._wmkf_airun_value || null;
    observedRunId = runId;
    if (!draft) {
      const generated = await dependencies.runProposalCore({
        requestId,
        inputs,
        actingUserSystemId,
        runSource: 'Vercel Interactive',
      });
      runId = generated.runId || null;
      observedRunId = runId;
      if (!isGuid(runId)
        || generated.meta?.promptId?.toLowerCase() !== promptIdentity.promptId
        || Number(generated.meta?.promptVersion) !== promptIdentity.promptVersion) {
        throw new ServiceHttpError('The executed Pre-Site prompt did not match the claimed prompt version.', {
          httpStatus: 409,
          code: 'pre_site_visit_prompt_changed',
        });
      }
      const preparedGenerated = prepareGeneratedCore(generated.proposalCore, {
        personnelNames: inputs.context.personnel.map((person) => person.name),
      });
      // Slice 4 (plan §4.5): composeRefereeSection's own diagnostics
      // (e.g. referee_blocker_unnamed) were produced once, at roster-load
      // time (loadPreSiteVisitInputs) — captured here, durably, alongside
      // the rest of the generation-time diagnostics, since the roster
      // itself is never re-fetched on a later read.
      const generatedDiagnostics = [...new Map([
        ...preparedGenerated.diagnostics,
        ...validateDiagnostics(generated.diagnostics),
        ...validateDiagnostics(inputs.context.refereeSectionDiagnostics),
      ].map((diagnostic) => [JSON.stringify(diagnostic), diagnostic])).values()];
      row = await assertOwnedClaim(generationKey, claimToken, dependencies);
      await dependencies.updateDocument(row.wmkf_requestdocumentid, {
        ...proposalCorePatch(preparedGenerated.proposalCore),
        wmkf_presiteproposalcorejson: JSON.stringify({
          schemaVersion: 4,
          proposalCore: preparedGenerated.proposalCore,
          diagnostics: generatedDiagnostics,
        }),
        wmkf_presiteinputsnapshotjson: inputSnapshotJson,
        wmkf_promptname: generated.meta.promptName,
        wmkf_promptversion: generated.meta.promptVersion,
        'wmkf_AIPrompt@odata.bind': `/wmkf_ai_prompts(${generated.meta.promptId})`,
        'wmkf_AIRun@odata.bind': `/wmkf_ai_runs(${runId})`,
      }, conditionalOptions(row, actingUserSystemId));
      row = await assertOwnedClaim(generationKey, claimToken, dependencies);
      draft = persistedDraft(row, inputSnapshot);
    }

    const exactRenderFingerprint = renderFingerprint(draft);
    // Slice 4 (Codex AR-1 finding 6, "write then update"): the renderer
    // returns {docx, diagnostics} — an underline count found only DURING
    // rendering (referee_name_not_matched) has no path to WARNING_MESSAGES
    // until it is merged into the persisted diagnostics envelope here, atop
    // what generation already stored.
    const { docx, diagnostics: renderDiagnostics } = await dependencies.renderDocx({
      documentFields: draft.documentFields,
      proposalCore: draft.proposalCore,
      personnelNames: draft.personnelNames,
      refereeSection: draft.documentFields.refereeSection ?? null,
    });
    const contentHash = await dependencies.hashDocx(docx);
    const mergedDiagnostics = [...new Map([
      ...draft.diagnostics,
      ...validateDiagnostics(renderDiagnostics),
    ].map((diagnostic) => [JSON.stringify(diagnostic), diagnostic])).values()];
    row = await assertOwnedClaim(generationKey, claimToken, dependencies);
    await dependencies.updateDocument(row.wmkf_requestdocumentid, {
      wmkf_renderinputfingerprint: exactRenderFingerprint,
      wmkf_contenthash: contentHash,
      wmkf_presiteproposalcorejson: JSON.stringify({
        schemaVersion: 4,
        proposalCore: draft.proposalCore,
        diagnostics: mergedDiagnostics,
      }),
    }, conditionalOptions(row, actingUserSystemId));
    row = await assertOwnedClaim(generationKey, claimToken, dependencies);
    draft = persistedDraft(row, inputSnapshot);

    await dependencies.ensureFolderPath('akoya_request', row.wmkf_sharepointfolderpath);
    row = await assertOwnedClaim(generationKey, claimToken, dependencies);
    const uploaded = await dependencies.uploadFile(
      'akoya_request',
      row.wmkf_sharepointfolderpath,
      row.wmkf_filename,
      docx,
      PRE_SITE_VISIT_CONTRACT.contentType,
    );
    if (!uploaded?.driveId || !uploaded?.id || !uploaded?.versionId) {
      throw new ServiceHttpError('SharePoint upload returned incomplete stable identity.', {
        httpStatus: 502,
        code: 'pre_site_visit_upload_identity_incomplete',
      });
    }
    try {
      const ready = await commitReadyLineage(
        row,
        { metadata: uploaded, claimToken, actingUserSystemId, expectedPointerId },
        dependencies,
      );
      return { artifact: projectPreSiteVisitArtifact(ready), reused: false, recovered: false };
    } catch (error) {
      const code = error?.body?.code || error?.code;
      // Pre-commit activation refusals leave a claim-specific upload with no
      // registry identity: delete it, or record cleanup work if that fails,
      // so the file is never orphaned invisibly.
      if (code === 'claim_lost' || code === 'pre_site_visit_pointer_changed') {
        try {
          await dependencies.deleteFile(uploaded.driveId, uploaded.id);
        } catch (cleanupError) {
          await recordCleanup(
            row,
            uploaded,
            `${code}_delete_failed`,
            cleanupError,
            actingUserSystemId,
            dependencies,
          );
        }
      }
      throw error;
    }
  } catch (error) {
    if (!row && (
      [409, 412].includes(error?.status)
      || /duplicate|alternate key/i.test(error?.message || '')
    )) {
      const winner = await rereadByGenerationKey(generationKey, dependencies);
      if (winner) {
        return {
          artifact: projectPreSiteVisitArtifact(winner),
          reused: true,
          recovered: false,
        };
      }
    }
    const safe = sanitizeError(error);
    try {
      await markFailedIfOwned(generationKey, claimToken, {
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
        wmkf_lasterrorcode: safe.code,
        wmkf_lasterrormessage: safe.message,
        wmkf_lastfailedat: new Date().toISOString(),
        ...(isGuid(error?.runId || observedRunId) ? {
          'wmkf_AIRun@odata.bind': `/wmkf_ai_runs(${error?.runId || observedRunId})`,
        } : {}),
      }, actingUserSystemId, dependencies);
    } catch (patchError) {
      console.error('[pre-site-visit] failed to persist failure state:', patchError.message);
    }
    if (error instanceof ServiceHttpError) throw error;
    throw new ServiceHttpError('Pre-Site Visit generation did not complete.', {
      httpStatus: 500,
      body: {
        error: 'Pre-Site Visit generation did not complete.',
        code: safe.code,
        runId: error?.runId || observedRunId || null,
      },
    });
  }
}

export {
  SECTION_FIELDS,
  buildPreSiteVisitInputSnapshot,
  buildPreSiteVisitIdentity,
  getPreSiteVisitArtifactStatus,
  projectPreSiteVisitArtifact,
  projectReopenHistory,
  validateNarrativePrompt,
  validateTemplateContract,
};
