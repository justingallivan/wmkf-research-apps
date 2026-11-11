/**
 * Candidate staff-draft source policy. Callers must authorize the Request and
 * establish trusted DAL context before using it. This adapter does not enable
 * the policy or perform writes.
 */
import { getById as readRequest } from '../../dataverse/adapters/grant-request.js';
import { getByIdWithSelect as readContact } from '../../dataverse/adapters/contact.js';
import { extractTextFromBuffer as extractText } from '../../utils/file-loader.js';
import { isGuid } from '../../utils/guid.js';
import { acceptedProposalNarrativeFilenames } from '../../utils/proposal-document-names.js';
import { getRequestSharePointBuckets as getBuckets } from '../../utils/sharepoint-buckets.js';
import { GraphService } from '../graph-service.js';
import { validatePath } from '../graph/paths.js';
import { RECOMMENDATIONS_SANDBOX_ORIGIN, readRecommendationsSandboxTarget } from './recommendations-sandbox-policy.js';
import { SHAREPOINT_CANONICAL_SITE_URL } from '../sharepoint-target-registry.js';
import { prepareContextSnapshot, SANDBOX_RECOMMENDATIONS_SOURCE_VERSION } from './context.js';
import { canonical, exact, sha256, validateProfile } from './profile.js';

import { SOURCE_POLICY } from './trial-policy.js';
const EXTRACTION_VERSION = 'pdf-parse-text-v1';
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const REQUEST_SELECT = ['akoya_requestid', 'akoya_requestnum', '_wmkf_projectleader_value'];
const CONTACT_SELECT = ['contactid', 'fullname'];
const MANIFEST_KEYS = [
  'version', 'sourcePolicy', 'requestId', 'requestNumber', 'piContactId', 'piNameHash',
  'library', 'folder', 'filename', 'siteId', 'driveId', 'itemId', 'eTag', 'versionId',
];
const SOURCE_MISMATCH_CODES = new Set([
  'proposal_source_missing', 'proposal_source_pi_missing',
  'proposal_source_ambiguous', 'proposal_source_invalid_metadata',
]);
const HASH = /^[a-f0-9]{64}$/;

function sourceError(code) {
  return Object.assign(new Error(code), { code });
}

function unavailable() {
  return Object.assign(sourceError('proposal_source_unavailable'), { isTransient: true });
}

function normalizedGuid(value) {
  return isGuid(value) ? value.trim().toLowerCase() : null;
}

function boundedText(value, maxBytes) {
  return typeof value === 'string' && value === value.trim() && value.length > 0
    && !/[\u0000-\u001f\u007f]/u.test(value) && Buffer.byteLength(value) <= maxBytes;
}

function pathSegment(value, maxBytes) {
  return boundedText(value, maxBytes) && !/[/\\%?#]/u.test(value) && value !== '.' && value !== '..';
}

function manifestCopy(manifest, errorCode) {
  try {
    exact(manifest, MANIFEST_KEYS, 'proposal source manifest');
    if (manifest.version !== 1 || manifest.sourcePolicy !== SOURCE_POLICY
        || !normalizedGuid(manifest.requestId) || manifest.requestId !== normalizedGuid(manifest.requestId)
        || !normalizedGuid(manifest.piContactId) || manifest.piContactId !== normalizedGuid(manifest.piContactId)
        || typeof manifest.piNameHash !== 'string' || !HASH.test(manifest.piNameHash)
        || !pathSegment(manifest.requestNumber, 128)
        || !boundedText(manifest.library, 128) || manifest.library.toLowerCase() !== 'akoya_request'
        || !boundedText(manifest.folder, 1024) || !manifest.folder.endsWith('/AI Materials')
        || !acceptedProposalNarrativeFilenames(manifest.requestNumber).includes(manifest.filename)
        || !boundedText(manifest.siteId, 256)
        || !pathSegment(manifest.driveId, 256) || !pathSegment(manifest.itemId, 256)
        || !boundedText(manifest.eTag, 256) || !boundedText(manifest.versionId, 256)) {
      throw new Error('invalid manifest');
    }
    validatePath(manifest.folder);
    return Object.freeze({ ...manifest });
  } catch {
    throw sourceError(errorCode);
  }
}

async function sourceRead(read, { missingAsNull = false } = {}) {
  try {
    return await read();
  } catch (error) {
    if (missingAsNull && error?.status === 404) return null;
    throw unavailable();
  }
}

async function locateAiMaterialsProposal(deps, id, requestNumber) {
  const buckets = await sourceRead(() => deps.getBuckets(id, requestNumber, {
    requireResolvedParents: true,
    requireCompleteResults: true,
  }));
  if (!Array.isArray(buckets)) throw sourceError('proposal_source_invalid_metadata');
  const active = buckets.filter(bucket => (
    bucket?.source === 'dynamics' && typeof bucket.library === 'string'
    && bucket.library.toLowerCase() === 'akoya_request'
  ));
  if (active.length === 0) throw sourceError('proposal_source_missing');
  if (active.length !== 1) throw sourceError('proposal_source_ambiguous');
  const { library, folder: activeFolder } = active[0];
  const rootFolder = typeof activeFolder === 'string' ? activeFolder.replace(/\/+$/, '') : null;
  if (!boundedText(rootFolder, 1000)) throw sourceError('proposal_source_invalid_metadata');
  const folder = `${rootFolder}/AI Materials`;
  try { validatePath(folder); } catch { throw sourceError('proposal_source_invalid_metadata'); }

  const filenames = acceptedProposalNarrativeFilenames(requestNumber);
  const candidates = await Promise.all(filenames.map(async filename => ({
    filename,
    metadata: await sourceRead(() => deps.getFileMetadataByPath(library, folder, filename)),
  })));
  const present = candidates.filter(candidate => candidate.metadata != null);
  if (present.length === 0) throw sourceError('proposal_source_missing');
  if (present.length !== 1) throw sourceError('proposal_source_ambiguous');
  const { filename, metadata } = present[0];
  if (metadata.name !== filename) throw sourceError('proposal_source_invalid_metadata');
  return {library, folder, filename, metadata};
}

function proposalSourceDependencies(overrides) {
  return {
    readRequest,
    readContact,
    getBuckets,
    getFileMetadataByPath: (...args) => GraphService.getFileMetadataByPath(...args),
    downloadFile: (...args) => GraphService.downloadFile(...args),
    extractText,
    ...overrides,
  };
}

export function createProposalSource(overrides = {}) {
  const deps = proposalSourceDependencies(overrides);
  async function inspectSource(requestId) {
    const id = normalizedGuid(requestId);
    if (!id) throw sourceError('proposal_source_invalid_request');
    const request = await sourceRead(
      () => deps.readRequest(id, { select: REQUEST_SELECT }),
      { missingAsNull: true },
    );
    if (!request) throw sourceError('proposal_source_missing');
    const number = request.akoya_requestnum;
    const requestNumber = typeof number === 'string' || Number.isSafeInteger(number)
      ? String(number).trim() : null;
    if (normalizedGuid(request.akoya_requestid) !== id || !pathSegment(requestNumber, 128)) {
      throw sourceError('proposal_source_invalid_metadata');
    }

    const piContactId = normalizedGuid(request._wmkf_projectleader_value);
    if (!piContactId) throw sourceError('proposal_source_pi_missing');
    const contact = await sourceRead(
      () => deps.readContact(piContactId, CONTACT_SELECT),
      { missingAsNull: true },
    );
    const piName = contact?.fullname;
    if (normalizedGuid(contact?.contactid) !== piContactId || typeof piName !== 'string' || !piName.trim()) {
      throw sourceError('proposal_source_pi_missing');
    }

    const { library, folder, filename, metadata } = await locateAiMaterialsProposal(deps, id, requestNumber);

    const manifest = manifestCopy({
      version: 1,
      sourcePolicy: SOURCE_POLICY,
      requestId: id,
      requestNumber,
      piContactId,
      piNameHash: sha256(piName),
      library,
      folder,
      filename,
      siteId: metadata.siteId,
      driveId: metadata.driveId,
      itemId: metadata.id,
      eTag: metadata.eTag,
      versionId: metadata.versionId,
    }, 'proposal_source_invalid_metadata');
    return { manifest, piName };
  }

  async function matchingSource(manifest) {
    try {
      const current = await inspectSource(manifest.requestId);
      return canonical(current.manifest) === canonical(manifest) ? current : null;
    } catch (error) {
      if (SOURCE_MISMATCH_CODES.has(error?.code)) return null;
      throw error;
    }
  }

  return {
    async inspect(input) {
      return (await inspectSource(input?.requestId)).manifest;
    },

    async prepare(input) {
      const { manifest: suppliedManifest, scope: suppliedScope, profile: suppliedProfile, nonceSecret } = input ?? {};
      const manifest = manifestCopy(suppliedManifest, 'proposal_source_invalid_manifest');
      let profile;
      try {
        const { documentRoles, recordNames } = validateProfile(suppliedProfile);
        if (documentRoles.length !== 1 || documentRoles[0] !== 'proposal'
            || recordNames.length !== 1 || recordNames[0] !== 'pi_name') throw new Error('unsupported profile');
        profile = JSON.parse(canonical(suppliedProfile));
      } catch {
        throw sourceError('proposal_source_invalid_profile');
      }
      let scope;
      try {
        exact(suppliedScope, ['environment', 'authorizationScope', 'requestId'], 'scope');
        if (suppliedScope.requestId !== manifest.requestId || !boundedText(suppliedScope.environment, 128)
            || !boundedText(suppliedScope.authorizationScope, 1024)
            || typeof nonceSecret !== 'string' || Buffer.byteLength(nonceSecret) < 32) {
          throw new Error('invalid snapshot scope');
        }
        scope = { ...suppliedScope };
      } catch {
        throw sourceError('proposal_source_invalid_scope');
      }

      const before = await matchingSource(manifest);
      if (!before) throw sourceError('proposal_source_changed');
      let download;
      try {
        download = await deps.downloadFile(before.manifest.driveId, before.manifest.itemId, { maxBytes: MAX_PDF_BYTES });
      } catch (error) {
        if (error?.code === 'graph_download_size_limit') throw sourceError('proposal_source_too_large');
        throw unavailable();
      }
      if (download?.filename !== manifest.filename) throw sourceError('proposal_source_changed');
      const { buffer } = download;
      if (!Buffer.isBuffer(buffer) || !buffer.length) throw sourceError('proposal_source_invalid_file');
      if (buffer.length > MAX_PDF_BYTES) throw sourceError('proposal_source_too_large');

      const after = await matchingSource(manifest);
      if (!after) throw sourceError('proposal_source_changed');

      const contentHash = sha256(buffer);
      let text;
      try {
        text = await deps.extractText(buffer, manifest.filename, 'application/pdf');
      } catch {
        throw sourceError('proposal_source_extraction_failed');
      }
      if (typeof text !== 'string' || !text.trim()) throw sourceError('proposal_source_extraction_failed');
      try {
        return prepareContextSnapshot({
          scope,
          profile,
          documents: [{
            role: 'proposal',
            id: canonical([manifest.siteId, manifest.driveId, manifest.itemId]),
            version: canonical([manifest.versionId, manifest.eTag]),
            sha256: contentHash,
            text,
            extractionVersion: EXTRACTION_VERSION,
          }],
          records: [{
            name: 'pi_name',
            present: true,
            value: after.piName,
            provenance: `contact:${manifest.piContactId}:fullname`,
          }],
          nonceSecret,
        });
      } catch (error) {
        throw sourceError(error?.code === 'snapshot_too_large' ? error.code : 'proposal_source_invalid_snapshot');
      }
    },

    async isCurrent(input) {
      const manifest = manifestCopy(input?.manifest, 'proposal_source_invalid_manifest');
      return Boolean(await matchingSource(manifest));
    },
  };
}

/** Read-only byte/version observation of the one approved combined Sandbox PDF. */
export function createRecommendationsProposalSource(overrides = {}) {
  const deps = proposalSourceDependencies({
    target: readRecommendationsSandboxTarget, budgetMs: 45_000,
    readRequest: (id, options) => readRequest(id, { ...options, strictRead: true, expectedOrigin: RECOMMENDATIONS_SANDBOX_ORIGIN }),
    ...overrides,
  });
  const registeredSiteHost = new URL(SHAREPOINT_CANONICAL_SITE_URL).hostname;

  async function inspect(requestId, signal) {
    signal.throwIfAborted();
    const target = deps.target();
    if (!target) throw unavailable();
    const request = await sourceRead(() => deps.readRequest(requestId, { select: REQUEST_SELECT.slice(0, 2) }), { missingAsNull: true });
    if (!request) throw sourceError('proposal_source_missing');
    const number = request.akoya_requestnum;
    const requestNumber = typeof number === 'string' || Number.isSafeInteger(number) ? String(number).trim() : null;
    if (normalizedGuid(request.akoya_requestid) !== requestId || !pathSegment(requestNumber, 128)) {
      throw sourceError('proposal_source_invalid_metadata');
    }
    function assertTarget() {
      signal.throwIfAborted();
      if (canonical(deps.target()) !== canonical(target)) throw unavailable();
    }
    const guarded = {
      getBuckets: (...args) => { assertTarget(); return deps.getBuckets(...args); },
      getFileMetadataByPath: (...args) => { assertTarget(); return deps.getFileMetadataByPath(...args); },
    };
    const { library, folder, filename, metadata } = await locateAiMaterialsProposal(guarded, requestId, requestNumber);
    if (!boundedText(metadata.siteId, 256) || metadata.siteId.split(',')[0] !== registeredSiteHost
      || !pathSegment(metadata.driveId, 256) || !pathSegment(metadata.id, 256)
      || !boundedText(metadata.eTag, 256) || !boundedText(metadata.versionId, 256)) {
      throw sourceError('proposal_source_invalid_metadata');
    }
    assertTarget();
    return { target, library, folder, filename, siteId: metadata.siteId, driveId: metadata.driveId,
      itemId: metadata.id, eTag: metadata.eTag, versionId: metadata.versionId };
  }

  return {
    async observe({ requestId, version }) {
      if (normalizedGuid(requestId) !== requestId || version !== SANDBOX_RECOMMENDATIONS_SOURCE_VERSION) {
        throw sourceError('proposal_source_invalid_request');
      }
      const controller = new AbortController();
      const { signal } = controller;
      let timer;
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, deps.budgetMs);
      });
      async function observeBytes() {
        const before = await inspect(requestId, signal);
        signal.throwIfAborted();
        if (canonical(deps.target()) !== canonical(before.target)) throw unavailable();
        const { buffer, filename } = await sourceRead(() => deps.downloadFile(before.driveId, before.itemId, { maxBytes: MAX_PDF_BYTES }));
        if (filename !== before.filename || !Buffer.isBuffer(buffer) || buffer.length > MAX_PDF_BYTES
          || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw sourceError('proposal_source_invalid_file');
        const after = await inspect(requestId, signal);
        if (canonical(before) !== canonical(after)) throw sourceError('proposal_source_changed');
        const { target, eTag, versionId, ...identity } = before;
        return { requestId, version, complete: true, targetHost: target.targetHost, documents: [{
          role: 'proposal', id: sha256(canonical({ requestId, ...identity })), version: canonical([versionId, eTag]),
          sha256: sha256(buffer), extractionVersion: EXTRACTION_VERSION,
        }] };
      }
      try { return await Promise.race([timeout, observeBytes()]); }
      finally { clearTimeout(timer); }
    },
  };
}
