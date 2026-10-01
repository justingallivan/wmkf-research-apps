/**
 * /api/workbench/reviewer-roster — HTTP shell for the durable Find-tab roster.
 * The post-auth orchestration and persistence decisions live in
 * `lib/services/workbench/reviewer-roster-service.js`.
 *
 * App-key tuple matches my-candidates.js so the Find tab's `reviewers`/
 * `reviewer-finder` grants both reach it.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import {
  ReviewerRosterError,
  getReviewerRoster,
  recordReviewerRosterCandidates,
  mutateReviewerRoster,
} from '../../../lib/services/workbench/reviewer-roster-service';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Cap candidates per POST — a Find run asks for at most 25, but guard against an
// oversized body regardless.
const MAX_CANDIDATES_PER_POST = 100;

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
};

export default async function handler(req, res) {
  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  try {
    if (req.method === 'GET') {
      const { requestId } = req.query;
      if (typeof requestId !== 'string' || !GUID_RE.test(requestId)) {
        return res.status(400).json({ error: 'Valid requestId (GUID) is required' });
      }
      const result = await getReviewerRoster({ requestId });
      return res.status(200).json(result);
    }

    if (req.method === 'POST') {
      const { requestId, candidates } = req.body || {};
      if (typeof requestId !== 'string' || !GUID_RE.test(requestId)) {
        return res.status(400).json({ error: 'Valid requestId (GUID) is required' });
      }
      if (!Array.isArray(candidates)) {
        return res.status(400).json({ error: 'candidates[] is required' });
      }
      if (candidates.length > MAX_CANDIDATES_PER_POST) {
        return res.status(400).json({ error: `Too many candidates (max ${MAX_CANDIDATES_PER_POST})` });
      }
      const result = await recordReviewerRosterCandidates({ requestId, candidates });
      return res.status(200).json(result);
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      const { requestId, action } = body;
      if (typeof requestId !== 'string' || !GUID_RE.test(requestId)) {
        return res.status(400).json({ error: 'Valid requestId (GUID) is required' });
      }
      const result = await mutateReviewerRoster({
        requestId,
        action,
        candidate: body.candidate,
        candidateKey: body.candidateKey,
        updates: body.updates,
        candidateRefs: body.candidateRefs,
        actor: {
          actorProfileId: access?.profileId || null,
          actorSystemUserId: access?.session?.user?.dynamicsSystemuserId || null,
        },
      });
      return res.status(200).json(result);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (error instanceof ReviewerRosterError) {
      return res.status(error.httpStatus).json(error.body);
    }
    console.error('reviewer-roster error:', error.message);
    return res.status(500).json({ error: 'Reviewer roster operation failed' });
  }
}
