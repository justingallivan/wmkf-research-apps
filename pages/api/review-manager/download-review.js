/**
 * GET /api/review-manager/download-review?suggestionId=...&filename=...
 *
 * Stream a completed review back to staff. File lives in SharePoint at
 * `akoya_request/{request}/Reviewer_Uploads/{reviewerSubfolder}/`,
 * pointed at by `wmkf_reviewsharepointfolder`. Streamed via Graph as
 * the foundation's app registration.
 *
 * Authorization scope: staff-shared. Any user with `review-manager` app
 * access can download any review by suggestionId. This is intentional —
 * Review Manager is a shared staff workflow (multiple program directors,
 * grant managers, and the CSO collaborate across proposals), and reviews
 * are not user-owned data. The PD-scoping you see in `my-candidates` and
 * `reviewers.js` is a UX convenience for the default listing view, not an
 * auth boundary.
 *
 * If the org-wide model later changes (e.g., a more sensitive grant program
 * needs PD-only access), tighten by resolving suggestion → request → PD
 * and adding a `_wmkf_programdirector_value === access.session.dynamicsSystemuserId`
 * check here.
 *
 * (The pre-Phase-5 Vercel Blob fallback was retired 2026-05-03; prod
 * had zero rows still pointing at Blob storage at the time of removal.)
 *
 * Caller passes `suggestionId`. Optional `filename` selects a specific
 * file when the upload included multiple; defaults to the primary
 * filename stored on the row (wmkf_reviewfilename).
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { getForDownload } from '../../../lib/dataverse/adapters/reviewer-suggestion';
import { GraphService } from '../../../lib/services/graph-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';

const REVIEW_LIBRARY = 'akoya_request';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const { suggestionId, filename: requestedFilename } = req.query;
  if (!suggestionId || typeof suggestionId !== 'string') {
    return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId required.'] });
  }
  // GUID-validate before it becomes a Dataverse record-id selector (getRecord
  // interpolates it raw into the request URL).
  if (!isGuid(suggestionId)) {
    return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId must be a valid GUID.'] });
  }

  try {
    let suggestion;
    try {
      suggestion = await bypassDynamicsRestrictions('download-review-lookup', () =>
        getForDownload(suggestionId),
      );
    } catch (e) {
      if (/Get record failed \(404\)/.test(e.message || '')) {
        return res.status(404).json({ ok: false, reason: 'not_found' });
      }
      throw e;
    }

    const folder = suggestion?.wmkf_reviewsharepointfolder;
    const primaryFilename = suggestion?.wmkf_reviewfilename;

    if (!folder) {
      return res.status(404).json({ ok: false, reason: 'no_review_on_file' });
    }
    const filename = requestedFilename || primaryFilename;
    if (!filename) {
      return res.status(404).json({ ok: false, reason: 'no_filename_on_row' });
    }
    const file = await GraphService.downloadFileByPath(REVIEW_LIBRARY, folder, filename);
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeFilename(file.filename)}"`,
    );
    res.setHeader('Content-Length', file.size);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(file.buffer);
  } catch (e) {
    console.error('[download-review] error:', e);
    return res.status(500).json({
      ok: false,
      reason: 'server_error',
      details: process.env.NODE_ENV === 'development' ? e.message : undefined,
    });
  }
}

function encodeFilename(name) {
  return String(name || 'review').replace(/["\r\n]/g, '');
}

export const config = {
  api: { responseLimit: '60mb' },
};
