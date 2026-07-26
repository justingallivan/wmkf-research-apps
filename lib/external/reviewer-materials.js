/**
 * Single source of truth for the one SharePoint file under a request that is
 * shared with external reviewers.
 *
 * Why this exists: the file-list endpoint and the file-download endpoint
 * both need to enforce the same rule, and the rule is a process decision
 * (which Connor's PowerAutomate flow ultimately drives) rather than a
 * code one. Centralizing it lets us:
 *
 *   - keep the list and download endpoints on the same fail-closed rule,
 *   - prevent other files in the reviewer-materials folder from leaking,
 *   - bind the exposed filename to the verified request number.
 *
 * Canonical outbound path:
 *
 *   Reviewer Materials/Proposal_{requestNumber}.pdf
 *
 * Folder matching is case-insensitive because SharePoint paths are
 * case-insensitive; the generated filename is exact and case-sensitive.
 * In particular, `Research Phase I Application_<timestamp>.pdf` is an
 * internal source artifact with more information than reviewers receive and
 * must remain invisible even when it sits in the same folder.
 */

const REVIEWER_MATERIALS_FOLDER = 'Reviewer Materials';
const REVIEWER_MATERIALS_FOLDER_MATCHER = /(^|\/)Reviewer Materials$/i;

export function expectedReviewerProposalFilename(requestNumber) {
  const normalized = String(requestNumber ?? '').trim();
  return normalized ? `Proposal_${normalized}.pdf` : null;
}

/**
 * @param {string} folderPath - Path within the SharePoint library, as
 *   returned by GraphService.listFiles (no leading slash).
 * @param {string} filename - SharePoint file name.
 * @param {string|number} requestNumber - Verified akoya_requestnum.
 * @returns {boolean} true only for the request's canonical reviewer PDF.
 */
export function isReviewerProposalFile(folderPath, filename, requestNumber) {
  if (typeof folderPath !== 'string' || !folderPath) return false;
  if (typeof filename !== 'string' || !filename) return false;
  const expectedFilename = expectedReviewerProposalFilename(requestNumber);
  if (!expectedFilename) return false;
  return REVIEWER_MATERIALS_FOLDER_MATCHER.test(folderPath)
    && filename === expectedFilename;
}

/**
 * Exposed for diagnostics and staff-facing messages.
 */
export function getReviewerMaterialFolders() {
  return [REVIEWER_MATERIALS_FOLDER];
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
        if (!isReviewerProposalFile(f.folder || '', f.name, requestNumber)) continue;
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
