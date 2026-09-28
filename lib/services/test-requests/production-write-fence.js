/**
 * Run-scoped write fence for a production Test Request Factory run
 * (docs/plans/TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md, MVP build
 * list item 2, the simplified P2).
 *
 * In production the source and the destination are the same org, so the
 * Factory's own writes are held to exactly what the basic recipe creates:
 *   - Dataverse: one POST of the destination Request (its preallocated GUID)
 *     and one POST of its preallocated SharePoint location bound to it;
 *     every PATCH, DELETE and raw call is refused (a production basic run
 *     makes no update: correct_meeting_date never writes and the GoVerify
 *     bypass is refused);
 *   - Graph: folder and upload writes only in the request library under the
 *     destination's own folder; deletes are refused.
 * Any write whose path or body names the source Request is refused outright.
 * Reads pass through unchanged. Unknown methods are refused (deny by
 * default), so a new write method cannot bypass the fence by being new.
 *
 * Server-side automation a create triggers is outside this fence (plan
 * hazard 1); the P5 observation covers it.
 */

import { expectedRequestFolder } from './sandbox-clone.js';

const REQUEST_LIBRARY = 'akoya_request';
const CLIENT_READS = new Set(['get', 'getWithOptions']);
const CLIENT_POSTS = new Set(['post', 'postWithOptions']);
const GRAPH_READS = new Set([
  'getSiteId', 'getDriveId', 'listFiles', 'getFileMetadataById', 'downloadFile', 'getFileMetadataByPath',
  'getFileVersionMetadata', 'downloadFileVersion', 'clearGraphCaches', 'configuredSharePointTarget',
]);
const GRAPH_FOLDER_WRITES = new Set(['ensureFolderPath', 'uploadFile']);

function refuse(message) {
  return Object.assign(new Error(`Production write fence: ${message}`), { code: 'create_rejected' });
}

function lower(value) {
  return String(value ?? '').toLowerCase();
}

function namesSource(text, sourceRequestId) {
  return Boolean(sourceRequestId) && lower(text).includes(lower(sourceRequestId));
}

function assertAllowedPost(path, body, fence) {
  const serialized = JSON.stringify(body ?? null);
  if (namesSource(path, fence.sourceRequestId) || namesSource(serialized, fence.sourceRequestId)) {
    throw refuse('a write names the source Request.');
  }
  if (path === '/akoya_requests' && lower(body?.akoya_requestid) === lower(fence.destinationRequestId)) return;
  if (path === '/sharepointdocumentlocations'
      && lower(body?.sharepointdocumentlocationid) === lower(fence.destinationLocationId)
      && lower(body?.['regardingobjectid_akoya_request@odata.bind']) === lower(`/akoya_requests(${fence.destinationRequestId})`)) {
    return;
  }
  throw refuse(`POST ${path} is not the destination Request or its preallocated location.`);
}

/**
 * @param {object} client lib/dataverse/client.js instance
 * @param {{ destinationRequestId: string, destinationLocationId: string, sourceRequestId: string }} fence
 */
export function fenceProductionClient(client, fence) {
  const fenced = { baseUrl: client.baseUrl };
  for (const [name, value] of Object.entries(client)) {
    if (typeof value !== 'function') continue;
    if (CLIENT_READS.has(name)) fenced[name] = value;
    else if (CLIENT_POSTS.has(name)) {
      fenced[name] = (path, body, ...rest) => {
        assertAllowedPost(path, body, fence);
        return value(path, body, ...rest);
      };
    } else {
      fenced[name] = () => { throw refuse(`${name} is not allowed in a production run.`); };
    }
  }
  return fenced;
}

/**
 * @param {object} graph GraphService-shaped object
 * @param {{ destinationRequestId: string, destinationRequestNumber: string|null, sourceRequestId: string }} fence
 */
export function fenceProductionGraph(graph, fence) {
  const folder = fence.destinationRequestNumber
    ? expectedRequestFolder(fence.destinationRequestNumber, fence.destinationRequestId)
    : null;
  const fenced = {};
  for (const [name, value] of Object.entries(graph)) {
    if (typeof value !== 'function') continue;
    if (GRAPH_READS.has(name)) fenced[name] = value;
    else if (GRAPH_FOLDER_WRITES.has(name)) {
      fenced[name] = (library, targetFolder, ...rest) => {
        if (!folder) throw refuse('no destination folder exists before the Request has its number.');
        if (library !== REQUEST_LIBRARY) throw refuse(`${name} targets library ${library}.`);
        const target = String(targetFolder ?? '');
        if (target !== folder && !target.startsWith(`${folder}/`)) throw refuse(`${name} targets a folder outside the destination.`);
        if (namesSource(target, fence.sourceRequestId)) throw refuse('a write names the source Request.');
        return value(library, targetFolder, ...rest);
      };
    } else {
      fenced[name] = () => { throw refuse(`${name} is not allowed in a production run.`); };
    }
  }
  return fenced;
}
