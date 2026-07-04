/**
 * Single source of truth for which SharePoint subfolder(s) under a request
 * are considered "shared with the external reviewer."
 *
 * Why this exists: the file-list endpoint and the file-download endpoint
 * both need to enforce the same rule, and the rule is a process decision
 * (which Connor's PowerAutomate flow ultimately drives) rather than a
 * code one. Centralizing it lets us:
 *
 *   - swap the folder name without touching either endpoint,
 *   - support a transition period where both old and new names work,
 *   - override per-environment via REVIEWER_MATERIALS_FOLDERS without a
 *     redeploy if Connor renames the folder mid-cycle.
 *
 * Default: `Reviewer_Downloads` (single folder, paired with
 * `Reviewer_Uploads` on the inbound side). Override with a
 * comma-separated list:
 *
 *   REVIEWER_MATERIALS_FOLDERS=Reviewer_Downloads,Reviewer_Materials
 *
 * Matching is folder-name only (not full path), case-insensitive,
 * accepts the folder anywhere in the path so staff can nest subfolders
 * under it (e.g. `Reviewer_Materials/Phase II/`). The regex is anchored
 * on segment boundaries so a folder named `My_Reviewer_Materials_v2`
 * does NOT match.
 */

const DEFAULT_FOLDERS = ['Reviewer_Downloads'];

function loadFolders() {
  const raw = process.env.REVIEWER_MATERIALS_FOLDERS;
  if (!raw) return DEFAULT_FOLDERS;
  const list = raw.split(',').map(s => s.trim()).filter(Boolean);
  return list.length > 0 ? list : DEFAULT_FOLDERS;
}

/**
 * Build the matcher from the current env. Done lazily (on each call)
 * rather than at module-load time so dev hot-reload picks up env edits.
 */
function buildMatcher() {
  const folders = loadFolders();
  // Escape regex metacharacters in folder names; join with | for the
  // alternation. Anchors: start-of-string OR slash, then folder, then
  // slash OR end-of-string.
  const escaped = folders.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(^|/)(${escaped.join('|')})(/|$)`, 'i');
}

/**
 * @param {string} folderPath - Path within the SharePoint library, as
 *   returned by GraphService.listFiles (no leading slash).
 * @returns {boolean} true if the file lives under one of the
 *   reviewer-shared folders.
 */
export function isReviewerMaterial(folderPath) {
  if (typeof folderPath !== 'string' || !folderPath) return false;
  return buildMatcher().test(folderPath);
}

/**
 * Exposed for the few places that want to log or display the configured
 * folder names (e.g. error messages, admin diagnostics).
 */
export function getReviewerMaterialFolders() {
  return loadFolders();
}

/**
 * Single listing implementation for "what files would an external reviewer
 * see for this request." Both the external portal (context.js, which needs
 * the full file metadata to render) and the staff preflight check
 * (materials-preflight.js, which only needs a count) must agree on exactly
 * which files qualify — hoisted here so there is one filter, not two.
 *
 * Non-fatal per bucket: an unavailable/404ing library (archive buckets do
 * this frequently) is logged and skipped rather than failing the whole call.
 *
 * @param {string} requestId - akoya_requestid GUID.
 * @param {string} requestNumber - akoya_requestnum, used to resolve buckets.
 * @param {object} [deps] - injection seam for tests.
 * @returns {Promise<Array<{id,name,size,mimeType,folder,library,source}>>}
 */
export async function listReviewerMaterials(requestId, requestNumber, deps = {}) {
  const {
    getRequestSharePointBuckets: getBuckets = defaultGetRequestSharePointBuckets,
    listFiles = defaultListFiles,
  } = deps;

  const buckets = await getBuckets(requestId, requestNumber);
  const out = [];
  for (const bucket of buckets) {
    try {
      const items = await listFiles(bucket.library, bucket.folder, {
        recursive: true,
        maxDepth: 3,
      });
      for (const f of items) {
        if (!isReviewerMaterial(f.folder || '')) continue;
        out.push({
          id: f.id,
          name: f.name,
          size: f.size,
          mimeType: f.mimeType,
          folder: f.folder,
          library: bucket.library,
          source: bucket.source,
        });
      }
    } catch (e) {
      // Archive libraries 404 frequently — that's expected. Log but continue.
      if (process.env.NODE_ENV === 'development') {
        console.log(`[reviewer-materials] bucket ${bucket.library}/${bucket.folder} unavailable: ${e.message}`);
      }
    }
  }
  return out;
}

// Lazily required so this module has no hard import-time dependency on
// Graph/SharePoint plumbing for callers that only need `isReviewerMaterial`.
async function defaultGetRequestSharePointBuckets(requestId, requestNumber) {
  const { getRequestSharePointBuckets } = await import('../utils/sharepoint-buckets');
  return getRequestSharePointBuckets(requestId, requestNumber);
}

async function defaultListFiles(library, folder, options) {
  const { GraphService } = await import('../services/graph-service');
  return GraphService.listFiles(library, folder, options);
}
