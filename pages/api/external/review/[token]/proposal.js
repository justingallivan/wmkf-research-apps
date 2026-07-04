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
import { bypassDynamicsRestrictions } from '../../../../../lib/services/dynamics-context';
import { isReviewerMaterial } from '../../../../../lib/external/reviewer-materials';
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
    const verified = await verifySuggestionToken(token);
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

    const allowed = await bypassDynamicsRestrictions('external-validate-file', () =>
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

    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeFilename(file.filename)}"`,
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
 * fileId) pair appears in one of the reviewer-materials folders. Files
 * outside those folders are not downloadable through the external
 * endpoint regardless of whether the client has their fileId — defense
 * against an attacker brute-forcing or replaying a leaked id from a
 * different surface.
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
      if (!isReviewerMaterial(f.folder || '')) continue;
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
