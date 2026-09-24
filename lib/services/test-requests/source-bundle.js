/**
 * Test Request source bundle (design decision 6, option A).
 *
 * A read-only production step exports what the factory needs from one source
 * Grant Request into a private local JSON bundle; a later sandbox step builds
 * the new request from that bundle. The schema helpers are pure. The exported
 * orchestration function performs injected reads, but owns no Dataverse,
 * Graph, or filesystem client and never writes the bundle.
 *
 * The bundle carries source text (purpose), so callers write it only to a
 * private absolute path and never log it; `summarizeSourceBundle` returns the
 * printable subset. Files are referenced, not embedded: SharePoint is the same
 * akoyaGO site in production and the sandbox, so later copy steps re-verify
 * each item's eTag and SHA-256 before copying.
 */

import { projectCloneSource } from './sandbox-clone.js';

export const SOURCE_BUNDLE_KIND = 'test-request-source-bundle';
export const SOURCE_BUNDLE_VERSION = 2;

const SHA256 = /^[0-9a-f]{64}$/;
const DOCUMENT_KINDS = new Set([
  'projectDescription',
  'biosketches',
  'projectBudget',
  'projectBudgetSpreadsheet',
  'reviewerProposal',
  'proposalNarrative',
  'proposalBibliography',
]);
const DOCUMENT_FIELDS = [
  'id', 'kind', 'library', 'folder', 'name', 'driveId', 'graphItemId', 'sharePointSite',
  'size', 'mimeType', 'eTag', 'versionId', 'contentHash',
];

function nonEmptyString(value, max = 1000) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function projectSharePointSite(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!nonEmptyString(value.key, 100)
      || !nonEmptyString(value.hostname, 255)
      || !nonEmptyString(value.pathname, 1000)
      || !value.pathname.startsWith('/')) return null;
  return {
    key: value.key,
    hostname: value.hostname.toLowerCase(),
    pathname: value.pathname.toLowerCase(),
  };
}

function projectDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Source bundle document is invalid.');
  }
  const failures = [];
  if (!nonEmptyString(document.id, 2000)) failures.push('id');
  if (!DOCUMENT_KINDS.has(document.kind)) failures.push('kind');
  for (const field of ['library', 'folder', 'name', 'driveId', 'graphItemId', 'mimeType', 'eTag']) {
    if (!nonEmptyString(document[field])) failures.push(field);
  }
  const sharePointSite = projectSharePointSite(document.sharePointSite);
  if (!sharePointSite) failures.push('sharePointSite');
  if (!Number.isSafeInteger(document.size) || document.size < 0) failures.push('size');
  if (document.versionId != null && !nonEmptyString(document.versionId)) failures.push('versionId');
  if (typeof document.contentHash !== 'string' || !SHA256.test(document.contentHash)) failures.push('contentHash');
  if (failures.length) throw new Error(`Source bundle document is invalid (${failures.join(', ')}).`);
  return Object.fromEntries(DOCUMENT_FIELDS.map((field) => [
    field,
    field === 'sharePointSite' ? sharePointSite : document[field] ?? null,
  ]));
}

function projectDocuments(documents) {
  if (!Array.isArray(documents)) throw new Error('Source bundle documents must be an array.');
  const projected = documents.map(projectDocument);
  const kinds = new Set();
  for (const document of projected) {
    if (kinds.has(document.kind)) throw new Error(`Source bundle has more than one ${document.kind} document.`);
    kinds.add(document.kind);
  }
  return projected;
}

function assertCompleteInventory(inventory) {
  if (!inventory || !Array.isArray(inventory.documents) || !Array.isArray(inventory.errors)) {
    throw new Error('Source document inventory is invalid.');
  }
  if (inventory.errors.length) {
    throw new Error(`Source document inventory is incomplete: ${inventory.errors.map((error) => (
      `${error.source}:${error.code}`
    )).join(', ')}.`);
  }
  return inventory.documents;
}

function inventoryIdentity(document) {
  return {
    id: document.id,
    kind: document.kind,
    library: document.library,
    folder: document.folder,
    driveId: document.driveId,
    graphItemId: document.graphItemId,
    name: document.name,
    size: document.size,
    mimeType: document.mimeType,
    eTag: document.eTag,
    versionId: document.versionId ?? null,
  };
}

function canonicalInventory(documents) {
  return documents.map(inventoryIdentity).sort((left, right) => (
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  ));
}

function assertSameInventory(hydratedDocuments, currentDocuments) {
  if (JSON.stringify(canonicalInventory(hydratedDocuments))
      !== JSON.stringify(canonicalInventory(currentDocuments))) {
    throw new Error('Source document set changed during export; rerun to capture a consistent bundle.');
  }
}

async function readCurrentDocumentIdentity(document, dependencies) {
  const driveId = await dependencies.getDriveId(document.library);
  const metadata = await dependencies.getFileMetadataById(driveId, document.graphItemId);
  if (!metadata || !metadata.eTag
      || metadata.id !== document.graphItemId
      || metadata.name !== document.name
      || metadata.size !== document.size
      || metadata.mimeType !== document.mimeType) {
    throw new Error('Source document set changed during export; rerun to capture a consistent bundle.');
  }
  return inventoryIdentity({
    ...document,
    driveId,
    eTag: metadata.eTag,
    versionId: metadata.versionId || null,
  });
}

/**
 * Read, hydrate and fence one source Request before returning a bundle that a
 * shell may write. Every external operation is injected for offline tests.
 */
export async function exportTestRequestSourceBundle(
  { sourceRequestNumber, dataverseHost, exportedAt },
  dependencies,
) {
  const sourceRow = await dependencies.readSourceRow(sourceRequestNumber);
  const projectedSource = projectCloneSource(sourceRow);
  const requestId = projectedSource.akoya_requestid;
  const source = {
    akoya_requestid: requestId,
    akoya_requestnum: projectedSource.akoya_requestnum,
  };

  const initialInventory = assertCompleteInventory(await dependencies.discoverDocuments(source));
  dependencies.assertReadLimits(initialInventory);
  const documents = [];
  for (const document of initialInventory) {
    documents.push(await dependencies.hydrateDocument(document));
  }

  const currentInventory = assertCompleteInventory(await dependencies.discoverDocuments(source));
  dependencies.assertReadLimits(currentInventory);
  const currentDocuments = [];
  for (const document of currentInventory) {
    currentDocuments.push(await readCurrentDocumentIdentity(document, dependencies));
  }
  assertSameInventory(documents, currentDocuments);

  const revisionAfter = await dependencies.readSourceRevision(requestId);
  if (revisionAfter !== String(sourceRow.versionnumber)) {
    throw new Error('Source Request changed during export; rerun to capture a consistent bundle.');
  }

  return buildSourceBundle({ sourceRow, documents, dataverseHost, exportedAt });
}

/**
 * Build a bundle from a raw source Request row (as read from Dataverse,
 * including its revision) and hydrated document versions.
 */
export function buildSourceBundle({ sourceRow, documents, dataverseHost, exportedAt }) {
  if (!nonEmptyString(dataverseHost, 255)) throw new Error('Source bundle Dataverse host is required.');
  if (!(exportedAt instanceof Date) || Number.isNaN(exportedAt.getTime())) {
    throw new Error('Source bundle export time is invalid.');
  }
  const request = projectCloneSource(sourceRow);
  if (!/^\d{1,10}$/.test(request.akoya_requestnum || '')) throw new Error('Source Request number is invalid.');
  return {
    kind: SOURCE_BUNDLE_KIND,
    version: SOURCE_BUNDLE_VERSION,
    exportedAt: exportedAt.toISOString(),
    source: { dataverseHost: dataverseHost.toLowerCase(), request },
    documents: projectDocuments(documents),
  };
}

/** Validate a parsed bundle and return its canonical projection. */
export function readSourceBundle(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Source bundle is invalid.');
  if (value.kind !== SOURCE_BUNDLE_KIND) throw new Error('File is not a Test Request source bundle.');
  if (value.version !== SOURCE_BUNDLE_VERSION) throw new Error(`Unsupported source bundle version: ${value.version}.`);
  const exportedAt = new Date(value.exportedAt);
  if (typeof value.exportedAt !== 'string' || Number.isNaN(exportedAt.getTime())) {
    throw new Error('Source bundle export time is invalid.');
  }
  const request = value.source?.request;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('Source bundle request is missing.');
  }
  // Re-project through the same validator the export used; the stored
  // revision is passed as versionnumber so projectCloneSource accepts it.
  return buildSourceBundle({
    sourceRow: { ...request, versionnumber: request.revision },
    documents: value.documents,
    dataverseHost: value.source?.dataverseHost,
    exportedAt,
  });
}

/** Printable summary: identities, counts and hash prefixes; never source text. */
export function summarizeSourceBundle(bundle) {
  const { request } = bundle.source;
  return {
    dataverseHost: bundle.source.dataverseHost,
    requestNumber: request.akoya_requestnum,
    requestId: request.akoya_requestid,
    revision: request.revision,
    fiscalYear: request.akoya_fiscalyear,
    meetingDate: request.wmkf_meetingdate,
    hasPurpose: request.akoya_purpose != null,
    hasRequestedAmount: request.akoya_request != null,
    documents: bundle.documents.map((document) => ({
      kind: document.kind,
      name: document.name,
      size: document.size,
      sha256Prefix: document.contentHash.slice(0, 12),
    })),
  };
}
