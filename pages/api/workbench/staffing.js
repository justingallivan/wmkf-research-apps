/** Shared staffing editor for superusers and the current Grants Manager; no general Admin authority. */
import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { loadStaffing, staffingCapabilities, saveRole } from '../../../lib/services/board-writeups/config';
import { exact, fail } from '../../../lib/services/board-writeups/model';
export const config = { api: { bodyParser: { sizeLimit: '8kb' } }, maxDuration: 300 };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  const actor = { profileId: access.profileId, systemUserId: access.session?.user?.dynamicsSystemuserId };
  return withDalContext('shared-staffing', async () => {
    try {
      if (req.method === 'GET') {
        exact(req.query || {}, ['capabilities']);
        if (req.query?.capabilities !== undefined && req.query.capabilities !== 'true') fail('staffing_query_invalid', 'Unsupported staffing request.', 400);
        return res.json(await (req.query?.capabilities === 'true' ? staffingCapabilities(actor) : loadStaffing(actor)));
      }
      exact(req.body, ['role', 'value', 'expectedRevision']);
      if (!['president', 'cso', 'grantsManager'].includes(req.body.role)) fail('staffing_role_invalid', 'Choose a supported shared role.', 400);
      return res.json(await saveRole(actor, req.body.role, req.body.value, req.body.expectedRevision));
    } catch (error) {
      return res.status(error.httpStatus || error.status || 500).json({ error: error.httpStatus ? error.message : 'Staffing could not be updated. Reload the assignments before trying again.', code: error.code || 'staffing_unavailable' });
    }
  });
}
