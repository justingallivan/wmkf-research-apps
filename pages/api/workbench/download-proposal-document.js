/**
 * API Route: /api/workbench/download-proposal-document
 *
 * Authenticated proxy for downloading a request's Proposal-tab SharePoint files.
 * Fetches server-side via GraphService and streams to the browser (no public
 * Blob copy). Modeled on /api/dynamics-explorer/download-document.
 *
 * GET ?requestId=<akoya_requestid GUID>&library=<allowlisted>&folder=<path>&filename=<name>
 *
 * Authorization:
 *   1. Caller must have `reviewers` app access (requireAppAccess).
 *   2. The folder's top-level segment MUST be a request folder whose GUID suffix
 *      matches `requestId` — blocks downloading arbitrary SharePoint content or
 *      probing other requests' folders.
 *   3. The (library, folder, filename) triple must be a Proposal-tab document
 *      the list service surfaces for this request (authoritative membership
 *      check in the service); library allowlisting via GraphService.getDriveId.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 4 wave): method
 * dispatch → auth guard → input validation → withDalContext → one service
 * call → result/error→HTTP mapping. The 200 is BINARY: the shell owns the
 * disposition decision + golden headers + res.send(buffer); lookup/scope/
 * Graph logic lives in
 * lib/services/workbench/download-proposal-document-service.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { downloadProposalDocument } from '../../../lib/services/workbench/download-proposal-document-service';

export const config = {
  api: { responseLimit: false }, // large PDFs / xlsx
};

// Request folders follow `{requestNumber}_{GUIDNoHyphensUpper}`.
const REQUEST_FOLDER_RE = /^(\d+)_([0-9A-F]{32})$/;

// `disposition=inline` is honored ONLY for non-executable, viewable types — so a
// proposal PDF opens in the browser viewer, but an HTML/SVG file (which could run
// script in our origin) can never be served inline. Everything else stays an
// attachment. Combined with X-Content-Type-Options: nosniff, this is fail-closed.
const SAFE_INLINE_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'text/plain']);

function guidToFolderSuffix(requestId) {
  const stripped = String(requestId).replace(/-/g, '').toUpperCase();
  return /^[0-9A-F]{32}$/.test(stripped) ? stripped : null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const { requestId, library, folder, filename } = req.query;
  if (!requestId || !library || !folder || !filename) {
    return res.status(400).json({ error: 'requestId, library, folder, and filename are all required' });
  }

  const expectedSuffix = guidToFolderSuffix(requestId);
  if (!expectedSuffix) {
    return res.status(400).json({ error: 'requestId is not a valid GUID' });
  }

  // Fast fail-closed pre-check: the folder's top-level segment must belong to
  // this request (GUID suffix). Subfolders (e.g. `1002794_ABCD.../Phase I`) are
  // allowed. The authoritative scope check is the service's membership test.
  const topLevel = String(folder).split('/')[0];
  const match = REQUEST_FOLDER_RE.exec(topLevel);
  if (!match || match[2] !== expectedSuffix) {
    return res.status(403).json({ error: 'Folder does not belong to the specified request' });
  }

  return withDalContext('workbench-download-proposal-document', async () => {
    let file;
    try {
      file = await downloadProposalDocument({ requestId, library, folder, filename });
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      // Historical behavior: non-Graph failures outside the download call had
      // no 500 mapping in this route — propagate unchanged.
      throw error;
    }

    const { buffer, mimeType, filename: resolvedName, size } = file;

    // Inline only when explicitly requested AND the type is safe to render in
    // the browser; otherwise force download. nosniff (below) stops content-type
    // confusion, so a non-PDF can't be coerced into inline script execution.
    const wantInline = String(req.query.disposition || '').toLowerCase() === 'inline';
    const dispType = wantInline && SAFE_INLINE_MIME.has(mimeType) ? 'inline' : 'attachment';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `${dispType}; filename="${resolvedName.replace(/"/g, '\\"')}"`);
    res.setHeader('Content-Length', size);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Binary download (attachment + nosniff + request-GUID + membership validation above).
    // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
    res.send(buffer);
  });
}
