/** @jest-environment node */
/**
 * Offline feasibility proof for a possible Factory file readback verifier.
 * This is a test-only composition of current integrity primitives, not a
 * reusable production verifier or a receipt writer. Its normalized
 * site/drive/parent fields are hypothetical reader-fixture shapes, not proof
 * the real Graph adapter supplies them. All reads are deterministic
 * in-memory fixtures; no live service or retained run is contacted. A
 * positive result means evidence may be reviewed, never that resume is
 * allowed or the run is ready.
 */
import crypto from 'node:crypto';
import {
  MANIFEST_V4,
  bundleSourceOf,
  computeRunPlanDigest,
  sha256,
  validateCloneManifest,
} from '../../lib/services/test-requests/basic-clone-steps.js';
import { buildSourceBundle } from '../../lib/services/test-requests/source-bundle.js';
import {
  BUNDLE_MAX_AGE_MS,
  SANDBOX_REHEARSAL_COPY_POLICY,
  copyPolicyDigest,
  planBundleFileCopies,
  usesPackageIntegrity,
} from '../../lib/services/test-requests/bundle-file-copy.js';
import { attestDocxPackageAgainstSource as attestPackage } from '../../lib/services/test-requests/docx-package-attestation.js';
import { XLSX_MIME, buildMinimalXlsx, buildXlsxCopyFixtures, customProperty, customPropertiesXml } from '../helpers/minimal-xlsx-package.js';
import { PRODUCTION_HOSTS } from '../../lib/dataverse/core/target-registry.js';
import { expectedRequestFolder } from '../../lib/services/test-requests/sandbox-clone.js';

const GUID = (digit) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const SITE = { key: 'akoyago-shared', hostname: 'appriver3651007194.sharepoint.com', pathname: '/sites/akoyago' };
const DEST_NUMBER = '9000001';
const DEST_FOLDER = `${DEST_NUMBER}_${GUID('1').replace(/-/g, '').toUpperCase()}`;
const PDF_MIME = 'application/pdf';
const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function makeDocument({ id, kind, name, folder, mimeType, bytes, graphItemId, eTag, versionId }) {
  return {
    id, kind, library: 'akoya_request', folder, name, driveId: 'bundle-snapshot-drive', graphItemId,
    sharePointSite: SITE, size: bytes.length, mimeType, eTag, versionId, contentHash: hash(bytes),
  };
}

async function makeFixture() {
  const xlsx = await buildXlsxCopyFixtures();
  const pdfBytes = Buffer.from('synthetic pinned PDF source');
  const documents = [
    makeDocument({
      id: 'inv-pdf', kind: 'proposalNarrative', name: 'ProposalNarrative_1003222.pdf',
      folder: '1003222_AAAAAAAA/AI Materials', mimeType: PDF_MIME, bytes: pdfBytes,
      graphItemId: 'src-pdf', eTag: '"pdf-source,1"', versionId: '1.0',
    }),
    makeDocument({
      id: 'inv-xlsx', kind: 'projectBudgetSpreadsheet', name: 'Project Budget spreadsheet.xlsx',
      folder: '1003222_AAAAAAAA/Phase I', mimeType: XLSX_MIME, bytes: xlsx.source,
      graphItemId: 'src-xlsx', eTag: '"xlsx-source,1"', versionId: '2.0',
    }),
  ];
  const exportedAt = new Date(Date.now() - BUNDLE_MAX_AGE_MS - 60_000);
  const bundle = buildSourceBundle({
    sourceRow: {
      akoya_requestid: GUID('3'), akoya_requestnum: '1003222', akoya_requesttype: 100000000,
      akoya_purpose: 'Synthetic fixture', akoya_request: 5000, versionnumber: 17, wmkf_abstract: 'Fixture abstract',
    },
    documents, dataverseHost: PRODUCTION_HOSTS[0], exportedAt, applicantAbstract: 'Fixture abstract',
  });
  const requestId = GUID('1');
  const runId = GUID('2');
  const locationId = GUID('4');
  const plannedFiles = planBundleFileCopies(bundle, { destinationRequestNumber: DEST_NUMBER });
  const createBody = {
    akoya_requestid: requestId, wmkf_testcreationrunid: runId, akoya_title: 'TEST: verifier fixture',
  };
  const manifest = {
    kind: MANIFEST_V4,
    target: 'https://orgd9e66399.crm.dynamics.com',
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
    expectedGraphSiteId: 'site-registered',
    expectedGraphDriveId: 'drive-request',
    expectedAppUserId: GUID('5'),
    expectedOrganization: { accountid: GUID('6'), name: 'Synthetic' },
    expectedRequestType: { value: 100000000 },
    createBody,
    createBodySha256: sha256(createBody),
    preparedAt: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    invariants: {
      exactlyOneCreate: true, retryOnAmbiguousCreate: false, retryOnAmbiguousFileUpload: false,
      expectedSharePointFiles: plannedFiles.length,
    },
  };
  const run = {
    runId, recipe: 'basic', status: 'needs_attention', currentStep: 'copy_file', currentStepIndex: 4,
    version: 12, leaseToken: null, leaseGeneration: 3, lockedUntil: null,
    destinationRequestId: requestId, destinationRequestNumber: DEST_NUMBER, destinationLocationId: locationId,
    sourceRequestId: manifest.source.requestId, sourceRevision: manifest.source.revision,
    bundleSha256: manifest.source.bundleSha256, copyPolicyDigest: manifest.copyPolicy.digest,
    createBodySha256: manifest.createBodySha256,
    planDigest: computeRunPlanDigest({ manifest }),
  };
  return { bundle, manifest, run, documents, plannedFiles, pdfBytes, xlsx, requestFolder: DEST_FOLDER };
}

function receiptFor(fixture, index, destinationId, destinationBytes, { attestedDigest } = {}) {
  const file = fixture.plannedFiles[index];
  const source = file.source;
  const folder = `${fixture.requestFolder}/${file.destination.folder}`;
  const destination = {
    id: destinationId, name: file.destination.filename, size: destinationBytes.length,
    eTag: `"dest-${index},1"`, cTag: `"dest-${index}-content,1"`, versionId: '1.0',
    siteId: 'site-registered', driveId: 'drive-request', parentPath: folder,
  };
  const resource = {
    step: 'copy_file', resourceKind: 'sharepoint_file', outcome: 'failed', dispatchedAt: new Date().toISOString(),
    plannedIdentity: { index, filename: file.destination.filename },
    readback: {
      index, filename: file.destination.filename, folder, library: 'akoya_request',
      size: source.size, contentHash: source.contentHash, sourceGraphItemId: source.graphItemId,
      driveId: 'drive-request', sourceDriveId: source.mimeType === XLSX_MIME ? 'drive-request' : source.driveId, itemId: destinationId,
      eTag: destination.eTag, versionId: destination.versionId, itemSize: destination.size,
      eTagBefore: source.eTag, sourceVersionId: source.versionId,
      ...(source.mimeType === XLSX_MIME ? { mimeType: source.mimeType } : {}),
      ...(attestedDigest ? { attestedDigest } : {}),
    },
  };
  return { resource, destination, folder };
}

// Test-only fixture composition. It deliberately has no ledger dependency or
// write method, and its returned disposition can never authorize continuation.
async function proveFixtureReadback(fixture, index, { resource, destination, folder, overrides = {} }) {
  const now = Date.now();
  const rows = overrides.resources ?? [
    ...Array.from({ length: index }, (_, previousIndex) => ({
      step: 'copy_file', resourceKind: 'sharepoint_file', outcome: 'verified',
      plannedIdentity: { index: previousIndex }, readback: { index: previousIndex },
    })),
    resource,
  ];
  if (fixture.run.status !== 'needs_attention' || fixture.run.currentStep !== 'copy_file' || fixture.run.recipe !== 'basic') {
    throw new Error('Run is outside the Basic copy-file recovery candidate.');
  }
  if (!Number.isInteger(fixture.run.version) || fixture.run.leaseToken || (fixture.run.lockedUntil && Date.parse(fixture.run.lockedUntil) > now)) {
    throw new Error('Run lease or version state is not safe for readback inspection.');
  }
  if (rows.some((row) => row.step !== 'copy_file' || row.resourceKind !== 'sharepoint_file' || !Number.isInteger(row.plannedIdentity?.index))) {
    throw new Error('Malformed or foreign resource evidence is present.');
  }
  const indexCounts = new Map();
  for (const row of rows) indexCounts.set(row.plannedIdentity.index, (indexCounts.get(row.plannedIdentity.index) || 0) + 1);
  if ([...indexCounts.values()].some((count) => count !== 1)) throw new Error('Duplicate planned file index evidence.');
  const verified = rows.filter((row) => row.outcome === 'verified');
  const pendingIndex = verified.length;
  if (pendingIndex !== index || indexCounts.get(index) !== 1 || rows.some((row) => row.plannedIdentity.index > index)) {
    throw new Error('Current pending file index is ambiguous.');
  }
  const pending = rows.find((row) => row.plannedIdentity.index === index);
  if (pending !== resource || !resource.readback?.itemId) throw new Error('Pending row has no exact journaled item identity.');

  validateCloneManifest(fixture.manifest, { allowExpired: true });
  const { bundle } = bundleSourceOf(fixture.manifest, { allowStale: true });
  const manifest = fixture.manifest;
  const run = fixture.run;
  if (manifest.kind !== MANIFEST_V4 || manifest.recipe !== run.recipe
      || manifest.values.runId !== run.runId || manifest.values.requestId !== run.destinationRequestId
      || manifest.values.locationId !== run.destinationLocationId
      || manifest.source.requestId !== run.sourceRequestId || manifest.source.revision !== run.sourceRevision
      || manifest.source.bundleSha256 !== run.bundleSha256 || sha256(bundle) !== run.bundleSha256
      || manifest.copyPolicy.digest !== run.copyPolicyDigest || manifest.createBodySha256 !== run.createBodySha256) {
    throw new Error('Manifest, source bundle, policy, or reserved run pins disagree.');
  }
  if (computeRunPlanDigest({ manifest }) !== run.planDigest) throw new Error('Reserved run plan digest does not match manifest.');
  const file = planBundleFileCopies(bundle, { destinationRequestNumber: run.destinationRequestNumber })[index];
  const expectedFolder = `${expectedRequestFolder(run.destinationRequestNumber, run.destinationRequestId)}/${file?.destination?.folder ?? ''}`;
  if (!file || file.source.graphItemId !== resource.readback.sourceGraphItemId
      || file.source.contentHash !== resource.readback.contentHash
      || file.source.eTag !== resource.readback.eTagBefore
      || file.source.versionId !== resource.readback.sourceVersionId
      || resource.readback.filename !== file.destination.filename
      || resource.readback.folder !== expectedFolder || folder !== expectedFolder
      || resource.readback.library !== file.destination.library
      || resource.readback.driveId !== runDestinationDriveId) {
    throw new Error('Receipt source or exact destination provenance differs from the pinned file plan.');
  }
  const { deps } = overrides;
  if (!deps) throw new Error('Readback fixture dependencies are missing.');
  const exportedAt = Date.parse(bundle.exportedAt);
  if (!Number.isFinite(exportedAt) || exportedAt > now + 5 * 60 * 1000) throw new Error('Source bundle export time is invalid or future-dated.');
  deps.clearGraphCaches();
  const target = deps.configuredSharePointTarget();
  if (JSON.stringify(target) !== JSON.stringify(SITE)) throw new Error('Registered SharePoint site identity changed.');
  const siteId = await deps.getSiteId();
  const sourceDriveId = await deps.getDriveId(file.source.library, siteId);
  const destinationDriveId = await deps.getDriveId('akoya_request', siteId);
  const expectedJournalSourceDrive = usesPackageIntegrity(file.source.mimeType) ? sourceDriveId : file.source.driveId;
  if (siteId !== manifest.expectedGraphSiteId || destinationDriveId !== manifest.expectedGraphDriveId
      || resource.readback.sourceDriveId !== expectedJournalSourceDrive) {
    throw new Error('Resolved SharePoint site or drive identity differs from the reserved manifest.');
  }
  const sourceBefore = await deps.getFileMetadataById(sourceDriveId, file.source.graphItemId);
  const expectedSource = file.source;
  if (!sourceBefore || sourceBefore.id !== expectedSource.graphItemId || sourceBefore.name !== expectedSource.name
      || sourceBefore.size !== expectedSource.size || sourceBefore.mimeType !== expectedSource.mimeType
      || sourceBefore.eTag !== expectedSource.eTag || sourceBefore.versionId !== expectedSource.versionId) {
    throw new Error('Fresh source metadata differs from the pinned bundle.');
  }
  const freshSourceDownload = await deps.downloadFile(sourceDriveId, file.source.graphItemId);
  if (!Buffer.isBuffer(freshSourceDownload?.buffer)
      || hash(freshSourceDownload.buffer) !== expectedSource.contentHash
      || freshSourceDownload.buffer.length !== expectedSource.size) {
    throw new Error('Fresh source bytes differ from the pinned bundle hash.');
  }
  const folderListing = await deps.listDestinationFolder(folder);
  if (!Array.isArray(folderListing) || folderListing.filter((item) => item.name === file.destination.filename).length !== 1) {
    throw new Error('Destination listing is missing or duplicates the planned filename.');
  }
  const listed = folderListing.find((item) => item.name === file.destination.filename);
  if (listed.id !== resource.readback.itemId || listed.folder !== expectedFolder || listed.parentPath !== expectedFolder
      || listed.siteId !== siteId || listed.driveId !== destinationDriveId) {
    throw new Error('Destination listing does not identify the exact item in the expected site, drive, parent and path.');
  }
  const before = await deps.getFileMetadataById(destinationDriveId, resource.readback.itemId);
  if (!before || before.id !== destination.id || before.name !== file.destination.filename
      || before.parentPath !== expectedFolder || before.siteId !== siteId || before.driveId !== destinationDriveId
      || before.size !== resource.readback.itemSize || before.eTag !== resource.readback.eTag
      || before.versionId !== resource.readback.versionId) {
    throw new Error('Destination exact-ID metadata does not match the expected target.');
  }
  const destinationDownload = await deps.downloadFile(destinationDriveId, resource.readback.itemId);
  if (!Buffer.isBuffer(destinationDownload?.buffer)) throw new Error('Destination bytes could not be read.');
  let attestedParts = [];
  if (file.source.mimeType === XLSX_MIME) {
    ({ normalizedParts: attestedParts } = await attestPackage(destinationDownload.buffer, freshSourceDownload.buffer));
  } else if (hash(destinationDownload.buffer) !== expectedSource.contentHash) {
    throw new Error('Exact-hash destination differs from the pinned source.');
  }
  const destinationDigest = hash(destinationDownload.buffer);
  if (resource.readback.attestedDigest && resource.readback.attestedDigest !== destinationDigest) {
    throw new Error('Observed package digest differs from its journaled attested digest.');
  }
  const after = await deps.getFileMetadataById(destinationDriveId, resource.readback.itemId);
  const identity = (item) => [item.id, item.name, item.size, item.eTag, item.cTag, item.versionId, item.parentPath, item.siteId, item.driveId].join('\u0000');
  if (identity(before) !== identity(after)) throw new Error('Destination metadata changed during readback.');
  const sourceAfter = await deps.getFileMetadataById(sourceDriveId, file.source.graphItemId);
  if ([sourceBefore.id, sourceBefore.name, sourceBefore.size, sourceBefore.mimeType, sourceBefore.eTag, sourceBefore.versionId].join('\u0000')
      !== [sourceAfter?.id, sourceAfter?.name, sourceAfter?.size, sourceAfter?.mimeType, sourceAfter?.eTag, sourceAfter?.versionId].join('\u0000')) {
    throw new Error('Source metadata changed during readback.');
  }
  return {
    evidenceOnly: true, resumeAllowed: false, ready: false, writeAllowed: false,
    fencingProven: false, destinationDigest, attestedParts, bundleStale: true,
  };
}

const runDestinationDriveId = 'drive-request';

function makeReadDeps(sourceDoc, destination, folder, sourceBytes, destinationBytes, overrides = {}) {
  let target = SITE;
  let readCount = 0;
  const deps = {
    clearGraphCaches: jest.fn(),
    configuredSharePointTarget: jest.fn(() => target),
    getSiteId: jest.fn(async () => 'site-registered'),
    getDriveId: jest.fn(async (library) => library === 'akoya_request' ? 'drive-request' : 'drive-archive'),
    getFileMetadataById: jest.fn(async (driveId, itemId) => {
      if (itemId === sourceDoc.graphItemId && driveId === 'drive-request') {
        return { id: sourceDoc.graphItemId, name: sourceDoc.name, size: sourceDoc.size, mimeType: sourceDoc.mimeType, eTag: sourceDoc.eTag, versionId: sourceDoc.versionId };
      }
      if (itemId === destination.id && driveId === 'drive-request') {
        readCount += 1;
        if (overrides.changeCtagDuringRead && readCount > 1) return { ...destination, cTag: '"changed"' };
        return destination;
      }
      return null;
    }),
    listDestinationFolder: jest.fn(async () => overrides.listing ?? [{
      id: destination.id, name: destination.name, size: destination.size, folder, parentPath: folder,
      siteId: destination.siteId, driveId: destination.driveId,
    }]),
    downloadFile: jest.fn(async (driveId, itemId) => {
      if (driveId === 'drive-request' && itemId === sourceDoc.graphItemId) return { buffer: sourceBytes };
      if (driveId === 'drive-request' && itemId === destination.id) return { buffer: destinationBytes };
      throw new Error('unexpected fixture read');
    }),
  };
  if (overrides.target) target = overrides.target;
  return { ...deps, ...overrides.deps };
}

describe('offline file readback recovery feasibility proof (test-only)', () => {
  test.each(['PDF exact hash', 'XLSX package attestation'])('verifies a stale-bundle candidate with %s as evidence only', async (kind) => {
    const fixture = await makeFixture();
    const index = kind.startsWith('PDF') ? 0 : 1;
    const file = fixture.plannedFiles[index];
    const sourceBytes = index === 0 ? fixture.pdfBytes : fixture.xlsx.source;
    const destinationBytes = index === 0 ? sourceBytes : fixture.xlsx.promoted;
    const receipt = receiptFor(fixture, index, `dest-${index}`, destinationBytes);
    const deps = makeReadDeps(file.source, receipt.destination, receipt.folder, sourceBytes, destinationBytes);

    const proof = await proveFixtureReadback(fixture, index, { ...receipt, sourceBytes, destinationBytes, overrides: { deps } });

    expect(proof).toMatchObject({ evidenceOnly: true, resumeAllowed: false, ready: false, writeAllowed: false, fencingProven: false, bundleStale: true });
    expect(proof.destinationDigest).toBe(hash(destinationBytes));
    expect(deps.clearGraphCaches).toHaveBeenCalledTimes(1);
    expect(deps.downloadFile).toHaveBeenCalledTimes(2); // source and destination are both fresh fixture reads
    if (index === 1) expect(proof.attestedParts.length).toBeGreaterThan(0);
    else expect(proof.attestedParts).toEqual([]);
  });

  test('rejects PDF destination bytes that do not match the bundle exact hash', async () => {
    const fixture = await makeFixture();
    const file = fixture.plannedFiles[0];
    const changedDestination = Buffer.from('different synthetic PDF bytes');
    const receipt = receiptFor(fixture, 0, 'dest-pdf', changedDestination);
    const deps = makeReadDeps(file.source, receipt.destination, receipt.folder, fixture.pdfBytes, changedDestination);
    await expect(proveFixtureReadback(fixture, 0, { ...receipt, overrides: { deps } }))
      .rejects.toThrow(/Exact-hash destination differs/);
  });

  test('rejects package part drift and a mismatching stored attested digest', async () => {
    const fixture = await makeFixture();
    const file = fixture.plannedFiles[1];
    const receipt = receiptFor(fixture, 1, 'dest-xlsx', fixture.xlsx.tampered);
    const deps = makeReadDeps(file.source, receipt.destination, receipt.folder, fixture.xlsx.source, fixture.xlsx.tampered);
    await expect(proveFixtureReadback(fixture, 1, { ...receipt, sourceBytes: fixture.xlsx.source, destinationBytes: fixture.xlsx.tampered, overrides: { deps } }))
      .rejects.toThrow(/Package .* differs from the source/);

    const good = receiptFor(fixture, 1, 'dest-xlsx', fixture.xlsx.promoted, { attestedDigest: hash(fixture.xlsx.source) });
    const goodDeps = makeReadDeps(file.source, good.destination, good.folder, fixture.xlsx.source, fixture.xlsx.promoted);
    await expect(proveFixtureReadback(fixture, 1, { ...good, sourceBytes: fixture.xlsx.source, destinationBytes: fixture.xlsx.promoted, overrides: { deps: goodDeps } }))
      .rejects.toThrow(/journaled attested digest/);
  });

  test('documents why reconcileJournaledCopies alone is insufficient: it can attest against source bytes that drifted from the bundle hash', async () => {
    const fixture = await makeFixture();
    const original = fixture.xlsx.source;
    const customSource = customPropertiesXml(customProperty('ContentTypeId', 2, '0x0101'));
    const customPromoted = customPropertiesXml(customProperty('ContentTypeId', 2, '0x0101'), customProperty('TaxKeyword', 3, 'sample'));
    const changedSheet = '<worksheet><sheetData><row r="1"/></sheetData></worksheet>';
    const driftedSource = await buildMinimalXlsx({ custom: customSource, sheet: changedSheet });
    const driftedDestination = await buildMinimalXlsx({ custom: customPromoted, sheet: changedSheet });
    const entry = {
      index: 1, status: 'failed', outcome: 'failed',
      destination: { filename: fixture.plannedFiles[1].destination.filename, folder: `${DEST_FOLDER}/Phase I` },
      source: {
        mimeType: XLSX_MIME, graphItemId: 'src-xlsx', contentHash: hash(original),
      },
      sourceDriveId: 'drive-request', destinationDriveId: 'drive-request',
      item: { id: 'dest-xlsx' },
    };
    const deps = {
      getFileMetadataById: jest.fn(async () => ({ id: 'dest-xlsx', name: entry.destination.filename, size: driftedDestination.length })),
      downloadFile: jest.fn(async (_drive, id) => ({ buffer: id === 'src-xlsx' ? driftedSource : driftedDestination })),
    };
    const report = await (await import('../../lib/services/test-requests/bundle-file-copy.js')).reconcileJournaledCopies([entry], deps);

    expect(hash(driftedSource)).not.toBe(entry.source.contentHash);
    expect(report[0]).toMatchObject({ exists: true, hashMatches: true });
  });

  test.each([
    ['wrong site', { target: { ...SITE, key: 'other-site' } }, /registered SharePoint site/i],
    ['changed cTag during readback', { changeCtagDuringRead: true }, /metadata changed during readback/],
  ])('fails closed on %s', async (_label, overrides, error) => {
    const fixture = await makeFixture();
    const file = fixture.plannedFiles[0];
    const receipt = receiptFor(fixture, 0, 'dest-pdf', fixture.pdfBytes);
    const deps = makeReadDeps(file.source, receipt.destination, receipt.folder, fixture.pdfBytes, fixture.pdfBytes, overrides);
    await expect(proveFixtureReadback(fixture, 0, { ...receipt, sourceBytes: fixture.pdfBytes, destinationBytes: fixture.pdfBytes, overrides: { deps } }))
      .rejects.toThrow(error);
  });

  test('rejects duplicate path matches using the actual destination filename', async () => {
    const fixture = await makeFixture();
    const file = fixture.plannedFiles[0];
    const receipt = receiptFor(fixture, 0, 'dest-pdf', fixture.pdfBytes);
    const listed = {
      id: receipt.destination.id, name: file.destination.filename, size: receipt.destination.size,
      folder: receipt.folder, parentPath: receipt.folder, siteId: 'site-registered', driveId: 'drive-request',
    };
    const deps = makeReadDeps(file.source, receipt.destination, receipt.folder, fixture.pdfBytes, fixture.pdfBytes, {
      listing: [listed, { ...listed, id: 'duplicate-destination-id' }],
    });
    await expect(proveFixtureReadback(fixture, 0, { ...receipt, overrides: { deps } }))
      .rejects.toThrow('Destination listing is missing or duplicates the planned filename.');
  });

  test('blocks source drift, foreign drive, path/parent mismatch, duplicate index and active lease', async () => {
    const fixture = await makeFixture();
    const file = fixture.plannedFiles[0];
    const receipt = receiptFor(fixture, 0, 'dest-pdf', fixture.pdfBytes);
    const sourceDriftDeps = makeReadDeps(file.source, receipt.destination, receipt.folder, Buffer.from('drift'), fixture.pdfBytes);
    await expect(proveFixtureReadback(fixture, 0, { ...receipt, sourceBytes: Buffer.from('drift'), destinationBytes: fixture.pdfBytes, overrides: { deps: sourceDriftDeps } }))
      .rejects.toThrow(/Fresh source bytes differ/);

    for (const [alter, message] of [
      [(copy) => { copy.resource.readback.driveId = 'foreign-drive'; }, 'Receipt source or exact destination provenance differs from the pinned file plan.'],
      [(copy) => { copy.resource.readback.folder = `${copy.folder}/wrong-parent`; }, 'Receipt source or exact destination provenance differs from the pinned file plan.'],
      [(copy) => { copy.resource.readback.itemId = 'different-guid'; }, 'Destination listing does not identify the exact item in the expected site, drive, parent and path.'],
    ]) {
      const changed = receiptFor(fixture, 0, 'dest-pdf', fixture.pdfBytes);
      alter(changed);
      const deps = makeReadDeps(file.source, changed.destination, changed.folder, fixture.pdfBytes, fixture.pdfBytes);
      await expect(proveFixtureReadback(fixture, 0, { ...changed, sourceBytes: fixture.pdfBytes, destinationBytes: fixture.pdfBytes, overrides: { deps } }))
        .rejects.toThrow(message);
    }

    const duplicate = receiptFor(fixture, 0, 'dest-pdf', fixture.pdfBytes);
    const duplicateDeps = makeReadDeps(file.source, duplicate.destination, duplicate.folder, fixture.pdfBytes, fixture.pdfBytes);
    await expect(proveFixtureReadback(fixture, 0, {
      ...duplicate, sourceBytes: fixture.pdfBytes, destinationBytes: fixture.pdfBytes,
      overrides: { deps: duplicateDeps, resources: [duplicate.resource, duplicate.resource] },
    })).rejects.toThrow(/Duplicate planned file index/);

    fixture.run.lockedUntil = new Date(Date.now() + 60_000).toISOString();
    const leaseDeps = makeReadDeps(file.source, receipt.destination, receipt.folder, fixture.pdfBytes, fixture.pdfBytes);
    await expect(proveFixtureReadback(fixture, 0, { ...receipt, sourceBytes: fixture.pdfBytes, destinationBytes: fixture.pdfBytes, overrides: { deps: leaseDeps } }))
      .rejects.toThrow(/lease or version state/);
    expect(leaseDeps.clearGraphCaches).not.toHaveBeenCalled();
  });

  test('rejects run plan digest drift and pending-index ambiguity at their specific guards', async () => {
    const fixture = await makeFixture();
    const file = fixture.plannedFiles[0];
    const receipt = receiptFor(fixture, 0, 'dest-pdf', fixture.pdfBytes);
    const changedRun = { ...fixture, run: { ...fixture.run, planDigest: 'f'.repeat(64) } };
    const digestDeps = makeReadDeps(file.source, receipt.destination, receipt.folder, fixture.pdfBytes, fixture.pdfBytes);
    await expect(proveFixtureReadback(changedRun, 0, { ...receipt, overrides: { deps: digestDeps } }))
      .rejects.toThrow('Reserved run plan digest does not match manifest.');
    expect(digestDeps.clearGraphCaches).not.toHaveBeenCalled();

    const indexDeps = makeReadDeps(file.source, receipt.destination, receipt.folder, fixture.pdfBytes, fixture.pdfBytes);
    await expect(proveFixtureReadback(fixture, 0, {
      ...receipt,
      overrides: { deps: indexDeps, resources: [{ ...receipt.resource, plannedIdentity: { index: 1 } }] },
    })).rejects.toThrow('Current pending file index is ambiguous.');
    expect(indexDeps.clearGraphCaches).not.toHaveBeenCalled();
  });

  test('rejects source-bundle, policy and manifest digest drift before SharePoint reads', async () => {
    const fixture = await makeFixture();
    const file = fixture.plannedFiles[0];
    const receipt = receiptFor(fixture, 0, 'dest-pdf', fixture.pdfBytes);
    const mutations = [
      [(copy) => { copy.manifest.source.bundleSha256 = 'f'.repeat(64); }, /Embedded source bundle hash mismatch/],
      [(copy) => { copy.manifest.copyPolicy.digest = 'e'.repeat(64); }, /current sandbox rehearsal copy policy/],
      [(copy) => { copy.manifest.source.revision = 'other-revision'; }, /Embedded source bundle does not match the manifest source/],
    ];
    for (const [mutate, expectedError] of mutations) {
      const copy = await makeFixture();
      mutate(copy);
      const deps = makeReadDeps(file.source, receipt.destination, receipt.folder, copy.pdfBytes, copy.pdfBytes);
      await expect(proveFixtureReadback(copy, 0, { ...receipt, sourceBytes: copy.pdfBytes, destinationBytes: copy.pdfBytes, overrides: { deps } }))
        .rejects.toThrow(expectedError);
      expect(deps.clearGraphCaches).not.toHaveBeenCalled();
    }
  });

  test('stale input is accepted only by explicit integrity mode; invalid/future evidence is blocked', async () => {
    const fixture = await makeFixture();
    expect(() => validateCloneManifest(fixture.manifest)).toThrow(/older than/);
    expect(() => bundleSourceOf({ ...fixture.manifest, bundle: { ...fixture.bundle, exportedAt: 'bad' } }, { allowStale: true }))
      .toThrow(/export time is invalid/);
    const futureBundle = { ...fixture.bundle, exportedAt: new Date(Date.now() + 10 * 60_000).toISOString() };
    const futureManifest = { ...fixture.manifest, bundle: futureBundle, source: { ...fixture.manifest.source, bundleSha256: sha256(futureBundle) } };
    const futureFixture = {
      ...fixture,
      bundle: futureBundle,
      manifest: futureManifest,
      run: { ...fixture.run, bundleSha256: futureManifest.source.bundleSha256 },
    };
    futureFixture.run.planDigest = computeRunPlanDigest({ manifest: futureManifest });
    const file = futureFixture.plannedFiles[0];
    const receipt = receiptFor(futureFixture, 0, 'dest-pdf', futureFixture.pdfBytes);
    const deps = makeReadDeps(file.source, receipt.destination, receipt.folder, futureFixture.pdfBytes, futureFixture.pdfBytes);
    await expect(proveFixtureReadback(futureFixture, 0, { ...receipt, sourceBytes: futureFixture.pdfBytes, destinationBytes: futureFixture.pdfBytes, overrides: { deps } }))
      .rejects.toThrow(/future-dated/);
    expect(deps.clearGraphCaches).not.toHaveBeenCalled();
  });

  test('retained proof is non-authoritative: no ledger writer exists and expiry never means resume', async () => {
    const fixture = await makeFixture();
    const file = fixture.plannedFiles[0];
    const receipt = receiptFor(fixture, 0, 'dest-pdf', fixture.pdfBytes);
    const deps = makeReadDeps(file.source, receipt.destination, receipt.folder, fixture.pdfBytes, fixture.pdfBytes);
    const proof = await proveFixtureReadback(fixture, 0, { ...receipt, sourceBytes: fixture.pdfBytes, destinationBytes: fixture.pdfBytes, overrides: { deps } });
    expect(Object.keys(proof).sort()).toEqual(['attestedParts', 'bundleStale', 'destinationDigest', 'evidenceOnly', 'fencingProven', 'ready', 'resumeAllowed', 'writeAllowed']);
    expect(proof.resumeAllowed).toBe(false);
  });
});
