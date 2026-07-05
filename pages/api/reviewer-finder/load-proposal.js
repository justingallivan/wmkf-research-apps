/**
 * API: /api/reviewer-finder/load-proposal
 *
 * Used by the Dataverse-native entry path (replacing PDF upload). Given an
 * akoya_request GUID, finds the proposal document on SharePoint, downloads
 * it, uploads to Vercel Blob, and returns the blob URL — which the existing
 * /api/reviewer-finder/analyze pipeline already accepts.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 3): method
 * dispatch → auth guard → input validation → withDalContext → one service
 * call → result/error→HTTP mapping. NOTE: the method check runs BEFORE auth
 * — the only reviewer-finder route ordered that way; the characterization
 * tests pin it, so it is preserved exactly. SharePoint lookup/pick/download
 * and the Blob upload live in
 * lib/services/reviewer-finder/load-proposal-service.js.
 *
 * POST body:
 *   - requestId   (required) — akoya_request GUID
 *   - fileKey     (optional) — explicit "library::folder::filename" override.
 *
 * Response: { success, blobUrl, filename, contentType, size, picked,
 *             requestNumber, allFiles[] }
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { loadProposal } from '../../../lib/services/reviewer-finder/load-proposal-service';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 120,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const { requestId, fileKey } = req.body || {};
  if (!requestId) {
    return res.status(400).json({ error: 'requestId is required' });
  }
  // GUID-validate before it becomes a Dataverse record-id selector / SharePoint
  // bucket key (getRecord interpolates it raw into the request URL).
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId is not a valid GUID' });
  }

  return withDalContext('reviewer-finder-load-proposal', async () => {
    try {
      const result = await loadProposal({ requestId, fileKey });
      return res.status(200).json(result);
    } catch (err) {
      if (err instanceof ServiceHttpError) {
        return res.status(err.httpStatus).json(err.body ?? { error: err.message });
      }
      console.error('load-proposal error:', err);
      return res.status(500).json({
        error: 'Failed to load proposal from SharePoint',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
