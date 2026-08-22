/**
 * Guarded Pre-Site correction/reopen.
 *
 * A reopen never clears the current Review row. It verifies the exact recorded
 * handoff bytes, creates one append-only Draft successor under a client UUID,
 * copies those bytes to a new stable SharePoint item, and atomically supersedes
 * the preserved Review row while moving the request pointer. The successor's
 * reopen metadata plus standard created-by/created-on fields are the durable
 * audit event; later generated drafts carry the cycle id so they cannot collide
 * with or reactivate a preserved pre-reopen generation.
 */

import crypto from 'crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { runChangeset } from '../../dataverse/core/changeset.js';
import { GraphService } from '../graph-service.js';
import { hashGovernedDocxContent } from '../initial-assessment/artifact-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { isGuardedReopenSchemaReady } from '../../utils/guarded-reopen-readiness.js';
import { isGuid } from '../../utils/guid.js';
import {
  PRE_SITE_REOPEN_CONTRACT,
  PRE_SITE_REOPEN_REASON,
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import { projectPreSiteVisitArtifact } from './artifact-service.js';

const REOPEN_LEASE_MS = 15 * 60 * 1000;
const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  '_wmkf_currentpresitevisit_value',
  '_wmkf_currentfinalwriteup_value',
].join(',');

const COPIED_FIELDS = Object.freeze([
  'wmkf_cyclecode',
  'wmkf_inputfingerprint',
  'wmkf_renderinputfingerprint',
  'wmkf_templateid',
  'wmkf_templateversion',
  'wmkf_promptname',
  'wmkf_promptversion',
  'wmkf_contenttype',
  'wmkf_presiteexecutivesummary',
  'wmkf_presiteimpactoverview',
  'wmkf_presitemethodologyoverview',
  'wmkf_presitepersonneloverview',
  'wmkf_presitekeckfundingrationale',
  'wmkf_presitebackgroundandimpact',
  'wmkf_presitedetailedmethodology',
  'wmkf_presitepersonneldetails',
  'wmkf_presiteproposalcorejson',
  'wmkf_presiteinputsnapshotjson',
]);

const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  findByRequest: requestDocumentAdapter.findByRequest,
  findByGenerationKey: requestDocumentAdapter.findByGenerationKey,
  createDocument: requestDocumentAdapter.create,
  updateDocument: requestDocumentAdapter.update,
  commitChangeset: runChangeset,
  ensureFolderPath: (...args) => GraphService.ensureFolderPath(...args),
  getFileMetadataById: (...args) => GraphService.getFileMetadataById(...args),
  getFileMetadataByPath: (...args) => GraphService.getFileMetadataByPath(...args),
  downloadFile: (...args) => GraphService.downloadFile(...args),
  uploadFile: (...args) => GraphService.uploadFile(...args),
  hashDocx: hashGovernedDocxContent,
  newClaimToken: () => crypto.randomUUID(),
  now: () => new Date(),
  isGuardedReopenSchemaReady,
});

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function reopenError(message, code, httpStatus = 409, extra = {}) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code, ...extra },
  });
}

function sanitizeError(error) {
  return {
    code: String(error?.code || error?.status || 'pre_site_reopen_failed').slice(0, 100),
    message: String(error?.message || 'Pre-Site reopen failed')
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(/[A-Za-z0-9_~.-]{40,}/g, '[redacted]')
      .slice(0, 2000),
  };
}

function conditionalOptions(row, actingUserSystemId = null) {
  if (!row?._etag) {
    throw reopenError(
      'The guarded reopen is missing a Dataverse concurrency token.',
      'pre_site_reopen_etag_missing',
      500,
    );
  }
  return {
    ifMatch: row._etag,
    ...(actingUserSystemId ? { actingUserSystemId } : {}),
  };
}

function stableMetadataMatches(left, right) {
  return Boolean(left && right)
    && sameId(left.driveId, right.driveId)
    && sameId(left.id, right.id)
    && left.versionId === right.versionId
    && left.eTag === right.eTag
    && left.lastModified === right.lastModified
    && left.size === right.size;
}

function assertKnownRow(row) {
  if (!Object.values(REQUEST_DOCUMENT_OPERATION_STATUS).includes(row?.wmkf_operationstatus)
    || !Object.values(REQUEST_DOCUMENT_LIFECYCLE_STATE).includes(row?.wmkf_lifecyclestate)) {
    throw reopenError(
      'A request document has an unknown registry state.',
      'pre_site_reopen_state_unknown',
      500,
    );
  }
}

function assertEligibleSource(row) {
  assertKnownRow(row);
  if (!row
    || row.wmkf_artifacttype !== REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT
    || row.wmkf_contenttype !== PRE_SITE_VISIT_CONTRACT.contentType
    || row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
    || row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW) {
    throw reopenError(
      'Only the current Ready/Review Pre-Site Word document can be reopened.',
      'pre_site_reopen_source_ineligible',
    );
  }
  if (!row.wmkf_milestoneversionid
    || !row.wmkf_milestonecontenthash
    || !row.wmkf_milestonecreatedat) {
    throw reopenError(
      'The current Site Visit handoff milestone is incomplete.',
      'pre_site_reopen_milestone_incomplete',
    );
  }
  if (!row.wmkf_sharepointdriveid || !row.wmkf_sharepointitemid) {
    throw reopenError(
      'The current Site Visit workspace has no stable SharePoint identity.',
      'pre_site_reopen_source_identity_missing',
    );
  }
  if (!row.wmkf_sharepointfolderpath) {
    throw reopenError(
      'The current Site Visit workspace has no governed destination folder.',
      'pre_site_reopen_folder_missing',
    );
  }
  conditionalOptions(row);
  return row;
}

function assertSourceAuditIdentity(row) {
  if (!row
    || row.wmkf_artifacttype !== REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT
    || row.wmkf_contenttype !== PRE_SITE_VISIT_CONTRACT.contentType
    || !row.wmkf_milestoneversionid
    || !row.wmkf_milestonecontenthash
    || !row.wmkf_milestonecreatedat) {
    throw reopenError(
      'The expected artifact has no complete Pre-Site handoff identity.',
      'pre_site_reopen_milestone_incomplete',
    );
  }
  return row;
}

function requestRows(requestId, result) {
  return (result?.records || []).filter((row) => sameId(row?._wmkf_request_value, requestId));
}

async function readState(requestId, dependencies) {
  const [request, result] = await Promise.all([
    dependencies.getRequest(requestId),
    dependencies.findByRequest(requestId),
  ]);
  if (!request || !sameId(request.akoya_requestid, requestId)) {
    throw reopenError('The Pre-Site request could not be resolved.', 'pre_site_reopen_request_not_found', 404);
  }
  return { request, rows: requestRows(requestId, result) };
}

function sourceForExpected(state, expectedArtifactId) {
  const pointerId = state.request._wmkf_currentpresitevisit_value;
  if (!pointerId || !sameId(pointerId, expectedArtifactId)) {
    throw reopenError(
      'A newer Pre-Site document is current. Reload before reopening.',
      'pre_site_reopen_stale_artifact',
    );
  }
  const source = state.rows.find((row) => sameId(row.wmkf_requestdocumentid, pointerId));
  if (!source || !sameId(source._wmkf_request_value, state.request.akoya_requestid)) {
    throw reopenError(
      'The current Pre-Site request pointer requires reconciliation.',
      'pre_site_reopen_pointer_invalid',
    );
  }
  return assertEligibleSource(source);
}

function assertNoDownstream(state, source, excludedArtifactId = null) {
  if (state.request._wmkf_currentfinalwriteup_value) {
    throw reopenError(
      'A Final Writeup already derives from this lifecycle. Reconciliation is required.',
      'pre_site_reopen_final_exists',
    );
  }
  const derived = state.rows.find((row) => (
    !sameId(row.wmkf_requestdocumentid, excludedArtifactId)
    && sameId(row._wmkf_sourcedocument_value, source.wmkf_requestdocumentid)
    && row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.FAILED
  ));
  if (derived) {
    throw reopenError(
      'A downstream artifact already derives from this handoff. Reconciliation is required.',
      'pre_site_reopen_downstream_exists',
      409,
      { derivedArtifactId: derived.wmkf_requestdocumentid },
    );
  }
}

function assertNoCompetingGeneration(state, excludedArtifactId = null) {
  const pending = state.rows.find((row) => (
    !sameId(row.wmkf_requestdocumentid, excludedArtifactId)
    && row.wmkf_artifacttype === REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT
    && row.wmkf_contenttype === PRE_SITE_VISIT_CONTRACT.contentType
    && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
  ));
  if (pending) {
    throw reopenError(
      'A Pre-Site generation is already in progress. Wait for it to finish before reopening.',
      'pre_site_reopen_generation_in_progress',
      409,
      { pendingArtifactId: pending.wmkf_requestdocumentid },
    );
  }
}

export function buildReopenGenerationKey({ requestId, source, clientOperationId }) {
  return sha256(JSON.stringify({
    contract: `pre-site-reopen-v${PRE_SITE_REOPEN_CONTRACT.version}`,
    requestId: String(requestId).toLowerCase(),
    sourceArtifactId: String(source.wmkf_requestdocumentid).toLowerCase(),
    sourceVersionId: source.wmkf_milestoneversionid,
    sourceContentHash: source.wmkf_milestonecontenthash,
    clientOperationId: String(clientOperationId).toLowerCase(),
  }));
}

function reopenFilename(requestNumber, generationKey) {
  const safeRequestNumber = String(requestNumber).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80);
  return `${safeRequestNumber} Pre-Site Reopened ${generationKey.slice(0, 12)}.docx`;
}

function validateInput(input) {
  const requestId = String(input?.requestId || '').trim();
  const expectedArtifactId = String(input?.expectedArtifactId || '').trim();
  const clientOperationId = String(input?.clientOperationId || '').trim();
  const requestNumber = String(input?.requestNumber || '').trim();
  const reasonCode = String(input?.reasonCode || '').trim();
  const reasonNote = String(input?.reasonNote || '').trim();
  if (!isGuid(requestId) || !isGuid(expectedArtifactId) || !isGuid(clientOperationId)) {
    throw reopenError(
      'Valid request, artifact, and client operation IDs are required.',
      'pre_site_reopen_invalid_identity',
      400,
    );
  }
  if (!requestNumber || requestNumber.length > 80) {
    throw reopenError('A typed request number is required.', 'pre_site_reopen_request_number_invalid', 400);
  }
  if (!Object.values(PRE_SITE_REOPEN_REASON).includes(reasonCode)) {
    throw reopenError('Select a valid reopen reason.', 'pre_site_reopen_reason_invalid', 400);
  }
  if (reasonNote.length < PRE_SITE_REOPEN_CONTRACT.minimumReasonNoteLength
    || reasonNote.length > PRE_SITE_REOPEN_CONTRACT.maximumReasonNoteLength) {
    throw reopenError(
      `The reopen note must be ${PRE_SITE_REOPEN_CONTRACT.minimumReasonNoteLength}`
        + `-${PRE_SITE_REOPEN_CONTRACT.maximumReasonNoteLength} characters.`,
      'pre_site_reopen_note_invalid',
      400,
    );
  }
  return { requestId, expectedArtifactId, clientOperationId, requestNumber, reasonCode, reasonNote };
}

function findAuditRow(rows, clientOperationId) {
  const matches = rows.filter((row) => (
    sameId(row.wmkf_reopencycleid, clientOperationId)
    && Boolean(row.wmkf_reopenreasoncode)
  ));
  if (matches.length > 1) {
    throw reopenError(
      'Duplicate reopen audit rows require reconciliation.',
      'pre_site_reopen_duplicate_audit',
      500,
    );
  }
  return matches[0] || null;
}

function assertAuditMatches(row, input, generationKey) {
  if (!sameId(row.wmkf_reopencycleid, input.clientOperationId)
    || !sameId(row._wmkf_sourcedocument_value, input.expectedArtifactId)
    || row.wmkf_reopenreasoncode !== input.reasonCode
    || row.wmkf_reopenreasonnote !== input.reasonNote
    || row.wmkf_generationkey !== generationKey) {
    throw reopenError(
      'The client operation ID is already bound to different reopen inputs.',
      'pre_site_reopen_operation_mismatch',
    );
  }
  assertKnownRow(row);
  return row;
}

async function verifySourceBytes(source, dependencies) {
  const before = await dependencies.getFileMetadataById(
    source.wmkf_sharepointdriveid,
    source.wmkf_sharepointitemid,
    { siteId: source.wmkf_sharepointsiteid || null },
  );
  if (!before) {
    throw reopenError('The preserved Site Visit Word file is missing.', 'pre_site_reopen_source_missing');
  }
  if (!sameId(before.driveId, source.wmkf_sharepointdriveid)
    || !sameId(before.id, source.wmkf_sharepointitemid)
    || before.versionId !== source.wmkf_milestoneversionid) {
    throw reopenError(
      'The Site Visit Word file changed after handoff and cannot be reopened automatically.',
      'pre_site_reopen_source_changed',
    );
  }
  const downloaded = await dependencies.downloadFile(before.driveId, before.id);
  const contentHash = await Promise.resolve(dependencies.hashDocx(downloaded.buffer)).catch(() => null);
  const after = await dependencies.getFileMetadataById(
    source.wmkf_sharepointdriveid,
    source.wmkf_sharepointitemid,
    { siteId: source.wmkf_sharepointsiteid || null },
  );
  if (!stableMetadataMatches(before, after)
    || contentHash !== source.wmkf_milestonecontenthash) {
    throw reopenError(
      'The Site Visit Word file changed after handoff and cannot be reopened automatically.',
      'pre_site_reopen_source_changed',
    );
  }
  return { buffer: downloaded.buffer, metadata: after, contentHash };
}

async function rereadByGenerationKey(generationKey, dependencies) {
  const result = await dependencies.findByGenerationKey(generationKey);
  const rows = result?.records || [];
  if (rows.length > 1) {
    throw reopenError(
      'Duplicate guarded-reopen generation keys require reconciliation.',
      'pre_site_reopen_duplicate_key',
      500,
    );
  }
  return rows[0] || null;
}

function leaseActive(row, dependencies) {
  if (row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) return false;
  const modifiedAt = Date.parse(row.modifiedon || row.createdon || '');
  return Number.isFinite(modifiedAt)
    && dependencies.now().getTime() - modifiedAt < REOPEN_LEASE_MS;
}

async function claimExisting(row, actingUserSystemId, dependencies) {
  assertKnownRow(row);
  if (![REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING, REQUEST_DOCUMENT_OPERATION_STATUS.FAILED]
    .includes(row.wmkf_operationstatus)) {
    throw reopenError(
      'The guarded-reopen audit row is not safely claimable.',
      'pre_site_reopen_audit_inconsistent',
      500,
    );
  }
  if (leaseActive(row, dependencies)) return null;
  const claimToken = dependencies.newClaimToken();
  try {
    await dependencies.updateDocument(row.wmkf_requestdocumentid, {
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

async function assertOwned(generationKey, claimToken, dependencies) {
  const row = await rereadByGenerationKey(generationKey, dependencies);
  if (!row
    || row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    || row.wmkf_claimtoken !== claimToken) {
    throw reopenError('The guarded-reopen claim was superseded.', 'pre_site_reopen_claim_lost');
  }
  return row;
}

function successorPayload(input, source, generationKey, claimToken) {
  const payload = {
    wmkf_name: `${input.requestNumber} Pre-Site Reopen`,
    'wmkf_Request@odata.bind': `/akoya_requests(${input.requestId})`,
    'wmkf_SourceDocument@odata.bind': `/wmkf_requestdocuments(${source.wmkf_requestdocumentid})`,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_generationkey: generationKey,
    wmkf_claimtoken: claimToken,
    wmkf_producer: PRE_SITE_REOPEN_CONTRACT.producer,
    wmkf_sourceversionid: source.wmkf_milestoneversionid,
    wmkf_sourcecontenthash: source.wmkf_milestonecontenthash,
    wmkf_contenthash: source.wmkf_milestonecontenthash,
    wmkf_sharepointfolderpath: source.wmkf_sharepointfolderpath,
    wmkf_filename: reopenFilename(input.requestNumber, generationKey),
    wmkf_reopencycleid: input.clientOperationId,
    wmkf_reopenreasoncode: input.reasonCode,
    wmkf_reopenreasonnote: input.reasonNote,
    wmkf_attemptcount: 1,
  };
  for (const field of COPIED_FIELDS) payload[field] = source[field] ?? null;
  if (source._wmkf_aiprompt_value) {
    payload['wmkf_AIPrompt@odata.bind'] = `/wmkf_ai_prompts(${source._wmkf_aiprompt_value})`;
  }
  if (source._wmkf_airun_value) {
    payload['wmkf_AIRun@odata.bind'] = `/wmkf_ai_runs(${source._wmkf_airun_value})`;
  }
  return payload;
}

async function verifyTargetCopy(metadata, row, expectedHash, source, dependencies) {
  if (!metadata?.driveId || !metadata?.id || !metadata?.versionId
    || sameId(metadata.id, source.wmkf_sharepointitemid)) {
    throw reopenError(
      'The reopened SharePoint copy returned incomplete or unsafe identity.',
      'pre_site_reopen_copy_identity_invalid',
      502,
    );
  }
  const before = await dependencies.getFileMetadataById(metadata.driveId, metadata.id, {
    siteId: metadata.siteId || null,
  });
  const downloaded = before
    ? await dependencies.downloadFile(before.driveId, before.id)
    : null;
  const contentHash = downloaded
    ? await Promise.resolve(dependencies.hashDocx(downloaded.buffer)).catch(() => null)
    : null;
  const after = before
    ? await dependencies.getFileMetadataById(before.driveId, before.id, {
      siteId: before.siteId || metadata.siteId || null,
    })
    : null;
  if (!before
    || !stableMetadataMatches(before, after)
    || contentHash !== expectedHash
    || after.name !== row.wmkf_filename) {
    throw reopenError(
      'The reopened SharePoint copy could not be verified exactly.',
      'pre_site_reopen_copy_verification_failed',
      502,
    );
  }
  return after;
}

async function recoverOrUpload(row, sourceBytes, source, claimToken, actingUserSystemId, dependencies) {
  let current = await assertOwned(row.wmkf_generationkey, claimToken, dependencies);
  let metadata = null;
  if (current.wmkf_sharepointdriveid && current.wmkf_sharepointitemid) {
    metadata = await dependencies.getFileMetadataById(
      current.wmkf_sharepointdriveid,
      current.wmkf_sharepointitemid,
      { siteId: current.wmkf_sharepointsiteid || null },
    );
  } else {
    metadata = await dependencies.getFileMetadataByPath(
      'akoya_request',
      current.wmkf_sharepointfolderpath,
      current.wmkf_filename,
    );
  }
  let recovered = Boolean(metadata);
  if (!metadata) {
    await dependencies.ensureFolderPath('akoya_request', current.wmkf_sharepointfolderpath);
    current = await assertOwned(row.wmkf_generationkey, claimToken, dependencies);
    metadata = await dependencies.uploadFile(
      'akoya_request',
      current.wmkf_sharepointfolderpath,
      current.wmkf_filename,
      sourceBytes.buffer,
      PRE_SITE_VISIT_CONTRACT.contentType,
    );
    recovered = false;
  }
  const verified = await verifyTargetCopy(
    metadata,
    current,
    source.wmkf_milestonecontenthash,
    source,
    dependencies,
  );
  current = await assertOwned(row.wmkf_generationkey, claimToken, dependencies);
  const patch = {
    wmkf_sharepointsiteid: verified.siteId || metadata.siteId || null,
    wmkf_sharepointdriveid: verified.driveId,
    wmkf_sharepointitemid: verified.id,
    wmkf_sharepointweburl: verified.webUrl,
    wmkf_sharepointversionid: verified.versionId,
    wmkf_sharepointetag: verified.eTag,
    wmkf_filename: verified.name,
    wmkf_filesize: verified.size,
    wmkf_sharepointlastmodified: verified.lastModified,
    wmkf_contenthash: source.wmkf_milestonecontenthash,
  };
  try {
    await dependencies.updateDocument(
      current.wmkf_requestdocumentid,
      patch,
      conditionalOptions(current, actingUserSystemId),
    );
  } catch (error) {
    const observed = await rereadByGenerationKey(row.wmkf_generationkey, dependencies).catch(() => null);
    if (!observed
      || observed.wmkf_claimtoken !== claimToken
      || !sameId(observed.wmkf_sharepointitemid, verified.id)
      || observed.wmkf_contenthash !== source.wmkf_milestonecontenthash) throw error;
  }
  return {
    row: await assertOwned(row.wmkf_generationkey, claimToken, dependencies),
    recovered,
    verifiedTarget: verified,
  };
}

function persistedTargetMatches(row, metadata) {
  return sameId(row.wmkf_sharepointdriveid, metadata?.driveId)
    && sameId(row.wmkf_sharepointitemid, metadata?.id)
    && row.wmkf_sharepointversionid === metadata?.versionId
    && row.wmkf_sharepointetag === metadata?.eTag
    && row.wmkf_sharepointlastmodified === metadata?.lastModified
    && Number(row.wmkf_filesize) === Number(metadata?.size)
    && row.wmkf_filename === metadata?.name;
}

function committedResult(state, sourceId, successorId) {
  const source = state.rows.find((row) => sameId(row.wmkf_requestdocumentid, sourceId));
  const successor = state.rows.find((row) => sameId(row.wmkf_requestdocumentid, successorId));
  if (!source || !successor) return null;
  if (!sameId(state.request._wmkf_currentpresitevisit_value, successorId)
    || source.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    || successor.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
    || successor.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT
    || !sameId(successor._wmkf_sourcedocument_value, sourceId)
    || !successor.wmkf_sharepointdriveid
    || !successor.wmkf_sharepointitemid) return null;
  return successor;
}

async function activateSuccessor(
  input,
  successor,
  verifiedSource,
  verifiedTarget,
  actingUserSystemId,
  dependencies,
) {
  const state = await readState(input.requestId, dependencies);
  const currentSource = sourceForExpected(state, input.expectedArtifactId);
  assertNoDownstream(state, currentSource, successor.wmkf_requestdocumentid);
  const currentSuccessor = state.rows.find((row) => sameId(
    row.wmkf_requestdocumentid,
    successor.wmkf_requestdocumentid,
  ));
  if (!currentSuccessor
    || currentSuccessor.wmkf_claimtoken !== successor.wmkf_claimtoken
    || currentSuccessor.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) {
    throw reopenError('The guarded-reopen claim was superseded.', 'pre_site_reopen_claim_lost');
  }
  const sourceNow = await dependencies.getFileMetadataById(
    currentSource.wmkf_sharepointdriveid,
    currentSource.wmkf_sharepointitemid,
    { siteId: currentSource.wmkf_sharepointsiteid || null },
  );
  if (!stableMetadataMatches(verifiedSource.metadata, sourceNow)) {
    throw reopenError(
      'The Site Visit Word file changed while the successor was being prepared.',
      'pre_site_reopen_source_changed',
    );
  }
  if (!persistedTargetMatches(currentSuccessor, verifiedTarget)) {
    throw reopenError(
      'The reopened SharePoint copy identity changed before activation.',
      'pre_site_reopen_copy_changed',
    );
  }
  const targetNow = await dependencies.getFileMetadataById(
    currentSuccessor.wmkf_sharepointdriveid,
    currentSuccessor.wmkf_sharepointitemid,
    { siteId: currentSuccessor.wmkf_sharepointsiteid || null },
  );
  if (!stableMetadataMatches(verifiedTarget, targetNow)
    || !persistedTargetMatches(currentSuccessor, targetNow)) {
    throw reopenError(
      'The reopened SharePoint copy changed before activation.',
      'pre_site_reopen_copy_changed',
    );
  }
  const operations = [
    {
      method: 'PATCH',
      entitySet: requestDocumentAdapter.ENTITY_SET_NAME,
      key: currentSource.wmkf_requestdocumentid,
      body: { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED },
      ifMatch: conditionalOptions(currentSource).ifMatch,
    },
    {
      method: 'PATCH',
      entitySet: requestDocumentAdapter.ENTITY_SET_NAME,
      key: currentSuccessor.wmkf_requestdocumentid,
      body: {
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
        wmkf_claimtoken: null,
        wmkf_lasterrorcode: null,
        wmkf_lasterrormessage: null,
        wmkf_lastfailedat: null,
      },
      ifMatch: conditionalOptions(currentSuccessor).ifMatch,
    },
    {
      method: 'PATCH',
      entitySet: grantRequestAdapter.ENTITY_SET_NAME,
      key: state.request.akoya_requestid,
      body: {
        'wmkf_CurrentPreSiteVisit@odata.bind':
          `/wmkf_requestdocuments(${currentSuccessor.wmkf_requestdocumentid})`,
      },
      ifMatch: conditionalOptions(state.request).ifMatch,
    },
  ];
  try {
    await dependencies.commitChangeset(operations, {
      ...(actingUserSystemId ? { actingUserSystemId } : {}),
    });
  } catch (error) {
    const observed = await readState(input.requestId, dependencies).catch(() => null);
    const committed = observed && committedResult(
      observed,
      currentSource.wmkf_requestdocumentid,
      currentSuccessor.wmkf_requestdocumentid,
    );
    if (committed) return { row: committed, reused: true };
    if (error?.status === 412 || /\b412\b/.test(error?.message || '')) {
      throw reopenError(
        'The writeup lifecycle changed while reopening. Reload and retry.',
        'pre_site_reopen_transition_conflict',
      );
    }
    throw error;
  }
  const observed = await readState(input.requestId, dependencies);
  const committed = committedResult(
    observed,
    currentSource.wmkf_requestdocumentid,
    currentSuccessor.wmkf_requestdocumentid,
  );
  if (!committed) {
    throw reopenError(
      'The guarded reopen could not be confirmed from Dataverse.',
      'pre_site_reopen_unconfirmed',
      500,
    );
  }
  return { row: committed, reused: false };
}

async function markFailedIfOwned(generationKey, claimToken, error, actingUserSystemId, dependencies) {
  if (!claimToken) return;
  const row = await rereadByGenerationKey(generationKey, dependencies).catch(() => null);
  if (!row
    || row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    || row.wmkf_claimtoken !== claimToken) return;
  const safe = sanitizeError(error);
  await dependencies.updateDocument(row.wmkf_requestdocumentid, {
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    wmkf_lasterrorcode: safe.code,
    wmkf_lasterrormessage: safe.message,
    wmkf_lastfailedat: dependencies.now().toISOString(),
  }, conditionalOptions(row, actingUserSystemId)).catch(() => {});
}

/** Preserve one Review handoff and create/reuse its exact Ready/Draft successor. */
export async function reopenPreSiteVisit(
  inputValue,
  { actingUserSystemId = null } = {},
  dependencies = DEFAULT_DEPENDENCIES,
) {
  const input = validateInput(inputValue);
  if (!dependencies.isGuardedReopenSchemaReady?.()) {
    throw reopenError(
      'Guarded reopen is unavailable until its Dataverse schema is verified.',
      'pre_site_reopen_schema_not_ready',
      503,
    );
  }
  let state = await readState(input.requestId, dependencies);
  if (String(state.request.akoya_requestnum || '').trim() !== input.requestNumber) {
    throw reopenError(
      'The typed request number does not match the current request.',
      'pre_site_reopen_request_number_mismatch',
      400,
    );
  }

  let source = state.rows.find((row) => sameId(row.wmkf_requestdocumentid, input.expectedArtifactId));
  if (!source) {
    throw reopenError('The expected handoff artifact was not found.', 'pre_site_reopen_source_missing', 404);
  }
  assertSourceAuditIdentity(source);
  const generationKey = buildReopenGenerationKey({
    requestId: input.requestId,
    source,
    clientOperationId: input.clientOperationId,
  });
  let row = findAuditRow(state.rows, input.clientOperationId);
  if (row) {
    assertAuditMatches(row, input, generationKey);
    const committed = committedResult(
      state,
      input.expectedArtifactId,
      row.wmkf_requestdocumentid,
    );
    if (committed) {
      return { artifact: projectPreSiteVisitArtifact(committed), reused: true, recovered: false };
    }
  }

  source = sourceForExpected(state, input.expectedArtifactId);
  assertNoCompetingGeneration(state, row?.wmkf_requestdocumentid || null);
  assertNoDownstream(state, source, row?.wmkf_requestdocumentid || null);
  const verifiedSource = await verifySourceBytes(source, dependencies);
  let claimToken = null;
  try {
    if (row) {
      claimToken = await claimExisting(row, actingUserSystemId, dependencies);
      if (!claimToken) {
        const current = await rereadByGenerationKey(generationKey, dependencies);
        return {
          artifact: projectPreSiteVisitArtifact(current || row),
          reused: true,
          recovered: false,
          inProgress: true,
        };
      }
      row = await assertOwned(generationKey, claimToken, dependencies);
    } else {
      claimToken = dependencies.newClaimToken();
      try {
        await dependencies.createDocument(
          successorPayload(input, source, generationKey, claimToken),
          { ...(actingUserSystemId ? { actingUserSystemId } : {}) },
        );
      } catch (error) {
        if (![409, 412].includes(error?.status)
          && !/duplicate|alternate key/i.test(error?.message || '')) throw error;
      }
      row = await rereadByGenerationKey(generationKey, dependencies);
      if (!row) throw reopenError('The guarded-reopen claim could not be read back.', 'pre_site_reopen_claim_missing', 500);
      assertAuditMatches(row, input, generationKey);
      if (row.wmkf_claimtoken !== claimToken) {
        const observedState = await readState(input.requestId, dependencies);
        const committed = committedResult(
          observedState,
          input.expectedArtifactId,
          row.wmkf_requestdocumentid,
        );
        if (committed) {
          return {
            artifact: projectPreSiteVisitArtifact(committed),
            reused: true,
            recovered: false,
            inProgress: false,
          };
        }
        claimToken = await claimExisting(row, actingUserSystemId, dependencies);
        if (!claimToken) {
          const current = await rereadByGenerationKey(generationKey, dependencies);
          return {
            artifact: projectPreSiteVisitArtifact(current || row),
            reused: true,
            recovered: false,
            inProgress: true,
          };
        }
        row = await assertOwned(generationKey, claimToken, dependencies);
      }
    }

    const copy = await recoverOrUpload(
      row,
      verifiedSource,
      source,
      claimToken,
      actingUserSystemId,
      dependencies,
    );
    row = copy.row;
    const activated = await activateSuccessor(
      input,
      row,
      verifiedSource,
      copy.verifiedTarget,
      actingUserSystemId,
      dependencies,
    );
    return {
      artifact: projectPreSiteVisitArtifact(activated.row),
      reused: activated.reused,
      recovered: copy.recovered,
      inProgress: false,
    };
  } catch (error) {
    await markFailedIfOwned(generationKey, claimToken, error, actingUserSystemId, dependencies);
    if (error instanceof ServiceHttpError) throw error;
    const safe = sanitizeError(error);
    throw new ServiceHttpError('The Pre-Site draft could not be reopened.', {
      httpStatus: 500,
      code: safe.code,
      body: { error: 'The Pre-Site draft could not be reopened.', code: safe.code },
    });
  }
}

export { reopenFilename, validateInput };
