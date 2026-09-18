import crypto from 'crypto';
import { ServiceHttpError } from '../service-http-error.js';
import { isAcceptedFinalLifecycle } from './leadership-checkpoint.js';
import {
  FINAL_WRITEUP_CONTRACT,
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';

export const CLAIM_LEASE_MS = 15 * 60 * 1000;
export const REQUEST_SELECT = [
  'akoya_requestid', 'akoya_requestnum', '_wmkf_programdirector_value',
  '_wmkf_currentpresitevisit_value', '_wmkf_currentfinalwriteup_value',
].join(',');
export const COPIED_FIELDS = Object.freeze([
  'wmkf_cyclecode', 'wmkf_inputfingerprint', 'wmkf_renderinputfingerprint',
  'wmkf_templateid', 'wmkf_templateversion', 'wmkf_promptname', 'wmkf_promptversion',
  'wmkf_contenttype', 'wmkf_presiteexecutivesummary', 'wmkf_presiteimpactoverview',
  'wmkf_presitemethodologyoverview', 'wmkf_presitepersonneloverview',
  'wmkf_presitekeckfundingrationale', 'wmkf_presitebackgroundandimpact',
  'wmkf_presitedetailedmethodology', 'wmkf_presitepersonneldetails',
  'wmkf_presiteproposalcorejson', 'wmkf_presiteinputsnapshotjson',
]);

export function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}
export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
export function finalError(message, code, httpStatus = 409, extra = {}) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code, ...extra },
  });
}
export function sanitizeError(error) {
  return {
    code: String(error?.code || error?.status || 'final_writeup_transition_failed').slice(0, 100),
    message: String(error?.message || 'Final Writeup transition failed')
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(/[A-Za-z0-9_~.-]{40,}/g, '[redacted]')
      .slice(0, 2000),
  };
}
export function conditionalOptions(row, actingUserSystemId = null) {
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
export function assertKnownRow(row) {
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
export function stableMetadataMatches(left, right) {
  return Boolean(left && right)
    && sameId(left.driveId, right.driveId)
    && sameId(left.id, right.id)
    && left.versionId === right.versionId
    && left.eTag === right.eTag
    && left.lastModified === right.lastModified
    && Number(left.size) === Number(right.size);
}
export function persistedIdentityMatches(row, metadata) {
  return sameId(row?.wmkf_sharepointdriveid, metadata?.driveId)
    && sameId(row?.wmkf_sharepointitemid, metadata?.id)
    && row?.wmkf_sharepointversionid === metadata?.versionId
    && row?.wmkf_sharepointetag === metadata?.eTag
    && row?.wmkf_sharepointlastmodified === metadata?.lastModified
    && Number(row?.wmkf_filesize) === Number(metadata?.size);
}
export function requestRows(requestId, result) {
  return (result?.records || []).filter((row) => sameId(row?._wmkf_request_value, requestId));
}
export function resolveSource(state, expectedArtifactId = null) {
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
export function assertEligibleSource(source) {
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
export function resolveAuthorization(state, { isSuperuser, actingUserSystemId }) {
  const leadPdId = state.request._wmkf_programdirector_value || null;
  const isLeadPd = Boolean(leadPdId && actingUserSystemId && sameId(leadPdId, actingUserSystemId));
  return { isSuperuser, isLeadPd, canStart: Boolean(actingUserSystemId && (isSuperuser || isLeadPd)) };
}
export function projectArtifact(row) {
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
    leadershipReview: {
      startedAt: row.wmkf_leadershipreviewstartedat || null,
      startedById: row._wmkf_leadershipreviewstartedby_value || null,
      startedByName: row._wmkf_leadershipreviewstartedby_value_formatted || null,
    },
    lastError: row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED ? {
      code: row.wmkf_lasterrorcode || null,
      message: row.wmkf_lasterrormessage || null,
      failedAt: row.wmkf_lastfailedat || null,
    } : null,
  };
}
export function findCurrentFinal(state) {
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
export function stageOf(final) {
  return final.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL
    ? 'leadership-review'
    : 'group-review';
}
export function committedFinal(state, sourceId, finalId) {
  const source = state.rows.find((row) => sameId(row.wmkf_requestdocumentid, sourceId));
  const final = state.rows.find((row) => sameId(row.wmkf_requestdocumentid, finalId));
  if (!source || !final) return null;
  if (!sameId(state.request._wmkf_currentpresitevisit_value, sourceId)
    || !sameId(state.request._wmkf_currentfinalwriteup_value, finalId)
    || source.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL
    || final.wmkf_artifacttype !== REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP
    || final.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
    || !isAcceptedFinalLifecycle(final)
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
export function pendingFinalForSource(state, sourceId) {
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
export function generationKey(requestId, source, verified) {
  return sha256(JSON.stringify({
    contract: FINAL_WRITEUP_CONTRACT.version,
    producer: FINAL_WRITEUP_CONTRACT.producer,
    requestId: String(requestId).toLowerCase(),
    sourceId: String(source.wmkf_requestdocumentid).toLowerCase(),
    sourceVersionId: verified.metadata.versionId,
    sourceContentHash: verified.contentHash,
  }));
}
export function claimPayload(state, source, verified, key, claimToken) {
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
export function leadershipConflict() {
  return finalError(
    'The writeup lifecycle changed while leadership review was starting. Reload and retry.',
    'final_writeup_leadership_conflict',
  );
}
export function leadershipResult(row, reused) {
  return { artifact: projectArtifact(row), phase: 'leadership-review', reused };
}
export function leadershipCommittedByThisCall(state, sourceId, finalId, verified) {
  const committed = committedFinal(state, sourceId, finalId);
  if (!committed
    || committed.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL
    || !persistedIdentityMatches(committed, verified.metadata)
    || committed.wmkf_contenthash !== verified.contentHash) return null;
  return committed;
}

export const SOURCE_VERIFY_ERRORS = Object.freeze({
  unverifiable: [
    'The current Site Visit Word document could not be verified in SharePoint.',
    'final_writeup_source_verification_failed',
  ],
  changed: [
    'The Word document changed while Final Writeup was starting. Retry to use the latest version.',
    'final_writeup_source_changed',
  ],
});

export const LEADERSHIP_VERIFY_ERRORS = Object.freeze({
  unverifiable: [
    'The current Final Writeup Word document could not be verified in SharePoint.',
    'final_writeup_leadership_verification_failed',
  ],
  changed: [
    'The Word document changed while leadership review was starting. Retry to use the latest version.',
    'final_writeup_leadership_source_changed',
  ],
});
