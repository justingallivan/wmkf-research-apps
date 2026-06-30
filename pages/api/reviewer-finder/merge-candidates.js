/**
 * API Route: /api/reviewer-finder/merge-candidates  (Dataverse-backed)
 *
 * Collapse a DUPLICATE wmkf_potentialreviewers row (loser) into a keeper. v1 is
 * scoped to a PRE-ENGAGEMENT, non-promoted loser; the service block predicate
 * fails closed otherwise (returns 409 with reasons). Design: docs/REVIEWER_MERGE_DESIGN.md.
 *
 * POST { keeperId, loserId }                       → 200 { plan }   (read-only diff)
 * POST { keeperId, loserId, fieldChoices, confirm:true } → 200 { summary }
 *
 * Auth = same as my-candidates (the edit this grew from): the fail-closed block
 * predicate — not a permission gate — is what keeps merge to the low-risk case,
 * so a regular reviewer-finder/reviewers user can fix a duplicate they hit
 * (S289 decision; supersedes the earlier superuser-gate proposal).
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { planMerge, executeMerge, projectMergePlanForClient } from '../../../lib/services/reviewer-merge';

export default async function handler(req, res) {
  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { keeperId, loserId, fieldChoices, confirm } = req.body || {};

  // Trust-boundary: client-supplied ids become Dataverse selectors — GUID-validate
  // here before they reach the service/adapters.
  if (!isGuid(keeperId)) return res.status(400).json({ error: 'keeperId must be a valid GUID' });
  if (!isGuid(loserId)) return res.status(400).json({ error: 'loserId must be a valid GUID' });

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  return bypassDynamicsRestrictions('merge-candidates', async () => {
    try {
      if (!confirm) {
        const plan = await planMerge({ keeperId, loserId });
        return res.status(200).json({ plan: projectMergePlanForClient(plan) });
      }
      const summary = await executeMerge({ keeperId, loserId, fieldChoices, actingUserSystemId });
      return res.status(200).json({ success: true, summary });
    } catch (err) {
      if (err?.code === 'merge_validation') return res.status(400).json({ error: err.message });
      if (err?.code === 'merge_blocked') return res.status(409).json({ error: err.message, reasons: err.reasons });
      if (err?.code === 'merge_applicant_provenance_conflict') {
        return res.status(409).json({ error: err.message, code: err.code, requestId: err.requestId });
      }
      if (err?.code === 'merge_retryable_replan') {
        return res.status(409).json({
          error: 'Concurrent modification - re-plan and retry',
          code: 'merge_retryable_replan',
          retryable: true,
          action: 'replan',
          step: err.step,
          operation: err.operation,
          reason: err.reason,
        });
      }
      if (err?.code === 'merge_email_move_failed') {
        return res.status(500).json({
          error: 'Merge failed during email transfer',
          code: 'merge_email_move_failed',
        });
      }
      console.error('merge-candidates error:', err);
      return res.status(500).json({
        error: 'Merge failed',
        details: process.env.NODE_ENV === 'development' ? err?.message : undefined,
      });
    }
  });
}
