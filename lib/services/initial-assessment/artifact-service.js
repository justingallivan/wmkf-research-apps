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

import crypto from 'crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { runChangeset } from '../../dataverse/core/changeset.js';
import { executePrompt } from '../execute-prompt.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../request-document-actor-service.js';
import { getAiProposalNarrativeText } from '../workbench-proposal-documents.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets.js';
import { isGuid } from '../../utils/guid.js';
import { meetingDateToCycleCode } from '../../utils/cycle-code.js';
import {
  INITIAL_ASSESSMENT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
  isInitialAssessmentBoardSnapshot,
} from '../../../shared/config/requestDocument.js';
import { requestInstitution } from '../../../shared/utils/institution.js';
import { renderInitialAssessmentDocx } from './template.js';
import {
  GOVERNED_DOCX_HASH_PREFIX,
  hashGovernedDocxContent,
} from '../documents/governed-docx-hash.js';
import {
  CONTENT_TYPE,
  GENERATING_LEASE_MS,
  REQUEST_SELECT,
  REQUEST_LINEAGE_SELECT,
  sanitizeError,
  sanitizeFilePart,
  sameId,
  sha256,
  validateGenerated,
  parseOrphanCleanup,
  projectArtifact,
  buildInitialAssessmentIdentity,
} from './artifact-model.js';
import {
  listInitialAssessmentArtifacts,
  resolveCanonicalInitialAssessment,
  listInitialAssessmentArtifactVersions,
  listInitialAssessmentCycles,
} from './artifact-reader.js';

export { hashGovernedDocxContent };


async function getRequestOrThrow(requestId) {
  try {
    const request = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
    if (request) return request;
  } catch (error) {
    if (error?.status !== 404) throw error;
  }
  throw new ServiceHttpError(`No request found for ${requestId}.`, { httpStatus: 404 });
}

async function getActiveRequestBucket(requestId, requestNumber) {
  const buckets = await getRequestSharePointBuckets(
    requestId,
    requestNumber,
    { requireResolvedParents: true },
  );
  const active = buckets.filter((bucket) => (
    bucket.source === 'dynamics' && String(bucket.library).toLowerCase() === 'akoya_request'
  ));
  if (active.length !== 1) {
    throw new ServiceHttpError(
      `Expected exactly one active akoya_request SharePoint location; found ${active.length}.`,
      { httpStatus: 409 },
    );
  }
  return active[0];
}

async function rereadByGenerationKey(generationKey) {
  const { records } = await requestDocumentAdapter.findByGenerationKey(generationKey);
  if (records.length > 1) {
    throw new ServiceHttpError('Duplicate request-document generation keys require reconciliation.', {
      httpStatus: 500,
    });
  }
  return records[0] || null;
}

function conditionalOptions(row, actingUserSystemId = null) {
  if (!row?._etag) {
    throw new ServiceHttpError('Request-document row is missing the ETag required for a fenced write.', {
      httpStatus: 500,
    });
  }
  return {
    ifMatch: row._etag,
    ...(actingUserSystemId ? { actingUserSystemId } : {}),
  };
}

function generatingLeaseActive(row) {
  if (row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) return false;
  const modifiedAt = Date.parse(row.modifiedon || row.createdon || '');
  return Number.isFinite(modifiedAt) && Date.now() - modifiedAt < GENERATING_LEASE_MS;
}

async function assertOwnedClaim(generationKey, claimToken) {
  const current = await rereadByGenerationKey(generationKey);
  if (!current
    || current.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    || current.wmkf_claimtoken !== claimToken) {
    throw new ServiceHttpError('Initial Assessment generation claim was superseded.', {
      httpStatus: 409,
      body: { error: 'Initial Assessment generation claim was superseded.', code: 'claim_lost' },
    });
  }
  if (parseOrphanCleanup(current.wmkf_orphancleanupoverflowjson).length > 0) {
    throw new ServiceHttpError(
      'Initial Assessment generation is blocked until overflow SharePoint cleanup work is resolved.',
      {
        httpStatus: 409,
        body: {
          error: 'Initial Assessment generation is blocked until overflow SharePoint cleanup work is resolved.',
          code: 'orphan_cleanup_required',
        },
      },
    );
  }
  return current;
}

async function verifyReadyLineage(generationKey, targetId, requestId) {
  const [target, request, rows] = await Promise.all([
    rereadByGenerationKey(generationKey),
    grantRequestAdapter.getById(requestId, { select: REQUEST_LINEAGE_SELECT }),
    requestDocumentAdapter.findByRequest(requestId, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
    }),
  ]);
  const duplicateReady = (rows.records || []).some((candidate) => (
    candidate.wmkf_requestdocumentid !== targetId
    && !isInitialAssessmentBoardSnapshot(candidate)
    && candidate.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && candidate.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
  ));
  if (target
    && target.wmkf_requestdocumentid === targetId
    && target.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && target.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    && target.wmkf_sharepointdriveid
    && target.wmkf_sharepointitemid
    && request?._wmkf_currentinitialassessment_value === targetId
    && !duplicateReady) {
    return target;
  }
  return null;
}

async function commitReadyLineage(
  row,
  { metadata = null, claimToken = null, actingUserSystemId = null } = {},
) {
  for (let pass = 0; pass < 3; pass += 1) {
    const target = claimToken
      ? await assertOwnedClaim(row.wmkf_generationkey, claimToken)
      : await rereadByGenerationKey(row.wmkf_generationkey);
    if (!target || target.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED) {
      throw new ServiceHttpError('Initial Assessment Ready transition has no eligible target.', {
        httpStatus: 409,
      });
    }
    const result = await requestDocumentAdapter.findByRequest(target._wmkf_request_value, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
    });
    const request = await grantRequestAdapter.getById(target._wmkf_request_value, {
      select: REQUEST_LINEAGE_SELECT,
    });
    const requestOptions = conditionalOptions(request);
    const priorReady = (result.records || []).filter((candidate) => (
      candidate.wmkf_requestdocumentid !== target.wmkf_requestdocumentid
        && !isInitialAssessmentBoardSnapshot(candidate)
        && candidate.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
        && candidate.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    ));
    if (!metadata
      && target.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
      && priorReady.length === 0
      && request._wmkf_currentinitialassessment_value === target.wmkf_requestdocumentid) {
      return target;
    }
    const targetPatch = {
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
      wmkf_lasterrorcode: null,
      wmkf_lasterrormessage: null,
      wmkf_lastfailedat: null,
      ...(metadata ? {
        wmkf_sharepointsiteid: metadata.siteId,
        wmkf_sharepointdriveid: metadata.driveId,
        wmkf_sharepointitemid: metadata.id,
        wmkf_sharepointweburl: metadata.webUrl,
        wmkf_sharepointversionid: metadata.versionId,
        wmkf_sharepointetag: metadata.eTag,
        wmkf_filesize: metadata.size,
        wmkf_sharepointlastmodified: metadata.lastModified,
      } : {}),
    };
    const operations = [
      ...priorReady.map((prior) => ({
        method: 'PATCH',
        entitySet: requestDocumentAdapter.ENTITY_SET_NAME,
        key: prior.wmkf_requestdocumentid,
        body: { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED },
        ifMatch: conditionalOptions(prior).ifMatch,
      })),
      {
        method: 'PATCH',
        entitySet: requestDocumentAdapter.ENTITY_SET_NAME,
        key: target.wmkf_requestdocumentid,
        body: targetPatch,
        ifMatch: conditionalOptions(target).ifMatch,
      },
      {
        method: 'PATCH',
        entitySet: grantRequestAdapter.ENTITY_SET_NAME,
        key: target._wmkf_request_value,
        body: {
          'wmkf_CurrentInitialAssessment@odata.bind':
            `/wmkf_requestdocuments(${target.wmkf_requestdocumentid})`,
        },
        ifMatch: requestOptions.ifMatch,
      },
    ];
    try {
      await runChangeset(operations, {
        ...(actingUserSystemId ? { actingUserSystemId } : {}),
      });
    } catch (error) {
      const conflict = error?.status === 412 || /\b412\b/.test(error?.message || '');
      if (conflict) {
        if (claimToken) {
          const current = await rereadByGenerationKey(row.wmkf_generationkey);
          if (!current
            || current.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
            || current.wmkf_claimtoken !== claimToken) {
            throw new ServiceHttpError('Initial Assessment generation claim was superseded.', {
              httpStatus: 409,
              body: {
                error: 'Initial Assessment generation claim was superseded.',
                code: 'claim_lost',
              },
            });
          }
        }
        continue;
      }
      const afterError = await verifyReadyLineage(
        row.wmkf_generationkey,
        target.wmkf_requestdocumentid,
        target._wmkf_request_value,
      ).catch(() => null);
      if (afterError) return afterError;
      // A non-412 response can still mean the atomic changeset committed but
      // its response (and even the first verification read) was lost or lagged.
      // Delete this claimant's upload only after positively observing a newer
      // GENERATING claimant. Ready, same-claim, missing, and failed-read states
      // remain ambiguous and preserve the uploaded item for retry/reconciliation.
      if (claimToken) {
        const observed = await rereadByGenerationKey(row.wmkf_generationkey)
          .catch(() => null);
        if (observed
          && observed.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
          && observed.wmkf_claimtoken !== claimToken) {
          throw new ServiceHttpError('Initial Assessment generation claim was superseded.', {
            httpStatus: 409,
            body: {
              error: 'Initial Assessment generation claim was superseded.',
              code: 'claim_lost',
            },
          });
        }
      }
      throw error;
    }
    const ready = await verifyReadyLineage(
      row.wmkf_generationkey,
      target.wmkf_requestdocumentid,
      target._wmkf_request_value,
    );
    if (ready) return ready;
    throw new Error('Registry read-back did not confirm the current Ready SharePoint identity.');
  }
  throw new ServiceHttpError(
    'Initial Assessment Ready transition conflicted repeatedly; retry is safe.',
    {
      httpStatus: 409,
      body: {
        error: 'Initial Assessment Ready transition conflicted repeatedly.',
        code: 'ready_lineage_conflict',
      },
    },
  );
}

async function recordOrphanCleanup(
  generationKey,
  uploaded,
  cleanupError,
  actingUserSystemId = null,
  reason = 'claim_lost_delete_failed',
) {
  for (let pass = 0; pass < 3; pass += 1) {
    const current = await rereadByGenerationKey(generationKey);
    if (!current) break;
    const existing = parseOrphanCleanup(current.wmkf_orphancleanupjson);
    const overflow = parseOrphanCleanup(current.wmkf_orphancleanupoverflowjson);
    if ([...existing, ...overflow].some((item) => (
      item.driveId === uploaded.driveId
      && item.itemId === uploaded.id
      && item.reason === reason
    ))) {
      return;
    }
    const entry = {
      driveId: uploaded.driveId,
      itemId: uploaded.id,
      name: uploaded.name || null,
      recordedAt: new Date().toISOString(),
      reason,
      error: sanitizeError(cleanupError).message.slice(0, 1000),
    };
    const queue = [...existing, entry];
    const value = JSON.stringify(queue);
    const overflowed = overflow.length > 0 || value.length > 10000;
    const patch = overflowed
      ? { wmkf_orphancleanupoverflowjson: JSON.stringify([...overflow, entry]) }
      : { wmkf_orphancleanupjson: value };
    try {
      await requestDocumentAdapter.update(
        current.wmkf_requestdocumentid,
        patch,
        conditionalOptions(current, actingUserSystemId),
      );
      if (!overflowed) return;
      throw new ServiceHttpError(
        'Initial Assessment SharePoint cleanup queue is full; exact overflow work was retained and operator intervention is required.',
        {
          httpStatus: 500,
          body: {
            error: 'Initial Assessment SharePoint cleanup queue is full; exact overflow work was retained and operator intervention is required.',
            code: 'orphan_cleanup_capacity_exceeded',
          },
        },
      );
    } catch (error) {
      if (error?.status === 412) continue;
      throw error;
    }
  }
  throw new Error('Unable to persist claim-lost SharePoint cleanup work.');
}

async function cleanupSupersededUpload(
  uploaded,
  generationKey,
  actingUserSystemId = null,
  {
    reason = 'claim_lost_delete_failed',
    errorCode = 'claim_lost_cleanup_required',
    message = 'A superseded Initial Assessment upload could not be removed from SharePoint.',
  } = {},
) {
  try {
    await GraphService.deleteFile(uploaded.driveId, uploaded.id);
    return;
  } catch (error) {
    await recordOrphanCleanup(
      generationKey,
      uploaded,
      error,
      actingUserSystemId,
      reason,
    );
    throw new ServiceHttpError(
      message,
      {
        httpStatus: 500,
        body: {
          error: message,
          code: errorCode,
        },
        cause: error,
      },
    );
  }
}

async function recoverUploadedFile(row, claimToken, actingUserSystemId = null) {
  if (!row.wmkf_contenthash || !row.wmkf_sharepointfolderpath || !row.wmkf_filename) {
    return null;
  }
  const metadata = await GraphService.getFileMetadataByPath(
    'akoya_request',
    row.wmkf_sharepointfolderpath,
    row.wmkf_filename,
  );
  if (!metadata) return null;
  const downloaded = await GraphService.downloadFile(metadata.driveId, metadata.id);
  let downloadedHash;
  try {
    downloadedHash = await hashGovernedDocxContent(downloaded.buffer);
  } catch (error) {
    await recordOrphanCleanup(
      row.wmkf_generationkey,
      metadata,
      error,
      actingUserSystemId,
      'invalid_docx_retained',
    );
    return null;
  }
  const storedHash = String(row.wmkf_contenthash);
  if (!storedHash.startsWith(GOVERNED_DOCX_HASH_PREFIX)) {
    if (/^[a-f0-9]{64}$/i.test(storedHash) && sha256(downloaded.buffer) === storedHash) {
      return commitReadyLineage(row, {
        metadata,
        claimToken,
        actingUserSystemId,
      });
    }
    const legacy = /^[a-f0-9]{64}$/i.test(storedHash);
    const reason = legacy
      ? 'legacy_content_hash_unverifiable_retained'
      : 'unknown_content_hash_scheme_retained';
    const code = legacy
      ? 'legacy_content_hash_unverifiable'
      : 'unknown_content_hash_scheme';
    const message = legacy
      ? 'The prior upload uses a legacy whole-package hash that cannot verify SharePoint-normalized content.'
      : 'The prior upload uses an unknown content-hash scheme.';
    await recordOrphanCleanup(
      row.wmkf_generationkey,
      metadata,
      new Error(message),
      actingUserSystemId,
      reason,
    );
    throw new ServiceHttpError(
      `${message} Operator reconciliation is required before retrying.`,
      {
        httpStatus: 409,
        body: {
          error: `${message} Operator reconciliation is required before retrying.`,
          code,
        },
      },
    );
  }
  if (downloadedHash !== storedHash) {
    await recordOrphanCleanup(
      row.wmkf_generationkey,
      metadata,
      new Error('The prior upload content hash no longer matches the governed producer output.'),
      actingUserSystemId,
      'content_hash_mismatch_retained',
    );
    return null;
  }
  return commitReadyLineage(row, {
    metadata,
    claimToken,
    actingUserSystemId,
  });
}

/*
 * A failed or stale deterministic row can be reclaimed. Ready rows are handled
 * above by the atomic lineage activation path and never reach this function.
 */
async function claimExisting(row, actingUserSystemId = null) {
  if (generatingLeaseActive(row)) return null;
  if (parseOrphanCleanup(row.wmkf_orphancleanupoverflowjson).length > 0) {
    throw new ServiceHttpError(
      'Initial Assessment generation is blocked until overflow SharePoint cleanup work is resolved.',
      {
        httpStatus: 409,
        body: {
          error: 'Initial Assessment generation is blocked until overflow SharePoint cleanup work is resolved.',
          code: 'orphan_cleanup_required',
        },
      },
    );
  }
  const claimToken = crypto.randomUUID();
  try {
    await requestDocumentAdapter.update(row.wmkf_requestdocumentid, {
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
      wmkf_claimtoken: claimToken,
      wmkf_attemptcount: Number(row.wmkf_attemptcount || 0) + 1,
      wmkf_lasterrorcode: null,
      wmkf_lasterrormessage: null,
      wmkf_lastfailedat: null,
    }, conditionalOptions(row, actingUserSystemId));
    return claimToken;
  } catch (error) {
    if (error?.status === 412) return null;
    throw error;
  }
}

/*
 * The following function starts a fresh claim-specific filename only after
 * recovery of a prior uploaded item was ruled out.
 */
async function prepareClaimForGeneration(
  row,
  requestNumber,
  generationKey,
  claimToken,
  actingUserSystemId = null,
) {
  const current = await assertOwnedClaim(generationKey, claimToken);
  const fileName = `${sanitizeFilePart(requestNumber)} Initial Assessment `
    + `${generationKey.slice(0, 8)}-${claimToken.slice(0, 8)}.docx`;
  await requestDocumentAdapter.update(current.wmkf_requestdocumentid, {
    wmkf_filename: fileName,
    wmkf_contenthash: null,
    wmkf_sharepointsiteid: null,
    wmkf_sharepointdriveid: null,
    wmkf_sharepointitemid: null,
    wmkf_sharepointweburl: null,
    wmkf_sharepointversionid: null,
    wmkf_sharepointetag: null,
    wmkf_filesize: null,
    wmkf_sharepointlastmodified: null,
  }, conditionalOptions(current, actingUserSystemId));
  return assertOwnedClaim(generationKey, claimToken);
}

async function markFailedIfOwned(
  generationKey,
  claimToken,
  patch,
  actingUserSystemId = null,
) {
  const current = await rereadByGenerationKey(generationKey);
  if (!current
    || current.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    || current.wmkf_claimtoken !== claimToken) {
    return false;
  }
  try {
    await requestDocumentAdapter.update(
      current.wmkf_requestdocumentid,
      patch,
      conditionalOptions(current, actingUserSystemId),
    );
    return true;
  } catch (error) {
    if (error?.status === 412) return false;
    throw error;
  }
}

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
    const result = await executePrompt({
      promptName: INITIAL_ASSESSMENT_CONTRACT.promptName,
      requestId,
      requireNoPersistence: true,
      overrideVariables: { proposal_text: proposal.text },
      runSource: 'Vercel Interactive',
      actingUserSystemId,
    });
    runId = result.runId;
    if (result.blocked) throw new Error('Initial Assessment prompt was unexpectedly blocked.');
    if (result.meta?.promptVersion !== INITIAL_ASSESSMENT_CONTRACT.promptVersion) {
      throw new Error(
        `Initial Assessment prompt version ${result.meta?.promptVersion} does not match producer contract ${INITIAL_ASSESSMENT_CONTRACT.promptVersion}.`,
      );
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
