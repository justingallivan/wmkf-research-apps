/**
 * GET/POST /api/workbench/pre-site-visit/briefing-link
 *
 * Staff read and lifecycle for the deliberation briefing link
 * (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.3, D15/D16).
 *   GET  ?requestId=   → { success, link: {id,url,expiresAt,createdAt}|null }
 *   POST { requestId, action: 'ensure' | 'reissue', expectedLinkId? } → { success, link, reused }
 *   (`expectedLinkId` makes reissue a compare-and-swap on the link the tab showed)
 * The actor comes only from the authenticated session; the raw token leaves
 * the server only inside `link.url` for the signed-in staff caller.
 */
import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import {
  ensureLiveBriefingLink,
  getLiveBriefingLink,
  reissueBriefingLink,
} from '../../../../lib/services/deliberation-briefing/briefing-link-service';

export const config = { api: { bodyParser: { sizeLimit: '4kb' } } };

const ALLOWED = new Set(['requestId', 'action', 'expectedLinkId']);
const ACTIONS = new Set(['ensure', 'reissue']);

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code });
  }
  console.error('workbench briefing-link error:', error);
  return res.status(500).json({ error: 'The briefing link could not be processed.' });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  if (req.method === 'GET') {
    return withDalContext('workbench-briefing-link-read', async () => {
      try {
        const link = await getLiveBriefingLink({ requestId: String(req.query?.requestId || '').trim() });
        return res.status(200).json({ success: true, link });
      } catch (error) {
        return sendError(res, error);
      }
    });
  }

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || Object.keys(req.body).some((key) => !ALLOWED.has(key))
    || !ACTIONS.has(req.body.action)) {
    return res.status(400).json({ error: 'The briefing link request contains unsupported fields.' });
  }
  const actorId = access.session?.user?.dynamicsSystemuserId || null;
  const input = { requestId: String(req.body.requestId || '').trim(), actorId };
  return withDalContext('workbench-briefing-link-write', async () => {
    try {
      const result = req.body.action === 'reissue'
        ? await reissueBriefingLink({
          ...input,
          expectedLinkId: typeof req.body.expectedLinkId === 'string' ? req.body.expectedLinkId.trim() : undefined,
        })
        : await ensureLiveBriefingLink(input);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
