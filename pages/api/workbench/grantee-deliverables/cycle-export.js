/**
 * API: GET /api/workbench/grantee-deliverables/cycle-export?cycleCode=J26
 *
 * Chunk 8 output (c): a single standalone, printable HTML page assembling ALL of
 * a board cycle's awarded research abstracts at once — replacing today's manual
 * "compile every abstract into one PDF and post it". Owner decision (S270):
 * format = combined HTML (reuses the same renderer as output b; print-to-PDF in
 * the browser). Response is text/html so staff open/print/save it directly.
 *
 * Scope (mirrors the awardees endpoint): the cycle window
 * (cycleCodeToOdataFilter on wmkf_meetingdate) AND akoya_requeststatus='Active'
 * AND a PI present AND a research program — awarded research only.
 *
 * AUTH: requireAppAccess('reviewers'). No client GUID reaches a selector
 * (cycleCode builds a date filter; program GUIDs are server config), so no
 * trust-boundary concern. STAFF surface → includeImageRef (image figure carries
 * the ref in a comment, never a fabricated public <img src>).
 *
 * On-demand v1 (no cron pre-build): a cycle is ~12–24 awards; per-award assembly
 * runs through a bounded pool. A row that fails to assemble is skipped (fail-soft)
 * rather than failing the whole export.
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import * as grantRequestAdapter from '../../../../lib/dataverse/adapters/grant-request.js';
import { bypassDynamicsRestrictions } from '../../../../lib/services/dynamics-context';
import { cycleCodeToOdataFilter, cycleCodeToLabel } from '../../../../lib/utils/cycle-code';
import { GRANTEE_RESEARCH_PROGRAM_IDS, GRANTEE_AWARDED_STATUS } from '../../../../shared/config/granteeResearchPrograms';
import { assembleGranteeDocument } from '../../../../lib/services/grantee-document-assembly';
import { renderCyclePage } from '../../../../lib/services/grantee-document-html';

const ASSEMBLY_CONCURRENCY = 4;

/** Map ids through assembleGranteeDocument with a bounded worker pool, order-preserving. */
async function assembleAll(requestIds) {
  const results = new Array(requestIds.length).fill(null);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= requestIds.length) return;
      try {
        results[i] = await assembleGranteeDocument(requestIds[i], { includeImageRef: true });
      } catch {
        results[i] = null; // fail-soft: skip this award, keep the rest
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(ASSEMBLY_CONCURRENCY, requestIds.length || 1) }, () => worker()));
  return results.filter(Boolean);
}

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

  return bypassDynamicsRestrictions('grantee-cycle-export', async () => {
    let requestIds;
    let capped = false;
    let totalCount = 0;
    try {
      const { records, totalCount: queriedTotalCount, capped: queryCapped } = await grantRequestAdapter.queryAllRequests({
        select: 'akoya_requestid',
        filter,
        orderby: 'akoya_requestnum asc',
      });
      requestIds = (records || []).map((r) => r.akoya_requestid).filter(Boolean);
      totalCount = queriedTotalCount || requestIds.length;
      capped = Boolean(queryCapped);
    } catch (error) {
      console.error('[grantee-deliverables/cycle-export] query failed:', error);
      return res.status(503).json({ error: 'Awardee query failed.', cycleCode });
    }

    let models;
    try {
      models = await assembleAll(requestIds);
    } catch (error) {
      console.error('[grantee-deliverables/cycle-export] assembly failed:', error);
      return res.status(500).json({ error: 'Failed to assemble cycle export.', cycleCode });
    }

    const html = renderCyclePage(models, {
      cycleLabel: cycleCodeToLabel(cycleCode),
      includeImage: true,
      capped,
      totalCount,
      returnedCount: requestIds.length,
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  });
}
