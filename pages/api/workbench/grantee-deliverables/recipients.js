/**
 * API: GET /api/workbench/grantee-deliverables/recipients?requestId=<guid>
 *
 * Chunk 3b of the Grantee Deliverables Portal. Resolves the TWO invite
 * recipients for a research grant (owner-confirmed S268, Research-only scope):
 *   - PI      = akoya_request.wmkf_projectleader   → contact
 *   - Liaison = akoya_request.akoya_primarycontactid → contact (the institution's
 *               WMKF foundation liaison / grant steward — NOT the PI)
 * Returns each contact's name + emailaddress1 + a hasEmail flag. Staff confirm /
 * override these on the Awardee tab before sending (chunk 3c). Read-only.
 *
 * AUTH: requireAppAccess('reviewers') (workbench norm). requestId GUID-validated
 * off req.query before it becomes a Dataverse selector (trust-boundary gate).
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { DynamicsService } from '../../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../../lib/services/dynamics-context';
import { isGuid } from '../../../../lib/utils/guid';

const CONTACT_SELECT = 'contactid,fullname,firstname,lastname,emailaddress1';

async function resolveContact(id) {
  if (!id) return { contactId: null, name: null, email: null, hasEmail: false };
  let c;
  try {
    c = await DynamicsService.getRecord('contacts', id, { select: CONTACT_SELECT });
  } catch {
    // Lookup points at a contact we can't read — surface the id but no PII.
    return { contactId: id, name: null, email: null, hasEmail: false };
  }
  const name = c.fullname || `${c.firstname || ''} ${c.lastname || ''}`.trim() || null;
  const email = c.emailaddress1 || null;
  return { contactId: c.contactid || id, name, email, hasEmail: Boolean(email) };
}

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

  return bypassDynamicsRestrictions('grantee-recipients', async () => {
    try {
      let row;
      try {
        row = await DynamicsService.getRecord('akoya_requests', requestId, {
          select: 'akoya_requestid,_wmkf_projectleader_value,_akoya_primarycontactid_value',
        });
      } catch {
        row = null;
      }
      if (!row?.akoya_requestid) {
        return res.status(404).json({ error: `No request found for ${requestId}` });
      }

      // Contact GUIDs come from the request row (server-sourced), not client input.
      const [pi, liaison] = await Promise.all([
        resolveContact(row._wmkf_projectleader_value),
        resolveContact(row._akoya_primarycontactid_value),
      ]);

      return res.status(200).json({ pi, liaison });
    } catch (error) {
      console.error('[grantee-deliverables/recipients] error:', error);
      return res.status(500).json({ error: 'Failed to resolve recipients.' });
    }
  });
}
