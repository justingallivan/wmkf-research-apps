/**
 * Frozen Pre-Site informational distribution coordinator.
 *
 * Captures one exact editable Word version, retains an immutable DOCX snapshot,
 * optionally derives PDF under native version/eTag fences, binds the selected
 * bytes and compose fields into an exact preview, and resumes one Dynamics
 * activity through granular attachment/send steps. Non-sent sends require
 * literal impersonation, current-source readback, durable activity identity,
 * and a renewed pre-transport lease. READY snapshot reuse refreshes registry
 * metadata only after a stable read and exact byte/hash verification.
 * SharePoint + Request Document own file identity, Postgres owns recovery
 * state, and Dynamics owns transport.
 * Distribution history and preview preparation read the admin-governed
 * Share-for-deliberation subject/body and briefing-section copy; blank or
 * unavailable settings retain the code-owned fallback. The bound URL and
 * expiration date remain server-owned.
 */
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../request-document-actor-service.js';
import { isGuid } from '../../utils/guid.js';
import { assembleReviewBundle, reviewSetFingerprint } from './review-bundle-service.js';
import {
  PRE_RP_BRIEF_CONTRACT,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import { DEFAULT_DEPENDENCIES } from './distribution/dependencies.js';
import {
  DOCX, PDF, TEMPLATE_VERSION, PRODUCER, SNAPSHOT_STALE_MS, SEND_ACCEPTED_STATUS_CODES,
  distributionError, sameId, sha256, canonicalHash, parseStoredArray,
  attemptAttachments, assertPreparedAttachments,
  projectDistributionAttempt,
} from './distribution/model.js';
import {
  normalizeDistributionRecipients, includeCalendarOrganizer,
  BRIEFING_LINK_PLACEHOLDER, REVIEW_BUNDLE_LINK_PLACEHOLDER, reviewBundleDocumentUrl,
  renderBriefingBody, sessionSnapshotOf, sessionSnapshotsMatch, sessionLineText,
  distributionBodyHtml, normalizeComposeInput,
} from './distribution/composition.js';
import {
  readDeliberationShareDefaults, readSessionSnapshot, resolveMaterialLinks,
  buildCalendar, resolveCalendar, resolveSource,
  assertBriefInputsReady, resolveBriefingLink, resolveBoundBriefingUrl,
  assertAttemptSourceCurrent, assertAttemptExtensionsCurrent,
} from './distribution/context.js';






























/**
 * Briefing page section of the Share email (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md
 * §2.2): present only when the deliberation briefing link was minted for this
 * exact preview. The link is the carrier for reviews and the proposal;
 * they are never attached.
 */
// The stored body never carries the raw briefing token: the href holds this
// marker and `renderBriefingBody` substitutes the live URL only while building
// or comparing the Dynamics activity (Codex adversarial review, 2026-09-09).

// Plan §11 (Step C2): the review-bundle document link, resolved from the
// SAME briefing token — no second token is ever minted.


/**
 * Derive the review-bundle document route URL from the briefing page URL,
 * reusing its exact token: `.../external/briefing/<jwt>` becomes
 * `.../api/external/briefing/<jwt>/document?member=review-bundle`. Returns
 * null when `briefingUrl` isn't a recognizable briefing page URL.
 */




/**
 * The deliberation-session snapshot the preview binds to (tracker plan §5.6).
 * Only https meeting links are carried; anything else renders as no link.
 */


























// The source is the Pre-Research Presentation Brief (plan §3, slice 4). The
// Pre-Site pointer (`_wmkf_currentpresitevisit_value`) is no longer read
// anywhere in this file; a pre-existing unsent attempt whose
// `source_document_id` names a Pre-Site row therefore fails closed as
// `distribution_stale_source` here (that row can never resolve through the
// brief pointer) — see `assertAttemptSourceCurrent`, which calls this same
// function, and the round-1 test for that fall-through.


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

export async function preparePreSiteDistribution(input, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(input.requestId) || !isGuid(input.expectedArtifactId) || !isGuid(input.operationId)) {
    throw distributionError(
      'requestId, expectedArtifactId, and operationId must be GUIDs.',
      'distribution_identity_invalid',
      400,
    );
  }
  if (!input.fromEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.fromEmail)) {
    throw distributionError('Your account has no valid sending address.', 'distribution_sender_invalid', 400);
  }
  if (!isGuid(input.actingUserSystemId)) {
    throw distributionError(
      'Your staff account is not linked to a Dynamics sender identity.',
      'distribution_staff_identity_required',
      403,
    );
  }
  const compose = normalizeComposeInput(input);
  const { request, row: sourceRow } = await resolveSource(
    input.requestId,
    input.expectedArtifactId,
    dependencies,
  );
  // Plan §3.4b: the review/drift gate runs immediately after resolveSource
  // and this read-only live-input load, before any write below (material/
  // calendar resolution, briefing-link mint, createOrGetAttempt,
  // ensureSnapshot).
  const briefGate = await assertBriefInputsReady({
    sourceRow,
    requestId: input.requestId,
    acknowledgeStaleInputs: input.acknowledgeStaleInputs || null,
  }, dependencies);
  const [materialLinks, calendar, emailDefaults] = await Promise.all([
    resolveMaterialLinks(input.requestId, compose.selectedMaterialIds, dependencies),
    resolveCalendar(input.requestId, compose, dependencies),
    readDeliberationShareDefaults(dependencies),
  ]);
  const recipients = calendar
    ? includeCalendarOrganizer(compose.recipients, calendar.snapshot.organizerEmail)
    : compose.recipients;
  const briefingLink = await resolveBriefingLink(input, dependencies);
  // Tracker §5.6: the email carries the request's latest deliberation slot,
  // snapshotted here so the body and both hashes bind to it; send rechecks it.
  const sessionSnapshot = await readSessionSnapshot(input.requestId, dependencies);
  const briefingCopy = emailDefaults.briefingCopy;
  const bodyHtml = distributionBodyHtml(
    compose.bodyText,
    input.operationId,
    materialLinks,
    briefingLink,
    sessionSnapshot,
    briefingCopy,
  );
  const draftHash = canonicalHash({
    requestId: input.requestId,
    sourceDocumentId: sourceRow.wmkf_requestdocumentid,
    session: sessionSnapshot,
    attachmentMode: compose.attachmentMode,
    // Plan §3.4b step 4: bind the generated/live fingerprints, the bounded
    // delta, and the acknowledged fingerprint into the operation-id
    // conflict identity, so a same-operation-id retry with a DIFFERENT
    // acknowledgement conflicts instead of silently reusing the prior
    // attempt, while a lost-response retry with the SAME acknowledgement
    // (or none) still recovers it.
    briefInputFingerprintGenerated: briefGate.generatedFingerprint,
    briefInputFingerprintLive: briefGate.liveFingerprint,
    briefInputsAcknowledgedFingerprint: briefGate.acknowledgedFingerprint,
    briefInputsDelta: briefGate.delta,
    // Plan §11 (Step C1): bind the live received review set's identity so a
    // same-operation-id retry after the review set changed conflicts
    // instead of silently reusing the prior (now stale) bundle.
    reviewBundleSetFingerprint: reviewSetFingerprint(briefGate.liveReviews),
    ...(briefingLink ? { briefingLinkId: briefingLink.id } : {}),
    to: recipients.to,
    cc: recipients.cc,
    subject: compose.subject,
    bodyText: compose.bodyText,
    briefingCopy,
    materialLinks,
    calendar: calendar ? {
      siteVisitId: calendar.snapshot.activityId,
      siteVisitEtag: calendar.snapshot.etag,
      byteHash: calendar.attachment.byteHash,
    } : null,
    fromEmail: input.fromEmail.toLowerCase(),
    actingUserSystemId: input.actingUserSystemId || null,
    templateVersion: TEMPLATE_VERSION,
  });
  let attempt = await dependencies.createOrGetAttempt({
    operationId: input.operationId,
    requestId: input.requestId,
    sourceDocumentId: sourceRow.wmkf_requestdocumentid,
    attachmentMode: compose.attachmentMode,
    toRecipients: recipients.to,
    ccRecipients: recipients.cc,
    subject: compose.subject,
    bodyText: compose.bodyText,
    bodyHtml,
    fromEmail: input.fromEmail.toLowerCase(),
    actingUserSystemId: input.actingUserSystemId || null,
    draftHash,
    templateVersion: TEMPLATE_VERSION,
    calendarEnabled: Boolean(calendar),
    siteVisitId: calendar?.snapshot.activityId || null,
    siteVisitEtag: calendar?.snapshot.etag || null,
    siteVisitSnapshot: calendar?.snapshot || null,
    sessionSnapshot,
    materialLinks,
    calendar: calendar?.attachment || null,
    inputFingerprintGenerated: briefGate.generatedFingerprint,
    inputFingerprintLive: briefGate.liveFingerprint,
    staleInputsDelta: briefGate.delta,
    staleInputsAcknowledgedAt: briefGate.delta ? dependencies.now().toISOString() : null,
    staleInputsAcknowledgedBy: briefGate.delta ? (input.actingUserSystemId || null) : null,
  });
  if (!attempt || attempt.draft_hash !== draftHash
    || !sameId(attempt.request_id, input.requestId)
    || !sameId(attempt.source_document_id, sourceRow.wmkf_requestdocumentid)) {
    throw distributionError(
      'This operation ID is already bound to a different preview. Start a new preview.',
      'distribution_operation_conflict',
    );
  }
  if (attempt.state !== 'preparing') {
    return { attempt: projectDistributionAttempt(attempt), reused: true, briefingLink };
  }
  if (briefingLink && !sameId(attempt.briefing_link_id, briefingLink.id)) {
    attempt = await dependencies.recordBriefingLink(input.operationId, briefingLink.id);
    if (!attempt) {
      throw distributionError('The briefing link could not be bound to this preview.', 'distribution_briefing_persist_failed', 502);
    }
  }

  const captured = await loadCapturedSource(attempt, sourceRow, dependencies);
  attempt = await dependencies.recordSource(input.operationId, captured);
  if (!attempt) {
    throw distributionError('The exact source identity could not be persisted.', 'distribution_source_persist_failed', 502);
  }

  // Recheck the current pointer after the source identity is durable and before
  // creating the downstream Request Document that closes guarded reopen.
  await resolveSource(input.requestId, sourceRow.wmkf_requestdocumentid, dependencies);

  const sourceHashTag = captured.byteHash.slice(0, 16);
  const folderPath = `${sourceRow.wmkf_sharepointfolderpath.replace(/\/+$/, '')}/Distribution Snapshots`;
  const baseName = `PreRPBrief_${String(request.akoya_requestnum || input.requestId).replace(/[^A-Za-z0-9_-]/g, '_')}`
    + `_${sourceHashTag}`;
  const word = await ensureSnapshot({
    format: 'docx',
    requestId: input.requestId,
    requestNumber: request.akoya_requestnum || input.requestId,
    cycleCode: sourceRow.wmkf_cyclecode,
    sourceDocumentId: sourceRow.wmkf_requestdocumentid,
    sourceVersionId: captured.versionId,
    sourceContentHash: captured.contentHash,
    sourceByteHash: captured.byteHash,
    contentType: DOCX,
    contentHash: captured.contentHash,
    byteHash: captured.byteHash,
    expectedByteHash: captured.byteHash,
    folderPath,
    filename: `${baseName}.docx`,
    buffer: captured.buffer,
  }, dependencies, input.actingUserSystemId || null);

  let pdf = null;
  if (compose.attachmentMode !== 'docx') {
    pdf = await ensureSnapshot({
      format: 'pdf',
      requestId: input.requestId,
      requestNumber: request.akoya_requestnum || input.requestId,
      cycleCode: sourceRow.wmkf_cyclecode,
      sourceDocumentId: word.documentId,
      sourceVersionId: word.versionId,
      sourceContentHash: captured.contentHash,
      sourceByteHash: word.byteHash,
      contentType: PDF,
      contentHash: null,
      folderPath,
      filename: `${baseName}.pdf`,
      buildBuffer: async () => {
        const before = await dependencies.getFileMetadataById(
          word.driveId,
          word.itemId,
          { siteId: word.siteId || null },
        );
        const pdfBuffer = await dependencies.downloadFileAsPdf(word.driveId, word.itemId);
        const after = await dependencies.getFileMetadataById(
          word.driveId,
          word.itemId,
          { siteId: word.siteId || null },
        );
        assertStableFrozenWord(before, after, word);
        if (!pdfBuffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
          throw distributionError('Microsoft Graph did not return a PDF.', 'distribution_pdf_invalid', 502);
        }
        return pdfBuffer;
      },
    }, dependencies, input.actingUserSystemId || null);
  }

  // Plan §11 (Step C1): the "every review" bundle is assembled and retained
  // unconditionally (regardless of attachmentMode — the briefing page serves
  // it, the same way it serves the DOCX/PDF snapshots). A Graph failure or
  // an invalid part throws out of `retainReviewBundle` before `recordPrepared`
  // is ever called, so no attempt reaches `prepared` without a bundle (fail
  // closed).
  const {
    snapshot: reviewBundleSnapshot,
    assembly: reviewBundleAssembly,
    setFingerprint: reviewBundleSetFingerprintValue,
  } = await retainReviewBundle({
    requestId: input.requestId,
    requestNumber: request.akoya_requestnum || input.requestId,
    cycleCode: sourceRow.wmkf_cyclecode,
    sourceDocumentId: sourceRow.wmkf_requestdocumentid,
    folderPath,
    institutionName: briefGate.institutionName,
    reviews: briefGate.liveReviews,
  }, dependencies, input.actingUserSystemId || null);

  const selected = [
    ...(['docx', 'both'].includes(compose.attachmentMode) ? [{ kind: 'docx', ...word }] : []),
    ...(['pdf', 'both'].includes(compose.attachmentMode) ? [{ kind: 'pdf', ...pdf }] : []),
  ];
  const snapshotIdentity = (file) => (file ? {
    documentId: file.documentId,
    driveId: file.driveId,
    itemId: file.itemId,
    versionId: file.versionId,
    byteHash: file.byteHash,
    size: file.size,
  } : null);
  const previewHash = canonicalHash({
    operationId: input.operationId,
    requestId: input.requestId,
    sourceDocumentId: sourceRow.wmkf_requestdocumentid,
    sourceVersionId: captured.versionId,
    sourceByteHash: captured.byteHash,
    attachmentMode: compose.attachmentMode,
    briefInputFingerprintGenerated: briefGate.generatedFingerprint,
    briefInputFingerprintLive: briefGate.liveFingerprint,
    briefInputsAcknowledgedFingerprint: briefGate.acknowledgedFingerprint,
    briefInputsDelta: briefGate.delta,
    // Plan §11 (Step C1): the pinned review bundle identity is part of the
    // exact preview the briefing page serves, same rationale as the
    // DOCX/PDF snapshots below.
    reviewBundle: {
      documentId: reviewBundleSnapshot.documentId,
      driveId: reviewBundleSnapshot.driveId,
      itemId: reviewBundleSnapshot.itemId,
      versionId: reviewBundleSnapshot.versionId,
      byteHash: reviewBundleSnapshot.byteHash,
      size: reviewBundleSnapshot.size,
      setFingerprint: reviewBundleSetFingerprintValue,
      reviewCount: reviewBundleAssembly.reviewCount,
    },
    ...(briefingLink ? { briefingLinkId: briefingLink.id } : {}),
    // The pinned snapshots are part of the exact preview even when nothing is
    // attached: the briefing page serves these bytes, so a snapshot swap must
    // invalidate the preview the same way an attachment swap always has.
    snapshots: { docx: snapshotIdentity(word), pdf: snapshotIdentity(pdf) },
    session: sessionSnapshot,
    attachments: selected.map((file) => ({
      kind: file.kind,
      documentId: file.documentId,
      driveId: file.driveId,
      itemId: file.itemId,
      versionId: file.versionId,
      filename: file.filename,
      contentType: file.contentType,
      byteHash: file.byteHash,
      size: file.size,
    })).concat(calendar ? [{
      kind: 'calendar',
      filename: calendar.attachment.filename,
      contentType: calendar.attachment.contentType,
      byteHash: calendar.attachment.byteHash,
      size: calendar.attachment.size,
    }] : []),
    materialLinks,
    siteVisit: calendar ? {
      activityId: calendar.snapshot.activityId,
      etag: calendar.snapshot.etag,
    } : null,
    to: recipients.to,
    cc: recipients.cc,
    subject: compose.subject,
    bodyText: compose.bodyText,
    briefingCopy,
    fromEmail: input.fromEmail.toLowerCase(),
    actingUserSystemId: input.actingUserSystemId || null,
    templateVersion: TEMPLATE_VERSION,
  });
  attempt = await dependencies.recordPrepared(input.operationId, {
    // The finalizing UPDATE fences on this exact capture (store docblock).
    source: {
      driveId: captured.driveId,
      itemId: captured.itemId,
      versionId: captured.versionId,
      contentHash: captured.contentHash,
      byteHash: captured.byteHash,
    },
    docx: word,
    pdf,
    reviewBundle: {
      documentId: reviewBundleSnapshot.documentId,
      driveId: reviewBundleSnapshot.driveId,
      itemId: reviewBundleSnapshot.itemId,
      versionId: reviewBundleSnapshot.versionId,
      filename: reviewBundleSnapshot.filename,
      size: reviewBundleSnapshot.size,
      byteHash: reviewBundleSnapshot.byteHash,
      setFingerprint: reviewBundleSetFingerprintValue,
      reviewCount: reviewBundleAssembly.reviewCount,
    },
    calendar: calendar?.attachment || null,
    previewHash,
  });
  if (!attempt) {
    throw distributionError('The exact preview could not be persisted.', 'distribution_preview_persist_failed', 502);
  }
  return { attempt: projectDistributionAttempt(attempt), reused: false, briefingLink };
}

/**
 * Deliberation briefing link for this exact preview
 * (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.2). Required since 2026-09-10:
 * the email carries no attachment, so a preview that cannot carry a live link
 * refuses here, before anything is persisted, rather than sending a bare
 * email. Flag off (or link service unwired) is a 503 the composer shows
 * verbatim; a mint failure stays a 502.
 */


/**
 * The attempt's bound briefing link must still be THE live link for the
 * request. Returns its URL (unsealed by the link service) so the email body
 * can be rendered at activity creation and re-rendered for recovery matching;
 * the raw token is never persisted on the attempt. Runs at claim time and
 * again immediately before transport so a reissue during attachment work
 * cannot email a dead link.
 */


async function recoverEmailActivity(attempt, dependencies) {
  const correlationKey = `wmkf-pre-site-distribution:${attempt.operation_id}`;
  if (attempt.dynamics_email_id) {
    return dependencies.getEmailActivity(attempt.dynamics_email_id);
  }
  const matches = await dependencies.findEmailByCorrelation(correlationKey);
  if (matches.length > 1) {
    throw distributionError(
      'Multiple Dynamics email activities share this distribution identity.',
      'distribution_email_ambiguous',
      500,
    );
  }
  return matches[0] || null;
}

async function persistEmailIdentity(attempt, emailId, dependencies) {
  if (!isGuid(emailId)) {
    throw distributionError(
      'Dynamics returned an invalid email activity identity.',
      'distribution_email_identity_invalid',
      502,
    );
  }
  if (attempt.dynamics_email_id) {
    if (!sameId(attempt.dynamics_email_id, emailId)) {
      throw distributionError(
        'The distribution ledger and Dynamics correlation resolved to different activities.',
        'distribution_email_identity_mismatch',
        500,
      );
    }
    return attempt;
  }

  let recordError = null;
  try {
    const persisted = await dependencies.recordEmailActivity(attempt, emailId);
    if (persisted) return persisted;
  } catch (error) {
    recordError = error;
  }

  const recovered = await recoverEmailActivity(attempt, dependencies);
  if (!recovered) {
    if (recordError) throw recordError;
    throw distributionError(
      'The Dynamics activity ID could not be persisted.',
      'distribution_email_persist_failed',
      502,
    );
  }
  if (!sameId(recovered.activityid, emailId)) {
    throw distributionError(
      'The distribution correlation resolved to a different Dynamics activity.',
      'distribution_email_identity_mismatch',
      500,
    );
  }
  const retried = await dependencies.recordEmailActivity(attempt, recovered.activityid);
  if (!retried) {
    throw distributionError(
      'The recovered Dynamics activity ID could not be persisted.',
      'distribution_email_persist_failed',
      502,
    );
  }
  return retried;
}





function assertEmailActivityMatches(attempt, email, expectedBody = attempt.body_html) {
  const correlationKey = `wmkf-pre-site-distribution:${attempt.operation_id}`;
  const parties = Array.isArray(email?.email_activity_parties)
    ? email.email_activity_parties
    : [];
  const addresses = (mask) => parties
    .filter((party) => Number(party.participationtypemask) === mask)
    .map((party) => String(party.addressused || '').trim().toLowerCase())
    .filter(Boolean)
    .sort();
  const expectedTo = parseStoredArray(attempt.to_recipients).slice().sort();
  const expectedCc = parseStoredArray(attempt.cc_recipients).slice().sort();
  const expectedFrom = [attempt.from_email];
  if (email?.subject !== attempt.subject
    || email?.description !== expectedBody
    || email?.subcategory !== correlationKey
    || JSON.stringify(addresses(1)) !== JSON.stringify(expectedFrom)
    || JSON.stringify(addresses(2)) !== JSON.stringify(expectedTo)
    || JSON.stringify(addresses(3)) !== JSON.stringify(expectedCc)) {
    throw distributionError(
      'The recovered Dynamics activity no longer matches this exact preview.',
      'distribution_email_mismatch',
      500,
    );
  }
}

/**
 * Attachment identity at send. A frozen Word attachment is identified by its
 * governed content hash (the captured source's `source_content_hash`, which
 * the Word snapshot inherits at prepare), never by package bytes: SharePoint
 * rewrites a generated .docx after upload, so the bytes served later (and the
 * bytes Dynamics stored from an earlier attempt) legitimately differ from the
 * pinned `docx_byte_hash` (plan §12 Finding A, 2026-09-17). PDF and calendar
 * attachments are verbatim and keep the byte identity.
 */
async function attachmentContentMatches(attempt, file, content, dependencies) {
  if (!content) return false;
  if (file.kind === 'docx') {
    let governed = null;
    try {
      governed = await dependencies.hashDocx(content);
    } catch {
      governed = null;
    }
    return Boolean(governed) && governed === attempt.source_content_hash;
  }
  if (file.kind === 'calendar' && content.length !== file.size) return false;
  return sha256(content) === file.byteHash;
}

async function ensureEmailAttachment(attempt, file, dependencies, actingUserSystemId) {
  const assertRecoveredAttachment = async (attachmentId) => {
    const recovered = await dependencies.getEmailAttachmentContent(attachmentId);
    let recoveredBytes;
    try {
      recoveredBytes = Buffer.from(String(recovered?.body || ''), 'base64');
    } catch {
      recoveredBytes = null;
    }
    if (!recoveredBytes
      || recovered?.filename !== file.filename
      || String(recovered?.mimetype || '').toLowerCase() !== file.contentType.toLowerCase()
      || (file.kind !== 'docx' && Number(recovered?.filesize) !== file.size)
      || !(await attachmentContentMatches(attempt, file, recoveredBytes, dependencies))) {
      throw distributionError(
        `The recovered Dynamics ${file.kind.toUpperCase()} attachment does not match the confirmed preview.`,
        'distribution_attachment_recovery_mismatch',
        500,
      );
    }
  };
  const found = await dependencies.findEmailAttachments(attempt.dynamics_email_id, file.filename);
  if (found.length > 1) {
    throw distributionError(
      `Dynamics contains duplicate ${file.kind.toUpperCase()} attachments for this activity.`,
      'distribution_attachment_ambiguous',
      500,
    );
  }
  if (found.length === 1) {
    await assertRecoveredAttachment(found[0].activitymimeattachmentid);
    return;
  }
  let content;
  if (file.kind === 'calendar') {
    const snapshot = typeof attempt.site_visit_snapshot === 'string'
      ? JSON.parse(attempt.site_visit_snapshot)
      : attempt.site_visit_snapshot;
    content = buildCalendar(snapshot).content;
  } else {
    const downloaded = await dependencies.downloadFile(file.driveId, file.itemId);
    content = downloaded.buffer;
  }
  if (!(await attachmentContentMatches(attempt, file, content, dependencies))) {
    throw distributionError(
      `The frozen ${file.kind.toUpperCase()} no longer matches the confirmed preview.`,
      'distribution_attachment_hash_mismatch',
    );
  }
  try {
    await dependencies.addEmailAttachment(attempt.dynamics_email_id, {
      filename: file.filename,
      contentType: file.contentType,
      content,
      actingUserSystemId,
      noFallback: true,
    });
  } catch (error) {
    const after = await dependencies.findEmailAttachments(attempt.dynamics_email_id, file.filename)
      .catch(() => []);
    if (after.length !== 1) throw error;
    await assertRecoveredAttachment(after[0].activitymimeattachmentid);
  }
}

export async function sendPreSiteDistribution(input, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(input.requestId) || !isGuid(input.operationId)
    || !/^[0-9a-f]{64}$/.test(String(input.previewHash || ''))) {
    throw distributionError('Valid requestId, operationId, and previewHash are required.', 'distribution_send_identity_invalid', 400);
  }
  if (!isGuid(input.actingUserSystemId)) {
    throw distributionError(
      'Your staff account is not linked to a Dynamics sender identity.',
      'distribution_staff_identity_required',
      403,
    );
  }
  let existing = await dependencies.getAttempt(input.operationId);
  if (!existing || !sameId(existing.request_id, input.requestId)) {
    throw distributionError('The prepared distribution was not found.', 'distribution_attempt_not_found', 404);
  }
  if (existing.preview_hash !== input.previewHash) {
    throw distributionError(
      'The email or attachment selection changed after preview. Prepare a new exact preview.',
      'distribution_preview_changed',
    );
  }
  if (existing.from_email !== String(input.fromEmail || '').toLowerCase()
    || !sameId(existing.acting_user_system_id, input.actingUserSystemId)) {
    throw distributionError('This preview belongs to a different staff sender.', 'distribution_actor_mismatch', 403);
  }
  if (existing.state === 'sent') return { attempt: projectDistributionAttempt(existing), reused: true };
  if (existing.state === 'preparing') {
    throw distributionError('Prepare and confirm the exact preview before sending.', 'distribution_not_prepared');
  }
  assertPreparedAttachments(existing);
  if (process.env.DYNAMICS_IMPERSONATION_ENABLED !== 'true') {
    throw distributionError(
      'Dynamics sender impersonation must be enabled before this distribution can be sent.',
      'distribution_impersonation_required',
      503,
    );
  }
  let attempt = await dependencies.claimSend(input.operationId);
  if (!attempt) {
    existing = await dependencies.getAttempt(input.operationId);
    if (existing?.state === 'sent') return { attempt: projectDistributionAttempt(existing), reused: true };
    throw distributionError(
      'This exact send is already in progress. Retry shortly to read its result.',
      'distribution_send_in_progress',
      202,
      { inProgress: true },
    );
  }
  try {
    // A retry of an attempt whose send intent is already durable reconciles
    // Dynamics transport status FIRST: if the email already went out, nothing
    // downstream (including briefing-link liveness) may block recording it.
    if (attempt.send_requested_at && attempt.dynamics_email_id) {
      const reconciled = await dependencies.getEmailActivity(attempt.dynamics_email_id).catch(() => null);
      if (SEND_ACCEPTED_STATUS_CODES.has(Number(reconciled?.statuscode))) {
        const sent = await dependencies.recordSent(attempt, reconciled);
        if (!sent) throw distributionError('Transport acceptance could not be persisted.', 'distribution_send_persist_failed', 502);
        return { attempt: projectDistributionAttempt(sent), reused: true };
      }
    }
    await assertAttemptSourceCurrent(attempt, dependencies);
    await assertAttemptExtensionsCurrent(attempt, dependencies);
    let briefingUrl = await resolveBoundBriefingUrl(attempt, dependencies);
    let email = await recoverEmailActivity(attempt, dependencies);
    if (!email && attempt.dynamics_email_id) {
      throw distributionError(
        'The persisted Dynamics email activity could not be found. Reconcile it before retrying.',
        'distribution_email_missing',
        409,
      );
    }
    if (email && !attempt.dynamics_email_id) {
      attempt = await persistEmailIdentity(attempt, email.activityid, dependencies);
    }
    if (!email) {
      const correlationKey = `wmkf-pre-site-distribution:${attempt.operation_id}`;
      try {
        const emailId = await dependencies.createEmailActivity({
          subject: attempt.subject,
          body: renderBriefingBody(attempt.body_html, briefingUrl),
          from: attempt.from_email,
          to: parseStoredArray(attempt.to_recipients),
          cc: parseStoredArray(attempt.cc_recipients),
          regardingId: attempt.request_id,
          regardingType: 'akoya_request',
          correlationKey,
          actingUserSystemId: input.actingUserSystemId || null,
          noFallback: true,
        });
        attempt = await persistEmailIdentity(attempt, emailId, dependencies);
        email = await dependencies.getEmailActivity(attempt.dynamics_email_id);
      } catch (error) {
        email = await recoverEmailActivity(attempt, dependencies);
        if (!email) throw error;
        attempt = await persistEmailIdentity(attempt, email.activityid, dependencies);
      }
    }
    if (!email) {
      throw distributionError(
        'The persisted Dynamics email activity could not be found. Reconcile it before retrying.',
        'distribution_email_missing',
        409,
      );
    }
    assertEmailActivityMatches(attempt, email, renderBriefingBody(attempt.body_html, briefingUrl));

    for (const file of attemptAttachments(attempt)) {
      const alreadyAttached = file.kind === 'docx'
        ? attempt.docx_attached_at
        : file.kind === 'pdf' ? attempt.pdf_attached_at : attempt.calendar_attached_at;
      if (!alreadyAttached) {
        await ensureEmailAttachment(attempt, file, dependencies, input.actingUserSystemId || null);
        attempt = await dependencies.recordAttachment(attempt, file.kind);
        if (!attempt) throw distributionError('Attachment completion could not be persisted.', 'distribution_attachment_persist_failed', 502);
      }
    }

    const statusBefore = await dependencies.getEmailActivity(attempt.dynamics_email_id);
    if (SEND_ACCEPTED_STATUS_CODES.has(Number(statusBefore?.statuscode))) {
      const sent = await dependencies.recordSent(attempt, statusBefore);
      if (!sent) throw distributionError('Transport acceptance could not be persisted.', 'distribution_send_persist_failed', 502);
      return { attempt: projectDistributionAttempt(sent), reused: true };
    }

    // Final rechecks run BEFORE send intent becomes durable: a failure here
    // (source, materials, schedule, or briefing link changed or expired during
    // attachment work) must leave the attempt provably unsent, not a
    // `send_requested` row that reads as an unresolved transport.
    await assertAttemptSourceCurrent(attempt, dependencies);
    await assertAttemptExtensionsCurrent(attempt, dependencies);
    briefingUrl = await resolveBoundBriefingUrl(attempt, dependencies);
    attempt = await dependencies.recordSendRequested(attempt);
    if (!attempt) {
      throw distributionError(
        'The exact send intent could not be persisted.',
        'distribution_send_request_persist_failed',
        502,
      );
    }
    attempt = await dependencies.renewSendLease(attempt);
    if (!attempt) {
      throw distributionError(
        'The exact send lease expired before transport. Retry to reconcile its state.',
        'distribution_send_lease_lost',
        409,
      );
    }
    try {
      await dependencies.sendEmail(attempt.dynamics_email_id, {
        actingUserSystemId: input.actingUserSystemId || null,
        noFallback: true,
      });
    } catch (error) {
      const ambiguous = await dependencies.getEmailActivity(attempt.dynamics_email_id).catch(() => null);
      if (!SEND_ACCEPTED_STATUS_CODES.has(Number(ambiguous?.statuscode))) {
        throw distributionError(
          'Dynamics has not confirmed this send. Check this exact email before trying again.',
          'distribution_send_unconfirmed',
          202,
          { outcome: 'uncertain', pendingSend: projectDistributionAttempt(attempt) },
        );
      }
    }
    const statusAfter = await dependencies.getEmailActivity(attempt.dynamics_email_id).catch(() => ({}));
    const sent = await dependencies.recordSent(attempt, statusAfter);
    if (!sent) throw distributionError('Transport acceptance could not be persisted.', 'distribution_send_persist_failed', 502);
    return { attempt: projectDistributionAttempt(sent), reused: false };
  } catch (error) {
    await dependencies.recordFailure(attempt, error, error?.code || 'distribution_send_failed').catch(() => {});
    throw error;
  }
}

// Distinct acknowledging-actor GUIDs → full names for the staff history
// (B14). Best effort: a failed or missing lookup leaves the name null and
// never fails the history read.
async function resolveAcknowledgingActorNames(attempts, dependencies) {
  if (typeof dependencies.getSystemUserName !== 'function') return null;
  const ids = [...new Set(
    attempts
      .map((attempt) => String(attempt.stale_inputs_acknowledged_by || '').toLowerCase())
      .filter((id) => isGuid(id)),
  )];
  if (ids.length === 0) return null;
  const names = new Map();
  await Promise.all(ids.map(async (id) => {
    try {
      const name = await dependencies.getSystemUserName(id);
      if (name) names.set(id, String(name));
    } catch (error) {
      console.error('[pre-site distribution history] actor name read failed:', error?.message || error);
    }
  }));
  return names;
}

export async function getPreSiteDistributionHistory(
  { requestId },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(requestId)) {
    throw distributionError('requestId must be a GUID.', 'distribution_request_invalid', 400);
  }
  const [attempts, currentSource, briefingLink, emailDefaults] = await Promise.all([
    dependencies.listAttempts(requestId),
    (async () => {
      try {
        const request = await dependencies.getRequest(requestId);
        const documentId = request?._wmkf_currentprerpbrief_value || null;
        if (!documentId) return null;
        const result = await dependencies.findDocumentsByRequest(requestId, {
          artifactType: PRE_RP_BRIEF_CONTRACT.artifactType,
        });
        const row = (result.records || []).find((candidate) => (
          sameId(candidate.wmkf_requestdocumentid, documentId)
        ));
        if (!row?.wmkf_sharepointdriveid || !row?.wmkf_sharepointitemid) {
          return { documentId, versionId: null };
        }
        const metadata = await dependencies.getFileMetadataById(
          row.wmkf_sharepointdriveid,
          row.wmkf_sharepointitemid,
          { siteId: row.wmkf_sharepointsiteid || null },
        );
        return { documentId, versionId: metadata?.versionId || null };
      } catch {
        return null;
      }
    })(),
    // Live briefing link for the staff header (plan §2.4); null when the flag
    // is off or the caller's dependency set does not wire the link service.
    (async () => {
      if (typeof dependencies.briefingReady !== 'function' || !dependencies.briefingReady()) return null;
      if (typeof dependencies.getLiveBriefingLink !== 'function') return null;
      try {
        return await dependencies.getLiveBriefingLink(requestId);
      } catch (error) {
        console.error('[pre-site distribution history] briefing link read failed:', error?.message || error);
        return null;
      }
    })(),
    readDeliberationShareDefaults(dependencies),
  ]);
  const actorNames = await resolveAcknowledgingActorNames(attempts, dependencies);
  return {
    briefingLink,
    emailDefaults,
    attempts: attempts.map((attempt) => {
      let sourceFreshness = 'unknown';
      if (attempt.source_version_id && currentSource?.documentId) {
        sourceFreshness = !sameId(currentSource.documentId, attempt.source_document_id)
          || (currentSource.versionId && currentSource.versionId !== attempt.source_version_id)
          ? 'changed'
          : currentSource.versionId ? 'current' : 'unknown';
      }
      return projectDistributionAttempt(attempt, { sourceFreshness, actorNames });
    }),
    // Wrap Up derivation input (S466): uncapped EXISTS scoped to the CURRENT
    // source document, so display-limit truncation cannot regress the stage
    // and a superseded document's sends cannot promote its reopen successor.
    currentSourceEverSent: currentSource?.documentId
      ? await dependencies.hasSentAttemptForSource(requestId, currentSource.documentId)
      : false,
  };
}

export const PRE_SITE_DISTRIBUTION_TEMPLATE_VERSION = TEMPLATE_VERSION;

export {
  BRIEFING_LINK_PLACEHOLDER,
  REVIEW_BUNDLE_LINK_PLACEHOLDER,
  distributionBodyHtml,
  normalizeDistributionRecipients,
  projectDistributionAttempt,
  readDeliberationShareDefaults,
  renderBriefingBody,
  reviewBundleDocumentUrl,
  sessionLineText,
  sessionSnapshotOf,
  sessionSnapshotsMatch,
};
