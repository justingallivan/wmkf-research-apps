/**
 * Strict, read-only listing of one Research request's SharePoint files for the
 * request file corpus (docs/plans/RESEARCH_REQUEST_FILE_CORPUS_INDEX_BUILD_PLAN_2026-10-25.md).
 * Used by scripts/load-request-file-corpus.mjs. The inventory probe
 * (scripts/probe-request-file-inventory.mjs) keeps its own per-bucket copy,
 * which records a bucket error and continues instead of failing the request.
 *
 * Unlike a best-effort listing, a problem is never read as "no files": the
 * bucket lookup runs with requireCompleteResults and requireResolvedParents,
 * truncation and depth limits throw, and any bucket error fails the whole
 * request (`{ error }`, no files) so callers keep what they had. Only a missing
 * archive folder is expected and counts as an empty bucket. Transient Graph
 * statuses are retried with backoff.
 */

import { GraphService } from '../graph-service.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets.js';

export const LIST_OPTIONS = Object.freeze({
  recursive: true, maxDepth: 8, maxFiles: 5000, failOnTruncation: true, failOnDepthLimit: true, totalTimeoutMs: 180_000,
});
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withRetry(fn, { sleep = defaultSleep, attempts = 5 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await fn(); } catch (err) {
      if (!TRANSIENT.has(err.status) || attempt >= attempts - 1) throw err;
      await sleep(Math.min(30_000, 2_000 * 2 ** attempt));
    }
  }
}

const extensionOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

/**
 * @param {{ requestId: string, requestNum: string|number }} request
 * @param {{ graph?: object, getBuckets?: Function, sleep?: Function }} [deps]
 * @returns {Promise<{ files: Array<object>|null, error: string|null }>}
 */
export async function listRequestFiles({ requestId, requestNum }, deps = {}) {
  const graph = deps.graph || GraphService;
  const getBuckets = deps.getBuckets || getRequestSharePointBuckets;
  const retry = (fn) => withRetry(fn, { sleep: deps.sleep });
  const files = [];
  try {
    const buckets = await retry(() => getBuckets(requestId, requestNum, { requireCompleteResults: true, requireResolvedParents: true }));
    for (const b of buckets) {
      let listed;
      try {
        listed = await retry(() => graph.listFiles(b.library, b.folder, LIST_OPTIONS));
      } catch (err) {
        if (err.code === 'graph_folder_not_found' && b.source === 'archive') continue;
        return { files: null, error: `${b.library}: ${String(err.message || err).slice(0, 300)}` };
      }
      if (!listed.length) continue;
      const driveId = await retry(() => graph.getDriveId(b.library));
      for (const f of listed) {
        files.push({
          driveId,
          itemId: f.id,
          library: b.library,
          source: b.source,
          subfolder: f.folder === b.folder ? '' : f.folder.slice(b.folder.length + 1),
          name: f.name,
          extension: extensionOf(f.name),
          size: f.size ?? null,
          lastModified: f.lastModified || null,
          mimeType: f.mimeType || null,
        });
      }
    }
  } catch (err) {
    return { files: null, error: `buckets: ${String(err.message || err).slice(0, 300)}` };
  }
  return { files, error: null };
}
