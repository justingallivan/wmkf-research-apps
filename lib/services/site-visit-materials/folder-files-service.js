/**
 * Site visit materials — SharePoint folder listing for the Workbench
 * (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §16.13).
 *
 * INTERIM (owner, 2026-09-25): while the applicant upload portal is still in
 * testing, staff place slides and participant bios in the request's
 * `Site Visit - Slides` / `Site Visit - Participant Bios` folders by hand
 * through AkoyaGo. Those files have no `wmkf_requestdocument` row, so every
 * registry consumer misses them. This lists the two folders directly so the
 * Staff Deliberations tab can link to whatever is there. Portal uploads land
 * in the same folders, so they appear here too. Read-only; no counters.
 *
 * Contract: plain args, plain 200 body, ServiceHttpError 404 when the request
 * does not resolve, 502 when SharePoint cannot be read. A missing subfolder
 * is the normal "nothing yet" case and yields an empty list. ASSUMES a
 * trusted DAL context already exists.
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets';
import { SITE_VISIT_MATERIALS_FOLDERS } from '../../../shared/config/siteVisitMaterials.js';
import { activeBucket } from './contributor-service.js';

export const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: ['akoya_requestid', 'akoya_requestnum'] }),
  getSharePointBuckets: getRequestSharePointBuckets,
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
  const [slides, participantBios] = await Promise.all(
    Object.values(FOLDER_KEYS).map((name) => listFolder(bucket.library, `${root}/${name}`, dependencies)),
  );
  return { success: true, folderFound: true, slides, participantBios };
}
