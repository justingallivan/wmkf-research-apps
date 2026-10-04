/**
 * Read-only evidence check for one journaled Basic Factory file copy.
 *
 * This does not change the run ledger and does not authorize continuation.
 * A writer must claim the run lease and invoke this verifier again against
 * its claimed snapshot before any receipt transition.
 */
import crypto from 'node:crypto';
import {
  bundleSourceOf,
  computeRunPlanDigest,
  isBundleManifest,
  sha256,
  validateCloneManifest,
} from './basic-clone-steps.js';
import {
  COPY_DESTINATION_LIBRARY,
  REGISTERED_SHAREPOINT_SITE_KEY,
  SANDBOX_REHEARSAL_COPY_POLICY,
  planBundleFileCopies,
  usesPackageIntegrity,
} from './bundle-file-copy.js';
import { attestDocxPackageAgainstSource } from './docx-package-attestation.js';
import { expectedRequestFolder } from './sandbox-clone.js';

const hashBytes = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const epoch = (value) => {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
};
const blocked = (reason) => ({ status: 'blocked', reason, evidenceOnly: true, continuationAllowed: false });
const guidEqual = (left, right) => typeof left === 'string' && typeof right === 'string'
  && left.toLowerCase() === right.toLowerCase();
const sameSite = (left, right) => Boolean(left?.registered)
  && left.key === REGISTERED_SHAREPOINT_SITE_KEY
  && left.key === right.key && left.hostname === right.hostname && left.pathname === right.pathname;

function stableMetadataKey(metadata) {
  return [metadata?.id, metadata?.name, metadata?.size, metadata?.mimeType ?? null,
    metadata?.eTag ?? null,
    metadata?.cTag ?? null, metadata?.versionId ?? null,
    metadata?.parentReference?.driveId ?? null, metadata?.parentReference?.id ?? null,
    metadata?.parentReference?.path ?? null].join('\u0000');
}

function assertParentDrive(metadata, expectedDriveId) {
  if (!metadata?.parentReference || metadata.parentReference.driveId !== expectedDriveId) {
    throw new Error('Graph parent drive does not match the resolved drive.');
  }
}

function destinationPathMismatch(pathMetadata, idMetadata) {
  return pathMetadata.id !== idMetadata.id
    || pathMetadata.name !== idMetadata.name
    || pathMetadata.eTag !== idMetadata.eTag
    || pathMetadata.cTag !== idMetadata.cTag
    || pathMetadata.parentReference?.driveId !== idMetadata.parentReference?.driveId
    || pathMetadata.parentReference?.id !== idMetadata.parentReference?.id
    || pathMetadata.parentReference?.path !== idMetadata.parentReference?.path;
}

function assertRunPins(run, manifest, bundle, expectedTarget) {
  if (!isBundleManifest(manifest) || manifest.kind !== 'test-request-sandbox-rehearsal-manifest/v4') {
    throw new Error('Only a v4 bundle manifest is supported.');
  }
  if (run.recipe !== 'basic' || manifest.recipe !== run.recipe
      || run.destinationEnvironment !== expectedTarget.environment
      || manifest.target !== expectedTarget.url
      || manifest.createBodySha256 !== run.createBodySha256
      || manifest.source?.bundleSha256 !== run.bundleSha256
      || sha256(bundle) !== run.bundleSha256
      || manifest.source?.requestNumber !== run.sourceRequestNumber
      || manifest.source?.dataverseHost !== run.sourceDataverseHost
      || manifest.copyPolicy?.version !== run.copyPolicyVersion
      || manifest.copyPolicy?.digest !== run.copyPolicyDigest
      || manifest.source?.revision !== run.sourceRevision
      || !guidEqual(manifest.source?.requestId, run.sourceRequestId)
      || !guidEqual(manifest.values?.requestId, run.destinationRequestId)
      || !guidEqual(manifest.values?.runId, run.runId)
      || !guidEqual(manifest.values?.locationId, run.destinationLocationId)
      || manifest.expectedGraphSiteId !== run.expectedGraphSiteId
      || manifest.expectedGraphDriveId !== run.expectedGraphDriveId
      || computeRunPlanDigest({ manifest }) !== run.planDigest) {
    throw new Error('Run, manifest and bundle pins do not match.');
  }
  // `allowExpired` is correct after reservation; bundle freshness remains
  // enforced separately by the default (non-stale) bundleSourceOf call.
  validateCloneManifest(manifest, { allowExpired: true });
  const { bundle: checkedBundle } = bundleSourceOf(manifest);
  if (sha256(checkedBundle) !== run.bundleSha256) throw new Error('Fresh source bundle digest does not match the run.');
}

function selectPendingFile(run, resources, plannedFiles, requestFolder) {
  if (run.status !== 'needs_attention' || run.needsAttentionReason !== 'file_journal_unverified'
      || run.currentStep !== 'copy_file' || run.stepIndex !== 4) {
    throw new Error('Run is not stopped at the Basic copy-file step.');
  }
  const basicSteps = ['fence_source', 'create_request', 'correct_meeting_date', 'provision_location', 'copy_file', 'observe', 'verify'];
  if (resources.some((row) => !row || !basicSteps.includes(row.step)
      || basicSteps.indexOf(row.step) > basicSteps.indexOf('copy_file'))) {
    throw new Error('Run contains unknown or future-step resource evidence.');
  }
  const rows = resources.filter((row) => row.step === 'copy_file');
  if (rows.some((row) => row.resourceKind !== 'sharepoint_file'
      || !Number.isInteger(row.plannedIdentity?.index)
      || row.plannedIdentity.index < 0 || row.plannedIdentity.index >= plannedFiles.length)) {
    throw new Error('Copy-file ledger evidence has an unknown shape.');
  }
  const byIndex = new Map();
  for (const row of rows) {
    const index = row.plannedIdentity.index;
    if (byIndex.has(index)) throw new Error('Copy-file ledger has duplicate planned indexes.');
    byIndex.set(index, row);
  }
  const verified = rows.filter((row) => row.outcome === 'verified');
  const index = verified.length;
  if (index >= plannedFiles.length || [...byIndex.keys()].some((value) => value > index)) {
    throw new Error('Current pending file index is ambiguous.');
  }
  for (let previous = 0; previous < index; previous += 1) {
    const row = byIndex.get(previous);
    const planned = plannedFiles[previous];
    if (!row || row.outcome !== 'verified' || row.readback?.index !== previous
        || !row.readback?.itemId || row.readback.filename !== planned.destination.filename
        || row.readback.library !== planned.destination.library
        || row.readback.folder !== `${requestFolder}/${planned.destination.folder}`) {
      throw new Error('A prior verified file receipt does not match the bundle plan.');
    }
  }
  const pending = byIndex.get(index);
  if (!pending || !['dispatched', 'failed'].includes(pending.outcome)
      || pending.readback?.index !== index || !pending.readback?.itemId
      || !pending.readback?.uploadAttemptedAt) {
    throw new Error('Pending file has no exact journaled destination identity.');
  }
  const planned = plannedFiles[index];
  const readback = pending.readback;
  if (pending.plannedIdentity.filename !== planned.destination.filename
      || readback.filename !== planned.destination.filename
      || readback.library !== planned.destination.library
      || readback.folder !== `${requestFolder}/${planned.destination.folder}`
      || readback.sourceGraphItemId !== planned.source.graphItemId
      || readback.size !== planned.source.size
      || readback.contentHash !== planned.source.contentHash
      || readback.eTagBefore !== planned.source.eTag
      || (planned.source.versionId != null && readback.sourceVersionId !== planned.source.versionId)
      || readback.driveId !== run.expectedGraphDriveId
      || (!usesPackageIntegrity(planned.source.mimeType) && readback.sourceDriveId !== planned.source.driveId)) {
    throw new Error('Pending file receipt does not match the pinned file plan.');
  }
  if (usesPackageIntegrity(planned.source.mimeType)
      && (readback.mimeType !== planned.source.mimeType || !readback.sourceDriveId)) {
    throw new Error('Package receipt is missing its source identity.');
  }
  return { index, pending, planned };
}

function inventoryExpectation(requestFolder, plannedFiles, resources, currentIndex) {
  const expected = [];
  for (let index = 0; index <= currentIndex; index += 1) {
    const row = resources.find((item) => item.step === 'copy_file' && item.plannedIdentity?.index === index);
    const planned = plannedFiles[index];
    expected.push({
      id: row.readback.itemId,
      name: planned.destination.filename,
      folder: `${requestFolder}/${planned.destination.folder}`,
    });
  }
  return expected;
}

/**
 * Verify a pending item using fresh, read-only Dataverse and Graph reads.
 * `readRequest` must be bound by the caller to the run's target-specific
 * Dataverse client. The optional lease is reserved for an internal writer;
 * CLI/reporting callers must omit it.
 */
export async function verifyPendingBasicFileReadback({
  run,
  resources,
  manifest,
  bundle,
  graph,
  readRequest,
  expectedTarget,
  nowMs = Date.now(),
  expectedLease = null,
}) {
  try {
    if (!Number.isFinite(nowMs) || !run || !Array.isArray(resources) || !manifest || !bundle
        || !graph || typeof readRequest !== 'function' || !expectedTarget?.environment || !expectedTarget?.url) {
      return blocked('invalid_input');
    }
    if (expectedLease) {
      const runLeaseExpiry = epoch(run.lockedUntil);
      const expectedLeaseExpiry = epoch(expectedLease.lockedUntil);
      if (!run.leaseToken || run.leaseToken !== expectedLease.token
          || run.leaseGeneration !== expectedLease.generation || run.version !== expectedLease.version
          || runLeaseExpiry === null || runLeaseExpiry !== expectedLeaseExpiry || runLeaseExpiry <= nowMs) {
        return blocked('lease_fence_mismatch');
      }
    } else {
      const leaseExpiry = run.lockedUntil == null ? null : epoch(run.lockedUntil);
      if ((run.leaseToken && !Number.isFinite(leaseExpiry))
          || (!run.leaseToken && leaseExpiry != null && Number.isFinite(leaseExpiry) && leaseExpiry > nowMs)) {
        return blocked('lease_state_unknown');
      }
      if (run.leaseToken && leaseExpiry > nowMs) return blocked('lease_live');
    }
    if (!Number.isFinite(run.version) || !Number.isFinite(run.leaseGeneration)) return blocked('run_version_unknown');
    if (run.status !== 'needs_attention' || run.currentStep !== 'copy_file' || run.recipe !== 'basic') {
      return blocked('run_not_candidate');
    }
    assertRunPins(run, manifest, bundle, expectedTarget);

    const destination = await readRequest(run.destinationRequestId);
    if (!destination || !guidEqual(destination.akoya_requestid, run.destinationRequestId)
        || !guidEqual(destination.wmkf_testcreationrunid, run.runId)
        || destination.wmkf_istestrequest !== true
        || String(destination.akoya_requestnum ?? '') !== String(run.destinationRequestNumber ?? '')) {
      return blocked('destination_request_mismatch');
    }

    const plannedFiles = planBundleFileCopies(bundle, { destinationRequestNumber: destination.akoya_requestnum });
    const requestFolder = expectedRequestFolder(destination.akoya_requestnum, run.destinationRequestId);
    const { index, pending, planned } = selectPendingFile(run, resources, plannedFiles, requestFolder);
    const source = planned.source;
    const destinationFolder = `${requestFolder}/${planned.destination.folder}`;

    graph.clearGraphCaches();
    const target = graph.configuredSharePointTarget();
    if (!sameSite(target, source.sharePointSite)) return blocked('sharepoint_target_mismatch');
    const siteId = await graph.getSiteId();
    if (!siteId || siteId !== manifest.expectedGraphSiteId || siteId !== run.expectedGraphSiteId) {
      return blocked('sharepoint_site_mismatch');
    }
    const sourceDriveId = await graph.getDriveId(source.library, { siteId });
    const destinationDriveId = await graph.getDriveId(COPY_DESTINATION_LIBRARY, { siteId });
    if (!sourceDriveId || !destinationDriveId || destinationDriveId !== manifest.expectedGraphDriveId
        || destinationDriveId !== run.expectedGraphDriveId) return blocked('sharepoint_drive_mismatch');
    if (usesPackageIntegrity(source.mimeType) && pending.readback.sourceDriveId !== sourceDriveId) {
      return blocked('source_drive_mismatch');
    }

    const sourcePath = await graph.getFileMetadataByPath(source.library, source.folder, source.name, { siteId, driveId: sourceDriveId });
    const sourceBefore = await graph.getFileMetadataById(sourceDriveId, source.graphItemId, { siteId });
    if (!sourcePath || !sourceBefore || sourcePath.id !== source.graphItemId || sourceBefore.id !== source.graphItemId
        || sourcePath.name !== source.name || sourceBefore.name !== source.name
        || sourceBefore.size !== source.size || sourceBefore.mimeType !== source.mimeType
        || !source.eTag || sourceBefore.eTag !== source.eTag || sourcePath.eTag !== source.eTag
        || (source.versionId != null && sourceBefore.versionId !== source.versionId)) return blocked('source_metadata_mismatch');
    assertParentDrive(sourcePath, sourceDriveId);
    assertParentDrive(sourceBefore, sourceDriveId);
    if (sourcePath.parentReference?.path && sourceBefore.parentReference?.path
        && sourcePath.parentReference.path !== sourceBefore.parentReference.path) return blocked('source_parent_changed');
    const sourceDownload = await graph.downloadFile(sourceDriveId, source.graphItemId, {
      maxBytes: SANDBOX_REHEARSAL_COPY_POLICY.maxFileBytes,
    });
    if (!Buffer.isBuffer(sourceDownload?.buffer) || sourceDownload.buffer.length !== source.size
        || hashBytes(sourceDownload.buffer) !== source.contentHash) return blocked('source_content_mismatch');
    const sourceAfter = await graph.getFileMetadataById(sourceDriveId, source.graphItemId, { siteId });
    if (stableMetadataKey(sourceBefore) !== stableMetadataKey(sourceAfter)) return blocked('source_changed_during_read');

    const candidatePath = await graph.getFileMetadataByPath(COPY_DESTINATION_LIBRARY, destinationFolder, planned.destination.filename, { siteId, driveId: destinationDriveId });
    const destinationBefore = await graph.getFileMetadataById(destinationDriveId, pending.readback.itemId, { siteId });
    if (!candidatePath || !destinationBefore || candidatePath.id !== pending.readback.itemId
        || destinationBefore.id !== pending.readback.itemId || candidatePath.name !== planned.destination.filename
        || destinationBefore.name !== planned.destination.filename
        || destinationBefore.mimeType !== source.mimeType) return blocked('destination_identity_mismatch');
    assertParentDrive(candidatePath, destinationDriveId);
    assertParentDrive(destinationBefore, destinationDriveId);
    if (!destinationBefore.eTag || destinationPathMismatch(candidatePath, destinationBefore)) {
      return blocked('destination_metadata_mismatch');
    }
    // A failed package upload receipt can contain pre-promotion metadata.
    // Fresh stable metadata around this read and package attestation are the
    // evidence; only an already-journaled attested digest pins prior bytes.
    if (!usesPackageIntegrity(source.mimeType)
        && destinationBefore.size !== source.size) {
      return blocked('destination_receipt_mismatch');
    }
    if (!Number.isSafeInteger(destinationBefore.size) || destinationBefore.size < 0
        || destinationBefore.size > SANDBOX_REHEARSAL_COPY_POLICY.maxFileBytes + 2 * 1024 * 1024) {
      return blocked('destination_size_out_of_bounds');
    }
    const destinationDownload = await graph.downloadFile(destinationDriveId, pending.readback.itemId, {
      maxBytes: SANDBOX_REHEARSAL_COPY_POLICY.maxFileBytes + 2 * 1024 * 1024,
    });
    if (!Buffer.isBuffer(destinationDownload?.buffer) || destinationDownload.buffer.length !== destinationBefore.size
        || destinationDownload.mimeType !== source.mimeType) return blocked('destination_content_unavailable');
    let integrity;
    if (usesPackageIntegrity(source.mimeType)) {
      const attestation = await attestDocxPackageAgainstSource(destinationDownload.buffer, sourceDownload.buffer);
      integrity = { mode: 'package', digest: hashBytes(destinationDownload.buffer), normalizedParts: attestation.normalizedParts };
      if (!Array.isArray(integrity.normalizedParts)) return blocked('package_attestation_incomplete');
      if (pending.readback.attestedDigest && pending.readback.attestedDigest !== integrity.digest) return blocked('destination_digest_mismatch');
    } else {
      const digest = hashBytes(destinationDownload.buffer);
      if (destinationDownload.buffer.length !== source.size || digest !== source.contentHash) return blocked('destination_content_mismatch');
      integrity = { mode: 'exact_hash', digest };
    }
    const destinationAfter = await graph.getFileMetadataById(destinationDriveId, pending.readback.itemId, { siteId });
    if (stableMetadataKey(destinationBefore) !== stableMetadataKey(destinationAfter)) return blocked('destination_changed_during_read');
    const destinationPathAfter = await graph.getFileMetadataByPath(COPY_DESTINATION_LIBRARY, destinationFolder, planned.destination.filename, { siteId, driveId: destinationDriveId });
    if (!destinationPathAfter || destinationPathAfter.id !== pending.readback.itemId
        || destinationPathAfter.name !== planned.destination.filename) return blocked('destination_path_changed');
    assertParentDrive(destinationPathAfter, destinationDriveId);
    if (destinationPathMismatch(destinationPathAfter, destinationAfter)) return blocked('destination_path_changed');

    const inventory = await graph.listFiles(COPY_DESTINATION_LIBRARY, requestFolder, {
      recursive: true, maxDepth: 3, maxFiles: SANDBOX_REHEARSAL_COPY_POLICY.maxFiles,
      failOnTruncation: true, failOnDepthLimit: true,
      failOnMalformedResponse: true, failOnUnboundNextLink: true,
    });
    const expected = inventoryExpectation(requestFolder, plannedFiles, resources, index)
      .map((item) => ({ ...item, folder: item.folder }));
    if (inventory.length !== expected.length) return blocked('destination_inventory_mismatch');
    const actualKeys = inventory.map((item) => `${item.folder}\u0000${item.name}\u0000${item.id}`).sort();
    const expectedKeys = expected.map((item) => `${item.folder}\u0000${item.name}\u0000${item.id}`).sort();
    if (actualKeys.some((item, i) => item !== expectedKeys[i])) return blocked('destination_inventory_mismatch');

    const destinationFinal = await graph.getFileMetadataById(destinationDriveId, pending.readback.itemId, { siteId });
    const destinationPathFinal = await graph.getFileMetadataByPath(COPY_DESTINATION_LIBRARY, destinationFolder, planned.destination.filename, { siteId, driveId: destinationDriveId });
    if (stableMetadataKey(destinationBefore) !== stableMetadataKey(destinationFinal)
        || !destinationPathFinal || destinationPathFinal.id !== pending.readback.itemId
        || destinationPathMismatch(destinationPathFinal, destinationFinal)) return blocked('destination_changed_during_read');
    assertParentDrive(destinationPathFinal, destinationDriveId);
    const finalSource = await graph.getFileMetadataById(sourceDriveId, source.graphItemId, { siteId });
    if (stableMetadataKey(sourceBefore) !== stableMetadataKey(finalSource)) return blocked('source_changed_during_read');
    bundleSourceOf(manifest);
    if (expectedLease && epoch(run.lockedUntil) <= Date.now()) return blocked('lease_fence_mismatch');

    return {
      status: 'evidence_matches',
      reason: 'readback_integrity_verified',
      evidenceOnly: true,
      continuationAllowed: false,
      runId: run.runId,
      siteId,
      sourceDriveId,
      destinationDriveId,
      resourceId: pending.resourceId,
      index,
      itemId: pending.readback.itemId,
      sourceSha256: source.contentHash,
      destinationSha256: integrity.digest,
      integrityMode: integrity.mode,
      normalizedParts: integrity.normalizedParts ?? null,
      inventoryCount: inventory.length,
      checkedAt: new Date().toISOString(),
      proposedReadback: {
        index,
        filename: planned.destination.filename,
        folder: destinationFolder,
        library: COPY_DESTINATION_LIBRARY,
        size: source.size,
        contentHash: source.contentHash,
        sourceGraphItemId: source.graphItemId,
        driveId: destinationDriveId,
        itemId: destinationFinal.id,
        eTag: destinationFinal.eTag,
        versionId: destinationFinal.versionId,
        itemSize: destinationFinal.size,
        eTagBefore: source.eTag,
        sourceVersionId: source.versionId,
        sourceDriveId: usesPackageIntegrity(source.mimeType) ? sourceDriveId : source.driveId,
        uploadAttemptedAt: pending.readback.uploadAttemptedAt,
        ...(pending.readback.itemJournaledAt ? { itemJournaledAt: pending.readback.itemJournaledAt } : {}),
        verifiedAt: new Date().toISOString(),
        ...(usesPackageIntegrity(source.mimeType) ? { mimeType: source.mimeType, attestedDigest: integrity.digest } : {}),
      },
    };
  } catch (error) {
    if (/older than 6 hours|export time is invalid|export time is in the future/i.test(error?.message || '')) {
      return blocked('bundle_not_fresh');
    }
    return blocked('integrity_check_failed');
  }
}
