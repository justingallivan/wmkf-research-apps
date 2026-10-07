import { getUserRole, requireAppAccess } from '../../lib/utils/auth';
import { listAppKeysForUser } from '../../lib/services/app-access-service';
import { withDalContext } from '../../lib/dataverse/core/context';
import { handleProposalRankingAction, handleProposalRankingGet } from '../../lib/services/proposal-ranking/service';

function setPrivateHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Cookie, Authorization');
}

function publicError(error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = error?.code || 'dependency_unavailable';
  const message = status < 500 && error?.publicMessage === true && error?.message
    ? error.message
    : status === 409
      ? 'The round changed or the action could not be confirmed. Refresh the current round and retry.'
      : 'Proposal Ranking could not complete this request. Please retry or contact an administrator.';
  return { status, body: { error: {
    code,
    message,
    retryable: error?.retryable === true,
    current: error?.current ?? null,
  } } };
}

export default async function handler(req, res) {
  setPrivateHeaders(res);
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed', message: 'Method not allowed.', retryable: false, current: null } });
  }
  const access = await requireAppAccess(req, res, 'proposal-ranking');
  if (!access) return;
  const role = access.profileId ? await getUserRole(access.profileId) : null;
  const isSuperuser = role === 'superuser';
  return withDalContext('proposal-ranking-api', async () => {
    try {
      if (!access.profileId || !(await listAppKeysForUser(access.profileId, { throwOnError: true })).includes('proposal-ranking')) {
        return res.status(403).json({ error: { code: 'access_denied', message: 'Proposal Ranking app access is required.', retryable: false, current: null } });
      }
      const response = req.method === 'GET'
        ? await handleProposalRankingGet({
          cycleCode: Array.isArray(req.query.cycleCode) ? null : req.query.cycleCode,
          roundId: Array.isArray(req.query.roundId) ? null : req.query.roundId,
          operationId: Array.isArray(req.query.operationId) ? null : req.query.operationId,
          profileId: access.profileId,
          isSuperuser,
        })
        : await handleProposalRankingAction({
          action: req.body?.action,
          body: req.body,
          profileId: access.profileId,
          isSuperuser,
        });
      return res.status(200).json(response);
    } catch (error) {
      const failure = publicError(error);
      if (failure.status >= 500) console.error('proposal-ranking API error:', error);
      return res.status(failure.status).json(failure.body);
    }
  });
}
