/**
 * Source-bundle file copy for the sandbox Basic clone rehearsal (design build
 * order item 4, second half; sole pre-ledger exception in
 * docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md).
 *
 * Planning is pure and reuses the Basic recipe file-plan compiler. The copy
 * orchestrator owns no Graph client: every read and write is injected so the
 * ordering rules are testable offline. Per file, in order:
 *
 *   1. journal the resolved destination (a journal failure blocks the write);
 *   2. clear Graph resolution caches and re-resolve the registered site and
 *      both drives (the bundle's stored drive ID is snapshot identity only);
 *   3. re-read the source item by stable ID and refuse on any name, size,
 *      MIME type, eTag or version drift; download it and refuse on a SHA-256
 *      mismatch;
 *   4. ensure the destination subfolder and confirm the destination path is
 *      absent;
 *   5. journal the upload attempt, then issue exactly one create-only PUT
 *      (`conflictBehavior: 'fail'`);
 *   6. classify a thrown upload: 409 refuses; another definitive 4xx verifies
 *      absence; an ambiguous outcome is recovered only by reading the exact
 *      destination path and matching size and SHA-256. Never a second PUT.
 *   7. read the created item back by stable ID, download it and compare bytes.
 *
 * The loop stops at the first failed file; later files stay `planned`.
 */

import crypto from 'node:crypto';
import { compileBasicCloneFilePlan } from './file-plan.js';

export const COPY_DESTINATION_LIBRARY = 'akoya_request';
export const REGISTERED_SHAREPOINT_SITE_KEY = 'akoyago-shared';

/**
 * Write policy for the sandbox-only Basic clone rehearsal. This is a named
 * executor policy, distinct from the admin preview's read-only hashing
 * ceilings: it governs real SharePoint writes made by the rehearsal CLI in
 * the registered sandbox. The production executor's limits remain an owner
 * decision (design doc, open prerequisites); changing these values is a
 * reviewed commit, and the manifest binds the digest so a stale manifest
 * cannot execute under a different policy.
 */
export const SANDBOX_REHEARSAL_COPY_POLICY = Object.freeze({
  version: 'sandbox-rehearsal-2026-09-23',
  maxFiles: 7,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  allowedMimeTypes: Object.freeze([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]),
});

export function copyPolicyDigest(policy = SANDBOX_REHEARSAL_COPY_POLICY) {
  return crypto.createHash('sha256').update(JSON.stringify(policy)).digest('hex');
}

/** The bundle export must be recent: an old snapshot clones obsolete fields. */
export const BUNDLE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export function assertBundleFresh(bundle, now = Date.now()) {
  const exportedAt = Date.parse(bundle?.exportedAt);
  if (!Number.isFinite(exportedAt)) throw new Error('Source bundle export time is invalid.');
  if (exportedAt > now + CLOCK_SKEW_MS) throw new Error('Source bundle export time is in the future.');
  if (now - exportedAt > BUNDLE_MAX_AGE_MS) {
    throw new Error(`Source bundle is older than ${BUNDLE_MAX_AGE_MS / 3600000} hours; re-export before cloning.`);
  }
  return exportedAt + BUNDLE_MAX_AGE_MS;
}

const PLAN_DOCUMENT_KEYS = [
  'id', 'kind', 'library', 'folder', 'name', 'size', 'mimeType', 'eTag', 'versionId', 'contentHash',
];

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function now() {
  return new Date().toISOString();
}

function planDocument(document) {
  return Object.fromEntries(PLAN_DOCUMENT_KEYS.map((key) => [key, document[key] ?? null]));
}

/**
 * Compile the Basic recipe file plan for every document in a validated bundle.
 * Numbered destinations stay templates until `destinationRequestNumber` is
 * known (the server assigns it after the Request POST).
 */
export function planBundleFileCopies(bundle, { destinationRequestNumber = null } = {}) {
  const documents = Array.isArray(bundle?.documents) ? bundle.documents : null;
  if (!documents) throw new Error('Source bundle documents are missing.');
  const byId = new Map(documents.map((document) => [document.id, document]));
  const { maxFiles, maxFileBytes, maxTotalBytes, allowedMimeTypes } = SANDBOX_REHEARSAL_COPY_POLICY;
  const plan = compileBasicCloneFilePlan({
    destinationRequestNumber,
    filePolicy: { maxFiles, maxFileBytes, maxTotalBytes, allowedMimeTypes: [...allowedMimeTypes] },
    sourceDocuments: documents.map(planDocument),
    sourceRequestNumber: bundle.source?.request?.akoya_requestnum ?? null,
  }, { selectedDocumentIds: documents.map((document) => document.id) });
  if (!plan.planReady || plan.blockers.length) {
    throw new Error(`Bundle file plan is blocked: ${JSON.stringify(plan.blockers)}`);
  }
  if (plan.plannedFiles.length !== documents.length) {
    throw new Error('Bundle file plan did not cover every bundle document.');
  }
  return plan.plannedFiles.map((file) => {
    const document = byId.get(file.source.id);
    return {
      kind: file.kind,
      source: { ...document },
      destination: {
        library: COPY_DESTINATION_LIBRARY,
        folder: file.destination.folder,
        filename: file.destination.filename ?? null,
        filenameTemplate: file.destination.filenameTemplate ?? null,
      },
    };
  });
}

function requireResolvedDestination(file, requestFolder) {
  if (!file.destination?.filename || !file.destination?.folder) {
    throw new Error(`Destination for ${file.source?.name} is unresolved; plan with the destination request number.`);
  }
  if (typeof requestFolder !== 'string' || !/^\d{1,10}_[0-9A-F]{32}$/.test(requestFolder)) {
    throw new Error('Destination request folder is invalid.');
  }
  return {
    library: COPY_DESTINATION_LIBRARY,
    folder: `${requestFolder}/${file.destination.folder}`,
    filename: file.destination.filename,
  };
}

function sameSite(target, site) {
  return Boolean(target?.registered)
    && target.key === REGISTERED_SHAREPOINT_SITE_KEY
    && site?.key === target.key
    && site?.hostname === target.hostname
    && site?.pathname === target.pathname;
}

/** Classify a thrown upload: the PUT may or may not have been applied. */
export function classifyUploadError(error) {
  const status = Number.isInteger(error?.status) ? error.status : null;
  if (status === 409) return 'conflict';
  if (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429) return 'rejected';
  return 'ambiguous';
}

function assertSourceMetadataUnchanged(source, metadata) {
  if (!metadata) throw new Error(`Source document ${source.name} no longer exists.`);
  const drift = [];
  if (metadata.id !== source.graphItemId) drift.push('id');
  if (metadata.name !== source.name) drift.push('name');
  if (metadata.size !== source.size) drift.push('size');
  if (metadata.mimeType !== source.mimeType) drift.push('mimeType');
  if (metadata.eTag !== source.eTag) drift.push('eTag');
  if (source.versionId != null && metadata.versionId !== source.versionId) drift.push('versionId');
  if (drift.length) throw new Error(`Source document ${source.name} changed since export (${drift.join(', ')}).`);
}

async function downloadAndHash(dependencies, driveId, itemId, expected) {
  const downloaded = await dependencies.downloadFile(driveId, itemId);
  const buffer = downloaded?.buffer;
  if (!Buffer.isBuffer(buffer)) throw new Error('Downloaded content is not a buffer.');
  if (buffer.length !== expected.size) {
    throw new Error(`${expected.name} downloaded ${buffer.length} bytes; expected ${expected.size}.`);
  }
  const hash = sha256(buffer);
  if (hash !== expected.contentHash) throw new Error(`${expected.name} SHA-256 does not match the bundle.`);
  return buffer;
}

async function resolveDrives(dependencies, file, expected) {
  dependencies.clearGraphCaches();
  const target = dependencies.configuredSharePointTarget();
  if (!sameSite(target, file.source.sharePointSite)) {
    throw new Error('Bundle document site is not the configured registered akoyaGO site.');
  }
  const siteId = await dependencies.getSiteId();
  if (!siteId || siteId !== expected.siteId) throw new Error('Graph site identity changed since preflight.');
  const sourceDriveId = await dependencies.getDriveId(file.source.library, { siteId });
  const destinationDriveId = file.source.library === COPY_DESTINATION_LIBRARY
    ? sourceDriveId
    : await dependencies.getDriveId(COPY_DESTINATION_LIBRARY, { siteId });
  if (!sourceDriveId || !destinationDriveId) throw new Error('Graph drive did not resolve.');
  if (destinationDriveId !== expected.destinationDriveId) {
    throw new Error('Destination drive identity changed since preflight.');
  }
  return { siteId, sourceDriveId, destinationDriveId };
}

async function recoverAmbiguousUpload(dependencies, entry, ids, source) {
  const { library, folder, filename } = entry.destination;
  const item = await dependencies.getFileMetadataByPath(library, folder, filename, {
    siteId: ids.siteId, driveId: ids.destinationDriveId,
  });
  entry.recoveryReadAt = now();
  if (!item) return null;
  entry.recoveryItem = { id: item.id, size: item.size, eTag: item.eTag ?? null, versionId: item.versionId ?? null };
  if (item.size !== source.size) return null;
  await downloadAndHash(dependencies, ids.destinationDriveId, item.id, source);
  return item;
}

async function verifyCreatedItem(dependencies, entry, ids, source, itemId) {
  const metadata = await dependencies.getFileMetadataById(ids.destinationDriveId, itemId);
  if (!metadata || metadata.id !== itemId) throw new Error(`Created item ${entry.destination.filename} did not read back.`);
  if (metadata.name !== entry.destination.filename || metadata.size !== source.size) {
    throw new Error(`Created item ${entry.destination.filename} name or size mismatch on readback.`);
  }
  await downloadAndHash(dependencies, ids.destinationDriveId, itemId, source);
  entry.item = {
    id: metadata.id,
    name: metadata.name,
    size: metadata.size,
    eTag: metadata.eTag ?? null,
    versionId: metadata.versionId ?? null,
  };
  entry.verifiedAt = now();
  entry.status = 'verified';
}

async function copyOne(dependencies, journal, copies, entry, expected) {
  const file = entry.file;
  const source = file.source;
  const ids = await resolveDrives(dependencies, file, expected);
  Object.assign(entry, { siteId: ids.siteId, sourceDriveId: ids.sourceDriveId, destinationDriveId: ids.destinationDriveId });
  await journal(copies);

  assertSourceMetadataUnchanged(source, await dependencies.getFileMetadataById(ids.sourceDriveId, source.graphItemId));
  const buffer = await downloadAndHash(dependencies, ids.sourceDriveId, source.graphItemId, source);
  entry.sourceVerifiedAt = now();
  await journal(copies);

  entry.folderEnsureAttemptedAt = now();
  await journal(copies);
  const folderItem = await dependencies.ensureFolderPath(entry.destination.library, entry.destination.folder, {
    siteId: ids.siteId, driveId: ids.destinationDriveId,
  });
  entry.folderItemId = folderItem?.id ?? null;
  const preexisting = await dependencies.getFileMetadataByPath(
    entry.destination.library, entry.destination.folder, entry.destination.filename,
    { siteId: ids.siteId, driveId: ids.destinationDriveId },
  );
  entry.destinationAbsentCheckedAt = now();
  if (preexisting) {
    entry.outcome = 'conflict';
    entry.recoveryItem = { id: preexisting.id, size: preexisting.size, eTag: preexisting.eTag ?? null };
    throw new Error(`Destination ${entry.destination.folder}/${entry.destination.filename} already exists; refusing to copy.`);
  }
  await journal(copies);

  entry.uploadAttempted = true;
  entry.uploadAttemptedAt = now();
  await journal(copies); // a journal failure here throws before the PUT
  let uploaded = null;
  // The PUT's stable identity is journaled inside the upload, as soon as the
  // create response is parsed and before the Graph layer's own metadata
  // read-back; a termination in that read-back still leaves the exact ID.
  const onItemCreated = async (item) => {
    entry.item = {
      id: item.id,
      name: item.name ?? entry.destination.filename,
      size: item.size ?? null,
      eTag: item.eTag ?? null,
      versionId: item.versionId ?? null,
    };
    entry.outcome = 'created';
    entry.status = 'created-unverified';
    entry.itemJournaledAt = now();
    await journal(copies);
  };
  try {
    uploaded = await dependencies.uploadFile(
      entry.destination.library, entry.destination.folder, entry.destination.filename,
      buffer, source.mimeType,
      { conflictBehavior: 'fail', siteId: ids.siteId, driveId: ids.destinationDriveId, onItemCreated },
    );
    entry.uploadResponseReceivedAt = now();
  } catch (error) {
    entry.uploadError = error.message;
    entry.uploadErrorStatus = Number.isInteger(error?.status) ? error.status : null;
    if (entry.item?.id) {
      // The create committed and its ID is durable; only the post-create
      // read-back inside the upload failed. Verify by exact ID, never re-PUT.
      entry.uploadReadbackError = error.message;
      uploaded = { id: entry.item.id };
    } else {
      uploaded = await recoverFailedUpload(dependencies, journal, copies, entry, ids, source, error);
    }
  }
  if (!uploaded?.id) throw new Error(`Upload of ${entry.destination.filename} returned no item identity.`);
  if (!entry.item?.id) {
    // Ambiguous outcome recovered by exact path: journal the recovered identity.
    entry.item = {
      id: uploaded.id,
      name: uploaded.name ?? entry.destination.filename,
      size: uploaded.size ?? null,
      eTag: uploaded.eTag ?? null,
      versionId: uploaded.versionId ?? null,
    };
    entry.status = 'created-unverified';
    await journal(copies);
  }
  await verifyCreatedItem(dependencies, entry, ids, source, uploaded.id);
  await journal(copies);
}

/** A thrown upload with no journaled identity: refuse, reject, or recover by exact path. Never re-PUT. */
async function recoverFailedUpload(dependencies, journal, copies, entry, ids, source, error) {
  const kind = classifyUploadError(error);
  if (kind === 'conflict') {
    entry.outcome = 'conflict';
    await recoverAmbiguousUpload(dependencies, entry, ids, source).catch(() => null);
    throw new Error(`Destination ${entry.destination.filename} exists (409); refusing to overwrite.`);
  }
  if (kind === 'rejected') {
    entry.outcome = 'rejected';
    const item = await dependencies.getFileMetadataByPath(
      entry.destination.library, entry.destination.folder, entry.destination.filename,
      { siteId: ids.siteId, driveId: ids.destinationDriveId },
    );
    entry.recoveryReadAt = now();
    if (item) {
      entry.recoveryItem = { id: item.id, size: item.size, eTag: item.eTag ?? null };
      throw new Error(`Upload of ${entry.destination.filename} was rejected but an item now exists at the path; inspect by exact item.`);
    }
    throw new Error(`Upload of ${entry.destination.filename} was rejected (${entry.uploadErrorStatus}).`);
  }
  entry.outcome = 'ambiguous';
  await journal(copies);
  const recovered = await recoverAmbiguousUpload(dependencies, entry, ids, source);
  if (!recovered) {
    entry.outcome = 'ambiguous-unrecovered';
    throw new Error(`Upload of ${entry.destination.filename} had an ambiguous outcome and no matching item was found; do not retry.`);
  }
  entry.outcome = 'recovered';
  entry.recoveredByExactItem = true;
  return { id: recovered.id, name: recovered.name, size: recovered.size, eTag: recovered.eTag, versionId: recovered.versionId };
}

/**
 * Final, manifest-authoritative re-verification of every journaled copy by
 * stable ID: metadata before and after a fresh download must match the
 * identity recorded at verification (eTag, version, name, size) and the
 * bytes must hash to the bundle's SHA-256. Read-only; returns failures.
 */
export async function reverifyCopiedItems(copies, dependencies) {
  const failures = [];
  if (!Array.isArray(copies)) return ['file copy journal missing'];
  for (const entry of copies) {
    const label = entry.destination?.filename ?? `copy ${entry.index}`;
    if (entry.status !== 'verified' || !entry.item?.id || !entry.destinationDriveId) {
      failures.push(`${label} was not verified during copy`);
      continue;
    }
    try {
      const before = await dependencies.getFileMetadataById(entry.destinationDriveId, entry.item.id);
      if (!before) { failures.push(`${label} no longer exists`); continue; }
      const identity = (metadata) => [metadata.name, metadata.size, metadata.eTag ?? null, metadata.versionId ?? null].join('\u0000');
      const expected = [entry.destination.filename, entry.source.size, entry.item.eTag ?? null, entry.item.versionId ?? null].join('\u0000');
      if (identity(before) !== expected) { failures.push(`${label} metadata changed after verification`); continue; }
      const downloaded = await dependencies.downloadFile(entry.destinationDriveId, entry.item.id);
      if (!Buffer.isBuffer(downloaded?.buffer) || sha256(downloaded.buffer) !== entry.source.contentHash) {
        failures.push(`${label} bytes no longer match the bundle SHA-256`);
        continue;
      }
      const after = await dependencies.getFileMetadataById(entry.destinationDriveId, entry.item.id);
      if (!after || identity(after) !== expected) failures.push(`${label} changed during final verification`);
    } catch (error) {
      failures.push(`${label} final verification failed: ${error.message}`);
    }
  }
  return failures;
}

/**
 * Read-only reconciliation of a receipt's file-copy journal by stable item
 * ID: for every entry that recorded an identity (created, recovered, or a
 * conflicting/partial item), read the item back, compare size, and download
 * and hash it against the bundle's SHA-256. Performs no write.
 */
export async function reconcileJournaledCopies(copies, dependencies) {
  if (!Array.isArray(copies)) return [];
  const report = [];
  for (const entry of copies) {
    const itemId = entry.item?.id ?? entry.recoveryItem?.id ?? null;
    const row = {
      index: entry.index,
      filename: entry.destination?.filename ?? null,
      folder: entry.destination?.folder ?? null,
      status: entry.status,
      outcome: entry.outcome ?? null,
      itemId,
      exists: null,
      sizeMatches: null,
      hashMatches: null,
      error: null,
    };
    if (itemId && entry.destinationDriveId) {
      try {
        const metadata = await dependencies.getFileMetadataById(entry.destinationDriveId, itemId);
        row.exists = Boolean(metadata);
        if (metadata) {
          row.sizeMatches = metadata.size === entry.source?.size;
          const downloaded = await dependencies.downloadFile(entry.destinationDriveId, itemId);
          row.hashMatches = Buffer.isBuffer(downloaded?.buffer)
            && sha256(downloaded.buffer) === entry.source?.contentHash;
        }
      } catch (error) {
        row.error = error.message;
      }
    }
    report.push(row);
  }
  return report;
}

/**
 * Copy every planned file, journaling before each write. `journal(copies)` must
 * persist the array durably; if it throws, no further Graph write is issued.
 * Returns the journal entries; throws after journaling the first failure.
 */
export async function copyBundleFiles(
  { plannedFiles, requestFolder, expectedSiteId, expectedDestinationDriveId },
  dependencies,
  journal,
) {
  if (!Array.isArray(plannedFiles)) throw new Error('Planned files are required.');
  const copies = plannedFiles.map((file, index) => ({
    index,
    kind: file.kind,
    status: 'planned',
    source: {
      id: file.source.id,
      library: file.source.library,
      folder: file.source.folder,
      name: file.source.name,
      graphItemId: file.source.graphItemId,
      snapshotDriveId: file.source.driveId,
      size: file.source.size,
      mimeType: file.source.mimeType,
      eTag: file.source.eTag,
      versionId: file.source.versionId ?? null,
      contentHash: file.source.contentHash,
    },
    destination: requireResolvedDestination(file, requestFolder),
    file,
  }));
  const seen = new Set();
  for (const entry of copies) {
    const key = `${entry.destination.folder}/${entry.destination.filename}`.toLowerCase();
    if (seen.has(key)) throw new Error(`Two files resolve to ${key}.`);
    seen.add(key);
  }
  const expected = { siteId: expectedSiteId, destinationDriveId: expectedDestinationDriveId };
  if (!expected.siteId || !expected.destinationDriveId) throw new Error('Preflight site and drive identities are required.');

  const persisted = () => copies.map(({ file, ...rest }) => rest);
  const persist = () => journal(persisted());
  await persist();
  for (const entry of copies) {
    entry.startedAt = now();
    try {
      await copyOne(dependencies, persist, copies, entry, expected);
    } catch (error) {
      entry.status = 'failed';
      entry.error = error.message;
      entry.failedAt = now();
      try { await persist(); } catch (journalError) { error.message += ` (receipt update failed: ${journalError.message})`; }
      throw error;
    }
  }
  return persisted();
}

/**
 * Pure: compare the destination folder listing with the journaled copies.
 * Every verified copy must be listed exactly once by item ID, folder, name and
 * size, and nothing else may be present.
 */
export function verifyCopiedFiles(copies, listedFiles) {
  const failures = [];
  if (!Array.isArray(copies)) return ['file copy journal missing'];
  if (!Array.isArray(listedFiles)) return ['SharePoint folder could not be inspected'];
  const verified = copies.filter((entry) => entry.status === 'verified');
  if (verified.length !== copies.length) {
    failures.push(`${copies.length - verified.length} planned file(s) not verified`);
  }
  const listedById = new Map(listedFiles.map((file) => [file.id, file]));
  if (listedById.size !== listedFiles.length) failures.push('SharePoint listing repeats an item ID');
  for (const entry of verified) {
    const listed = listedById.get(entry.item?.id);
    if (!listed) {
      failures.push(`${entry.destination.filename} not present in the destination folder`);
      continue;
    }
    const normalizeFolder = (value) => String(value || '').replace(/^\/+|\/+$/g, '').toLowerCase();
    if (listed.name !== entry.destination.filename
        || listed.size !== entry.source.size
        || normalizeFolder(listed.folder) !== normalizeFolder(entry.destination.folder)) {
      failures.push(`${entry.destination.filename} listing does not match the journaled copy`);
    }
    listedById.delete(entry.item.id);
  }
  if (listedById.size) failures.push(`${listedById.size} unexpected file(s) in the destination folder`);
  return failures;
}
