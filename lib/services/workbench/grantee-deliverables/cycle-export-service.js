/**
 * Workbench grantee-deliverables — combined cycle-export service
 * (Route→Service Consolidation Plan, Stage 4 series C).
 *
 * Holds ALL business logic for GET /api/workbench/grantee-deliverables/
 * cycle-export (chunk 8 output c); the route is a thin shell (method, auth,
 * cycleCode/config validation, DAL context, HTTP mapping — the 200 is
 * text/html: the shell owns the Content-Type header + res.send, the service
 * returns the rendered page string; binary/send-in-shell pattern).
 *
 * Scope mirrors the awardees endpoint: cycle window AND Active AND PI present
 * AND research program. STAFF surface → includeImageRef. On-demand v1: a
 * cycle is ~12–24 awards; per-award assembly runs through a bounded pool; a
 * row that fails to assemble is skipped (fail-soft).
 *
 * Contract (plan Decision 3): plain args; returns { html }; throws
 * ServiceHttpError with EXPLICIT bodies (the historical envelopes carry
 * `cycleCode` beyond `{ error }`): 503 query failure, 500 assembly failure.
 * Anything else propagates untyped (the historical route had no generic 500
 * mapping — the shell rethrows). ASSUMES a trusted DAL context.
 */

import * as grantRequestAdapter from '../../../dataverse/adapters/grant-request.js';
import { cycleCodeToOdataFilter, cycleCodeToLabel } from '../../../utils/cycle-code';
import { GRANTEE_RESEARCH_PROGRAM_IDS, GRANTEE_AWARDED_STATUS } from '../../../../shared/config/granteeResearchPrograms';
import { assembleGranteeDocument } from '../../grantee-document-assembly';
import { renderCyclePage } from '../../grantee-document-html';
import { ServiceHttpError } from '../../service-http-error';

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

/**
 * @param {Object} args
 * @param {string} args.cycleCode - already validated by the shell
 * @returns {Promise<{ html: string }>}
 * @throws {ServiceHttpError} 503 { error, cycleCode } / 500 { error, cycleCode }
 */
export async function exportGranteeCycle({ cycleCode }) {
  const cycleFilter = cycleCodeToOdataFilter(cycleCode, 'wmkf_meetingdate');
  const programClause = GRANTEE_RESEARCH_PROGRAM_IDS.map((id) => `_akoya_programid_value eq ${id}`).join(' or ');
  const filter =
    `${cycleFilter} and akoya_requeststatus eq '${GRANTEE_AWARDED_STATUS}'` +
    ` and _wmkf_projectleader_value ne null and (${programClause})`;

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
    throw new ServiceHttpError('Awardee query failed.', {
      httpStatus: 503,
      body: { error: 'Awardee query failed.', cycleCode },
    });
  }

  let models;
  try {
    models = await assembleAll(requestIds);
  } catch (error) {
    console.error('[grantee-deliverables/cycle-export] assembly failed:', error);
    throw new ServiceHttpError('Failed to assemble cycle export.', {
      httpStatus: 500,
      body: { error: 'Failed to assemble cycle export.', cycleCode },
    });
  }

  const html = renderCyclePage(models, {
    cycleLabel: cycleCodeToLabel(cycleCode),
    includeImage: true,
    capped,
    totalCount,
    returnedCount: requestIds.length,
  });
  return { html };
}
