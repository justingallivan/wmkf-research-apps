/**
 * API: POST /api/workbench/grantee-deliverables/generate
 *
 * Chunk 3 of the Grantee Deliverables Portal. Staff-initiated from the
 * workbench Awardee tab: generate a house-style rewrite of the applicant
 * abstract and PERSIST it to wmkf_abstractformatted, stamping status ->
 * Drafted (non-downgrade). Idempotency: reuse-existing unless
 * regenerate === true; ETag-conditional write; 412 → reused/409.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 4 series C):
 * method dispatch → auth guard → GUID validation → withDalContext → one
 * service call → result/error→HTTP mapping. Generation/idempotency/status
 * logic lives in
 * lib/services/workbench/grantee-deliverables/generate-service.js.
 *
 * AUTH: requireAppAccess('reviewers') (matches the triage workbench-write
 * precedent). requestId is GUID-validated straight off req.body before it
 * becomes a Dataverse selector.
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { generateDeliverableAbstract } from '../../../../lib/services/workbench/grantee-deliverables/generate-service';

export const config = {
  api: { bodyParser: { sizeLimit: '8kb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  // Read requestId directly off req.body (not via an intermediate var) so the
  // trust-boundary-guid gate tracks the taint root through to the isGuid guard.
  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  // Only a strict boolean true forces regeneration — a string "false" must not.
  const regenerate = req.body?.regenerate === true;

  // GUID-validate BEFORE requestId becomes a record-id selector (check:trust-boundary-guid).
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }

  return withDalContext('grantee-abstract-generate', async () => {
    try {
      const body = await generateDeliverableAbstract({
        requestId,
        regenerate,
        actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
      });
      return res.status(200).json(body);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('[grantee-deliverables/generate] error:', error);
      return res.status(500).json({ error: 'Failed to generate the grantee abstract.' });
    }
  });
}
