/**
 * API: /api/workbench/proposal-documents
 *
 * GET ?requestId=<akoya_requestid GUID> → { slots, otherDocuments, libraries, errors }
 *
 * Lists the request's Phase I SharePoint documents for the Workbench Proposal
 * tab (slot-matched + "other"). Read-only, gated `reviewers`. Request number +
 * cycle are resolved server-side (not trusted from the client). Downloads go
 * through /api/workbench/download-proposal-document, which re-validates scope.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { meetingDateToCycleCode } from '../../../lib/utils/cycle-code';
import { listProposalDocuments } from '../../../lib/services/workbench-proposal-documents';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const requestId = req.query.requestId ? String(req.query.requestId).trim() : '';
  if (!requestId) return res.status(400).json({ error: 'requestId is required' });

  return bypassDynamicsRestrictions('workbench-proposal-documents', async () => {
    try {
      let rec;
      try {
        rec = await DynamicsService.getRecord('akoya_requests', requestId, {
          select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate',
        });
      } catch {
        return res.status(404).json({ error: `No request found for ${requestId}` });
      }
      const requestNumber = rec.akoya_requestnum;
      const cycleCode = rec.wmkf_meetingdate ? meetingDateToCycleCode(rec.wmkf_meetingdate) : null;

      const result = await listProposalDocuments(requestId, requestNumber, cycleCode);
      return res.status(200).json({ success: true, ...result });
    } catch (err) {
      console.error('workbench proposal-documents error:', err);
      return res.status(500).json({
        error: 'Failed to list proposal documents',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
