/**
 * API: /api/workbench/staff-deliberations
 *
 * GET ?cycleCode=D26 → Phase II-visible/advancing requests in the selected
 * program, cycle, and PD scope, including requests without documents. Each
 * row includes available document facts and recorded SharePoint links.
 * Read-only; the per-request Staff Deliberations tab owns every write.
 *
 * Same `reviewers` app gate as the sibling initial-assessment route.
 */

import { getUserRole, requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { listPreSiteVisitDrafts } from '../../../lib/services/pre-site-visit/cycle-list-service';
import { resolveWriteupViewer } from '../../../lib/services/pre-site-visit/writeup-visibility';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  if (Array.isArray(req.query.cycleCode) || Array.isArray(req.query.programId) || Array.isArray(req.query.scope)) {
    return res.status(400).json({ error: 'cycleCode, programId, and scope must be single values' });
  }
  const cycleCode = req.query.cycleCode ? String(req.query.cycleCode).trim() : '';
  const programId = req.query.programId ? String(req.query.programId).trim() : '';
  if (!/^[A-Za-z]\d{2}$/.test(cycleCode)) {
    return res.status(400).json({ error: 'cycleCode is invalid' });
  }
  if (!isGuid(programId)) {
    return res.status(400).json({ error: 'programId must be a valid Grant Program GUID' });
  }
  const scope = String(req.query.scope || 'my').trim();
  if (!['my', 'all'].includes(scope)) {
    return res.status(400).json({ error: 'scope must be my or all' });
  }
  const callerSystemId = actorRefFromSession(access.session);

  return withDalContext('workbench-staff-deliberations', async () => {
    try {
      const role = access.profileId === null ? 'superuser' : await getUserRole(access.profileId);
      const writeupViewer = await resolveWriteupViewer({
        isSuperuser: role === 'superuser',
        actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
      });
      return res.status(200).json(await listPreSiteVisitDrafts({
        cycleCode, programId, scope, callerSystemId, writeupViewer,
      }));
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
