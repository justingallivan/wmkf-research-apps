/**
 * API: /api/workbench/resolve-request
 *
 * GET ?requestNumber=1002836 → { requestId, requestNumber, cycleCode, ... }
 *
 * Resolves a human-typed/linked request NUMBER (akoya_requestnum, a STRING
 * field) to the GUID the Workbench page is keyed on, plus light context for the
 * header. Read-only; org-open like the other reviewer surfaces.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { meetingDateToCycleCode, cycleCodeToLabel } from '../../../lib/utils/cycle-code';

const SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
  'akoya_requeststatus',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  '_wmkf_grantprogram_value',
  '_wmkf_programdirector_value',
].join(',');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const requestNumber = req.query.requestNumber ? String(req.query.requestNumber).trim() : '';
  if (!requestNumber) {
    return res.status(400).json({ error: 'requestNumber is required' });
  }

  return bypassDynamicsRestrictions('workbench-resolve-request', async () => {
    try {
      const safe = requestNumber.replace(/'/g, "''");
      const { records } = await DynamicsService.queryRecords('akoya_requests', {
        select: SELECT,
        filter: `akoya_requestnum eq '${safe}'`,
        top: 1,
      });
      const r = records[0];
      if (!r) {
        return res.status(404).json({ error: `No request found for number ${requestNumber}` });
      }

      const cycleCode = r.wmkf_meetingdate ? meetingDateToCycleCode(r.wmkf_meetingdate) : null;
      return res.status(200).json({
        success: true,
        requestId: r.akoya_requestid,
        requestNumber: r.akoya_requestnum,
        title: r.akoya_title || null,
        cycleCode,
        cycleLabel: cycleCode ? cycleCodeToLabel(cycleCode) : null,
        meetingDate: r.wmkf_meetingdate || null,
        requestStatus: r.akoya_requeststatus || null,
        institution: r.wmkf_organizationname || r._akoya_applicantid_value_formatted || null,
        applicant: r._akoya_applicantid_value_formatted || null,
        projectLeader: r._wmkf_projectleader_value_formatted || null,
        grantProgram: r._wmkf_grantprogram_value_formatted || null,
        programDirector: r._wmkf_programdirector_value_formatted || null,
      });
    } catch (err) {
      console.error('workbench resolve-request error:', err);
      return res.status(500).json({
        error: 'Failed to resolve request',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
