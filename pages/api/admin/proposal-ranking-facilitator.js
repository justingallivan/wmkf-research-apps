import { getUserRole, requireAppAccess } from '../../../lib/utils/auth';
import { listAppKeysForUser } from '../../../lib/services/app-access-service';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { handleProposalRankingAdminSettings } from '../../../lib/services/proposal-ranking/service';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Cookie, Authorization');
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: { code: 'method_not_allowed', message: 'Method not allowed.', retryable: false, current: null } });
  }
  const access = await requireAppAccess(req, res, 'proposal-ranking');
  if (!access) return;
  return withDalContext('proposal-ranking-admin-settings', async () => {
    try {
      if (!access.profileId || await getUserRole(access.profileId) !== 'superuser') {
        return res.status(403).json({ error: { code: 'access_denied', message: 'Superuser access is required.', retryable: false, current: null } });
      }
      const apps = await listAppKeysForUser(access.profileId, { throwOnError: true });
      if (!apps.includes('proposal-ranking')) {
        return res.status(403).json({ error: { code: 'access_denied', message: 'Proposal Ranking app access is required.', retryable: false, current: null } });
      }
      const allowedFields = new Set(['systemUserId', 'revision']);
      if (req.method === 'PUT' && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
        || !Object.keys(req.body).every((key) => allowedFields.has(key)))) {
        return res.status(400).json({ error: { code: 'invalid_request', message: 'The settings request contains unsupported fields.', retryable: false, current: null } });
      }
      const result = await handleProposalRankingAdminSettings({ method: req.method, body: req.body, profileId: access.profileId });
      return res.status(200).json(result);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      const body = { error: {
        code: error?.code || 'dependency_unavailable',
        message: status < 500 && error?.publicMessage === true && error?.message
          ? error.message
          : status === 409
            ? 'The facilitator setting changed. Refresh the settings and retry.'
            : 'Proposal Ranking settings could not complete this request. Please retry or contact an administrator.',
        retryable: error?.retryable === true,
        current: error?.current ?? null,
      } };
      if (status >= 500) console.error('proposal-ranking admin settings error:', error);
      return res.status(status).json(body);
    }
  });
}
