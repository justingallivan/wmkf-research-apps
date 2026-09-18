/**
 * Retained Request Document snapshots and review-bundle persistence.
 *
 * This leaf owns the exact snapshot claim, upload, finalization, and Ready-row
 * recovery sequence. It keeps the original dependency binding and actor-aware
 * Request Document create contract.
 */
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../../request-document-actor-service.js';
import { assembleReviewBundle, reviewSetFingerprint } from '../review-bundle-service.js';
import {
  PRE_RP_BRIEF_CONTRACT,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../../shared/config/requestDocument.js';
import { DEFAULT_DEPENDENCIES } from './dependencies.js';
import {
  DOCX, PDF, TEMPLATE_VERSION, PRODUCER, SNAPSHOT_STALE_MS,
  distributionError, sameId, sha256, canonicalHash,
} from './model.js';

function assertStableSource(before, after, row) {
  if (!before || !after
    || !sameId(before.driveId, row.wmkf_sharepointdriveid)
    || !sameId(before.id, row.wmkf_sharepointitemid)
    || !sameId(after.driveId, row.wmkf_sharepointdriveid)
    || !sameId(after.id, row.wmkf_sharepointitemid)
    || !before.versionId
    || before.versionId !== after.versionId
    || before.eTag !== after.eTag
    || before.lastModified !== after.lastModified
    || before.size !== after.size) {
    throw distributionError(
      'The Word document changed while its frozen copy was being prepared. Retry to use one exact version.',
      'distribution_source_changed',
    );
  }
}

function assertStableFrozenWord(before, after, word) {
  if (!before || !after
    || !sameId(before.driveId, word.driveId)
    || !sameId(before.id, word.itemId)
    || !sameId(after.driveId, word.driveId)
    || !sameId(after.id, word.itemId)
    || !word.versionId
    || before.versionId !== word.versionId
    || after.versionId !== word.versionId
    || !word.eTag
    || before.eTag !== word.eTag
    || after.eTag !== word.eTag
    || Number(before.size) !== Number(word.size)
    || Number(after.size) !== Number(word.size)) {
    throw distributionError(
      'The frozen Word snapshot changed while Microsoft Graph converted it to PDF.',
      'distribution_pdf_source_changed',
    );
  }
}

async function captureCurrentSource(row, dependencies) {
  const before = await dependencies.getFileMetadataById(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    { siteId: row.wmkf_sharepointsiteid || null },
  );
  const downloaded = await dependencies.downloadFile(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
  );
  let contentHash;
  try {
    contentHash = await dependencies.hashDocx(downloaded.buffer);
  } catch {
    throw distributionError(
      'The current SharePoint item could not be verified as a Word document.',
      'distribution_source_word_invalid',
    );
  }
  const after = await dependencies.getFileMetadataById(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    { siteId: row.wmkf_sharepointsiteid || null },
  );
  assertStableSource(before, after, row);
  return {
    buffer: downloaded.buffer,
    driveId: after.driveId,
    itemId: after.id,
    versionId: after.versionId,
    contentHash,
    byteHash: sha256(downloaded.buffer),
    filename: after.name || downloaded.filename || row.wmkf_filename,
  };
}

async function loadCapturedSource(attempt, sourceRow, dependencies) {
  if (!attempt.source_version_id) return captureCurrentSource(sourceRow, dependencies);
  const current = await dependencies.getFileMetadataById(
    attempt.source_drive_id,
    attempt.source_item_id,
    { siteId: sourceRow.wmkf_sharepointsiteid || null },
  );
  let buffer;
  if (current?.versionId === attempt.source_version_id) {
    const captured = await captureCurrentSource(sourceRow, dependencies);
    buffer = captured.buffer;
  } else {
    buffer = await dependencies.downloadFileVersion(
      attempt.source_drive_id,
      attempt.source_item_id,
      attempt.source_version_id,
    );
  }
  // Same-operation retry: the source's identity is its version plus governed
  // content hash. Package bytes may have been rewritten by SharePoint after
  // the first capture (plan §12 Finding A; Codex adversarial review
  // 2026-09-17), so they are recomputed from what is served now rather than
  // compared against the first capture.
  let contentHash = null;
  try {
    contentHash = await dependencies.hashDocx(buffer);
  } catch {
    contentHash = null;
  }
  const byteHash = sha256(buffer);
  if (!contentHash || contentHash !== attempt.source_content_hash) {
    throw distributionError(
      'The captured Word version no longer matches the prepared source identity.',
      'distribution_source_hash_mismatch',
    );
  }
  return {
    buffer,
    driveId: attempt.source_drive_id,
    itemId: attempt.source_item_id,
    versionId: attempt.source_version_id,
    contentHash,
    byteHash,
    filename: attempt.source_filename,
  };
}


async function oneSnapshotRow(generationKey, dependencies) {
  const result = await dependencies.findDocumentByGenerationKey(generationKey);
  const rows = result?.records || [];
  if (rows.length > 1) {
    throw distributionError(
      'The frozen snapshot generation key resolved to multiple registry rows.',
      'distribution_snapshot_ambiguous',
      500,
    );
  }
  return rows[0] || null;
}

function snapshotProjection(row, buffer, byteHash) {
  return {
    documentId: row.wmkf_requestdocumentid,
    siteId: row.wmkf_sharepointsiteid,
    driveId: row.wmkf_sharepointdriveid,
    itemId: row.wmkf_sharepointitemid,
    versionId: row.wmkf_sharepointversionid,
    eTag: row.wmkf_sharepointetag,
    webUrl: row.wmkf_sharepointweburl,
    filename: row.wmkf_filename,
    contentType: row.wmkf_contenttype,
    size: buffer.length,
    byteHash,
    buffer,
  };
}

function assertStableSnapshotRead(row, before, after, expectedSize) {
  if (!before || !after
    || !sameId(before.driveId, row.wmkf_sharepointdriveid)
    || !sameId(before.id, row.wmkf_sharepointitemid)
    || !sameId(after.driveId, row.wmkf_sharepointdriveid)
    || !sameId(after.id, row.wmkf_sharepointitemid)
    || !before.versionId
    || before.versionId !== after.versionId
    || !before.eTag
    || before.eTag !== after.eTag
    || Number(before.size) !== Number(expectedSize)
    || Number(after.size) !== Number(expectedSize)) {
    throw distributionError(
      'The retained snapshot publication identity changed during verification.',
      'distribution_snapshot_publication_changed',
    );
  }
}

function stableUploadedMetadata(provisional, stable, expectedSize) {
  if (!stable
    || !sameId(stable.driveId, provisional?.driveId)
    || !sameId(stable.id, provisional?.id)
    || !stable.versionId
    || !stable.eTag
    || Number(stable.size) !== Number(expectedSize)) {
    throw distributionError(
      'SharePoint did not confirm one stable native snapshot publication identity.',
      'distribution_snapshot_identity_incomplete',
      502,
    );
  }
  return {
    ...stable,
    siteId: stable.siteId || provisional.siteId || null,
  };
}

async function validateReadySnapshot(row, spec, dependencies, actingUserSystemId) {
  if (!sameId(row._wmkf_sourcedocument_value, spec.sourceDocumentId)
    || row.wmkf_sourceversionid !== spec.sourceVersionId
    || row.wmkf_sourcecontenthash !== spec.sourceContentHash
    || row.wmkf_contenttype !== spec.contentType
    || !row.wmkf_sharepointdriveid
    || !row.wmkf_sharepointitemid
    || !row.wmkf_sharepointversionid
    || !row.wmkf_sharepointetag
    || !Number(row.wmkf_filesize)) {
    throw distributionError(
      'A frozen snapshot registry row has conflicting lineage.',
      'distribution_snapshot_lineage_mismatch',
      500,
    );
  }
  const before = await dependencies.getFileMetadataById(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    { siteId: row.wmkf_sharepointsiteid || null },
  );
  const downloaded = await dependencies.downloadFile(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
  );
  const after = await dependencies.getFileMetadataById(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    { siteId: row.wmkf_sharepointsiteid || null },
  );
  assertStableSnapshotRead(row, before, after, downloaded.buffer.length);
  const byteHash = sha256(downloaded.buffer);
  if (spec.contentType === DOCX) {
    // A retained Word snapshot is identified by its governed content hash
    // (every `word/` part, relationships canonicalised), never by package
    // bytes: SharePoint rewrites a generated .docx after upload (property
    // promotion adds customXml/docProps and repacks the container), and
    // that rewrite lands after the post-upload metadata read, so the bytes
    // Graph serves later legitimately differ from the bytes uploaded. A
    // Word-saved package already carries those parts and round-trips
    // byte-identical, which is why only raw generated briefs used to fail
    // here (plan §12 Finding A, 2026-09-17). An unparseable package is a
    // mismatch, not a server error.
    let semanticHash;
    try {
      semanticHash = await dependencies.hashDocx(downloaded.buffer);
    } catch {
      semanticHash = null;
    }
    if (!semanticHash || semanticHash !== spec.contentHash) {
      throw distributionError(
        'The retained Word snapshot no longer matches its frozen identity.',
        'distribution_word_snapshot_hash_mismatch',
      );
    }
  } else if (!downloaded.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))
    || row.wmkf_contenthash !== byteHash) {
    throw distributionError(
      'The retained PDF snapshot no longer matches its frozen identity.',
      'distribution_pdf_snapshot_hash_mismatch',
    );
  }
  if (row.wmkf_sharepointversionid !== after.versionId
    || row.wmkf_sharepointetag !== after.eTag
    || Number(row.wmkf_filesize) !== Number(after.size)
    || row.wmkf_sharepointlastmodified !== (after.lastModified || null)) {
    if (!row._etag) {
      throw distributionError(
        'The retained snapshot registry row has no concurrency identity.',
        'distribution_snapshot_etag_missing',
        500,
      );
    }
    try {
      await dependencies.updateDocument(row.wmkf_requestdocumentid, {
        wmkf_sharepointsiteid: after.siteId || row.wmkf_sharepointsiteid || null,
        wmkf_sharepointdriveid: after.driveId,
        wmkf_sharepointitemid: after.id,
        wmkf_sharepointweburl: after.webUrl || row.wmkf_sharepointweburl || null,
        wmkf_sharepointversionid: after.versionId,
        wmkf_sharepointetag: after.eTag,
        wmkf_filename: after.name || row.wmkf_filename,
        wmkf_filesize: after.size,
        wmkf_sharepointlastmodified: after.lastModified || null,
      }, { actingUserSystemId, ifMatch: row._etag });
    } catch (error) {
      if (![409, 412].includes(error?.status)) throw error;
    }
    const refreshed = await oneSnapshotRow(row.wmkf_generationkey, dependencies);
    if (!refreshed
      || refreshed.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
      || refreshed.wmkf_sharepointversionid !== after.versionId
      || refreshed.wmkf_sharepointetag !== after.eTag
      || Number(refreshed.wmkf_filesize) !== Number(after.size)) {
      throw distributionError(
        'The retained snapshot registry metadata changed concurrently.',
        'distribution_snapshot_registry_conflict',
        409,
      );
    }
    row = refreshed;
  }
  return snapshotProjection(row, downloaded.buffer, byteHash);
}

/**
 * Board-facing review bundle filename slug (plan §11, Step C1, owner
 * decision: institution-led, no request number). Characters outside
 * `[A-Za-z0-9 _-]` removed, whitespace collapsed, max 80 chars.
 */
function slugifyInstitutionName(name) {
  const cleaned = String(name || '').replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, ' ').trim();
  return (cleaned || 'Reviews').slice(0, 80);
}

async function ensureSnapshot(spec, dependencies, actingUserSystemId) {
  const generationKey = canonicalHash({
    contract: TEMPLATE_VERSION,
    format: spec.format,
    sourceDocumentId: spec.sourceDocumentId,
    sourceVersionId: spec.sourceVersionId,
    sourceContentHash: spec.sourceContentHash,
    sourceByteHash: spec.sourceByteHash,
  });
  const inputFingerprint = canonicalHash({
    sourceDocumentId: spec.sourceDocumentId,
    sourceVersionId: spec.sourceVersionId,
    sourceContentHash: spec.sourceContentHash,
    sourceByteHash: spec.sourceByteHash,
  });
  let row = await oneSnapshotRow(generationKey, dependencies);
  if (row?.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
    return validateReadySnapshot(row, spec, dependencies, actingUserSystemId);
  }

  let claimToken = dependencies.randomUUID();
  if (!row) {
    try {
      await dependencies.createDocument({
        wmkf_name: spec.format === 'review-bundle'
          ? `${spec.requestNumber} frozen review bundle`
          : `${spec.requestNumber} frozen ${spec.format.toUpperCase()} distribution snapshot`,
        'wmkf_Request@odata.bind': `/akoya_requests(${spec.requestId})`,
        'wmkf_SourceDocument@odata.bind': `/wmkf_requestdocuments(${spec.sourceDocumentId})`,
        // Plan §3, slice 4: the source is now the brief (type 100000009),
        // so the pinned snapshot row carries that same type.
        wmkf_artifacttype: PRE_RP_BRIEF_CONTRACT.artifactType,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.BOARD_READY,
        wmkf_generationkey: generationKey,
        wmkf_cyclecode: spec.cycleCode,
        wmkf_inputfingerprint: inputFingerprint,
        wmkf_claimtoken: claimToken,
        wmkf_producer: `${PRODUCER}-${spec.format}`,
        wmkf_templateid: spec.format === 'pdf'
          ? 'microsoft-graph-pdf'
          : (spec.format === 'review-bundle' ? 'pdf-lib-review-bundle' : 'frozen-word-copy'),
        wmkf_templateversion: TEMPLATE_VERSION,
        wmkf_contenttype: spec.contentType,
        wmkf_contenthash: spec.contentHash,
        wmkf_sourceversionid: spec.sourceVersionId,
        wmkf_sourcecontenthash: spec.sourceContentHash,
        wmkf_sharepointfolderpath: spec.folderPath,
        wmkf_filename: spec.filename,
        wmkf_attemptcount: 1,
      }, {
        actingUserSystemId,
        actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
        actorContext: {
          operation: 'pre-site-distribution-snapshot',
          requestId: spec.requestId,
          requestNumber: spec.requestNumber,
          operationId: generationKey,
        },
      });
    } catch (error) {
      if (![409, 412].includes(error?.status)
        && !/duplicate|alternate key/i.test(error?.message || '')) throw error;
    }
    row = await oneSnapshotRow(generationKey, dependencies);
  }
  if (!row) {
    throw distributionError('The frozen snapshot claim could not be read back.', 'distribution_snapshot_claim_missing', 502);
  }
  if (row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
    return validateReadySnapshot(row, spec, dependencies, actingUserSystemId);
  }
  if (row.wmkf_claimtoken !== claimToken) {
    const modified = Date.parse(row.modifiedon || '');
    if (row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
      && Number.isFinite(modified)
      && dependencies.now().getTime() - modified < SNAPSHOT_STALE_MS) {
      throw distributionError(
        'The same frozen snapshot is already being prepared. Retry shortly.',
        'distribution_snapshot_in_progress',
        409,
        { inProgress: true },
      );
    }
    if (!row._etag) {
      throw distributionError('The frozen snapshot row has no concurrency identity.', 'distribution_snapshot_etag_missing', 500);
    }
    claimToken = dependencies.randomUUID();
    await dependencies.updateDocument(row.wmkf_requestdocumentid, {
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
      wmkf_claimtoken: claimToken,
      wmkf_attemptcount: Number(row.wmkf_attemptcount || 0) + 1,
      wmkf_lasterrorcode: null,
      wmkf_lasterrormessage: null,
    }, { actingUserSystemId, ifMatch: row._etag });
    row = await oneSnapshotRow(generationKey, dependencies);
  }
  if (!row || row.wmkf_claimtoken !== claimToken) {
    throw distributionError('Another request owns the frozen snapshot claim.', 'distribution_snapshot_claim_lost', 409);
  }

  try {
    let buffer = spec.buffer;
    if (!buffer) buffer = await spec.buildBuffer();
    let byteHash = sha256(buffer);
    if (spec.expectedByteHash && byteHash !== spec.expectedByteHash) {
      throw distributionError('Frozen snapshot bytes changed before upload.', 'distribution_snapshot_bytes_changed');
    }
    const contentHash = spec.contentType === DOCX
      ? await dependencies.hashDocx(buffer)
      : byteHash;
    if (spec.contentHash && contentHash !== spec.contentHash) {
      throw distributionError('Frozen snapshot content hash changed before upload.', 'distribution_snapshot_content_changed');
    }

    await dependencies.ensureFolderPath('akoya_request', spec.folderPath);
    let uploaded = await dependencies.getFileMetadataByPath(
      'akoya_request',
      spec.folderPath,
      spec.filename,
    );
    if (uploaded) {
      // Lost-finalize recovery: an earlier attempt uploaded this exact
      // snapshot but never recorded it Ready. For Word the file may already
      // carry SharePoint's post-upload rewrite, so its identity is the
      // governed content hash, not the uploaded bytes (Codex adversarial
      // review, plan §12, 2026-09-17); PDF is stored verbatim.
      const existing = await dependencies.downloadFile(uploaded.driveId, uploaded.id);
      let existingHash = null;
      try {
        existingHash = spec.contentType === DOCX
          ? await dependencies.hashDocx(existing.buffer)
          : sha256(existing.buffer);
      } catch {
        existingHash = null;
      }
      if (!existingHash
        || existingHash !== contentHash
        || (spec.contentType !== DOCX && sha256(existing.buffer) !== byteHash)) {
        throw distributionError(
          'A different file already occupies the frozen snapshot path.',
          'distribution_snapshot_path_conflict',
        );
      }
      buffer = existing.buffer;
      byteHash = sha256(buffer);
    } else {
      uploaded = await dependencies.uploadFile(
        'akoya_request',
        spec.folderPath,
        spec.filename,
        buffer,
        spec.contentType,
      );
    }
    if (!uploaded?.driveId || !uploaded?.id) {
      throw distributionError('SharePoint returned incomplete snapshot identity.', 'distribution_snapshot_identity_incomplete', 502);
    }
    const stable = await dependencies.getFileMetadataById(
      uploaded.driveId,
      uploaded.id,
      { siteId: uploaded.siteId || row.wmkf_sharepointsiteid || null },
    );
    uploaded = stableUploadedMetadata(uploaded, stable, buffer.length);
    await dependencies.updateDocument(row.wmkf_requestdocumentid, {
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      wmkf_claimtoken: null,
      wmkf_contenthash: contentHash,
      wmkf_sharepointsiteid: uploaded.siteId || row.wmkf_sharepointsiteid || null,
      wmkf_sharepointdriveid: uploaded.driveId,
      wmkf_sharepointitemid: uploaded.id,
      wmkf_sharepointweburl: uploaded.webUrl,
      wmkf_sharepointversionid: uploaded.versionId,
      wmkf_sharepointetag: uploaded.eTag || null,
      wmkf_filename: uploaded.name || spec.filename,
      wmkf_filesize: uploaded.size ?? buffer.length,
      wmkf_sharepointlastmodified: uploaded.lastModified || null,
    }, { actingUserSystemId, ifMatch: row._etag });
    const ready = await oneSnapshotRow(generationKey, dependencies);
    if (ready?.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
      throw distributionError('The frozen snapshot did not finalize.', 'distribution_snapshot_finalize_failed', 502);
    }
    return snapshotProjection(ready, buffer, byteHash);
  } catch (error) {
    const owned = await oneSnapshotRow(generationKey, dependencies).catch(() => null);
    if (owned?.wmkf_claimtoken === claimToken && owned._etag) {
      await dependencies.updateDocument(owned.wmkf_requestdocumentid, {
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
        wmkf_claimtoken: null,
        wmkf_lasterrorcode: String(error?.code || 'distribution_snapshot_failed').slice(0, 100),
        wmkf_lasterrormessage: String(error?.message || error).slice(0, 2000),
        wmkf_lastfailedat: dependencies.now().toISOString(),
      }, { actingUserSystemId, ifMatch: owned._etag }).catch(() => {});
    }
    throw error;
  }
}









/**
 * Bounded audit delta between the generated and live snapshots (plan
 * §3.4b step 3): changed request-field names, an `abstractChanged`
 * boolean, and added/removed/changed reviewer suggestion ids plus counts —
 * never prose, reviewer names, or abstract text.
 *
 * Both sides first pass through the exact canonical representation hashed by
 * `briefInputFingerprint`: non-received reviews are excluded and raw
 * fingerprint fields (including `reviewReceivedAt`) are compared. The delta
 * is therefore a pure function of those two canonical forms.
 */


/**
 * The prepare-time review/drift gate (plan §3.4b). Runs after `resolveSource`
 * and this read-only live-input load, and before any write (material/
 * calendar resolution, briefing-link mint, `createOrGetAttempt`,
 * `ensureSnapshot`). Re-hashes the stored snapshot and requires it to equal
 * the row's recorded fingerprint (fail closed on a malformed envelope or a
 * mismatch: `brief_snapshot_invalid`), requires at least one received
 * review in that stored snapshot (B10: `brief_reviews_required`), then
 * compares it against a freshly recomputed live fingerprint. A retry must
 * carry `acknowledgeStaleInputs` equal to the exact live fingerprint just
 * returned — a bare `true` or a stale acknowledgement is refused with a
 * fresh 409 naming the new live value.
 */


/**
 * Assemble and retain the "every review" bundle beside a request's brief
 * snapshot (plan §11). Shared by prepare (Step C1, staff-initiated) and the
 * briefing page's on-demand rebuild (Step C2): the rebuild is attributed to
 * the staff member who shared (the sent attempt's `acting_user_system_id`),
 * never unattributed — the caller must supply a real GUID actor id, same
 * `REQUIRED` actor policy as every other create seam on this table. The
 * generation key is a pure function of the review set (`sourceVersionId`/
 * `sourceByteHash` carry the literal `'review-set'` marker and the
 * review-set fingerprint instead of a document version/content hash), so
 * ensureSnapshot naturally reuses the existing row when the set is
 * unchanged and only builds a new one when it differs.
 *
 * @returns {Promise<{ snapshot: object, assembly: object, setFingerprint: string }>}
 */
export async function retainReviewBundle(
  { requestId, requestNumber, cycleCode, sourceDocumentId, folderPath, institutionName, reviews },
  dependencies = DEFAULT_DEPENDENCIES,
  actingUserSystemId,
) {
  const setFingerprint = reviewSetFingerprint(reviews);
  const assembly = await assembleReviewBundle({
    reviews,
    requestNumber,
    institutionName,
  }, {
    downloadFileByPath: (folder, filename) => dependencies.downloadFileByPath('akoya_request', folder, filename),
    getFileMetadataByPath: (folder, filename) => dependencies.getFileMetadataByPath('akoya_request', folder, filename),
    downloadFileAsPdf: dependencies.downloadFileAsPdf,
  });
  const snapshot = await ensureSnapshot({
    format: 'review-bundle',
    requestId,
    requestNumber,
    cycleCode,
    sourceDocumentId,
    sourceVersionId: 'review-set',
    sourceContentHash: null,
    sourceByteHash: setFingerprint,
    contentType: PDF,
    contentHash: null,
    folderPath,
    filename: `${slugifyInstitutionName(institutionName)} - Reviews - ${assembly.byteHash.slice(0, 8)}.pdf`,
    buffer: assembly.buffer,
    expectedByteHash: assembly.byteHash,
  }, dependencies, actingUserSystemId);
  return { snapshot, assembly, setFingerprint };
}


export {
  assertStableSource, assertStableFrozenWord, captureCurrentSource, loadCapturedSource,
  ensureSnapshot,
};
