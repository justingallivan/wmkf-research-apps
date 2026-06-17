/**
 * API: /api/workbench/promote-applicant-reviewer
 *
 * POST { requestId, suggestionId }
 *
 * Explicitly promotes one applicant-recommended reviewer into the request's
 * candidate pool by selecting the existing wmkf_appreviewersuggestion junction
 * row. Applicant ingestion creates these rows unselected; this route is the PD
 * action that flips wmkf_selected=true.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import * as reviewerSuggestionAdapter from '../../../lib/dataverse/adapters/reviewer-suggestion';
import { APPLICANT_DISPOSITION_MAP } from '../../../lib/dataverse/adapters/reviewer-suggestion';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const { requestId, suggestionId } = req.body || {};
  const requestGuid = typeof requestId === 'string' ? requestId.trim() : '';
  const suggestionGuid = typeof suggestionId === 'string' ? suggestionId.trim() : '';
  if (!isGuid(requestGuid) || !isGuid(suggestionGuid)) {
    return res.status(400).json({ error: 'requestId and suggestionId must be GUIDs' });
  }

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  return bypassDynamicsRestrictions('workbench-promote-applicant-reviewer', async () => {
    try {
      const row = await reviewerSuggestionAdapter.findById(suggestionGuid);
      if (!row || String(row._wmkf_request_value || '').toLowerCase() !== requestGuid.toLowerCase()) {
        return res.status(404).json({ error: 'Applicant reviewer suggestion not found for this request' });
      }
      if (row.wmkf_applicantdisposition !== APPLICANT_DISPOSITION_MAP.recommended) {
        return res.status(400).json({ error: 'Only applicant-recommended reviewers can be promoted' });
      }

      await reviewerSuggestionAdapter.updateLifecycle(
        suggestionGuid,
        { selected: true },
        { actingUserSystemId },
      );

      return res.status(200).json({ success: true, suggestionId: suggestionGuid });
    } catch (err) {
      if (/applicant-excluded/i.test(err?.message || '')) {
        return res.status(400).json({ error: 'Only applicant-recommended reviewers can be promoted' });
      }
      console.error('promote-applicant-reviewer error:', err);
      return res.status(500).json({
        error: 'Failed to promote applicant reviewer',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
