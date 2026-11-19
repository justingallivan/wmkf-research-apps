/** Read-only Workbench alerts for the authenticated lead PD. */
import { actorRefFromSession, requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { listJ27IntegrityAlerts } from '../../../lib/services/workbench/j27-integrity-jobs';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!await requireAppAccess(req, res, 'reviewers')) return;
  const access = await requireAppAccess(req, res, 'integrity-screener');
  if (!access) return;

  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const alerts = await withDalContext('workbench-j27-integrity-alerts', () =>
      listJ27IntegrityAlerts(actorRefFromSession(access.session)));
    return res.json({ alerts });
  } catch {
    return res.status(503).json({ error: 'Could not check for integrity alerts.' });
  }
}
