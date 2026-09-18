/** Final Writeup generation claim, lease, activation, and failure recovery. */
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';

import { readState } from './transition-state.js';
import {
  CLAIM_LEASE_MS, assertEligibleSource, assertKnownRow, committedFinal,
  conditionalOptions, finalError, persistedIdentityMatches, resolveSource,
  sameId, sanitizeError, stableMetadataMatches,
} from './transition-model.js';

export async function rereadByGenerationKey(key, dependencies) {
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
export function assertClaimIdentity(row, source, verified, key) {
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
export function leaseActive(row, dependencies) {
  if (row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) return false;
  const modifiedAt = Date.parse(row.modifiedon || row.createdon || '');
  return Number.isFinite(modifiedAt)
    && dependencies.now().getTime() - modifiedAt < CLAIM_LEASE_MS;
}
export async function claimExisting(row, actingUserSystemId, dependencies) {
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
export async function reconcileCompetingClaim(
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
export async function assertOwned(key, claimToken, dependencies) {
  const row = await rereadByGenerationKey(key, dependencies);
  if (!row
    || row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    || row.wmkf_claimtoken !== claimToken) {
    throw finalError('The Final Writeup claim was superseded.', 'final_writeup_claim_lost');
  }
  return row;
}
export async function activate(state, source, finalRow, verified, actingUserSystemId, dependencies) {
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
export async function markFailedIfOwned(key, claimToken, error, actingUserSystemId, dependencies) {
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
