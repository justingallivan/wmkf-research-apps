/**
 * API: /api/workbench/resolve-request
 *
 * GET ?requestNumber=1002836 (or ?requestId=<GUID>) → { requestId,
 * requestNumber, cycleCode, ... } — the Workbench page key plus light header/
 * Status-tab/Proposal-tab context. Read-only; org-open like the other
 * reviewer surfaces.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 4 wave): method
 * dispatch → auth guard → input validation → withDalContext → one service
 * call → result/error→HTTP mapping. Resolution + DTO projection live in
 * lib/services/workbench/resolve-request-service.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { resolveWorkbenchRequest } from '../../../lib/services/workbench/resolve-request-service';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  // Resolve by GUID (the Workbench route always has it) OR by human request
  // number (dashboard links / typed). GUID is preferred so the per-request shell
  // can always load context — header, empty-states, and the fail-closed canManage mirror
  // must not depend on the optional ?n= number being present (Codex S209 catch).
  const requestId = req.query.requestId ? String(req.query.requestId).trim() : '';
  const requestNumber = req.query.requestNumber ? String(req.query.requestNumber).trim() : '';
  if (!requestId && !requestNumber) {
    return res.status(400).json({ error: 'requestId or requestNumber is required' });
  }
  // GUID-validate requestId before it becomes a Dataverse record-id selector
  // (parity with the other workbench routes). requestNumber is a string lookup,
  // escaped at its filter in the adapter.
  if (requestId && !GUID_RE.test(requestId)) {
    return res.status(400).json({ error: 'requestId is not a valid GUID' });
  }

  return withDalContext('workbench-resolve-request', async () => {
    try {
      const body = await resolveWorkbenchRequest({ requestId, requestNumber });
      return res.status(200).json(body);
    } catch (err) {
      if (err instanceof ServiceHttpError) {
        return res.status(err.httpStatus).json(err.body ?? { error: err.message });
      }
      console.error('workbench resolve-request error:', err);
      return res.status(500).json({
        error: 'Failed to resolve request',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
