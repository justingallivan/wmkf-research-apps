/**
 * Exact SharePoint identity suppression for legacy Site Visit files in generic
 * recursive request-document inventories. Current published materials remain
 * owned by folder-files-service; this helper only removes a known superseded
 * portal item from its canonical root folder.
 */

import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { GraphService } from '../graph-service.js';
import { isMaterialsBackgroundSchemaReady } from '../../utils/site-visit-materials-background-readiness.js';
import { matchReceivedFiles } from './materials-matching.js';
import { REQUEST_DOCUMENT_LIFECYCLE_STATE } from '../../../shared/config/requestDocument.js';
import { SITE_VISIT_MATERIALS_FOLDERS } from '../../../shared/config/siteVisitMaterials.js';

export const SITE_VISIT_MATERIALS_READER_FILTER_ERROR = Object.freeze({
  code: 'site_visit_materials_status_unavailable',
  message: 'Some Site Visit material files were omitted because their current status could not be verified.',
});

const PORTAL_PRODUCER = 'site-visit-materials-portal';
const CANONICAL_MATERIAL_FOLDERS = [...new Set(Object.values(SITE_VISIT_MATERIALS_FOLDERS))];

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function normalizeFolderPath(value) {
  return String(value || '').replace(/\\/g, '/').split('/').filter(Boolean)
    .map((segment) => segment.toLowerCase()).join('/');
}

export function graphFileIdentity(driveId, itemId) {
  return JSON.stringify([String(driveId || ''), String(itemId || '')]);
}

export function isDirectSiteVisitMaterialsFile(file, bucketFolder) {
  const listedFolder = normalizeFolderPath(file?.folder || bucketFolder);
  return CANONICAL_MATERIAL_FOLDERS.some((name) => (
    listedFolder === normalizeFolderPath(`${String(bucketFolder || '').replace(/\/+$/, '')}/${name}`)
  ));
}

/**
 * Derive exact, request-bound portal item identities that are superseded and
 * are not still selected as a current Ready slot by the canonical matcher.
 */
export function getSupersededPortalMaterialIdentities(rows, requestId, requestNumber) {
  const scoped = (Array.isArray(rows) ? rows : []).filter((row) => sameId(row?._wmkf_request_value, requestId));
  const { received } = matchReceivedFiles(scoped, requestId, requestNumber);
  const currentIds = new Set(Object.values(received).filter(Boolean).map((item) => item.artifactId));
  const currentRows = scoped.filter((row) => currentIds.has(row.wmkf_requestdocumentid));
  const currentIdentities = new Set(currentRows
    .filter((row) => row.wmkf_sharepointdriveid && row.wmkf_sharepointitemid)
    .map((row) => graphFileIdentity(row.wmkf_sharepointdriveid, row.wmkf_sharepointitemid)));

  return new Set(scoped
    .filter((row) => row.wmkf_producer === PORTAL_PRODUCER
      && row.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
      && row.wmkf_sharepointdriveid
      && row.wmkf_sharepointitemid)
    .map((row) => graphFileIdentity(row.wmkf_sharepointdriveid, row.wmkf_sharepointitemid))
    .filter((identity) => !currentIdentities.has(identity)));
}

function assertCompleteRegistryResult(result) {
  if (!Array.isArray(result?.records)
    || !Number.isSafeInteger(result.totalCount)
    || result.totalCount < 0
    || typeof result.capped !== 'boolean'
    || result.capped
    || result.records.length < result.totalCount
    || result.records.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('Request Document registry result was incomplete or malformed.');
  }
  return result.records;
}

const DEFAULT_DEPENDENCIES = Object.freeze({
  backgroundSchemaReady: isMaterialsBackgroundSchemaReady,
  findDocumentsByRequest: (requestId) => requestDocumentAdapter.findByRequest(requestId),
  getDriveId: (library) => GraphService.getDriveId(library),
});

/**
 * Create a lazy request-scoped filter for the five generic recursive readers.
 * Registry access is skipped unless a bucket listing has direct files in one
 * of the canonical Site Visit folders. On uncertainty, only those candidates
 * are withheld; unrelated request documents remain available.
 */
export function createSiteVisitMaterialsRecursiveReaderFilter(
  requestId,
  requestNumber,
  dependencies = DEFAULT_DEPENDENCIES,
) {
  const enabled = dependencies.backgroundSchemaReady?.() === true;
  let registryPromise = null;
  const drivePromises = new Map();

  const readIdentities = () => {
    if (!registryPromise) {
      registryPromise = Promise.resolve()
        .then(() => dependencies.findDocumentsByRequest(requestId))
        .then((result) => getSupersededPortalMaterialIdentities(
          assertCompleteRegistryResult(result), requestId, requestNumber,
        ));
    }
    return registryPromise;
  };

  const readDriveId = (library) => {
    if (!drivePromises.has(library)) {
      drivePromises.set(library, Promise.resolve().then(() => dependencies.getDriveId(library)));
    }
    return drivePromises.get(library);
  };

  return async function filterSiteVisitMaterials(library, bucketFolder, listedFiles) {
    const files = Array.isArray(listedFiles) ? listedFiles : [];
    if (!enabled) return { files, omittedFiles: [], error: null };

    const directFiles = files.filter((file) => isDirectSiteVisitMaterialsFile(file, bucketFolder));
    if (directFiles.length === 0) return { files, omittedFiles: [], error: null };

    const unidentified = directFiles.filter((file) => typeof file?.id !== 'string' || !file.id);
    const identified = directFiles.filter((file) => typeof file?.id === 'string' && Boolean(file.id));
    let supersededItems;
    let driveId;
    let statusError = null;
    if (identified.length) {
      try {
        [supersededItems, driveId] = await Promise.all([readIdentities(), readDriveId(library)]);
        if (typeof driveId !== 'string' || !driveId) throw new Error('Graph drive identity is unavailable.');
      } catch {
        statusError = SITE_VISIT_MATERIALS_READER_FILTER_ERROR;
      }
    }

    const omittedFiles = [...unidentified];
    if (statusError) omittedFiles.push(...identified);
    const removedIdentities = statusError ? new Set() : new Set(
      identified
        .filter((file) => supersededItems.has(graphFileIdentity(driveId, file.id)))
        .map((file) => graphFileIdentity(driveId, file.id)),
    );
    const omittedSet = new Set(omittedFiles);
    const safeFiles = files.filter((file) => {
      if (!directFiles.includes(file)) return true;
      if (omittedSet.has(file)) return false;
      return !removedIdentities.has(graphFileIdentity(driveId, file.id));
    });

    return {
      files: safeFiles,
      omittedFiles,
      error: statusError || (unidentified.length ? SITE_VISIT_MATERIALS_READER_FILTER_ERROR : null),
    };
  };
}
