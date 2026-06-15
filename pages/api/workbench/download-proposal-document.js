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
 *   3. Library allowlisting is enforced by GraphService.getDriveId.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { GraphService } from '../../../lib/services/graph-service';

export const config = {
  api: { responseLimit: false }, // large PDFs / xlsx
};

// Request folders follow `{requestNumber}_{GUIDNoHyphensUpper}`.
const REQUEST_FOLDER_RE = /^(\d+)_([0-9A-F]{32})$/;

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

  // The folder must belong to this request (top-level segment's GUID suffix);
  // subfolders below it (e.g. `1002794_ABCD.../Phase I`) are allowed.
  const topLevel = String(folder).split('/')[0];
  const match = REQUEST_FOLDER_RE.exec(topLevel);
  if (!match || match[2] !== expectedSuffix) {
    return res.status(403).json({ error: 'Folder does not belong to the specified request' });
  }

  try {
    const { buffer, mimeType, filename: resolvedName, size } = await GraphService.downloadFileByPath(
      library,
      String(folder),
      String(filename),
    );

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${resolvedName.replace(/"/g, '\\"')}"`);
    res.setHeader('Content-Length', size);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Binary download (attachment + nosniff + folder/request-GUID validation above).
    // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
    res.send(buffer);
  } catch (error) {
    console.error('Proposal document download error:', error.message);
    if (error.message.includes('not in the allowlist')) {
      return res.status(403).json({ error: 'Access to this document library is not permitted' });
    }
    if (error.message.includes('File not found') || error.message.includes('(404)')) {
      return res.status(404).json({ error: 'File not found' });
    }
    return res.status(502).json({ error: 'Failed to download document from SharePoint' });
  }
}
