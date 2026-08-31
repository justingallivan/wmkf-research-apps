/**
 * Governed Site Visit -> Final Writeup transition.
 *
 * The SharePoint Word item is never copied or uploaded. One deterministic Final
 * registry row records the exact current source version/hash and the same stable
 * drive/item identity. Activation atomically finalizes the source lifecycle,
 * readies the Final row, records the explicit actor/time, and sets the request's
 * Current Final Writeup pointer while retaining Current Pre-Site Visit.
 */

import crypto from 'crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { runChangeset } from '../../dataverse/core/changeset.js';
import { isFinalWriteupSchemaReady } from '../../utils/final-writeup-readiness.js';
import { isGuid } from '../../utils/guid.js';
import { GraphService } from '../graph-service.js';
import { hashGovernedDocxContent } from '../initial-assessment/artifact-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import {
  FINAL_WRITEUP_CONTRACT,
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';

const CLAIM_LEASE_MS = 15 * 60 * 1000;
const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  '_wmkf_programdirector_value',
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
  getFileMetadataById: (...args) => GraphService.getFileMetadataById(...args),
  downloadFile: (...args) => GraphService.downloadFile(...args),
  hashDocx: hashGovernedDocxContent,
  newClaimToken: () => crypto.randomUUID(),
  now: () => new Date(),
  schemaReady: isFinalWriteupSchemaReady,
});

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function finalError(message, code, httpStatus = 409, extra = {}) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code, ...extra },
  });
}

function sanitizeError(error) {
  return {
    code: String(error?.code || error?.status || 'final_writeup_transition_failed').slice(0, 100),
    message: String(error?.message || 'Final Writeup transition failed')
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(/[A-Za-z0-9_~.-]{40,}/g, '[redacted]')
      .slice(0, 2000),
  };
}

function conditionalOptions(row, actingUserSystemId = null) {
  if (!row?._etag) {
    throw finalError(
      'The Final Writeup transition is missing a Dataverse concurrency token.',
      'final_writeup_etag_missing',
      500,
    );
  }
  return {
    ifMatch: row._etag,
    ...(actingUserSystemId ? { actingUserSystemId } : {}),
  };
}

function assertKnownRow(row) {
  if (!Object.values(REQUEST_DOCUMENT_OPERATION_STATUS).includes(row?.wmkf_operationstatus)
    || !Object.values(REQUEST_DOCUMENT_LIFECYCLE_STATE).includes(row?.wmkf_lifecyclestate)) {
    throw finalError(
      'A request document has an unknown registry state.',
      'final_writeup_state_unknown',
      500,
    );
  }
  return row;
}

function stableMetadataMatches(left, right) {
  return Boolean(left && right)
    && sameId(left.driveId, right.driveId)
    && sameId(left.id, right.id)
    && left.versionId === right.versionId
    && left.eTag === right.eTag
    && left.lastModified === right.lastModified
    && Number(left.size) === Number(right.size);
}

function persistedIdentityMatches(row, metadata) {
  return sameId(row?.wmkf_sharepointdriveid, metadata?.driveId)
    && sameId(row?.wmkf_sharepointitemid, metadata?.id)
    && row?.wmkf_sharepointversionid === metadata?.versionId
    && row?.wmkf_sharepointetag === metadata?.eTag
    && row?.wmkf_sharepointlastmodified === metadata?.lastModified
    && Number(row?.wmkf_filesize) === Number(metadata?.size);
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
    throw finalError('The request could not be resolved.', 'final_writeup_request_not_found', 404);
  }
  return { request, rows: requestRows(requestId, result) };
}

function resolveSource(state, expectedArtifactId = null) {
  const sourceId = state.request._wmkf_currentpresitevisit_value;
  if (!sourceId) {
    throw finalError(
      'A Site Visit Word document is required before Final Writeup can start.',
      'final_writeup_source_missing',
    );
  }
  if (expectedArtifactId && !sameId(sourceId, expectedArtifactId)) {
    throw finalError(
      'A newer Site Visit document is current. Reload Final Writeup before continuing.',
      'final_writeup_stale_source',
    );
  }
  const source = state.rows.find((row) => sameId(row.wmkf_requestdocumentid, sourceId));
  if (!source || source.wmkf_artifacttype !== REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT) {
    throw finalError(
      'The current Site Visit document pointer requires reconciliation.',
      'final_writeup_source_pointer_invalid',
    );
  }
  assertKnownRow(source);
  return source;
}

function assertEligibleSource(source) {
  if (source.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
    || source.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
    || source.wmkf_contenttype !== PRE_SITE_VISIT_CONTRACT.contentType) {
    throw finalError(
      'Only the current shared Site Visit Word document can move to Final Writeup.',
      'final_writeup_source_ineligible',
    );
  }
  if (!source.wmkf_sharepointdriveid || !source.wmkf_sharepointitemid) {
    throw finalError(
      'The Site Visit document has no stable SharePoint identity.',
      'final_writeup_source_identity_missing',
    );
  }
  conditionalOptions(source);
  return source;
}

function resolveAuthorization(state, { isSuperuser, actingUserSystemId }) {
  const leadPdId = state.request._wmkf_programdirector_value || null;
  const isLeadPd = Boolean(leadPdId && actingUserSystemId && sameId(leadPdId, actingUserSystemId));
  return { isSuperuser, isLeadPd, canStart: Boolean(actingUserSystemId && (isSuperuser || isLeadPd)) };
}

function projectArtifact(row) {
  if (!row) return null;
  return {
    artifactId: row.wmkf_requestdocumentid,
    sourceArtifactId: row._wmkf_sourcedocument_value || null,
    artifactType: row.wmkf_artifacttype,
    operationStatus: row.wmkf_operationstatus,
    lifecycleState: row.wmkf_lifecyclestate,
    file: row.wmkf_sharepointweburl ? {
      siteId: row.wmkf_sharepointsiteid || null,
      driveId: row.wmkf_sharepointdriveid || null,
      itemId: row.wmkf_sharepointitemid || null,
      webUrl: row.wmkf_sharepointweburl,
      versionId: row.wmkf_sharepointversionid || null,
      name: row.wmkf_filename || null,
      size: row.wmkf_filesize ?? null,
      lastModified: row.wmkf_sharepointlastmodified || null,
    } : null,
    groupReview: {
      startedAt: row.wmkf_groupreviewstartedat || null,
      startedById: row._wmkf_groupreviewstartedby_value || null,
    },
    lastError: row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED ? {
      code: row.wmkf_lasterrorcode || null,
      message: row.wmkf_lasterrormessage || null,
      failedAt: row.wmkf_lastfailedat || null,
    } : null,
  };
}

function findCurrentFinal(state) {
  const finalId = state.request._wmkf_currentfinalwriteup_value;
  if (!finalId) return null;
  const row = state.rows.find((candidate) => sameId(candidate.wmkf_requestdocumentid, finalId));
  if (!row || row.wmkf_artifacttype !== REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP) {
    throw finalError(
      'The current Final Writeup pointer requires reconciliation.',
      'final_writeup_pointer_invalid',
      500,
    );
  }
  return assertKnownRow(row);
}

function committedFinal(state, sourceId, finalId) {
  const source = state.rows.find((row) => sameId(row.wmkf_requestdocumentid, sourceId));
  const final = state.rows.find((row) => sameId(row.wmkf_requestdocumentid, finalId));
  if (!source || !final) return null;
  if (!sameId(state.request._wmkf_currentpresitevisit_value, sourceId)
    || !sameId(state.request._wmkf_currentfinalwriteup_value, finalId)
    || source.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL
    || final.wmkf_artifacttype !== REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP
    || final.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
    || final.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
    || !sameId(final._wmkf_sourcedocument_value, sourceId)
    || !sameId(final.wmkf_sharepointdriveid, source.wmkf_sharepointdriveid)
    || !sameId(final.wmkf_sharepointitemid, source.wmkf_sharepointitemid)
    || !final.wmkf_sharepointweburl
    || !final.wmkf_sourceversionid
    || !final.wmkf_sourcecontenthash
    || !final.wmkf_groupreviewstartedat
    || !final._wmkf_groupreviewstartedby_value) return null;
  return final;
}

function pendingFinalForSource(state, sourceId) {
  const matches = state.rows.filter((row) => (
    row.wmkf_artifacttype === REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP
    && sameId(row._wmkf_sourcedocument_value, sourceId)
    && row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
  ));
  const generating = matches.filter((row) => (
    row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
  ));
  if (generating.length > 1) {
    throw finalError(
      'Multiple active Final Writeup rows require reconciliation.',
      'final_writeup_duplicate_pending',
      500,
    );
  }
  return generating[0]
    || matches.find((row) => row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED)
    || null;
}

export async function getFinalWriteupStatus(
  { requestId, isSuperuser = false, actingUserSystemId = null },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!dependencies.schemaReady?.()) {
    return { available: false, phase: 'unavailable', canStart: false, artifact: null };
  }
  const state = await readState(requestId, dependencies);
  const current = findCurrentFinal(state);
  if (current) {
    const sourceId = current._wmkf_sourcedocument_value;
    const committed = committedFinal(state, sourceId, current.wmkf_requestdocumentid);
    if (!committed) {
      throw finalError(
        'The Final Writeup transition requires reconciliation.',
        'final_writeup_committed_state_invalid',
        500,
      );
    }
    return {
      available: true,
      phase: 'group-review',
      canStart: false,
      sourceArtifactId: sourceId,
      artifact: projectArtifact(committed),
      pendingArtifact: null,
    };
  }
  const source = resolveSource(state);
  if (source.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL) {
    throw finalError(
      'The Site Visit document is Final but no current Final Writeup is recorded.',
      'final_writeup_pointer_missing',
      500,
    );
  }
  assertEligibleSource(source);
  const authorization = resolveAuthorization(
    state,
    { isSuperuser, actingUserSystemId },
  );
  const pending = pendingFinalForSource(state, source.wmkf_requestdocumentid);
  return {
    available: true,
    phase: pending?.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
      ? 'starting'
      : 'ready',
    canStart: authorization.canStart,
    sourceArtifactId: source.wmkf_requestdocumentid,
    sourceFile: source.wmkf_sharepointweburl ? {
      webUrl: source.wmkf_sharepointweburl,
      name: source.wmkf_filename || null,
    } : null,
    artifact: null,
    pendingArtifact: projectArtifact(pending),
  };
}

async function verifySource(source, dependencies) {
  const before = await dependencies.getFileMetadataById(
    source.wmkf_sharepointdriveid,
    source.wmkf_sharepointitemid,
    { siteId: source.wmkf_sharepointsiteid || null },
  );
  if (!before || !sameId(before.driveId, source.wmkf_sharepointdriveid)
    || !sameId(before.id, source.wmkf_sharepointitemid) || !before.versionId) {
    throw finalError(
      'The current Site Visit Word document could not be verified in SharePoint.',
      'final_writeup_source_verification_failed',
    );
  }
  const downloaded = await dependencies.downloadFile(before.driveId, before.id);
  const contentHash = await Promise.resolve(dependencies.hashDocx(downloaded.buffer)).catch(() => null);
  const after = await dependencies.getFileMetadataById(
    before.driveId,
    before.id,
    { siteId: before.siteId || source.wmkf_sharepointsiteid || null },
  );
  if (!contentHash || !stableMetadataMatches(before, after)) {
    throw finalError(
      'The Word document changed while Final Writeup was starting. Retry to use the latest version.',
      'final_writeup_source_changed',
    );
  }
  return { metadata: after, contentHash };
}

function generationKey(requestId, source, verified) {
  return sha256(JSON.stringify({
    contract: FINAL_WRITEUP_CONTRACT.version,
    producer: FINAL_WRITEUP_CONTRACT.producer,
    requestId: String(requestId).toLowerCase(),
    sourceId: String(source.wmkf_requestdocumentid).toLowerCase(),
    sourceVersionId: verified.metadata.versionId,
    sourceContentHash: verified.contentHash,
  }));
}

function claimPayload(state, source, verified, key, claimToken) {
  const payload = {
    wmkf_name: `${state.request.akoya_requestnum || 'Request'} Final Writeup`,
    'wmkf_Request@odata.bind': `/akoya_requests(${state.request.akoya_requestid})`,
    'wmkf_SourceDocument@odata.bind': `/wmkf_requestdocuments(${source.wmkf_requestdocumentid})`,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_generationkey: key,
    wmkf_claimtoken: claimToken,
    wmkf_producer: FINAL_WRITEUP_CONTRACT.producer,
    wmkf_sourceversionid: verified.metadata.versionId,
    wmkf_sourcecontenthash: verified.contentHash,
    wmkf_contenthash: verified.contentHash,
    wmkf_milestoneversionid: verified.metadata.versionId,
    wmkf_milestonecontenthash: verified.contentHash,
    wmkf_sharepointsiteid: verified.metadata.siteId || source.wmkf_sharepointsiteid || null,
    wmkf_sharepointdriveid: verified.metadata.driveId,
    wmkf_sharepointitemid: verified.metadata.id,
    wmkf_sharepointweburl: verified.metadata.webUrl,
    wmkf_sharepointversionid: verified.metadata.versionId,
    wmkf_sharepointetag: verified.metadata.eTag,
    wmkf_sharepointfolderpath: source.wmkf_sharepointfolderpath || null,
    wmkf_filename: verified.metadata.name,
    wmkf_filesize: verified.metadata.size,
    wmkf_sharepointlastmodified: verified.metadata.lastModified,
    wmkf_attemptcount: 1,
  };
  for (const field of COPIED_FIELDS) {
    if (!(field in payload)) payload[field] = source[field] ?? null;
  }
  if (source._wmkf_aiprompt_value) {
    payload['wmkf_AIPrompt@odata.bind'] = `/wmkf_ai_prompts(${source._wmkf_aiprompt_value})`;
  }
  if (source._wmkf_airun_value) {
    payload['wmkf_AIRun@odata.bind'] = `/wmkf_ai_runs(${source._wmkf_airun_value})`;
  }
  return payload;
}

async function rereadByGenerationKey(key, dependencies) {
  const result = await dependencies.findByGenerationKey(key);
  const rows = result?.records || [];
  if (rows.length > 1) {
    throw finalError(
      'Duplicate Final Writeup generation keys require reconciliation.',
      'final_writeup_duplicate_key',
      500,
    );
  }
  return rows[0] || null;
}

function assertClaimIdentity(row, source, verified, key) {
  assertKnownRow(row);
  if (row.wmkf_generationkey !== key
    || row.wmkf_artifacttype !== REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP
    || !sameId(row._wmkf_sourcedocument_value, source.wmkf_requestdocumentid)
    || row.wmkf_sourceversionid !== verified.metadata.versionId
    || row.wmkf_sourcecontenthash !== verified.contentHash
    || !sameId(row.wmkf_sharepointdriveid, source.wmkf_sharepointdriveid)
    || !sameId(row.wmkf_sharepointitemid, source.wmkf_sharepointitemid)) {
    throw finalError(
      'The existing Final Writeup claim does not match the current source.',
      'final_writeup_claim_mismatch',
      500,
    );
  }
  return row;
}

function leaseActive(row, dependencies) {
  if (row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) return false;
  const modifiedAt = Date.parse(row.modifiedon || row.createdon || '');
  return Number.isFinite(modifiedAt)
    && dependencies.now().getTime() - modifiedAt < CLAIM_LEASE_MS;
}

async function claimExisting(row, actingUserSystemId, dependencies) {
  if (![REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING, REQUEST_DOCUMENT_OPERATION_STATUS.FAILED]
    .includes(row.wmkf_operationstatus)) {
    throw finalError(
      'The existing Final Writeup row is not safely claimable.',
      'final_writeup_claim_inconsistent',
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

async function reconcileCompetingClaim(
  state,
  source,
  key,
  actingUserSystemId,
  dependencies,
) {
  const competing = state.rows.filter((row) => (
    row.wmkf_artifacttype === REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP
    && sameId(row._wmkf_sourcedocument_value, source.wmkf_requestdocumentid)
    && row.wmkf_generationkey !== key
    && row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.FAILED
  ));
  if (competing.length > 1) {
    throw finalError(
      'Multiple competing Final Writeup rows require reconciliation.',
      'final_writeup_competing_rows',
      500,
    );
  }
  const row = competing[0] || null;
  if (!row) return null;
  assertKnownRow(row);
  if (row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
    throw finalError(
      'A Ready Final Writeup exists without the current request pointer.',
      'final_writeup_pointer_missing',
      500,
    );
  }
  if (leaseActive(row, dependencies)) return row;
  try {
    await dependencies.updateDocument(row.wmkf_requestdocumentid, {
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
      wmkf_claimtoken: null,
      wmkf_lasterrorcode: 'final_writeup_claim_expired',
      wmkf_lasterrormessage: 'The Final Writeup claim expired before activation.',
      wmkf_lastfailedat: dependencies.now().toISOString(),
    }, conditionalOptions(row, actingUserSystemId));
  } catch (error) {
    if (error?.status === 412) {
      throw finalError(
        'The Final Writeup claim changed while it was being reconciled. Reload and retry.',
        'final_writeup_claim_conflict',
      );
    }
    throw error;
  }
  return null;
}

async function assertOwned(key, claimToken, dependencies) {
  const row = await rereadByGenerationKey(key, dependencies);
  if (!row
    || row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    || row.wmkf_claimtoken !== claimToken) {
    throw finalError('The Final Writeup claim was superseded.', 'final_writeup_claim_lost');
  }
  return row;
}

async function activate(state, source, finalRow, verified, actingUserSystemId, dependencies) {
  const fresh = await readState(state.request.akoya_requestid, dependencies);
  const currentSource = assertEligibleSource(resolveSource(fresh, source.wmkf_requestdocumentid));
  if (fresh.request._wmkf_currentfinalwriteup_value) {
    const committed = committedFinal(
      fresh,
      currentSource.wmkf_requestdocumentid,
      fresh.request._wmkf_currentfinalwriteup_value,
    );
    if (committed && sameId(committed.wmkf_requestdocumentid, finalRow.wmkf_requestdocumentid)) {
      return { row: committed, reused: true };
    }
    throw finalError(
      'A different Final Writeup is already current.',
      'final_writeup_already_exists',
    );
  }
  const currentFinal = fresh.rows.find((row) => sameId(
    row.wmkf_requestdocumentid,
    finalRow.wmkf_requestdocumentid,
  ));
  if (!currentFinal
    || currentFinal.wmkf_claimtoken !== finalRow.wmkf_claimtoken
    || currentFinal.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) {
    throw finalError('The Final Writeup claim was superseded.', 'final_writeup_claim_lost');
  }
  const metadataNow = await dependencies.getFileMetadataById(
    currentSource.wmkf_sharepointdriveid,
    currentSource.wmkf_sharepointitemid,
    { siteId: currentSource.wmkf_sharepointsiteid || null },
  );
  if (!stableMetadataMatches(verified.metadata, metadataNow)
    || !persistedIdentityMatches(currentFinal, metadataNow)) {
    throw finalError(
      'The Word document changed while Final Writeup was starting. Retry to use the latest version.',
      'final_writeup_source_changed',
    );
  }
  const startedAt = dependencies.now().toISOString();
  const operations = [
    {
      method: 'PATCH',
      entitySet: requestDocumentAdapter.ENTITY_SET_NAME,
      key: currentSource.wmkf_requestdocumentid,
      body: { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL },
      ifMatch: conditionalOptions(currentSource).ifMatch,
    },
    {
      method: 'PATCH',
      entitySet: requestDocumentAdapter.ENTITY_SET_NAME,
      key: currentFinal.wmkf_requestdocumentid,
      body: {
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
        wmkf_claimtoken: null,
        wmkf_groupreviewstartedat: startedAt,
        'wmkf_GroupReviewStartedBy@odata.bind': `/systemusers(${actingUserSystemId})`,
        wmkf_milestonecreatedat: startedAt,
        wmkf_lasterrorcode: null,
        wmkf_lasterrormessage: null,
        wmkf_lastfailedat: null,
      },
      ifMatch: conditionalOptions(currentFinal).ifMatch,
    },
    {
      method: 'PATCH',
      entitySet: grantRequestAdapter.ENTITY_SET_NAME,
      key: fresh.request.akoya_requestid,
      body: {
        'wmkf_CurrentFinalWriteup@odata.bind':
          `/wmkf_requestdocuments(${currentFinal.wmkf_requestdocumentid})`,
      },
      ifMatch: conditionalOptions(fresh.request).ifMatch,
    },
  ];
  try {
    await dependencies.commitChangeset(operations, { actingUserSystemId });
  } catch (error) {
    const observed = await readState(state.request.akoya_requestid, dependencies).catch(() => null);
    const committed = observed && committedFinal(
      observed,
      currentSource.wmkf_requestdocumentid,
      currentFinal.wmkf_requestdocumentid,
    );
    if (committed) return { row: committed, reused: true };
    if (error?.status === 412 || /\b412\b/.test(error?.message || '')) {
      throw finalError(
        'The writeup lifecycle changed while Final Writeup was starting. Reload and retry.',
        'final_writeup_transition_conflict',
      );
    }
    throw error;
  }
  const observed = await readState(state.request.akoya_requestid, dependencies);
  const committed = committedFinal(
    observed,
    currentSource.wmkf_requestdocumentid,
    currentFinal.wmkf_requestdocumentid,
  );
  if (!committed) {
    throw finalError(
      'The Final Writeup transition could not be confirmed from Dataverse.',
      'final_writeup_transition_unconfirmed',
      500,
    );
  }
  return { row: committed, reused: false };
}

async function markFailedIfOwned(key, claimToken, error, actingUserSystemId, dependencies) {
  if (!claimToken) return;
  const row = await rereadByGenerationKey(key, dependencies).catch(() => null);
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

  const verified = await verifySource(source, dependencies);
  const key = generationKey(requestId, source, verified);
  state = await readState(requestId, dependencies);
  source = assertEligibleSource(resolveSource(state, expectedArtifactId));
  const competing = await reconcileCompetingClaim(
    state,
    source,
    key,
    actingUserSystemId,
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
          { actingUserSystemId },
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
      claimToken = await claimExisting(row, actingUserSystemId, dependencies);
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
      actingUserSystemId,
      dependencies,
    );
    return {
      artifact: projectArtifact(activated.row),
      reused: activated.reused,
      inProgress: false,
    };
  } catch (error) {
    await markFailedIfOwned(key, claimToken, error, actingUserSystemId, dependencies);
    throw error;
  }
}

export { generationKey as buildFinalWriteupGenerationKey, projectArtifact as projectFinalWriteupArtifact };
