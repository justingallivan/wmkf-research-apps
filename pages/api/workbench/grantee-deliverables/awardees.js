/**
 * API: GET /api/workbench/grantee-deliverables/awardees?cycleCode=J26
 *
 * Lists the research AWARDEES for a board cycle so staff can drive the grantee
 * deliverables workflow without hunting for request GUIDs (the reviewer-finding
 * dashboard doesn't surface awardees — it filters Phase-II-Pending/Advancing).
 *
 * Eligibility (confirmed S268 against live J26, owner-validated = 12):
 *   akoya_requeststatus = 'Active'  (funded)
 *   AND akoya_programid ∈ GRANTEE_RESEARCH_PROGRAM_IDS  (research; EDITABLE config,
 *       keyed by GUID — names may change)
 *   AND wmkf_projectleader present  (has a PI — excludes the standing endowment)
 *
 * AUTH: requireAppAccess('reviewers'). No client GUIDs reach a selector (cycleCode
 * builds a date filter; program GUIDs are server config), so no trust-boundary concern.
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { DynamicsService } from '../../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../../lib/services/dynamics-context';
import { cycleCodeToOdataFilter, cycleCodeToLabel } from '../../../../lib/utils/cycle-code';
import { GRANTEE_RESEARCH_PROGRAM_IDS, GRANTEE_AWARDED_STATUS } from '../../../../shared/config/granteeResearchPrograms';
import { GRANTEE_DELIVERABLE_LABEL } from '../../../../shared/config/granteeDeliverableStatus';

const SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'akoya_title',
  '_wmkf_projectleader_value', '_akoya_primarycontactid_value', '_akoya_programid_value',
  'wmkf_granteedeliverablestatus', 'wmkf_abstractformatted',
].join(',');

const normStatus = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const cycleCode = typeof req.query?.cycleCode === 'string' ? req.query.cycleCode.trim() : '';
  const cycleFilter = cycleCodeToOdataFilter(cycleCode, 'wmkf_meetingdate');
  if (!cycleFilter) {
    return res.status(400).json({ error: 'cycleCode must be a valid cycle (e.g. J26 or D26)' });
  }
  if (!GRANTEE_RESEARCH_PROGRAM_IDS.length) {
    return res.status(500).json({ error: 'No research programs are configured.' });
  }

  const programClause = GRANTEE_RESEARCH_PROGRAM_IDS.map((id) => `_akoya_programid_value eq ${id}`).join(' or ');
  const filter =
    `${cycleFilter} and akoya_requeststatus eq '${GRANTEE_AWARDED_STATUS}'` +
    ` and _wmkf_projectleader_value ne null and (${programClause})`;

  return bypassDynamicsRestrictions('grantee-awardees', async () => {
    try {
      const { records } = await DynamicsService.queryRecords('akoya_requests', {
        select: SELECT,
        filter,
        orderby: 'akoya_requestnum asc',
      });

      const awardees = (records || []).map((r) => {
        const status = normStatus(r.wmkf_granteedeliverablestatus);
        return {
          requestId: r.akoya_requestid,
          requestNumber: r.akoya_requestnum,
          title: r.akoya_title || null,
          pi: { contactId: r._wmkf_projectleader_value || null, name: r._wmkf_projectleader_value_formatted || null },
          liaison: { contactId: r._akoya_primarycontactid_value || null, name: r._akoya_primarycontactid_value_formatted || null },
          program: r._akoya_programid_value_formatted || null,
          status,
          statusLabel: status !== null ? (GRANTEE_DELIVERABLE_LABEL[status] || null) : null,
          abstractReady: Boolean(r.wmkf_abstractformatted),
        };
      });

      return res.status(200).json({ cycleCode, cycleLabel: cycleCodeToLabel(cycleCode), count: awardees.length, awardees });
    } catch (error) {
      console.error('[grantee-deliverables/awardees] error:', error);
      return res.status(500).json({ error: 'Failed to list awardees.' });
    }
  });
}
