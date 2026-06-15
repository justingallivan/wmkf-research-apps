/**
 * API: GET /api/workbench/reviewer-rollup?requestId=<guid>
 *
 * Lightweight per-request reviewer-stage rollup for the Workbench Overview tab.
 * Counts `wmkf_appreviewersuggestion` rows directly (selected + not applicant-
 * excluded) with NO person/researcher fan-out — unlike `/api/review-manager/
 * reviewers`, which builds full reviewer objects. Overview is the default tab, so
 * it uses this cheaper path (Codex review S260). Same rollup the tier-2 dashboard
 * computes per row — shared via lib/services/reviewer-rollup.js.
 *
 * Read-only; org-open like the other reviewer surfaces.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import {
  fetchReviewerRollup,
  deriveWorkRemaining,
  emptyCounts,
  REVIEWERS_NEEDED,
  WORK_REMAINING_LABEL,
} from '../../../lib/services/reviewer-rollup';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const requestId = req.query.requestId ? String(req.query.requestId).trim() : '';
  // requestId becomes an OData `_wmkf_request_value eq ${id}` selector in
  // fetchReviewerRollup, so GUID-validate at the edge (check:trust-boundary-guid).
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId is not a valid GUID' });
  }

  return bypassDynamicsRestrictions('workbench-reviewer-rollup', async () => {
    try {
      const map = await fetchReviewerRollup([requestId]);
      // Match the returned key case-insensitively: Dataverse can echo
      // `_wmkf_request_value` in a different case than the query value, which would
      // otherwise miss the entry and silently report zero counts (Codex S260).
      const key = Object.keys(map).find((k) => k.toLowerCase() === requestId.toLowerCase());
      const counts = (key && map[key]) || emptyCounts();
      const workRemaining = deriveWorkRemaining(counts);
      return res.status(200).json({
        success: true,
        counts,
        needed: REVIEWERS_NEEDED,
        workRemaining,
        hint: WORK_REMAINING_LABEL[workRemaining] || null,
      });
    } catch (err) {
      console.error('workbench reviewer-rollup error:', err);
      return res.status(500).json({ error: 'Failed to load reviewer rollup' });
    }
  });
}
