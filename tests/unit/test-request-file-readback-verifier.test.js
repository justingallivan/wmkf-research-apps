/** @jest-environment node */
import crypto from 'node:crypto';
import {
  MANIFEST_V4,
  TARGET_URLS,
  computeRunPlanDigest,
  sha256,
} from '../../lib/services/test-requests/basic-clone-steps.js';
import {
  BUNDLE_MAX_AGE_MS,
  SANDBOX_REHEARSAL_COPY_POLICY,
  copyPolicyDigest,
  planBundleFileCopies,
} from '../../lib/services/test-requests/bundle-file-copy.js';
import { buildSourceBundle } from '../../lib/services/test-requests/source-bundle.js';
import { expectedRequestFolder } from '../../lib/services/test-requests/sandbox-clone.js';
import { PRODUCTION_HOSTS } from '../../lib/dataverse/core/target-registry.js';
import { buildXlsxCopyFixtures, XLSX_MIME } from '../helpers/minimal-xlsx-package.js';
import { verifyPendingBasicFileReadback } from '../../lib/services/test-requests/file-readback-verifier.js';
import { assertLedgerReceipt } from '../../lib/services/test-requests/run-ledger.js';
import { reverifyCopiedItems } from '../../lib/services/test-requests/bundle-file-copy.js';

const guid = (digit) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const registeredSite = { key: 'akoyago-shared', hostname: 'appriver3651007194.sharepoint.com', pathname: '/sites/akoyago' };
const destinationDriveId = `b!${'A'.repeat(22)}`;
const sourceDriveId = destinationDriveId;
const siteId = `appriver3651007194.sharepoint.com,${guid('a')},${guid('b')}`;
const itemId = (letter) => `01${letter.repeat(32)}`;
const now = Date.now();

async function fixture({ packageMode = false, corruptPackage = false } = {}) {
  const bytes = packageMode ? await buildXlsxCopyFixtures() : null;
  const sourceBytes = packageMode ? bytes.source : Buffer.from('pinned request document');
  const destinationBytes = packageMode ? (corruptPackage ? bytes.tampered : bytes.promoted) : sourceBytes;
  const mimeType = packageMode ? XLSX_MIME : 'application/pdf';
  const sourceId = itemId(packageMode ? 'B' : 'A');
  const destinationId = itemId(packageMode ? 'D' : 'C');
  const sourceRow = {
    akoya_requestid: guid('3'), akoya_requestnum: '1003222', akoya_requesttype: 100000000,
    akoya_purpose: 'Test fixture', akoya_request: 1000, versionnumber: 17,
    wmkf_abstract: 'Synthetic fixture abstract',
  };
  const documents = [{
    id: 'proposal', kind: packageMode ? 'projectBudgetSpreadsheet' : 'proposalNarrative',
    library: 'akoya_request', folder: `${expectedRequestFolder('1003222', guid('3'))}/${packageMode ? 'Phase I' : 'AI Materials'}`,
    name: packageMode ? 'Project Budget spreadsheet.xlsx' : 'ProposalNarrative_1003222.pdf',
    driveId: sourceDriveId, graphItemId: sourceId, sharePointSite: registeredSite,
    size: sourceBytes.length, mimeType, eTag: '"source,7"', versionId: '7.0', contentHash: hash(sourceBytes),
  }];
  const bundle = buildSourceBundle({
    sourceRow, documents, dataverseHost: PRODUCTION_HOSTS[0],
    exportedAt: new Date(now - Math.min(BUNDLE_MAX_AGE_MS - 60_000, 60_000)),
    applicantAbstract: 'Synthetic fixture abstract',
  });
  const requestId = guid('1');
  const runId = guid('2');
  const locationId = guid('4');
  const destinationRequestNumber = '9000001';
  const plannedFiles = planBundleFileCopies(bundle, { destinationRequestNumber });
  const createBody = {
    akoya_requestid: requestId,
    wmkf_testcreationrunid: runId,
    akoya_title: 'TEST: verifier fixture',
  };
  const manifest = {
    kind: MANIFEST_V4,
    target: TARGET_URLS.sandbox,
    recipe: 'basic',
    values: { requestId, runId, locationId },
    source: {
      requestId: bundle.source.request.akoya_requestid,
      requestNumber: bundle.source.request.akoya_requestnum,
      requestType: bundle.source.request.akoya_requesttype,
      revision: bundle.source.request.revision,
      dataverseHost: bundle.source.dataverseHost,
      exportedAt: bundle.exportedAt,
      bundleSha256: sha256(bundle),
    },
    bundle,
    copyPolicy: { version: SANDBOX_REHEARSAL_COPY_POLICY.version, digest: copyPolicyDigest() },
    plannedFiles,
    expectedGraphSiteId: siteId,
    expectedGraphDriveId: destinationDriveId,
    expectedAppUserId: guid('5'),
    expectedOrganization: { accountid: guid('6'), name: 'Synthetic' },
    expectedRequestType: { value: 100000000 },
    createBody,
    createBodySha256: sha256(createBody),
    preparedAt: new Date(now - 10 * 60_000).toISOString(),
    expiresAt: new Date(now - 9 * 60_000).toISOString(),
    invariants: {
      exactlyOneCreate: true, retryOnAmbiguousCreate: false, retryOnAmbiguousFileUpload: false,
      expectedSharePointFiles: plannedFiles.length,
    },
  };
  const destinationFolder = `${expectedRequestFolder(destinationRequestNumber, requestId)}/${plannedFiles[0].destination.folder}`;
  const parent = (driveId, path, id) => ({ driveId, id, path: `/drives/${driveId}/root:/${path}` });
  const sourceMetadata = {
    siteId, driveId: sourceDriveId, id: sourceId, name: documents[0].name,
    size: sourceBytes.length, mimeType, eTag: documents[0].eTag, cTag: '"source-content,7"',
    versionId: '7.0', parentReference: parent(sourceDriveId, documents[0].folder, 'source-parent'),
  };
  const destinationMetadata = {
    siteId, driveId: destinationDriveId, id: destinationId, name: plannedFiles[0].destination.filename,
    size: destinationBytes.length, mimeType, eTag: '"destination,3"', cTag: '"destination-content,3"',
    versionId: '3.0', parentReference: parent(destinationDriveId, destinationFolder, 'destination-parent'),
  };
  const pending = {
    resourceId: 17001, step: 'copy_file', resourceKind: 'sharepoint_file', outcome: 'failed',
    plannedIdentity: { index: 0, filename: plannedFiles[0].destination.filename },
    readback: {
      index: 0, filename: plannedFiles[0].destination.filename, folder: destinationFolder,
      library: 'akoya_request', size: sourceBytes.length, contentHash: hash(sourceBytes),
      sourceGraphItemId: sourceId, driveId: destinationDriveId, itemId: destinationId,
      eTag: '"old-receipt,1"', itemSize: sourceBytes.length - (packageMode ? 1 : 0),
      versionId: '1.0', eTagBefore: documents[0].eTag, sourceVersionId: '7.0',
      sourceDriveId: packageMode ? sourceDriveId : documents[0].driveId,
      uploadAttemptedAt: new Date(now - 1000).toISOString(),
      // Deliberately absent: a crash may occur after itemId is persisted but before this in-memory marker is journaled.
      ...(packageMode ? { mimeType } : {}),
    },
  };
  const run = {
    runId, actorId: 'cli:0123456789abcdef', recipe: 'basic', status: 'needs_attention',
    currentStep: 'copy_file', stepIndex: 4, needsAttentionReason: 'file_journal_unverified',
    version: 12, leaseToken: null, leaseGeneration: 3, lockedUntil: null,
    destinationEnvironment: 'sandbox', destinationRequestId: requestId,
    destinationRequestNumber, destinationLocationId: locationId,
    sourceRequestId: manifest.source.requestId, sourceRevision: manifest.source.revision,
    sourceRequestNumber: manifest.source.requestNumber, sourceDataverseHost: manifest.source.dataverseHost,
    bundleSha256: manifest.source.bundleSha256, copyPolicyDigest: manifest.copyPolicy.digest,
    copyPolicyVersion: manifest.copyPolicy.version,
    createBodySha256: manifest.createBodySha256, expectedGraphSiteId: siteId,
    expectedGraphDriveId: destinationDriveId,
  };
  run.planDigest = computeRunPlanDigest({ manifest });
  const request = {
    akoya_requestid: requestId, akoya_requestnum: destinationRequestNumber,
    wmkf_testcreationrunid: runId, wmkf_istestrequest: true,
  };
  const graph = {
    clearGraphCaches: jest.fn(),
    configuredSharePointTarget: jest.fn(() => ({ registered: true, ...registeredSite })),
    getSiteId: jest.fn(async () => siteId),
    getDriveId: jest.fn(async (library) => library === 'akoya_request' ? destinationDriveId : sourceDriveId),
    getFileMetadataByPath: jest.fn(async (library, folder, filename) => {
      if (library === 'akoya_request' && folder === documents[0].folder && filename === documents[0].name) return structuredClone(sourceMetadata);
      if (library === 'akoya_request' && folder === destinationFolder && filename === plannedFiles[0].destination.filename) return structuredClone(destinationMetadata);
      return null;
    }),
    getFileMetadataById: jest.fn(async (driveId, id) => (
      id === sourceId && driveId === sourceDriveId ? structuredClone(sourceMetadata)
        : id === destinationId && driveId === destinationDriveId ? structuredClone(destinationMetadata) : null
    )),
    downloadFile: jest.fn(async (driveId, id) => ({
      buffer: id === sourceId && driveId === sourceDriveId ? sourceBytes
        : id === destinationId && driveId === destinationDriveId ? destinationBytes : null,
      mimeType,
    })),
    listFiles: jest.fn(async () => [{
      id: destinationId, name: plannedFiles[0].destination.filename,
      folder: destinationFolder, size: destinationBytes.length, mimeType,
    }]),
  };
  return {
    run, manifest, bundle, resources: [pending], graph, request, sourceBytes, destinationBytes,
    sourceMetadata, destinationMetadata, destinationFolder, destinationId, sourceId, plannedFiles,
    input: {
      run, resources: [pending], manifest, bundle, graph,
      readRequest: jest.fn(async () => request),
      expectedTarget: { environment: 'sandbox', url: TARGET_URLS.sandbox },
    },
  };
}

test('verifies exact-hash recovery evidence using real Graph path and raw parent-reference contracts', async () => {
  const f = await fixture();
  const result = await verifyPendingBasicFileReadback(f.input);
  expect(result).toMatchObject({ status: 'evidence_matches', evidenceOnly: true, continuationAllowed: false, integrityMode: 'exact_hash' });
  expect(result.proposedReadback).toMatchObject({ itemId: f.destinationId, driveId: destinationDriveId, eTag: f.destinationMetadata.eTag, itemSize: f.destinationBytes.length });
  expect(f.graph.getFileMetadataByPath).toHaveBeenCalledWith('akoya_request', expect.any(String), f.plannedFiles[0].destination.filename, expect.objectContaining({ siteId, driveId: destinationDriveId }));
  expect(f.graph.listFiles).toHaveBeenCalledWith('akoya_request', expect.any(String), expect.objectContaining({ recursive: true, failOnTruncation: true, failOnDepthLimit: true, failOnMalformedResponse: true, failOnUnboundNextLink: true }));
  expect(() => assertLedgerReceipt(result.proposedReadback)).not.toThrow();
  const receipt = result.proposedReadback;
  const entry = {
    index: receipt.index, status: 'verified',
    destination: { filename: receipt.filename, folder: receipt.folder, library: receipt.library },
    source: { size: receipt.size, contentHash: receipt.contentHash, mimeType: null, graphItemId: receipt.sourceGraphItemId },
    destinationDriveId: receipt.driveId, sourceDriveId: receipt.sourceDriveId,
    item: { id: receipt.itemId, eTag: receipt.eTag, versionId: receipt.versionId, size: receipt.itemSize },
  };
  await expect(reverifyCopiedItems([entry], {
    getFileMetadataById: f.graph.getFileMetadataById,
    downloadFile: f.graph.downloadFile,
  })).resolves.toEqual([]);
});

test('package recovery re-attests fresh source bytes and accepts changed pre-attestation destination receipt metadata', async () => {
  const f = await fixture({ packageMode: true });
  const result = await verifyPendingBasicFileReadback(f.input);
  expect(result).toMatchObject({ status: 'evidence_matches', integrityMode: 'package', continuationAllowed: false });
  expect(result.normalizedParts).toEqual(expect.any(Array));
  expect(result.proposedReadback).toMatchObject({ attestedDigest: hash(f.destinationBytes), mimeType: XLSX_MIME, sourceDriveId });
  expect(() => assertLedgerReceipt(result.proposedReadback)).not.toThrow();
  const receipt = result.proposedReadback;
  const entry = {
    index: receipt.index, status: 'verified',
    destination: { filename: receipt.filename, folder: receipt.folder, library: receipt.library },
    source: {
      size: receipt.size, contentHash: receipt.contentHash, mimeType: receipt.mimeType,
      graphItemId: receipt.sourceGraphItemId, eTag: receipt.eTagBefore, versionId: receipt.sourceVersionId,
    },
    destinationDriveId: receipt.driveId, sourceDriveId: receipt.sourceDriveId,
    attestedDigest: receipt.attestedDigest,
    item: { id: receipt.itemId, eTag: receipt.eTag, versionId: receipt.versionId, size: receipt.itemSize },
  };
  await expect(reverifyCopiedItems([entry], {
    getFileMetadataById: f.graph.getFileMetadataById,
    downloadFile: f.graph.downloadFile,
  })).resolves.toEqual([]);
});

test('blocks corrupted package bytes and source ETag drift', async () => {
  const corrupted = await fixture({ packageMode: true, corruptPackage: true });
  expect(await verifyPendingBasicFileReadback(corrupted.input)).toMatchObject({ status: 'blocked', reason: 'integrity_check_failed' });

  const sourceDrift = await fixture();
  sourceDrift.sourceMetadata.eTag = '"source,changed"';
  expect(await verifyPendingBasicFileReadback(sourceDrift.input)).toMatchObject({ status: 'blocked', reason: 'source_metadata_mismatch' });
});

test('blocks a destination metadata change during complete inventory read', async () => {
  const f = await fixture();
  f.graph.listFiles.mockImplementationOnce(async () => {
    f.destinationMetadata.cTag = '"destination-content,changed"';
    return [{ id: f.destinationId, name: f.plannedFiles[0].destination.filename, folder: f.destinationFolder, size: f.destinationBytes.length, mimeType: 'application/pdf' }];
  });
  expect(await verifyPendingBasicFileReadback(f.input)).toMatchObject({ status: 'blocked', reason: 'destination_changed_during_read' });
});

test('accepts a claimed run with a Date-valued database lease timestamp', async () => {
  const f = await fixture();
  const lockedUntil = new Date(Date.now() + 60_000);
  f.run.leaseToken = guid('9');
  f.run.lockedUntil = lockedUntil;
  const result = await verifyPendingBasicFileReadback({
    ...f.input,
    expectedLease: { token: guid('9'), generation: 3, version: 12, lockedUntil: lockedUntil.toISOString() },
  });
  expect(result).toMatchObject({ status: 'evidence_matches', evidenceOnly: true });
});

test('blocks a lease that expires while evidence is being read', async () => {
  const f = await fixture();
  const lockedUntil = new Date(Date.now() + 100);
  f.run.leaseToken = guid('9');
  f.run.lockedUntil = lockedUntil.toISOString();
  f.graph.listFiles.mockImplementationOnce(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return [{ id: f.destinationId, name: f.plannedFiles[0].destination.filename, folder: f.destinationFolder, size: f.destinationBytes.length, mimeType: 'application/pdf' }];
  });
  const result = await verifyPendingBasicFileReadback({
    ...f.input,
    nowMs: Date.now() - 1000,
    expectedLease: { token: guid('9'), generation: 3, version: 12, lockedUntil: lockedUntil.toISOString() },
  });
  expect(result).toMatchObject({ status: 'blocked', reason: 'lease_fence_mismatch' });
});

test.each([
  ['wrong destination run marker', (f) => { f.request.wmkf_testcreationrunid = guid('8'); }, 'destination_request_mismatch'],
  ['source content drift', (f) => { f.graph.downloadFile.mockImplementation(async (driveId, id) => ({ buffer: id === f.sourceId ? Buffer.from('drift') : f.destinationBytes, mimeType: 'application/pdf' })); }, 'source_content_mismatch'],
  ['destination path resolves a different item', (f) => { f.graph.getFileMetadataByPath.mockImplementation(async (library, folder, filename) => {
    if (folder === f.destinationFolder) return { ...f.destinationMetadata, id: 'wrong-item' };
    return f.sourceMetadata;
  }); }, 'destination_identity_mismatch'],
  ['same-count inventory substitutes a different item ID', (f) => { f.graph.listFiles.mockResolvedValueOnce([{ id: itemId('E'), name: f.plannedFiles[0].destination.filename, folder: f.destinationFolder, size: f.destinationBytes.length, mimeType: 'application/pdf' }]); }, 'destination_inventory_mismatch'],
  ['unknown destination file appears in complete inventory', (f) => { f.graph.listFiles.mockResolvedValueOnce([{ id: f.destinationId, name: f.plannedFiles[0].destination.filename, folder: f.destinationFolder }, { id: 'extra', name: 'other.pdf', folder: f.destinationFolder }]); }, 'destination_inventory_mismatch'],
])('fails closed for %s', async (_label, change, expectedReason) => {
  const f = await fixture();
  change(f);
  const result = await verifyPendingBasicFileReadback(f.input);
  expect(result).toMatchObject({ status: 'blocked', reason: expectedReason, evidenceOnly: true, continuationAllowed: false });
});

test('blocks expired bundle, live lease and incomplete lease fence before recovery evidence', async () => {
  const stale = await fixture();
  stale.bundle.exportedAt = new Date(Date.now() - BUNDLE_MAX_AGE_MS - 10_000).toISOString();
  stale.manifest.bundle = stale.bundle;
  stale.manifest.source.bundleSha256 = sha256(stale.bundle);
  stale.run.bundleSha256 = stale.manifest.source.bundleSha256;
  stale.run.planDigest = computeRunPlanDigest({ manifest: stale.manifest });
  expect(await verifyPendingBasicFileReadback(stale.input)).toMatchObject({ status: 'blocked', reason: 'bundle_not_fresh' });

  const live = await fixture();
  live.run.leaseToken = guid('9');
  live.run.lockedUntil = new Date(Date.now() + 60_000).toISOString();
  expect(await verifyPendingBasicFileReadback(live.input)).toMatchObject({ status: 'blocked', reason: 'lease_live' });

  const mismatchedFence = await fixture();
  mismatchedFence.run.leaseToken = guid('9');
  mismatchedFence.run.lockedUntil = new Date(Date.now() + 60_000).toISOString();
  expect(await verifyPendingBasicFileReadback({ ...mismatchedFence.input, expectedLease: { token: guid('8'), generation: 3, version: 12 } }))
    .toMatchObject({ status: 'blocked', reason: 'lease_fence_mismatch' });
});
