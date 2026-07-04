/**
 * API: /api/workbench/export-candidates
 *
 * POST { requestId, candidates: [ slimCandidateDTO, … ] } → .xlsx download
 *
 * Builds a two-sheet reviewer-candidate workbook (Request Info + Candidates) for
 * the PD to share. The enriched candidate data lives only in the Find-tab client
 * (reasoning, COI, ORCID, Scholar are computed at search time and not all
 * persisted), so the client supplies the rows; this route fetches the request
 * metadata (number / institution / PI) AUTHORITATIVELY by requestId — never
 * trusted from the client — and streams back the file.
 *
 * Read-only against Dataverse (one akoya_request read); writes nothing.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import * as grantRequestAdapter from '../../../lib/dataverse/adapters/grant-request';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { meetingDateToCycleCode, cycleCodeToLabel } from '../../../lib/utils/cycle-code';
import { buildReviewerCandidateWorkbook } from '../../../lib/services/reviewer-candidate-export';

const MAX_CANDIDATES = 500;

// Same akoya_request fields resolve-request.js reads for the header context.
const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  '_wmkf_grantprogram_value',
  'wmkf_meetingdate',
].join(',');

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

  return bypassDynamicsRestrictions('workbench-export-candidates', async () => {
    try {
      const r = await grantRequestAdapter.getById(requestGuid, { select: REQUEST_SELECT })
        .catch(() => null);
      if (!r) {
        return res.status(404).json({ error: 'Request not found' });
      }

      const cycleCode = r.wmkf_meetingdate ? meetingDateToCycleCode(r.wmkf_meetingdate) : null;
      const exportedDate = new Date().toISOString().slice(0, 10);
      const meta = {
        requestNumber: r.akoya_requestnum || null,
        institution: r.wmkf_organizationname || r._akoya_applicantid_value_formatted || null,
        pi: r._wmkf_projectleader_value_formatted || null,
        applicant: r._akoya_applicantid_value_formatted || null,
        title: r.akoya_title || null,
        program: r._wmkf_grantprogram_value_formatted || null,
        cycleLabel: cycleCode ? cycleCodeToLabel(cycleCode) : null,
        exportedDate,
      };

      const buf = await buildReviewerCandidateWorkbook({ meta, candidates });

      const safeNum = (meta.requestNumber || 'request').replace(/[^\w.-]+/g, '_');
      const filename = `reviewer-candidates-${safeNum}-${exportedDate}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buf.length);
      return res.status(200).send(buf);
    } catch (err) {
      console.error('export-candidates error:', err);
      return res.status(500).json({
        error: 'Failed to build the export',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
