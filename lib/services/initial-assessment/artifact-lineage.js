/** Initial Assessment claim, lineage, changeset, and durable cleanup coordination. */
import crypto from 'crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { runChangeset } from '../../dataverse/core/changeset.js';
import { ServiceHttpError } from '../service-http-error.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
  isInitialAssessmentBoardSnapshot,
} from '../../../shared/config/requestDocument.js';
import {
  GENERATING_LEASE_MS,
  REQUEST_LINEAGE_SELECT,
  REQUEST_SELECT,
  parseOrphanCleanup,
  sanitizeFilePart,
} from './artifact-model.js';

// Stage A injection seam (Test Request Factory slice 6b): every adapter call
// `commitReadyLineage`/`assertOwnedClaim`/`rereadByGenerationKey`/
// `verifyReadyLineage` make, named to match `controls-service.js`
// DEFAULT_DEPENDENCIES's existing convention so one sandboxDeps object can
// serve both files in a later stage. Production callers omit `dependencies`
// and get these direct references unchanged.
const DEFAULT_DEPENDENCIES = Object.freeze({
  findByGenerationKey: requestDocumentAdapter.findByGenerationKey,
  findByRequest: requestDocumentAdapter.findByRequest,
  getRequest: grantRequestAdapter.getById,
  runChangeset,
});

export async function getRequestOrThrow(requestId) {
  try {
    const request = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
    if (request) return request;
  } catch (error) {
    if (error?.status !== 404) throw error;
  }
  throw new ServiceHttpError(`No request found for ${requestId}.`, { httpStatus: 404 });
}

export async function getActiveRequestBucket(requestId, requestNumber) {
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

export async function rereadByGenerationKey(generationKey, dependencies = DEFAULT_DEPENDENCIES) {
  const { records } = await dependencies.findByGenerationKey(generationKey);
  if (records.length > 1) {
    throw new ServiceHttpError('Duplicate request-document generation keys require reconciliation.', {
      httpStatus: 500,
    });
  }
  return records[0] || null;
}

export function conditionalOptions(row, actingUserSystemId = null) {
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

export async function assertOwnedClaim(generationKey, claimToken, dependencies = DEFAULT_DEPENDENCIES) {
  const current = await rereadByGenerationKey(generationKey, dependencies);
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

async function verifyReadyLineage(generationKey, targetId, requestId, dependencies = DEFAULT_DEPENDENCIES) {
  const [target, request, rows] = await Promise.all([
    rereadByGenerationKey(generationKey, dependencies),
    dependencies.getRequest(requestId, { select: REQUEST_LINEAGE_SELECT }),
    dependencies.findByRequest(requestId, {
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

export async function commitReadyLineage(
  row,
  {
    metadata = null,
    claimToken = null,
    actingUserSystemId = null,
  } = {},
  dependencies = DEFAULT_DEPENDENCIES,
) {
  for (let pass = 0; pass < 3; pass += 1) {
    const target = claimToken
      ? await assertOwnedClaim(row.wmkf_generationkey, claimToken, dependencies)
      : await rereadByGenerationKey(row.wmkf_generationkey, dependencies);
    if (!target || target.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED) {
      throw new ServiceHttpError('Initial Assessment Ready transition has no eligible target.', {
        httpStatus: 409,
      });
    }
    const result = await dependencies.findByRequest(target._wmkf_request_value, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
    });
    const request = await dependencies.getRequest(target._wmkf_request_value, {
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
      await dependencies.runChangeset(operations, {
        ...(actingUserSystemId ? { actingUserSystemId } : {}),
      });
    } catch (error) {
      const conflict = error?.status === 412 || /\b412\b/.test(error?.message || '');
      if (conflict) {
        if (claimToken) {
          const current = await rereadByGenerationKey(row.wmkf_generationkey, dependencies);
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
        dependencies,
      ).catch(() => null);
      if (afterError) return afterError;
      // A non-412 response can still mean the atomic changeset committed but
      // its response (and even the first verification read) was lost or lagged.
      // Delete this claimant's upload only after positively observing a newer
      // GENERATING claimant. Ready, same-claim, missing, and failed-read states
      // remain ambiguous and preserve the uploaded item for retry/reconciliation.
      if (claimToken) {
        const observed = await rereadByGenerationKey(row.wmkf_generationkey, dependencies)
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
      dependencies,
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

/*
 * A failed or stale deterministic row can be reclaimed. Ready rows are handled
 * above by the atomic lineage activation path and never reach this function.
 */
export async function claimExisting(row, actingUserSystemId = null) {
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
export async function prepareClaimForGeneration(
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

export async function markFailedIfOwned(
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
