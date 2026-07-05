/**
 * API Route: /api/expertise-finder/proposals
 *
 * GET: Query Dynamics for historical proposals, filtered by grant cycle and program.
 *
 * Query parameters:
 *   fiscalYear: string  - e.g. "December 2025" (required)
 *   program: string     - "SE" or "MR" (optional, filters by internal program)
 *
 * Returns: { proposals: [...], totalCount: number }
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import * as grantRequestAdapter from '../../../lib/dataverse/adapters/grant-request.js';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';

// Map dropdown codes to program name matching patterns
const PROGRAM_PATTERNS = {
  SE: ['s&e', 'science & engineering', 'science and engineering'],
  MR: ['medical research'],
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'expertise-finder');
  if (!access) return;

  const { fiscalYear, program } = req.query;

  if (!fiscalYear) {
    return res.status(400).json({ error: 'fiscalYear is required' });
  }

  return bypassDynamicsRestrictions('expertise-finder-proposals', async () => {
  try {
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

    return res.status(200).json({
      proposals,
      totalCount: proposals.length,
      fiscalYear,
      program: program || 'all',
    });
  } catch (error) {
    console.error('[ExpertiseFinder] Proposals query error:', error);
    return res.status(500).json({
      error: 'Failed to query proposals from Dynamics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
  });
}
