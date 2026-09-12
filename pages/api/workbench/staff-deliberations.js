/**
 * API: /api/workbench/staff-deliberations
 *
 * GET ?cycleCode=D26 → every request in the cycle with a Pre-Site Visit Word
 * draft, each with its current draft's operation/lifecycle state and recorded
 * SharePoint link. Read-only; the per-request Staff Deliberations tab owns
 * every write.
 *
 * Same `reviewers` app gate as the sibling initial-assessment route.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { listPreSiteVisitDrafts } from '../../../lib/services/pre-site-visit/cycle-list-service';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const cycleCode = req.query.cycleCode ? String(req.query.cycleCode).trim() : '';
  if (!/^[A-Za-z]\d{2}$/.test(cycleCode)) {
    return res.status(400).json({ error: 'cycleCode is invalid' });
  }
  const scope = String(req.query.scope || '').trim() === 'my' ? 'my' : 'all';
  const callerSystemId = actorRefFromSession(access.session);

  return withDalContext('workbench-staff-deliberations', async () => {
    try {
      return res.status(200).json(await listPreSiteVisitDrafts({ cycleCode, scope, callerSystemId }));
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('workbench staff-deliberations error:', error);
      return res.status(500).json({
        error: 'Staff Deliberations list failed.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  });
}
