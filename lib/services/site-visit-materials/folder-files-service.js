/**
 * Site visit materials — SharePoint folder listing for the Workbench
 * (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §16.13).
 *
 * INTERIM (owner, 2026-09-25): while the applicant upload portal is still in
 * testing, staff place slides and participant bios in the request's
 * `Site Visit - Slides` / `Site Visit - Participant Bios` folders by hand
 * through AkoyaGo. Those files have no `wmkf_requestdocument` row, so every
 * registry consumer misses them. This lists the two folders directly so the
 * Staff Deliberations tab can link to whatever is there. With background schema
 * enabled, published registry links supplement the root listing. Job subfolders
 * are never recursively listed: uncommitted candidates must stay hidden.
 * Read-only; no counters.
 *
 * Contract: plain args, plain 200 body, ServiceHttpError 404 when the request
 * does not resolve, 502 when SharePoint cannot be read. A missing subfolder
 * is the normal "nothing yet" case and yields an empty list. ASSUMES a
 * trusted DAL context already exists.
 */

import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { isMaterialsBackgroundSchemaReady } from '../../utils/site-visit-materials-background-readiness.js';
import { matchReceivedFiles } from './collection-service.js';
import { getSupersededPortalMaterialIdentities, graphFileIdentity } from './recursive-reader-filter.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets';
import { SITE_VISIT_MATERIALS_FOLDERS } from '../../../shared/config/siteVisitMaterials.js';
import { activeBucket } from './contributor-service.js';

export const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: ['akoya_requestid', 'akoya_requestnum'] }),
  getSharePointBuckets: getRequestSharePointBuckets,
  backgroundSchemaReady: isMaterialsBackgroundSchemaReady,
  findDocumentsByRequest: (id) => requestDocumentAdapter.findByRequest(id),
  getDriveId: (library) => GraphService.getDriveId(library),
  listFiles: (library, folder) => GraphService.listFiles(library, folder, { maxFiles: 100 }),
});

const FOLDER_KEYS = Object.freeze({
  slides: SITE_VISIT_MATERIALS_FOLDERS.presentation_pdf,
  participantBios: SITE_VISIT_MATERIALS_FOLDERS.participant_bios,
});

async function listFolder(library, folder, dependencies) {
  try {
    const files = await dependencies.listFiles(library, folder);
    return (files || [])
      .filter((file) => file?.name && file?.webUrl)
      .map((file) => ({
        id: file.id || null,
        name: file.name,
        webUrl: file.webUrl,
        lastModified: file.lastModified || null,
        size: file.size ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error?.code === 'graph_folder_not_found') return [];
    console.error(`site-visit-materials folder listing failed for ${library}/${folder}:`, error?.message);
    throw new ServiceHttpError('SharePoint could not be read.', { httpStatus: 502 });
  }
}

/**
 * @param {{ requestId: string }} args - GUID, already validated by the route
 * @returns {Promise<{ success: true, folderFound: boolean, slides: Array, participantBios: Array }>}
 */
export async function listSiteVisitMaterialFolderFiles({ requestId }, dependencies = DEFAULT_DEPENDENCIES) {
  let request;
  try {
    request = await dependencies.getRequest(requestId);
  } catch {
    request = null;
  }
  if (!request?.akoya_requestid || !request?.akoya_requestnum) {
    throw new ServiceHttpError(`No request found for ${requestId}`, { httpStatus: 404 });
  }

  // Scope derives from the resolved record, never the query param.
  const bucket = activeBucket(await dependencies.getSharePointBuckets(request.akoya_requestid, request.akoya_requestnum));
  if (!bucket) return { success: true, folderFound: false, slides: [], participantBios: [] };

  const root = String(bucket.folder).replace(/\/+$/, '');
  let [slides, participantBios] = await Promise.all(
    Object.values(FOLDER_KEYS).map((name) => listFolder(bucket.library, `${root}/${name}`, dependencies)),
  );
  if (dependencies.backgroundSchemaReady?.()) {
    let documents; let driveId;
    try {
      [documents, driveId] = await Promise.all([
        dependencies.findDocumentsByRequest(request.akoya_requestid),
        dependencies.getDriveId(bucket.library),
      ]);
    } catch {
      throw new ServiceHttpError('The materials could not be read. Please try again.', { httpStatus: 502 });
    }
    if (!Array.isArray(documents?.records)) {
      throw new ServiceHttpError('The materials could not be read. Please try again.', { httpStatus: 502 });
    }
    const scoped = documents.records.filter((row) =>
      String(row._wmkf_request_value || '').toLowerCase() === String(request.akoya_requestid).toLowerCase());
    const { received } = matchReceivedFiles(scoped, request.akoya_requestid, request.akoya_requestnum);
    const currentIds = new Set(Object.values(received).filter(Boolean).map((item) => item.artifactId));
    const currentRows = scoped.filter((row) => currentIds.has(row.wmkf_requestdocumentid));
    // Names alone must never hide a manual file. The pure helper uses this
    // same current-slot matcher and exact drive/item identity.
    const supersededItems = getSupersededPortalMaterialIdentities(
      scoped, request.akoya_requestid, request.akoya_requestnum,
    );
    const merge = (files, slots) => {
      const kept = files.filter((file) => !supersededItems.has(graphFileIdentity(driveId, file.id)));
      for (const slot of slots) {
        const row = currentRows.find((item) => item.wmkf_requestdocumentid === received[slot]?.artifactId);
        if (!row?.wmkf_sharepointweburl) continue;
        if (kept.some((file) => (row.wmkf_sharepointdriveid === driveId && file.id === row.wmkf_sharepointitemid)
          || file.webUrl === row.wmkf_sharepointweburl)) continue;
        kept.push({ name: row.wmkf_filename, webUrl: row.wmkf_sharepointweburl,
          lastModified: row.modifiedon || row.createdon || null, size: row.wmkf_filesize ?? null });
      }
      return kept.sort((a, b) => a.name.localeCompare(b.name));
    };
    slides = merge(slides, ['presentation_pdf', 'presentation_source']);
    participantBios = merge(participantBios, ['participant_bios']);
  }
  // Item identities are internal merge keys, not a new public response field.
  const publicFiles = (files) => files.map(({ id, ...file }) => file);
  return { success: true, folderFound: true, slides: publicFiles(slides), participantBios: publicFiles(participantBios) };
}
