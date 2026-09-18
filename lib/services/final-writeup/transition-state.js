import { DEFAULT_DEPENDENCIES } from './transition-dependencies.js';
import {

  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import {
   assertEligibleSource, committedFinal, finalError, findCurrentFinal,
  projectArtifact, requestRows, resolveAuthorization, resolveSource, sameId,
  stageOf, pendingFinalForSource, stableMetadataMatches,
  SOURCE_VERIFY_ERRORS,
} from './transition-model.js';



export async function readState(requestId, dependencies) {
  const [request, result] = await Promise.all([
    dependencies.getRequest(requestId),
    dependencies.findByRequest(requestId),
  ]);
  if (!request || !sameId(request.akoya_requestid, requestId)) {
    throw finalError('The request could not be resolved.', 'final_writeup_request_not_found', 404);
  }
  return { request, rows: requestRows(requestId, result) };
}
export async function getFinalWriteupStatus(
  { requestId, isSuperuser = false, actingUserSystemId = null },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!dependencies.schemaReady?.()) {
    return {
      available: false, phase: 'unavailable', canStart: false, canAdvance: false, artifact: null,
    };
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
    const phase = stageOf(committed);
    const authorization = resolveAuthorization(state, { isSuperuser, actingUserSystemId });
    return {
      available: true,
      phase,
      canStart: false,
      canAdvance: phase === 'group-review' && authorization.canStart,
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
    canAdvance: false,
    sourceArtifactId: source.wmkf_requestdocumentid,
    sourceFile: source.wmkf_sharepointweburl ? {
      webUrl: source.wmkf_sharepointweburl,
      name: source.wmkf_filename || null,
    } : null,
    artifact: null,
    pendingArtifact: projectArtifact(pending),
  };
}
export async function verifyDocument(row, dependencies, errors) {
  const before = await dependencies.getFileMetadataById(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    { siteId: row.wmkf_sharepointsiteid || null },
  );
  if (!before || !sameId(before.driveId, row.wmkf_sharepointdriveid)
    || !sameId(before.id, row.wmkf_sharepointitemid) || !before.versionId) {
    throw finalError(...errors.unverifiable);
  }
  const downloaded = await dependencies.downloadFile(before.driveId, before.id);
  const contentHash = await Promise.resolve(dependencies.hashDocx(downloaded.buffer)).catch(() => null);
  const after = await dependencies.getFileMetadataById(
    before.driveId,
    before.id,
    { siteId: before.siteId || row.wmkf_sharepointsiteid || null },
  );
  if (!contentHash || !stableMetadataMatches(before, after)) {
    throw finalError(...errors.changed);
  }
  return { metadata: after, contentHash };
}
export function verifySource(source, dependencies) {
  return verifyDocument(source, dependencies, SOURCE_VERIFY_ERRORS);
}
