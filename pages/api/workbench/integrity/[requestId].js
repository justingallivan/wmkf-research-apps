/** GET the latest persisted request-scoped integrity screening and its people. */
// model-override-warming:ignore reason=integrity-context-read-only
// The shared service also exports the POST runner; this handler only reads
// Dataverse people and saved Postgres results and never resolves an LLM model.
import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { getWorkbenchIntegrityContext } from '../../../../lib/services/workbench/integrity-service';
import { isGuid } from '../../../../lib/utils/guid';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'integrity-screener');
  if (!access) return;

  const rawRequestId = req.query.requestId;
  const requestId = typeof rawRequestId === 'string' ? rawRequestId.trim() : '';
  if (!isGuid(requestId)) return res.status(400).json({ error: 'requestId must be a GUID' });

  return withDalContext('workbench-integrity-latest', async () => {
    try {
      const result = await getWorkbenchIntegrityContext({ requestId });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body || { error: error.message });
      }
      console.error('workbench integrity latest error:', error);
      return res.status(500).json({ error: 'Failed to load integrity screening' });
    }
  });
}
