/**
 * API: /api/workbench/proposal-documents
 *
 * GET ?requestId=<akoya_requestid GUID> → { slots, otherDocuments, libraries, errors }
 *
 * Lists the request's Phase I SharePoint documents for the Workbench Proposal
 * tab (slot-matched + "other"). Read-only, gated `reviewers`.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 4 wave): method
 * dispatch → auth guard → GUID validation → withDalContext → one service
 * call → result/error→HTTP mapping. Resolution + listing logic lives in
 * lib/services/workbench/proposal-documents-service.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { listWorkbenchProposalDocuments } from '../../../lib/services/workbench/proposal-documents-service';

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

  return withDalContext('workbench-proposal-documents', async () => {
    try {
      const body = await listWorkbenchProposalDocuments({ requestId });
      return res.status(200).json(body);
    } catch (err) {
      if (err instanceof ServiceHttpError) {
        return res.status(err.httpStatus).json(err.body ?? { error: err.message });
      }
      console.error('workbench proposal-documents error:', err);
      return res.status(500).json({
        error: 'Failed to list proposal documents',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
