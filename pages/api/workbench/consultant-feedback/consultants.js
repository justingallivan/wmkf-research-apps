/**
 * API: /api/workbench/consultant-feedback/consultants
 * (docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md §3.4)
 *
 * GET → active `expertise_roster` rows with `role_type = 'Consultant'`,
 * id/name/affiliation only. Dropdown source for the "Add feedback" form's
 * consultant combobox.
 *
 * Same `reviewers` app gate as the sibling `consultant-feedback` route.
 */
import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { listEligibleConsultants } from '../../../../lib/services/consultant-feedback-service';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  return withDalContext('workbench-consultant-feedback-consultants', async () => {
    try {
      return res.status(200).json({ items: await listEligibleConsultants() });
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('workbench consultant-feedback consultants error:', error);
      return res.status(500).json({
        error: 'Consultant list failed.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  });
}
