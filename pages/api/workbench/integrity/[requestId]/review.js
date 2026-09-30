/** Append a lead-PD/superuser disposition to the latest request screening. */
// model-override-warming:ignore reason=integrity-review-audit-write-does-not-resolve-an-LLM-model
import { requireAppAccess } from '../../../../../lib/utils/auth';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import { recordWorkbenchIntegrityReview } from '../../../../../lib/services/workbench/integrity-service';
import { isGuid } from '../../../../../lib/utils/guid';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // The Workbench page loads only with 'reviewers' (resolve-request), and the
  // Integrity tab shows only with 'integrity-screener'; require both here.
  const workbenchAccess = await requireAppAccess(req, res, 'reviewers');
  if (!workbenchAccess) return;
  const access = await requireAppAccess(req, res, 'integrity-screener');
  if (!access) return;

  const rawRequestId = req.query.requestId;
  const requestId = typeof rawRequestId === 'string' ? rawRequestId.trim() : '';
  if (!isGuid(requestId)) return res.status(400).json({ error: 'requestId must be a GUID' });

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !['screeningId', 'decision', 'notes'].includes(key))) {
    return res.status(400).json({ error: 'Body must contain only screeningId, decision, and notes' });
  }
  if (!Number.isSafeInteger(body.screeningId) || body.screeningId < 1) {
    return res.status(400).json({ error: 'screeningId must be a positive safe integer' });
  }
  if (body.decision !== 'approved' && body.decision !== 'hold') {
    return res.status(400).json({ error: 'decision must be approved or hold' });
  }
  if (body.notes !== undefined && typeof body.notes !== 'string') {
    return res.status(400).json({ error: 'notes must be a string' });
  }

  return withDalContext('workbench-integrity-review', async () => {
    try {
      const result = await recordWorkbenchIntegrityReview({
        requestId,
        screeningId: body.screeningId,
        decision: body.decision,
        notes: body.notes ?? '',
        profileId: access.profileId,
        actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body || { error: error.message });
      }
      console.error('workbench integrity review error:', error);
      return res.status(500).json({ error: 'Could not record the screening disposition' });
    }
  });
}
