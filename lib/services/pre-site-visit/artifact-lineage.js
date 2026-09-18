import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { ServiceHttpError } from '../service-http-error.js';
import {
  isPreSiteDistributionSnapshot,
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import {
  GENERATING_LEASE_MS,
  REQUEST_LINEAGE_SELECT,
  UNCHANGED_RETRY_BLOCKED_CODES,
  assertPreSiteWordRow,
  conditionalOptions,
  fileNameFor,
  parseCleanupQueue,
  sameNullableId,
} from './artifact-model.js';

async function rereadByGenerationKey(generationKey, dependencies) {
  const result = await dependencies.findByGenerationKey(generationKey);
  const rows = result?.records || [];
  if (rows.length > 1) {
    throw new ServiceHttpError('Duplicate Pre-Site generation keys require reconciliation.', {
      httpStatus: 500,
    });
  }
  return rows[0] || null;
}

function generatingLeaseActive(row) {
  if (row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) return false;
  const modifiedAt = Date.parse(row.modifiedon || row.createdon || '');
  return Number.isFinite(modifiedAt) && Date.now() - modifiedAt < GENERATING_LEASE_MS;
}

async function assertOwnedClaim(generationKey, claimToken, dependencies) {
  const row = await rereadByGenerationKey(generationKey, dependencies);
  assertPreSiteWordRow(row);
  if (row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    || row.wmkf_claimtoken !== claimToken) {
    throw new ServiceHttpError('Pre-Site generation claim was superseded.', {
      httpStatus: 409,
      code: 'claim_lost',
      body: { error: 'Pre-Site generation claim was superseded.', code: 'claim_lost' },
    });
  }
  if (parseCleanupQueue(row.wmkf_orphancleanupoverflowjson).length > 0) {
    throw new ServiceHttpError('Pre-Site generation is blocked by unresolved SharePoint cleanup.', {
      httpStatus: 409,
      code: 'orphan_cleanup_required',
    });
  }
  return row;
}

async function claimExisting(row, actingUserSystemId, dependencies) {
  assertPreSiteWordRow(row);
  if (generatingLeaseActive(row)) return null;
  if (row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED
    && UNCHANGED_RETRY_BLOCKED_CODES.has(row.wmkf_lasterrorcode)) {
    throw new ServiceHttpError(
      'This draft attempt requires a prompt or application change before retrying.',
      {
        httpStatus: 409,
        code: 'pre_site_visit_retry_requires_change',
        body: {
          error: 'This draft attempt requires a prompt or application change before retrying.',
          code: 'pre_site_visit_retry_requires_change',
          artifactId: row.wmkf_requestdocumentid,
          runId: row._wmkf_airun_value || null,
        },
      },
    );
  }
  if (parseCleanupQueue(row.wmkf_orphancleanupoverflowjson).length > 0) {
    throw new ServiceHttpError('Pre-Site generation is blocked by unresolved SharePoint cleanup.', {
      httpStatus: 409,
      code: 'orphan_cleanup_required',
    });
  }
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

async function markFailedIfOwned(generationKey, claimToken, patch, actingUserSystemId, dependencies) {
  const row = await rereadByGenerationKey(generationKey, dependencies).catch(() => null);
  if (!row
    || row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    || row.wmkf_claimtoken !== claimToken) return false;
  try {
    await dependencies.updateDocument(
      row.wmkf_requestdocumentid,
      patch,
      conditionalOptions(row, actingUserSystemId),
    );
    return true;
  } catch (error) {
    if (error?.status === 412) return false;
    throw error;
  }
}

async function activeRequestBucket(requestId, requestNumber, dependencies) {
  const buckets = await dependencies.getBuckets(requestId, requestNumber, {
    requireResolvedParents: true,
  });
  const active = (buckets || []).filter((bucket) => (
    bucket.source === 'dynamics'
    && String(bucket.library || '').toLowerCase() === 'akoya_request'
  ));
  if (active.length !== 1) {
    throw new ServiceHttpError(
      `Expected exactly one active akoya_request SharePoint location; found ${active.length}.`,
      { httpStatus: 409 },
    );
  }
  return active[0];
}


async function verifyReadyLineage(generationKey, targetId, requestId, dependencies) {
  const [target, request, result] = await Promise.all([
    rereadByGenerationKey(generationKey, dependencies),
    dependencies.getRequest(requestId),
    dependencies.findByRequest(requestId, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    }),
  ]);
  const activeReadyWords = (result?.records || []).filter((row) => (
    row.wmkf_contenttype === PRE_SITE_VISIT_CONTRACT.contentType
    && !isPreSiteDistributionSnapshot(row)
    && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
  ));
  if (target
    && target.wmkf_requestdocumentid === targetId
    && target.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && target.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    && target.wmkf_contenttype === PRE_SITE_VISIT_CONTRACT.contentType
    && target.wmkf_sharepointdriveid
    && target.wmkf_sharepointitemid
    && request?._wmkf_currentpresitevisit_value === targetId
    && activeReadyWords.length === 1
    && activeReadyWords[0].wmkf_requestdocumentid === targetId) return target;
  return null;
}

async function commitReadyLineage(
  row,
  {
    metadata = null,
    claimToken = null,
    actingUserSystemId = null,
    expectedPointerId = undefined,
  } = {},
  dependencies,
) {
  for (let pass = 0; pass < 3; pass += 1) {
    const target = claimToken
      ? await assertOwnedClaim(row.wmkf_generationkey, claimToken, dependencies)
      : assertPreSiteWordRow(await rereadByGenerationKey(row.wmkf_generationkey, dependencies));
    const result = await dependencies.findByRequest(target._wmkf_request_value, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    });
    const request = await dependencies.getRequest(target._wmkf_request_value);
    const rows = result?.records || [];
    const pointerId = request?._wmkf_currentpresitevisit_value || null;
    // Activation fence: the pointer must still be the one observed before
    // this generation claimed its row (null when there was none). A
    // concurrent generation that activated first wins; this one refuses
    // instead of superseding the newer current document.
    if (expectedPointerId !== undefined
      && !sameNullableId(pointerId, expectedPointerId)
      && !sameNullableId(pointerId, target.wmkf_requestdocumentid)) {
      throw new ServiceHttpError(
        'The current Pre-Site document changed while generation was running. Reload and try again.',
        {
          httpStatus: 409,
          code: 'pre_site_visit_pointer_changed',
          body: {
            error: 'The current Pre-Site document changed while generation was running. Reload and try again.',
            code: 'pre_site_visit_pointer_changed',
          },
        },
      );
    }
    if (pointerId) {
      const pointer = rows.find((candidate) => candidate.wmkf_requestdocumentid === pointerId);
      if (!pointer
        || pointer._wmkf_request_value !== target._wmkf_request_value
        || pointer.wmkf_contenttype !== PRE_SITE_VISIT_CONTRACT.contentType
        || pointer.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
        || pointer.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED) {
        throw new ServiceHttpError('The current Pre-Site request pointer requires reconciliation.', {
          httpStatus: 409,
          code: 'pre_site_visit_pointer_invalid',
        });
      }
      if (pointer.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT) {
        throw new ServiceHttpError(
          'This Word draft became the Site Visit workspace while generation was running.',
          {
            httpStatus: 409,
            code: 'pre_site_visit_regeneration_locked',
          },
        );
      }
      if (!sameNullableId(pointer.wmkf_reopencycleid, target.wmkf_reopencycleid)) {
        throw new ServiceHttpError(
          'The current Pre-Site correction cycle changed while generation was running.',
          {
            httpStatus: 409,
            code: 'pre_site_visit_correction_cycle_changed',
          },
        );
      }
    }
    const unknownActiveReady = rows.some((candidate) => (
      candidate.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
      && candidate.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
      && ![PRE_SITE_VISIT_CONTRACT.contentType, 'application/pdf'].includes(candidate.wmkf_contenttype)
    ));
    if (unknownActiveReady) {
      throw new ServiceHttpError('An active Pre-Site artifact has an unknown content type.', {
        httpStatus: 409,
        code: 'pre_site_visit_content_type_unknown',
      });
    }
    const priorReady = rows.filter((candidate) => (
      candidate.wmkf_requestdocumentid !== target.wmkf_requestdocumentid
      && candidate.wmkf_contenttype === PRE_SITE_VISIT_CONTRACT.contentType
      && !isPreSiteDistributionSnapshot(candidate)
      && candidate.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
      && candidate.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    ));
    if (!metadata
      && target.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
      && target.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
      && priorReady.length === 0
      && request?._wmkf_currentpresitevisit_value === target.wmkf_requestdocumentid) return target;

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
        body: {
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
        },
        ifMatch: conditionalOptions(target).ifMatch,
      },
      {
        method: 'PATCH',
        entitySet: grantRequestAdapter.ENTITY_SET_NAME,
        key: target._wmkf_request_value,
        body: {
          'wmkf_CurrentPreSiteVisit@odata.bind':
            `/wmkf_requestdocuments(${target.wmkf_requestdocumentid})`,
        },
        ifMatch: conditionalOptions(request).ifMatch,
      },
    ];
    try {
      await dependencies.commitChangeset(operations, {
        ...(actingUserSystemId ? { actingUserSystemId } : {}),
      });
    } catch (error) {
      if (error?.status === 412 || /\b412\b/.test(error?.message || '')) continue;
      const committed = await verifyReadyLineage(
        row.wmkf_generationkey,
        target.wmkf_requestdocumentid,
        target._wmkf_request_value,
        dependencies,
      ).catch(() => null);
      if (committed) return committed;
      throw error;
    }
    const ready = await verifyReadyLineage(
      row.wmkf_generationkey,
      target.wmkf_requestdocumentid,
      target._wmkf_request_value,
      dependencies,
    );
    if (ready) return ready;
    throw new Error('Pre-Site registry read-back did not confirm the current Ready Word item.');
  }
  throw new ServiceHttpError('Pre-Site activation conflicted repeatedly; retry is safe.', {
    httpStatus: 409,
    code: 'ready_lineage_conflict',
  });
}


async function prepareFreshFilename(row, requestNumber, claimToken, actingUserSystemId, dependencies) {
  const current = await assertOwnedClaim(row.wmkf_generationkey, claimToken, dependencies);
  await dependencies.updateDocument(current.wmkf_requestdocumentid, {
    wmkf_filename: fileNameFor(requestNumber, row.wmkf_generationkey, claimToken),
    wmkf_contenthash: null,
    wmkf_renderinputfingerprint: null,
    wmkf_sharepointsiteid: null,
    wmkf_sharepointdriveid: null,
    wmkf_sharepointitemid: null,
    wmkf_sharepointweburl: null,
    wmkf_sharepointversionid: null,
    wmkf_sharepointetag: null,
    wmkf_filesize: null,
    wmkf_sharepointlastmodified: null,
  }, conditionalOptions(current, actingUserSystemId));
  return assertOwnedClaim(row.wmkf_generationkey, claimToken, dependencies);
}

export {
  activeRequestBucket,
  assertOwnedClaim,
  claimExisting,
  commitReadyLineage,
  generatingLeaseActive,
  markFailedIfOwned,
  prepareFreshFilename,
  rereadByGenerationKey,
  verifyReadyLineage,
};
