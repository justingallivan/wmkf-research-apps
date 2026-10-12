/** GET: the text of a transcript or summary for the staff reading page (Workbench and Site Visit card). */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { readStaffPresentationText } from '../../../../lib/services/post-presentation-materials/staff-text-service';

const single = (value) => (Array.isArray(value) ? '' : String(value || '').trim());

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }
  // Reached from the Workbench (reviewers) and the Site Visit card (meeting-tracker).
  const access = await requireAppAccess(req, res, 'reviewers', 'meeting-tracker');
  if (!access) return;
  res.setHeader('Cache-Control', 'private, no-store');
  const requestId = single(req.query.requestId);
  const documentId = single(req.query.documentId);
  if (!isGuid(requestId) || !isGuid(documentId)) return res.status(400).json({ ok: false, reason: 'invalid_request' });
  try {
    const payload = await withDalContext('workbench-presentation-text', () =>
      readStaffPresentationText({ requestId, documentId }));
    return res.status(200).json(payload);
  } catch (error) {
    if (error instanceof ServiceHttpError) {
      return res.status(error.httpStatus).json(error.body || { ok: false, reason: 'unavailable' });
    }
    console.error('[workbench presentation text] failed:', error?.message || error);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
