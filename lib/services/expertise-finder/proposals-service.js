/**
 * Expertise Finder — historical-proposals query service (Route→Service
 * Consolidation Plan, Stage 5).
 *
 * Holds the business logic for GET /api/expertise-finder/proposals; the route
 * is a thin shell (method dispatch, app-access guard, input validation, DAL
 * context, HTTP mapping).
 *
 * Contract (plan Decision 3):
 *   - plain argument object, never req/res;
 *   - returns the exact 200 envelope the route historically sent;
 *   - Dataverse errors propagate raw; the shell maps them to the historical
 *     500 envelope (dev-only details);
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';

// Map dropdown codes to program name matching patterns
const PROGRAM_PATTERNS = {
  SE: ['s&e', 'science & engineering', 'science and engineering'],
  MR: ['medical research'],
};

/**
 * Query historical proposals for a grant cycle, optionally filtered by program.
 *
 * @param {Object} args
 * @param {string} args.fiscalYear - e.g. "December 2025" (already validated by the shell)
 * @param {string} [args.program] - "SE" or "MR"
 * @returns {Promise<{ proposals: Array, totalCount: number, fiscalYear: string, program: string }>}
 */
export async function queryProposals({ fiscalYear, program }) {
  const result = await grantRequestAdapter.queryAllRequests({
    select: [
      'akoya_requestid', 'akoya_requestnum', 'akoya_title', 'akoya_fiscalyear',
      'wmkf_phaseistatus', 'wmkf_phaseiistatus',
      '_akoya_programid_value', '_akoya_applicantid_value', '_wmkf_projectleader_value',
      '_wmkf_programdirector_value',
    ].join(','),
    filter: `akoya_fiscalyear eq '${fiscalYear}' and wmkf_request_type eq 100000001`,
    orderby: 'akoya_requestnum asc',
  });

  let proposals = result.records.map(r => ({
    requestId: r.akoya_requestid,
    requestNumber: r.akoya_requestnum,
    title: r.akoya_title || 'Untitled',
    program: r._akoya_programid_value_formatted || '',
    programId: r._akoya_programid_value || '',
    institution: r._akoya_applicantid_value_formatted || '',
    pi: r._wmkf_projectleader_value_formatted || '',
    actualPd: r._wmkf_programdirector_value_formatted || '',
    phaseIStatus: r.wmkf_phaseistatus_formatted || String(r.wmkf_phaseistatus || ''),
    phaseIIStatus: r.wmkf_phaseiistatus_formatted || String(r.wmkf_phaseiistatus || ''),
  }));

  // Filter by program if specified
  if (program && PROGRAM_PATTERNS[program]) {
    const patterns = PROGRAM_PATTERNS[program];
    proposals = proposals.filter(p => {
      const name = p.program.toLowerCase();
      return patterns.some(pat => name.includes(pat));
    });
  }

  return {
    proposals,
    totalCount: proposals.length,
    fiscalYear,
    program: program || 'all',
  };
}
