/**
 * GET /api/external/review/[token]/proposal?fileId=...&library=...
 *
 * Streams a single proposal-related file from SharePoint to the reviewer.
 * Backend authenticates as the app registration; the reviewer never sees a
 * SharePoint URL or token.
 *
 * Defense against arbitrary-file access: we re-list the request's allowed
 * file set and require the requested (library, fileId) tuple to be a
 * member. The client gets these tuples from /context and so can't probe
 * for files outside the request's document graph.
 */

import { verifySuggestionToken, tokenHasOp } from '../../../../../lib/external/verify-suggestion-token';
import { GraphService } from '../../../../../lib/services/graph-service';
import { getRequestSharePointBuckets } from '../../../../../lib/utils/sharepoint-buckets';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { isReviewerProposalFile } from '../../../../../lib/external/reviewer-materials';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const { token, fileId, library } = req.query;
  if (!fileId || !library) {
    return res.status(400).json({ ok: false, reason: 'fileId_and_library_required' });
  }

  try {
    const rl = await checkRateLimit(req, token);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSeconds));
      return res.status(429).json({ ok: false, reason: 'rate_limited' });
    }
    // S333 Stage 4b: trust-model tightening — this route now establishes
    // the trusted context itself (label byte-preserved from the wrap that
    // used to live inside verifySuggestionToken() itself).
    const verified = await withDalContext('external-token-verify', () => verifySuggestionToken(token));
    await recordTokenOutcome(req, token, verified.ok);
    if (!verified.ok) {
      return res.status(verified.reason === 'not_found' ? 404 : 401).json({
        ok: false,
        reason: verified.reason,
      });
    }

    // Fail closed on the token's ops claim: a token minted without
    // 'download_proposal' (or with a missing/malformed ops array) must not be
    // able to stream files, even if the row/hash/expiry checks above passed.
    if (!tokenHasOp(verified, 'download_proposal')) {
      return res.status(403).json({ ok: false, reason: 'op_not_permitted' });
    }

    const { request } = verified;

    const allowed = await withDalContext('external-validate-file', () =>
      isFileInRequestSet(
        request.akoya_requestid,
        request.akoya_requestnum,
        library,
        fileId,
      ),
    );
    if (!allowed) {
      return res.status(403).json({ ok: false, reason: 'file_not_in_request_set' });
    }

    const driveId = await GraphService.getDriveId(library);
    const file = await GraphService.downloadFile(driveId, fileId);

    // Serve the proposal PDF `inline` so the reviewer can open it in a second
    // browser window and keep the review questions visible in the first. The
    // allow-set above admits exactly one file (`Proposal_{requestNum}.pdf`, a
    // filename equality check in isReviewerProposalFile), so an inline-rendered
    // response can't be an attacker-chosen HTML/SVG document. Anything whose
    // reported type isn't a PDF still downloads, and `nosniff` stops the
    // browser from re-deciding the type for us.
    const contentType = file.mimeType || 'application/octet-stream';
    const disposition = contentType === 'application/pdf' ? 'inline' : 'attachment';
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${encodeFilename(file.filename)}"`,
    );
    res.setHeader('Content-Length', file.size);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(file.buffer);
  } catch (e) {
    console.error('[external proposal] error:', e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}

/**
 * Walk the request's SharePoint buckets and check whether the (library,
 * fileId) pair is the verified request's exact reviewer proposal file.
 * Every other file — including internal files in the same SharePoint folder
 * — is not downloadable through the external endpoint regardless of whether
 * the client has its fileId.
 */
async function isFileInRequestSet(requestId, requestNumber, library, fileId) {
  const buckets = await getRequestSharePointBuckets(requestId, requestNumber);
  const targetBuckets = buckets.filter(b => b.library.toLowerCase() === library.toLowerCase());
  if (targetBuckets.length === 0) return false;

  for (const bucket of targetBuckets) {
    let items;
    try {
      items = await GraphService.listFiles(bucket.library, bucket.folder, {
        recursive: true,
        maxDepth: 3,
      });
    } catch {
      continue;
    }
    for (const f of items) {
      if (!isReviewerProposalFile(f.folder || '', f.name, requestNumber)) continue;
      if (f.id === fileId) return true;
    }
  }
  return false;
}

function encodeFilename(name) {
  // RFC 5987-ish: just strip quotes/CR/LF for the filename= attribute. The
  // browser handles the rest. Real Unicode filenames need the `filename*=`
  // form, but for our PDF-heavy file set this is fine.
  return String(name || 'file').replace(/["\r\n]/g, '');
}

export const config = {
  api: {
    responseLimit: '60mb',
  },
};
