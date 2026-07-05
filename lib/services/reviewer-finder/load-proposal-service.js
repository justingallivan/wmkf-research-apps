/**
 * Reviewer Finder — load-proposal service
 * (Route→Service Consolidation Plan, Stage 3 wave).
 *
 * Holds ALL business logic for POST /api/reviewer-finder/load-proposal;
 * the route is a thin shell (method dispatch, auth, GUID validation, DAL
 * context, HTTP mapping). Given an akoya_request GUID, finds the proposal
 * document on SharePoint, downloads it, uploads to Vercel Blob, and returns
 * the blob URL — which the existing /api/reviewer-finder/analyze pipeline
 * already accepts.
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

import { put } from '@vercel/blob';
import { GraphService } from '../graph-service';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets';
import { classifyFile } from '../grant-reporting/classify-file';
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

function pickProposalBestGuess(files) {
  const proposals = files.filter((f) => f.classification === 'proposal');
  if (proposals.length === 0) return null;

  const tier1 = proposals.filter((f) => /project[\s_\-]*(narrative|description)/i.test(f.name));
  const phaseIIRe = /(?:^|[\s_\-])phase[\s_]?ii(?:[\s_\-]|$)/i;
  const tier2 = proposals.filter((f) => phaseIIRe.test(f.name));

  const extScore = (n) => {
    const s = n.toLowerCase();
    if (s.endsWith('.pdf')) return 0; // pdf preferred for analyze pipeline
    if (s.endsWith('.docx')) return 1;
    return 2;
  };
  const sortByExt = (arr) => arr.slice().sort((a, b) => extScore(a.name) - extScore(b.name));

  if (tier1.length > 0) return sortByExt(tier1)[0];
  if (tier2.length > 0) return sortByExt(tier2)[0];
  return sortByExt(proposals)[0];
}

/**
 * Locate, download, and Blob-upload the proposal document for a request.
 *
 * @param {Object} args
 * @param {string} args.requestId - akoya_request GUID (already validated by the shell)
 * @param {string} [args.fileKey] - explicit "library::folder::filename" override;
 *   when omitted, picks the proposal best-guess via classifyFile + tiered ranking
 * @returns {Promise<Object>} the exact 200 payload
 * @throws {LoadProposalError} 404 request-not-found (default `{ error }` body),
 *   404 no-files (body + requestNumber/libraries), 400 fileKey-not-found
 *   (body + allFiles), 404 no-proposal-classified (body + allFiles)
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

  // 3. Pick the file: explicit override, else proposal best-guess.
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
    picked = pickProposalBestGuess(allFiles);
    if (!picked) {
      throw new LoadProposalError('No proposal-classified file found. Pass fileKey to override.', 404, {
        error: 'No proposal-classified file found. Pass fileKey to override.',
        allFiles,
      });
    }
  }

  // 4. Download and upload to Blob.
  const downloaded = await GraphService.downloadFileByPath(picked.library, picked.folder, picked.name);
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
