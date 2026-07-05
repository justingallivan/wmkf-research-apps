/**
 * API: /api/workbench/export-candidates
 *
 * POST { requestId, candidates: [ slimCandidateDTO, … ] } → .xlsx download
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 4 wave): method
 * dispatch → auth guard → input validation → withDalContext → one service
 * call → result/error→HTTP mapping. The 200 is BINARY (the shell owns the
 * headers + res.send(buffer)); workbook building + authoritative request-
 * metadata fetch live in lib/services/workbench/export-candidates-service.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { exportCandidates } from '../../../lib/services/workbench/export-candidates-service';

const MAX_CANDIDATES = 500;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const { requestId, candidates } = req.body || {};
  const requestGuid = typeof requestId === 'string' ? requestId.trim() : '';
  if (!isGuid(requestGuid)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return res.status(400).json({ error: 'candidates must be a non-empty array' });
  }
  if (candidates.length > MAX_CANDIDATES) {
    return res.status(400).json({ error: `Too many candidates (max ${MAX_CANDIDATES})` });
  }

  return withDalContext('workbench-export-candidates', async () => {
    try {
      const { buffer, filename } = await exportCandidates({ requestId: requestGuid, candidates });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      return res.status(200).send(buffer);
    } catch (err) {
      if (err instanceof ServiceHttpError) {
        return res.status(err.httpStatus).json(err.body ?? { error: err.message });
      }
      console.error('export-candidates error:', err);
      return res.status(500).json({
        error: 'Failed to build the export',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
