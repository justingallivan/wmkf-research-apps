/**
 * API Route: /api/dynamics-explorer/download-document
 *
 * Authenticated proxy for downloading SharePoint documents.
 * Fetches the file server-side via GraphService and streams it to the browser.
 *
 * GET /api/dynamics-explorer/download-document
 *   ?requestId=<akoya_requestid GUID>
 *   &library=<one of the allowlisted SharePoint libraries>
 *   &folder=<request folder, optionally with a subfolder suffix>
 *   &filename=<file name>
 *
 * Authorization model:
 *   1. Caller must have dynamics-explorer app access (requireAppAccess).
 *   2. Requested folder path MUST start with a request-folder segment whose
 *      GUID suffix matches the supplied `requestId`. This prevents the proxy
 *      from being used to download arbitrary SharePoint content (templates,
 *      system files, other non-request folders) or to probe other requests'
 *      folders by guessing names.
 *   3. Library allowlisting is enforced downstream by GraphService.getDriveId.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { GraphService } from '../../../lib/services/graph-service';

export const config = {
  api: {
    responseLimit: false, // Allow large file responses (7-10 MB PDFs)
  },
};

// Request folders follow the convention `{requestNumber}_{GUIDNoHyphensUpper}`.
// We validate the whole top-level segment against this regex and then check
// that the GUID suffix matches the supplied requestId.
const REQUEST_FOLDER_RE = /^(\d+)_([0-9A-F]{32})$/;

function guidToFolderSuffix(requestId) {
  const stripped = String(requestId).replace(/-/g, '').toUpperCase();
  return /^[0-9A-F]{32}$/.test(stripped) ? stripped : null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'dynamics-explorer');
  if (!access) return;

  const { requestId, library, folder, filename } = req.query;

  if (!requestId || !library || !folder || !filename) {
    return res.status(400).json({
      error: 'requestId, library, folder, and filename parameters are all required',
    });
  }

  const expectedSuffix = guidToFolderSuffix(requestId);
  if (!expectedSuffix) {
    return res.status(400).json({ error: 'requestId is not a valid GUID' });
  }

  // Validate the top-level folder segment conforms to the request-folder
  // convention AND its GUID suffix matches `requestId`. Subfolders below it
  // (e.g. `1001289_ABCD.../Year 1`) are allowed.
  const topLevel = String(folder).split('/')[0];
  const match = REQUEST_FOLDER_RE.exec(topLevel);
  if (!match || match[2] !== expectedSuffix) {
    return res.status(403).json({
      error: 'Folder does not belong to the specified request',
    });
  }

  try {
    const { buffer, mimeType, filename: resolvedName, size } = await GraphService.downloadFileByPath(
      library,
      folder,
      filename,
    );

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${resolvedName.replace(/"/g, '\\"')}"`);
    res.setHeader('Content-Length', size);
    res.setHeader('Cache-Control', 'private, max-age=300');
    // Belt-and-suspenders with the attachment disposition: stop the browser
    // MIME-sniffing a SharePoint file into an inline-executable type.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Binary file download (attachment disposition + nosniff + upstream
    // folder/request-GUID validation above). res.send of the buffer is correct.
    // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
    res.send(buffer);
  } catch (error) {
    console.error('Document download error:', error.message);

    if (error.message.includes('not in the allowlist')) {
      return res.status(403).json({ error: 'Access to this document library is not permitted' });
    }
    if (error.message.includes('File not found') || error.message.includes('(404)')) {
      return res.status(404).json({ error: 'File not found' });
    }

    return res.status(502).json({ error: 'Failed to download document from SharePoint' });
  }
}
