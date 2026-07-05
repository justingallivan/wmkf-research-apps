/**
 * API: GET /api/workbench/grantee-deliverables/cycle-export?cycleCode=J26
 *
 * Chunk 8 output (c): a single standalone, printable HTML page assembling ALL
 * of a board cycle's awarded research abstracts at once (owner S270: combined
 * HTML; print-to-PDF in the browser). Response is text/html.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 4 series C):
 * method dispatch → auth guard → cycleCode/config validation →
 * withDalContext → one service call → result/error→HTTP mapping. The 200 is
 * an HTML SEND: the shell owns Content-Type + res.send(html); the query /
 * bounded fail-soft assembly / rendering live in
 * lib/services/workbench/grantee-deliverables/cycle-export-service.js.
 *
 * AUTH: requireAppAccess('reviewers'). No client GUID reaches a selector.
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { cycleCodeToOdataFilter } from '../../../../lib/utils/cycle-code';
import { GRANTEE_RESEARCH_PROGRAM_IDS } from '../../../../shared/config/granteeResearchPrograms';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { exportGranteeCycle } from '../../../../lib/services/workbench/grantee-deliverables/cycle-export-service';

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

  return withDalContext('grantee-cycle-export', async () => {
    let html;
    try {
      ({ html } = await exportGranteeCycle({ cycleCode }));
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      // Historical behavior: rendering failures had no generic 500 mapping in
      // this route — propagate unchanged.
      throw error;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  });
}
