/**
 * API: GET /api/workbench/grantee-deliverables/awardees?cycleCode=J26
 *
 * Lists the research AWARDEES for a board cycle so staff can drive the grantee
 * deliverables workflow without hunting for request GUIDs. Scope (S271):
 * defaults to the logged-in user's awardees; `?scope=all` lists everyone.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 4 series C):
 * method dispatch → auth guard → cycleCode/config validation →
 * withDalContext → one service call → result/error→HTTP mapping.
 * Eligibility filter + PD scoping + projection live in
 * lib/services/workbench/grantee-deliverables/awardees-service.js.
 *
 * AUTH: requireAppAccess('reviewers'). No client GUIDs reach a selector
 * (cycleCode builds a date filter; program GUIDs are server config; PD id is
 * server-resolved).
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { cycleCodeToOdataFilter } from '../../../../lib/utils/cycle-code';
import { GRANTEE_RESEARCH_PROGRAM_IDS } from '../../../../shared/config/granteeResearchPrograms';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { listGranteeAwardees } from '../../../../lib/services/workbench/grantee-deliverables/awardees-service';

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

  const showAll = req.query?.scope === 'all';
  const azureEmail = access.session?.user?.azureEmail || null;

  return withDalContext('grantee-awardees', async () => {
    try {
      const body = await listGranteeAwardees({ cycleCode, showAll, azureEmail });
      return res.status(200).json(body);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('[grantee-deliverables/awardees] error:', error);
      return res.status(500).json({ error: 'Failed to list awardees.' });
    }
  });
}
