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
 * Governed writes require a positively resolved request-library parent.
 */

import crypto from 'crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { runChangeset } from '../../dataverse/core/changeset.js';
import { executePrompt } from '../execute-prompt.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { getProposalText } from '../workbench-proposal-documents.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets.js';
import { meetingDateToCycleCode } from '../../utils/cycle-code.js';
import {
  INITIAL_ASSESSMENT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_LABEL,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_LABEL,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_LABEL,
  REQUEST_DOCUMENT_OPERATION_STATUS,
  requestDocumentLabel,
} from '../../../shared/config/requestDocument.js';
import { renderInitialAssessmentDocx } from './template.js';

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
].join(',');
const REQUEST_DASHBOARD_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_programdirector_value',
  '_wmkf_currentinitialassessment_value',
].join(',');
const REQUEST_LINEAGE_SELECT = [
  'akoya_requestid',
  '_wmkf_currentinitialassessment_value',
].join(',');
const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const GENERATING_LEASE_MS = 15 * 60 * 1000;
const REQUIRED_OUTPUTS = ['summary', 'significance_impact', 'research_plan', 'team_expertise'];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sanitizeFilePart(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function sanitizeError(error) {
  const code = String(error?.code || error?.status || 'initial_assessment_failed').slice(0, 100);
  const message = String(error?.message || 'Initial Assessment generation failed')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_~.-]{40,}/g, '[redacted]')
    .slice(0, 2000);
  return { code, message };
}

function validateGenerated(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Initial Assessment prompt returned a non-object result.');
  }
  const keys = Object.keys(value);
  const unexpected = keys.filter((key) => !REQUIRED_OUTPUTS.includes(key));
  const missing = REQUIRED_OUTPUTS.filter((key) => typeof value[key] !== 'string' || !value[key].trim());
  if (unexpected.length || missing.length) {
    throw new Error(
      `Initial Assessment output contract mismatch (missing=${missing.join('|') || 'none'}, unexpected=${unexpected.join('|') || 'none'}).`,
    );
  }
  return Object.fromEntries(REQUIRED_OUTPUTS.map((key) => [key, value[key].trim()]));
}

function assertKnownRegistryRow(row) {
  const artifactLabel = requestDocumentLabel(REQUEST_DOCUMENT_ARTIFACT_LABEL, row.wmkf_artifacttype);
  const operationLabel = requestDocumentLabel(REQUEST_DOCUMENT_OPERATION_LABEL, row.wmkf_operationstatus);
  const lifecycleLabel = requestDocumentLabel(REQUEST_DOCUMENT_LIFECYCLE_LABEL, row.wmkf_lifecyclestate);
  if (!artifactLabel || !operationLabel || !lifecycleLabel) {
    throw new ServiceHttpError('Request document registry contains an unknown contract value.', {
      httpStatus: 500,
    });
  }
  return { artifactLabel, operationLabel, lifecycleLabel };
}

function projectArtifact(row, request = null) {
  const labels = assertKnownRegistryRow(row);
  const modifiedAt = Date.parse(row.modifiedon || row.createdon || '');
  const generatingRetryAt = row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    && Number.isFinite(modifiedAt)
    ? new Date(modifiedAt + GENERATING_LEASE_MS).toISOString()
    : null;
  const retryable = row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED
    || (generatingRetryAt ? Date.now() >= Date.parse(generatingRetryAt) : false);
  return {
    artifactId: row.wmkf_requestdocumentid,
    requestId: row._wmkf_request_value,
    requestNumber: request?.akoya_requestnum || null,
    title: request?.akoya_title || null,
    institution: request?.wmkf_organizationname
      || request?._akoya_applicantid_value_formatted
      || null,
    programDirector: request?._wmkf_programdirector_value_formatted || null,
    artifactType: row.wmkf_artifacttype,
    artifactLabel: labels.artifactLabel,
    operationStatus: row.wmkf_operationstatus,
    operationLabel: labels.operationLabel,
    lifecycleState: row.wmkf_lifecyclestate,
    lifecycleLabel: labels.lifecycleLabel,
    cycleCode: row.wmkf_cyclecode,
    file: row.wmkf_sharepointitemid ? {
      siteId: row.wmkf_sharepointsiteid,
      driveId: row.wmkf_sharepointdriveid,
      itemId: row.wmkf_sharepointitemid,
      webUrl: row.wmkf_sharepointweburl,
      versionId: row.wmkf_sharepointversionid,
      eTag: row.wmkf_sharepointetag,
      folderPath: row.wmkf_sharepointfolderpath,
      name: row.wmkf_filename,
      size: row.wmkf_filesize,
      lastModified: row.wmkf_sharepointlastmodified,
    } : null,
    provenance: {
      producer: row.wmkf_producer,
      inputFingerprint: row.wmkf_inputfingerprint,
      templateId: row.wmkf_templateid,
      templateVersion: row.wmkf_templateversion,
      promptName: row.wmkf_promptname,
      promptVersion: row.wmkf_promptversion,
      promptId: row._wmkf_aiprompt_value || null,
      runId: row._wmkf_airun_value || null,
      contentHash: row.wmkf_contenthash || null,
      sourceDocumentId: row._wmkf_sourcedocument_value || null,
      sourceVersionId: row.wmkf_sourceversionid || null,
      sourceContentHash: row.wmkf_sourcecontenthash || null,
      milestoneVersionId: row.wmkf_milestoneversionid || null,
      milestoneContentHash: row.wmkf_milestonecontenthash || null,
      milestoneCreatedAt: row.wmkf_milestonecreatedat || null,
    },
    attemptCount: row.wmkf_attemptcount || 0,
    retryable,
    retryAfterAt: generatingRetryAt,
    lastError: row.wmkf_lasterrormessage ? {
      code: row.wmkf_lasterrorcode || null,
      message: row.wmkf_lasterrormessage,
      at: row.wmkf_lastfailedat || null,
    } : null,
    createdAt: row.createdon || null,
    modifiedAt: row.modifiedon || null,
  };
}

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

async function recordOrphanCleanup(generationKey, uploaded, cleanupError, actingUserSystemId = null) {
  for (let pass = 0; pass < 3; pass += 1) {
    const current = await rereadByGenerationKey(generationKey);
    if (!current) break;
    let existing = [];
    try {
      const parsed = JSON.parse(current.wmkf_orphancleanupjson || '[]');
      if (Array.isArray(parsed)) existing = parsed;
    } catch {}
    const entry = {
      driveId: uploaded.driveId,
      itemId: uploaded.id,
      name: uploaded.name || null,
      recordedAt: new Date().toISOString(),
      error: sanitizeError(cleanupError).message.slice(0, 1000),
    };
    const queue = [...existing.slice(-19), entry];
    let value = JSON.stringify(queue);
    while (value.length > 10000 && queue.length > 1) {
      queue.shift();
      value = JSON.stringify(queue);
    }
    if (value.length > 10000) {
      entry.error = entry.error.slice(0, Math.max(0, 1000 - (value.length - 10000)));
      value = JSON.stringify([entry]);
    }
    if (value.length > 10000) {
      throw new Error('Claim-lost cleanup identifiers exceed the registry column bound.');
    }
    try {
      await requestDocumentAdapter.update(current.wmkf_requestdocumentid, {
        wmkf_orphancleanupjson: value,
      }, conditionalOptions(current, actingUserSystemId));
      return;
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
) {
  try {
    await GraphService.deleteFile(uploaded.driveId, uploaded.id);
    return;
  } catch (error) {
    await recordOrphanCleanup(generationKey, uploaded, error, actingUserSystemId);
    throw new ServiceHttpError(
      'A superseded Initial Assessment upload could not be removed from SharePoint.',
      {
        httpStatus: 500,
        body: {
          error: 'A superseded Initial Assessment upload could not be removed from SharePoint.',
          code: 'claim_lost_cleanup_required',
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
  if (sha256(downloaded.buffer) !== row.wmkf_contenthash) {
    throw new ServiceHttpError(
      'The retry target exists in SharePoint but its content no longer matches the governed producer output.',
      { httpStatus: 409 },
    );
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

function buildInitialAssessmentIdentity({
  requestId,
  requestNumber,
  title,
  institution,
  cycleCode,
  proposalFilename,
  proposalText,
}) {
  const inputFingerprint = sha256(JSON.stringify({
    requestId: requestId.toLowerCase(),
    requestNumber,
    title,
    institution,
    cycleCode: String(cycleCode).toUpperCase(),
    proposalFilename,
    proposalText,
  }));
  const generationKey = sha256(JSON.stringify({
    requestId: requestId.toLowerCase(),
    artifactType: INITIAL_ASSESSMENT_CONTRACT.artifactType,
    inputFingerprint,
    promptName: INITIAL_ASSESSMENT_CONTRACT.promptName,
    promptVersion: INITIAL_ASSESSMENT_CONTRACT.promptVersion,
    templateId: INITIAL_ASSESSMENT_CONTRACT.templateId,
    templateVersion: INITIAL_ASSESSMENT_CONTRACT.templateVersion,
  }));
  return { inputFingerprint, generationKey };
}

/**
 * Generate or safely reuse one governed Initial Assessment.
 */
export async function generateInitialAssessment({ requestId, actingUserSystemId = null }) {
  const request = await getRequestOrThrow(requestId);
  const requestNumber = String(request.akoya_requestnum || '').trim();
  const title = String(request.akoya_title || '').trim();
  const institution = String(
    request.wmkf_organizationname || request._akoya_applicantid_value_formatted || '',
  ).trim();
  const cycleCode = request.wmkf_meetingdate
    ? meetingDateToCycleCode(request.wmkf_meetingdate)?.toUpperCase()
    : null;
  if (!requestNumber || !title || !institution || !cycleCode) {
    throw new ServiceHttpError(
      'The request must have a request number, title, institution, and meeting-date cycle before generation.',
      { httpStatus: 409 },
    );
  }

  const proposal = await getProposalText(requestId, requestNumber, cycleCode);
  if (!proposal?.text || proposal.text.trim().length < 60) {
    throw new ServiceHttpError('No usable Project Description proposal text was found.', {
      httpStatus: 409,
    });
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
    try {
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
      }, { actingUserSystemId });
      row = await assertOwnedClaim(generationKey, claimToken);
    } catch (error) {
      if (![409, 412].includes(error?.status) && !/duplicate|alternate key/i.test(error?.message || '')) {
        throw error;
      }
      row = await rereadByGenerationKey(generationKey);
      if (!row) throw error;
      return { artifact: projectArtifact(row, request), reused: true, recovered: false };
    }
  }

  let runId = null;
  try {
    const result = await executePrompt({
      promptName: INITIAL_ASSESSMENT_CONTRACT.promptName,
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
    const contentHash = sha256(docx);

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
    try {
      await markFailedIfOwned(generationKey, claimToken, {
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
        wmkf_lasterrorcode: safe.code,
        wmkf_lasterrormessage: safe.message,
        wmkf_lastfailedat: new Date().toISOString(),
        ...(runId ? { 'wmkf_AIRun@odata.bind': `/wmkf_ai_runs(${runId})` } : {}),
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
        runId: error?.runId || runId || null,
      },
    });
  }
}

export async function listInitialAssessmentArtifacts({ requestId = null, cycleCode = null }) {
  if (!!requestId === !!cycleCode) {
    throw new ServiceHttpError('Provide exactly one of requestId or cycleCode.', { httpStatus: 400 });
  }
  const result = requestId
    ? await requestDocumentAdapter.findByRequest(requestId, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
    })
    : await requestDocumentAdapter.findByCycle(String(cycleCode).toUpperCase(), {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
    });
  const byRequest = new Map();
  for (const row of result.records || []) {
    if (row.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED) continue;
    const key = row._wmkf_request_value;
    if (!key) continue;
    if (!byRequest.has(key)) byRequest.set(key, []);
    byRequest.get(key).push(row);
  }
  const requestIds = [...byRequest.keys()];
  const requests = requestIds.length
    ? (await grantRequestAdapter.findByIds(requestIds, {
      select: REQUEST_DASHBOARD_SELECT,
      top: requestIds.length,
    })).records
    : [];
  const byId = new Map(requests.map((request) => [request.akoya_requestid, request]));
  const artifacts = [];
  const latestAttempts = [];
  for (const [ownerRequestId, rows] of byRequest.entries()) {
    rows.sort((left, right) => {
      const time = Date.parse(right.createdon || '') - Date.parse(left.createdon || '');
      if (Number.isFinite(time) && time !== 0) return time;
      return String(right.wmkf_requestdocumentid)
        .localeCompare(String(left.wmkf_requestdocumentid));
    });
    const pointerId = byId.get(ownerRequestId)?._wmkf_currentinitialassessment_value || null;
    const currentReady = rows.find((row) => (
      row.wmkf_requestdocumentid === pointerId
      && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    ));
    if (!pointerId && rows.some((row) => (
      row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    ))) {
      throw new ServiceHttpError(
        'Initial Assessment registry has a Ready row without a request-level canonical pointer.',
        { httpStatus: 500 },
      );
    }
    const latest = rows[0];
    if (currentReady || latest) artifacts.push(currentReady || latest);
    if (currentReady
      && latest.wmkf_requestdocumentid !== currentReady.wmkf_requestdocumentid
      && latest.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
      latestAttempts.push(latest);
    }
  }
  return {
    success: true,
    artifacts: artifacts.map((row) => (
      projectArtifact(row, byId.get(row._wmkf_request_value) || null)
    )),
    latestAttempts: latestAttempts.map((row) => (
      projectArtifact(row, byId.get(row._wmkf_request_value) || null)
    )),
  };
}

export async function listInitialAssessmentCycles() {
  const result = await requestDocumentAdapter.findArtifactCycles(
    REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
  );
  const cycles = [];
  const seen = new Set();
  for (const row of result.records || []) {
    if (row.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED) continue;
    const code = String(row.wmkf_cyclecode || '').toUpperCase();
    if (!/^[A-Z]\d{2}$/.test(code)) {
      throw new ServiceHttpError('Initial Assessment registry contains an invalid cycle code.', {
        httpStatus: 500,
      });
    }
    if (!seen.has(code)) {
      seen.add(code);
      cycles.push({ code, label: code });
    }
  }
  return {
    success: true,
    cycles,
    defaultCycleCode: cycles[0]?.code || null,
  };
}

export {
  buildInitialAssessmentIdentity,
  commitReadyLineage,
  projectArtifact,
  validateGenerated,
};
