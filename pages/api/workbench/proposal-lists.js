/**
 * GET/POST /api/workbench/proposal-lists
 *
 * Staff compose surface for proposal list links
 * (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md).
 *   GET  ?cycle=&kind=            → { success, overview }
 *   GET  ?linkId=                 → { success, link, items }
 *   POST { action: 'create', cycle, kind, rosterId? }
 *   POST { action: 'rebuild' | 'revoke', linkId }
 *   POST { action: 'marks', linkId, highlightedRequestIds, ownInstitutionRequestIds }
 * The actor comes only from the authenticated session; a `test` list always
 * goes to that signed-in staff member. The raw token leaves the server only
 * inside `link.url` for the signed-in staff caller.
 */
import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  createProposalList,
  getProposalListDetail,
  getProposalListOverview,
  rebuildProposalList,
  revokeProposalList,
  setProposalListMarks,
} from '../../../lib/services/proposal-lists/list-link-service';

export const config = { api: { bodyParser: { sizeLimit: '128kb' } } };

const FIELDS = {
  create: new Set(['action', 'cycle', 'kind', 'rosterId']),
  rebuild: new Set(['action', 'linkId']),
  revoke: new Set(['action', 'linkId']),
  marks: new Set(['action', 'linkId', 'highlightedRequestIds', 'ownInstitutionRequestIds']),
};

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code });
  }
  console.error('workbench proposal-lists error:', error);
  return res.status(500).json({ error: 'The proposal list could not be processed.' });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  const user = access.session?.user || {};
  const actor = {
    systemUserId: user.dynamicsSystemuserId || null,
    name: user.name || null,
    email: user.azureEmail || user.email || null,
  };

  if (req.method === 'GET') {
    return withDalContext('workbench-proposal-lists-read', async () => {
      try {
        if (req.query?.linkId !== undefined) {
          const detail = await getProposalListDetail({ linkId: String(req.query.linkId || '').trim() });
          return res.status(200).json({ success: true, ...detail });
        }
        const overview = await getProposalListOverview({
          cycleCode: String(req.query?.cycle || ''),
          listKind: String(req.query?.kind || 'ordinary'),
          actor,
        });
        return res.status(200).json({ success: true, overview });
      } catch (error) {
        return sendError(res, error);
      }
    });
  }

  const body = req.body;
  const allowed = body && typeof body === 'object' && !Array.isArray(body)
    && typeof body.action === 'string' && Object.hasOwn(FIELDS, body.action)
    ? FIELDS[body.action]
    : null;
  if (!allowed || Object.keys(body).some((key) => !allowed.has(key))) {
    return res.status(400).json({ error: 'The proposal list request contains unsupported fields.' });
  }
  return withDalContext('workbench-proposal-lists-write', async () => {
    try {
      const linkId = String(body.linkId || '').trim();
      let result;
      if (body.action === 'create') {
        result = await createProposalList({
          cycleCode: String(body.cycle || ''),
          listKind: String(body.kind || ''),
          rosterId: body.rosterId,
          actor,
        });
      } else if (body.action === 'rebuild') {
        result = await rebuildProposalList({ linkId, actor });
      } else if (body.action === 'revoke') {
        result = await revokeProposalList({ linkId, actor });
      } else {
        result = await setProposalListMarks({
          linkId,
          highlightedRequestIds: body.highlightedRequestIds,
          ownInstitutionRequestIds: body.ownInstitutionRequestIds,
          actor,
        });
      }
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
