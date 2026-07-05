/**
 * API: GET /api/workbench/grantee-deliverables/recipients?requestId=<guid>
 *
 * Chunk 3b of the Grantee Deliverables Portal. Resolves the TWO invite
 * recipients (PI + liaison) with name/email/hasEmail so staff can confirm /
 * override on the Awardee tab before sending (chunk 3c). Read-only.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 4 series C):
 * method dispatch → auth guard → GUID validation → withDalContext → one
 * service call → result/error→HTTP mapping. Resolution lives in
 * lib/services/workbench/grantee-deliverables/recipients-service.js.
 *
 * AUTH: requireAppAccess('reviewers') (workbench norm). requestId
 * GUID-validated off req.query before it becomes a Dataverse selector.
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { resolveGranteeInviteRecipients } from '../../../../lib/services/workbench/grantee-deliverables/recipients-service';

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

  return withDalContext('grantee-recipients', async () => {
    try {
      const body = await resolveGranteeInviteRecipients({ requestId });
      return res.status(200).json(body);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('[grantee-deliverables/recipients] error:', error);
      return res.status(500).json({ error: 'Failed to resolve recipients.' });
    }
  });
}
