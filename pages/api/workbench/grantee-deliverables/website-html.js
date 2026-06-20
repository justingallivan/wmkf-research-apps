/**
 * API: GET /api/workbench/grantee-deliverables/website-html?requestId=<guid>
 *
 * Chunk 8 output (b): the clean, website-ready HTML fragment for ONE awarded
 * research grant, replacing the staff member's manual HTML coding. Returns the
 * assembled award block (institution/location/PI+co-PIs/amount/edited title/
 * abstract body, plus an image <figure> placeholder + caption) as a string the
 * staff member drops into the Foundation site.
 *
 * AUTH: requireAppAccess('reviewers') (workbench norm). This is the STAFF,
 * server-side surface, so it reads the private image ref directly
 * (includeImageRef) — that is the staff/website boundary, distinct from the
 * external grantee-token context route's hasImage-only rule. requestId is
 * GUID-validated off req.query before it becomes a Dataverse selector
 * (check:trust-boundary-guid).
 *
 * Image note: the fragment carries the SharePoint ref in an HTML comment, NOT a
 * public <img src> — public image serving is a separate follow-up. See
 * lib/services/grantee-document-html.js.
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { bypassDynamicsRestrictions } from '../../../../lib/services/dynamics-context';
import { isGuid } from '../../../../lib/utils/guid';
import { assembleGranteeDocument } from '../../../../lib/services/grantee-document-assembly';
import { renderAwardBlock } from '../../../../lib/services/grantee-document-html';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  // GUID-validate off req.query before it becomes a record-id selector (check:trust-boundary-guid).
  const requestId = typeof req.query?.requestId === 'string' ? req.query.requestId.trim() : '';
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }

  return bypassDynamicsRestrictions('grantee-website-html', async () => {
    try {
      const model = await assembleGranteeDocument(requestId, { includeImageRef: true });
      if (!model) {
        return res.status(404).json({ error: `No request found for ${requestId}` });
      }
      const html = renderAwardBlock(model, { includeImage: true });
      return res.status(200).json({ requestId: model.requestId, requestNumber: model.requestNumber, html });
    } catch (error) {
      console.error('[grantee-deliverables/website-html] error:', error);
      return res.status(500).json({ error: 'Failed to assemble website HTML.' });
    }
  });
}
