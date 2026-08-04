/**
 * Reviewer Finder — load-proposal service
 * (Route→Service Consolidation Plan, Stage 3 wave).
 *
 * Holds ALL business logic for POST /api/reviewer-finder/load-proposal;
 * the route is a thin shell (method dispatch, auth, GUID validation, DAL
 * context, HTTP mapping). Given an akoya_request GUID, finds the proposal
 * document at `Reviewer Materials/Proposal_{Request#}.pdf`, with the exact
 * current-cycle fallback `Phase I/ProjectDescription.pdf`, downloads it,
 * uploads it to Vercel Blob, and returns the blob URL — which the existing
 * /api/reviewer-finder/analyze pipeline already accepts. An authenticated
 * explicit fileKey remains available for deliberate historical/ad-hoc work.
 *
 * Contract (plan Decision 3):
 *   - takes a plain argument object, never req/res;
 *   - returns the exact 200 payload { success, blobUrl, filename,
 *     contentType, size, picked, requestNumber, allFiles };
 *   - throws LoadProposalError (extends ServiceHttpError) for the domain
 *     failures; the not-found/fileKey envelopes carry extra keys
 *     (requestNumber/libraries/allFiles), so `body` is set explicitly;
 *   - other failures propagate untyped — the shell maps them to the
 *     historical sanitized 500;
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 *
 * `classifyFile` is imported from its canonical home,
 * lib/services/grant-reporting/classify-file.js (single definition moved
 * there in Stage 5 batch 2, as deferred from the Stage 3 record).
 */

import { createHash } from 'crypto';
import { put, head, BlobNotFoundError } from '@vercel/blob';
import { GraphService } from '../graph-service';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets';
import { classifyFile } from '../grant-reporting/classify-file';
import { isReviewerProposalFile } from '../../external/reviewer-materials';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { ServiceHttpError } from '../service-http-error';

/**
 * Domain error carrying an HTTP status and (where the historical envelope is
 * not plain `{ error }`) the exact JSON body the shell must send.
 */
export class LoadProposalError extends ServiceHttpError {
  constructor(message, httpStatus, body) {
    super(message, { httpStatus, body });
    this.name = 'LoadProposalError';
  }
}

function fileKeyOf(file) {
  return `${file.library}::${file.folder}::${file.name}`;
}

/**
 * Deterministic Blob cache pathname for a picked file (Step 1, proposal blob
 * cache — outputs/reviewer-find-warm-revisit-step0-findings.md "Step 1 —
 * APPROVED"). Keyed by request + file identity (library/folder/name) +
 * version signal (lastModified/size), so a changed SharePoint file — or a
 * staff fileKey override, which picks a different file identity — hashes to
 * a different path and the cache invalidates naturally. The hash keeps the
 * public-store path non-derivable without the request GUID even though the
 * blob itself is `access: 'public'`.
 */
function cachePathFor(requestNumber, requestId, picked) {
  const stable = JSON.stringify({
    requestId,
    library: picked.library,
    folder: picked.folder,
    name: picked.name,
    lastModified: picked.lastModified,
    size: picked.size,
  });
  const hash = createHash('sha256').update(stable).digest('hex').slice(0, 16);
  return `reviewer-finder/${requestNumber}/${hash}/${picked.name}`;
}

function isActiveRequestFile(file) {
  return file.source === 'dynamics'
    && String(file.library || '').toLowerCase() === 'akoya_request';
}

function isCurrentCycleFallback(file) {
  return isActiveRequestFile(file)
    && /(^|\/)Phase I$/i.test(String(file.folder || ''))
    && file.name === 'ProjectDescription.pdf';
}

/**
 * Locate, download, and Blob-upload the proposal document for a request.
 *
 * @param {Object} args
 * @param {string} args.requestId - akoya_request GUID (already validated by the shell)
 * @param {string} [args.fileKey] - explicit "library::folder::filename"
 *   override for deliberate historical/ad-hoc work; when omitted, the active
 *   request's canonical Reviewer Materials proposal wins, with the exact
 *   current-cycle Phase I ProjectDescription PDF as a fallback
 * @returns {Promise<Object>} the exact 200 payload
 * @throws {LoadProposalError} 404 request-not-found (default `{ error }` body),
 *   404 no-files (body + requestNumber/libraries), 400 fileKey-not-found
 *   (body + allFiles), 404 automatic-proposal-missing (body + allFiles),
 *   409 duplicate active canonical/fallback proposals (body + allFiles)
 */
export async function loadProposal({ requestId, fileKey }) {
  // 1. Resolve request_number for SharePoint folder lookup.
  const request = await grantRequestAdapter.getById(requestId, {
    select: grantRequestAdapter.SELECT_PROFILES.IDENTITY,
  });
  if (!request || !request.akoya_requestnum) {
    throw new LoadProposalError(`Request ${requestId} not found or missing request number.`, 404);
  }
  const requestNumber = request.akoya_requestnum;

  // 2. List SharePoint files across all plausible buckets (active + archives).
  const buckets = await getRequestSharePointBuckets(requestId, requestNumber);
  const bucketResults = await Promise.all(
    buckets.map(async (b) => {
      try {
        const raw = await GraphService.listFiles(b.library, b.folder, { recursive: true });
        return { ...b, files: raw, error: null };
      } catch (err) {
        return { ...b, files: [], error: err.message };
      }
    }),
  );

  const seen = new Set();
  const allFiles = [];
  for (const bucket of bucketResults) {
    for (const f of bucket.files) {
      const folder = f.folder || bucket.folder;
      const key = `${bucket.library}::${folder}::${f.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allFiles.push({
        name: f.name,
        size: f.size,
        mimeType: f.mimeType,
        lastModified: f.lastModified,
        library: bucket.library,
        folder,
        source: bucket.source,
        classification: classifyFile(f.name),
      });
    }
  }

  if (allFiles.length === 0) {
    throw new LoadProposalError('No SharePoint files found for this request.', 404, {
      error: 'No SharePoint files found for this request.',
      requestNumber,
      libraries: bucketResults.map((b) => ({ library: b.library, folder: b.folder, error: b.error })),
    });
  }

  // 3. Pick the file: explicit staff override, else the exact active Reviewer
  // Materials proposal, else the one exact current-cycle Phase I fallback.
  // Never infer from classification or other narrative-like filenames.
  let picked = null;
  if (fileKey) {
    picked = allFiles.find((f) => fileKeyOf(f) === fileKey) || null;
    if (!picked) {
      throw new LoadProposalError(`fileKey not found in this request's libraries: ${fileKey}`, 400, {
        error: `fileKey not found in this request's libraries: ${fileKey}`,
        allFiles,
      });
    }
  } else {
    const canonical = allFiles.filter((file) => (
      isActiveRequestFile(file)
      && isReviewerProposalFile(file.folder, file.name, requestNumber)
    ));
    if (canonical.length > 1) {
      const message = `Multiple active canonical reviewer proposals were found for request ${requestNumber}.`;
      throw new LoadProposalError(message, 409, { error: message, allFiles });
    }
    if (canonical.length === 1) {
      [picked] = canonical;
    } else {
      const fallback = allFiles.filter(isCurrentCycleFallback);
      if (fallback.length > 1) {
        const message = `Multiple active Phase I/ProjectDescription.pdf fallback proposals were found for request ${requestNumber}.`;
        throw new LoadProposalError(message, 409, { error: message, allFiles });
      }
      if (fallback.length === 1) {
        [picked] = fallback;
      } else {
        const primaryPath = `Reviewer Materials/Proposal_${requestNumber}.pdf`;
        const fallbackPath = 'Phase I/ProjectDescription.pdf';
        const message = `Reviewer proposal not found at ${primaryPath} or ${fallbackPath}. Choose a request file to override.`;
        throw new LoadProposalError(message, 404, { error: message, allFiles });
      }
    }
  }

  // 4. Deterministic Blob cache: head() first, download+put only on a miss.
  // MaintenanceService.cleanupBlobs (lib/services/maintenance-service.js:376,
  // config.blob_days default 90 — pages/api/cron/maintenance.js:167,
  // lib/services/maintenance-service.js:814) sweeps blobs not referenced by
  // Dataverse/intake_drafts older than that retention window; cached
  // proposal blobs are never in that active set, so a sweep gives this cache
  // a natural TTL of ~90d in production — the next revisit after a sweep is
  // simply a head() miss handled by the normal miss path below.
  const cachePath = cachePathFor(requestNumber, requestId, picked);
  // A missing lastModified/size means JSON.stringify silently drops that key
  // from the hash input, weakening the cache key so a genuinely-changed file
  // could collide with a stale cached entry. Skip the cache check entirely in
  // that case — straight to download+put (old, merely-slow behavior) rather
  // than risk serving a stale proposal to the analyze pipeline.
  const hasReliableVersionSignal = picked.lastModified != null && picked.size != null;
  let cached = null;
  if (hasReliableVersionSignal) {
    try {
      cached = await head(cachePath);
    } catch (err) {
      // Any head() failure (not-found or otherwise) is treated as a cache
      // miss and falls through to download — never fail the request because
      // the cache check itself errored. Only warn for the unexpected case;
      // a plain not-found is the normal first-view/invalidated-cache path.
      if (!(err instanceof BlobNotFoundError)) {
        console.warn('[load-proposal] blob cache check failed (treating as miss):', err?.message);
      }
      cached = null;
    }
  }

  // A head() hit only counts if the stored blob's size still matches the
  // metadata we keyed the cache on. Belt-and-suspenders against the (rare)
  // case of a hash collision or a store entry written under a since-widened
  // key scheme; the miss path's `allowOverwrite: true` self-heals the entry
  // with fresh bytes.
  if (cached && cached.size !== picked.size) {
    console.warn(
      `[load-proposal] blob cache size mismatch (treating as miss): `
      + `cached=${cached.size} expected=${picked.size} request=${requestNumber}`,
    );
    cached = null;
  }

  if (cached) {
    console.log(`[load-proposal] blob cache HIT request=${requestNumber}`);
    return {
      success: true,
      blobUrl: cached.url,
      filename: picked.name,
      contentType: cached.contentType || 'application/pdf',
      size: cached.size,
      picked: fileKeyOf(picked),
      requestNumber,
      allFiles,
    };
  }

  console.log(`[load-proposal] blob cache MISS request=${requestNumber}`);
  const downloaded = await GraphService.downloadFileByPath(picked.library, picked.folder, picked.name);

  // Race guard: the file changed on SharePoint between the listing (step 2)
  // and this download — downloaded bytes no longer match the version key we
  // computed picked/cachePath from. Never persist those bytes under a now-
  // stale version-keyed path (a later revisit could head()-hit it and serve
  // content that doesn't match its own path's version signal); fall back to
  // the pre-cache random-suffix upload so this response is still correct,
  // just uncached.
  if (downloaded.size !== picked.size) {
    console.warn(
      `[load-proposal] downloaded size ${downloaded.size} != listed size ${picked.size} `
      + `for request=${requestNumber} — file changed mid-flight, uploading uncached`,
    );
    const blob = await put(`reviewer-finder/${requestNumber}/${picked.name}`, downloaded.buffer, {
      access: 'public',
      contentType: downloaded.mimeType || 'application/pdf',
      addRandomSuffix: true,
    });
    return {
      success: true,
      blobUrl: blob.url,
      filename: downloaded.filename,
      contentType: downloaded.mimeType,
      size: downloaded.size,
      picked: fileKeyOf(picked),
      requestNumber,
      allFiles,
    };
  }

  const blob = await put(cachePath, downloaded.buffer, {
    access: 'public',
    contentType: downloaded.mimeType || 'application/pdf',
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return {
    success: true,
    blobUrl: blob.url,
    filename: downloaded.filename,
    contentType: downloaded.mimeType,
    size: downloaded.size,
    picked: fileKeyOf(picked),
    requestNumber,
    allFiles,
  };
}
