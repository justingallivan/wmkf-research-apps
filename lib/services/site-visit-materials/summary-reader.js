/**
 * Fail-open applicant-materials summaries for staff list surfaces
 * (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §16.3, PR 3). Same posture as
 * the tracker's schedule reader: the readiness flag off, a Postgres error, or
 * a registry error yields the complete all-null map so the Staff Deliberations
 * tab, the cycle view, and the tracker list render their normal state.
 *
 * Summaries carry state, counts, and the window only, never the contributor
 * link or the contacts snapshot (those stay behind the tracker grant).
 */
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../../shared/config/requestDocument.js';
import { isSiteVisitMaterialsSchemaReady } from '../../utils/site-visit-materials-readiness.js';
import { getMaterialsCollection, matchReceivedFiles, projectCollection, summarizeCollection } from './collection-service.js';
import * as store from './collection-store.js';

const MATERIAL_ARTIFACT_TYPES = Object.freeze([
  REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS,
]);

export const DEFAULT_DEPENDENCIES = Object.freeze({
  schemaReady: isSiteVisitMaterialsSchemaReady,
  listLatestCollections: store.listLatestCollectionsForRequests,
  findDocumentsByCycle: async (cycleCode) => {
    const pages = await Promise.all(MATERIAL_ARTIFACT_TYPES.map((artifactType) => (
      requestDocumentAdapter.findByCycle(cycleCode, { artifactType })
    )));
    return pages.flatMap((page) => page?.records || []);
  },
  findDocumentsByRequest: async (requestId) => (await requestDocumentAdapter.findByRequest(requestId))?.records || [],
  now: () => new Date(),
});

function nullMap(requestIds) {
  return new Map((requestIds || []).map((requestId) => [requestId, null]));
}

/**
 * @param {{ requestIds: string[], requestNumbers: Map<string,string>|Object, cycleCode?: string }} args
 *   `requestNumbers` maps request id → akoya_requestnum (canonical filenames
 *   carry the number). With `cycleCode`, registry rows come from two
 *   cycle-scoped reads; without it, one read per request that has a collection.
 * @returns {Promise<Map<string, object|null>>} keyed by the ids as supplied.
 */
export async function getMaterialsSummaryByRequests({ requestIds, requestNumbers, cycleCode = null }, dependencies = DEFAULT_DEPENDENCIES) {
  const output = nullMap(requestIds);
  if (!dependencies.schemaReady() || output.size === 0) return output;
  try {
    const rows = await dependencies.listLatestCollections(requestIds);
    if (rows.length === 0) return output;
    const byRequest = new Map(rows.map((row) => [String(row.request_id).toLowerCase(), row]));
    let documents;
    if (cycleCode) {
      documents = await dependencies.findDocumentsByCycle(String(cycleCode).toUpperCase());
    } else {
      const pages = await Promise.all([...byRequest.keys()].map((requestId) => dependencies.findDocumentsByRequest(requestId)));
      documents = pages.flat();
    }
    const now = dependencies.now();
    const numberOf = (requestId) => (requestNumbers instanceof Map ? requestNumbers.get(requestId) : requestNumbers?.[requestId]) || '';
    for (const requestId of output.keys()) {
      const row = byRequest.get(String(requestId).toLowerCase());
      if (!row) continue;
      const { received, other } = matchReceivedFiles(documents, requestId, numberOf(requestId));
      output.set(requestId, summarizeCollection(projectCollection(row, { received, other, now })));
    }
    return output;
  } catch (error) {
    console.error('[site-visit-materials] summary read failed (fail-open):', error?.message || error);
    return nullMap(requestIds);
  }
}

/**
 * Single request (the per-request Staff Deliberations tab): the tracker's own
 * read, projected down. Readiness off or any failure is null.
 */
export async function getMaterialsSummaryForRequest({ requestId }, { getCollection = getMaterialsCollection } = {}) {
  try {
    const { collection } = await getCollection({ requestId });
    return summarizeCollection(collection);
  } catch (error) {
    if (error?.code !== 'site_visit_materials_schema_not_ready') {
      console.error('[site-visit-materials] summary read failed (fail-open):', error?.message || error);
    }
    return null;
  }
}
