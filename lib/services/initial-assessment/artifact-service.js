/**
 * Governed Initial Assessment producer + read model.
 *
 * Cross-store success invariant:
 * - SharePoint owns DOCX bytes and version history.
 * - wmkf_requestdocument owns stable site/drive/item identity and provenance.
 * - callers receive Ready only after the final registry PATCH succeeds.
 *
 * Exact retries converge on one generation key. A Ready row is immutable to
 * this producer, so staff edits in Word are never overwritten. When changed
 * authoritative inputs create a replacement, its Ready transition and the
 * supersession of prior Ready rows commit in one ETag-guarded changeset.
 * Reverting inputs atomically reactivates the exact earlier Ready artifact.
 * Recovery hashes governed `word/` content rather than ZIP/container metadata
 * so SharePoint package normalization does not impersonate a staff edit.
 * Governed writes require a positively resolved request-library parent.
 * Reads refresh response-only file metadata by stable Graph drive/item ID;
 * Dataverse remains the upload/finalization snapshot and is never updated by
 * that read-through.
 */
// Compatibility facade: extracted identity, read, lineage, and upload-recovery leaves retain the public imports.

import crypto from 'crypto';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { executePrompt } from '../execute-prompt.js';
import { getExecutorBudget } from '../executor-budget-service.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../request-document-actor-service.js';
import { getAiProposalNarrativeText } from '../workbench-proposal-documents.js';
import { meetingDateToCycleCode } from '../../utils/cycle-code.js';
import {
  INITIAL_ASSESSMENT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import { requestInstitution } from '../../../shared/utils/institution.js';
import { renderInitialAssessmentDocx } from './template.js';
import {
  hashGovernedDocxContent,
} from '../documents/governed-docx-hash.js';
import {
  CONTENT_TYPE,
  sanitizeError,
  sanitizeFilePart,
  validateGenerated,
  projectArtifact,
  buildInitialAssessmentIdentity,
} from './artifact-model.js';
import {
  commitReadyLineage,
  getActiveRequestBucket,
  getRequestOrThrow,
  rereadByGenerationKey,
  assertOwnedClaim,
  conditionalOptions,
  claimExisting,
  prepareClaimForGeneration,
  markFailedIfOwned,
} from './artifact-lineage.js';
import {
  cleanupSupersededUpload,
  recoverUploadedFile,
} from './artifact-upload-recovery.js';
import {
  listInitialAssessmentArtifacts,
  resolveCanonicalInitialAssessment,
  listInitialAssessmentArtifactVersions,
  listInitialAssessmentCycles,
} from './artifact-reader.js';

export { hashGovernedDocxContent };


/**
 * Generate or safely reuse one governed Initial Assessment.
 */
export async function generateInitialAssessment({ requestId, actingUserSystemId = null }) {
  const request = await getRequestOrThrow(requestId);
  const requestNumber = String(request.akoya_requestnum || '').trim();
  const title = String(request.akoya_title || '').trim();
  const institution = requestInstitution(request) || '';
  const cycleCode = request.wmkf_meetingdate
    ? meetingDateToCycleCode(request.wmkf_meetingdate)?.toUpperCase()
    : null;
  if (!requestNumber || !title || !institution || !cycleCode) {
    throw new ServiceHttpError(
      'The request must have a request number, title, institution, and meeting-date cycle before generation.',
      { httpStatus: 409 },
    );
  }

  const proposal = await getAiProposalNarrativeText(requestId, requestNumber);
  if (!proposal?.text || proposal.text.trim().length < 60) {
    throw new ServiceHttpError(
      `No usable AI proposal narrative was found at AI Materials/ProposalNarrative_${requestNumber}.pdf.`,
      { httpStatus: 409 },
    );
  }

  const { inputFingerprint, generationKey } = buildInitialAssessmentIdentity({
    requestId,
    requestNumber,
    title,
    institution,
    cycleCode,
    proposalFilename: proposal.filename,
    proposalText: proposal.text,
  });

  let row = await rereadByGenerationKey(generationKey);
  let claimToken = null;
  if (row?.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
    const current = await commitReadyLineage(row, { actingUserSystemId });
    return { artifact: projectArtifact(current, request), reused: true, recovered: false };
  }

  let runId = null;
  try {
    if (row) {
      claimToken = await claimExisting(row, actingUserSystemId);
      if (!claimToken) {
        const current = await rereadByGenerationKey(generationKey);
        return {
          artifact: current ? projectArtifact(current, request) : projectArtifact(row, request),
          reused: true,
          recovered: false,
        };
      }
      row = await assertOwnedClaim(generationKey, claimToken);
      const recovered = await recoverUploadedFile(row, claimToken, actingUserSystemId);
      if (recovered) {
        return { artifact: projectArtifact(recovered, request), reused: true, recovered: true };
      }
      row = await prepareClaimForGeneration(
        row,
        requestNumber,
        generationKey,
        claimToken,
        actingUserSystemId,
      );
    } else {
      const bucket = await getActiveRequestBucket(requestId, requestNumber);
      const folderPath = `${bucket.folder}/${INITIAL_ASSESSMENT_CONTRACT.relativeFolder}`;
      claimToken = crypto.randomUUID();
      const fileName = `${sanitizeFilePart(requestNumber)} Initial Assessment `
        + `${generationKey.slice(0, 8)}-${claimToken.slice(0, 8)}.docx`;
      await requestDocumentAdapter.create({
        wmkf_name: `${requestNumber} Initial Assessment`,
        'wmkf_Request@odata.bind': `/akoya_requests(${requestId})`,
        wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
        wmkf_generationkey: generationKey,
        wmkf_cyclecode: cycleCode,
        wmkf_inputfingerprint: inputFingerprint,
        wmkf_claimtoken: claimToken,
        wmkf_producer: INITIAL_ASSESSMENT_CONTRACT.producer,
        wmkf_templateid: INITIAL_ASSESSMENT_CONTRACT.templateId,
        wmkf_templateversion: INITIAL_ASSESSMENT_CONTRACT.templateVersion,
        wmkf_promptname: INITIAL_ASSESSMENT_CONTRACT.promptName,
        wmkf_promptversion: INITIAL_ASSESSMENT_CONTRACT.promptVersion,
        wmkf_sharepointfolderpath: folderPath,
        wmkf_filename: fileName,
        wmkf_attemptcount: 1,
      }, {
        actingUserSystemId,
        actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED,
        actorContext: {
          operation: 'initial-assessment-generation',
          requestId,
          requestNumber,
          operationId: generationKey,
        },
      });
      row = await assertOwnedClaim(generationKey, claimToken);
    }
  } catch (error) {
    if (!row && (
      [409, 412].includes(error?.status)
      || /duplicate|alternate key/i.test(error?.message || '')
    )) {
      row = await rereadByGenerationKey(generationKey);
      if (row) {
        return { artifact: projectArtifact(row, request), reused: true, recovered: false };
      }
    }
    const safe = sanitizeError(error);
    try {
      await markFailedIfOwned(generationKey, claimToken, {
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
        wmkf_lasterrorcode: safe.code,
        wmkf_lasterrormessage: safe.message,
        wmkf_lastfailedat: new Date().toISOString(),
      }, actingUserSystemId);
    } catch (patchError) {
      console.error('[initial-assessment] failed to persist failure state:', patchError.message);
    }
    if (error instanceof ServiceHttpError) throw error;
    throw new ServiceHttpError('Initial Assessment generation did not complete.', {
      httpStatus: 500,
      body: {
        error: 'Initial Assessment generation did not complete.',
        code: safe.code,
        runId: null,
      },
    });
  }

  try {
    // Admin-tunable standing budget (EXECUTOR_BUDGET_DEFAULTS, 2026-09-18): the
    // prompt row's own wmkf_ai_maxtokens (2,200) was consumed by Opus 5's
    // default thinking before any answer text. The Executor prefers this
    // override and still caps it to the resolved model's output ceiling.
    const budget = await getExecutorBudget(INITIAL_ASSESSMENT_CONTRACT.promptName);
    const result = await executePrompt({
      promptName: INITIAL_ASSESSMENT_CONTRACT.promptName,
      requestId,
      requireNoPersistence: true,
      overrideVariables: { proposal_text: proposal.text },
      runSource: 'Vercel Interactive',
      actingUserSystemId,
      maxTokensOverride: budget.maxTokensOverride,
      timeoutMsOverride: budget.timeoutMsOverride,
    });
    runId = result.runId;
    if (result.blocked) throw new Error('Initial Assessment prompt was unexpectedly blocked.');
    if (result.meta?.promptVersion !== INITIAL_ASSESSMENT_CONTRACT.promptVersion) {
      // The paid call already happened and its run row is Completed; fail with
      // a specific code so the Failed row names the real cause instead of the
      // generic initial_assessment_failed (2026-09-18 rehearsal lesson).
      const mismatch = new Error(
        `Initial Assessment prompt version ${result.meta?.promptVersion} does not match producer contract ${INITIAL_ASSESSMENT_CONTRACT.promptVersion}.`,
      );
      mismatch.code = 'initial_assessment_prompt_version_mismatch';
      throw mismatch;
    }
    const generated = validateGenerated(result.parsed);
    const docx = await renderInitialAssessmentDocx({
      requestNumber,
      title,
      institution,
      generated,
    });
    const contentHash = await hashGovernedDocxContent(docx);

    row = await assertOwnedClaim(generationKey, claimToken);
    await requestDocumentAdapter.update(row.wmkf_requestdocumentid, {
      wmkf_contenthash: contentHash,
      wmkf_promptname: result.meta.promptName,
      wmkf_promptversion: result.meta.promptVersion,
      ...(result.meta.promptId
        ? { 'wmkf_AIPrompt@odata.bind': `/wmkf_ai_prompts(${result.meta.promptId})` }
        : {}),
      ...(runId ? { 'wmkf_AIRun@odata.bind': `/wmkf_ai_runs(${runId})` } : {}),
    }, conditionalOptions(row, actingUserSystemId));
    row = await assertOwnedClaim(generationKey, claimToken);

    await GraphService.ensureFolderPath('akoya_request', row.wmkf_sharepointfolderpath);
    row = await assertOwnedClaim(generationKey, claimToken);
    const uploaded = await GraphService.uploadFile(
      'akoya_request',
      row.wmkf_sharepointfolderpath,
      row.wmkf_filename,
      docx,
      CONTENT_TYPE,
    );
    let ready;
    try {
      ready = await commitReadyLineage(row, {
        metadata: uploaded,
        claimToken,
        actingUserSystemId,
      });
    } catch (error) {
      if (error instanceof ServiceHttpError && error.body?.code === 'claim_lost') {
        await cleanupSupersededUpload(
          uploaded,
          generationKey,
          actingUserSystemId,
        );
      } else if (error instanceof ServiceHttpError
        && error.body?.code === 'orphan_cleanup_required') {
        await cleanupSupersededUpload(
          uploaded,
          generationKey,
          actingUserSystemId,
          {
            reason: 'cleanup_overflow_race_delete_failed',
            errorCode: 'orphan_cleanup_overflow_upload_cleanup_required',
            message: 'An Initial Assessment upload raced with unresolved cleanup overflow and could not be removed from SharePoint.',
          },
        );
      }
      throw error;
    }
    return {
      artifact: projectArtifact(ready, request),
      reused: false,
      recovered: false,
    };
  } catch (error) {
    const safe = sanitizeError(error);
    const failureRunId = error?.runId || runId || null;
    try {
      await markFailedIfOwned(generationKey, claimToken, {
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
        wmkf_lasterrorcode: safe.code,
        wmkf_lasterrormessage: safe.message,
        wmkf_lastfailedat: new Date().toISOString(),
        ...(failureRunId
          ? { 'wmkf_AIRun@odata.bind': `/wmkf_ai_runs(${failureRunId})` }
          : {}),
      }, actingUserSystemId);
    } catch (patchError) {
      console.error('[initial-assessment] failed to persist failure state:', patchError.message);
    }
    if (error instanceof ServiceHttpError) throw error;
    throw new ServiceHttpError('Initial Assessment generation did not complete.', {
      httpStatus: 500,
      body: {
        error: 'Initial Assessment generation did not complete.',
        code: safe.code,
        runId: failureRunId,
      },
    });
  }
}


export {
  buildInitialAssessmentIdentity,
  commitReadyLineage,
  listInitialAssessmentArtifactVersions,
  listInitialAssessmentArtifacts,
  listInitialAssessmentCycles,
  projectArtifact,
  resolveCanonicalInitialAssessment,
  validateGenerated,
};
