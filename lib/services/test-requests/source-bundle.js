/**
 * Test Request source bundle (design decision 6, option A).
 *
 * A read-only production step exports what the factory needs from one source
 * Grant Request into a private local JSON bundle; a later sandbox step builds
 * the new request from that bundle. This module is pure: it validates and
 * shapes the bundle and never reads Dataverse, Graph or the filesystem.
 *
 * The bundle carries source text (purpose), so callers write it only to a
 * private absolute path and never log it; `summarizeSourceBundle` returns the
 * printable subset. Files are referenced, not embedded: SharePoint is the same
 * akoyaGO site in production and the sandbox, so later copy steps re-verify
 * each item's eTag and SHA-256 before copying.
 */

import { projectCloneSource } from './sandbox-clone.js';

export const SOURCE_BUNDLE_KIND = 'test-request-source-bundle';
export const SOURCE_BUNDLE_VERSION = 1;

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
  'id', 'kind', 'library', 'folder', 'name', 'graphItemId',
  'size', 'mimeType', 'eTag', 'versionId', 'contentHash',
];

function nonEmptyString(value, max = 1000) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function projectDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Source bundle document is invalid.');
  }
  const failures = [];
  if (!nonEmptyString(document.id, 2000)) failures.push('id');
  if (!DOCUMENT_KINDS.has(document.kind)) failures.push('kind');
  for (const field of ['library', 'folder', 'name', 'graphItemId', 'mimeType', 'eTag']) {
    if (!nonEmptyString(document[field])) failures.push(field);
  }
  if (!Number.isSafeInteger(document.size) || document.size < 0) failures.push('size');
  if (document.versionId != null && !nonEmptyString(document.versionId)) failures.push('versionId');
  if (typeof document.contentHash !== 'string' || !SHA256.test(document.contentHash)) failures.push('contentHash');
  if (failures.length) throw new Error(`Source bundle document is invalid (${failures.join(', ')}).`);
  return Object.fromEntries(DOCUMENT_FIELDS.map((field) => [field, document[field] ?? null]));
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
