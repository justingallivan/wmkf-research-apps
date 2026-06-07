/**
 * GET /api/api-capabilities
 *
 * Reports which optional, foundation-wide third-party API integrations are
 * configured on the server. Used by the UI to enable/disable feature toggles
 * (e.g., the ORCID and SerpAPI tiers in Reviewer Finder's contact enrichment).
 *
 * All third-party API keys (ORCID, NCBI, SerpAPI) are server-side env vars
 * shared across the foundation; per-user storage was removed in the
 * 2026-04-26 security pass. The browser must never see the values, only
 * boolean availability.
 */

import { requireAuth } from '../../lib/utils/auth';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireAuth(req, res);
  if (!session) return;

  return res.status(200).json({
    orcid: !!(process.env.ORCID_CLIENT_ID && process.env.ORCID_CLIENT_SECRET),
    ncbi: !!process.env.NCBI_API_KEY,
    serp: !!process.env.SERP_API_KEY,
  });
}
