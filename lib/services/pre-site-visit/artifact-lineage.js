/**
 * Pre-Site claims, lineage activation, and durable cleanup coordination.
 * Preserve correction-cycle and expected-pointer fences; do not reactivate stale Ready rows.
 */
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

export function generatingLeaseActive(row) {
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

export async function commitPostVisitRegeneration(
  { row, metadata, expectedArtifactId, claimToken, actingUserSystemId, isSuperuser = false },
  dependencies,
) {
  const target = await assertOwnedClaim(row.wmkf_generationkey, claimToken, dependencies);
  const request = await dependencies.getRequest(target._wmkf_request_value);
  if (isSuperuser !== true && !sameNullableId(request?._wmkf_programdirector_value, actingUserSystemId)) {
    throw new ServiceHttpError('Only the current lead Program Director can activate this writeup.', {
      httpStatus: 403, code: 'pre_site_writeup_lead_only',
    });
  }
  const result = await dependencies.findByRequest(target._wmkf_request_value, {
    artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
  });
  const rows = result?.records || [];
  const source = rows.find((candidate) => sameNullableId(
    candidate.wmkf_requestdocumentid, expectedArtifactId,
  ));
  if (!source || !sameNullableId(request?._wmkf_currentpresitevisit_value, expectedArtifactId)
    || !sameNullableId(target._wmkf_sourcedocument_value, expectedArtifactId)
    || source.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
    || source.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
    || !source._etag || !request?._etag) {
    throw new ServiceHttpError('The post-visit writeup stage changed during regeneration.', {
      httpStatus: 409, code: 'pre_site_visit_regeneration_stage_changed',
    });
  }
  const liveMetadata = await dependencies.getFileMetadataById(
    source.wmkf_sharepointdriveid, source.wmkf_sharepointitemid,
    { siteId: source.wmkf_sharepointsiteid || null },
  );
  if (!liveMetadata || !sameNullableId(liveMetadata.driveId, source.wmkf_sharepointdriveid)
    || !sameNullableId(liveMetadata.id, source.wmkf_sharepointitemid)) {
    throw new ServiceHttpError('The preserved writeup file could not be verified.', {
      httpStatus: 409, code: 'pre_site_visit_regeneration_source_unavailable',
    });
  }
  if (!metadata?.driveId || !metadata?.id || !metadata?.versionId) {
    throw new ServiceHttpError('The replacement file identity is incomplete.', {
      httpStatus: 502, code: 'pre_site_visit_upload_identity_incomplete',
    });
  }
  const successorMetadata = await dependencies.getFileMetadataById(
    metadata.driveId, metadata.id, { siteId: metadata.siteId || null },
  );
  if (!successorMetadata
    || !sameNullableId(successorMetadata.driveId, metadata.driveId)
    || !sameNullableId(successorMetadata.id, metadata.id)
    || successorMetadata.versionId !== metadata.versionId
    || successorMetadata.eTag !== metadata.eTag
    || successorMetadata.lastModified !== metadata.lastModified
    || Number(successorMetadata.size) !== Number(metadata.size)) {
    throw new ServiceHttpError('The replacement file changed before activation.', {
      httpStatus: 409, code: 'pre_site_visit_regeneration_file_changed',
    });
  }
  const downloaded = await dependencies.downloadFile(metadata.driveId, metadata.id, { siteId: metadata.siteId || null });
  if (!Buffer.isBuffer(downloaded?.buffer)) {
    throw new ServiceHttpError('The replacement Word file could not be downloaded for verification.', {
      httpStatus: 409, code: 'pre_site_visit_regeneration_download_invalid',
    });
  }
  const verifiedHash = await dependencies.hashDocx(downloaded.buffer);
  if (!target.wmkf_contenthash || verifiedHash !== target.wmkf_contenthash) {
    throw new ServiceHttpError('The replacement file hash could not be confirmed.', {
      httpStatus: 409, code: 'pre_site_visit_regeneration_hash_mismatch',
    });
  }
  const now = dependencies.now?.().toISOString?.() || new Date().toISOString();
  const operations = [
    {
      method: 'PATCH', entitySet: requestDocumentAdapter.ENTITY_SET_NAME,
      key: source.wmkf_requestdocumentid,
      body: { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED },
      ifMatch: source._etag,
    },
    {
      method: 'PATCH', entitySet: requestDocumentAdapter.ENTITY_SET_NAME,
      key: target.wmkf_requestdocumentid,
      body: {
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
        wmkf_claimtoken: null,
        wmkf_sharepointsiteid: metadata.siteId,
        wmkf_sharepointdriveid: metadata.driveId,
        wmkf_sharepointitemid: metadata.id,
        wmkf_sharepointweburl: metadata.webUrl,
        wmkf_sharepointversionid: metadata.versionId,
        wmkf_sharepointetag: metadata.eTag,
        wmkf_filesize: metadata.size,
        wmkf_sharepointlastmodified: metadata.lastModified,
        wmkf_contenthash: verifiedHash,
        wmkf_milestoneversionid: metadata.versionId,
        wmkf_milestonecontenthash: verifiedHash,
        wmkf_milestonecreatedat: now,
        'wmkf_MilestoneCreatedBy@odata.bind': `/systemusers(${actingUserSystemId})`,
      },
      ifMatch: conditionalOptions(target, actingUserSystemId).ifMatch,
    },
    {
      method: 'PATCH', entitySet: grantRequestAdapter.ENTITY_SET_NAME,
      key: request.akoya_requestid,
      body: { 'wmkf_CurrentPreSiteVisit@odata.bind': `/wmkf_requestdocuments(${target.wmkf_requestdocumentid})` },
      ifMatch: request._etag,
    },
  ];
  const confirm = async () => {
    const [observed, current, readback] = await Promise.all([
      dependencies.getRequest(request.akoya_requestid),
      rereadByGenerationKey(target.wmkf_generationkey, dependencies),
      dependencies.findByRequest(request.akoya_requestid, {
        artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
      }),
    ]);
    const old = (readback?.records || []).find((candidate) => sameNullableId(
      candidate.wmkf_requestdocumentid, source.wmkf_requestdocumentid,
    ));
    if (!sameNullableId(observed?._wmkf_currentpresitevisit_value, target.wmkf_requestdocumentid)
      || current?.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
      || current?.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
      || old?.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED) return null;
    return current;
  };
  try {
    await dependencies.commitChangeset(operations, { actingUserSystemId });
  } catch (error) {
    const committed = await confirm().catch(() => null);
    if (committed) return committed;
    throw error;
  }
  const current = await confirm();
  if (!current) {
    throw new ServiceHttpError('The replacement writeup activation could not be confirmed.', {
      httpStatus: 500, code: 'pre_site_visit_regeneration_unconfirmed',
    });
  }
  return current;
}

export async function commitGroupReviewRegeneration(
  { row, finalRow, metadata, expectedArtifactId, expectedFinalArtifactId, claimToken,
    actingUserSystemId, isSuperuser = false },
  dependencies,
) {
  const target = await assertOwnedClaim(row.wmkf_generationkey, claimToken, dependencies);
  const [request, preResult, finalResult] = await Promise.all([
    dependencies.getRequest(target._wmkf_request_value),
    dependencies.findByRequest(target._wmkf_request_value, { artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT }),
    dependencies.findByRequest(target._wmkf_request_value, { artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP }),
  ]);
  const preRows = preResult?.records || [];
  const finalRows = finalResult?.records || [];
  const source = preRows.find((candidate) => sameNullableId(candidate.wmkf_requestdocumentid, expectedArtifactId));
  const previousFinal = finalRows.find((candidate) => sameNullableId(candidate.wmkf_requestdocumentid, expectedFinalArtifactId));
  const preparedFinal = finalRows.find((candidate) => sameNullableId(candidate.wmkf_requestdocumentid, finalRow?.wmkf_requestdocumentid));
  if (isSuperuser !== true && !sameNullableId(request?._wmkf_programdirector_value, actingUserSystemId)) {
    throw new ServiceHttpError('Only the current lead Program Director can activate this writeup.', {
      httpStatus: 403, code: 'pre_site_writeup_lead_only',
    });
  }
  if (!source || !previousFinal || !preparedFinal
    || !sameNullableId(request?._wmkf_currentpresitevisit_value, expectedArtifactId)
    || !sameNullableId(request?._wmkf_currentfinalwriteup_value, expectedFinalArtifactId)
    || source.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL
    || source.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
    || previousFinal.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
    || previousFinal.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
    || !sameNullableId(previousFinal._wmkf_sourcedocument_value, expectedArtifactId)
    || !sameNullableId(preparedFinal._wmkf_sourcedocument_value, target.wmkf_requestdocumentid)
    || preparedFinal.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    || !source._etag || !previousFinal._etag || !preparedFinal._etag || !request?._etag) {
    throw new ServiceHttpError('The group-review writeup pair changed during regeneration.', {
      httpStatus: 409, code: 'pre_site_visit_regeneration_stage_changed',
    });
  }
  const [successorMetadata, downloaded] = await Promise.all([
    dependencies.getFileMetadataById(metadata.driveId, metadata.id, { siteId: metadata.siteId || null }),
    dependencies.downloadFile(metadata.driveId, metadata.id, { siteId: metadata.siteId || null }),
  ]);
  if (!Buffer.isBuffer(downloaded?.buffer)) {
    throw new ServiceHttpError('The replacement Word file could not be downloaded for verification.', {
      httpStatus: 409, code: 'pre_site_visit_regeneration_download_invalid',
    });
  }
  if (!successorMetadata
    || !sameNullableId(successorMetadata.driveId, metadata.driveId)
    || !sameNullableId(successorMetadata.id, metadata.id)
    || successorMetadata.versionId !== metadata.versionId
    || successorMetadata.eTag !== metadata.eTag
    || successorMetadata.lastModified !== metadata.lastModified
    || Number(successorMetadata.size) !== Number(metadata.size)
    || await dependencies.hashDocx(downloaded.buffer) !== target.wmkf_contenthash) {
    throw new ServiceHttpError('The replacement group-review file changed before activation.', {
      httpStatus: 409, code: 'pre_site_visit_regeneration_file_changed',
    });
  }
  const startedAt = dependencies.now?.().toISOString?.() || new Date().toISOString();
  const metadataPatch = {
    wmkf_sharepointsiteid: metadata.siteId,
    wmkf_sharepointdriveid: metadata.driveId,
    wmkf_sharepointitemid: metadata.id,
    wmkf_sharepointweburl: metadata.webUrl,
    wmkf_sharepointversionid: metadata.versionId,
    wmkf_sharepointetag: metadata.eTag,
    wmkf_filesize: metadata.size,
    wmkf_sharepointlastmodified: metadata.lastModified,
    wmkf_contenthash: target.wmkf_contenthash,
    wmkf_milestoneversionid: metadata.versionId,
    wmkf_milestonecontenthash: target.wmkf_contenthash,
    wmkf_milestonecreatedat: startedAt,
    'wmkf_MilestoneCreatedBy@odata.bind': `/systemusers(${actingUserSystemId})`,
  };
  const operations = [
    { method: 'PATCH', entitySet: requestDocumentAdapter.ENTITY_SET_NAME, key: source.wmkf_requestdocumentid,
      body: { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED }, ifMatch: source._etag },
    { method: 'PATCH', entitySet: requestDocumentAdapter.ENTITY_SET_NAME, key: target.wmkf_requestdocumentid,
      body: { ...metadataPatch, wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL, wmkf_claimtoken: null },
      ifMatch: conditionalOptions(target, actingUserSystemId).ifMatch },
    { method: 'PATCH', entitySet: requestDocumentAdapter.ENTITY_SET_NAME, key: previousFinal.wmkf_requestdocumentid,
      body: { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED }, ifMatch: previousFinal._etag },
    { method: 'PATCH', entitySet: requestDocumentAdapter.ENTITY_SET_NAME, key: preparedFinal.wmkf_requestdocumentid,
      body: { ...metadataPatch, wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW, wmkf_claimtoken: null,
        wmkf_groupreviewstartedat: startedAt,
        'wmkf_GroupReviewStartedBy@odata.bind': `/systemusers(${actingUserSystemId})` },
      ifMatch: conditionalOptions(preparedFinal, actingUserSystemId).ifMatch },
    { method: 'PATCH', entitySet: grantRequestAdapter.ENTITY_SET_NAME, key: request.akoya_requestid,
      body: {
        'wmkf_CurrentPreSiteVisit@odata.bind': `/wmkf_requestdocuments(${target.wmkf_requestdocumentid})`,
        'wmkf_CurrentFinalWriteup@odata.bind': `/wmkf_requestdocuments(${preparedFinal.wmkf_requestdocumentid})`,
      }, ifMatch: request._etag },
  ];
  const confirm = async () => {
    const [freshRequest, freshPre, freshFinal] = await Promise.all([
      dependencies.getRequest(request.akoya_requestid),
      dependencies.findByRequest(request.akoya_requestid, { artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT }),
      dependencies.findByRequest(request.akoya_requestid, { artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP }),
    ]);
    const pres = freshPre?.records || [];
    const finals = freshFinal?.records || [];
    const currentPre = pres.find((candidate) => sameNullableId(candidate.wmkf_requestdocumentid, target.wmkf_requestdocumentid));
    const currentFinal = finals.find((candidate) => sameNullableId(candidate.wmkf_requestdocumentid, preparedFinal.wmkf_requestdocumentid));
    const oldPre = pres.find((candidate) => sameNullableId(candidate.wmkf_requestdocumentid, expectedArtifactId));
    const oldFinal = finals.find((candidate) => sameNullableId(candidate.wmkf_requestdocumentid, expectedFinalArtifactId));
    if (sameNullableId(freshRequest?._wmkf_currentpresitevisit_value, target.wmkf_requestdocumentid)
      && sameNullableId(freshRequest?._wmkf_currentfinalwriteup_value, preparedFinal.wmkf_requestdocumentid)
      && currentPre?.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
      && currentPre?.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL
      && currentFinal?.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
      && currentFinal?.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
      && sameNullableId(currentFinal?._wmkf_sourcedocument_value, target.wmkf_requestdocumentid)
      && oldPre?.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
      && oldFinal?.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED) return currentPre;
    return null;
  };
  try {
    await dependencies.commitChangeset(operations, { actingUserSystemId });
  } catch (error) {
    const landed = await confirm().catch(() => null);
    if (landed) return landed;
    throw error;
  }
  const landed = await confirm();
  if (!landed) throw new ServiceHttpError('The replacement group-review pair could not be confirmed.', {
    httpStatus: 500, code: 'pre_site_visit_regeneration_unconfirmed',
  });
  return landed;
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
