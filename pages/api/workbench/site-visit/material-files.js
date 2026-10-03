/**
 * API: /api/workbench/site-visit/material-files
 *
 * GET ?requestId=<akoya_requestid GUID> → { success, folderFound, slides, participantBios }
 *
 * INTERIM (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §16.13): lists the
 * request's `Site Visit - Slides` and `Site Visit - Participant Bios`
 * SharePoint folders for the Staff Deliberations materials card, so files
 * placed there by hand (no registry row) are visible. Read-only, gated
 * `reviewers`.
 *
 * Thin route shell: method dispatch → auth guard → GUID validation →
 * withDalContext → one service call → result/error→HTTP mapping. Logic lives
 * in lib/services/site-visit-materials/folder-files-service.js.
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { listSiteVisitMaterialFolderFiles } from '../../../../lib/services/site-visit-materials/folder-files-service';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const requestId = req.query.requestId ? String(req.query.requestId).trim() : '';
  if (!requestId) return res.status(400).json({ error: 'requestId is required' });
  if (!GUID_RE.test(requestId)) return res.status(400).json({ error: 'requestId is not a valid GUID' });

  return withDalContext('workbench-site-visit-material-files', async () => {
    try {
      const body = await listSiteVisitMaterialFolderFiles({ requestId });
      return res.status(200).json(body);
    } catch (err) {
      if (err instanceof ServiceHttpError) {
        return res.status(err.httpStatus).json(err.body ?? { error: err.message });
      }
      console.error('workbench site-visit material-files error:', err);
      return res.status(500).json({ error: 'Failed to list site visit materials' });
    }
  });
}
